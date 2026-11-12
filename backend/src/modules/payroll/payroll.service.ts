import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasFinalBusinessAuthority, hasPermission, isTechnicalAdmin } from '../../services/access';
import { requireCompanyId, nextReference } from '../../services/companyContext';
import { workspaceAllows, workspaceGate } from '../../services/workspaces';
import { createRequest, decideRequest, resubmitRequest } from '../approvals/approval.service';
import { onApprovalChange, type ApprovalChange } from '../approvals/approval.hooks';
import { postJournal } from '../finance/finance.service';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

const editable = new Set(['draft', 'returned_to_hr']);
const payable = new Set(['ready_for_payment', 'partially_paid', 'payment_failed']);

function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

function dollars(value: number): number {
  return value / 100;
}

async function gateFor(auth: AuthContext) {
  return workspaceGate(auth);
}

async function assertReader(auth: AuthContext) {
  if (isTechnicalAdmin(auth)) {
    throw new HttpError(403, 'Payroll is outside technical administration.', 'FORBIDDEN');
  }
  const gate = await gateFor(auth);
  const canRead = hasPermission(auth, 'payroll.view') || hasPermission(auth, 'payroll.manage') || hasPermission(auth, 'payroll.verify') || hasPermission(auth, 'payroll.pay');
  if (!canRead) throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  if (hasFinalBusinessAuthority(auth)) return;
  if (hasPermission(auth, 'payroll.manage') && workspaceAllows(gate, 'hr')) return;
  if ((hasPermission(auth, 'payroll.verify') || hasPermission(auth, 'payroll.pay')) && workspaceAllows(gate, 'finance')) return;
  throw new HttpError(403, 'This workspace is outside your department.', 'WORKSPACE_DENIED');
}

async function assertPrepare(auth: AuthContext) {
  await assertReader(auth);
  const gate = await gateFor(auth);
  if (!hasPermission(auth, 'payroll.manage') || !workspaceAllows(gate, 'hr')) {
    throw new HttpError(403, 'Only HR can prepare payroll.', 'FORBIDDEN');
  }
}

async function assertVerify(auth: AuthContext) {
  await assertReader(auth);
  const gate = await gateFor(auth);
  if (!hasPermission(auth, 'payroll.verify') || !workspaceAllows(gate, 'finance')) {
    throw new HttpError(403, 'Only accounts can review payroll.', 'FORBIDDEN');
  }
}

async function assertPay(auth: AuthContext) {
  await assertReader(auth);
  const gate = await gateFor(auth);
  if (!hasPermission(auth, 'payroll.pay') || !workspaceAllows(gate, 'finance')) {
    throw new HttpError(403, 'Only accounts can pay salaries.', 'FORBIDDEN');
  }
}

async function addEvent(db: Db, runId: number, userId: number, action: string, fromStatus: string | null, toStatus: string, comment?: string | null) {
  await execute(
    db,
    `INSERT INTO payroll_events (payroll_run_id, action, from_status, to_status, comment, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, action, fromStatus, toStatus, comment ?? null, userId],
  );
}

async function loadRun(db: Db, id: number) {
  const row = await queryOne<RowDataPacket>(db, 'SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!row) throw notFound('Payroll');
  return row;
}

function mapRun(row: RowDataPacket) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    periodYear: Number(row.period_year),
    periodMonth: Number(row.period_month),
    status: String(row.status),
    employeeCount: Number(row.employee_count),
    totalBasic: Number(row.total_basic),
    totalAllowances: Number(row.total_allowances),
    totalDeductions: Number(row.total_deductions),
    totalNet: Number(row.total_net),
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
  };
}

async function refreshTotals(db: Db, runId: number) {
  const totals = await queryOne<RowDataPacket>(
    db,
    `SELECT COUNT(*) AS employees, COALESCE(SUM(basic_salary), 0) AS basic, COALESCE(SUM(allowances), 0) AS allowances,
            COALESCE(SUM(deductions), 0) AS deductions, COALESCE(SUM(net_pay), 0) AS net
     FROM payroll_lines WHERE payroll_run_id = ?`,
    [runId],
  );
  await execute(
    db,
    `UPDATE payroll_runs SET employee_count = ?, total_basic = ?, total_allowances = ?, total_deductions = ?, total_net = ? WHERE id = ?`,
    [Number(totals?.employees ?? 0), Number(totals?.basic ?? 0), Number(totals?.allowances ?? 0), Number(totals?.deductions ?? 0), Number(totals?.net ?? 0), runId],
  );
}

function netOf(basic: number, allowances: number, deductions: number) {
  const net = cents(basic) + cents(allowances) - cents(deductions);
  if (net < 0) throw new HttpError(422, 'Deductions cannot be more than salary and allowances.', 'NEGATIVE_NET');
  return dollars(net);
}

export async function listCompensation(auth: AuthContext) {
  await assertPrepare(auth);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT e.id, e.employee_number, e.first_name, e.last_name, d.name AS department_name,
            c.basic_salary, c.allowances, c.deductions, c.effective_from
     FROM employees e
     JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     LEFT JOIN departments d ON d.id = ea.department_id
     LEFT JOIN employee_compensation c ON c.employee_id = e.id AND c.status = 'active'
     WHERE e.deleted_at IS NULL AND e.employment_status IN ('active', 'probation')
     ORDER BY e.last_name, e.first_name`,
  );
  return rows.map((row) => ({
    employeeId: Number(row.id),
    employeeNumber: String(row.employee_number),
    employeeName: `${row.first_name} ${row.last_name}`,
    department: row.department_name == null ? null : String(row.department_name),
    basicSalary: row.basic_salary == null ? null : Number(row.basic_salary),
    allowances: row.allowances == null ? null : Number(row.allowances),
    deductions: row.deductions == null ? null : Number(row.deductions),
    effectiveFrom: row.effective_from == null ? null : String(row.effective_from).slice(0, 10),
  }));
}

