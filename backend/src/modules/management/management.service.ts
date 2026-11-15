import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasFinalBusinessAuthority, hasPermission, isTechnicalAdmin } from '../../services/access';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import { notifyUser } from '../../services/notify';
import { recordVisibility } from '../../services/visibility';
import { workspaceAllows, workspaceGate } from '../../services/workspaces';
import type { ReportTable } from '../../services/reportFiles';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };
export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

interface Placement {
  departmentId: number | null;
  managerial: boolean;
  /** The department and every unit below it, for a manager. Only the department itself otherwise. */
  departmentIds: number[];
  executive: boolean;
}

/** Where a user sits: the CEO sees every department; a manager sees their unit and the units under it. */
async function placement(auth: AuthContext): Promise<Placement> {
  const executive = hasFinalBusinessAuthority(auth);
  const visibility = await recordVisibility(auth);
  let departmentId: number | null = null;
  let managerial = false;
  if (auth.employeeId) {
    const row = await queryOne<RowDataPacket>(
      pool,
      `SELECT ea.department_id, p.is_managerial FROM employee_assignments ea JOIN positions p ON p.id = ea.position_id
       WHERE ea.employee_id = ? AND ea.is_primary = 1 AND ea.end_date IS NULL`,
      [auth.employeeId],
    );
    if (row?.department_id) {
      departmentId = Number(row.department_id);
      managerial = Number(row.is_managerial) === 1;
    }
  }
  const departmentIds = visibility.companyWide ? (departmentId ? [departmentId] : []) : visibility.departmentIds;
  return { departmentId, managerial, departmentIds, executive };
}

