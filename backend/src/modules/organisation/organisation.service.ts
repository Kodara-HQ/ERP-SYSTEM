import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction, type Db } from '../../database/query';
import { requestMeta, writeAudit } from '../../services/auditService';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import { notifyUsersWithPermission } from '../../services/notify';
import { branchClause, departmentClause, recordVisibility } from '../../services/visibility';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { likeTerm, limitOffset, pageMeta, type PageQuery } from '../../utils/pagination';
import type { Request } from 'express';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

function actorFrom(req: Request): Actor {
  const meta = requestMeta(req);
  return { userId: req.auth!.userId, ...meta };
}

function mapBranch(row: RowDataPacket) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addressLine: row.address_line,
    city: row.city,
    isHeadOffice: Boolean(row.is_head_office),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLocation(row: RowDataPacket) {
  return {
    id: Number(row.id),
    branchId: Number(row.branch_id),
    branchName: row.branch_name,
    code: row.code,
    name: row.name,
    locationType: row.location_type,
    addressLine: row.address_line,
    city: row.city,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDepartment(row: RowDataPacket) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    parentName: row.parent_name ?? null,
    branchId: row.branch_id === null ? null : Number(row.branch_id),
    branchName: row.branch_name ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPosition(row: RowDataPacket) {
  return {
    id: Number(row.id),
    code: row.code,
    title: row.title,
    description: row.description,
    grade: row.grade,
    isManagerial: Boolean(row.is_managerial),
    departmentId: row.department_id === null ? null : Number(row.department_id),
    departmentName: row.department_name ?? null,
    reportsToPositionId: row.reports_to_position_id === null ? null : Number(row.reports_to_position_id),
    reportsToTitle: row.reports_to_title ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertBranch(db: Db, companyId: number, branchId: number): Promise<void> {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT id FROM branches WHERE id = ? AND company_id = ? AND status = 'active'`,
    [branchId, companyId],
  );
  if (!row) {
    throw new HttpError(422, 'Select an active branch.', 'INVALID_BRANCH');
  }
}

async function assertDepartment(db: Db, companyId: number, departmentId: number): Promise<RowDataPacket> {
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT id, parent_id, status FROM departments WHERE id = ? AND company_id = ?',
    [departmentId, companyId],
  );
  if (!row) {
    throw notFound('Department');
  }
  return row;
}

async function assertNoDepartmentCycle(db: Db, departmentId: number | null, parentId: number | null): Promise<void> {
  if (parentId == null) {
    return;
  }
  if (departmentId != null && parentId === departmentId) {
    throw new HttpError(422, 'A department cannot report to itself.', 'HIERARCHY_CYCLE');
  }
  let current: number | null = parentId;
  const seen = new Set<number>();
  while (current != null) {
    if (departmentId != null && current === departmentId) {
      throw new HttpError(422, 'That parent would create a circular structure.', 'HIERARCHY_CYCLE');
    }
    if (seen.has(current)) {
      throw new HttpError(422, 'The department structure already contains a cycle.', 'HIERARCHY_CYCLE');
    }
    seen.add(current);
    const lookupId: number = current;
    const parent: RowDataPacket | null = await queryOne<RowDataPacket>(db, 'SELECT parent_id FROM departments WHERE id = ?', [lookupId]);
    const parentId = parent ? parent.parent_id : null;
    current = parentId == null ? null : Number(parentId);
  }
}

async function assertNoPositionCycle(db: Db, positionId: number | null, reportsToId: number | null): Promise<void> {
  if (reportsToId == null) {
    return;
  }
  if (positionId != null && reportsToId === positionId) {
    throw new HttpError(422, 'A position cannot report to itself.', 'HIERARCHY_CYCLE');
  }
  let current: number | null = reportsToId;
  const seen = new Set<number>();
  while (current != null) {
    if (positionId != null && current === positionId) {
      throw new HttpError(422, 'That reporting line would create a circular structure.', 'HIERARCHY_CYCLE');
    }
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const lookupId: number = current;
    const manager: RowDataPacket | null = await queryOne<RowDataPacket>(db, 'SELECT reports_to_position_id FROM positions WHERE id = ?', [lookupId]);
    const reportsTo = manager ? manager.reports_to_position_id : null;
    current = reportsTo == null ? null : Number(reportsTo);
  }
}

export async function listBranches(auth: AuthContext, filters: PageQuery & { status: string }) {
  const companyId = await requireCompanyId(pool);
  const where = ['b.company_id = ?'];
  const params: unknown[] = [companyId];
  const scope = branchClause(await recordVisibility(auth), 'b.id');
  where.push(scope.sql);
  params.push(...scope.params);
  if (filters.status !== 'all') {
    where.push('b.status = ?');
    params.push(filters.status);
  }
  if (filters.search) {
    where.push("(b.name LIKE ? ESCAPE '\\\\' OR b.code LIKE ? ESCAPE '\\\\')");
    const term = likeTerm(filters.search);
    params.push(term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) AS total FROM branches b WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(filters);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT b.* FROM branches b WHERE ${whereSql} ORDER BY b.is_head_office DESC, b.name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data: rows.map(mapBranch), meta: pageMeta(filters, total) };
}

export async function createBranch(input: {
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  isHeadOffice: boolean;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    if (input.isHeadOffice) {
      await execute(connection, 'UPDATE branches SET is_head_office = 0 WHERE company_id = ?', [companyId]);
    }
    const result = await execute(
      connection,
      `INSERT INTO branches (company_id, code, name, phone, email, address_line, city, is_head_office)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, input.code, input.name, input.phone ?? null, input.email ?? null, input.addressLine ?? null, input.city ?? null, input.isHeadOffice ? 1 : 0],
    );
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM branches WHERE id = ?', [result.insertId]);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'branch.create',
      module: 'organisation',
      entityType: 'branch',
      entityId: result.insertId,
      newValue: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return mapBranch(row!);
  });
}

