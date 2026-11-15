import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction, type Db } from '../../database/query';
import { createRequest, resubmitRequest } from '../approvals/approval.service';
import { onApprovalChange, type ApprovalChange } from '../approvals/approval.hooks';
import { writeAudit } from '../../services/auditService';
import { assertPaymentSegregation } from '../../services/governance';
import { hasPermission } from '../../services/access';
import { recordVisibility, transactionClause } from '../../services/visibility';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };
type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

function fromCents(value: number): string {
  return (value / 100).toFixed(2);
}

async function accountByCode(db: Db, companyId: number, code: string) {
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT * FROM ledger_accounts WHERE company_id = ? AND code = ?',
    [companyId, code],
  );
  if (!row) throw new HttpError(500, `Ledger account ${code} is not configured.`, 'CHART_NOT_SEEDED');
  return row;
}

async function postableAccount(db: Db, companyId: number, id: number, expected?: AccountType) {
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT * FROM ledger_accounts WHERE id = ? AND company_id = ?',
    [id, companyId],
  );
  if (!row || row.status !== 'active' || Number(row.postable) !== 1) {
    throw new HttpError(422, 'Choose an active ledger account.', 'INVALID_ACCOUNT');
  }
  if (expected && row.account_type !== expected) {
    throw new HttpError(422, `Choose an ${expected} account.`, 'INVALID_ACCOUNT');
  }
  return row;
}

async function activeCash(db: Db, companyId: number, id: number, kind?: 'bank' | 'petty' | 'cash') {
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT * FROM cash_accounts WHERE id = ? AND company_id = ?',
    [id, companyId],
  );
  if (!row || row.status !== 'active' || (kind && row.kind !== kind)) {
    throw new HttpError(422, 'Choose an active cash account.', 'INVALID_CASH_ACCOUNT');
  }
  return row;
}

export async function postJournal(db: Db, input: {
  companyId: number;
  journalDate: string;
  description: string;
  sourceType?: string | null;
  sourceId?: number | null;
  reversesJournalId?: number | null;
  userId: number;
  lines: Array<{ accountId: number; departmentId?: number | null; debit: number; credit: number; memo?: string | null }>;
}, actor: Actor) {
  let debit = 0;
  let credit = 0;
  for (const line of input.lines) {
    const lineDebit = cents(line.debit);
    const lineCredit = cents(line.credit);
    if ((lineDebit > 0 && lineCredit > 0) || (lineDebit === 0 && lineCredit === 0)) {
      throw new HttpError(422, 'Each journal line needs a debit or a credit.', 'UNBALANCED_JOURNAL');
    }
    debit += lineDebit;
    credit += lineCredit;
    await postableAccount(db, input.companyId, line.accountId);
    if (line.departmentId) {
      const department = await queryOne<RowDataPacket>(db, 'SELECT id FROM departments WHERE id = ? AND company_id = ?', [line.departmentId, input.companyId]);
      if (!department) throw new HttpError(422, 'Choose a department.', 'INVALID_DEPARTMENT');
    }
  }
  if (debit !== credit || debit === 0) {
    throw new HttpError(422, 'The journal does not balance.', 'UNBALANCED_JOURNAL');
  }
  const reference = await nextReference(db, 'journal', 'journal_prefix');
  const created = await execute(
    db,
    `INSERT INTO journals (company_id, reference_number, journal_date, description, source_type, source_id, reverses_journal_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.companyId, reference, input.journalDate, input.description, input.sourceType ?? null, input.sourceId ?? null, input.reversesJournalId ?? null, input.userId],
  );
  for (const line of input.lines) {
    await execute(
      db,
      `INSERT INTO journal_lines (journal_id, ledger_account_id, department_id, debit, credit, memo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [created.insertId, line.accountId, line.departmentId ?? null, fromCents(cents(line.debit)), fromCents(cents(line.credit)), line.memo ?? null],
    );
  }
  await writeAudit(db, {
    userId: actor.userId, action: 'journal.post', module: 'finance', entityType: 'journal', entityId: created.insertId,
    newValue: { reference, debit: fromCents(debit), sourceType: input.sourceType ?? null },
    ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id: created.insertId, referenceNumber: reference };
}

function mapAccount(row: RowDataPacket) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    accountType: String(row.account_type),
    status: String(row.status),
  };
}

export async function listAccounts() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM ledger_accounts ORDER BY code');
  return rows.map(mapAccount);
}