function marks(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

async function departmentManagers(db: Db, departmentId: number, excludeUserId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    db,
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id FROM departments WHERE id = ?
       UNION ALL
       SELECT d.id, d.parent_id FROM departments d JOIN chain c ON d.id = c.parent_id
     )
     SELECT DISTINCT u.id FROM chain
     JOIN employee_assignments ea ON ea.department_id = chain.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     JOIN positions p ON p.id = ea.position_id AND p.is_managerial = 1
     JOIN users u ON u.employee_id = ea.employee_id AND u.status = 'active'
     WHERE u.id <> ?`,
    [departmentId, excludeUserId],
  );
  return rows.map((row) => Number(row.id));
}

async function executiveUsers(db: Db): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.status = 'active' AND r.has_final_business_authority = 1
     JOIN users u ON u.id = ur.user_id AND u.status = 'active'
     WHERE (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
  );
  return rows.map((row) => Number(row.user_id));
}

// ---------------------------------------------------------------- departmental reports

const reportSelect = `
  SELECT r.*, d.name AS department_name, a.username AS author, v.username AS reviewer
  FROM department_reports r
  JOIN departments d ON d.id = r.department_id
  JOIN users a ON a.id = r.author_user_id
  LEFT JOIN users v ON v.id = r.reviewer_user_id
`;

function mapReport(row: RowDataPacket) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    departmentId: Number(row.department_id),
    departmentName: String(row.department_name),
    periodType: String(row.period_type),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    title: String(row.title),
    summary: String(row.summary),
    achievements: row.achievements == null ? null : String(row.achievements),
    challenges: row.challenges == null ? null : String(row.challenges),
    nextSteps: row.next_steps == null ? null : String(row.next_steps),
    audience: String(row.audience),
    status: String(row.status),
    author: String(row.author),
    authorUserId: Number(row.author_user_id),
    submittedAt: row.submitted_at,
    reviewer: row.reviewer == null ? null : String(row.reviewer),
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment == null ? null : String(row.review_comment),
  };
}

/** The CEO sees submitted reports from every department. A manager sees their units. Everyone sees their own. */
async function reportScope(auth: AuthContext): Promise<{ sql: string; params: unknown[] }> {
  const place = await placement(auth);
  if (place.executive) return { sql: `(r.status <> 'draft' OR r.author_user_id = ?)`, params: [auth.userId] };
  if (place.managerial && place.departmentIds.length > 0) {
    return {
      sql: `((r.department_id IN (${marks(place.departmentIds)}) AND r.status <> 'draft') OR r.author_user_id = ?)`,
      params: [...place.departmentIds, auth.userId],
    };
  }
  return { sql: 'r.author_user_id = ?', params: [auth.userId] };
}

export async function listReports(auth: AuthContext, filters: { periodType?: PeriodType; departmentId?: number; status?: string }) {
  const scope = await reportScope(auth);
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.periodType) { where.push('r.period_type = ?'); params.push(filters.periodType); }
  if (filters.departmentId) { where.push('r.department_id = ?'); params.push(filters.departmentId); }
  if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
  const rows = await query<RowDataPacket[]>(pool, `${reportSelect} WHERE ${where.join(' AND ')} ORDER BY r.period_start DESC, r.id DESC LIMIT 500`, params);
  return rows.map(mapReport);
}

async function loadVisibleReport(auth: AuthContext, id: number, db: Db = pool) {
  const scope = await reportScope(auth);
  const row = await queryOne<RowDataPacket>(db, `${reportSelect} WHERE r.id = ? AND ${scope.sql}`, [id, ...scope.params]);
  if (!row) throw notFound('Report');
  return row;
}

export async function getReport(auth: AuthContext, id: number) {
  return mapReport(await loadVisibleReport(auth, id));
}

export interface ReportInput {
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  title: string;
  summary: string;
  achievements?: string | null;
  challenges?: string | null;
  nextSteps?: string | null;
  submit?: boolean;
}

export async function createReport(auth: AuthContext, input: ReportInput, actor: Actor) {
  if (input.periodEnd < input.periodStart) throw new HttpError(422, 'The period ends before it starts.', 'INVALID_PERIOD');
  const place = await placement(auth);
  if (!place.departmentId) throw new HttpError(422, 'Your account is not assigned to a department, so it cannot file departmental reports.', 'NO_DEPARTMENT');
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const reference = await nextReference(connection, 'department_report', 'department_report_prefix');
    const audience = place.managerial ? 'ceo' : 'manager';
    const result = await execute(
      connection,
      `INSERT INTO department_reports (company_id, reference_number, department_id, period_type, period_start, period_end, title, summary,
         achievements, challenges, next_steps, audience, status, author_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [companyId, reference, place.departmentId, input.periodType, input.periodStart, input.periodEnd, input.title, input.summary,
        input.achievements ?? null, input.challenges ?? null, input.nextSteps ?? null, audience, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'report.create', module: 'reports', entityType: 'department_report', entityId: result.insertId,
      newValue: { reference, periodType: input.periodType, periodStart: input.periodStart, audience }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    if (input.submit) await submitWithin(connection, auth, result.insertId, actor);
    return mapReport((await queryOne<RowDataPacket>(connection, `${reportSelect} WHERE r.id = ?`, [result.insertId]))!);
  });
}

export async function updateReport(auth: AuthContext, id: number, input: ReportInput, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM department_reports WHERE id = ? FOR UPDATE', [id]);
    if (!row || Number(row.author_user_id) !== auth.userId) throw notFound('Report');
    if (!['draft', 'returned'].includes(String(row.status))) throw new HttpError(409, 'Only a draft or a returned report can be edited.', 'NOT_EDITABLE');
    await execute(
      connection,
      `UPDATE department_reports SET period_type = ?, period_start = ?, period_end = ?, title = ?, summary = ?, achievements = ?, challenges = ?, next_steps = ?
       WHERE id = ?`,
      [input.periodType, input.periodStart, input.periodEnd, input.title, input.summary, input.achievements ?? null, input.challenges ?? null, input.nextSteps ?? null, id],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'report.update', module: 'reports', entityType: 'department_report', entityId: id,
      previousValue: { title: row.title, summary: row.summary, periodStart: row.period_start, periodEnd: row.period_end },
      newValue: { title: input.title, summary: input.summary, periodStart: input.periodStart, periodEnd: input.periodEnd },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    if (input.submit) await submitWithin(connection, auth, id, actor);
    return mapReport((await queryOne<RowDataPacket>(connection, `${reportSelect} WHERE r.id = ?`, [id]))!);
  });
}

