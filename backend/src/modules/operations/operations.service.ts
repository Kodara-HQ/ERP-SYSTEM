import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasFinalBusinessAuthority, hasPermission, isTechnicalAdmin } from '../../services/access';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import { workspaceAllows, workspaceGate } from '../../services/workspaces';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };
type Area = 'daily' | 'procurement' | 'loading' | 'farm' | 'haulage' | 'inventory' | 'other';

async function assertView(auth: AuthContext) {
  if (isTechnicalAdmin(auth) || !hasPermission(auth, 'operations.view')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  const gate = await workspaceGate(auth);
  if (!hasFinalBusinessAuthority(auth) && !workspaceAllows(gate, 'operations')) {
    throw new HttpError(403, 'This workspace is outside your department.', 'WORKSPACE_DENIED');
  }
}

async function assertManage(auth: AuthContext) {
  await assertView(auth);
  if (!hasPermission(auth, 'operations.manage')) throw new HttpError(403, 'Only the operations manager can change the daily register.', 'FORBIDDEN');
}

async function departmentOf(auth: AuthContext) {
  if (!auth.employeeId) throw new HttpError(422, 'Record this against your department assignment.', 'NO_DEPARTMENT');
  const row = await queryOne<RowDataPacket>(
    pool,
    'SELECT department_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL',
    [auth.employeeId],
  );
  if (!row?.department_id) throw new HttpError(422, 'Record this against your department assignment.', 'NO_DEPARTMENT');
  return Number(row.department_id);
}

export async function operationsOverview(auth: AuthContext) {
  await assertView(auth);
  const areas = await query<RowDataPacket[]>(
    pool,
    `SELECT area, COUNT(*) AS total FROM operational_activities WHERE activity_date >= DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY) GROUP BY area`,
  );
  return {
    openTasks: await scalar(pool, `SELECT COUNT(*) FROM operational_tasks WHERE status <> 'done'`),
    openIssues: await scalar(pool, `SELECT COUNT(*) FROM operational_issues WHERE status <> 'resolved'`),
    escalatedIssues: await scalar(pool, `SELECT COUNT(*) FROM operational_issues WHERE escalated = 1 AND status <> 'resolved'`),
    pendingRequisitions: await scalar(pool, `SELECT COUNT(*) FROM purchase_requisitions WHERE status = 'submitted'`),
    openOrders: await scalar(pool, `SELECT COUNT(*) FROM purchase_orders WHERE status IN ('issued', 'partial')`),
    belowReorder: await scalar(
      pool,
      `SELECT COUNT(*) FROM (
         SELECT i.id FROM stock_items i
         LEFT JOIN stock_balances b ON b.item_id = i.id
         WHERE i.status = 'active' AND i.reorder_level > 0
         GROUP BY i.id, i.reorder_level
         HAVING COALESCE(SUM(b.quantity), 0) <= i.reorder_level
       ) stock`,
    ),
    recentAreas: areas.map((row) => ({ area: String(row.area), total: Number(row.total) })),
  };
}

export async function listActivities(auth: AuthContext) {
  await assertView(auth);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, d.name AS department_name FROM operational_activities a JOIN departments d ON d.id = a.department_id ORDER BY a.activity_date DESC, a.id DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), activityDate: String(row.activity_date).slice(0, 10),
    area: String(row.area), department: String(row.department_name), summary: String(row.summary),
  }));
}

export async function createActivity(auth: AuthContext, input: { activityDate: string; area: Area; summary: string }, actor: Actor) {
  await assertManage(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const departmentId = await departmentOf(auth);
    const reference = await nextReference(connection, 'operational_activity', 'operational_activity_prefix');
    const created = await execute(
      connection,
      `INSERT INTO operational_activities (company_id, reference_number, activity_date, area, department_id, summary, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.activityDate, input.area, departmentId, input.summary, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'operations.activity', module: 'operations', entityType: 'operational_activity', entityId: created.insertId,
      newValue: { reference, area: input.area }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}

export async function listTasks(auth: AuthContext) {
  await assertView(auth);
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM operational_tasks ORDER BY id DESC LIMIT 200');
  return rows.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), title: String(row.title), area: String(row.area),
    dueOn: row.due_on == null ? null : String(row.due_on).slice(0, 10), status: String(row.status),
    assignedToUserId: row.assigned_to_user_id == null ? null : Number(row.assigned_to_user_id),
  }));
}

export async function createTask(auth: AuthContext, input: { title: string; area: Area; dueOn?: string; notes?: string; assignedToUserId?: number }, actor: Actor) {
  await assertManage(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const departmentId = await departmentOf(auth);
    const reference = await nextReference(connection, 'operational_task', 'operational_task_prefix');
    const created = await execute(
      connection,
      `INSERT INTO operational_tasks (company_id, reference_number, title, area, department_id, due_on, assigned_to_user_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.title, input.area, departmentId, input.dueOn ?? null, input.assignedToUserId ?? null, input.notes ?? null, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'operations.task', module: 'operations', entityType: 'operational_task', entityId: created.insertId,
      newValue: { reference, title: input.title }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}

export async function setTaskStatus(auth: AuthContext, id: number, status: 'open' | 'in_progress' | 'done', actor: Actor) {
  await assertManage(auth);
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id FROM operational_tasks WHERE id = ?', [id]);
  if (!row) throw notFound('Operational task');
  await execute(pool, 'UPDATE operational_tasks SET status = ? WHERE id = ?', [status, id]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'operations.task_status', module: 'operations', entityType: 'operational_task', entityId: id,
    newValue: { status }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id, status };
}

export async function listIssues(auth: AuthContext) {
  await assertView(auth);
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM operational_issues ORDER BY escalated DESC, id DESC LIMIT 200');
  return rows.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), title: String(row.title), description: String(row.description),
    area: String(row.area), severity: String(row.severity), status: String(row.status), escalated: Boolean(row.escalated),
  }));
}

export async function createIssue(auth: AuthContext, input: { title: string; description: string; area: Area; severity: 'low' | 'medium' | 'high' }, actor: Actor) {
  await assertManage(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const departmentId = await departmentOf(auth);
    const reference = await nextReference(connection, 'operational_issue', 'operational_issue_prefix');
    const created = await execute(
      connection,
      `INSERT INTO operational_issues (company_id, reference_number, title, description, area, department_id, severity, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.title, input.description, input.area, departmentId, input.severity, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'operations.issue', module: 'operations', entityType: 'operational_issue', entityId: created.insertId,
      newValue: { reference, severity: input.severity }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}

export async function updateIssue(auth: AuthContext, id: number, input: { status?: 'open' | 'monitoring' | 'resolved'; escalated?: boolean }, actor: Actor) {
  await assertManage(auth);
  const row = await queryOne<RowDataPacket>(pool, 'SELECT status, escalated FROM operational_issues WHERE id = ?', [id]);
  if (!row) throw notFound('Operational issue');
  const status = input.status ?? String(row.status);
  const escalated = input.escalated == null ? Number(row.escalated) : input.escalated ? 1 : 0;
  await execute(pool, 'UPDATE operational_issues SET status = ?, escalated = ? WHERE id = ?', [status, escalated, id]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'operations.issue_update', module: 'operations', entityType: 'operational_issue', entityId: id,
    newValue: { status, escalated: Boolean(escalated) }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id, status, escalated: Boolean(escalated) };
}