export async function createAccount(input: { code: string; name: string; accountType: AccountType }) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const code = input.code.toUpperCase();
    const existing = await queryOne<RowDataPacket>(connection, 'SELECT id FROM ledger_accounts WHERE company_id = ? AND code = ?', [companyId, code]);
    if (existing) throw new HttpError(409, 'That account code is already used.', 'DUPLICATE_ACCOUNT');
    const created = await execute(
      connection,
      'INSERT INTO ledger_accounts (company_id, code, name, account_type) VALUES (?, ?, ?, ?)',
      [companyId, code, input.name, input.accountType],
    );
    return { id: created.insertId, code, name: input.name, accountType: input.accountType, status: 'active' };
  });
}

export async function setAccountStatus(id: number, status: 'active' | 'inactive') {
  const existing = await queryOne<RowDataPacket>(pool, 'SELECT id FROM ledger_accounts WHERE id = ?', [id]);
  if (!existing) throw notFound('Ledger account');
  await execute(pool, 'UPDATE ledger_accounts SET status = ? WHERE id = ?', [status, id]);
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM ledger_accounts WHERE id = ?', [id]);
  return mapAccount(row!);
}

export async function listCashAccounts() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT c.*, a.code AS ledger_code, a.name AS ledger_name
     FROM cash_accounts c JOIN ledger_accounts a ON a.id = c.ledger_account_id ORDER BY c.code`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    kind: String(row.kind),
    ledgerAccountId: Number(row.ledger_account_id),
    ledgerCode: String(row.ledger_code),
    status: String(row.status),
  }));
}

export async function createCashAccount(input: { code: string; name: string; kind: 'bank' | 'petty' | 'cash'; ledgerAccountId: number }) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    await postableAccount(connection, companyId, input.ledgerAccountId, 'asset');
    const code = input.code.toUpperCase();
    const existing = await queryOne<RowDataPacket>(connection, 'SELECT id FROM cash_accounts WHERE company_id = ? AND code = ?', [companyId, code]);
    if (existing) throw new HttpError(409, 'That cash account code is already used.', 'DUPLICATE_CASH_ACCOUNT');
    const created = await execute(
      connection,
      'INSERT INTO cash_accounts (company_id, code, name, kind, ledger_account_id) VALUES (?, ?, ?, ?, ?)',
      [companyId, code, input.name, input.kind, input.ledgerAccountId],
    );
    return { id: created.insertId, code, name: input.name, kind: input.kind, ledgerAccountId: input.ledgerAccountId, status: 'active' };
  });
}

export async function listJournals() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT j.id, j.reference_number, j.journal_date, j.description, j.source_type, j.reverses_journal_id,
            COALESCE(SUM(l.debit), 0) AS debit
     FROM journals j LEFT JOIN journal_lines l ON l.journal_id = j.id
     GROUP BY j.id ORDER BY j.id DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    journalDate: String(row.journal_date).slice(0, 10),
    description: String(row.description),
    sourceType: row.source_type == null ? null : String(row.source_type),
    reversesJournalId: row.reverses_journal_id == null ? null : Number(row.reverses_journal_id),
    debit: Number(row.debit),
  }));
}

export async function createJournal(auth: AuthContext, input: {
  journalDate: string;
  description: string;
  lines: Array<{ accountId: number; departmentId?: number | null; debit: number; credit: number; memo?: string | null }>;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    return postJournal(connection, { companyId, ...input, userId: auth.userId }, actor);
  });
}

export async function reverseJournal(auth: AuthContext, id: number, input: { journalDate: string; description: string }, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const journal = await queryOne<RowDataPacket>(connection, 'SELECT * FROM journals WHERE id = ? AND company_id = ?', [id, companyId]);
    if (!journal) throw notFound('Journal');
    const already = await queryOne<RowDataPacket>(connection, 'SELECT id FROM journals WHERE reverses_journal_id = ?', [id]);
    if (already) throw new HttpError(409, 'This journal already has a reversal.', 'ALREADY_REVERSED');
    const lines = await query<RowDataPacket[]>(connection, 'SELECT * FROM journal_lines WHERE journal_id = ? ORDER BY id', [id]);
    return postJournal(connection, {
      companyId,
      journalDate: input.journalDate,
      description: input.description,
      sourceType: 'reversal',
      sourceId: id,
      reversesJournalId: id,
      userId: auth.userId,
      lines: lines.map((line) => ({
        accountId: Number(line.ledger_account_id),
        departmentId: line.department_id == null ? null : Number(line.department_id),
        debit: Number(line.credit),
        credit: Number(line.debit),
        memo: line.memo == null ? null : String(line.memo),
      })),
    }, actor);
  });
}

function mapPayment(row: RowDataPacket) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    payee: String(row.payee),
    purpose: String(row.purpose),
    amount: Number(row.amount),
    status: String(row.status),
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
    supplierInvoiceId: row.supplier_invoice_id == null ? null : Number(row.supplier_invoice_id),
    journalId: row.journal_id == null ? null : Number(row.journal_id),
    cashAccountId: Number(row.cash_account_id),
    expenseAccountId: Number(row.expense_account_id),
  };
}

export async function listPayments(auth: AuthContext) {
  const visibility = await recordVisibility(auth);
  const scope = transactionClause(visibility, { department: 'department_id', user: 'requester_user_id' });
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT * FROM payment_requests WHERE ${scope.sql} ORDER BY id DESC LIMIT 200`,
    scope.params,
  );
  return rows.map(mapPayment);
}