export async function updateBranch(id: number, input: Record<string, unknown>, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const current = await queryOne<RowDataPacket>(connection, 'SELECT * FROM branches WHERE id = ? AND company_id = ? FOR UPDATE', [id, companyId]);
    if (!current) {
      throw notFound('Branch');
    }
    if (input.status === 'inactive') {
      const locations = await scalar(connection, `SELECT COUNT(*) FROM locations WHERE branch_id = ? AND status = 'active'`, [id]);
      const assignments = await scalar(connection, 'SELECT COUNT(*) FROM employee_assignments WHERE branch_id = ? AND end_date IS NULL', [id]);
      if (locations > 0 || assignments > 0) {
        throw new HttpError(409, 'Move active locations and employee assignments before deactivating this branch.', 'BRANCH_IN_USE');
      }
    }
    if (input.isHeadOffice === true) {
      await execute(connection, 'UPDATE branches SET is_head_office = 0 WHERE company_id = ? AND id <> ?', [companyId, id]);
    }
    const columns: string[] = [];
    const params: unknown[] = [];
    const mapping: Record<string, string> = {
      code: 'code',
      name: 'name',
      phone: 'phone',
      email: 'email',
      addressLine: 'address_line',
      city: 'city',
      status: 'status',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (input[key] !== undefined) {
        columns.push(`${column} = ?`);
        params.push(input[key]);
      }
    }
    if (input.isHeadOffice !== undefined) {
      columns.push('is_head_office = ?');
      params.push(input.isHeadOffice ? 1 : 0);
    }
    if (input.status === 'inactive') {
      columns.push('deleted_at = UTC_TIMESTAMP(3)');
    }
    if (input.status === 'active') {
      columns.push('deleted_at = NULL');
    }
    if (columns.length === 0) {
      return mapBranch(current);
    }
    params.push(id);
    await execute(connection, `UPDATE branches SET ${columns.join(', ')} WHERE id = ?`, params);
    const updated = await queryOne<RowDataPacket>(connection, 'SELECT * FROM branches WHERE id = ?', [id]);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'branch.update',
      module: 'organisation',
      entityType: 'branch',
      entityId: id,
      previousValue: mapBranch(current),
      newValue: mapBranch(updated!),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return mapBranch(updated!);
  });
}

