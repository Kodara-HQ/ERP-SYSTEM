import { Router } from 'express';
import type { RowDataPacket } from '../../database/rows';
import { z } from 'zod';
import { pool } from '../../database/pool';
import { query, scalar } from '../../database/query';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { approvalSummary } from '../approvals/approval.service';
import { hasPermission } from '../../services/access';
import { branchClause, departmentClause, recordVisibility, transactionClause } from '../../services/visibility';
import { personnelVisibility, requireWorkspace, workspaceAllows, workspaceGate } from '../../services/workspaces';
import { HttpError } from '../../utils/httpError';

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  module: z.string().trim().max(40).optional().default(''),
  entityType: z.string().trim().max(60).optional().default(''),
  search: z.string().trim().max(80).optional().default(''),
});

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission('audit.view'), requireWorkspace('administration'));

auditRouter.get('/', validate({ query: auditQuery }), asyncRoute(async (req, res) => {
  const parsed = req.query as unknown as z.infer<typeof auditQuery>;
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (parsed.module) {
    where.push('a.module = ?');
    params.push(parsed.module);
  }
  if (parsed.entityType) {
    where.push('a.entity_type = ?');
    params.push(parsed.entityType);
  }
  if (parsed.search) {
    where.push('(a.action LIKE ? OR a.entity_id = ? OR u.username LIKE ?)');
    params.push(`%${parsed.search}%`, parsed.search, `%${parsed.search}%`);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${whereSql}`, params);
  const offset = (parsed.page - 1) * parsed.pageSize;
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, u.username
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${whereSql}
     ORDER BY a.id DESC
     LIMIT ${parsed.pageSize} OFFSET ${offset}`,
    params,
  );
  res.json({
    data: rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id == null ? null : Number(row.user_id),
      username: row.username ?? null,
      action: row.action,
      module: row.module,
      entityType: row.entity_type,
      entityId: row.entity_id,
      previousValue: parseJson(row.previous_value),
      newValue: parseJson(row.new_value),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    })),
    meta: { page: parsed.page, pageSize: parsed.pageSize, total },
  });
}));

auditRouter.all('/:id', (_req, _res, next) => {
  next(new HttpError(405, 'Audit logs cannot be changed.', 'AUDIT_IMMUTABLE'));
});

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value ?? null;
}

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncRoute(async (req, res) => {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT id, title, body, notification_type, entity_type, entity_id, is_read, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.auth!.userId],
  );
  const unread = await scalar(pool, 'SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0', [req.auth!.userId]);
  res.json({
    data: rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      body: row.body,
      notificationType: row.notification_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
    })),
    meta: { unread },
  });
}));

notificationsRouter.post('/:id/read', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(422, 'Notification id is invalid.');
  }
  await pool.query('UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ?', [id, req.auth!.userId]);
  res.json({ data: { id, isRead: true } });
}));

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Company-wide approval requests for the last `months` calendar months, this month included.
 * Counts are by the month a request was submitted; the approved amount is by the month it was decided.
 */