export async function createPayment(auth: AuthContext, input: {
  payee: string;
  purpose: string;
  amount: number;
  expenseAccountId: number;
  cashAccountId: number;
  supplierInvoiceId?: number | null;
}, actor: Actor) {
  if (!hasPermission(auth, 'finance.request') && !hasPermission(auth, 'finance.manage')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    await postableAccount(connection, companyId, input.expenseAccountId, 'expense');
    await activeCash(connection, companyId, input.cashAccountId);
    if (input.supplierInvoiceId) {
      const invoice = await queryOne<RowDataPacket>(connection, 'SELECT * FROM supplier_invoices WHERE id = ? AND company_id = ? FOR UPDATE', [input.supplierInvoiceId, companyId]);
      if (!invoice || invoice.journal_id == null) throw new HttpError(422, 'Post the supplier invoice to the ledger before requesting payment.', 'INVOICE_NOT_POSTED');
      const reserved = await scalar(
        connection,
        `SELECT COALESCE(SUM(amount), 0) FROM payment_requests WHERE supplier_invoice_id = ? AND status IN ('submitted', 'returned', 'approved')`,
        [input.supplierInvoiceId],
      );
      if (cents(input.amount) + cents(reserved) > cents(invoice.outstanding)) {
        throw new HttpError(422, 'The payment is more than the amount still owed.', 'OVER_PAYMENT');
      }
    }
    const assignment = auth.employeeId
      ? await queryOne<RowDataPacket>(
        connection,
        'SELECT department_id, branch_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL',
        [auth.employeeId],
      )
      : null;
    if (!assignment?.department_id) throw new HttpError(422, 'A payment request needs an employee assignment in a department.', 'NO_DEPARTMENT');
    const reference = await nextReference(connection, 'payment_request', 'payment_request_prefix');
    const created = await execute(
      connection,
      `INSERT INTO payment_requests (
         company_id, reference_number, requester_user_id, department_id, branch_id, payee, purpose, amount,
         expense_account_id, cash_account_id, supplier_invoice_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [companyId, reference, auth.userId, assignment.department_id, assignment.branch_id, input.payee, input.purpose, input.amount, input.expenseAccountId, input.cashAccountId, input.supplierInvoiceId ?? null],
    );
    const approval = await createRequest(auth, {
      workflowCode: 'PAYMENT',
      title: `Payment ${reference}`,
      details: input.purpose,
      amount: input.amount,
      departmentId: Number(assignment.department_id),
      branchId: assignment.branch_id == null ? null : Number(assignment.branch_id),
      submit: true,
      sourceType: 'payment_request',
      sourceId: created.insertId,
    }, actor, connection);
    await execute(connection, 'UPDATE payment_requests SET approval_request_id = ? WHERE id = ?', [approval.id, created.insertId]);
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payment_requests WHERE id = ?', [created.insertId]);
    return mapPayment(row!);
  });
}

export async function resubmitPayment(auth: AuthContext, id: number, actor: Actor) {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM payment_requests WHERE id = ?', [id]);
  if (!row) throw notFound('Payment request');
  if (Number(row.requester_user_id) !== auth.userId && !hasPermission(auth, 'finance.manage')) {
    throw new HttpError(403, 'Only the requester can resubmit this payment.', 'NOT_REQUESTER');
  }
  if (row.status !== 'returned' || !row.approval_request_id) throw new HttpError(409, 'Only a returned payment can be resubmitted.', 'NOT_RETURNED');
  await resubmitRequest(auth, Number(row.approval_request_id), actor);
  const updated = await queryOne<RowDataPacket>(pool, 'SELECT * FROM payment_requests WHERE id = ?', [id]);
  return mapPayment(updated!);
}

export async function payRequest(auth: AuthContext, id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const request = await queryOne<RowDataPacket>(connection, 'SELECT * FROM payment_requests WHERE id = ? FOR UPDATE', [id]);
    if (!request) throw notFound('Payment request');
    if (request.status !== 'approved' || request.journal_id != null) {
      throw new HttpError(409, 'Only an approved unpaid request can be paid.', 'NOT_APPROVED');
    }
    await assertPaymentSegregation(connection, {
      approvalRequestId: request.approval_request_id == null ? null : Number(request.approval_request_id),
      payerUserId: auth.userId,
      requesterUserId: Number(request.requester_user_id),
    });
    await writeAudit(connection, {
      userId: actor.userId, action: 'finance.payment.execute', module: 'finance', entityType: 'payment_request', entityId: id,
      previousValue: { status: request.status }, newValue: { status: 'paid', amount: Number(request.amount), payee: request.payee, executedBy: auth.userId },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const cash = await activeCash(connection, companyId, Number(request.cash_account_id));
    const amount = Number(request.amount);
    if (request.supplier_invoice_id != null) {
      const invoice = await queryOne<RowDataPacket>(connection, 'SELECT * FROM supplier_invoices WHERE id = ? FOR UPDATE', [request.supplier_invoice_id]);
      if (!invoice || cents(invoice.outstanding) < cents(amount)) throw new HttpError(422, 'The supplier invoice cannot take this payment.', 'OVER_PAYMENT');
      const payable = await accountByCode(connection, companyId, '2000');
      const journal = await postJournal(connection, {
        companyId,
        journalDate: new Date().toISOString().slice(0, 10),
        description: `Pay ${request.reference_number}`,
        sourceType: 'payment_request',
        sourceId: id,
        userId: auth.userId,
        lines: [
          { accountId: Number(payable.id), debit: amount, credit: 0 },
          { accountId: Number(cash.ledger_account_id), debit: 0, credit: amount },
        ],
      }, actor);
      await execute(connection, 'UPDATE supplier_invoices SET outstanding = outstanding - ? WHERE id = ?', [amount, invoice.id]);
      await execute(connection, `UPDATE payment_requests SET status = 'paid', journal_id = ? WHERE id = ?`, [journal.id, id]);
      return { ...journal, status: 'paid' };
    }
    const journal = await postJournal(connection, {
      companyId,
      journalDate: new Date().toISOString().slice(0, 10),
      description: `Pay ${request.reference_number}`,
      sourceType: 'payment_request',
      sourceId: id,
      userId: auth.userId,
      lines: [
        { accountId: Number(request.expense_account_id), departmentId: request.department_id == null ? null : Number(request.department_id), debit: amount, credit: 0 },
        { accountId: Number(cash.ledger_account_id), debit: 0, credit: amount },
      ],
    }, actor);
    await execute(connection, `UPDATE payment_requests SET status = 'paid', journal_id = ? WHERE id = ?`, [journal.id, id]);
    return { ...journal, status: 'paid' };
  });
}

async function syncPayment(db: Db, event: ApprovalChange) {
  const mapped: Record<string, string> = {
    pending_review: 'submitted', under_approval: 'submitted', approved: 'approved', processing: 'approved', completed: 'approved',
    rejected: 'rejected', returned_for_correction: 'returned', cancelled: 'cancelled',
  };
  const status = mapped[event.status];
  if (!status) return;
  const row = await queryOne<RowDataPacket>(db, 'SELECT status FROM payment_requests WHERE id = ? FOR UPDATE', [event.sourceId]);
  if (!row || row.status === 'paid') return;
  await execute(db, 'UPDATE payment_requests SET status = ? WHERE id = ?', [status, event.sourceId]);
}

export async function postSupplierInvoice(auth: AuthContext, id: number, expenseAccountId: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const invoice = await queryOne<RowDataPacket>(connection, 'SELECT * FROM supplier_invoices WHERE id = ? AND company_id = ? FOR UPDATE', [id, companyId]);
    if (!invoice) throw notFound('Supplier invoice');
    if (invoice.journal_id != null) throw new HttpError(409, 'This supplier invoice is already on the ledger.', 'ALREADY_POSTED');
    await postableAccount(connection, companyId, expenseAccountId, 'expense');
    const payable = await accountByCode(connection, companyId, '2000');
    const journal = await postJournal(connection, {
      companyId,
      journalDate: String(invoice.invoice_date).slice(0, 10),
      description: `Supplier invoice ${invoice.invoice_number}`,
      sourceType: 'supplier_invoice',
      sourceId: id,
      userId: auth.userId,
      lines: [
        { accountId: expenseAccountId, debit: Number(invoice.amount), credit: 0 },
        { accountId: Number(payable.id), debit: 0, credit: Number(invoice.amount) },
      ],
    }, actor);
    await execute(connection, 'UPDATE supplier_invoices SET journal_id = ?, outstanding = amount WHERE id = ?', [journal.id, id]);
    return journal;
  });
}

export async function listCustomers() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM customers ORDER BY name LIMIT 200');
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    name: String(row.name),
    status: String(row.status),
  }));
}

export async function createCustomer(auth: AuthContext, name: string, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const reference = await nextReference(connection, 'customer', 'customer_prefix');
    const created = await execute(
      connection,
      'INSERT INTO customers (company_id, reference_number, name, created_by) VALUES (?, ?, ?, ?)',
      [companyId, reference, name, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'customer.create', module: 'finance', entityType: 'customer', entityId: created.insertId,
      newValue: { reference, name }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference, name, status: 'active' };
  });
}

export async function listCustomerInvoices() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT i.*, c.name AS customer_name FROM customer_invoices i JOIN customers c ON c.id = i.customer_id ORDER BY i.id DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    customerName: String(row.customer_name),
    invoiceDate: String(row.invoice_date).slice(0, 10),
    description: String(row.description),
    amount: Number(row.amount),
    outstanding: Number(row.outstanding),
    status: String(row.status),
  }));
}

export async function createCustomerInvoice(auth: AuthContext, input: { customerId: number; invoiceDate: string; description: string; amount: number }, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const customer = await queryOne<RowDataPacket>(connection, 'SELECT id, status FROM customers WHERE id = ? AND company_id = ?', [input.customerId, companyId]);
    if (!customer || customer.status !== 'active') throw new HttpError(422, 'Choose an active customer.', 'INVALID_CUSTOMER');
    const receivable = await accountByCode(connection, companyId, '1100');
    const income = await accountByCode(connection, companyId, '4000');
    const reference = await nextReference(connection, 'customer_invoice', 'customer_invoice_prefix');
    const journal = await postJournal(connection, {
      companyId,
      journalDate: input.invoiceDate,
      description: `Customer invoice ${reference}`,
      sourceType: 'customer_invoice',
      userId: auth.userId,
      lines: [
        { accountId: Number(receivable.id), debit: input.amount, credit: 0 },
        { accountId: Number(income.id), debit: 0, credit: input.amount },
      ],
    }, actor);
    const created = await execute(
      connection,
      `INSERT INTO customer_invoices (company_id, reference_number, customer_id, invoice_date, description, amount, outstanding, status, journal_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [companyId, reference, input.customerId, input.invoiceDate, input.description, input.amount, input.amount, journal.id, auth.userId],
    );
    return { id: created.insertId, referenceNumber: reference, outstanding: input.amount, status: 'open' };
  });
}

