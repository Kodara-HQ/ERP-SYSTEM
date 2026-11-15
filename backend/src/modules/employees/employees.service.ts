import type { Request } from 'express';
import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction, type Db } from '../../database/query';
import { requestMeta, writeAudit } from '../../services/auditService';
import { assertSalaryAccess, insertCompensation } from '../payroll/payroll.service';
import { hasPermission } from '../../services/access';
import { departmentClause } from '../../services/visibility';
import { personnelVisibility } from '../../services/workspaces';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { addDays, likeTerm, limitOffset, pageMeta, todayIso, type PageQuery } from '../../utils/pagination';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

export function actorFrom(req: Request): Actor {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

interface AssignmentInput {
  departmentId: number;
  positionId: number;
  branchId: number;
  locationId?: number | null;
  supervisorEmployeeId?: number | null;
  assignmentType: 'substantive' | 'acting' | 'temporary';
  isPrimary: boolean;
  startDate: string;
  reason?: string | null;
}

function presentEmployee(row: RowDataPacket, includeConfidential: boolean) {
  const employee = {
    id: Number(row.id),
    employeeNumber: row.employee_number,
    firstName: row.first_name,
    lastName: row.last_name,
    otherNames: row.other_names,
    workEmail: row.work_email,
    phone: row.phone,
    hireDate: row.hire_date,
    employmentStatus: row.employment_status,
    confidentialityLevel: row.confidentiality_level,
    departmentId: row.department_id == null ? null : Number(row.department_id),
    departmentName: row.department_name ?? null,
    positionId: row.position_id == null ? null : Number(row.position_id),
    positionTitle: row.position_title ?? null,
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    branchName: row.branch_name ?? null,
  };
  if (!includeConfidential) {
    return employee;
  }
  return {
    ...employee,
    personalEmail: row.personal_email,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    nationalId: row.national_id,
  };
}

function seesConfidential(auth: AuthContext, employeeId: number): boolean {
  return auth.employeeId === employeeId || hasPermission(auth, 'employees.view_confidential');
}

async function assertPlacement(db: Db, companyId: number, input: AssignmentInput, employeeId: number | null): Promise<void> {
  const branch = await queryOne<RowDataPacket>(db, `SELECT id FROM branches WHERE id = ? AND company_id = ? AND status = 'active'`, [
    input.branchId,
    companyId,
  ]);
  if (!branch) {
    throw new HttpError(422, 'Select an active branch.', 'INVALID_BRANCH');
  }
  const department = await queryOne<RowDataPacket>(db, `SELECT id FROM departments WHERE id = ? AND company_id = ? AND status = 'active'`, [
    input.departmentId,
    companyId,
  ]);
  if (!department) {
    throw new HttpError(422, 'Select an active department.', 'INVALID_DEPARTMENT');
  }
  const position = await queryOne<RowDataPacket>(
    db,
    `SELECT id, department_id FROM positions WHERE id = ? AND company_id = ? AND status = 'active'`,
    [input.positionId, companyId],
  );
  if (!position) {
    throw new HttpError(422, 'Select an active position.', 'INVALID_POSITION');
  }
  if (position.department_id != null && Number(position.department_id) !== input.departmentId) {
    throw new HttpError(422, 'That position does not belong to the selected department.', 'POSITION_DEPARTMENT_MISMATCH');
  }
  if (input.locationId) {
    const location = await queryOne<RowDataPacket>(
      db,
      `SELECT id FROM locations WHERE id = ? AND branch_id = ? AND status = 'active'`,
      [input.locationId, input.branchId],
    );
    if (!location) {
      throw new HttpError(422, 'Select an active location in the chosen branch.', 'INVALID_LOCATION');
    }
  }
  if (input.supervisorEmployeeId) {
    if (employeeId != null && input.supervisorEmployeeId === employeeId) {
      throw new HttpError(422, 'An employee cannot supervise themselves.', 'INVALID_SUPERVISOR');
    }
    const supervisor = await queryOne<RowDataPacket>(
      db,
      `SELECT id FROM employees WHERE id = ? AND company_id = ? AND employment_status IN ('active', 'probation')`,
      [input.supervisorEmployeeId, companyId],
    );
    if (!supervisor) {
      throw new HttpError(422, 'Select an active supervisor.', 'INVALID_SUPERVISOR');
    }
  }
}

async function closePrimaryAssignments(db: Db, employeeId: number, startDate: string): Promise<void> {
  const current = await query<RowDataPacket[]>(
    db,
    `SELECT id, start_date FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL FOR UPDATE`,
    [employeeId],
  );
  for (const row of current) {
    const currentStart = String(row.start_date).slice(0, 10);
    if (startDate < currentStart) {
      throw new HttpError(422, 'The new assignment cannot start before the current assignment.', 'INVALID_DATE');
    }
    const endDate = startDate === currentStart ? currentStart : addDays(startDate, -1);
    await execute(db, 'UPDATE employee_assignments SET end_date = ? WHERE id = ?', [endDate, row.id]);
  }
}

async function insertAssignment(db: Db, employeeId: number, input: AssignmentInput, actor: Actor): Promise<number> {
  if (input.isPrimary) {
    await closePrimaryAssignments(db, employeeId, input.startDate);
  }
  const result = await execute(
    db,
    `INSERT INTO employee_assignments
      (employee_id, department_id, position_id, branch_id, location_id, supervisor_employee_id, assignment_type, is_primary, start_date, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeId,
      input.departmentId,
      input.positionId,
      input.branchId,
      input.locationId ?? null,
      input.supervisorEmployeeId ?? null,
      input.assignmentType,
      input.isPrimary ? 1 : 0,
      input.startDate,
      input.reason ?? null,
      actor.userId,
    ],
  );
  return result.insertId;
}

const employeeFrom = `
  FROM employees e
  LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
  LEFT JOIN departments d ON d.id = ea.department_id
  LEFT JOIN positions p ON p.id = ea.position_id
  LEFT JOIN branches b ON b.id = ea.branch_id
`;

const employeeColumns = `
  e.*, ea.department_id, d.name AS department_name, ea.position_id, p.title AS position_title, ea.branch_id, b.name AS branch_name
`;

async function scopeClause(auth: AuthContext): Promise<{ sql: string; params: unknown[] }> {
  const visibility = await personnelVisibility(auth);
  if (visibility.companyWide) return { sql: '1 = 1', params: [] };
  const department = departmentClause(visibility, 'ea.department_id');
  if (visibility.employeeId) {
    return { sql: `(${department.sql} OR e.id = ?)`, params: [...department.params, visibility.employeeId] };
  }
  return department;
}

export async function listEmployees(
  auth: AuthContext,
  listQuery: PageQuery & { status: string; departmentId?: number },
) {
  const companyId = await requireCompanyId(pool);
  const where = ['e.company_id = ?', 'e.deleted_at IS NULL'];
  const params: unknown[] = [companyId];
  if (listQuery.status === 'current') {
    where.push(`e.employment_status IN ('active', 'probation')`);
  } else if (listQuery.status !== 'all') {
    where.push('e.employment_status = ?');
    params.push(listQuery.status);
  }
  if (!hasPermission(auth, 'employees.view_confidential')) {
    where.push(`e.confidentiality_level = 'standard'`);
  }
  if (listQuery.departmentId) {
    where.push('ea.department_id = ?');
    params.push(listQuery.departmentId);
  }
  if (listQuery.search) {
    where.push(`(e.employee_number LIKE ? ESCAPE '\\\\' OR e.first_name LIKE ? ESCAPE '\\\\' OR e.last_name LIKE ? ESCAPE '\\\\' OR e.work_email LIKE ? ESCAPE '\\\\')`);
    const term = likeTerm(listQuery.search);
    params.push(term, term, term, term);
  }
  const scope = await scopeClause(auth);
  where.push(scope.sql);
  params.push(...scope.params);
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(DISTINCT e.id) ${employeeFrom} WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(listQuery);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT ${employeeColumns} ${employeeFrom} WHERE ${whereSql} ORDER BY e.last_name, e.first_name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    data: rows.map((row) => presentEmployee(row, false)),
    meta: pageMeta(listQuery, total),
  };
}

async function loadEmployeeRow(db: Db, id: number): Promise<RowDataPacket | null> {
  const rows = await query<RowDataPacket[]>(db, `SELECT ${employeeColumns} ${employeeFrom} WHERE e.id = ? AND e.deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

async function ensureVisible(auth: AuthContext, row: RowDataPacket): Promise<void> {
  const employeeId = Number(row.id);
  if (auth.employeeId === employeeId) {
    return;
  }
  if (!hasPermission(auth, 'employees.view')) {
    throw notFound('Employee');
  }
  const visibility = await personnelVisibility(auth);
  let departmentId = row.department_id == null ? null : Number(row.department_id);
  if (departmentId == null) {
    const last = await queryOne<RowDataPacket>(
      pool,
      'SELECT department_id FROM employee_assignments WHERE employee_id = ? ORDER BY start_date DESC, id DESC LIMIT 1',
      [employeeId],
    );
    departmentId = last?.department_id == null ? null : Number(last.department_id);
  }
  if (!visibility.companyWide && (departmentId == null || !visibility.departmentIds.includes(departmentId))) {
    throw notFound('Employee');
  }
  if (row.confidentiality_level !== 'standard' && !hasPermission(auth, 'employees.view_confidential')) {
    throw notFound('Employee');
  }
}

export async function getEmployee(auth: AuthContext, id: number, options?: { trusted?: boolean }) {
  const row = await loadEmployeeRow(pool, id);
  if (!row) {
    throw notFound('Employee');
  }
  if (!options?.trusted) {
    await ensureVisible(auth, row);
  }
  const includeConfidential = seesConfidential(auth, id);
  const assignments = await query<RowDataPacket[]>(
    pool,
    `SELECT ea.*, d.name AS department_name, p.title AS position_title, b.name AS branch_name, l.name AS location_name,
            CONCAT(s.first_name, ' ', s.last_name) AS supervisor_name
     FROM employee_assignments ea
     JOIN departments d ON d.id = ea.department_id
     JOIN positions p ON p.id = ea.position_id
     JOIN branches b ON b.id = ea.branch_id
     LEFT JOIN locations l ON l.id = ea.location_id
     LEFT JOIN employees s ON s.id = ea.supervisor_employee_id
     WHERE ea.employee_id = ?
     ORDER BY ea.start_date DESC, ea.id DESC`,
    [id],
  );
  const reporting = await query<RowDataPacket[]>(
    pool,
    `SELECT r.*, CONCAT(m.first_name, ' ', m.last_name) AS manager_name, m.employee_number AS manager_number
     FROM reporting_relationships r
     JOIN employees m ON m.id = r.reports_to_employee_id
     WHERE r.employee_id = ?
     ORDER BY r.start_date DESC, r.id DESC`,
    [id],
  );
  const employment = await query<RowDataPacket[]>(
    pool,
    `SELECT id, employment_type, start_date, end_date, status, notes FROM employment_records WHERE employee_id = ? ORDER BY start_date DESC`,
    [id],
  );
  return {
    ...presentEmployee(row, includeConfidential),
    assignments: assignments.map((item) => ({
      id: Number(item.id),
      departmentId: Number(item.department_id),
      departmentName: item.department_name,
      positionId: Number(item.position_id),
      positionTitle: item.position_title,
      branchId: Number(item.branch_id),
      branchName: item.branch_name,
      locationId: item.location_id == null ? null : Number(item.location_id),
      locationName: item.location_name ?? null,
      supervisorEmployeeId: item.supervisor_employee_id == null ? null : Number(item.supervisor_employee_id),
      supervisorName: item.supervisor_name ?? null,
      assignmentType: item.assignment_type,
      isPrimary: Boolean(item.is_primary),
      startDate: item.start_date,
      endDate: item.end_date,
      reason: item.reason,
    })),
    reportingLines: reporting.map((item) => ({
      id: Number(item.id),
      reportsToEmployeeId: Number(item.reports_to_employee_id),
      managerName: item.manager_name,
      managerNumber: item.manager_number,
      relationshipType: item.relationship_type,
      isPrimary: Boolean(item.is_primary),
      startDate: item.start_date,
      endDate: item.end_date,
      notes: item.notes,
    })),
    employmentRecords: employment.map((item) => ({
      id: Number(item.id),
      employmentType: item.employment_type,
      startDate: item.start_date,
      endDate: item.end_date,
      status: item.status,
      notes: item.notes,
    })),
  };
}

export async function getOwnEmployee(auth: AuthContext) {
  if (!auth.employeeId) {
    throw new HttpError(404, 'This account is not linked to an employee record.', 'NO_EMPLOYEE');
  }
  return getEmployee(auth, auth.employeeId);
}

function assertConfidentialWrite(auth: AuthContext, input: object): void {
  const record = input as Record<string, unknown>;
  const touchesConfidential =
    record.personalEmail != null ||
    record.dateOfBirth != null ||
    record.gender != null ||
    record.nationalId != null ||
    (record.confidentialityLevel !== undefined && record.confidentialityLevel !== 'standard');
  if (touchesConfidential && !hasPermission(auth, 'employees.view_confidential')) {
    throw new HttpError(403, 'You cannot record confidential employee information.', 'CONFIDENTIAL_DENIED');
  }
}

export async function createEmployee(auth: AuthContext, input: AssignmentInput & {
  firstName: string;
  lastName: string;
  otherNames?: string | null;
  workEmail?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationalId?: string | null;
  hireDate?: string | null;
  employmentStatus: string;
  employmentType: string;
  confidentialityLevel: string;
  assignmentStartDate: string;
  basicSalary?: number | null;
  allowances?: number | null;
}, actor: Actor) {
  assertConfidentialWrite(auth, input);
  const withSalary = input.basicSalary != null;
  if (withSalary) await assertSalaryAccess(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const placement: AssignmentInput = {
      ...input,
      assignmentType: 'substantive',
      isPrimary: true,
      startDate: input.assignmentStartDate,
    };
    await assertPlacement(connection, companyId, placement, null);
    const employeeNumber = await nextReference(connection, 'employee', 'employee_number_prefix');
    const result = await execute(
      connection,
      `INSERT INTO employees
        (company_id, employee_number, first_name, last_name, other_names, work_email, personal_email, phone,
         date_of_birth, gender, national_id, hire_date, employment_status, confidentiality_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        employeeNumber,
        input.firstName,
        input.lastName,
        input.otherNames ?? null,
        input.workEmail ?? null,
        input.personalEmail ?? null,
        input.phone ?? null,
        input.dateOfBirth ?? null,
        input.gender ?? null,
        input.nationalId ?? null,
        input.hireDate ?? input.assignmentStartDate,
        input.employmentStatus,
        input.confidentialityLevel,
      ],
    );
    const employeeId = result.insertId;
    await execute(
      connection,
      `INSERT INTO employment_records (employee_id, employment_type, start_date, status, created_by)
       VALUES (?, ?, ?, 'active', ?)`,
      [employeeId, input.employmentType, input.hireDate ?? input.assignmentStartDate, actor.userId],
    );
    await insertAssignment(connection, employeeId, placement, actor);
    if (input.supervisorEmployeeId) {
      await execute(
        connection,
        `INSERT INTO reporting_relationships
          (employee_id, reports_to_employee_id, relationship_type, is_primary, start_date, created_by)
         VALUES (?, ?, 'line', 1, ?, ?)`,
        [employeeId, input.supervisorEmployeeId, input.assignmentStartDate, actor.userId],
      );
    }
    if (withSalary) {
      await insertCompensation(connection, companyId, {
        employeeId,
        effectiveFrom: input.assignmentStartDate,
        basicSalary: input.basicSalary!,
        allowances: input.allowances ?? 0,
        deductions: 0,
        notes: 'Set when the employee was registered.',
      }, actor);
    }
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'employee.create',
      module: 'employees',
      entityType: 'employee',
      entityId: employeeId,
      newValue: { employeeNumber, firstName: input.firstName, lastName: input.lastName, departmentId: input.departmentId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    const row = await loadEmployeeRow(connection, employeeId);
    return presentEmployee(row!, true);
  });
}

export async function updateEmployee(auth: AuthContext, id: number, input: Record<string, unknown>, actor: Actor) {
  assertConfidentialWrite(auth, input);
  return withTransaction(async (connection) => {
    const current = await loadEmployeeRow(connection, id);
    if (!current) {
      throw notFound('Employee');
    }
    await ensureVisible(auth, current);
    const columns: string[] = [];
    const params: unknown[] = [];
    const mapping: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      otherNames: 'other_names',
      workEmail: 'work_email',
      personalEmail: 'personal_email',
      phone: 'phone',
      dateOfBirth: 'date_of_birth',
      gender: 'gender',
      nationalId: 'national_id',
      hireDate: 'hire_date',
      employmentStatus: 'employment_status',
      confidentialityLevel: 'confidentiality_level',
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (input[key] !== undefined) {
        columns.push(`${column} = ?`);
        params.push(input[key]);
      }
    }
    if (columns.length) {
      params.push(id);
      await execute(connection, `UPDATE employees SET ${columns.join(', ')} WHERE id = ?`, params);
    }
    if (input.employmentStatus === 'exited') {
      const endDate = todayIso();
      await execute(connection, `UPDATE employee_assignments SET end_date = ? WHERE employee_id = ? AND end_date IS NULL`, [endDate, id]);
      await execute(connection, `UPDATE reporting_relationships SET end_date = ? WHERE employee_id = ? AND end_date IS NULL`, [endDate, id]);
      await execute(
        connection,
        `UPDATE employment_records SET end_date = ?, status = 'ended' WHERE employee_id = ? AND status = 'active'`,
        [endDate, id],
      );
    }
    const updated = await loadEmployeeRow(connection, id);
    await writeAudit(connection, {
      userId: actor.userId,
      action: input.employmentStatus === 'exited' ? 'employee.exit' : 'employee.update',
      module: 'employees',
      entityType: 'employee',
      entityId: id,
      previousValue: presentEmployee(current, true),
      newValue: presentEmployee(updated!, true),
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return presentEmployee(updated!, seesConfidential(auth, id));
  });
}

export async function transferEmployee(auth: AuthContext, id: number, input: AssignmentInput & { startDate: string; reason: string }, actor: Actor) {
  await withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const current = await loadEmployeeRow(connection, id);
    if (!current) {
      throw notFound('Employee');
    }
    await ensureVisible(auth, current);
    await assertPlacement(connection, companyId, { ...input, assignmentType: 'substantive', isPrimary: true }, id);
    await insertAssignment(connection, id, { ...input, assignmentType: 'substantive', isPrimary: true }, actor);
    const openLines = await query<RowDataPacket[]>(
      connection,
      `SELECT id, start_date FROM reporting_relationships
       WHERE employee_id = ? AND relationship_type = 'line' AND is_primary = 1 AND end_date IS NULL
       FOR UPDATE`,
      [id],
    );
    for (const line of openLines) {
      const lineStart = String(line.start_date).slice(0, 10);
      const endDate = input.startDate <= lineStart ? lineStart : addDays(input.startDate, -1);
      await execute(connection, 'UPDATE reporting_relationships SET end_date = ? WHERE id = ?', [endDate, line.id]);
    }
    if (input.supervisorEmployeeId) {
      await execute(
        connection,
        `INSERT INTO reporting_relationships
          (employee_id, reports_to_employee_id, relationship_type, is_primary, start_date, notes, created_by)
         VALUES (?, ?, 'line', 1, ?, ?, ?)`,
        [id, input.supervisorEmployeeId, input.startDate, input.reason, actor.userId],
      );
    }
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'employee.transfer',
      module: 'employees',
      entityType: 'employee',
      entityId: id,
      previousValue: {
        departmentId: current.department_id,
        positionId: current.position_id,
        branchId: current.branch_id,
      },
      newValue: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });
  return getEmployee(auth, id, { trusted: true });
}

export async function addAssignment(auth: AuthContext, id: number, input: AssignmentInput, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const current = await loadEmployeeRow(connection, id);
    if (!current) {
      throw notFound('Employee');
    }
    await ensureVisible(auth, current);
    await assertPlacement(connection, companyId, input, id);
    const assignmentId = await insertAssignment(connection, id, input, actor);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'employee.assignment',
      module: 'employees',
      entityType: 'employee_assignment',
      entityId: assignmentId,
      newValue: { employeeId: id, ...input },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id: assignmentId };
  });
}

export async function addReportingLine(
  auth: AuthContext,
  id: number,
  input: { reportsToEmployeeId: number; relationshipType: string; isPrimary: boolean; startDate: string; notes?: string | null },
  actor: Actor,
) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const current = await loadEmployeeRow(connection, id);
    if (!current) {
      throw notFound('Employee');
    }
    await ensureVisible(auth, current);
    if (input.reportsToEmployeeId === id) {
      throw new HttpError(422, 'An employee cannot report to themselves.', 'INVALID_SUPERVISOR');
    }
    const manager = await queryOne<RowDataPacket>(connection, 'SELECT id FROM employees WHERE id = ? AND company_id = ?', [
      input.reportsToEmployeeId,
      companyId,
    ]);
    if (!manager) {
      throw new HttpError(422, 'Select a valid manager.', 'INVALID_SUPERVISOR');
    }
    if (input.isPrimary) {
      await execute(
        connection,
        `UPDATE reporting_relationships SET end_date = ? WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL`,
        [addDays(input.startDate, -1), id],
      );
    }
    const result = await execute(
      connection,
      `INSERT INTO reporting_relationships
        (employee_id, reports_to_employee_id, relationship_type, is_primary, start_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.reportsToEmployeeId, input.relationshipType, input.isPrimary ? 1 : 0, input.startDate, input.notes ?? null, actor.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'employee.reporting_line',
      module: 'employees',
      entityType: 'reporting_relationship',
      entityId: result.insertId,
      newValue: input,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id: result.insertId };
  });
}

export async function endReportingLine(auth: AuthContext, employeeId: number, relationshipId: number, endDate: string, actor: Actor) {
  const current = await loadEmployeeRow(pool, employeeId);
  if (!current) {
    throw notFound('Employee');
  }
  await ensureVisible(auth, current);
  const relationship = await queryOne<RowDataPacket>(
    pool,
    'SELECT id, start_date FROM reporting_relationships WHERE id = ? AND employee_id = ? AND end_date IS NULL',
    [relationshipId, employeeId],
  );
  if (!relationship) {
    throw notFound('Reporting line');
  }
  if (endDate < String(relationship.start_date).slice(0, 10)) {
    throw new HttpError(422, 'The end date cannot be before the start date.', 'INVALID_DATE');
  }
  await execute(pool, 'UPDATE reporting_relationships SET end_date = ? WHERE id = ?', [endDate, relationshipId]);
  await writeAudit(pool, {
    userId: actor.userId,
    action: 'employee.reporting_line.end',
    module: 'employees',
    entityType: 'reporting_relationship',
    entityId: relationshipId,
    newValue: { endDate },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return { id: relationshipId, endDate };
}