async function submitWithin(connection: Db, auth: AuthContext, id: number, actor: Actor) {
  const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM department_reports WHERE id = ? FOR UPDATE', [id]);
  if (!row || Number(row.author_user_id) !== auth.userId) throw notFound('Report');
  if (!['draft', 'returned'].includes(String(row.status))) throw new HttpError(409, 'This report has already been submitted.', 'NOT_DRAFT');
  await execute(connection, `UPDATE department_reports SET status = 'submitted', submitted_at = UTC_TIMESTAMP(3) WHERE id = ?`, [id]);
  const recipients = row.audience === 'ceo' ? await executiveUsers(connection) : await departmentManagers(connection, Number(row.department_id), auth.userId);
  for (const userId of recipients.filter((value) => value !== auth.userId)) {
    await notifyUser(connection, userId, {
      title: `Report submitted: ${row.reference_number}`,
      body: `${row.title} (${row.period_type})`,
      notificationType: 'report.submitted',
      entityType: 'department_report',
      entityId: id,
    });
  }
  await writeAudit(connection, {
    userId: actor.userId, action: 'report.submit', module: 'reports', entityType: 'department_report', entityId: id,
    previousValue: { status: row.status }, newValue: { status: 'submitted', audience: row.audience }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
}

export async function submitReport(auth: AuthContext, id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    await submitWithin(connection, auth, id, actor);
    return mapReport((await queryOne<RowDataPacket>(connection, `${reportSelect} WHERE r.id = ?`, [id]))!);
  });
}

/** Staff reports are reviewed by their managers. Departmental reports from a head of department are reviewed by the CEO. */
export async function reviewReport(auth: AuthContext, id: number, input: { action: 'reviewed' | 'returned'; comment?: string }, actor: Actor) {
  const comment = input.comment?.trim() ?? '';
  if (input.action === 'returned' && comment.length < 8) throw new HttpError(422, 'Give a reason of at least 8 characters for returning the report.', 'REASON_REQUIRED');
  const place = await placement(auth);
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM department_reports WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Report');
    if (Number(row.author_user_id) === auth.userId) throw new HttpError(403, 'You cannot review your own report.', 'SEGREGATION_DENIED');
    const managerOfUnit = place.managerial && place.departmentIds.includes(Number(row.department_id));
    const allowed = place.executive || (row.audience === 'manager' && managerOfUnit);
    if (!allowed) throw new HttpError(403, 'This report is not addressed to you.', 'FORBIDDEN');
    if (String(row.status) !== 'submitted') throw new HttpError(409, 'Only a submitted report can be reviewed.', 'NOT_SUBMITTED');
    await execute(
      connection,
      `UPDATE department_reports SET status = ?, reviewer_user_id = ?, reviewed_at = UTC_TIMESTAMP(3), review_comment = ? WHERE id = ?`,
      [input.action, auth.userId, comment || null, id],
    );
    await notifyUser(connection, Number(row.author_user_id), {
      title: `Report ${input.action}: ${row.reference_number}`,
      body: comment || String(row.title),
      notificationType: 'report.reviewed',
      entityType: 'department_report',
      entityId: id,
    });
    await writeAudit(connection, {
      userId: actor.userId, action: `report.${input.action}`, module: 'reports', entityType: 'department_report', entityId: id,
      previousValue: { status: row.status }, newValue: { status: input.action, comment: comment || null }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapReport((await queryOne<RowDataPacket>(connection, `${reportSelect} WHERE r.id = ?`, [id]))!);
  });
}

export function reportTables(rows: ReturnType<typeof mapReport>[]): ReportTable[] {
  return [{
    title: 'Departmental reports',
    columns: ['Reference', 'Department', 'Period', 'From', 'To', 'Title', 'Status', 'Author', 'Reviewer', 'Summary'],
    rows: rows.map((row) => [row.referenceNumber, row.departmentName, row.periodType, row.periodStart, row.periodEnd, row.title, row.status, row.author, row.reviewer ?? '', row.summary]),
  }];
}

// ---------------------------------------------------------------- departmental targets

const targetSelect = `
  SELECT t.*, d.name AS department_name, u.username AS created_by_username
  FROM department_targets t JOIN departments d ON d.id = t.department_id JOIN users u ON u.id = t.created_by
`;