export async function approvalTrend(months: number) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - index), 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month: key, label: `${monthNames[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`, approved: 0, rejected: 0, waiting: 0, approvedAmount: 0 };
  });
  const start = `${buckets[0].month}-01`;
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT status, amount, submitted_at, decided_at FROM approval_requests
     WHERE (submitted_at IS NOT NULL AND submitted_at >= ?) OR (decided_at IS NOT NULL AND decided_at >= ?)`,
    [start, start],
  );
  const monthOf = (value: unknown) => (value == null ? null : new Date(value as string).toISOString().slice(0, 7));
  const approvedStates = ['approved', 'processing', 'completed'];
  const waitingStates = ['submitted', 'pending_review', 'under_approval', 'returned_for_correction'];
  for (const row of rows) {
    const status = String(row.status);
    const submitted = buckets.find((bucket) => bucket.month === monthOf(row.submitted_at));
    if (submitted) {
      if (approvedStates.includes(status)) submitted.approved += 1;
      else if (status === 'rejected') submitted.rejected += 1;
      else if (waitingStates.includes(status)) submitted.waiting += 1;
    }
    const decided = buckets.find((bucket) => bucket.month === monthOf(row.decided_at));
    if (decided && approvedStates.includes(status)) decided.approvedAmount += Number(row.amount ?? 0);
  }
  return buckets.map((bucket) => ({ ...bucket, approvedAmount: Number(bucket.approvedAmount.toFixed(2)) }));
}

/** Posted income and expense for the last `months` calendar months, this month included, from the ledger. */
export async function financeTrend(months: number) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - index), 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month: key, label: `${monthNames[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`, incomeCents: 0, expenseCents: 0 };
  });
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT j.journal_date, a.account_type, l.debit, l.credit
     FROM journal_lines l
     JOIN journals j ON j.id = l.journal_id
     JOIN ledger_accounts a ON a.id = l.ledger_account_id
     WHERE a.account_type IN ('income', 'expense') AND j.journal_date >= ?`,
    [`${buckets[0].month}-01`],
  );
  const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
  for (const row of rows) {
    const date = row.journal_date instanceof Date ? row.journal_date : new Date(String(row.journal_date));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.find((item) => item.month === key);
    if (!bucket) continue;
    if (row.account_type === 'income') bucket.incomeCents += cents(row.credit) - cents(row.debit);
    else bucket.expenseCents += cents(row.debit) - cents(row.credit);
  }
  return buckets.map((bucket) => ({ month: bucket.month, label: bucket.label, income: bucket.incomeCents / 100, expense: bucket.expenseCents / 100 }));
}