export async function listLocations(auth: AuthContext, listQuery: PageQuery & { status: string; branchId?: number }) {
  const companyId = await requireCompanyId(pool);
  const where = ['l.company_id = ?'];
  const params: unknown[] = [companyId];
  const scope = branchClause(await recordVisibility(auth), 'l.branch_id');
  where.push(scope.sql);
  params.push(...scope.params);
  if (listQuery.status !== 'all') {
    where.push('l.status = ?');
    params.push(listQuery.status);
  }
  if (listQuery.branchId) {
    where.push('l.branch_id = ?');
    params.push(listQuery.branchId);
  }
  if (listQuery.search) {
    where.push("(l.name LIKE ? ESCAPE '\\\\' OR l.code LIKE ? ESCAPE '\\\\')");
    const term = likeTerm(listQuery.search);
    params.push(term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) FROM locations l WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(listQuery);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT l.*, b.name AS branch_name
     FROM locations l JOIN branches b ON b.id = l.branch_id
     WHERE ${whereSql}
     ORDER BY b.name, l.name
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data: rows.map(mapLocation), meta: pageMeta(listQuery, total) };
}

export async function createLocation(input: {
  branchId: number;
  code: string;
  name: string;
  locationType: string | undefined;
  addressLine: string | null;
  city: string | null;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    await assertBranch(connection, companyId, input.branchId);
    const result = await execute(
      connection,
      `INSERT INTO locations (company_id, branch_id, code, name, location_type, address_line, city)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, input.branchId, input.code, input.name, input.locationType ?? 'office', input.addressLine ?? null, input.city ?? null],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'location.create',
      module: 'organisation',
      entityType: 'location',
      entityId: result.insertId,
      newValue: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    const rows = await query<RowDataPacket[]>(
      connection,
      `SELECT l.*, b.name AS branch_name FROM locations l JOIN branches b ON b.id = l.branch_id WHERE l.id = ?`,
      [result.insertId],
    );
    return mapLocation(rows[0]);
  });
}

export async function updateLocation(id: number, input: Record<string, unknown>, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const currentRows = await query<RowDataPacket[]>(
      connection,
      `SELECT l.*, b.name AS branch_name FROM locations l JOIN branches b ON b.id = l.branch_id WHERE l.id = ? AND l.company_id = ? FOR UPDATE`,
      [id, companyId],
    );
    if (!currentRows[0]) {
      throw notFound('Location');
    }
    if (typeof input.branchId === 'number') {
      await assertBranch(connection, companyId, input.branchId);
    }
    const columns: string[] = [];
    const params: unknown[] = [];
    const mapping: Record<string, string> = {
      branchId: 'branch_id',
      code: 'code',
      name: 'name',
      locationType: 'location_type',
      addressLine: 'address_line',
      city: 'city',
      status: 'status',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (input[key] !== undefined) {
        columns.push(`${column} = ?`);
        params.push(input[key]);
      }
    }
    if (input.status === 'inactive') columns.push('deleted_at = UTC_TIMESTAMP(3)');
    if (input.status === 'active') columns.push('deleted_at = NULL');
    if (columns.length) {
      params.push(id);
      await execute(connection, `UPDATE locations SET ${columns.join(', ')} WHERE id = ?`, params);
    }
    const updated = await query<RowDataPacket[]>(
      connection,
      `SELECT l.*, b.name AS branch_name FROM locations l JOIN branches b ON b.id = l.branch_id WHERE l.id = ?`,
      [id],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'location.update',
      module: 'organisation',
      entityType: 'location',
      entityId: id,
      previousValue: mapLocation(currentRows[0]),
      newValue: mapLocation(updated[0]),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return mapLocation(updated[0]);
  });
}

const departmentSelect = `
  SELECT d.*, p.name AS parent_name, b.name AS branch_name
  FROM departments d
  LEFT JOIN departments p ON p.id = d.parent_id
  LEFT JOIN branches b ON b.id = d.branch_id
`;

export async function listDepartments(auth: AuthContext, listQuery: PageQuery & { status: string; branchId?: number }) {
  const companyId = await requireCompanyId(pool);
  const where = ['d.company_id = ?'];
  const params: unknown[] = [companyId];
  const scope = departmentClause(await recordVisibility(auth), 'd.id');
  where.push(scope.sql);
  params.push(...scope.params);
  if (listQuery.status !== 'all') {
    where.push('d.status = ?');
    params.push(listQuery.status);
  }
  if (listQuery.branchId) {
    where.push('(d.branch_id = ? OR d.branch_id IS NULL)');
    params.push(listQuery.branchId);
  }
  if (listQuery.search) {
    where.push("(d.name LIKE ? ESCAPE '\\\\' OR d.code LIKE ? ESCAPE '\\\\')");
    const term = likeTerm(listQuery.search);
    params.push(term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) FROM departments d WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(listQuery);
  const rows = await query<RowDataPacket[]>(
    pool,
    `${departmentSelect} WHERE ${whereSql} ORDER BY d.name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data: rows.map(mapDepartment), meta: pageMeta(listQuery, total) };
}

async function insertDepartment(db: Db, input: {
  code: string;
  name: string;
  description?: string | null;
  parentId?: number | null;
  branchId?: number | null;
}, actor: Actor) {
  const companyId = await requireCompanyId(db);
  if (input.branchId) {
    await assertBranch(db, companyId, input.branchId);
  }
  if (input.parentId) {
    const parent = await assertDepartment(db, companyId, input.parentId);
    if (parent.status !== 'active') {
      throw new HttpError(422, 'The parent department is inactive.', 'INACTIVE_PARENT');
    }
    await assertNoDepartmentCycle(db, null, input.parentId);
  }
  const result = await execute(
    db,
    `INSERT INTO departments (company_id, branch_id, parent_id, code, name, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [companyId, input.branchId ?? null, input.parentId ?? null, input.code, input.name, input.description ?? null],
  );
  const rows = await query<RowDataPacket[]>(db, `${departmentSelect} WHERE d.id = ?`, [result.insertId]);
  await writeAudit(db, {
    userId: actor.userId,
    action: 'department.create',
    module: 'organisation',
    entityType: 'department',
    entityId: result.insertId,
    newValue: mapDepartment(rows[0]),
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return mapDepartment(rows[0]);
}

export async function createDepartment(input: {
  code: string;
  name: string;
  description: string | null;
  parentId?: number | null;
  branchId?: number | null;
}, actor: Actor) {
  return withTransaction((connection) => insertDepartment(connection, input, actor));
}

async function patchDepartment(db: Db, id: number, input: Record<string, unknown>, actor: Actor) {
  const companyId = await requireCompanyId(db);
  const currentRows = await query<RowDataPacket[]>(db, `${departmentSelect} WHERE d.id = ? AND d.company_id = ? FOR UPDATE`, [id, companyId]);
  if (!currentRows[0]) {
    throw notFound('Department');
  }
  if (input.parentId) {
    await assertDepartment(db, companyId, Number(input.parentId));
    await assertNoDepartmentCycle(db, id, Number(input.parentId));
  }
  if (input.branchId) {
    await assertBranch(db, companyId, Number(input.branchId));
  }
  if (input.status === 'inactive') {
    const children = await scalar(db, `SELECT COUNT(*) FROM departments WHERE parent_id = ? AND status = 'active'`, [id]);
    const assignments = await scalar(db, 'SELECT COUNT(*) FROM employee_assignments WHERE department_id = ? AND end_date IS NULL', [id]);
    if (children > 0 || assignments > 0) {
      throw new HttpError(409, 'Reassign active subdepartments and employees before deactivating this department.', 'DEPARTMENT_IN_USE');
    }
  }
  const columns: string[] = [];
  const params: unknown[] = [];
  const mapping: Record<string, string> = {
    code: 'code',
    name: 'name',
    description: 'description',
    parentId: 'parent_id',
    branchId: 'branch_id',
    status: 'status',
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (input[key] !== undefined) {
      columns.push(`${column} = ?`);
      params.push(input[key]);
    }
  }
  if (input.status === 'inactive') columns.push('deleted_at = UTC_TIMESTAMP(3)');
  if (input.status === 'active') columns.push('deleted_at = NULL');
  if (columns.length) {
    params.push(id);
    await execute(db, `UPDATE departments SET ${columns.join(', ')} WHERE id = ?`, params);
  }
  const updated = await query<RowDataPacket[]>(db, `${departmentSelect} WHERE d.id = ?`, [id]);
  await writeAudit(db, {
    userId: actor.userId,
    action: input.status === 'inactive' ? 'department.deactivate' : 'department.update',
    module: 'organisation',
    entityType: 'department',
    entityId: id,
    previousValue: mapDepartment(currentRows[0]),
    newValue: mapDepartment(updated[0]),
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return mapDepartment(updated[0]);
}

export async function updateDepartment(id: number, input: Record<string, unknown>, actor: Actor) {
  return withTransaction((connection) => patchDepartment(connection, id, input, actor));
}

const positionSelect = `
  SELECT p.*, d.name AS department_name, r.title AS reports_to_title
  FROM positions p
  LEFT JOIN departments d ON d.id = p.department_id
  LEFT JOIN positions r ON r.id = p.reports_to_position_id
`;

export async function listPositions(auth: AuthContext, listQuery: PageQuery & { status: string }) {
  const companyId = await requireCompanyId(pool);
  const where = ['p.company_id = ?'];
  const params: unknown[] = [companyId];
  const scope = departmentClause(await recordVisibility(auth), 'p.department_id');
  where.push(scope.sql);
  params.push(...scope.params);
  if (listQuery.status !== 'all') {
    where.push('p.status = ?');
    params.push(listQuery.status);
  }
  if (listQuery.search) {
    where.push("(p.title LIKE ? ESCAPE '\\\\' OR p.code LIKE ? ESCAPE '\\\\')");
    const term = likeTerm(listQuery.search);
    params.push(term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) FROM positions p WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(listQuery);
  const rows = await query<RowDataPacket[]>(
    pool,
    `${positionSelect} WHERE ${whereSql} ORDER BY p.title LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data: rows.map(mapPosition), meta: pageMeta(listQuery, total) };
}

async function insertPosition(db: Db, input: {
  code: string;
  title: string;
  description?: string | null;
  grade?: string | null;
  departmentId?: number | null;
  reportsToPositionId?: number | null;
  isManagerial?: boolean;
}, actor: Actor) {
  const companyId = await requireCompanyId(db);
  if (input.departmentId) {
    const department = await assertDepartment(db, companyId, input.departmentId);
    if (department.status !== 'active') {
      throw new HttpError(422, 'The selected department is inactive.', 'INACTIVE_DEPARTMENT');
    }
  }
  if (input.reportsToPositionId) {
    const manager = await queryOne<RowDataPacket>(db, 'SELECT id FROM positions WHERE id = ? AND company_id = ? AND status = \'active\'', [
      input.reportsToPositionId,
      companyId,
    ]);
    if (!manager) {
      throw new HttpError(422, 'Select an active reporting position.', 'INVALID_POSITION');
    }
    await assertNoPositionCycle(db, null, input.reportsToPositionId);
  }
  const result = await execute(
    db,
    `INSERT INTO positions (company_id, department_id, code, title, description, grade, is_managerial, reports_to_position_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      input.departmentId ?? null,
      input.code,
      input.title,
      input.description ?? null,
      input.grade ?? null,
      input.isManagerial ? 1 : 0,
      input.reportsToPositionId ?? null,
    ],
  );
  const rows = await query<RowDataPacket[]>(db, `${positionSelect} WHERE p.id = ?`, [result.insertId]);
  await writeAudit(db, {
    userId: actor.userId,
    action: 'position.create',
    module: 'organisation',
    entityType: 'position',
    entityId: result.insertId,
    newValue: mapPosition(rows[0]),
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return mapPosition(rows[0]);
}

export async function createPosition(input: {
  code: string;
  title: string;
  description: string | null;
  grade: string | null;
  departmentId?: number | null;
  reportsToPositionId?: number | null;
  isManagerial: boolean;
}, actor: Actor) {
  return withTransaction((connection) => insertPosition(connection, input, actor));
}

async function patchPosition(db: Db, id: number, input: Record<string, unknown>, actor: Actor) {
  const companyId = await requireCompanyId(db);
  const currentRows = await query<RowDataPacket[]>(db, `${positionSelect} WHERE p.id = ? AND p.company_id = ? FOR UPDATE`, [id, companyId]);
  if (!currentRows[0]) {
    throw notFound('Position');
  }
  if (input.departmentId) {
    await assertDepartment(db, companyId, Number(input.departmentId));
  }
  if (input.reportsToPositionId) {
    await assertNoPositionCycle(db, id, Number(input.reportsToPositionId));
  }
  if (input.status === 'inactive') {
    const holders = await scalar(db, 'SELECT COUNT(*) FROM employee_assignments WHERE position_id = ? AND end_date IS NULL', [id]);
    const children = await scalar(db, `SELECT COUNT(*) FROM positions WHERE reports_to_position_id = ? AND status = 'active'`, [id]);
    if (holders > 0 || children > 0) {
      throw new HttpError(409, 'Move current holders and reporting positions before deactivating this position.', 'POSITION_IN_USE');
    }
  }
  const columns: string[] = [];
  const params: unknown[] = [];
  const mapping: Record<string, string> = {
    code: 'code',
    title: 'title',
    description: 'description',
    grade: 'grade',
    departmentId: 'department_id',
    reportsToPositionId: 'reports_to_position_id',
    status: 'status',
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (input[key] !== undefined) {
      columns.push(`${column} = ?`);
      params.push(input[key]);
    }
  }
  if (input.isManagerial !== undefined) {
    columns.push('is_managerial = ?');
    params.push(input.isManagerial ? 1 : 0);
  }
  if (input.status === 'inactive') columns.push('deleted_at = UTC_TIMESTAMP(3)');
  if (input.status === 'active') columns.push('deleted_at = NULL');
  if (columns.length) {
    params.push(id);
    await execute(db, `UPDATE positions SET ${columns.join(', ')} WHERE id = ?`, params);
  }
  const updated = await query<RowDataPacket[]>(db, `${positionSelect} WHERE p.id = ?`, [id]);
  await writeAudit(db, {
    userId: actor.userId,
    action: input.status === 'inactive' ? 'position.deactivate' : 'position.update',
    module: 'organisation',
    entityType: 'position',
    entityId: id,
    previousValue: mapPosition(currentRows[0]),
    newValue: mapPosition(updated[0]),
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return mapPosition(updated[0]);
}

export async function updatePosition(id: number, input: Record<string, unknown>, actor: Actor) {
  return withTransaction((connection) => patchPosition(connection, id, input, actor));
}

export async function createChangeRequest(input: { changeType: string; reason: string; payload: unknown }, actor: Actor) {
  return withTransaction(async (connection) => {
    const reference = await nextReference(connection, 'org_change', 'org_change_prefix');
    const result = await execute(
      connection,
      `INSERT INTO organisational_change_requests
        (reference_number, change_type, payload, reason, status, requested_by_user_id)
       VALUES (?, ?, ?, ?, 'submitted', ?)`,
      [reference, input.changeType, JSON.stringify(input.payload), input.reason, actor.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'organisation.change_request',
      module: 'organisation',
      entityType: 'organisational_change_request',
      entityId: result.insertId,
      newValue: { reference, changeType: input.changeType, reason: input.reason },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    await notifyUsersWithPermission(connection, 'organisation.implement_change', {
      title: 'Organisational change awaiting implementation',
      body: `${reference} (${input.changeType.replaceAll('_', ' ')}) has been submitted.`,
      notificationType: 'organisation.change_request',
      entityType: 'organisational_change_request',
      entityId: result.insertId,
      excludeUserId: actor.userId,
    });
    return { id: result.insertId, referenceNumber: reference, status: 'submitted' };
  });
}

export async function listChangeRequests(listQuery: PageQuery & { status?: string }, actor: { userId: number; canImplement: boolean }) {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (!actor.canImplement) {
    where.push('r.requested_by_user_id = ?');
    params.push(actor.userId);
  }
  if (listQuery.status && listQuery.status !== 'all') {
    where.push('r.status = ?');
    params.push(listQuery.status);
  }
  if (listQuery.search) {
    where.push("(r.reference_number LIKE ? ESCAPE '\\\\' OR r.change_type LIKE ? ESCAPE '\\\\')");
    const term = likeTerm(listQuery.search);
    params.push(term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) FROM organisational_change_requests r WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(listQuery);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT r.*, u.username AS requested_by
     FROM organisational_change_requests r
     JOIN users u ON u.id = r.requested_by_user_id
     WHERE ${whereSql}
     ORDER BY r.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    data: rows.map((row) => ({
      id: Number(row.id),
      referenceNumber: row.reference_number,
      changeType: row.change_type,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      reason: row.reason,
      status: row.status,
      requestedBy: row.requested_by,
      reviewComment: row.review_comment,
      createdAt: row.created_at,
      implementedAt: row.implemented_at,
    })),
    meta: pageMeta(listQuery, total),
  };
}

export async function implementChangeRequest(id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await queryOne<RowDataPacket>(
      connection,
      'SELECT * FROM organisational_change_requests WHERE id = ? FOR UPDATE',
      [id],
    );
    if (!request) {
      throw notFound('Change request');
    }
    if (request.status !== 'submitted') {
      throw new HttpError(409, 'Only a submitted request can be implemented.', 'INVALID_STATE');
    }
    if (Number(request.requested_by_user_id) === actor.userId) {
      throw new HttpError(403, 'You cannot implement your own organisational change request.', 'SELF_APPROVAL_DENIED');
    }
    const payload = typeof request.payload === 'string' ? JSON.parse(request.payload) : request.payload;
    const changeType = String(request.change_type);
    if (changeType === 'create_department') {
      await insertDepartment(connection, payload, actor);
    } else if (changeType === 'update_department' || changeType === 'deactivate_department') {
      const { departmentId, ...rest } = payload;
      await patchDepartment(connection, Number(departmentId), changeType === 'deactivate_department' ? { status: 'inactive' } : rest, actor);
    } else if (changeType === 'create_position') {
      await insertPosition(connection, payload, actor);
    } else if (changeType === 'update_position' || changeType === 'deactivate_position') {
      const { positionId, ...rest } = payload;
      await patchPosition(connection, Number(positionId), changeType === 'deactivate_position' ? { status: 'inactive' } : rest, actor);
    } else {
      throw new HttpError(422, 'This change type is not supported.', 'UNSUPPORTED_CHANGE');
    }
    await execute(
      connection,
      `UPDATE organisational_change_requests
       SET status = 'implemented', reviewed_by_user_id = ?, implemented_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [actor.userId, id],
    );
    await execute(
      connection,
      `INSERT INTO notifications (user_id, title, body, notification_type, entity_type, entity_id)
       VALUES (?, 'Organisational change implemented', ?, 'organisation.change_implemented', 'organisational_change_request', ?)`,
      [request.requested_by_user_id, `${request.reference_number} has been implemented.`, String(id)],
    );
    return { id, status: 'implemented' };
  });
}

export async function rejectChangeRequest(id: number, comment: string, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await queryOne<RowDataPacket>(
      connection,
      'SELECT * FROM organisational_change_requests WHERE id = ? FOR UPDATE',
      [id],
    );
    if (!request) {
      throw notFound('Change request');
    }
    if (request.status !== 'submitted') {
      throw new HttpError(409, 'Only a submitted request can be rejected.', 'INVALID_STATE');
    }
    await execute(
      connection,
      `UPDATE organisational_change_requests
       SET status = 'rejected', reviewed_by_user_id = ?, review_comment = ?
       WHERE id = ?`,
      [actor.userId, comment, id],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'organisation.change_reject',
      module: 'organisation',
      entityType: 'organisational_change_request',
      entityId: id,
      newValue: { comment },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    await execute(
      connection,
      `INSERT INTO notifications (user_id, title, body, notification_type, entity_type, entity_id)
       VALUES (?, 'Organisational change rejected', ?, 'organisation.change_rejected', 'organisational_change_request', ?)`,
      [request.requested_by_user_id, `${request.reference_number} was rejected. ${comment}`.slice(0, 500), String(id)],
    );
    return { id, status: 'rejected' };
  });
}

export { actorFrom };
