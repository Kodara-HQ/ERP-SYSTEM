import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();
const range = 'from=2026-01-01&to=2026-12-31';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

async function tokens() {
  await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
  await createAccount('hrm', 'HR_MANAGER');
  const opsId = await createAccount('ops', 'OPERATIONS_MANAGER');
  const accountsId = await createAccount('accounts', 'ACCOUNTS_OFFICER');
  await createAccount('accounts2', 'ACCOUNTS_OFFICER');
  await createAccount('ceo', 'CEO');
  await createAccount('it', 'IT_MARKETING_MANAGER');
  const clerkId = await createAccount('clerk', 'PURCHASE_CLERK');
  return {
    opsId,
    accountsId,
    clerkId,
    admin: await login(app, 'sysadmin'),
    hr: await login(app, 'hrm'),
    ops: await login(app, 'ops'),
    accounts: await login(app, 'accounts'),
    ceo: await login(app, 'ceo'),
    it: await login(app, 'it'),
    clerk: await login(app, 'clerk'),
  };
}

async function structure(admin: string) {
  const branch = await request(app).post('/api/v1/organisation/branches').set(auth(admin)).send({ code: 'HQ', name: 'Head Office' });
  const department = await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: 'OPS', name: 'Operations' });
  const lead = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
    code: 'LEAD', title: 'Operations Lead', departmentId: department.body.data.id, isManagerial: true,
  });
  const clerk = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
    code: 'CLERK', title: 'Purchase Clerk', departmentId: department.body.data.id,
  });
  return {
    branchId: branch.body.data.id as number,
    departmentId: department.body.data.id as number,
    leadPositionId: lead.body.data.id as number,
    clerkPositionId: clerk.body.data.id as number,
  };
}

async function hire(hr: string, admin: string, userId: number, input: {
  firstName: string;
  lastName: string;
  departmentId: number;
  positionId: number;
  branchId: number;
}) {
  const employee = await request(app).post('/api/v1/employees').set(auth(hr)).send({
    firstName: input.firstName,
    lastName: input.lastName,
    employmentType: 'permanent',
    departmentId: input.departmentId,
    positionId: input.positionId,
    branchId: input.branchId,
    assignmentStartDate: '2026-01-15',
  });
  expect(employee.status).toBe(201);
  const linked = await request(app).patch(`/api/v1/users/${userId}`).set(auth(admin)).send({ employeeId: employee.body.data.id });
  expect(linked.status).toBe(200);
}

async function decide(token: string, id: number) {
  const response = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(token)).send({ action: 'approve', comment: 'Reviewed.' });
  expect(response.status).toBe(200);
  return response.body.data.status as string;
}

function byCode<T extends { code: string }>(rows: T[], code: string): T {
  const found = rows.find((row) => row.code === code);
  if (!found) throw new Error(`Missing ${code}`);
  return found;
}