function mapTarget(row: RowDataPacket) {
  const target = Number(row.target_value);
  const actual = Number(row.actual_value);
  return {
    id: Number(row.id),
    departmentId: Number(row.department_id),
    departmentName: String(row.department_name),
    title: String(row.title),
    metric: String(row.metric),
    unit: String(row.unit),
    targetValue: target,
    actualValue: actual,
    progress: target > 0 ? Math.round((actual / target) * 1000) / 10 : 0,
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    status: String(row.status),
    createdBy: String(row.created_by_username),
  };
}

async function targetScope(auth: AuthContext) {
  const place = await placement(auth);
  if (place.executive) return { sql: '1 = 1', params: [] as unknown[], place };
  if (place.departmentIds.length === 0) return { sql: '1 = 0', params: [] as unknown[], place };
  return { sql: `t.department_id IN (${marks(place.departmentIds)})`, params: [...place.departmentIds] as unknown[], place };
}

export async function listTargets(auth: AuthContext, filters: { departmentId?: number; status?: string }) {
  const scope = await targetScope(auth);
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.departmentId) { where.push('t.department_id = ?'); params.push(filters.departmentId); }
  if (filters.status) { where.push('t.status = ?'); params.push(filters.status); }
  const rows = await query<RowDataPacket[]>(pool, `${targetSelect} WHERE ${where.join(' AND ')} ORDER BY t.period_end DESC, t.id DESC`, params);
  return rows.map(mapTarget);
}

function assertTargetAuthority(place: Placement, departmentId: number) {
  if (place.executive) return;
  if (place.managerial && place.departmentIds.includes(departmentId)) return;
  throw new HttpError(403, 'Only the CEO or the manager of this department can set its targets.', 'SCOPE_DENIED');
}