/** Approved budgets for this calendar year against the expenses posted to those budget lines so far. */
async function budgetUse() {
  const year = new Date().getFullYear();
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT b.amount,
            COALESCE((
              SELECT SUM(l.debit - l.credit) FROM journal_lines l
              JOIN journals j ON j.id = l.journal_id
              WHERE l.ledger_account_id = b.ledger_account_id AND l.department_id = b.department_id
                AND j.journal_date BETWEEN ? AND ?
            ), 0) AS actual
     FROM budgets b WHERE b.status = 'approved' AND b.budget_year = ?`,
    [`${year}-01-01`, `${year}-12-31`, year],
  );
  return {
    year,
    budget: Number(rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)),
    spent: Number(rows.reduce((sum, row) => sum + Number(row.actual), 0).toFixed(2)),
  };
}

function lastMonths(months: number) {
  const now = new Date();
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - index), 1));
    return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, label: `${monthNames[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}` };
  });
}

function monthKey(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Outstanding money and this year's expenses by department, for the finance dashboard. */
async function financeDetail() {
  const year = new Date().getFullYear();
  const receivables = await query<RowDataPacket[]>(pool, `SELECT COALESCE(SUM(outstanding), 0) AS total FROM customer_invoices WHERE status = 'open'`);
  const payables = await query<RowDataPacket[]>(pool, `SELECT COALESCE(SUM(outstanding), 0) AS total FROM supplier_invoices WHERE journal_id IS NOT NULL`);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT d.name AS department, l.debit, l.credit
     FROM journal_lines l
     JOIN journals j ON j.id = l.journal_id
     JOIN ledger_accounts a ON a.id = l.ledger_account_id
     LEFT JOIN departments d ON d.id = l.department_id
     WHERE a.account_type = 'expense' AND j.journal_date BETWEEN ? AND ?`,
    [`${year}-01-01`, `${year}-12-31`],
  );
  const byDepartment = new Map<string, number>();
  for (const row of rows) {
    const name = row.department ? String(row.department) : 'Company-wide';
    byDepartment.set(name, (byDepartment.get(name) ?? 0) + Math.round(Number(row.debit) * 100) - Math.round(Number(row.credit) * 100));
  }
  return {
    year,
    receivables: Number(Number(receivables[0]?.total ?? 0).toFixed(2)),
    payables: Number(Number(payables[0]?.total ?? 0).toFixed(2)),
    expenseByDepartment: [...byDepartment.entries()]
      .map(([department, total]) => ({ department, amount: total / 100 }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Recorded activities and completed tasks by month, task completion by area, and what needs attention. */
async function operationsDetail() {
  const buckets = lastMonths(6).map((bucket) => ({ ...bucket, activities: 0, tasksDone: 0 }));
  const start = `${buckets[0].month}-01`;
  const activities = await query<RowDataPacket[]>(pool, 'SELECT activity_date, area FROM operational_activities WHERE activity_date >= ?', [start]);
  const tasks = await query<RowDataPacket[]>(pool, 'SELECT area, status, created_at FROM operational_tasks WHERE created_at >= ?', [start]);
  for (const row of activities) {
    const bucket = buckets.find((item) => item.month === monthKey(row.activity_date));
    if (bucket) bucket.activities += 1;
  }
  const areas = new Map<string, { total: number; done: number }>();
  for (const row of tasks) {
    const area = String(row.area);
    const entry = areas.get(area) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === 'done') {
      entry.done += 1;
      const bucket = buckets.find((item) => item.month === monthKey(row.created_at));
      if (bucket) bucket.tasksDone += 1;
    }
    areas.set(area, entry);
  }
  const todayKey = dayKey(new Date());
  const issues = await query<RowDataPacket[]>(
    pool,
    `SELECT id, title, severity, escalated FROM operational_issues WHERE status <> 'resolved'
     ORDER BY escalated DESC, CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC LIMIT 4`,
  );
  const lowStock = await query<RowDataPacket[]>(
    pool,
    `SELECT i.name FROM stock_items i
     WHERE i.status = 'active' AND i.reorder_level > 0
       AND (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b WHERE b.item_id = i.id) <= i.reorder_level
     ORDER BY i.name LIMIT 3`,
  );
  return {
    activitiesToday: activities.filter((row) => dayKey(row.activity_date) === todayKey).length,
    activitiesThisMonth: buckets[buckets.length - 1].activities,
    trend: buckets,
    areas: [...areas.entries()].map(([area, entry]) => ({ area, ...entry })),
    alerts: [
      ...issues.map((row) => ({ kind: 'issue', title: String(row.title), severity: String(row.severity), escalated: Boolean(Number(row.escalated)) })),
      ...lowStock.map((row) => ({ kind: 'stock', title: `Low stock: ${String(row.name)}`, severity: 'medium', escalated: false })),
    ],
  };
}

/** Attendance marked present and absent for each of the last seven days, and new hires this year. */
async function hrDetail() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return { day: dayKey(date), label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()], present: 0, absent: 0 };
  });
  const rows = await query<RowDataPacket[]>(pool, 'SELECT work_date, attendance_status FROM attendance_records WHERE work_date >= ?', [days[0].day]);
  for (const row of rows) {
    const bucket = days.find((item) => item.day === dayKey(row.work_date));
    if (!bucket) continue;
    if (row.attendance_status === 'present') bucket.present += 1;
    if (row.attendance_status === 'absent') bucket.absent += 1;
  }
  const year = new Date().getFullYear();
  return {
    attendance: days,
    hiredThisYear: await scalar(pool, `SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND hire_date >= ?`, [`${year}-01-01`]),
  };
}

