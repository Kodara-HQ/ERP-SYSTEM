import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction, type Db } from '../../database/query';
import { createRequest, resubmitRequest } from '../approvals/approval.service';
import { onApprovalChange, type ApprovalChange } from '../approvals/approval.hooks';
import { writeAudit } from '../../services/auditService';
import { hasPermission } from '../../services/access';
import { departmentClause, transactionClause } from '../../services/visibility';
import { personnelVisibility } from '../../services/workspaces';
import { requireCompanyId } from '../../services/companyContext';
import { createEmployee, transferEmployee, updateEmployee } from '../employees/employees.service';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { todayIso } from '../../utils/pagination';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

function workingDays(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    throw new HttpError(422, 'The leave end date is before the start date.', 'INVALID_DATES');
  }
  let days = 0;
  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  if (days < 1 || days > 60) {
    throw new HttpError(422, 'Leave must cover between 1 and 60 working days.', 'INVALID_LEAVE_LENGTH');
  }
  return days;
}

async function primaryAssignment(db: Db, employeeId: number) {
  return queryOne<RowDataPacket>(
    db,
    `SELECT department_id, position_id, branch_id FROM employee_assignments
     WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL LIMIT 1`,
    [employeeId],
  );
}

async function assertEmployeeAccess(auth: AuthContext, employeeId: number, manage = false): Promise<void> {
  if (auth.employeeId === employeeId && !manage) return;
  const visibility = await personnelVisibility(auth);
  const assignment = await queryOne<RowDataPacket>(
    pool,
    'SELECT department_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL',
    [employeeId],
  );
  const departmentId = assignment?.department_id == null ? null : Number(assignment.department_id);
  const inDepartment = departmentId != null && visibility.departmentIds.includes(departmentId);
  if ((visibility.companyWide || inDepartment) && (hasPermission(auth, manage ? 'hr.manage' : 'hr.view') || (!manage && hasPermission(auth, 'hr.manage')))) {
    return;
  }
  throw new HttpError(403, 'You do not have access to this employee record.', 'HR_SCOPE_DENIED');
}

export async function listLeaveTypes() {
  const companyId = await requireCompanyId(pool);
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM leave_types WHERE company_id = ? AND status = \'active\' ORDER BY name', [companyId]);
  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    daysPerYear: Number(row.days_per_year),
    paid: Number(row.paid) === 1,
  }));
}

async function ensureBalance(db: Db, employeeId: number, typeId: number, year: number, entitled: number) {
  await execute(
    db,
    `INSERT INTO leave_balances (employee_id, leave_type_id, balance_year, entitled, used)
     VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE employee_id = employee_id`,
    [employeeId, typeId, year, entitled],
  );
  return queryOne<RowDataPacket>(
    db,
    'SELECT entitled, used FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?',
    [employeeId, typeId, year],
  );
}

function mapLeave(row: RowDataPacket) {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeName: row.employee_name ?? null,
    leaveType: row.leave_type,
    leaveTypeCode: row.leave_code,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    days: Number(row.days),
    reason: row.reason,
    status: row.status,
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
    referenceNumber: row.reference_number ?? null,
  };
}

const leaveFrom = `
  FROM leave_requests lr
  JOIN leave_types lt ON lt.id = lr.leave_type_id
  JOIN employees e ON e.id = lr.employee_id
  LEFT JOIN approval_requests ar ON ar.id = lr.approval_request_id
`;