export async function createTarget(auth: AuthContext, input: {
  departmentId: number; title: string; metric: string; unit: string; targetValue: number; actualValue?: number; periodStart: string; periodEnd: string;
}, actor: Actor) {
  if (input.periodEnd < input.periodStart) throw new HttpError(422, 'The period ends before it starts.', 'INVALID_PERIOD');
  const place = await placement(auth);
  assertTargetAuthority(place, input.departmentId);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const department = await queryOne<RowDataPacket>(connection, `SELECT id FROM departments WHERE id = ? AND status = 'active'`, [input.departmentId]);
    if (!department) throw new HttpError(422, 'Choose an active department.', 'INVALID_DEPARTMENT');
    const result = await execute(
      connection,
      `INSERT INTO department_targets (company_id, department_id, title, metric, unit, target_value, actual_value, period_start, period_end, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [companyId, input.departmentId, input.title, input.metric, input.unit, input.targetValue, input.actualValue ?? 0, input.periodStart, input.periodEnd, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'target.create', module: 'targets', entityType: 'department_target', entityId: result.insertId,
      newValue: input, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapTarget((await queryOne<RowDataPacket>(connection, `${targetSelect} WHERE t.id = ?`, [result.insertId]))!);
  });
}

export async function updateTarget(auth: AuthContext, id: number, input: { actualValue?: number; targetValue?: number; status?: 'active' | 'achieved' | 'missed' | 'cancelled' }, actor: Actor) {
  const place = await placement(auth);
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM department_targets WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Target');
    assertTargetAuthority(place, Number(row.department_id));
    const next = {
      actualValue: input.actualValue ?? Number(row.actual_value),
      targetValue: input.targetValue ?? Number(row.target_value),
      status: input.status ?? String(row.status),
    };
    await execute(connection, 'UPDATE department_targets SET actual_value = ?, target_value = ?, status = ? WHERE id = ?', [next.actualValue, next.targetValue, next.status, id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'target.update', module: 'targets', entityType: 'department_target', entityId: id,
      previousValue: { actualValue: Number(row.actual_value), targetValue: Number(row.target_value), status: row.status }, newValue: next,
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapTarget((await queryOne<RowDataPacket>(connection, `${targetSelect} WHERE t.id = ?`, [id]))!);
  });
}

// ---------------------------------------------------------------- performance assessments

const assessmentSelect = `
  SELECT a.*, e.first_name, e.last_name, e.employee_number, d.name AS department_name, u.username AS assessor
  FROM performance_assessments a
  JOIN employees e ON e.id = a.employee_id
  JOIN departments d ON d.id = a.department_id
  JOIN users u ON u.id = a.assessor_user_id
`;

function mapAssessment(row: RowDataPacket) {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeName: `${row.first_name} ${row.last_name}`,
    employeeNumber: String(row.employee_number),
    departmentId: Number(row.department_id),
    departmentName: String(row.department_name),
    assessor: String(row.assessor),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    rating: Number(row.rating),
    strengths: row.strengths == null ? null : String(row.strengths),
    improvements: row.improvements == null ? null : String(row.improvements),
    comments: row.comments == null ? null : String(row.comments),
    status: String(row.status),
    createdAt: row.created_at,
  };
}

/**
 * Performance assessments are personnel information. The CEO, HR with confidential HR access in its
 * workspace, the manager of the employee's unit, and the employee (once shared) may read them.
 * Other departments and technical administrators may not.
 */
async function assessmentScope(auth: AuthContext) {
  if (isTechnicalAdmin(auth)) return { sql: '1 = 0', params: [] as unknown[] };
  if (hasFinalBusinessAuthority(auth)) return { sql: '1 = 1', params: [] as unknown[] };
  const gate = await workspaceGate(auth);
  if (hasPermission(auth, 'hr.view_confidential') && workspaceAllows(gate, 'hr')) return { sql: '1 = 1', params: [] as unknown[] };
  const place = await placement(auth);
  const own = auth.employeeId ? `(a.employee_id = ? AND a.status = 'shared')` : '1 = 0';
  const ownParams: unknown[] = auth.employeeId ? [auth.employeeId] : [];
  if (place.managerial && place.departmentIds.length > 0 && hasPermission(auth, 'assessments.manage')) {
    return { sql: `(a.department_id IN (${marks(place.departmentIds)}) OR ${own})`, params: [...place.departmentIds, ...ownParams] };
  }
  return { sql: own, params: ownParams };
}

export async function listAssessments(auth: AuthContext, employeeId?: number) {
  const scope = await assessmentScope(auth);
  const where = [scope.sql];
  const params = [...scope.params];
  if (employeeId) { where.push('a.employee_id = ?'); params.push(employeeId); }
  const rows = await query<RowDataPacket[]>(pool, `${assessmentSelect} WHERE ${where.join(' AND ')} ORDER BY a.period_end DESC, a.id DESC LIMIT 500`, params);
  return rows.map(mapAssessment);
}

export async function createAssessment(auth: AuthContext, input: {
  employeeId: number; periodStart: string; periodEnd: string; rating: number; strengths?: string | null; improvements?: string | null; comments?: string | null; share?: boolean;
}, actor: Actor) {
  if (input.periodEnd < input.periodStart) throw new HttpError(422, 'The period ends before it starts.', 'INVALID_PERIOD');
  if (auth.employeeId && input.employeeId === auth.employeeId) throw new HttpError(403, 'You cannot assess yourself.', 'SEGREGATION_DENIED');
  const place = await placement(auth);
  return withTransaction(async (connection) => {
    const employee = await queryOne<RowDataPacket>(
      connection,
      `SELECT e.id, ea.department_id FROM employees e
       JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
       WHERE e.id = ? AND e.deleted_at IS NULL`,
      [input.employeeId],
    );
    if (!employee) throw new HttpError(422, 'Choose an employee with a current assignment.', 'INVALID_EMPLOYEE');
    const departmentId = Number(employee.department_id);
    if (!place.executive && !(place.managerial && place.departmentIds.includes(departmentId))) {
      throw new HttpError(403, 'You can assess only employees in the department you manage.', 'SCOPE_DENIED');
    }
    const companyId = await requireCompanyId(connection);
    const result = await execute(
      connection,
      `INSERT INTO performance_assessments (company_id, employee_id, department_id, assessor_user_id, period_start, period_end, rating, strengths, improvements, comments, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, input.employeeId, departmentId, auth.userId, input.periodStart, input.periodEnd, input.rating, input.strengths ?? null, input.improvements ?? null, input.comments ?? null, input.share === false ? 'draft' : 'shared'],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'assessment.create', module: 'assessments', entityType: 'performance_assessment', entityId: result.insertId,
      newValue: { employeeId: input.employeeId, rating: input.rating, periodStart: input.periodStart, periodEnd: input.periodEnd }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapAssessment((await queryOne<RowDataPacket>(connection, `${assessmentSelect} WHERE a.id = ?`, [result.insertId]))!);
  });
}