/** Operational tasks per department over the last 90 days: how many there were and how many are done. */
async function departmentTasks() {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT d.name AS department,
            COUNT(t.id) AS total,
            SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
     FROM operational_tasks t
     JOIN departments d ON d.id = t.department_id
     WHERE t.created_at >= ?
     GROUP BY d.id, d.name`,
    [since],
  );
  return rows.map((row) => ({ department: String(row.department), total: Number(row.total), done: Number(row.done ?? 0) }));
}

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requirePermission('dashboard.view'));

dashboardRouter.get('/summary', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const visibility = await recordVisibility(auth);
  const personnel = await personnelVisibility(auth);
  const gate = await workspaceGate(auth);
  const summary: Record<string, unknown> = {};
  if (hasPermission(auth, 'employees.view') && workspaceAllows(gate, 'people')) {
    const people = departmentClause(personnel, 'ea.department_id');
    const confidential = hasPermission(auth, 'employees.view_confidential') ? '' : `AND e.confidentiality_level = 'standard'`;
    const row = await query<RowDataPacket[]>(
      pool,
      `SELECT
         SUM(CASE WHEN e.employment_status IN ('active', 'probation') THEN 1 ELSE 0 END) AS active_employees,
         SUM(CASE WHEN e.employment_status = 'probation' THEN 1 ELSE 0 END) AS probation,
         SUM(CASE WHEN e.employment_status = 'exited' THEN 1 ELSE 0 END) AS exited
       FROM employees e
       LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
       WHERE e.deleted_at IS NULL AND ${people.sql} ${confidential}`,
      people.params,
    );
    summary.employees = {
      active: Number(row[0]?.active_employees ?? 0),
      probation: Number(row[0]?.probation ?? 0),
      exited: Number(row[0]?.exited ?? 0),
    };
    if (hasPermission(auth, 'departments.view')) {
      const departments = departmentClause(personnel, 'd.id');
      const headcount = await query<RowDataPacket[]>(
        pool,
        `SELECT d.name AS department, COUNT(ea.id) AS headcount
         FROM departments d
         LEFT JOIN employee_assignments ea ON ea.department_id = d.id AND ea.is_primary = 1 AND ea.end_date IS NULL
         WHERE d.status = 'active' AND ${departments.sql}
         GROUP BY d.id, d.name
         ORDER BY d.name`,
        departments.params,
      );
      summary.headcountByDepartment = headcount.map((item) => ({
        department: String(item.department),
        headcount: Number(item.headcount),
      }));
    }
  }
  if (hasPermission(auth, 'departments.view') && workspaceAllows(gate, 'organisation')) {
    const departments = departmentClause(visibility, 'id');
    summary.departments = await scalar(pool, `SELECT COUNT(*) FROM departments WHERE status = 'active' AND ${departments.sql}`, departments.params);
  }
  if (hasPermission(auth, 'branches.view') && workspaceAllows(gate, 'organisation')) {
    const branches = branchClause(visibility, 'id');
    summary.branches = await scalar(pool, `SELECT COUNT(*) FROM branches WHERE status = 'active' AND ${branches.sql}`, branches.params);
  }
  if (hasPermission(auth, 'positions.view') && workspaceAllows(gate, 'organisation')) {
    const positions = departmentClause(visibility, 'department_id');
    summary.positions = await scalar(pool, `SELECT COUNT(*) FROM positions WHERE status = 'active' AND ${positions.sql}`, positions.params);
  }
  if (hasPermission(auth, 'users.view') && workspaceAllows(gate, 'administration')) {
    const users = await query<RowDataPacket[]>(
      pool,
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_users,
         SUM(CASE WHEN status = 'locked' THEN 1 ELSE 0 END) AS locked_users,
         SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled_users
       FROM users`,
    );
    summary.users = {
      active: Number(users[0]?.active_users ?? 0),
      locked: Number(users[0]?.locked_users ?? 0),
      disabled: Number(users[0]?.disabled_users ?? 0),
    };
  }
  if (hasPermission(auth, 'organisation.implement_change') && workspaceAllows(gate, 'organisation')) {
    summary.pendingChangeRequests = await scalar(pool, `SELECT COUNT(*) FROM organisational_change_requests WHERE status = 'submitted'`);
  }
  if (hasPermission(auth, 'approvals.view')) {
    summary.approvals = await approvalSummary(auth);
  }
  if (hasPermission(auth, 'hr.view') && workspaceAllows(gate, 'hr')) {
    summary.hr = {
      onLeaveToday: await scalar(
        pool,
        `SELECT COUNT(DISTINCT employee_id) FROM leave_requests
         WHERE status = 'approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`,
      ),
      openVacancies: await scalar(pool, `SELECT COUNT(*) FROM vacancies WHERE status = 'open'`),
      pendingLeave: await scalar(
        pool,
        `SELECT COUNT(*) FROM leave_requests lr
         LEFT JOIN employee_assignments ea ON ea.employee_id = lr.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
         WHERE lr.status = 'submitted' AND ${transactionClause(personnel, { department: 'ea.department_id', employee: 'lr.employee_id', user: 'lr.created_by' }).sql}`,
        transactionClause(personnel, { department: 'ea.department_id', employee: 'lr.employee_id', user: 'lr.created_by' }).params,
      ),
    };
    // HR readers who cannot open employee records (the CEO) still get the headcount HR reports already show them.
    if (!summary.employees) {
      const departments = departmentClause(personnel, 'd.id');
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
      summary.headcountByDepartment = headcount.map((item) => ({ department: String(item.department), headcount: Number(item.headcount) }));
      summary.headcount = headcount.reduce((sum, item) => sum + Number(item.headcount), 0);
    }
    summary.hrDetail = await hrDetail();
  }
  if (hasPermission(auth, 'leave.apply') && auth.employeeId) {
    summary.myLeave = await scalar(
      pool,
      `SELECT COUNT(*) FROM leave_requests WHERE employee_id = ? AND status IN ('submitted', 'returned')`,
      [auth.employeeId],
    );
  }
  if (hasPermission(auth, 'procurement.view') && workspaceAllows(gate, 'procurement')) {
    const requisitions = transactionClause(visibility, { department: 'department_id', user: 'requester_user_id' });
    const orders = transactionClause(visibility, { department: 'r.department_id', user: 'r.requester_user_id' });
    summary.procurement = {
      pendingRequisitions: await scalar(pool, `SELECT COUNT(*) FROM purchase_requisitions WHERE status = 'submitted' AND ${requisitions.sql}`, requisitions.params),
      openOrders: await scalar(
        pool,
        `SELECT COUNT(*) FROM purchase_orders o JOIN purchase_requisitions r ON r.id = o.requisition_id
         WHERE o.status IN ('issued', 'partial') AND ${orders.sql}`,
        orders.params,
      ),
    };
  }
  if (hasPermission(auth, 'inventory.view') && workspaceAllows(gate, 'inventory')) {
    summary.inventory = {
      belowReorder: await scalar(
        pool,
        `SELECT COUNT(*) FROM stock_items i
         WHERE i.status = 'active' AND i.reorder_level > 0
           AND (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b WHERE b.item_id = i.id) <= i.reorder_level`,
      ),
    };
  }
  if (hasPermission(auth, 'finance.view') && workspaceAllows(gate, 'finance')) {
    summary.finance = {
      pendingPayments: await scalar(
        pool,
        `SELECT COUNT(*) FROM payment_requests WHERE status = 'submitted' AND ${transactionClause(visibility, { department: 'department_id', user: 'requester_user_id' }).sql}`,
        transactionClause(visibility, { department: 'department_id', user: 'requester_user_id' }).params,
      ),
      openPayables: await scalar(pool, `SELECT COUNT(*) FROM supplier_invoices WHERE journal_id IS NOT NULL AND outstanding > 0`),
      openReceivables: await scalar(pool, `SELECT COUNT(*) FROM customer_invoices WHERE status = 'open' AND outstanding > 0`),
    };
    summary.financeTrend = await financeTrend(6);
    summary.financeDetail = await financeDetail();
  }
  if (hasPermission(auth, 'payroll.view') || hasPermission(auth, 'payroll.manage') || hasPermission(auth, 'payroll.verify') || hasPermission(auth, 'payroll.pay')) {
    summary.payroll = {
      withAccounts: await scalar(pool, `SELECT COUNT(*) FROM payroll_runs WHERE status IN ('submitted_to_accounts', 'under_accounts_review')`),
      withCeo: await scalar(pool, `SELECT COUNT(*) FROM payroll_runs WHERE status = 'submitted_for_ceo'`),
      awaitingPayment: await scalar(pool, `SELECT COUNT(*) FROM payroll_runs WHERE status IN ('ready_for_payment', 'partially_paid', 'payment_failed')`),
      failedPayments: await scalar(
        pool,
        `SELECT COUNT(*) FROM salary_payments failed
         WHERE failed.status = 'failed'
           AND NOT EXISTS (SELECT 1 FROM salary_payments paid WHERE paid.payroll_line_id = failed.payroll_line_id AND paid.status = 'paid')`,
      ),
    };
  }
  if ((hasPermission(auth, 'legal.view_confidential') || hasPermission(auth, 'legal.manage')) && workspaceAllows(gate, 'legal')) {
    summary.legal = {
      pendingReviews: await scalar(pool, `SELECT COUNT(*) FROM legal_documents WHERE status IN ('in_review', 'awaiting_ceo')`),
      expiring: await scalar(pool, `SELECT COUNT(*) FROM legal_documents WHERE expiry_on IS NOT NULL AND expiry_on <= DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY) AND status NOT IN ('draft', 'rejected')`),
    };
  }
  if (hasPermission(auth, 'operations.view') && workspaceAllows(gate, 'operations')) {
    summary.operations = {
      openTasks: await scalar(pool, `SELECT COUNT(*) FROM operational_tasks WHERE status <> 'done'`),
      openIssues: await scalar(pool, `SELECT COUNT(*) FROM operational_issues WHERE status <> 'resolved'`),
      escalatedIssues: await scalar(pool, `SELECT COUNT(*) FROM operational_issues WHERE escalated = 1 AND status <> 'resolved'`),
    };
    summary.operationsDetail = await operationsDetail();
  }
  if (hasPermission(auth, 'executive.review')) {
    summary.executive = {
      openReviews: await scalar(pool, `SELECT COUNT(*) FROM departmental_reviews WHERE status = 'open'`),
      openActions: await scalar(pool, `SELECT COUNT(*) FROM corrective_actions WHERE status IN ('open', 'responded', 'outstanding')`),
      pendingReports: await scalar(pool, `SELECT COUNT(*) FROM payroll_runs WHERE status = 'submitted_for_ceo'`)
        + await scalar(pool, `SELECT COUNT(*) FROM legal_documents WHERE status = 'awaiting_ceo'`),
    };
    summary.approvalTrend = await approvalTrend(6);
    summary.departmentTasks = await departmentTasks();
    if (hasPermission(auth, 'finance.view')) {
      summary.financeTrend ??= await financeTrend(6);
      summary.budgetUse = await budgetUse();
    }
  }
  if (summary.executive || summary.finance) {
    const company = await query<RowDataPacket[]>(pool, 'SELECT currency_code FROM companies ORDER BY id LIMIT 1');
    summary.currencyCode = company[0]?.currency_code ? String(company[0].currency_code) : '';
  }
  res.json({ data: summary });
}));

