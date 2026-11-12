import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { canAdministerSensitivity } from '../../services/access';
import type { AuthContext, Sensitivity } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

async function loadRole(id: number) {
  const role = await queryOne<RowDataPacket>(pool, 'SELECT * FROM roles WHERE id = ?', [id]);
  if (!role) {
    throw notFound('Role');
  }
  const permissions = await query<RowDataPacket[]>(
    pool,
    `SELECT p.code, p.module, p.action, p.description, p.sensitivity
     FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?
     ORDER BY p.module, p.code`,
    [id],
  );
  return {
    id: Number(role.id),
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: Boolean(role.is_system),
    isTechnicalAdmin: Boolean(role.is_technical_admin),
    canApproveExpenditure: Boolean(role.can_approve_expenditure),
    hasFinalBusinessAuthority: Boolean(role.has_final_business_authority),
    status: role.status,
    permissions: permissions.map((permission) => ({
      code: String(permission.code),
      module: String(permission.module),
      action: String(permission.action),
      description: String(permission.description),
      sensitivity: String(permission.sensitivity) as Sensitivity,
    })),
  };
}

export async function listRoles() {
  const roles = await query<RowDataPacket[]>(pool, 'SELECT id FROM roles ORDER BY name');
  return Promise.all(roles.map((role) => loadRole(Number(role.id))));
}

export async function listPermissions() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT code, module, action, description, sensitivity FROM permissions ORDER BY module, code');
  return rows.map((row) => ({
    code: String(row.code),
    module: String(row.module),
    action: String(row.action),
    description: String(row.description),
    sensitivity: String(row.sensitivity),
  }));
}

export async function createRole(input: { code: string; name: string; description?: string | null; permissions: string[] }, auth: AuthContext, actor: Actor) {
  const result = await withTransaction(async (connection) => {
    const inserted = await execute(
      connection,
      `INSERT INTO roles (code, name, description, is_system, is_technical_admin, can_approve_expenditure, has_final_business_authority)
       VALUES (?, ?, ?, 0, 0, 0, 0)`,
      [input.code, input.name, input.description ?? null],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'role.create',
      module: 'roles',
      entityType: 'role',
      entityId: inserted.insertId,
      newValue: { code: input.code, name: input.name },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return inserted.insertId;
  });
  if (input.permissions.length) {
    await replacePermissions(result, input.permissions, auth, actor);
  }
  return loadRole(result);
}

export async function updateRole(id: number, input: { name?: string; description?: string | null; status?: 'active' | 'inactive' }, actor: Actor) {
  const current = await queryOne<RowDataPacket>(pool, 'SELECT * FROM roles WHERE id = ?', [id]);
  if (!current) {
    throw notFound('Role');
  }
  if (Number(current.is_system) === 1 && input.status === 'inactive') {
    throw new HttpError(409, 'System roles cannot be deactivated.', 'SYSTEM_ROLE');
  }
  const columns: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    columns.push('name = ?');
    params.push(input.name);
  }
  if (input.description !== undefined) {
    columns.push('description = ?');
    params.push(input.description);
  }
  if (input.status !== undefined) {
    columns.push('status = ?');
    params.push(input.status);
  }
  if (columns.length) {
    params.push(id);
    await execute(pool, `UPDATE roles SET ${columns.join(', ')} WHERE id = ?`, params);
    await writeAudit(pool, {
      userId: actor.userId,
      action: 'role.update',
      module: 'roles',
      entityType: 'role',
      entityId: id,
      previousValue: { name: current.name, status: current.status },
      newValue: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
  return loadRole(id);
}

export async function replacePermissions(roleId: number, codes: string[], auth: AuthContext, actor: Actor) {
  return withTransaction(async (connection) => {
    const role = await queryOne<RowDataPacket>(connection, 'SELECT * FROM roles WHERE id = ? FOR UPDATE', [roleId]);
    if (!role) {
      throw notFound('Role');
    }
    const catalogue = await query<RowDataPacket[]>(connection, 'SELECT id, code, sensitivity FROM permissions');
    const byCode = new Map(catalogue.map((permission) => [String(permission.code), permission]));
    const unknown = codes.filter((code) => !byCode.has(code));
    if (unknown.length) {
      throw new HttpError(422, `Unknown permissions: ${unknown.join(', ')}.`, 'UNKNOWN_PERMISSION');
    }
    const currentRows = await query<RowDataPacket[]>(
      connection,
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
      [roleId],
    );
    const current = new Set(currentRows.map((row) => String(row.code)));
    const requested = new Set(codes);
    const next = new Set<string>();

    for (const permission of catalogue) {
      const code = String(permission.code);
      const isCurrent = current.has(code);
      const isRequested = requested.has(code);
      const allowed = canAdministerSensitivity(auth, String(permission.sensitivity) as Sensitivity, Boolean(role.is_technical_admin));
      if (!allowed) {
        if (isCurrent) {
          next.add(code);
        }
        if (isRequested && !isCurrent) {
          throw new HttpError(403, `You cannot grant ${code}.`, 'PROTECTED_PERMISSION');
        }
        continue;
      }
      if (isRequested) {
        next.add(code);
      }
    }

    await execute(connection, 'DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    for (const code of next) {
      await execute(connection, 'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, byCode.get(code)!.id]);
    }
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'role.permissions',
      module: 'roles',
      entityType: 'role',
      entityId: roleId,
      previousValue: { permissions: [...current].sort() },
      newValue: { permissions: [...next].sort() },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id: roleId, permissions: [...next].sort() };
  });
}

export { loadRole };
