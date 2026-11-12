import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from '../database/rows';
import { query } from '../database/query';
import { pool } from '../database/pool';
import type { AuthContext, PermissionGrant, ScopeType, Sensitivity } from '../types/auth';
import { HttpError } from '../utils/httpError';
import { verifyAccessToken } from '../utils/tokens';

export const ACCESS_COOKIE = 'bajogo_access';

const PASSWORD_CHANGE_ALLOWED = /\/auth\/(me|change-password|logout)$/;

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.get('authorization');
    const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const token = bearer || (typeof req.cookies?.[ACCESS_COOKIE] === 'string' ? req.cookies[ACCESS_COOKIE] : '');
    if (!token) {
      throw new HttpError(401, 'Authentication is required.', 'UNAUTHENTICATED');
    }

    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('x-bajogo-client') !== 'web') {
        throw new HttpError(403, 'This request was rejected.', 'CSRF_REJECTED');
      }
    }

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw new HttpError(401, 'Your session has expired. Sign in again.', 'INVALID_TOKEN');
    }

    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT u.id, u.username, u.employee_id, u.status, u.token_version, u.must_change_password
       FROM users u
       JOIN user_sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)`,
      [claims.sub, claims.sid],
    );
    const user = rows[0];
    if (!user || user.status !== 'active' || Number(user.token_version) !== claims.tv) {
      throw new HttpError(401, 'Your session is no longer valid. Sign in again.', 'SESSION_REVOKED');
    }

    const grantRows = await query<RowDataPacket[]>(
      pool,
      `SELECT p.code AS permission, p.sensitivity, ur.scope_type, ur.scope_id, r.id AS role_id, r.code AS role_code,
              r.is_technical_admin, r.can_approve_expenditure, r.has_final_business_authority
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?
         AND (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE)
         AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
      [user.id],
    );

    const grants: PermissionGrant[] = grantRows.map((row) => ({
      permission: String(row.permission),
      sensitivity: String(row.sensitivity) as Sensitivity,
      scopeType: String(row.scope_type) as ScopeType,
      scopeId: row.scope_id === null ? null : Number(row.scope_id),
      roleId: Number(row.role_id),
      roleCode: String(row.role_code),
      isTechnicalAdmin: Boolean(row.is_technical_admin),
      canApproveExpenditure: Boolean(row.can_approve_expenditure),
      hasFinalBusinessAuthority: Boolean(row.has_final_business_authority),
    }));

    req.auth = {
      userId: Number(user.id),
      sessionId: claims.sid,
      employeeId: user.employee_id === null ? null : Number(user.employee_id),
      username: String(user.username),
      tokenVersion: Number(user.token_version),
      mustChangePassword: Boolean(user.must_change_password),
      grants,
    } satisfies AuthContext;

    if (req.auth.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.test(req.originalUrl.split('?')[0])) {
      throw new HttpError(403, 'Change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new HttpError(401, 'Authentication is required.', 'UNAUTHENTICATED'));
      return;
    }
    const allowed = permissions.some((permission) => req.auth?.grants.some((grant) => grant.permission === permission));
    if (!allowed) {
      next(new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
      return;
    }
    next();
  };
}