export async function receiveCustomerPayment(auth: AuthContext, invoiceId: number, input: { cashAccountId: number; amount: number; receivedOn: string }, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const invoice = await queryOne<RowDataPacket>(connection, 'SELECT * FROM customer_invoices WHERE id = ? AND company_id = ? FOR UPDATE', [invoiceId, companyId]);
    if (!invoice) throw notFound('Customer invoice');
    if (invoice.status !== 'open') throw new HttpError(409, 'This invoice is not open.', 'INVOICE_NOT_OPEN');
    if (cents(input.amount) > cents(invoice.outstanding)) throw new HttpError(422, 'The receipt is more than the amount outstanding.', 'OVER_RECEIPT');
    const cash = await activeCash(connection, companyId, input.cashAccountId);
    const receivable = await accountByCode(connection, companyId, '1100');
    const journal = await postJournal(connection, {
      companyId,
      journalDate: input.receivedOn,
      description: `Receipt ${invoice.reference_number}`,
      sourceType: 'customer_receipt',
      sourceId: invoiceId,
      userId: auth.userId,
      lines: [
        { accountId: Number(cash.ledger_account_id), debit: input.amount, credit: 0 },
        { accountId: Number(receivable.id), debit: 0, credit: input.amount },
      ],
    }, actor);
    const outstanding = cents(invoice.outstanding) - cents(input.amount);
    await execute(
      connection,
      'UPDATE customer_invoices SET outstanding = ?, status = ? WHERE id = ?',
      [fromCents(outstanding), outstanding === 0 ? 'paid' : 'open', invoiceId],
    );
    await execute(
      connection,
      'INSERT INTO customer_receipts (customer_invoice_id, cash_account_id, amount, received_on, journal_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [invoiceId, input.cashAccountId, input.amount, input.receivedOn, journal.id, auth.userId],
    );
    return { referenceNumber: journal.referenceNumber, outstanding: Number(fromCents(outstanding)), status: outstanding === 0 ? 'paid' : 'open' };
  });
}