export async function saveCompensation(auth: AuthContext, input: {
  employeeId: number;
  effectiveFrom: string;
  basicSalary: number;
  allowances: number;
  deductions: number;
  notes?: string;
}, actor: Actor) {
  await assertPrepare(auth);
  netOf(input.basicSalary, input.allowances, input.deductions);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const employee = await queryOne<RowDataPacket>(
      connection,
      `SELECT id FROM employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND employment_status IN ('active', 'probation')`,
      [input.employeeId, companyId],
    );
    if (!employee) throw notFound('Employee');
    await execute(connection, `UPDATE employee_compensation SET status = 'inactive' WHERE employee_id = ? AND status = 'active'`, [input.employeeId]);
    const created = await execute(
      connection,
      `INSERT INTO employee_compensation (company_id, employee_id, effective_from, basic_salary, allowances, deductions, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, input.employeeId, input.effectiveFrom, input.basicSalary, input.allowances, input.deductions, input.notes ?? null, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.compensation', module: 'payroll', entityType: 'employee_compensation', entityId: created.insertId,
      newValue: { employeeId: input.employeeId, basicSalary: input.basicSalary, allowances: input.allowances, deductions: input.deductions },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId };
  });
}

export async function listPayroll(auth: AuthContext) {
  await assertReader(auth);
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM payroll_runs ORDER BY period_year DESC, period_month DESC, id DESC LIMIT 100');
  return rows.map(mapRun);
}

export async function getPayroll(auth: AuthContext, id: number) {
  await assertReader(auth);
  const run = await loadRun(pool, id);
  const lines = await query<RowDataPacket[]>(
    pool,
    `SELECT l.*, e.employee_number, e.first_name, e.last_name, d.name AS department_name
     FROM payroll_lines l
     JOIN employees e ON e.id = l.employee_id
     LEFT JOIN departments d ON d.id = l.department_id
     WHERE l.payroll_run_id = ?
     ORDER BY e.last_name, e.first_name`,
    [id],
  );
  const events = await query<RowDataPacket[]>(
    pool,
    `SELECT ev.*, u.username FROM payroll_events ev JOIN users u ON u.id = ev.user_id WHERE ev.payroll_run_id = ? ORDER BY ev.id`,
    [id],
  );
  const payments = await query<RowDataPacket[]>(
    pool,
    `SELECT * FROM salary_payments WHERE payroll_run_id = ? ORDER BY id`,
    [id],
  );
  const departments = new Map<string, number>();
  for (const line of lines) {
    const name = line.department_name == null ? 'Unassigned' : String(line.department_name);
    departments.set(name, (departments.get(name) ?? 0) + cents(line.net_pay));
  }
  return {
    ...mapRun(run),
    lines: lines.map((line) => ({
      id: Number(line.id),
      employeeId: Number(line.employee_id),
      employeeNumber: String(line.employee_number),
      employeeName: `${line.first_name} ${line.last_name}`,
      department: line.department_name == null ? null : String(line.department_name),
      basicSalary: Number(line.basic_salary),
      allowances: Number(line.allowances),
      deductions: Number(line.deductions),
      netPay: Number(line.net_pay),
    })),
    departments: [...departments].map(([department, net]) => ({ department, net: dollars(net) })),
    events: events.map((event) => ({
      id: Number(event.id),
      action: String(event.action),
      fromStatus: event.from_status == null ? null : String(event.from_status),
      toStatus: String(event.to_status),
      comment: event.comment == null ? null : String(event.comment),
      actor: String(event.username),
      createdAt: event.created_at,
    })),
    payments: payments.map((payment) => ({
      id: Number(payment.id),
      referenceNumber: String(payment.reference_number),
      lineId: Number(payment.payroll_line_id),
      employeeId: Number(payment.employee_id),
      amount: Number(payment.amount),
      status: String(payment.status),
      paymentDate: payment.payment_date == null ? null : String(payment.payment_date).slice(0, 10),
      journalId: payment.journal_id == null ? null : Number(payment.journal_id),
      failureReason: payment.failure_reason == null ? null : String(payment.failure_reason),
    })),
  };
}

export async function createPayroll(auth: AuthContext, input: { year: number; month: number }, actor: Actor) {
  await assertPrepare(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const open = await queryOne<RowDataPacket>(
      connection,
      `SELECT id FROM payroll_runs WHERE company_id = ? AND period_year = ? AND period_month = ? AND status NOT IN ('rejected', 'superseded')`,
      [companyId, input.year, input.month],
    );
    if (open) throw new HttpError(409, 'That payroll period is already open or completed.', 'DUPLICATE_PAYROLL');
    const people = await query<RowDataPacket[]>(
      connection,
      `SELECT e.id AS employee_id, ea.department_id, c.basic_salary, c.allowances, c.deductions
       FROM employees e
       JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
       JOIN employee_compensation c ON c.employee_id = e.id AND c.status = 'active'
       WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.employment_status IN ('active', 'probation')`,
      [companyId],
    );
    if (people.length === 0) throw new HttpError(422, 'Record at least one active salary before preparing payroll.', 'NO_SALARIES');
    const reference = await nextReference(connection, 'payroll_run', 'payroll_run_prefix');
    const created = await execute(
      connection,
      `INSERT INTO payroll_runs (company_id, reference_number, period_year, period_month, status, prepared_by)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
      [companyId, reference, input.year, input.month, auth.userId],
    );
    for (const person of people) {
      const net = netOf(Number(person.basic_salary), Number(person.allowances), Number(person.deductions));
      await execute(
        connection,
        `INSERT INTO payroll_lines (payroll_run_id, employee_id, department_id, basic_salary, allowances, deductions, net_pay)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, person.employee_id, person.department_id, person.basic_salary, person.allowances, person.deductions, net],
      );
    }
    await refreshTotals(connection, created.insertId);
    await addEvent(connection, created.insertId, auth.userId, 'prepare', null, 'draft', null);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.prepare', module: 'payroll', entityType: 'payroll_run', entityId: created.insertId,
      newValue: { reference, year: input.year, month: input.month, employees: people.length },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [created.insertId]))!);
  });
}

export async function updatePayrollLines(auth: AuthContext, id: number, lines: Array<{ id: number; basicSalary: number; allowances: number; deductions: number }>, actor: Actor) {
  await assertPrepare(auth);
  return withTransaction(async (connection) => {
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (!editable.has(String(run.status))) throw new HttpError(409, 'Submitted payroll figures can only change through a return or a correction.', 'PAYROLL_LOCKED');
    for (const line of lines) {
      const existing = await queryOne<RowDataPacket>(connection, 'SELECT id FROM payroll_lines WHERE id = ? AND payroll_run_id = ?', [line.id, id]);
      if (!existing) throw notFound('Payroll line');
      const net = netOf(line.basicSalary, line.allowances, line.deductions);
      await execute(
        connection,
        'UPDATE payroll_lines SET basic_salary = ?, allowances = ?, deductions = ?, net_pay = ? WHERE id = ?',
        [line.basicSalary, line.allowances, line.deductions, net, line.id],
      );
    }
    await refreshTotals(connection, id);
    await addEvent(connection, id, auth.userId, 'correct', String(run.status), String(run.status), null);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.correct', module: 'payroll', entityType: 'payroll_run', entityId: id,
      newValue: { lines: lines.length }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [id]))!);
  });
}

export async function submitPayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertPrepare(auth);
  return withTransaction(async (connection) => {
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (String(run.status) !== 'draft') throw new HttpError(409, 'Only a draft payroll can be submitted.', 'NOT_DRAFT');
    if (Number(run.employee_count) === 0 || cents(run.total_net) <= 0) throw new HttpError(422, 'Payroll needs at least one payable salary.', 'EMPTY_PAYROLL');
    const approval = await createRequest(auth, {
      workflowCode: 'PAYROLL',
      title: `Payroll ${run.reference_number}`,
      details: `Salaries for ${run.period_year}-${String(run.period_month).padStart(2, '0')}`,
      amount: Number(run.total_net),
      submit: true,
      sourceType: 'payroll_run',
      sourceId: id,
    }, actor, connection);
    await execute(connection, `UPDATE payroll_runs SET approval_request_id = ?, status = 'submitted_to_accounts' WHERE id = ?`, [approval.id, id]);
    await addEvent(connection, id, auth.userId, 'submit', 'draft', 'submitted_to_accounts', null);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.submit', module: 'payroll', entityType: 'payroll_run', entityId: id,
      newValue: { approvalId: approval.id, total: Number(run.total_net) }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [id]))!);
  });
}

export async function resubmitPayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertPrepare(auth);
  const run = await loadRun(pool, id);
  if (String(run.status) !== 'returned_to_hr') throw new HttpError(409, 'Only payroll returned by accounts can be resubmitted.', 'NOT_RETURNED');
  if (!run.approval_request_id) throw new HttpError(409, 'This payroll has no approval route.', 'NO_APPROVAL');
  await execute(pool, 'UPDATE approval_requests SET amount = ? WHERE id = ?', [run.total_net, run.approval_request_id]);
  await resubmitRequest(auth, Number(run.approval_request_id), actor);
  return getPayroll(auth, id);
}

export async function reviewPayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertVerify(auth);
  return withTransaction(async (connection) => {
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (String(run.status) !== 'submitted_to_accounts') throw new HttpError(409, 'This payroll is not waiting for accounts review.', 'NOT_WAITING');
    await execute(connection, `UPDATE payroll_runs SET status = 'under_accounts_review' WHERE id = ?`, [id]);
    await addEvent(connection, id, auth.userId, 'review', 'submitted_to_accounts', 'under_accounts_review', null);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.review', module: 'payroll', entityType: 'payroll_run', entityId: id,
      newValue: { reference: run.reference_number }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [id]))!);
  });
}

export async function forwardPayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertVerify(auth);
  const run = await loadRun(pool, id);
  if (String(run.status) !== 'under_accounts_review') throw new HttpError(409, 'Review the payroll before sending it to the CEO.', 'NOT_REVIEWED');
  if (!run.approval_request_id) throw new HttpError(409, 'This payroll has no approval route.', 'NO_APPROVAL');
  await decideRequest(auth, Number(run.approval_request_id), { action: 'approve', comment: 'Accounts verified the payroll.' }, actor);
  return getPayroll(auth, id);
}

export async function returnPayroll(auth: AuthContext, id: number, comment: string, actor: Actor) {
  await assertVerify(auth);
  const run = await loadRun(pool, id);
  if (!['submitted_to_accounts', 'under_accounts_review'].includes(String(run.status))) {
    throw new HttpError(409, 'This payroll is not with accounts.', 'NOT_WAITING');
  }
  if (!run.approval_request_id) throw new HttpError(409, 'This payroll has no approval route.', 'NO_APPROVAL');
  await decideRequest(auth, Number(run.approval_request_id), { action: 'return', comment }, actor);
  return getPayroll(auth, id);
}

export async function decidePayroll(auth: AuthContext, id: number, action: 'approve' | 'reject' | 'return', comment: string, actor: Actor) {
  await assertReader(auth);
  if (!hasFinalBusinessAuthority(auth)) throw new HttpError(403, 'Final payroll approval stays with the CEO.', 'FORBIDDEN');
  const run = await loadRun(pool, id);
  if (String(run.status) !== 'submitted_for_ceo') throw new HttpError(409, 'This payroll is not waiting for the CEO.', 'NOT_WAITING');
  if (!run.approval_request_id) throw new HttpError(409, 'This payroll has no approval route.', 'NO_APPROVAL');
  await decideRequest(auth, Number(run.approval_request_id), { action, comment }, actor);
  return getPayroll(auth, id);
}

export async function releasePayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertPay(auth);
  return withTransaction(async (connection) => {
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (String(run.status) !== 'approved') throw new HttpError(409, 'The CEO has not approved this payroll.', 'NOT_APPROVED');
    await execute(connection, `UPDATE payroll_runs SET status = 'ready_for_payment' WHERE id = ?`, [id]);
    await addEvent(connection, id, auth.userId, 'release', 'approved', 'ready_for_payment', null);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.release', module: 'payroll', entityType: 'payroll_run', entityId: id,
      newValue: { reference: run.reference_number }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [id]))!);
  });
}

async function refreshPaymentStatus(db: Db, runId: number, userId: number) {
  const run = await queryOne<RowDataPacket>(db, 'SELECT status FROM payroll_runs WHERE id = ?', [runId]);
  const lines = await query<RowDataPacket[]>(db, 'SELECT id FROM payroll_lines WHERE payroll_run_id = ?', [runId]);
  const payments = await query<RowDataPacket[]>(db, 'SELECT payroll_line_id, status FROM salary_payments WHERE payroll_run_id = ?', [runId]);
  const paid = new Set(payments.filter((row) => row.status === 'paid').map((row) => Number(row.payroll_line_id)));
  const failed = payments.some((row) => row.status === 'failed');
  let next = String(run?.status);
  if (paid.size === lines.length && lines.length > 0) next = 'paid';
  else if (paid.size > 0) next = 'partially_paid';
  else if (failed) next = 'payment_failed';
  else next = 'ready_for_payment';
  if (next !== String(run?.status)) {
    await execute(db, 'UPDATE payroll_runs SET status = ? WHERE id = ?', [next, runId]);
    await addEvent(db, runId, userId, 'payment', String(run?.status), next, null);
  }
}

export async function paySalaries(auth: AuthContext, id: number, input: { lineIds: number[]; cashAccountId: number; paymentDate: string }, actor: Actor) {
  await assertPay(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (!payable.has(String(run.status))) throw new HttpError(409, 'This payroll is not ready for payment.', 'NOT_PAYABLE');
    const cash = await queryOne<RowDataPacket>(connection, `SELECT * FROM cash_accounts WHERE id = ? AND company_id = ? AND status = 'active'`, [input.cashAccountId, companyId]);
    if (!cash) throw new HttpError(422, 'Choose an active cash account.', 'INVALID_CASH_ACCOUNT');
    const salary = await queryOne<RowDataPacket>(connection, `SELECT id FROM ledger_accounts WHERE company_id = ? AND code = '5100' AND status = 'active'`, [companyId]);
    if (!salary) throw new HttpError(422, 'The salaries account is not on the chart.', 'INVALID_ACCOUNT');
    const lines = await query<RowDataPacket[]>(
      connection,
      `SELECT * FROM payroll_lines WHERE payroll_run_id = ? AND id IN (${input.lineIds.map(() => '?').join(', ')}) FOR UPDATE`,
      [id, ...input.lineIds],
    );
    if (lines.length !== input.lineIds.length) throw new HttpError(422, 'Choose payroll lines from this run.', 'INVALID_LINE');
    const groups = new Map<number | null, number>();
    let total = 0;
    for (const line of lines) {
      const already = await queryOne<RowDataPacket>(
        connection,
        `SELECT id FROM salary_payments WHERE employee_id = ? AND period_year = ? AND period_month = ? AND status = 'paid' FOR UPDATE`,
        [line.employee_id, run.period_year, run.period_month],
      );
      if (already) throw new HttpError(409, 'That employee is already paid for this period.', 'DUPLICATE_PAYMENT');
      const amount = cents(line.net_pay);
      if (amount <= 0) throw new HttpError(422, 'A salary payment needs a positive amount.', 'EMPTY_PAYMENT');
      total += amount;
      const departmentId = line.department_id == null ? null : Number(line.department_id);
      groups.set(departmentId, (groups.get(departmentId) ?? 0) + amount);
    }
    const journal = await postJournal(connection, {
      companyId,
      journalDate: input.paymentDate,
      description: `Salary payment ${run.reference_number}`,
      sourceType: 'salary_payment',
      sourceId: id,
      userId: auth.userId,
      lines: [
        ...[...groups].map(([departmentId, amount]) => ({
          accountId: Number(salary.id),
          departmentId,
          debit: dollars(amount),
          credit: 0,
          memo: `Salaries ${run.period_year}-${String(run.period_month).padStart(2, '0')}`,
        })),
        { accountId: Number(cash.ledger_account_id), debit: 0, credit: dollars(total), memo: `Salary payment ${run.reference_number}` },
      ],
    }, actor);
    const references: string[] = [];
    for (const line of lines) {
      const reference = await nextReference(connection, 'salary_payment', 'salary_payment_prefix');
      references.push(reference);
      await execute(
        connection,
        `INSERT INTO salary_payments (
           company_id, reference_number, payroll_run_id, payroll_line_id, employee_id, period_year, period_month,
           amount, status, payment_date, journal_id, paid_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)`,
        [companyId, reference, id, line.id, line.employee_id, run.period_year, run.period_month, line.net_pay, input.paymentDate, journal.id, auth.userId],
      );
    }
    await refreshPaymentStatus(connection, id, auth.userId);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.pay', module: 'payroll', entityType: 'payroll_run', entityId: id,
      newValue: { journal: journal.referenceNumber, payments: references, amount: dollars(total) },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { journalReference: journal.referenceNumber, payments: references };
  });
}

export async function failSalary(auth: AuthContext, id: number, input: { lineId: number; reason: string }, actor: Actor) {
  await assertPay(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (!payable.has(String(run.status))) throw new HttpError(409, 'This payroll is not ready for payment.', 'NOT_PAYABLE');
    const line = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_lines WHERE id = ? AND payroll_run_id = ?', [input.lineId, id]);
    if (!line) throw notFound('Payroll line');
    const paid = await queryOne<RowDataPacket>(
      connection,
      `SELECT id FROM salary_payments WHERE payroll_line_id = ? AND status = 'paid'`,
      [line.id],
    );
    if (paid) throw new HttpError(409, 'That salary has already been paid.', 'ALREADY_PAID');
    const reference = await nextReference(connection, 'salary_payment', 'salary_payment_prefix');
    await execute(
      connection,
      `INSERT INTO salary_payments (
         company_id, reference_number, payroll_run_id, payroll_line_id, employee_id, period_year, period_month,
         amount, status, failure_reason, paid_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)`,
      [companyId, reference, id, line.id, line.employee_id, run.period_year, run.period_month, line.net_pay, input.reason, auth.userId],
    );
    await refreshPaymentStatus(connection, id, auth.userId);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.pay_failed', module: 'payroll', entityType: 'salary_payment', entityId: reference,
      newValue: { lineId: input.lineId, reason: input.reason }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { referenceNumber: reference, status: 'failed' };
  });
}

export async function completePayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertPay(auth);
  return withTransaction(async (connection) => {
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (String(run.status) !== 'paid') throw new HttpError(409, 'Complete the payroll only after every salary has been paid.', 'NOT_PAID');
    await execute(connection, `UPDATE payroll_runs SET status = 'completed' WHERE id = ?`, [id]);
    await addEvent(connection, id, auth.userId, 'complete', 'paid', 'completed', null);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.complete', module: 'payroll', entityType: 'payroll_run', entityId: id,
      newValue: { reference: run.reference_number }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [id]))!);
  });
}

export async function correctPayroll(auth: AuthContext, id: number, actor: Actor) {
  await assertPrepare(auth);
  return withTransaction(async (connection) => {
    const run = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [id]);
    if (!run) throw notFound('Payroll');
    if (!['approved', 'ready_for_payment'].includes(String(run.status))) {
      throw new HttpError(409, 'A correction is for approved payroll that has not been paid.', 'NOT_CORRECTABLE');
    }
    const paid = await queryOne<RowDataPacket>(connection, `SELECT id FROM salary_payments WHERE payroll_run_id = ? AND status = 'paid'`, [id]);
    if (paid) throw new HttpError(409, 'Paid payroll cannot be edited. Record an adjustment in a later period.', 'ALREADY_PAID');
    await execute(connection, `UPDATE payroll_runs SET status = 'superseded' WHERE id = ?`, [id]);
    await addEvent(connection, id, auth.userId, 'supersede', String(run.status), 'superseded', 'Replaced by a correction that must be approved again.');
    const reference = await nextReference(connection, 'payroll_run', 'payroll_run_prefix');
    const created = await execute(
      connection,
      `INSERT INTO payroll_runs (company_id, reference_number, period_year, period_month, status, prepared_by)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
      [run.company_id, reference, run.period_year, run.period_month, auth.userId],
    );
    const lines = await query<RowDataPacket[]>(connection, 'SELECT * FROM payroll_lines WHERE payroll_run_id = ?', [id]);
    for (const line of lines) {
      await execute(
        connection,
        `INSERT INTO payroll_lines (payroll_run_id, employee_id, department_id, basic_salary, allowances, deductions, net_pay)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, line.employee_id, line.department_id, line.basic_salary, line.allowances, line.deductions, line.net_pay],
      );
    }
    await refreshTotals(connection, created.insertId);
    await addEvent(connection, created.insertId, auth.userId, 'correct', null, 'draft', `Correction of ${run.reference_number}`);
    await writeAudit(connection, {
      userId: actor.userId, action: 'payroll.correction', module: 'payroll', entityType: 'payroll_run', entityId: created.insertId,
      previousValue: { id, reference: run.reference_number }, newValue: { reference },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return mapRun((await queryOne<RowDataPacket>(connection, 'SELECT * FROM payroll_runs WHERE id = ?', [created.insertId]))!);
  });
}

export async function payrollReport(auth: AuthContext) {
  await assertReader(auth);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT r.reference_number, r.period_year, r.period_month, r.status, r.total_net,
            p.reference_number AS payment_reference, p.status AS payment_status, p.amount, p.payment_date, e.employee_number
     FROM payroll_runs r
     LEFT JOIN salary_payments p ON p.payroll_run_id = r.id
     LEFT JOIN employees e ON e.id = p.employee_id
     ORDER BY r.id DESC, p.id`,
  );
  return rows.map((row) => ({
    payroll: String(row.reference_number),
    period: `${row.period_year}-${String(row.period_month).padStart(2, '0')}`,
    status: String(row.status),
    totalNet: Number(row.total_net),
    payment: row.payment_reference == null ? '' : String(row.payment_reference),
    paymentStatus: row.payment_status == null ? '' : String(row.payment_status),
    amount: row.amount == null ? '' : Number(row.amount),
    paymentDate: row.payment_date == null ? '' : String(row.payment_date).slice(0, 10),
    employeeNumber: row.employee_number == null ? '' : String(row.employee_number),
  }));
}

export function payrollReportTables(rows: Awaited<ReturnType<typeof payrollReport>>) {
  return [{
    title: 'Salary payments',
    columns: ['Payroll', 'Period', 'Run status', 'Total', 'Payment', 'Payment status', 'Amount', 'Date', 'Employee'],
    rows: rows.map((row) => [row.payroll, row.period, row.status, row.totalNet, row.payment, row.paymentStatus, row.amount, row.paymentDate, row.employeeNumber]),
  }];
}

async function syncPayroll(db: Db, event: ApprovalChange) {
  if (event.sourceType !== 'payroll_run') return;
  const run = await queryOne<RowDataPacket>(db, 'SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE', [event.sourceId]);
  if (!run) return;
  const current = String(run.status);
  if (current === 'draft') return;
  if (['paid', 'partially_paid', 'payment_failed', 'completed', 'ready_for_payment', 'superseded'].includes(current)) return;
  let next = current;
  if (event.status === 'rejected') next = 'rejected';
  else if (event.status === 'returned_for_correction') next = 'returned_to_hr';
  else if (['approved', 'processing', 'completed'].includes(event.status)) next = 'approved';
  else {
    const step = await queryOne<RowDataPacket>(
      db,
      `SELECT name FROM approval_request_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_order LIMIT 1`,
      [event.requestId],
    );
    const name = String(step?.name ?? '');
    if (name.toLowerCase().includes('ceo')) next = 'submitted_for_ceo';
    else if (current === 'under_accounts_review') next = 'under_accounts_review';
    else next = 'submitted_to_accounts';
  }
  if (next === current) return;
  const actor = await queryOne<RowDataPacket>(
    db,
    'SELECT actor_user_id FROM approval_actions WHERE request_id = ? ORDER BY id DESC LIMIT 1',
    [event.requestId],
  );
  await execute(db, 'UPDATE payroll_runs SET status = ? WHERE id = ?', [next, run.id]);
  await addEvent(db, Number(run.id), Number(actor?.actor_user_id ?? run.prepared_by), 'approval', current, next, null);
}

onApprovalChange(syncPayroll);