const searchQuery = z.object({ q: z.string().trim().min(2).max(80) });

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get('/', validate({ query: searchQuery }), asyncRoute(async (req, res) => {
  const term = `%${String((req.query as { q: string }).q).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const visibility = await recordVisibility(req.auth!);
  const gate = await workspaceGate(req.auth!);
  const result: Record<string, unknown[]> = {};
  if (hasPermission(req.auth!, 'employees.view') && workspaceAllows(gate, 'people')) {
    const confidential = hasPermission(req.auth!, 'employees.view_confidential');
    const people = departmentClause(visibility, 'ea.department_id');
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT e.id, e.employee_number, e.first_name, e.last_name
       FROM employees e
       LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
       WHERE e.deleted_at IS NULL
         AND (e.employee_number LIKE ? ESCAPE '\\\\' OR e.first_name LIKE ? ESCAPE '\\\\' OR e.last_name LIKE ? ESCAPE '\\\\')
         AND (e.confidentiality_level = 'standard' OR ? = 1)
         AND ${people.sql}
       ORDER BY e.last_name LIMIT 8`,
      [term, term, term, confidential ? 1 : 0, ...people.params],
    );
    result.employees = rows.map((row) => ({
      id: Number(row.id),
      label: `${row.employee_number} · ${row.first_name} ${row.last_name}`,
    }));
  }
  if (hasPermission(req.auth!, 'departments.view') && workspaceAllows(gate, 'organisation')) {
    const departments = departmentClause(visibility, 'id');
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, code, name FROM departments WHERE status = 'active' AND (code LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\') AND ${departments.sql} ORDER BY name LIMIT 8`,
      [term, term, ...departments.params],
    );
    result.departments = rows.map((row) => ({ id: Number(row.id), label: `${row.code} · ${row.name}` }));
  }
  if (hasPermission(req.auth!, 'approvals.view')) {
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, reference_number, title FROM approval_requests
       WHERE (reference_number LIKE ? ESCAPE '\\\\' OR title LIKE ? ESCAPE '\\\\')
         AND (status <> 'draft' OR requester_user_id = ?)
       ORDER BY created_at DESC LIMIT 8`,
      [term, term, req.auth!.userId],
    );
    result.approvals = rows.map((row) => ({ id: Number(row.id), label: `${row.reference_number} · ${row.title}` }));
  }
  if (hasPermission(req.auth!, 'hr.view') && workspaceAllows(gate, 'hr')) {
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, title, status FROM vacancies WHERE title LIKE ? ESCAPE '\\\\' ORDER BY created_at DESC LIMIT 8`,
      [term],
    );
    result.vacancies = rows.map((row) => ({ id: Number(row.id), label: `${row.title} · ${row.status}` }));
  }
  if (hasPermission(req.auth!, 'procurement.view') && workspaceAllows(gate, 'procurement')) {
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, reference_number, name FROM suppliers
       WHERE reference_number LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\'
       ORDER BY name LIMIT 8`,
      [term, term],
    );
    result.suppliers = rows.map((row) => ({ id: Number(row.id), label: `${row.reference_number} · ${row.name}` }));
  }
  if (hasPermission(req.auth!, 'inventory.view') && workspaceAllows(gate, 'inventory')) {
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, sku, name FROM stock_items
       WHERE sku LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\'
       ORDER BY name LIMIT 8`,
      [term, term],
    );
    result.items = rows.map((row) => ({ id: Number(row.id), label: `${row.sku} · ${row.name}` }));
  }
  if (hasPermission(req.auth!, 'finance.view') && workspaceAllows(gate, 'finance')) {
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, code, name FROM ledger_accounts
       WHERE code LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\'
       ORDER BY code LIMIT 8`,
      [term, term],
    );
    result.accounts = rows.map((row) => ({ id: Number(row.id), label: `${row.code} · ${row.name}` }));
  }
  if (hasPermission(req.auth!, 'positions.view') && workspaceAllows(gate, 'organisation')) {
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, code, title FROM positions WHERE status = 'active' AND (code LIKE ? ESCAPE '\\\\' OR title LIKE ? ESCAPE '\\\\') AND ${departmentClause(visibility, 'department_id').sql} ORDER BY title LIMIT 8`,
      [term, term, ...departmentClause(visibility, 'department_id').params],
    );
    result.positions = rows.map((row) => ({ id: Number(row.id), label: `${row.code} · ${row.title}` }));
  }
  res.json({ data: result });
}));