function mapBudget(row: RowDataPacket) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    departmentId: Number(row.department_id),
    ledgerAccountId: Number(row.ledger_account_id),
    budgetYear: Number(row.budget_year),
    amount: Number(row.amount),
    purpose: String(row.purpose),
    status: String(row.status),
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
  };
}

export async function listBudgets(auth: AuthContext) {
  const visibility = await recordVisibility(auth);
  const scope = transactionClause(visibility, { department: 'department_id', user: 'requester_user_id' });
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT * FROM budgets WHERE ${scope.sql} ORDER BY id DESC LIMIT 200`,
    scope.params,
  );
  return rows.map(mapBudget);
}

export async function createBudget(auth: AuthContext, input: {
  departmentId: number;
  ledgerAccountId: number;
  budgetYear: number;
  amount: number;
  purpose: string;
}, actor: Actor) {
  if (!hasPermission(auth, 'finance.request') && !hasPermission(auth, 'finance.manage')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const department = await queryOne<RowDataPacket>(connection, 'SELECT id FROM departments WHERE id = ? AND company_id = ? AND status = \'active\'', [input.departmentId, companyId]);
    if (!department) throw new HttpError(422, 'Choose a department.', 'INVALID_DEPARTMENT');
    const visibility = await recordVisibility(auth);
    if (!visibility.companyWide && !visibility.departmentIds.includes(input.departmentId)) {
      throw new HttpError(403, 'A budget can be submitted only for your department.', 'DEPARTMENT_SCOPE');
    }
    await postableAccount(connection, companyId, input.ledgerAccountId, 'expense');
    const reference = await nextReference(connection, 'budget', 'budget_prefix');
    const created = await execute(
      connection,
      `INSERT INTO budgets (company_id, reference_number, requester_user_id, department_id, ledger_account_id, budget_year, amount, purpose, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [companyId, reference, auth.userId, input.departmentId, input.ledgerAccountId, input.budgetYear, input.amount, input.purpose],
    );
    const approval = await createRequest(auth, {
      workflowCode: 'BUDGET',
      title: `Budget ${reference}`,
      details: input.purpose,
      amount: input.amount,
      departmentId: input.departmentId,
      submit: true,
      sourceType: 'budget',
      sourceId: created.insertId,
    }, actor, connection);
    await execute(connection, 'UPDATE budgets SET approval_request_id = ? WHERE id = ?', [approval.id, created.insertId]);
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM budgets WHERE id = ?', [created.insertId]);
    return mapBudget(row!);
  });
}

