import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction, type Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { ensureManagerEmployee } from '../../services/managerEmployees';
import { isTechnicalAdmin } from '../../services/access';
import { notifyUsersWithPermission } from '../../services/notify';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { hashPassword } from '../../utils/password';
import { likeTerm, limitOffset, pageMeta, type PageQuery } from '../../utils/pagination';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

function mapUser(row: RowDataPacket) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    status: row.status,
    employeeId: row.employee_id == null ? null : Number(row.employee_id),
    employeeName: row.employee_name ?? null,
    employeeNumber: row.employee_number ?? null,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

const userFrom = `
  FROM users u
  LEFT JOIN employees e ON e.id = u.employee_id
`;

type UserSummary = ReturnType<typeof mapUser>;

async function attachRoles(db: Db, users: UserSummary[]) {
  if (users.length === 0) {
    return [];
  }
  const ids = users.map((user) => user.id);
  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT ur.user_id, ur.scope_type, r.code, r.name, d.name AS department_name, b.name AS branch_name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     LEFT JOIN departments d ON ur.scope_type = 'department' AND d.id = ur.scope_id
     LEFT JOIN branches b ON ur.scope_type = 'branch' AND b.id = ur.scope_id
     WHERE ur.user_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY r.name`,
    ids,
  );
  return users.map((user) => ({
    ...user,
    roles: rows
      .filter((row) => Number(row.user_id) === user.id)
      .map((row) => ({
        code: String(row.code),
        name: String(row.name),
        scopeType: String(row.scope_type),
        scopeName: (row.department_name ?? row.branch_name ?? null) as string | null,
      })),
  }));
}

export async function listUsers(listQuery: PageQuery & { status: string }) {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (listQuery.status !== 'all') {
    where.push('u.status = ?');
    params.push(listQuery.status);
  }
  if (listQuery.search) {
    where.push(`(u.username LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\' OR e.first_name LIKE ? ESCAPE '\\\\' OR e.last_name LIKE ? ESCAPE '\\\\' OR e.employee_number LIKE ? ESCAPE '\\\\')`);
    const term = likeTerm(listQuery.search);
    params.push(term, term, term, term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) ${userFrom} WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(listQuery);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT u.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.employee_number
     ${userFrom}
     WHERE ${whereSql}
     ORDER BY u.username
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data: await attachRoles(pool, rows.map(mapUser)), meta: pageMeta(listQuery, total) };
}

type RoleInput = { roleId: number; scopeType: string; scopeId?: number; reason?: string };