export async function listLeave(auth: AuthContext, employeeId?: number) {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  const visibility = await personnelVisibility(auth);
  if (!visibility.companyWide || !hasPermission(auth, 'hr.view')) {
    const scope = transactionClause(visibility, { department: 'ea.department_id', employee: 'lr.employee_id', user: 'lr.created_by' });
    where.push(scope.sql);
    params.push(...scope.params);
  }
  if (employeeId) {
    where.push('lr.employee_id = ?');
    params.push(employeeId);
  }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT lr.*, lt.name AS leave_type, lt.code AS leave_code, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, ar.reference_number
     ${leaveFrom}
     LEFT JOIN employee_assignments ea ON ea.employee_id = lr.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
     WHERE ${where.join(' AND ')} ORDER BY lr.start_date DESC LIMIT 100`,
    params,
  );
  return rows.map(mapLeave);
}

export async function leaveBalances(auth: AuthContext, employeeId?: number) {
  const target = employeeId ?? auth.employeeId;
  if (!target) return [];
  if (target !== auth.employeeId && !hasPermission(auth, 'hr.view')) {
    throw new HttpError(403, 'You do not have access to this employee record.', 'HR_SCOPE_DENIED');
  }
  if (target !== auth.employeeId) {
    const visibility = await personnelVisibility(auth);
    if (!visibility.companyWide) {
      const assignment = await queryOne<RowDataPacket>(
        pool,
        'SELECT department_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL',
        [target],
      );
      const departmentId = assignment?.department_id == null ? null : Number(assignment.department_id);
      if (!visibility.manager || departmentId == null || !visibility.departmentIds.includes(departmentId)) {
        throw new HttpError(403, 'You do not have access to this employee record.', 'HR_SCOPE_DENIED');
      }
    }
  }
  const year = Number(todayIso().slice(0, 4));
  const types = await listLeaveTypes();
  const balances = [];
  for (const type of types) {
    if (!type.paid) continue;
    const balance = await ensureBalance(pool, target, type.id, year, type.daysPerYear);
    const pending = await scalar(
      pool,
      `SELECT COALESCE(SUM(days), 0) FROM leave_requests
       WHERE employee_id = ? AND leave_type_id = ? AND status IN ('submitted', 'returned') AND YEAR(start_date) = ?`,
      [target, type.id, year],
    );
    balances.push({
      code: type.code,
      name: type.name,
      entitled: Number(balance?.entitled ?? type.daysPerYear),
      used: Number(balance?.used ?? 0),
      pending,
      available: Number(balance?.entitled ?? type.daysPerYear) - Number(balance?.used ?? 0) - pending,
    });
  }
  return balances;
}

export async function applyLeave(auth: AuthContext, input: {
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  reason: string;
  employeeId?: number;
}, actor: Actor) {
  const employeeId = input.employeeId ?? auth.employeeId;
  if (!employeeId) throw new HttpError(422, 'This account is not linked to an employee.', 'NO_EMPLOYEE');
  if (employeeId !== auth.employeeId && !hasPermission(auth, 'hr.manage')) {
    throw new HttpError(403, 'You can request leave only for your own record.', 'HR_SCOPE_DENIED');
  }
  if (!hasPermission(auth, 'leave.apply') && !hasPermission(auth, 'hr.manage')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const type = await queryOne<RowDataPacket>(
      connection,
      'SELECT * FROM leave_types WHERE company_id = ? AND code = ? AND status = \'active\'',
      [companyId, input.leaveTypeCode],
    );
    if (!type) throw new HttpError(422, 'Choose a leave type.', 'INVALID_LEAVE_TYPE');
    const employee = await queryOne<RowDataPacket>(connection, 'SELECT id, first_name, last_name, employment_status FROM employees WHERE id = ?', [employeeId]);
    if (!employee || !['active', 'probation'].includes(String(employee.employment_status))) {
      throw new HttpError(422, 'Leave can be requested for an active employee.', 'EMPLOYEE_NOT_ACTIVE');
    }
    const days = workingDays(input.startDate, input.endDate);
    const overlap = await queryOne<RowDataPacket>(
      connection,
      `SELECT id FROM leave_requests
       WHERE employee_id = ? AND status IN ('submitted', 'approved', 'returned') AND start_date <= ? AND end_date >= ?`,
      [employeeId, input.endDate, input.startDate],
    );
    if (overlap) throw new HttpError(409, 'Those dates overlap leave that is already requested.', 'LEAVE_OVERLAP');
    const year = Number(input.startDate.slice(0, 4));
    if (Number(type.paid) === 1) {
      const balance = await ensureBalance(connection, employeeId, Number(type.id), year, Number(type.days_per_year));
      const pending = await scalar(
        connection,
        `SELECT COALESCE(SUM(days), 0) FROM leave_requests
         WHERE employee_id = ? AND leave_type_id = ? AND status IN ('submitted', 'returned') AND YEAR(start_date) = ?`,
        [employeeId, type.id, year],
      );
      const available = Number(balance?.entitled ?? 0) - Number(balance?.used ?? 0) - pending;
      if (days > available) {
        throw new HttpError(422, `Only ${available} working days remain for ${type.name}.`, 'INSUFFICIENT_LEAVE');
      }
    }
    const assignment = await primaryAssignment(connection, employeeId);
    const created = await execute(
      connection,
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [employeeId, type.id, input.startDate, input.endDate, days, input.reason, auth.userId],
    );
    const approval = await createRequest(auth, {
      workflowCode: 'LEAVE',
      title: `${type.name} for ${employee.first_name} ${employee.last_name}`,
      details: input.reason,
      departmentId: assignment ? Number(assignment.department_id) : null,
      branchId: assignment ? Number(assignment.branch_id) : null,
      submit: true,
      sourceType: 'leave_request',
      sourceId: created.insertId,
    }, actor, connection);
    await execute(connection, 'UPDATE leave_requests SET approval_request_id = ? WHERE id = ?', [approval.id, created.insertId]);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'leave.submit',
      module: 'hr',
      entityType: 'leave_request',
      entityId: created.insertId,
      newValue: { days, startDate: input.startDate, endDate: input.endDate, approval: approval.referenceNumber },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, `SELECT lr.*, lt.name AS leave_type, lt.code AS leave_code, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, ar.reference_number ${leaveFrom} WHERE lr.id = ?`, [created.insertId]);
    return mapLeave(row!);
  });
}

export async function resubmitLeave(auth: AuthContext, id: number, actor: Actor) {
  const leave = await queryOne<RowDataPacket>(pool, 'SELECT * FROM leave_requests WHERE id = ?', [id]);
  if (!leave) throw notFound('Leave request');
  if (Number(leave.created_by) !== auth.userId && !hasPermission(auth, 'hr.manage')) {
    throw new HttpError(403, 'Only the requester can resubmit this leave.', 'NOT_REQUESTER');
  }
  if (leave.status !== 'returned' || !leave.approval_request_id) {
    throw new HttpError(409, 'Only returned leave can be resubmitted.', 'NOT_RETURNED');
  }
  await resubmitRequest(auth, Number(leave.approval_request_id), actor);
  const row = await queryOne<RowDataPacket>(pool, `SELECT lr.*, lt.name AS leave_type, lt.code AS leave_code, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, ar.reference_number ${leaveFrom} WHERE lr.id = ?`, [id]);
  return mapLeave(row!);
}

async function syncLeave(db: Db, event: ApprovalChange) {
  const mapped: Record<string, string> = {
    pending_review: 'submitted',
    under_approval: 'submitted',
    approved: 'approved',
    processing: 'approved',
    completed: 'approved',
    rejected: 'rejected',
    returned_for_correction: 'returned',
    cancelled: 'cancelled',
  };
  const status = mapped[event.status];
  if (!status) return;
  const leave = await queryOne<RowDataPacket>(db, 'SELECT * FROM leave_requests WHERE id = ? FOR UPDATE', [event.sourceId]);
  if (!leave) return;
  await execute(db, 'UPDATE leave_requests SET status = ? WHERE id = ?', [status, leave.id]);
  if (status === 'approved' && Number(leave.balance_applied) !== 1) {
    const type = await queryOne<RowDataPacket>(db, 'SELECT paid FROM leave_types WHERE id = ?', [leave.leave_type_id]);
    if (Number(type?.paid) === 1) {
      const year = Number(String(leave.start_date).slice(0, 4));
      await execute(
        db,
        'UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?',
        [leave.days, leave.employee_id, leave.leave_type_id, year],
      );
    }
    await execute(db, 'UPDATE leave_requests SET balance_applied = 1 WHERE id = ?', [leave.id]);
  }
}

export async function recordAttendance(auth: AuthContext, input: {
  employeeId?: number;
  workDate: string;
  status: 'present' | 'absent' | 'leave' | 'off';
  checkIn?: string | null;
  checkOut?: string | null;
  notes?: string | null;
}, actor: Actor) {
  const employeeId = input.employeeId ?? auth.employeeId;
  if (!employeeId) throw new HttpError(422, 'This account is not linked to an employee.', 'NO_EMPLOYEE');
  const own = employeeId === auth.employeeId;
  if (own && !hasPermission(auth, 'attendance.self') && !hasPermission(auth, 'hr.manage')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  if (!own && !hasPermission(auth, 'hr.manage')) {
    throw new HttpError(403, 'You can record attendance only for your own record.', 'HR_SCOPE_DENIED');
  }
  await execute(
    pool,
    `INSERT INTO attendance_records (employee_id, work_date, attendance_status, check_in, check_out, notes, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE attendance_status = VALUES(attendance_status), check_in = VALUES(check_in), check_out = VALUES(check_out), notes = VALUES(notes), recorded_by = VALUES(recorded_by)`,
    [employeeId, input.workDate, input.status, input.checkIn || null, input.checkOut || null, input.notes ?? null, actor.userId],
  );
  await writeAudit(pool, {
    userId: actor.userId,
    action: 'attendance.record',
    module: 'hr',
    entityType: 'attendance_record',
    entityId: employeeId,
    newValue: { workDate: input.workDate, status: input.status },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return { employeeId, workDate: input.workDate, status: input.status };
}

export async function checkInSelf(auth: AuthContext, actor: Actor) {
  if (!auth.employeeId) throw new HttpError(422, 'This account is not linked to an employee.', 'NO_EMPLOYEE');
  const today = todayIso();
  const now = new Date().toISOString().slice(11, 19);
  const existing = await queryOne<RowDataPacket>(pool, 'SELECT * FROM attendance_records WHERE employee_id = ? AND work_date = ?', [auth.employeeId, today]);
  if (!existing) {
    return recordAttendance(auth, { workDate: today, status: 'present', checkIn: now }, actor);
  }
  if (!existing.check_out) {
    await execute(pool, 'UPDATE attendance_records SET check_out = ? WHERE id = ?', [now, existing.id]);
    return { employeeId: auth.employeeId, workDate: today, status: 'present', checkOut: now };
  }
  throw new HttpError(409, 'Attendance for today is already complete.', 'ATTENDANCE_COMPLETE');
}

export async function listAttendance(auth: AuthContext, filters: { from?: string; to?: string; employeeId?: number }) {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  const visibility = await personnelVisibility(auth);
  if (!visibility.companyWide || !hasPermission(auth, 'hr.view')) {
    const scope = transactionClause(visibility, { department: 'ea.department_id', employee: 'a.employee_id' });
    where.push(scope.sql);
    params.push(...scope.params);
  } else if (filters.employeeId) {
    where.push('a.employee_id = ?');
    params.push(filters.employeeId);
  }
  if (filters.from) {
    where.push('a.work_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.work_date <= ?');
    params.push(filters.to);
  }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM attendance_records a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN employee_assignments ea ON ea.employee_id = a.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
     WHERE ${where.join(' AND ')} ORDER BY a.work_date DESC, e.last_name LIMIT 200`,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeName: row.employee_name,
    workDate: String(row.work_date).slice(0, 10),
    status: row.attendance_status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    notes: row.notes,
  }));
}