async function syncBudget(db: Db, event: ApprovalChange) {
  const mapped: Record<string, string> = {
    pending_review: 'submitted', under_approval: 'submitted', approved: 'approved', processing: 'approved', completed: 'approved',
    rejected: 'rejected', returned_for_correction: 'returned', cancelled: 'cancelled',
  };
  const status = mapped[event.status];
  if (!status) return;
  await execute(db, 'UPDATE budgets SET status = ? WHERE id = ?', [status, event.sourceId]);
}

export async function postPettyExpense(auth: AuthContext, input: {
  cashAccountId: number;
  expenseAccountId: number;
  departmentId?: number | null;
  journalDate: string;
  amount: number;
  memo: string;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const cash = await activeCash(connection, companyId, input.cashAccountId, 'petty');
    await postableAccount(connection, companyId, input.expenseAccountId, 'expense');
    return postJournal(connection, {
      companyId,
      journalDate: input.journalDate,
      description: input.memo,
      sourceType: 'petty_cash',
      userId: auth.userId,
      lines: [
        { accountId: input.expenseAccountId, departmentId: input.departmentId ?? null, debit: input.amount, credit: 0 },
        { accountId: Number(cash.ledger_account_id), debit: 0, credit: input.amount },
      ],
    }, actor);
  });
}

export async function unclearedLines(cashAccountId: number, to: string) {
  const cash = await queryOne<RowDataPacket>(pool, 'SELECT ledger_account_id FROM cash_accounts WHERE id = ?', [cashAccountId]);
  if (!cash) throw notFound('Cash account');
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT l.id, j.reference_number, j.journal_date, j.description, l.debit, l.credit
     FROM journal_lines l JOIN journals j ON j.id = l.journal_id
     WHERE l.ledger_account_id = ? AND l.cleared_on IS NULL AND j.journal_date <= ?
     ORDER BY j.journal_date, l.id`,
    [cash.ledger_account_id, to],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    journalDate: String(row.journal_date).slice(0, 10),
    description: String(row.description),
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
}

export async function reconcile(auth: AuthContext, cashAccountId: number, input: { statementDate: string; statementBalance: number; lineIds: number[] }, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const cash = await activeCash(connection, companyId, cashAccountId);
    if (input.lineIds.length > 0) {
      const rows = await query<RowDataPacket[]>(
        connection,
        `SELECT l.id FROM journal_lines l JOIN journals j ON j.id = l.journal_id
         WHERE l.ledger_account_id = ? AND l.cleared_on IS NULL AND j.journal_date <= ?
           AND l.id IN (${input.lineIds.map(() => '?').join(',')})`,
        [cash.ledger_account_id, input.statementDate, ...input.lineIds],
      );
      if (rows.length !== input.lineIds.length) throw new HttpError(422, 'One of those lines is not an uncleared movement on this account.', 'INVALID_LINE');
      await execute(
        connection,
        `UPDATE journal_lines SET cleared_on = ? WHERE id IN (${input.lineIds.map(() => '?').join(',')})`,
        [input.statementDate, ...input.lineIds],
      );
    }
    const cleared = await queryOne<RowDataPacket>(
      connection,
      `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.ledger_account_id = ? AND l.cleared_on IS NOT NULL AND l.cleared_on <= ?`,
      [cash.ledger_account_id, input.statementDate],
    );
    const clearedBalance = cents(cleared?.debit ?? 0) - cents(cleared?.credit ?? 0);
    const difference = cents(input.statementBalance) - clearedBalance;
    const created = await execute(
      connection,
      `INSERT INTO reconciliations (cash_account_id, statement_date, statement_balance, cleared_balance, difference, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cashAccountId, input.statementDate, input.statementBalance, fromCents(clearedBalance), fromCents(difference), auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'cash.reconcile', module: 'finance', entityType: 'reconciliation', entityId: created.insertId,
      newValue: { statementBalance: input.statementBalance, clearedBalance: fromCents(clearedBalance), difference: fromCents(difference) },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, clearedBalance: Number(fromCents(clearedBalance)), difference: Number(fromCents(difference)) };
  });
}

