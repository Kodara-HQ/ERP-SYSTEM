import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

async function tokens() {
  await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
  const hrId = await createAccount('hrm', 'HR_MANAGER');
  const accountsId = await createAccount('accounts', 'ACCOUNTS_OFFICER');
  const legalId = await createAccount('legal', 'LEGAL_AFFAIRS');
  const opsId = await createAccount('ops', 'OPERATIONS_MANAGER');
  await createAccount('ceo', 'CEO');
  await createAccount('it', 'IT_MARKETING_MANAGER');
  return {
    hrId, accountsId, legalId, opsId,
    admin: await login(app, 'sysadmin'),
    hr: await login(app, 'hrm'),
    accounts: await login(app, 'accounts'),
    legal: await login(app, 'legal'),
    ops: await login(app, 'ops'),
    ceo: await login(app, 'ceo'),
    it: await login(app, 'it'),
  };
}

async function place(session: Awaited<ReturnType<typeof tokens>>, userId: number, name: string) {
  const branch = await request(app).post('/api/v1/organisation/branches').set(auth(session.admin)).send({ code: `B-${name}`, name });
  const department = await request(app).post('/api/v1/organisation/departments').set(auth(session.admin)).send({ code: `D-${name}`, name });
  const position = await request(app).post('/api/v1/organisation/positions').set(auth(session.admin)).send({ code: `P-${name}`, title: name, departmentId: department.body.data.id });
  const employee = await request(app).post('/api/v1/employees').set(auth(session.hr)).send({
    firstName: 'Test', lastName: name, employmentType: 'permanent',
    departmentId: department.body.data.id, positionId: position.body.data.id, branchId: branch.body.data.id, assignmentStartDate: '2026-01-15',
  });
  expect(employee.status).toBe(201);
  const linked = await request(app).patch(`/api/v1/users/${userId}`).set(auth(session.admin)).send({ employeeId: employee.body.data.id });
  expect(linked.status).toBe(200);
  return { employeeId: employee.body.data.id as number, departmentId: department.body.data.id as number, positionId: position.body.data.id as number, branchId: branch.body.data.id as number };
}