function mapVacancy(row: RowDataPacket) {
  return {
    id: Number(row.id),
    title: row.title,
    departmentId: Number(row.department_id),
    departmentName: row.department_name ?? null,
    positionId: Number(row.position_id),
    branchId: Number(row.branch_id),
    openings: Number(row.openings),
    description: row.description,
    status: row.status,
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
    referenceNumber: row.reference_number ?? null,
  };
}

export async function listVacancies(auth: AuthContext) {
  const visibility = await personnelVisibility(auth);
  const scope = departmentClause(visibility, 'v.department_id');
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT v.*, d.name AS department_name, ar.reference_number
     FROM vacancies v
     JOIN departments d ON d.id = v.department_id
     LEFT JOIN approval_requests ar ON ar.id = v.approval_request_id
     WHERE ${scope.sql}
     ORDER BY v.created_at DESC`,
    scope.params,
  );
  return rows.map(mapVacancy);
}

export async function createVacancy(auth: AuthContext, input: {
  title: string;
  departmentId: number;
  positionId: number;
  branchId: number;
  openings: number;
  description?: string | null;
  submit?: boolean;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const created = await execute(
      connection,
      `INSERT INTO vacancies (company_id, title, department_id, position_id, branch_id, openings, description, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [companyId, input.title, input.departmentId, input.positionId, input.branchId, input.openings, input.description ?? null, auth.userId],
    );
    if (input.submit) {
      const approval = await createRequest(auth, {
        workflowCode: 'RECRUITMENT',
        title: `Recruitment: ${input.title}`,
        details: input.description ?? input.title,
        departmentId: input.departmentId,
        branchId: input.branchId,
        submit: true,
        sourceType: 'vacancy',
        sourceId: created.insertId,
      }, actor, connection);
      await execute(connection, 'UPDATE vacancies SET approval_request_id = ? WHERE id = ?', [approval.id, created.insertId]);
    }
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'vacancy.create',
      module: 'hr',
      entityType: 'vacancy',
      entityId: created.insertId,
      newValue: { title: input.title, openings: input.openings },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, 'SELECT v.*, d.name AS department_name, NULL AS reference_number FROM vacancies v JOIN departments d ON d.id = v.department_id WHERE v.id = ?', [created.insertId]);
    return mapVacancy(row!);
  });
}