async function accountTotals(filter: string, params: unknown[]) {
  return query<RowDataPacket[]>(
    pool,
    `SELECT a.id, a.code, a.name, a.account_type,
            COALESCE(SUM(CASE WHEN ${filter} THEN l.debit ELSE 0 END), 0) AS debit,
            COALESCE(SUM(CASE WHEN ${filter} THEN l.credit ELSE 0 END), 0) AS credit
     FROM ledger_accounts a
     LEFT JOIN journal_lines l ON l.ledger_account_id = a.id
     LEFT JOIN journals j ON j.id = l.journal_id
     GROUP BY a.id
     ORDER BY a.code`,
    params,
  );
}

function net(type: string, debit: number, credit: number): number {
  if (type === 'asset' || type === 'expense') return debit - credit;
  return credit - debit;
}

export async function financeSummary(range: { from: string; to: string }) {
  const asOf = await accountTotals('j.journal_date <= ?', [range.to, range.to]);
  const period = await accountTotals('j.journal_date BETWEEN ? AND ?', [range.from, range.to, range.from, range.to]);
  const trial = asOf.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    accountType: String(row.account_type),
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
  const profit = period
    .filter((row) => row.account_type === 'income' || row.account_type === 'expense')
    .map((row) => ({
      code: String(row.code),
      name: String(row.name),
      accountType: String(row.account_type),
      amount: Number(fromCents(net(String(row.account_type), cents(row.debit), cents(row.credit)))),
    }));
  const income = profit.filter((row) => row.accountType === 'income').reduce((sum, row) => sum + cents(row.amount), 0);
  const expense = profit.filter((row) => row.accountType === 'expense').reduce((sum, row) => sum + cents(row.amount), 0);
  const assets = asOf.filter((row) => row.account_type === 'asset').reduce((sum, row) => sum + net('asset', cents(row.debit), cents(row.credit)), 0);
  const liabilities = asOf.filter((row) => row.account_type === 'liability').reduce((sum, row) => sum + net('liability', cents(row.debit), cents(row.credit)), 0);
  const equity = asOf.filter((row) => row.account_type === 'equity').reduce((sum, row) => sum + net('equity', cents(row.debit), cents(row.credit)), 0);
  const earnings = asOf.filter((row) => row.account_type === 'income' || row.account_type === 'expense')
    .reduce((sum, row) => sum + (row.account_type === 'income' ? net('income', cents(row.debit), cents(row.credit)) : -net('expense', cents(row.debit), cents(row.credit))), 0);
  const payables = await query<RowDataPacket[]>(
    pool,
    `SELECT s.name, i.invoice_number, i.outstanding
     FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
     WHERE i.journal_id IS NOT NULL AND i.outstanding > 0 ORDER BY s.name`,
  );
  const receivables = await query<RowDataPacket[]>(
    pool,
    `SELECT c.name, i.reference_number, i.outstanding
     FROM customer_invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.status = 'open' AND i.outstanding > 0 ORDER BY c.name`,
  );
  const budgets = await query<RowDataPacket[]>(
    pool,
    `SELECT b.id, d.name AS department_name, a.code, b.amount,
            COALESCE((
              SELECT SUM(l.debit - l.credit) FROM journal_lines l
              JOIN journals j ON j.id = l.journal_id
              WHERE l.ledger_account_id = b.ledger_account_id AND l.department_id = b.department_id
                AND j.journal_date BETWEEN ? AND ?
            ), 0) AS actual
     FROM budgets b
     JOIN departments d ON d.id = b.department_id
     JOIN ledger_accounts a ON a.id = b.ledger_account_id
     WHERE b.status = 'approved' AND b.budget_year = ?`,
    [`${range.from.slice(0, 4)}-01-01`, `${range.from.slice(0, 4)}-12-31`, Number(range.from.slice(0, 4))],
  );
  const departmental = await query<RowDataPacket[]>(
    pool,
    `SELECT COALESCE(d.name, 'Unassigned') AS department_name, COALESCE(SUM(l.debit - l.credit), 0) AS spent
     FROM journal_lines l
     JOIN journals j ON j.id = l.journal_id
     JOIN ledger_accounts a ON a.id = l.ledger_account_id
     LEFT JOIN departments d ON d.id = l.department_id
     WHERE a.account_type = 'expense' AND j.journal_date BETWEEN ? AND ?
     GROUP BY d.id, d.name
     ORDER BY department_name`,
    [range.from, range.to],
  );
  return {
    from: range.from,
    to: range.to,
    trialBalance: trial,
    profitAndLoss: { lines: profit, income: Number(fromCents(income)), expense: Number(fromCents(expense)), net: Number(fromCents(income - expense)) },
    balanceSheet: {
      assets: Number(fromCents(assets)),
      liabilities: Number(fromCents(liabilities)),
      equity: Number(fromCents(equity)),
      currentEarnings: Number(fromCents(earnings)),
    },
    payables: payables.map((row) => ({ name: String(row.name), invoiceNumber: String(row.invoice_number), outstanding: Number(row.outstanding) })),
    receivables: receivables.map((row) => ({ name: String(row.name), referenceNumber: String(row.reference_number), outstanding: Number(row.outstanding) })),
    budgets: budgets.map((row) => ({
      department: String(row.department_name),
      account: String(row.code),
      amount: Number(row.amount),
      actual: Number(row.actual),
    })),
    departmentalExpenditure: departmental.map((row) => ({ department: String(row.department_name), amount: Number(row.spent) })),
  };
}