/** Employees a manager may assess: the people in their units. Names only, no personnel file. */
export async function assessableEmployees(auth: AuthContext) {
  const place = await placement(auth);
  if (!place.executive && !(place.managerial && place.departmentIds.length > 0)) return [];
  const where = place.executive ? '1 = 1' : `ea.department_id IN (${marks(place.departmentIds)})`;
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT e.id, e.first_name, e.last_name, e.employee_number, d.name AS department_name
     FROM employees e
     JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     JOIN departments d ON d.id = ea.department_id
     WHERE e.deleted_at IS NULL AND e.employment_status IN ('active', 'probation') AND ${where}
     ORDER BY e.last_name, e.first_name`,
    place.executive ? [] : place.departmentIds,
  );
  return rows
    .filter((row) => Number(row.id) !== auth.employeeId)
    .map((row) => ({ id: Number(row.id), name: `${row.first_name} ${row.last_name}`, employeeNumber: String(row.employee_number), departmentName: String(row.department_name) }));
}

// ---------------------------------------------------------------- announcements and company dashboard

function mapAnnouncement(row: RowDataPacket) {
  return {
    id: Number(row.id),
    title: String(row.title),
    body: String(row.body),
    status: String(row.status),
    expiresOn: row.expires_on == null ? null : String(row.expires_on),
    publishedBy: String(row.username),
    createdAt: row.created_at,
  };
}

export async function listAnnouncements(includeWithdrawn: boolean) {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, u.username FROM announcements a JOIN users u ON u.id = a.published_by
     WHERE ${includeWithdrawn ? '1 = 1' : `a.status = 'published' AND (a.expires_on IS NULL OR a.expires_on >= CURRENT_DATE)`}
     ORDER BY a.created_at DESC LIMIT 50`,
  );
  return rows.map(mapAnnouncement);
}

export async function createAnnouncement(auth: AuthContext, input: { title: string; body: string; expiresOn?: string | null }, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const result = await execute(
      connection,
      `INSERT INTO announcements (company_id, title, body, status, expires_on, published_by) VALUES (?, ?, ?, 'published', ?, ?)`,
      [companyId, input.title, input.body, input.expiresOn ?? null, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'announcement.publish', module: 'announcements', entityType: 'announcement', entityId: result.insertId,
      newValue: { title: input.title, expiresOn: input.expiresOn ?? null }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, 'SELECT a.*, u.username FROM announcements a JOIN users u ON u.id = a.published_by WHERE a.id = ?', [result.insertId]);
    return mapAnnouncement(row!);
  });
}

export async function withdrawAnnouncement(id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM announcements WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Announcement');
    await execute(connection, `UPDATE announcements SET status = 'withdrawn' WHERE id = ?`, [id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'announcement.withdraw', module: 'announcements', entityType: 'announcement', entityId: id,
      previousValue: { status: row.status }, newValue: { status: 'withdrawn' }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id, status: 'withdrawn' };
  });
}

/**
 * The shared company dashboard. Counts only: no amounts, no names, no departmental transactions.
 * Every signed-in employee sees the same general figures plus their own work queue.
 */
