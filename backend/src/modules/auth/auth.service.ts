import type { CookieOptions, Response } from 'express';
import type { RowDataPacket } from '../../database/rows';
import { env } from '../../config/env';
import { pool } from '../../database/pool';
import { execute, queryOne, withTransaction } from '../../database/query';
import { writeAudit, type AuditEntry } from '../../services/auditService';
import { permissionCodes, roleCodes } from '../../services/access';
import { workspaceGate, workspaceList } from '../../services/workspaces';
import type { AuthContext } from '../../types/auth';
import { HttpError } from '../../utils/httpError';
import { hashPassword, verifyPassword } from '../../utils/password';
import { hashRefreshToken, newRefreshToken, signAccessToken } from '../../utils/tokens';

export const ACCESS_COOKIE = 'bajogo_access';
export const REFRESH_COOKIE = 'bajogo_refresh';
const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...cookieBase(),
    path: '/api',
    maxAge: env.jwt.accessTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieBase(),
    path: '/api/v1/auth',
    maxAge: env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

async function issueSession(input: {
  userId: number;
  tokenVersion: number;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const refresh = newRefreshToken();
  const result = await execute(
    pool,
    `INSERT INTO user_sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))`,
    [input.userId, refresh.hash, input.ipAddress, input.userAgent, env.jwt.refreshTtlDays],
  );
  const accessToken = signAccessToken({
    sub: input.userId,
    sid: result.insertId,
    tv: input.tokenVersion,
  });
  return { accessToken, refreshToken: refresh.token };
}

export async function publicProfile(auth: AuthContext) {
  const user = await queryOne<RowDataPacket>(
    pool,
    `SELECT u.id, u.username, u.email, u.employee_id, u.must_change_password, u.last_login_at,
            e.employee_number, e.first_name, e.last_name,
            d.name AS department_name, p.title AS position_title, b.name AS branch_name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     LEFT JOIN departments d ON d.id = ea.department_id
     LEFT JOIN positions p ON p.id = ea.position_id
     LEFT JOIN branches b ON b.id = ea.branch_id
     WHERE u.id = ?`,
    [auth.userId],
  );
  return {
    id: auth.userId,
    username: auth.username,
    email: user?.email ?? null,
    employeeId: auth.employeeId,
    employeeNumber: user?.employee_number ?? null,
    employeeName: user?.first_name ? `${user.first_name} ${user.last_name}` : null,
    departmentName: user?.department_name ?? null,
    positionTitle: user?.position_title ?? null,
    branchName: user?.branch_name ?? null,
    mustChangePassword: auth.mustChangePassword,
    lastLoginAt: user?.last_login_at ?? null,
    roles: roleCodes(auth),
    permissions: permissionCodes(auth),
    workspaces: workspaceList(await workspaceGate(auth)),
  };
}

export async function login(input: {
  username: string;
  password: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const username = input.username.trim().toLowerCase();
  const user = await queryOne<RowDataPacket>(
    pool,
    `SELECT id, password_hash, status, failed_login_attempts, token_version,
            (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP(3)) AS is_locked
     FROM users WHERE username = ?`,
    [username],
  );

  const recordAttempt = async (success: boolean) => {
    await execute(pool, 'INSERT INTO login_attempts (username, success, ip_address) VALUES (?, ?, ?)', [
      username,
      success ? 1 : 0,
      input.ipAddress,
    ]);
  };

  if (!user) {
    await recordAttempt(false);
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  if (Number(user.is_locked) === 1) {
    await recordAttempt(false);
    throw new HttpError(423, 'This account is temporarily locked. Try again later.', 'ACCOUNT_LOCKED');
  }

  const matches = await verifyPassword(input.password, String(user.password_hash));
  if (!matches) {
    const attempts = Number(user.failed_login_attempts) + 1;
    if (attempts >= LOCK_THRESHOLD) {
      await execute(
        pool,
        `UPDATE users
         SET failed_login_attempts = ?, locked_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), status = 'locked'
         WHERE id = ?`,
        [attempts, LOCK_MINUTES, user.id],
      );
      await writeAudit(pool, {
        userId: Number(user.id),
        action: 'auth.lock',
        module: 'auth',
        entityType: 'user',
        entityId: user.id,
        newValue: { failedLoginAttempts: attempts },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
    } else {
      await execute(pool, 'UPDATE users SET failed_login_attempts = ? WHERE id = ? AND status <> \'disabled\'', [
        attempts,
        user.id,
      ]);
    }
    await recordAttempt(false);
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  if (user.status === 'disabled') {
    await recordAttempt(false);
    throw new HttpError(403, 'This account has been disabled.', 'ACCOUNT_DISABLED');
  }

  await execute(
    pool,
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL, status = 'active', last_login_at = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [user.id],
  );
  await recordAttempt(true);
  const tokens = await issueSession({
    userId: Number(user.id),
    tokenVersion: Number(user.token_version),
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  await writeAudit(pool, {
    userId: Number(user.id),
    action: 'auth.login',
    module: 'auth',
    entityType: 'user',
    entityId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  return tokens;
}

export async function refresh(input: { refreshToken: string; ipAddress: string | null; userAgent: string | null }) {
  const hash = hashRefreshToken(input.refreshToken);
  return withTransaction(async (connection) => {
    const session = await queryOne<RowDataPacket>(
      connection,
      `SELECT s.id, s.user_id, u.token_version, u.status
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
       FOR UPDATE`,
      [hash],
    );
    if (!session || session.status !== 'active') {
      throw new HttpError(401, 'Your session has expired. Sign in again.', 'SESSION_EXPIRED');
    }
    await execute(connection, 'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?', [session.id]);
    const refreshToken = newRefreshToken();
    const inserted = await execute(
      connection,
      `INSERT INTO user_sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))`,
      [session.user_id, refreshToken.hash, input.ipAddress, input.userAgent, env.jwt.refreshTtlDays],
    );
    const accessToken = signAccessToken({
      sub: Number(session.user_id),
      sid: inserted.insertId,
      tv: Number(session.token_version),
    });
    return { accessToken, refreshToken: refreshToken.token };
  });
}

export async function logout(auth: AuthContext, meta: Pick<AuditEntry, 'ipAddress' | 'userAgent'>): Promise<void> {
  await execute(pool, 'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL', [
    auth.sessionId,
  ]);
  await writeAudit(pool, {
    userId: auth.userId,
    action: 'auth.logout',
    module: 'auth',
    entityType: 'user',
    entityId: auth.userId,
    ...meta,
  });
}

export async function changePassword(
  auth: AuthContext,
  input: { currentPassword: string; newPassword: string },
  meta: Pick<AuditEntry, 'ipAddress' | 'userAgent'>,
): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await queryOne<RowDataPacket>(pool, 'SELECT password_hash, token_version FROM users WHERE id = ?', [auth.userId]);
  if (!user) {
    throw new HttpError(401, 'Your session is no longer valid.', 'SESSION_REVOKED');
  }
  const matches = await verifyPassword(input.currentPassword, String(user.password_hash));
  if (!matches) {
    throw new HttpError(422, 'The current password is incorrect.', 'INVALID_PASSWORD');
  }
  if (input.currentPassword === input.newPassword) {
    throw new HttpError(422, 'Choose a password that is different from the current one.', 'PASSWORD_REUSED');
  }
  const passwordHash = await hashPassword(input.newPassword);
  await execute(
    pool,
    `UPDATE users
     SET password_hash = ?, token_version = token_version + 1, must_change_password = 0,
         password_changed_at = UTC_TIMESTAMP(3), failed_login_attempts = 0, locked_until = NULL
     WHERE id = ?`,
    [passwordHash, auth.userId],
  );
  await execute(pool, 'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [
    auth.userId,
  ]);
  await writeAudit(pool, {
    userId: auth.userId,
    action: 'auth.password_change',
    module: 'auth',
    entityType: 'user',
    entityId: auth.userId,
    ...meta,
  });
  return issueSession({
    userId: auth.userId,
    tokenVersion: Number(user.token_version) + 1,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
}