export function financeSummaryToCsv(summary: Awaited<ReturnType<typeof financeSummary>>): string {
  const lines = ['section,label,value'];
  for (const row of summary.trialBalance) lines.push(['trial', `${row.code} ${row.name}`, row.debit - row.credit].join(','));
  lines.push(['profit', 'income', summary.profitAndLoss.income].join(','));
  lines.push(['profit', 'expense', summary.profitAndLoss.expense].join(','));
  lines.push(['profit', 'net', summary.profitAndLoss.net].join(','));
  for (const row of summary.payables) lines.push(['payable', row.name, row.outstanding].join(','));
  for (const row of summary.receivables) lines.push(['receivable', row.name, row.outstanding].join(','));
  for (const row of summary.departmentalExpenditure) lines.push(['department', row.department, row.amount].join(','));
  return `${lines.join('\n')}\n`;
}

export function financeReportTables(summary: Awaited<ReturnType<typeof financeSummary>>) {
  return [
    {
      title: 'Profit and loss',
      columns: ['Label', 'Amount'],
      rows: [
        ['Income', summary.profitAndLoss.income],
        ['Expense', summary.profitAndLoss.expense],
        ['Net', summary.profitAndLoss.net],
      ],
    },
    {
      title: 'Balance sheet',
      columns: ['Label', 'Amount'],
      rows: [
        ['Assets', summary.balanceSheet.assets],
        ['Liabilities', summary.balanceSheet.liabilities],
        ['Equity', summary.balanceSheet.equity],
        ['Current earnings', summary.balanceSheet.currentEarnings],
      ],
    },
    {
      title: 'Trial balance',
      columns: ['Code', 'Account', 'Debit', 'Credit'],
      rows: summary.trialBalance.map((row) => [row.code, row.name, row.debit, row.credit]),
    },
    {
      title: 'Payables',
      columns: ['Supplier', 'Invoice', 'Outstanding'],
      rows: summary.payables.map((row) => [row.name, row.invoiceNumber, row.outstanding]),
    },
    {
      title: 'Receivables',
      columns: ['Customer', 'Invoice', 'Outstanding'],
      rows: summary.receivables.map((row) => [row.name, row.referenceNumber, row.outstanding]),
    },
    {
      title: 'Departmental expenditure',
      columns: ['Department', 'Amount'],
      rows: summary.departmentalExpenditure.map((row) => [row.department, row.amount]),
    },
  ];
}

onApprovalChange(async (db, event) => {
  if (event.sourceType === 'payment_request') await syncPayment(db, event);
  if (event.sourceType === 'budget') await syncBudget(db, event);
});