export async function createUser(
  auth: AuthContext,
  input: { username: string; email: string; password: string; employeeId?: number | null; role?: RoleInput },
  actor: Actor,
) {
  if (input.role) {
    checkScopeShape(input.role);
  }
  return withTransaction(async (connection) => {
    if (input.employeeId) {
      const employee = await queryOne<RowDataPacket>(connection, 'SELECT id FROM employees WHERE id = ?', [input.employeeId]);
      if (!employee) {
        throw new HttpError(422, 'Select a valid employee.', 'INVALID_EMPLOYEE');
      }
      const linked = await queryOne<RowDataPacket>(connection, 'SELECT id FROM users WHERE employee_id = ?', [input.employeeId]);
      if (linked) {
        throw new HttpError(409, 'That employee already has a user account.', 'EMPLOYEE_ALREADY_LINKED');
      }
    }
    const passwordHash = await hashPassword(input.password);
    const result = await execute(
      connection,
      `INSERT INTO users (employee_id, username, email, password_hash, status, must_change_password, password_changed_at)
       VALUES (?, ?, ?, ?, 'active', 1, UTC_TIMESTAMP(3))`,
      [input.employeeId ?? null, input.username, input.email, passwordHash],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'user.create',
      module: 'users',
      entityType: 'user',
      entityId: result.insertId,
      newValue: { username: input.username, email: input.email, employeeId: input.employeeId ?? null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    if (input.role) {
      await insertRoleAssignment(connection, auth, result.insertId, input.role, actor);
    }
    const rows = await query<RowDataPacket[]>(
      connection,
      `SELECT u.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.employee_number ${userFrom} WHERE u.id = ?`,
      [result.insertId],
    );
    const [withRoles] = await attachRoles(connection, [mapUser(rows[0])]);
    return withRoles;
  });
}

async function technicalAdminCount(db: Db, exceptUserId: number): Promise<number> {
  return scalar(
    db,
    `SELECT COUNT(DISTINCT u.id) AS total
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.is_technical_admin = 1 AND r.status = 'active'
     WHERE u.status = 'active' AND u.id <> ?
       AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
    [exceptUserId],
  );
}

export async function updateUser(auth: AuthContext, id: number, input: { email?: string; status?: 'active' | 'disabled'; employeeId?: number | null }, actor: Actor) {
  if (id === auth.userId && input.status === 'disabled') {
    throw new HttpError(403, 'You cannot disable your own account.', 'SELF_DISABLE_DENIED');
  }
  return withTransaction(async (connection) => {
    const currentRows = await query<RowDataPacket[]>(
      connection,
      `SELECT u.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.employee_number ${userFrom} WHERE u.id = ? FOR UPDATE`,
      [id],
    );
    if (!currentRows[0]) {
      throw notFound('User');
    }
    if (input.status === 'disabled' && (await technicalAdminCount(connection, id)) === 0) {
      const isAdmin = await scalar(
        connection,
        `SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND r.is_technical_admin = 1`,
        [id],
      );
      if (isAdmin > 0) {
        throw new HttpError(409, 'The last active system administrator cannot be disabled.', 'LAST_ADMINISTRATOR');
      }
    }
    if (input.employeeId) {
      const linked = await queryOne<RowDataPacket>(connection, 'SELECT id FROM users WHERE employee_id = ? AND id <> ?', [input.employeeId, id]);
      if (linked) {
        throw new HttpError(409, 'That employee already has a user account.', 'EMPLOYEE_ALREADY_LINKED');
      }
    }
    const columns: string[] = [];
    const params: unknown[] = [];
    if (input.email !== undefined) {
      columns.push('email = ?');
      params.push(input.email);
    }
    if (input.status !== undefined) {
      columns.push('status = ?');
      params.push(input.status);
      if (input.status === 'disabled') {
        columns.push('token_version = token_version + 1');
      }
    }
    if (input.employeeId !== undefined) {
      columns.push('employee_id = ?');
      params.push(input.employeeId);
    }
    if (columns.length) {
      params.push(id);
      await execute(connection, `UPDATE users SET ${columns.join(', ')} WHERE id = ?`, params);
      if (input.status === 'disabled') {
        await execute(connection, 'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [id]);
      }
    }
    const updated = await query<RowDataPacket[]>(
      connection,
      `SELECT u.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.employee_number ${userFrom} WHERE u.id = ?`,
      [id],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'user.update',
      module: 'users',
      entityType: 'user',
      entityId: id,
      previousValue: mapUser(currentRows[0]),
      newValue: mapUser(updated[0]),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return mapUser(updated[0]);
  });
}

async function roleProtection(db: Db, roleId: number) {
  const role = await queryOne<RowDataPacket>(db, 'SELECT * FROM roles WHERE id = ? AND status = \'active\'', [roleId]);
  if (!role) {
    throw notFound('Role');
  }
  const permissions = await query<RowDataPacket[]>(
    db,
    `SELECT p.code, p.sensitivity
     FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?`,
    [roleId],
  );
  const protectedRole =
    Boolean(role.can_approve_expenditure) ||
    permissions.some((permission) => permission.sensitivity === 'confidential' || permission.sensitivity === 'expenditure');
  return { role, permissions, protectedRole };
}

function checkScopeShape(input: RoleInput) {
  if ((input.scopeType === 'department' || input.scopeType === 'branch') && !input.scopeId) {
    throw new HttpError(422, 'Choose the department or branch this role applies to.', 'SCOPE_REQUIRED');
  }
  if ((input.scopeType === 'global' || input.scopeType === 'own') && input.scopeId) {
    throw new HttpError(422, 'This scope does not take a record.', 'SCOPE_UNEXPECTED');
  }
}

async function insertRoleAssignment(connection: Db, auth: AuthContext, userId: number, input: RoleInput, actor: Actor) {
  const target = await queryOne<RowDataPacket>(connection, 'SELECT id, username FROM users WHERE id = ?', [userId]);
  if (!target) {
    throw notFound('User');
  }
  const { role, protectedRole } = await roleProtection(connection, input.roleId);
  if (input.scopeType === 'department') {
    const department = await queryOne<RowDataPacket>(connection, `SELECT id FROM departments WHERE id = ? AND status = 'active'`, [input.scopeId]);
    if (!department) throw new HttpError(422, 'Select an active department.', 'INVALID_DEPARTMENT');
  }
  if (input.scopeType === 'branch') {
    const branch = await queryOne<RowDataPacket>(connection, `SELECT id FROM branches WHERE id = ? AND status = 'active'`, [input.scopeId]);
    if (!branch) throw new HttpError(422, 'Select an active branch.', 'INVALID_BRANCH');
  }
  if (protectedRole && isTechnicalAdmin(auth) && userId === auth.userId) {
    throw new HttpError(403, 'You cannot assign a confidential or expenditure role to your own account.', 'SELF_PRIVILEGE_DENIED');
  }
  if (protectedRole && (!input.reason || input.reason.trim().length < 8)) {
    throw new HttpError(422, 'Give a reason of at least 8 characters when assigning this role.', 'REASON_REQUIRED');
  }
  const result = await execute(
    connection,
    `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, assigned_by) VALUES (?, ?, ?, ?, ?)`,
    [userId, input.roleId, input.scopeType, input.scopeId ?? null, actor.userId],
  );
  await writeAudit(connection, {
    userId: actor.userId,
    action: protectedRole ? 'user.role.assign.protected' : 'user.role.assign',
    module: 'users',
    entityType: 'user_role',
    entityId: result.insertId,
    newValue: { userId, username: target.username, role: role.code, scopeType: input.scopeType, scopeId: input.scopeId ?? null, reason: input.reason ?? null },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  if (protectedRole) {
    await notifyUsersWithPermission(connection, 'permissions.manage_protected', {
      title: 'Protected role assigned',
      body: `${role.code} was assigned to ${target.username}.`,
      notificationType: 'security.protected_role',
      entityType: 'user',
      entityId: userId,
      excludeUserId: actor.userId,
    });
  }
  await ensureManagerEmployee(connection, userId, actor.userId);
  return { id: result.insertId };
}

export async function assignRole(auth: AuthContext, userId: number, input: RoleInput, actor: Actor) {
  checkScopeShape(input);
  return withTransaction((connection) => insertRoleAssignment(connection, auth, userId, input, actor));
}

export async function removeRole(_auth: AuthContext, userId: number, userRoleId: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const assignment = await queryOne<RowDataPacket>(
      connection,
      `SELECT ur.id, r.is_technical_admin, r.code
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.id = ? AND ur.user_id = ?`,
      [userRoleId, userId],
    );
    if (!assignment) {
      throw notFound('Role assignment');
    }
    if (Number(assignment.is_technical_admin) === 1) {
      const remaining = await technicalAdminCount(connection, userId);
      const stillHasAnother = await scalar(
        connection,
        `SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND ur.id <> ? AND r.is_technical_admin = 1`,
        [userId, userRoleId],
      );
      if (remaining === 0 && stillHasAnother === 0) {
        throw new HttpError(409, 'The last active system administrator role cannot be removed.', 'LAST_ADMINISTRATOR');
      }
    }
    await execute(connection, 'DELETE FROM user_roles WHERE id = ?', [userRoleId]);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'user.role.remove',
      module: 'users',
      entityType: 'user_role',
      entityId: userRoleId,
      previousValue: { userId, role: assignment.code },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { removed: true };
  });
}

export async function listUserRoles(userId: number) {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT ur.id, ur.scope_type, ur.scope_id, r.id AS role_id, r.code, r.name
     FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
     ORDER BY r.name`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    roleId: Number(row.role_id),
    code: row.code,
    name: row.name,
    scopeType: row.scope_type,
    scopeId: row.scope_id == null ? null : Number(row.scope_id),
  }));
}

export async function listDirectory() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT u.id, u.username, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM users u LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.status = 'active'
     ORDER BY u.username`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    username: String(row.username),
    employeeName: (row.employee_name ?? null) as string | null,
    status: 'active' as const,
  }));
}