describe('enterprise workflows', () => {
  it('pays salaries only after HR, accounts, and the CEO, and keeps a failed payment visible', async () => {
    const session = await tokens();
    const hrPlace = await place(session, session.hrId, 'Hr');
    await place(session, session.accountsId, 'Accounts');
    const other = await request(app).post('/api/v1/employees').set(auth(session.hr)).send({
      firstName: 'Ama', lastName: 'Second', employmentType: 'permanent', phone: '024 412 3456',
      departmentId: hrPlace.departmentId, positionId: hrPlace.positionId, branchId: hrPlace.branchId, assignmentStartDate: '2026-01-15',
    });
    expect(other.status).toBe(201);
    for (const employeeId of [hrPlace.employeeId, other.body.data.id]) {
      const salary = await request(app).post('/api/v1/payroll/compensation').set(auth(session.hr)).send({
        employeeId, effectiveFrom: '2026-01-01', basicSalary: 1000, allowances: 100, deductions: 50,
      });
      expect(salary.status).toBe(201);
    }
    const blocked = await request(app).get('/api/v1/payroll').set(auth(session.it));
    expect(blocked.status).toBe(403);

    // An HR officer prepares payroll; the HR Manager reviews and submits it.
    const officerId = await createAccount('hrofficer', 'HR_OFFICER');
    const officerEmployee = await request(app).post('/api/v1/employees').set(auth(session.hr)).send({
      firstName: 'Esi', lastName: 'Officer', employmentType: 'permanent',
      departmentId: hrPlace.departmentId, positionId: hrPlace.positionId, branchId: hrPlace.branchId, assignmentStartDate: '2026-01-15',
    });
    expect((await request(app).patch(`/api/v1/users/${officerId}`).set(auth(session.admin)).send({ employeeId: officerEmployee.body.data.id })).status).toBe(200);
    await request(app).post('/api/v1/payroll/compensation').set(auth(session.hr)).send({
      employeeId: officerEmployee.body.data.id, effectiveFrom: '2026-01-01', basicSalary: 0, allowances: 0, deductions: 0,
    });
    const officer = await login(app, 'hrofficer');

    const managerDraft = await request(app).post('/api/v1/payroll').set(auth(session.hr)).send({ year: 2026, month: 5 });
    expect(managerDraft.status).toBe(201);
    const selfSubmit = await request(app).post(`/api/v1/payroll/${managerDraft.body.data.id}/submit`).set(auth(session.hr)).send();
    expect(selfSubmit.status).toBe(403);
    expect(selfSubmit.body.error.code).toBe('SEGREGATION_DENIED');

    const draft = await request(app).post('/api/v1/payroll').set(auth(officer)).send({ year: 2026, month: 6 });
    expect(draft.status).toBe(201);
    const id = draft.body.data.id as number;
    const officerSubmit = await request(app).post(`/api/v1/payroll/${id}/submit`).set(auth(officer)).send();
    expect(officerSubmit.status).toBe(403);
    const submitted = await request(app).post(`/api/v1/payroll/${id}/submit`).set(auth(session.hr)).send();
    expect(submitted.body.data.status).toBe('submitted_to_accounts');

    const returned = await request(app).post(`/api/v1/payroll/${id}/return`).set(auth(session.accounts)).send({ comment: 'Check the second deduction.' });
    expect(returned.body.data.status).toBe('returned_to_hr');
    const lineId = returned.body.data.lines[0].id as number;
    const denied = await request(app).patch(`/api/v1/payroll/${id}/lines`).set(auth(session.accounts)).send({
      lines: [{ id: lineId, basicSalary: 1000, allowances: 100, deductions: 80 }],
    });
    expect(denied.status).toBe(403);
    const corrected = await request(app).patch(`/api/v1/payroll/${id}/lines`).set(auth(session.hr)).send({
      lines: [{ id: lineId, basicSalary: 1000, allowances: 100, deductions: 80 }],
    });
    expect(corrected.status).toBe(200);
    const resubmitted = await request(app).post(`/api/v1/payroll/${id}/resubmit`).set(auth(session.hr)).send();
    expect(resubmitted.body.data.status).toBe('submitted_to_accounts');
    expect((await request(app).post(`/api/v1/payroll/${id}/review`).set(auth(session.accounts)).send()).body.data.status).toBe('under_accounts_review');
    expect((await request(app).post(`/api/v1/payroll/${id}/forward`).set(auth(session.accounts)).send()).body.data.status).toBe('submitted_for_ceo');
    const early = await request(app).post(`/api/v1/payroll/${id}/decision`).set(auth(session.accounts)).send({ action: 'approve', comment: 'Trying to approve payroll.' });
    expect(early.status).toBe(403);
    const approved = await request(app).post(`/api/v1/payroll/${id}/decision`).set(auth(session.ceo)).send({ action: 'approve', comment: 'Approved for payment.' });
    expect(approved.body.data.status).toBe('approved');
    expect((await request(app).post(`/api/v1/payroll/${id}/release`).set(auth(session.accounts)).send()).body.data.status).toBe('ready_for_payment');

    const detail = await request(app).get(`/api/v1/payroll/${id}`).set(auth(session.accounts));
    const lines = detail.body.data.lines as Array<{ id: number }>;
    const failed = await request(app).post(`/api/v1/payroll/${id}/failures`).set(auth(session.accounts)).send({ lineId: lines[1].id, reason: 'The bank rejected this salary.' });
    expect(failed.body.data.status).toBe('failed');
    const cash = await request(app).get('/api/v1/finance/cash').set(auth(session.accounts));
    const bank = cash.body.data.find((row: { code: string }) => row.code === 'BANK');
    const first = await request(app).post(`/api/v1/payroll/${id}/payments`).set(auth(session.accounts)).send({
      lineIds: [lines[0].id], cashAccountId: bank.id, paymentDate: '2026-06-15',
    });
    expect(first.status).toBe(201);
    expect((await request(app).get(`/api/v1/payroll/${id}`).set(auth(session.accounts))).body.data.status).toBe('partially_paid');
    const second = await request(app).post(`/api/v1/payroll/${id}/payments`).set(auth(session.accounts)).send({
      lineIds: [lines[1].id], cashAccountId: bank.id, paymentDate: '2026-06-15',
    });
    expect(second.status).toBe(201);
    const duplicate = await request(app).post(`/api/v1/payroll/${id}/payments`).set(auth(session.accounts)).send({
      lineIds: [lines[0].id], cashAccountId: bank.id, paymentDate: '2026-06-16',
    });
    expect(duplicate.status).toBe(409);
    const paidDetail = await request(app).get(`/api/v1/payroll/${id}`).set(auth(session.accounts));
    const smsByEmployee = new Map((paidDetail.body.data.lines as Array<{ employeeId: number; sms: { status: string; recipient: string | null } | null }>)
      .map((line) => [line.employeeId, line.sms]));
    expect(smsByEmployee.get(other.body.data.id)).toMatchObject({ status: 'sent', recipient: '233244123456' });
    expect(smsByEmployee.get(hrPlace.employeeId)).toMatchObject({ status: 'skipped', recipient: null });
    expect((await request(app).post(`/api/v1/payroll/${id}/complete`).set(auth(session.accounts)).send()).body.data.status).toBe('completed');
    const report = await request(app).get('/api/v1/finance/reports?financialYear=2026').set(auth(session.accounts));
    expect(report.body.data.profitAndLoss.expense).toBe(2070);
    expect(report.body.data.departmentalExpenditure.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0)).toBe(2070);
  });

  it('lets HR set the basic salary when registering an employee and keeps salary history', async () => {
    const session = await tokens();
    const hrPlace = await place(session, session.hrId, 'Hr');
    const created = await request(app).post('/api/v1/employees').set(auth(session.hr)).send({
      firstName: 'Kojo', lastName: 'Salaried', employmentType: 'permanent',
      departmentId: hrPlace.departmentId, positionId: hrPlace.positionId, branchId: hrPlace.branchId, assignmentStartDate: '2026-03-01',
      basicSalary: 2500, allowances: 300,
    });
    expect(created.status).toBe(201);
    const employeeId = created.body.data.id as number;
    const first = await request(app).get(`/api/v1/payroll/compensation/${employeeId}`).set(auth(session.hr));
    expect(first.body.data.current).toMatchObject({ basicSalary: 2500, allowances: 300, deductions: 0, effectiveFrom: '2026-03-01' });

    const raise = await request(app).post('/api/v1/payroll/compensation').set(auth(session.hr)).send({
      employeeId, effectiveFrom: '2026-07-01', basicSalary: 2800, allowances: 300, deductions: 0, notes: 'Annual review.',
    });
    expect(raise.status).toBe(201);
    const after = await request(app).get(`/api/v1/payroll/compensation/${employeeId}`).set(auth(session.hr));
    expect(after.body.data.current.basicSalary).toBe(2800);
    expect(after.body.data.history).toHaveLength(2);

    const blocked = await request(app).get(`/api/v1/payroll/compensation/${employeeId}`).set(auth(session.it));
    expect(blocked.status).toBe(403);
  });

  it('records legal clearance before the CEO and blocks execution until then', async () => {
    const session = await tokens();
    await place(session, session.hrId, 'Hr');
    await place(session, session.legalId, 'Legal');
    const created = await request(app).post('/api/v1/legal').set(auth(session.hr)).send({
      documentType: 'mou', title: 'Supply memorandum', counterparty: 'North Store', summary: 'Terms for the seed supply arrangement.',
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as number;
    expect((await request(app).post(`/api/v1/legal/${id}/submit`).set(auth(session.hr)).send()).body.data.status).toBe('in_review');
    const tooSoon = await request(app).post(`/api/v1/legal/${id}/execute`).set(auth(session.legal)).send();
    expect(tooSoon.status).toBe(409);
    const cleared = await request(app).post(`/api/v1/legal/${id}/review`).set(auth(session.legal)).send({
      action: 'approve', recommendation: 'recommend', comment: 'The memorandum is acceptable.',
    });
    expect(cleared.body.data.status).toBe('awaiting_ceo');
    expect(cleared.body.data.clearedAt).toBeTruthy();
    const approved = await request(app).post(`/api/v1/legal/${id}/review`).set(auth(session.ceo)).send({
      action: 'approve', recommendation: 'recommend', comment: 'Approved for execution.',
    });
    expect(approved.body.data.status).toBe('approved');
    expect((await request(app).post(`/api/v1/legal/${id}/execute`).set(auth(session.legal)).send()).body.data.status).toBe('executed');
    const hidden = await request(app).get('/api/v1/legal').set(auth(session.admin));
    expect(hidden.status).toBe(403);
  });

  it('lets the CEO assign a corrective action and the operations manager respond', async () => {
    const session = await tokens();
    await place(session, session.hrId, 'Hr');
    const ops = await place(session, session.opsId, 'Ops');
    const overview = await request(app).get('/api/v1/operations/overview').set(auth(session.ceo));
    expect(overview.status).toBe(200);
    const activity = await request(app).post('/api/v1/operations/activities').set(auth(session.ops)).send({
      activityDate: '2026-06-02', area: 'farm', summary: 'Morning field check completed.',
    });
    expect(activity.status).toBe(201);
    const review = await request(app).post('/api/v1/executive/reviews').set(auth(session.ceo)).send({
      departmentId: ops.departmentId, reviewDate: '2026-06-03', summary: 'Loading was behind the morning plan.',
      findings: [{ description: 'Two loads left the yard late.', severity: 'medium' }],
    });
    expect(review.status).toBe(201);
    const action = await request(app).post('/api/v1/executive/actions').set(auth(session.ceo)).send({
      reviewId: review.body.data.id, title: 'Confirm the loading roster before 07:00.', dueOn: '2026-06-10', assignedToUserId: session.opsId,
    });
    expect(action.status).toBe(201);
    const response = await request(app).post(`/api/v1/executive/actions/${action.body.data.id}/response`).set(auth(session.ops)).send({
      response: 'The roster is now checked before the first load.',
    });
    expect(response.body.data.status).toBe('responded');
    const closed = await request(app).post(`/api/v1/executive/actions/${action.body.data.id}/resolve`).set(auth(session.ceo)).send({
      status: 'resolved', reviewNote: 'The late loads have been addressed.',
    });
    expect(closed.body.data.status).toBe('resolved');
    const outsider = await request(app).post('/api/v1/executive/reviews').set(auth(session.ops)).send({
      departmentId: ops.departmentId, reviewDate: '2026-06-04', summary: 'Operations cannot inspect itself as the CEO.',
    });
    expect(outsider.status).toBe(403);
  });
});