async function syncVacancy(db: Db, event: ApprovalChange) {
  const mapped: Record<string, string> = {
    pending_review: 'pending_approval',
    under_approval: 'pending_approval',
    approved: 'open',
    processing: 'open',
    completed: 'open',
    rejected: 'rejected',
    returned_for_correction: 'returned',
    cancelled: 'closed',
  };
  const status = mapped[event.status];
  if (!status) return;
  await execute(db, 'UPDATE vacancies SET status = ? WHERE id = ?', [status, event.sourceId]);
}

export async function addApplicant(input: { vacancyId: number; firstName: string; lastName: string; email?: string | null; phone?: string | null; notes?: string | null }) {
  const vacancy = await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM vacancies WHERE id = ?', [input.vacancyId]);
  if (!vacancy) throw notFound('Vacancy');
  if (vacancy.status !== 'open') throw new HttpError(409, 'Applicants can be added only to an open vacancy.', 'VACANCY_NOT_OPEN');
  const result = await execute(
    pool,
    `INSERT INTO applicants (vacancy_id, first_name, last_name, email, phone, notes, status) VALUES (?, ?, ?, ?, ?, ?, 'applied')`,
    [input.vacancyId, input.firstName, input.lastName, input.email ?? null, input.phone ?? null, input.notes ?? null],
  );
  return { id: result.insertId, status: 'applied' };
}