export async function companyDashboard(auth: AuthContext) {
  const company = await queryOne<RowDataPacket>(pool, `SELECT legal_name, trading_name FROM companies ORDER BY id LIMIT 1`);
  const headcount = await scalar(pool, `SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND employment_status IN ('active', 'probation')`);
  const departments = await query<RowDataPacket[]>(
    pool,
    `SELECT d.id, d.name, d.parent_id, COUNT(ea.id) AS people
     FROM departments d
     LEFT JOIN employee_assignments ea ON ea.department_id = d.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     WHERE d.status = 'active' AND d.deleted_at IS NULL
     GROUP BY d.id, d.name, d.parent_id
     ORDER BY d.name`,
  );
  const openVacancies = await scalar(pool, `SELECT COUNT(*) FROM vacancies WHERE status = 'open'`);
  const myReports = await query<RowDataPacket[]>(pool, `SELECT status, COUNT(*) AS total FROM department_reports WHERE author_user_id = ? GROUP BY status`, [auth.userId]);
  const unread = await scalar(pool, `SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL`, [auth.userId]);
  return {
    companyName: company ? String(company.trading_name || company.legal_name) : '',
    headcount,
    departmentCount: departments.length,
    departments: departments.filter((row) => row.parent_id == null).map((row) => {
      // A head department counts the people in every unit under it.
      const tree = new Set([Number(row.id)]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const unit of departments) {
          if (unit.parent_id != null && tree.has(Number(unit.parent_id)) && !tree.has(Number(unit.id))) { tree.add(Number(unit.id)); grew = true; }
        }
      }
      return { name: String(row.name), people: departments.filter((unit) => tree.has(Number(unit.id))).reduce((sum, unit) => sum + Number(unit.people), 0) };
    }),
    openVacancies,
    announcements: await listAnnouncements(false),
    myReports: Object.fromEntries(myReports.map((row) => [String(row.status), Number(row.total)])),
    unreadNotifications: unread,
  };
}

/**
 * Departmental performance. The CEO sees every head department; a manager sees their own units.
 * Shows report discipline, target progress, and outstanding corrective actions — no transactions.
 */
export async function departmentPerformance(auth: AuthContext) {
  const place = await placement(auth);
  if (!place.executive && !(place.managerial && place.departmentIds.length > 0)) {
    throw new HttpError(403, 'Departmental performance is for the CEO and heads of department.', 'FORBIDDEN');
  }
  const where = place.executive ? `d.status = 'active' AND d.deleted_at IS NULL` : `d.id IN (${marks(place.departmentIds)})`;
  const departments = await query<RowDataPacket[]>(pool, `SELECT d.id, d.name, d.parent_id FROM departments d WHERE ${where} ORDER BY d.name`, place.executive ? [] : place.departmentIds);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const since = monthStart.toISOString().slice(0, 10);
  const result = [];
  for (const department of departments) {
    const id = Number(department.id);
    const reports = await query<RowDataPacket[]>(
      pool,
      `SELECT period_type, COUNT(*) AS total FROM department_reports WHERE department_id = ? AND status IN ('submitted', 'reviewed') AND period_start >= ? GROUP BY period_type`,
      [id, since],
    );
    const targets = await query<RowDataPacket[]>(pool, `SELECT target_value, actual_value, status FROM department_targets WHERE department_id = ? AND status <> 'cancelled'`, [id]);
    const active = targets.filter((row) => row.status === 'active');
    const progress = active.length === 0 ? null
      : Math.round((active.reduce((sum, row) => sum + Math.min(1.5, Number(row.target_value) > 0 ? Number(row.actual_value) / Number(row.target_value) : 0), 0) / active.length) * 1000) / 10;
    const openActions = await scalar(pool, `SELECT COUNT(*) FROM corrective_actions WHERE department_id = ? AND status IN ('open', 'responded', 'outstanding')`, [id]);
    const pendingReviews = await scalar(pool, `SELECT COUNT(*) FROM department_reports WHERE department_id = ? AND status = 'submitted'`, [id]);
    result.push({
      departmentId: id,
      departmentName: String(department.name),
      isHead: department.parent_id == null,
      reportsThisMonth: Object.fromEntries(reports.map((row) => [String(row.period_type), Number(row.total)])),
      pendingReviews,
      activeTargets: active.length,
      achievedTargets: targets.filter((row) => row.status === 'achieved').length,
      missedTargets: targets.filter((row) => row.status === 'missed').length,
      targetProgress: progress,
      openCorrectiveActions: openActions,
    });
  }
  return result;
}