describe('phase 5 finance', () => {
  it('posts a balanced ledger, keeps payables and receipts honest, and blocks edits', async () => {
    const session = await tokens();
    const org = await structure(session.admin);
    await hire(session.hr, session.admin, session.opsId, {
      firstName: 'Test', lastName: 'Lead', ...org, positionId: org.leadPositionId,
    });
    await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test', lastName: 'Clerk', ...org, positionId: org.clerkPositionId,
    });
    await hire(session.hr, session.admin, session.accountsId, {
      firstName: 'Test', lastName: 'Accounts', ...org, positionId: org.clerkPositionId,
    });

    const denied = await request(app).post('/api/v1/finance/payments').set(auth(session.admin)).send({
      payee: 'North Store', purpose: 'An administrator must not request this.', amount: 10, expenseAccountId: 1, cashAccountId: 1,
    });
    expect(denied.status).toBe(403);
    const hidden = await request(app).get(`/api/v1/finance/reports?${range}`).set(auth(session.it));
    expect(hidden.status).toBe(403);

    const chart = await request(app).get('/api/v1/finance/accounts').set(auth(session.accounts));
    expect(chart.status).toBe(200);
    const accounts = chart.body.data as Array<{ id: number; code: string }>;
    const expense = byCode(accounts, '5000').id;
    const cashLedger = byCode(accounts, '1000').id;
    const books = await request(app).get('/api/v1/finance/cash').set(auth(session.accounts));
    const cash = books.body.data as Array<{ id: number; code: string }>;
    const bankId = byCode(cash, 'BANK').id;
    const pettyId = byCode(cash, 'PETTY').id;
    const cashId = byCode(cash, 'CASH').id;

    const unbalanced = await request(app).post('/api/v1/finance/journals').set(auth(session.accounts)).send({
      journalDate: '2026-11-11',
      description: 'This journal does not balance.',
      lines: [
        { accountId: expense, debit: 10, credit: 0 },
        { accountId: cashLedger, debit: 0, credit: 4 },
      ],
    });
    expect(unbalanced.status).toBe(422);
    expect(unbalanced.body.error.code).toBe('UNBALANCED_JOURNAL');

    const posted = await request(app).post('/api/v1/finance/journals').set(auth(session.accounts)).send({
      journalDate: '2026-11-11',
      description: 'Temporary cash movement.',
      lines: [
        { accountId: expense, debit: 25, credit: 0 },
        { accountId: cashLedger, debit: 0, credit: 25 },
      ],
    });
    expect(posted.status).toBe(201);
    const reversal = await request(app).post(`/api/v1/finance/journals/${posted.body.data.id}/reverse`).set(auth(session.accounts)).send({
      journalDate: '2026-11-11',
      description: 'Reverse the temporary movement.',
    });
    expect(reversal.status).toBe(201);
    const second = await request(app).post(`/api/v1/finance/journals/${posted.body.data.id}/reverse`).set(auth(session.accounts)).send({
      journalDate: '2026-11-11',
      description: 'A second reversal is not allowed.',
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_REVERSED');

    const supplier = await request(app).post('/api/v1/procurement/suppliers').set(auth(session.clerk)).send({ name: 'North Store' });
    expect(supplier.status).toBe(201);
    const invoice = await request(app).post('/api/v1/procurement/invoices').set(auth(session.clerk)).send({
      supplierId: supplier.body.data.id, invoiceNumber: 'NS-80', invoiceDate: '2026-11-11', amount: 80,
    });
    expect(invoice.status).toBe(201);
    const ledgerInvoice = await request(app).post(`/api/v1/finance/supplier-invoices/${invoice.body.data.id}/post`).set(auth(session.accounts)).send({
      expenseAccountId: expense,
    });
    expect(ledgerInvoice.status).toBe(201);
    const again = await request(app).post(`/api/v1/finance/supplier-invoices/${invoice.body.data.id}/post`).set(auth(session.accounts)).send({
      expenseAccountId: expense,
    });
    expect(again.status).toBe(409);

    const payment = await request(app).post('/api/v1/finance/payments').set(auth(session.clerk)).send({
      payee: 'North Store',
      purpose: 'Pay the seed invoice.',
      amount: 80,
      expenseAccountId: expense,
      cashAccountId: bankId,
      supplierInvoiceId: invoice.body.data.id,
    });
    expect(payment.status).toBe(201);
    expect(payment.body.data.status).toBe('submitted');
    const earlyPay = await request(app).post(`/api/v1/finance/payments/${payment.body.data.id}/pay`).set(auth(session.accounts));
    expect(earlyPay.status).toBe(409);
    // A routine payment within the manager's limit: manager approval and accounts verification, no CEO.
    await decide(session.ops, payment.body.data.approvalRequestId);
    const approved = await decide(session.accounts, payment.body.data.approvalRequestId);
    expect(approved).toBe('approved');
    const byRequester = await request(app).post(`/api/v1/finance/payments/${payment.body.data.id}/pay`).set(auth(session.clerk));
    expect(byRequester.status).toBe(403);
    const paid = await request(app).post(`/api/v1/finance/payments/${payment.body.data.id}/pay`).set(auth(session.accounts));
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');

    const budget = await request(app).post('/api/v1/finance/budgets').set(auth(session.ops)).send({
      departmentId: org.departmentId,
      ledgerAccountId: expense,
      budgetYear: 2026,
      amount: 500,
      purpose: 'Operating costs for the year.',
    });
    expect(budget.status).toBe(201);
    await decide(session.accounts, budget.body.data.approvalRequestId);
    const budgetStatus = await decide(session.ceo, budget.body.data.approvalRequestId);
    expect(budgetStatus).toBe('approved');
    const petty = await request(app).post('/api/v1/finance/petty').set(auth(session.accounts)).send({
      cashAccountId: pettyId,
      expenseAccountId: expense,
      departmentId: org.departmentId,
      journalDate: '2026-11-11',
      amount: 15,
      memo: 'Yard tools from petty cash.',
    });
    expect(petty.status).toBe(201);

    const customer = await request(app).post('/api/v1/finance/customers').set(auth(session.accounts)).send({ name: 'Yard Buyer' });
    expect(customer.status).toBe(201);
    const bill = await request(app).post('/api/v1/finance/customer-invoices').set(auth(session.accounts)).send({
      customerId: customer.body.data.id,
      invoiceDate: '2026-11-11',
      description: 'November yard services.',
      amount: 100,
    });
    expect(bill.status).toBe(201);
    const part = await request(app).post(`/api/v1/finance/customer-invoices/${bill.body.data.id}/receipts`).set(auth(session.accounts)).send({
      cashAccountId: cashId, amount: 40, receivedOn: '2026-11-11',
    });
    expect(part.status).toBe(201);
    expect(part.body.data.outstanding).toBe(60);
    const tooMuch = await request(app).post(`/api/v1/finance/customer-invoices/${bill.body.data.id}/receipts`).set(auth(session.accounts)).send({
      cashAccountId: cashId, amount: 70, receivedOn: '2026-11-11',
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.code).toBe('OVER_RECEIPT');
    const settled = await request(app).post(`/api/v1/finance/customer-invoices/${bill.body.data.id}/receipts`).set(auth(session.accounts)).send({
      cashAccountId: cashId, amount: 60, receivedOn: '2026-11-11',
    });
    expect(settled.body.data.status).toBe('paid');
    expect(settled.body.data.outstanding).toBe(0);
    const closed = await request(app).post(`/api/v1/finance/customer-invoices/${bill.body.data.id}/receipts`).set(auth(session.accounts)).send({
      cashAccountId: cashId, amount: 1, receivedOn: '2026-11-11',
    });
    expect(closed.status).toBe(409);

    const lines = await request(app).get(`/api/v1/finance/cash/${pettyId}/lines?to=2026-12-31`).set(auth(session.accounts));
    expect(lines.status).toBe(200);
    expect(lines.body.data).toHaveLength(1);
    const reconciled = await request(app).post(`/api/v1/finance/cash/${pettyId}/reconcile`).set(auth(session.accounts)).send({
      statementDate: '2026-12-31',
      statementBalance: -15,
      lineIds: [lines.body.data[0].id],
    });
    expect(reconciled.status).toBe(201);
    expect(reconciled.body.data.clearedBalance).toBe(-15);
    expect(reconciled.body.data.difference).toBe(0);

    const report = await request(app).get(`/api/v1/finance/reports?${range}`).set(auth(session.accounts));
    expect(report.status).toBe(200);
    const trial = report.body.data.trialBalance as Array<{ code: string; debit: number; credit: number }>;
    const debit = trial.reduce((sum, row) => sum + Math.round(row.debit * 100), 0);
    const credit = trial.reduce((sum, row) => sum + Math.round(row.credit * 100), 0);
    expect(debit).toBe(credit);
    expect(report.body.data.profitAndLoss.income).toBe(100);
    expect(report.body.data.profitAndLoss.expense).toBe(95);
    expect(report.body.data.profitAndLoss.net).toBe(5);
    const sheet = report.body.data.balanceSheet;
    expect(sheet.assets).toBe(sheet.liabilities + sheet.equity + sheet.currentEarnings);
    expect(report.body.data.payables).toEqual([]);
    expect(report.body.data.receivables).toEqual([]);
    expect(report.body.data.budgets).toEqual([expect.objectContaining({ account: '5000', amount: 500, actual: 15 })]);
    const csv = await request(app).get(`/api/v1/finance/reports.csv?${range}`).set(auth(session.accounts));
    expect(csv.text).toContain('profit,expense,95');
    const pdf = await request(app).get(`/api/v1/finance/reports.pdf?${range}`).set(auth(session.accounts));
    expect(pdf.status).toBe(200);
    expect(String(pdf.headers['content-type'])).toContain('pdf');
    const workbook = await request(app).get(`/api/v1/finance/reports.xlsx?${range}`).set(auth(session.accounts));
    expect(workbook.status).toBe(200);
    expect(String(workbook.headers['content-type'])).toContain('spreadsheet');

    const own = await request(app).post('/api/v1/finance/payments').set(auth(session.accounts)).send({
      payee: 'Local stationer',
      purpose: 'Accounts cannot approve this.',
      amount: 30,
      expenseAccountId: expense,
      cashAccountId: bankId,
    });
    expect(own.status).toBe(201);
    await decide(session.ops, own.body.data.approvalRequestId);
    const self = await request(app).post(`/api/v1/approvals/requests/${own.body.data.approvalRequestId}/decision`).set(auth(session.accounts)).send({
      action: 'approve', comment: 'Trying to verify my own payment.',
    });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('NOT_ASSIGNED');

    const dashboard = await request(app).get('/api/v1/dashboard/summary').set(auth(session.accounts));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.finance.pendingPayments).toBeGreaterThan(0);
    const adminHome = await request(app).get('/api/v1/dashboard/summary').set(auth(session.admin));
    expect(adminHome.body.data.finance).toBeUndefined();

    await expect(pool.query('DELETE FROM journals WHERE id = ?', [posted.body.data.id])).rejects.toThrow(/cannot be deleted/);
    await expect(pool.query('UPDATE journals SET description = ? WHERE id = ?', ['Changed after posting.', posted.body.data.id])).rejects.toThrow(/cannot be changed/);
    await expect(pool.query('UPDATE journal_lines SET debit = 1 WHERE journal_id = ?', [posted.body.data.id])).rejects.toThrow(/cannot be changed/);
  });
});