export async function listApplicants(vacancyId: number) {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM applicants WHERE vacancy_id = ? ORDER BY created_at', [vacancyId]);
  return rows.map((row) => ({
    id: Number(row.id),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    employeeId: row.employee_id == null ? null : Number(row.employee_id),
    notes: row.notes,
  }));
}

export async function hireApplicant(auth: AuthContext, applicantId: number, startDate: string, actor: Actor) {
  const applicant = await queryOne<RowDataPacket>(
    pool,
    `SELECT a.*, v.department_id, v.position_id, v.branch_id, v.status AS vacancy_status
     FROM applicants a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = ?`,
    [applicantId],
  );
  if (!applicant) throw notFound('Applicant');
  if (applicant.vacancy_status !== 'open') throw new HttpError(409, 'This vacancy is not open.', 'VACANCY_NOT_OPEN');
  if (applicant.status === 'hired') throw new HttpError(409, 'This applicant is already hired.', 'ALREADY_HIRED');
  const employee = await createEmployee(auth, {
    firstName: applicant.first_name,
    lastName: applicant.last_name,
    workEmail: applicant.email,
    phone: applicant.phone,
    employmentType: 'permanent',
    employmentStatus: 'probation',
    confidentialityLevel: 'standard',
    departmentId: Number(applicant.department_id),
    positionId: Number(applicant.position_id),
    branchId: Number(applicant.branch_id),
    assignmentType: 'substantive',
    isPrimary: true,
    startDate: startDate,
    assignmentStartDate: startDate,
    hireDate: startDate,
  }, actor);
  await execute(pool, `UPDATE applicants SET status = 'hired', employee_id = ? WHERE id = ?`, [employee.id, applicantId]);
  const tasks = ['Issue company identity', 'Confirm workstation and access', 'Complete induction with the supervisor'];
  for (const title of tasks) {
    await execute(pool, 'INSERT INTO onboarding_tasks (employee_id, title, due_date, created_by) VALUES (?, ?, ?, ?)', [employee.id, title, startDate, auth.userId]);
  }
  return { applicantId, employeeId: employee.id, employeeNumber: employee.employeeNumber };
}

export async function promoteEmployee(auth: AuthContext, input: {
  employeeId: number;
  departmentId: number;
  positionId: number;
  branchId: number;
  effectiveDate: string;
  reason: string;
}, actor: Actor) {
  const current = await primaryAssignment(pool, input.employeeId);
  await transferEmployee(auth, input.employeeId, {
    departmentId: input.departmentId,
    positionId: input.positionId,
    branchId: input.branchId,
    startDate: input.effectiveDate,
    reason: input.reason,
    assignmentType: 'substantive',
    isPrimary: true,
  }, actor);
  const result = await execute(
    pool,
    `INSERT INTO promotions (employee_id, from_position_id, to_position_id, from_department_id, to_department_id, effective_date, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.employeeId, current?.position_id ?? null, input.positionId, current?.department_id ?? null, input.departmentId, input.effectiveDate, input.reason, auth.userId],
  );
  return { id: result.insertId };
}

export async function recordExit(auth: AuthContext, input: { employeeId: number; exitDate: string; reason: string }, actor: Actor) {
  await updateEmployee(auth, input.employeeId, { employmentStatus: 'exited' }, actor);
  await execute(
    pool,
    `INSERT INTO exit_records (employee_id, exit_date, reason, clearance_status, created_by)
     VALUES (?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE exit_date = VALUES(exit_date), reason = VALUES(reason)`,
    [input.employeeId, input.exitDate, input.reason, auth.userId],
  );
  return { employeeId: input.employeeId, status: 'exited', clearanceStatus: 'pending' };
}

export async function clearExit(employeeId: number, actor: Actor) {
  const result = await execute(pool, `UPDATE exit_records SET clearance_status = 'cleared' WHERE employee_id = ?`, [employeeId]);
  if (result.affectedRows === 0) throw notFound('Exit record');
  await writeAudit(pool, {
    userId: actor.userId,
    action: 'employee.clearance',
    module: 'hr',
    entityType: 'exit_record',
    entityId: employeeId,
    newValue: { clearanceStatus: 'cleared' },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return { employeeId, clearanceStatus: 'cleared' };
}

async function insertSimple(table: string, columns: string[], values: unknown[]) {
  const result = await execute(pool, `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
  return result.insertId;
}

export async function addContract(auth: AuthContext, input: { employeeId: number; contractType: string; startDate: string; endDate?: string | null; notes?: string | null }) {
  const id = await insertSimple('employment_contracts', ['employee_id', 'contract_type', 'start_date', 'end_date', 'notes', 'created_by'], [input.employeeId, input.contractType, input.startDate, input.endDate ?? null, input.notes ?? null, auth.userId]);
  return { id };
}

export async function addDiscipline(auth: AuthContext, input: { employeeId: number; incidentDate: string; category: string; description: string; actionTaken?: string | null }) {
  const id = await insertSimple('disciplinary_records', ['employee_id', 'incident_date', 'category', 'description', 'action_taken', 'created_by'], [input.employeeId, input.incidentDate, input.category, input.description, input.actionTaken ?? null, auth.userId]);
  return { id };
}

export async function addAppraisal(auth: AuthContext, input: { employeeId: number; periodStart: string; periodEnd: string; rating: number; summary: string }) {
  const id = await insertSimple('appraisals', ['employee_id', 'period_start', 'period_end', 'rating', 'summary', 'appraiser_user_id'], [input.employeeId, input.periodStart, input.periodEnd, input.rating, input.summary, auth.userId]);
  return { id };
}

export async function addTraining(auth: AuthContext, input: { employeeId: number; courseName: string; provider?: string | null; startDate: string; endDate?: string | null; status?: string; result?: string | null }) {
  const id = await insertSimple('training_records', ['employee_id', 'course_name', 'provider', 'start_date', 'end_date', 'status', 'result', 'created_by'], [input.employeeId, input.courseName, input.provider ?? null, input.startDate, input.endDate ?? null, input.status ?? 'planned', input.result ?? null, auth.userId]);
  return { id };
}

export async function addOnboardingTask(auth: AuthContext, input: { employeeId: number; title: string; dueDate?: string | null }) {
  const id = await insertSimple('onboarding_tasks', ['employee_id', 'title', 'due_date', 'created_by'], [input.employeeId, input.title, input.dueDate ?? null, auth.userId]);
  return { id };
}

export async function completeOnboardingTask(id: number) {
  const result = await execute(pool, 'UPDATE onboarding_tasks SET completed_at = UTC_TIMESTAMP(3) WHERE id = ? AND completed_at IS NULL', [id]);
  if (result.affectedRows === 0) throw notFound('Onboarding task');
  return { id, completed: true };
}

export async function employeeLifecycle(auth: AuthContext, employeeId: number) {
  await assertEmployeeAccess(auth, employeeId, false);
  const confidential = hasPermission(auth, 'hr.view_confidential');
  const [contracts, promotions, training, onboarding, exitRow, discipline, appraisals] = await Promise.all([
    query<RowDataPacket[]>(pool, 'SELECT * FROM employment_contracts WHERE employee_id = ? ORDER BY start_date DESC', [employeeId]),
    query<RowDataPacket[]>(pool, 'SELECT * FROM promotions WHERE employee_id = ? ORDER BY effective_date DESC', [employeeId]),
    query<RowDataPacket[]>(pool, 'SELECT * FROM training_records WHERE employee_id = ? ORDER BY start_date DESC', [employeeId]),
    query<RowDataPacket[]>(pool, 'SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY id', [employeeId]),
    queryOne<RowDataPacket>(pool, 'SELECT * FROM exit_records WHERE employee_id = ?', [employeeId]),
    confidential ? query<RowDataPacket[]>(pool, 'SELECT id, incident_date, category, description, action_taken, status FROM disciplinary_records WHERE employee_id = ? ORDER BY incident_date DESC', [employeeId]) : Promise.resolve([]),
    confidential ? query<RowDataPacket[]>(pool, 'SELECT id, period_start, period_end, rating, summary, status FROM appraisals WHERE employee_id = ? ORDER BY period_end DESC', [employeeId]) : Promise.resolve([]),
  ]);
  return {
    contracts: contracts.map((row) => ({ id: Number(row.id), contractType: row.contract_type, startDate: String(row.start_date).slice(0, 10), endDate: row.end_date ? String(row.end_date).slice(0, 10) : null, status: row.status })),
    promotions: promotions.map((row) => ({ id: Number(row.id), toPositionId: Number(row.to_position_id), toDepartmentId: Number(row.to_department_id), effectiveDate: String(row.effective_date).slice(0, 10), reason: row.reason })),
    training: training.map((row) => ({ id: Number(row.id), courseName: row.course_name, provider: row.provider, startDate: String(row.start_date).slice(0, 10), status: row.status, result: row.result })),
    onboarding: onboarding.map((row) => ({ id: Number(row.id), title: row.title, dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null, completedAt: row.completed_at })),
    exit: exitRow ? { exitDate: String(exitRow.exit_date).slice(0, 10), reason: exitRow.reason, clearanceStatus: exitRow.clearance_status } : null,
    disciplinary: discipline.map((row) => ({ id: Number(row.id), incidentDate: String(row.incident_date).slice(0, 10), category: row.category, description: row.description, actionTaken: row.action_taken, status: row.status })),
    appraisals: appraisals.map((row) => ({ id: Number(row.id), periodStart: String(row.period_start).slice(0, 10), periodEnd: String(row.period_end).slice(0, 10), rating: Number(row.rating), summary: row.summary, status: row.status })),
  };
}

export async function hrSummary(auth: AuthContext, from: string, to: string) {
  const visibility = await personnelVisibility(auth);
  const departments = departmentClause(visibility, 'd.id');
  const people = departmentClause(visibility, 'ea.department_id');
  const openRoles = departmentClause(visibility, 'v.department_id');
  const headcount = await query<RowDataPacket[]>(
    pool,
    `SELECT d.name AS department, COUNT(e.id) AS headcount
     FROM departments d
     LEFT JOIN employee_assignments ea ON ea.department_id = d.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     LEFT JOIN employees e ON e.id = ea.employee_id AND e.employment_status IN ('active', 'probation') AND e.deleted_at IS NULL
     WHERE d.status = 'active' AND ${departments.sql}
     GROUP BY d.id, d.name
     ORDER BY d.name`,
    departments.params,
  );
  const leave = await query<RowDataPacket[]>(
    pool,
    `SELECT lt.name AS leave_type, COUNT(lr.id) AS requests, COALESCE(SUM(lr.days), 0) AS days
     FROM leave_types lt
     LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id AND lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
       AND EXISTS (
         SELECT 1 FROM employee_assignments ea
         WHERE ea.employee_id = lr.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL AND ${people.sql}
       )
     GROUP BY lt.id, lt.name
     ORDER BY lt.name`,
    [to, from, ...people.params],
  );
  const attendance = await query<RowDataPacket[]>(
    pool,
    `SELECT ar.attendance_status AS status, COUNT(*) AS days
     FROM attendance_records ar
     JOIN employee_assignments ea ON ea.employee_id = ar.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
     WHERE ar.work_date BETWEEN ? AND ? AND ${people.sql}
     GROUP BY ar.attendance_status`,
    [from, to, ...people.params],
  );
  const vacancies = await scalar(pool, `SELECT COUNT(*) FROM vacancies v WHERE v.status = 'open' AND ${openRoles.sql}`, openRoles.params);
  return {
    headcount: headcount.map((row) => ({ department: String(row.department), headcount: Number(row.headcount) })),
    leave: leave.map((row) => ({ leaveType: String(row.leave_type), requests: Number(row.requests), days: Number(row.days) })),
    attendance: attendance.map((row) => ({ status: String(row.status), days: Number(row.days) })),
    openVacancies: vacancies,
  };
}

export async function getDiscipline(auth: AuthContext, id: number) {
  if (!hasPermission(auth, 'hr.view')) {
    throw notFound('Disciplinary record');
  }
  if (!hasPermission(auth, 'hr.view_confidential')) {
    throw new HttpError(403, 'Disciplinary records are confidential.', 'CONFIDENTIAL_DENIED');
  }
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM disciplinary_records WHERE id = ?', [id]);
  if (!row) throw notFound('Disciplinary record');
  const assignment = await queryOne<RowDataPacket>(
    pool,
    'SELECT department_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL',
    [row.employee_id],
  );
  const visibility = await personnelVisibility(auth);
  const departmentId = assignment?.department_id == null ? null : Number(assignment.department_id);
  if (!visibility.companyWide && (departmentId == null || !visibility.departmentIds.includes(departmentId))) {
    throw notFound('Disciplinary record');
  }
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    incidentDate: String(row.incident_date).slice(0, 10),
    category: row.category,
    description: row.description,
    actionTaken: row.action_taken,
    status: row.status,
  };
}

export function hrReportTables(summary: Awaited<ReturnType<typeof hrSummary>>) {
  return [
    {
      title: 'Headcount',
      columns: ['Department', 'Headcount'],
      rows: summary.headcount.map((row) => [row.department, row.headcount]),
    },
    {
      title: 'Approved leave',
      columns: ['Leave type', 'Requests', 'Days'],
      rows: summary.leave.map((row) => [row.leaveType, row.requests, row.days]),
    },
    {
      title: 'Attendance',
      columns: ['Status', 'Days'],
      rows: summary.attendance.map((row) => [row.status, row.days]),
    },
    {
      title: 'Vacancies',
      columns: ['Label', 'Count'],
      rows: [['Open', summary.openVacancies]],
    },
  ];
}

export function summaryToCsv(summary: Awaited<ReturnType<typeof hrSummary>>): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = ['section,label,value'];
  for (const row of summary.headcount) lines.push(['headcount', cell(row.department), row.headcount].join(','));
  for (const row of summary.leave) lines.push(['leave', cell(row.leaveType), row.days].join(','));
  for (const row of summary.attendance) lines.push(['attendance', cell(row.status), row.days].join(','));
  lines.push(['vacancies', 'open', summary.openVacancies].join(','));
  return `${lines.join('\n')}\n`;
}

onApprovalChange(async (db, event) => {
  if (event.sourceType === 'leave_request') await syncLeave(db, event);
  if (event.sourceType === 'vacancy') await syncVacancy(db, event);
});
