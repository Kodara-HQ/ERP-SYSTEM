import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { execute, query, queryOne, scalar } from '../src/database/query';
import { seedOrganisation } from '../src/database/seed';
import type { RowDataPacket } from '../src/database/rows';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

/** Places a login in a real department and position from the seeded management structure. */
async function place(userId: number, departmentCode: string, positionCode: string, supervisorEmployeeId: number | null = null): Promise<number> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  const branch = await queryOne<RowDataPacket>(pool, `SELECT id FROM branches WHERE code = 'HQ'`)
    ?? { id: (await execute(pool, `INSERT INTO branches (company_id, code, name, status) VALUES (?, 'HQ', 'Head Office', 'active')`, [company!.id])).insertId };
  const department = await queryOne<RowDataPacket>(pool, 'SELECT id FROM departments WHERE code = ?', [departmentCode]);
  const position = await queryOne<RowDataPacket>(pool, 'SELECT id FROM positions WHERE code = ?', [positionCode]);
  const number = await scalar(pool, 'SELECT COUNT(*) FROM employees');
  const employee = await execute(
    pool,
    `INSERT INTO employees (company_id, employee_number, first_name, last_name, employment_status) VALUES (?, ?, ?, ?, 'active')`,
    [company!.id, `T-${number + 1}`, 'Staff', positionCode],
  );
  await execute(
    pool,
    `INSERT INTO employee_assignments (employee_id, department_id, position_id, branch_id, supervisor_employee_id, is_primary, start_date)
     VALUES (?, ?, ?, ?, ?, 1, '2026-01-01')`,
    [employee.insertId, department!.id, position!.id, branch.id, supervisorEmployeeId],
  );
  await execute(pool, 'UPDATE users SET employee_id = ? WHERE id = ?', [employee.insertId, userId]);
  return employee.insertId;
}

async function company() {
  await seedOrganisation();
  await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
  await createAccount('ceo', 'CEO');
  const ids = {
    hrm: await createAccount('hrm', 'HR_MANAGER'),
    hro: await createAccount('hro', 'HR_OFFICER'),
    fin: await createAccount('fin', 'ACCOUNTS_OFFICER'),
    finclerk: await createAccount('finclerk', 'ACCOUNTS_CLERK'),
    ops: await createAccount('ops', 'OPERATIONS_MANAGER'),
    proc: await createAccount('proc', 'PROCUREMENT_OFFICER'),
    store: await createAccount('store', 'STOREKEEPER'),
    driver: await createAccount('driver', 'DRIVER'),
    legal: await createAccount('legal', 'LEGAL_AFFAIRS'),
    itm: await createAccount('itm', 'IT_MARKETING_MANAGER'),
    itoff: await createAccount('itoff', 'IT_OFFICER'),
  };
  const hrmEmployee = await place(ids.hrm, 'HR', 'HR-MANAGER');
  await place(ids.hro, 'HR', 'HR-OFFICER', hrmEmployee);
  const finEmployee = await place(ids.fin, 'FIN', 'ACCOUNTS-OFFICER');
  await place(ids.finclerk, 'FIN', 'ACCOUNTS-CLERK', finEmployee);
  const opsEmployee = await place(ids.ops, 'OPS', 'OPS-MANAGER');
  await place(ids.proc, 'OPS-PROC', 'PROCUREMENT-OFFICER', opsEmployee);
  await place(ids.store, 'OPS-STORES', 'STOREKEEPER', opsEmployee);
  const driverEmployee = await place(ids.driver, 'OPS-HAUL', 'DRIVER', opsEmployee);
  await place(ids.legal, 'LEG', 'LEGAL-OFFICER');
  const itmEmployee = await place(ids.itm, 'ITM', 'IT-MARKETING-MANAGER');
  await place(ids.itoff, 'ITM-IT', 'IT-OFFICER', itmEmployee);
  const tokens: Record<string, string> = {};
  for (const name of ['sysadmin', 'ceo', ...Object.keys(ids)]) tokens[name] = await login(app, name);
  const department = async (code: string) => Number((await queryOne<RowDataPacket>(pool, 'SELECT id FROM departments WHERE code = ?', [code]))!.id);
  return { ids, t: tokens, driverEmployee, department };
}

const decide = (token: string, id: number, action = 'approve', comment?: string) =>
  request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(token)).send({ action, comment });

const steps = async (token: string, id: number) =>
  (await request(app).get(`/api/v1/approvals/requests/${id}`).set(auth(token))).body.data.steps as Array<{ name: string; roleCode: string | null; status: string; addedReason: string | null }>;

describe('configurable approval hierarchy', () => {
  it('keeps routine spending with the manager and escalates by threshold, limit, and special approval', async () => {
    const { t, department } = await company();
    const opsProc = await department('OPS-PROC');
    const raise = (amount: number, specialApproval = false) => request(app).post('/api/v1/approvals/requests').set(auth(t.proc)).send({
      workflowCode: 'PAYMENT', title: `Payment of ${amount}`, amount, departmentId: opsProc, specialApproval, submit: true,
    });

    const routine = await raise(500);
    expect(routine.status).toBe(201);
    expect((await steps(t.proc, routine.body.data.id)).some((step) => step.roleCode === 'CEO')).toBe(false);
    expect((await decide(t.ops, routine.body.data.id)).status).toBe(200);
    const done = await decide(t.fin, routine.body.data.id);
    expect(done.body.data.status).toBe('approved');

    const aboveLimit = await raise(15000);
    const limitSteps = await steps(t.proc, aboveLimit.body.data.id);
    expect(limitSteps.at(-1)).toMatchObject({ roleCode: 'CEO' });
    expect(limitSteps.at(-1)!.addedReason).toMatch(/approval limit of 10000.00/);

    const major = await raise(25000);
    const majorSteps = await steps(t.proc, major.body.data.id);
    expect(majorSteps.at(-1)!.addedReason).toMatch(/executive approval threshold of 20000.00/);
    expect((await decide(t.ops, major.body.data.id)).status).toBe(200);
    expect((await decide(t.fin, major.body.data.id)).status).toBe(200);
    expect((await decide(t.sysadmin, major.body.data.id)).status).toBe(403);
    const final = await decide(t.ceo, major.body.data.id);
    expect(final.body.data.status).toBe('approved');

    const special = await raise(100, true);
    expect((await steps(t.proc, special.body.data.id)).at(-1)!.addedReason).toMatch(/special management approval/);

    // The company threshold is configuration: lowering it brings the CEO into a smaller payment.
    expect((await request(app).put('/api/v1/governance/settings').set(auth(t.ceo)).send({ executiveThreshold: 400 })).status).toBe(403);
    const changed = await request(app).put('/api/v1/governance/settings').set(auth(t.sysadmin)).send({ executiveThreshold: 400 });
    expect(changed.body.data.executiveThreshold).toBe(400);
    const nowExecutive = await raise(500);
    expect((await steps(t.proc, nowExecutive.body.data.id)).at(-1)!.roleCode).toBe('CEO');
    const audit = await queryOne<RowDataPacket>(pool, `SELECT previous_value, new_value FROM audit_logs WHERE action = 'governance.settings' ORDER BY id DESC LIMIT 1`);
    expect(JSON.stringify(audit!.previous_value)).toContain('20000');
    expect(await scalar(pool, `SELECT COUNT(*) FROM notifications WHERE notification_type = 'governance.changed'`)).toBeGreaterThan(0);
  });

  it('keeps verification independent of approval and lets only an administrator change the rules', async () => {
    const { t, department } = await company();
    const fin = await department('FIN');
    const created = await request(app).post('/api/v1/approvals/requests').set(auth(t.finclerk)).send({
      workflowCode: 'PAYMENT', title: 'Bank charges', amount: 300, departmentId: fin, submit: true,
    });
    const route = await steps(t.finclerk, created.body.data.id);
    // The finance manager is both the department manager and the only verifier, so the approval goes to the CEO.
    expect(route[0]).toMatchObject({ name: 'Department manager', roleCode: 'CEO' });
    expect(route[0]!.addedReason).toMatch(/verification stays independent/);

    const rules = await request(app).get('/api/v1/governance/segregation-rules').set(auth(t.ceo));
    expect(rules.status).toBe(200);
    expect(rules.body.data.find((rule: { code: string }) => rule.code === 'SELF_APPROVAL')).toMatchObject({ enabled: true, locked: true });
    expect((await request(app).put('/api/v1/governance/segregation-rules/VERIFIER_NOT_APPROVER').set(auth(t.ceo)).send({ enabled: false, reason: 'Trying to relax it.' })).status).toBe(403);
    expect((await request(app).put('/api/v1/governance/segregation-rules/SELF_APPROVAL').set(auth(t.sysadmin)).send({ enabled: false, reason: 'Trying to relax it.' })).status).toBe(422);
    const off = await request(app).put('/api/v1/governance/segregation-rules/VERIFIER_NOT_APPROVER').set(auth(t.sysadmin)).send({ enabled: false, reason: 'Single-person finance office this month.' });
    expect(off.status).toBe(200);
    const second = await request(app).post('/api/v1/approvals/requests').set(auth(t.finclerk)).send({
      workflowCode: 'PAYMENT', title: 'Bank charges again', amount: 300, departmentId: fin, submit: true,
    });
    expect((await steps(t.finclerk, second.body.data.id))[0]!.roleCode).toBeNull();
    expect((await decide(t.fin, second.body.data.id)).status).toBe(200);
    // Switched back on, the same person cannot also verify.
    await request(app).put('/api/v1/governance/segregation-rules/VERIFIER_NOT_APPROVER').set(auth(t.sysadmin)).send({ enabled: true, reason: 'Second accountant has started.' });
    const blocked = await decide(t.fin, second.body.data.id);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SEGREGATION_DENIED');
    expect(await scalar(pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'security.access_denied' AND new_value::text LIKE '%SEGREGATION_DENIED%'`)).toBeGreaterThan(0);
  });

  it('escalates a step that waits too long and records who acted', async () => {
    const { t, department } = await company();
    const created = await request(app).post('/api/v1/approvals/requests').set(auth(t.proc)).send({
      workflowCode: 'PAYMENT', title: 'Tyres', amount: 800, departmentId: await department('OPS-PROC'), submit: true,
    });
    const id = created.body.data.id as number;
    expect((await decide(t.ceo, id)).status).toBe(403);
    await execute(pool, `UPDATE approval_request_steps SET activated_at = CURRENT_TIMESTAMP - INTERVAL '100 hours' WHERE request_id = ? AND status = 'pending'`, [id]);
    expect((await request(app).post('/api/v1/approvals/escalations/run').set(auth(t.ops)).send()).status).toBe(403);
    const run = await request(app).post('/api/v1/approvals/escalations/run').set(auth(t.sysadmin)).send();
    expect(run.body.data.escalated).toBe(1);
    expect((await decide(t.ceo, id)).status).toBe(200);
    const detail = await request(app).get(`/api/v1/approvals/requests/${id}`).set(auth(t.ceo));
    expect(detail.body.data.actions.map((action: { action: string }) => action.action)).toEqual(['submit', 'escalate', 'approve']);
    expect(detail.body.data.steps[0].escalatedAt).not.toBeNull();
    expect(await scalar(pool, `SELECT COUNT(*) FROM notifications WHERE notification_type = 'approval.escalated'`)).toBeGreaterThan(0);
  });

  it('requires a supporting document before verification or approval where the route asks for one', async () => {
    const { t, department } = await company();
    const workflows = await request(app).get('/api/v1/approvals/workflows').set(auth(t.sysadmin));
    const payment = workflows.body.data.find((row: { code: string }) => row.code === 'PAYMENT');
    expect((await request(app).patch(`/api/v1/approvals/workflows/${payment.id}`).set(auth(t.sysadmin)).send({ requiresSupportingDocument: true })).status).toBe(200);
    const created = await request(app).post('/api/v1/approvals/requests').set(auth(t.proc)).send({
      workflowCode: 'PAYMENT', title: 'Supplier deposit', amount: 900, departmentId: await department('OPS-PROC'), submit: true,
    });
    const id = created.body.data.id as number;
    const missing = await decide(t.ops, id);
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('DOCUMENT_REQUIRED');
    const content = Buffer.from('%PDF-1.4 quotation').toString('base64');
    const bad = await request(app).post(`/api/v1/approvals/requests/${id}/documents`).set(auth(t.proc)).send({ fileName: 'quote.exe', contentType: 'application/pdf', contentBase64: content });
    expect(bad.status).toBe(422);
    const stranger = await request(app).post(`/api/v1/approvals/requests/${id}/documents`).set(auth(t.legal)).send({ fileName: 'quote.pdf', contentType: 'application/pdf', contentBase64: content });
    expect(stranger.status).toBe(404);
    const attached = await request(app).post(`/api/v1/approvals/requests/${id}/documents`).set(auth(t.proc)).send({ fileName: 'quote.pdf', contentType: 'application/pdf', contentBase64: content });
    expect(attached.status).toBe(201);
    expect((await decide(t.ops, id)).status).toBe(200);
    const file = await request(app).get(`/api/v1/approvals/requests/${id}/documents/${attached.body.data.id}`).set(auth(t.fin)).buffer(true);
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body).toString()).toBe('%PDF-1.4 quotation');
    await expect(execute(pool, `UPDATE supporting_documents SET file_name = 'changed.pdf' WHERE id = ?`, [attached.body.data.id])).rejects.toThrow();
    await expect(execute(pool, 'DELETE FROM supporting_documents WHERE id = ?', [attached.body.data.id])).rejects.toThrow();
  });
});

describe('separation of duties in procurement', () => {
  it('lets procurement issue the order and only the storekeeper record goods received', async () => {
    const { t } = await company();
    const supplier = await request(app).post('/api/v1/procurement/suppliers').set(auth(t.ops)).send({ name: 'Bag Supplier' });
    const warehouse = await request(app).post('/api/v1/inventory/warehouses').set(auth(t.ops)).send({ code: 'MAIN', name: 'Main store' });
    const item = await request(app).post('/api/v1/inventory/items').set(auth(t.ops)).send({ sku: 'JUTE', name: 'Jute bag', unit: 'bag', reorderLevel: 0 });
    const requisition = await request(app).post('/api/v1/procurement/requisitions').set(auth(t.proc)).send({
      purpose: 'Jute bags for the raw nut season.',
      lines: [{ itemId: item.body.data.id, description: 'Jute bag', quantity: 10, estimatedUnitCost: 5 }],
    });
    expect(requisition.status).toBe(201);
    const approval = requisition.body.data.approvalRequestId as number;
    expect((await decide(t.ops, approval)).status).toBe(200);
    expect((await decide(t.fin, approval)).status).toBe(200);
    const approved = await decide(t.ops, approval);
    expect(approved.body.data.status).toBe('approved');
    const order = await request(app).post('/api/v1/procurement/orders').set(auth(t.proc)).send({
      requisitionId: requisition.body.data.id, supplierId: supplier.body.data.id,
      lines: [{ requisitionLineId: requisition.body.data.lines[0].id, unitCost: 5 }],
    });
    expect(order.status).toBe(201);
    const receipt = {
      purchaseOrderId: order.body.data.id, warehouseId: warehouse.body.data.id, receivedOn: '2026-11-12',
      lines: [{ orderLineId: order.body.data.lines[0].id, quantity: 10, damagedQuantity: 0 }],
    };
    const own = await request(app).post('/api/v1/procurement/receipts').set(auth(t.proc)).send(receipt);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('SEGREGATION_DENIED');
    const stored = await request(app).post('/api/v1/procurement/receipts').set(auth(t.store)).send(receipt);
    expect(stored.status).toBe(201);
  });
});

describe('departmental confidentiality', () => {
  it('keeps each department out of the others and gives the CEO company-wide visibility', async () => {
    const { t } = await company();
    expect((await request(app).get('/api/v1/finance/journals').set(auth(t.hrm))).status).toBe(403);
    expect((await request(app).get('/api/v1/finance/journals').set(auth(t.legal))).status).toBe(403);
    expect((await request(app).get('/api/v1/employees').set(auth(t.ops))).status).toBe(403);
    expect((await request(app).get('/api/v1/employees').set(auth(t.fin))).status).toBe(403);
    expect((await request(app).get('/api/v1/payroll').set(auth(t.itoff))).status).toBe(403);
    expect((await request(app).get('/api/v1/payroll').set(auth(t.ops))).status).toBe(403);
    expect((await request(app).get('/api/v1/registers/compliance').set(auth(t.itoff))).status).toBe(403);
    expect((await request(app).get('/api/v1/registers/compliance').set(auth(t.sysadmin))).status).toBe(403);
    expect((await request(app).get('/api/v1/registers/compliance').set(auth(t.fin))).status).toBe(403);
    expect((await request(app).get('/api/v1/registers/campaigns').set(auth(t.ops))).status).toBe(403);
    expect((await request(app).get('/api/v1/registers/quality_checks').set(auth(t.itm))).status).toBe(403);
    expect((await request(app).get('/api/v1/registers/campaigns').set(auth(t.itm))).status).toBe(200);
    expect((await request(app).get('/api/v1/registers/quality_checks').set(auth(t.ops))).status).toBe(200);
    expect((await request(app).get('/api/v1/registers/compliance').set(auth(t.legal))).status).toBe(200);

    expect((await request(app).get('/api/v1/finance/journals').set(auth(t.ceo))).status).toBe(200);
    expect((await request(app).get('/api/v1/registers/compliance').set(auth(t.ceo))).status).toBe(200);
    const registers = await request(app).get('/api/v1/registers').set(auth(t.ceo));
    expect(registers.body.data.length).toBe(14);
    const opsRegisters = await request(app).get('/api/v1/registers').set(auth(t.ops));
    expect(new Set(opsRegisters.body.data.map((row: { group: string }) => row.group))).toEqual(new Set(['Operations', 'IT']));
    expect(opsRegisters.body.data.find((row: { code: string }) => row.code === 'support_tickets').access).toBe('self');

    const denied = await scalar(pool, `SELECT COUNT(*) FROM audit_logs WHERE action = 'security.access_denied'`);
    expect(denied).toBeGreaterThanOrEqual(11);
  });

  it('lets staff raise IT support and see only their own requests', async () => {
    const { t } = await company();
    const ticket = await request(app).post('/api/v1/registers/support_tickets').set(auth(t.driver)).send({
      status: 'resolved',
      values: { title: 'Cannot open approvals', category: 'erp', priority: 'normal', description: 'The approvals page shows an error.' },
    });
    expect(ticket.status).toBe(201);
    expect(ticket.body.data.status).toBe('open');
    await request(app).post('/api/v1/registers/support_tickets').set(auth(t.store)).send({
      values: { title: 'Printer offline', category: 'hardware', priority: 'low', description: 'The store printer does not respond.' },
    });
    const mine = await request(app).get('/api/v1/registers/support_tickets').set(auth(t.driver));
    expect(mine.body.data).toHaveLength(1);
    const all = await request(app).get('/api/v1/registers/support_tickets').set(auth(t.itoff));
    expect(all.body.data).toHaveLength(2);
    expect((await request(app).patch(`/api/v1/registers/support_tickets/${ticket.body.data.id}`).set(auth(t.driver)).send({ status: 'closed' })).status).toBe(403);
    const resolved = await request(app).patch(`/api/v1/registers/support_tickets/${ticket.body.data.id}`).set(auth(t.itoff)).send({ status: 'resolved', values: { resolution: 'Cleared the browser cache.' } });
    expect(resolved.body.data.status).toBe('resolved');
    const audit = await queryOne<RowDataPacket>(pool, `SELECT previous_value, new_value FROM audit_logs WHERE action = 'register.support_tickets.update'`);
    expect(JSON.stringify(audit!.previous_value)).toContain('"status":"open"');
    expect(JSON.stringify(audit!.new_value)).toContain('Cleared the browser cache.');
  });

  it('keeps performance assessments between the manager, HR, the CEO, and the employee', async () => {
    const { t, driverEmployee } = await company();
    const assessed = await request(app).post('/api/v1/management/assessments').set(auth(t.ops)).send({
      employeeId: driverEmployee, periodStart: '2026-07-01', periodEnd: '2026-09-30', rating: 4, strengths: 'Safe and punctual.',
    });
    expect(assessed.status).toBe(201);
    const finClerk = await queryOne<RowDataPacket>(pool, `SELECT employee_id FROM users WHERE username = 'finclerk'`);
    expect((await request(app).post('/api/v1/management/assessments').set(auth(t.ops)).send({
      employeeId: Number(finClerk!.employee_id), periodStart: '2026-07-01', periodEnd: '2026-09-30', rating: 2,
    })).status).toBe(403);
    expect((await request(app).get('/api/v1/management/assessments').set(auth(t.fin))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/v1/management/assessments').set(auth(t.sysadmin))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/v1/management/assessments').set(auth(t.hrm))).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/management/assessments').set(auth(t.ceo))).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/management/assessments').set(auth(t.driver))).body.data).toHaveLength(1);
  });
});

describe('accounts not yet linked to an employee', () => {
  it('lets a new HR Manager set up the company and see every employee, without opening other departments', async () => {
    await seedOrganisation();
    await createAccount('newhr', 'HR_MANAGER');
    await createAccount('newops', 'OPERATIONS_MANAGER');
    const hr = await login(app, 'newhr');
    const ops = await login(app, 'newops');
    const me = await request(app).get('/api/v1/auth/me').set(auth(hr));
    expect(me.body.data.workspaces).toEqual(expect.arrayContaining(['hr', 'people']));
    expect(me.body.data.workspaces).not.toContain('finance');
    const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
    const branch = await execute(pool, `INSERT INTO branches (company_id, code, name, status) VALUES (?, 'HQ', 'Head Office', 'active')`, [company!.id]);
    const ops_dept = await queryOne<RowDataPacket>(pool, `SELECT id FROM departments WHERE code = 'OPS-HAUL'`);
    const driver = await queryOne<RowDataPacket>(pool, `SELECT id FROM positions WHERE code = 'DRIVER'`);
    const created = await request(app).post('/api/v1/employees').set(auth(hr)).send({
      firstName: 'Kwame', lastName: 'Driver', employmentType: 'permanent',
      departmentId: ops_dept!.id, positionId: driver!.id, branchId: branch.insertId, assignmentStartDate: '2026-11-01',
    });
    expect(created.status).toBe(201);
    const list = await request(app).get('/api/v1/employees').set(auth(hr));
    expect(list.body.data.map((row: { lastName: string }) => row.lastName)).toContain('Driver');
    const dashboard = await request(app).get('/api/v1/dashboard/summary').set(auth(hr));
    expect(dashboard.body.data.hr).toBeDefined();
    expect(dashboard.body.data.finance).toBeUndefined();
    expect((await request(app).get('/api/v1/finance/journals').set(auth(hr))).status).toBe(403);
    expect((await request(app).get('/api/v1/employees').set(auth(ops))).status).toBe(403);
  });
});

describe('accountability and reporting', () => {
  it('routes staff reports to their manager and departmental reports to the CEO', async () => {
    const { t } = await company();
    const daily = await request(app).post('/api/v1/management/reports').set(auth(t.driver)).send({
      periodType: 'daily', periodStart: '2026-11-12', periodEnd: '2026-11-12', title: 'Haulage day report',
      summary: 'Two trips to the processing yard, 18 tonnes delivered.', submit: true,
    });
    expect(daily.status).toBe(201);
    expect(daily.body.data).toMatchObject({ audience: 'manager', status: 'submitted' });
    expect((await request(app).post(`/api/v1/management/reports/${daily.body.data.id}/review`).set(auth(t.fin)).send({ action: 'reviewed' })).status).toBe(403);
    expect((await request(app).get(`/api/v1/management/reports/${daily.body.data.id}`).set(auth(t.fin))).status).toBe(404);
    const reviewed = await request(app).post(`/api/v1/management/reports/${daily.body.data.id}/review`).set(auth(t.ops)).send({ action: 'reviewed', comment: 'Good.' });
    expect(reviewed.body.data.status).toBe('reviewed');

    const monthly = await request(app).post('/api/v1/management/reports').set(auth(t.ops)).send({
      periodType: 'monthly', periodStart: '2026-10-01', periodEnd: '2026-10-31', title: 'Operations October',
      summary: 'Harvest closed at 410 tonnes; processing line two restarted.', submit: true,
    });
    expect(monthly.body.data.audience).toBe('ceo');
    expect((await request(app).post(`/api/v1/management/reports/${monthly.body.data.id}/review`).set(auth(t.ops)).send({ action: 'reviewed' })).status).toBe(403);
    const returned = await request(app).post(`/api/v1/management/reports/${monthly.body.data.id}/review`).set(auth(t.ceo)).send({ action: 'returned', comment: 'Add the fuel cost per tonne.' });
    expect(returned.body.data.status).toBe('returned');
    const ceoList = await request(app).get('/api/v1/management/reports').set(auth(t.ceo));
    expect(ceoList.body.data).toHaveLength(2);
    expect((await request(app).get('/api/v1/management/reports.xlsx').set(auth(t.ceo))).status).toBe(200);
    expect((await request(app).get('/api/v1/management/reports.pdf').set(auth(t.ops))).status).toBe(200);

    const opsDepartment = Number((await queryOne<RowDataPacket>(pool, `SELECT id FROM departments WHERE code = 'OPS'`))!.id);
    const target = await request(app).post('/api/v1/management/targets').set(auth(t.ops)).send({
      departmentId: opsDepartment, title: 'Raw nut processed', metric: 'Throughput', unit: 'tonnes', targetValue: 500, actualValue: 250,
      periodStart: '2026-10-01', periodEnd: '2026-12-31',
    });
    expect(target.status).toBe(201);
    expect(target.body.data.progress).toBe(50);
    const finDepartment = Number((await queryOne<RowDataPacket>(pool, `SELECT id FROM departments WHERE code = 'FIN'`))!.id);
    expect((await request(app).post('/api/v1/management/targets').set(auth(t.ops)).send({
      departmentId: finDepartment, title: 'Close the books', metric: 'Days', unit: 'days', targetValue: 5, periodStart: '2026-10-01', periodEnd: '2026-12-31',
    })).status).toBe(403);
    const performance = await request(app).get('/api/v1/management/performance').set(auth(t.ceo));
    expect(performance.body.data.find((row: { departmentName: string }) => row.departmentName === 'Operations').targetProgress).toBe(50);
    const opsView = await request(app).get('/api/v1/management/performance').set(auth(t.ops));
    expect(opsView.body.data.every((row: { departmentName: string }) => !['Accounts and Finance', 'Human Resources'].includes(row.departmentName))).toBe(true);
  });

  it('shows general company figures to everyone without confidential detail', async () => {
    const { t } = await company();
    expect((await request(app).post('/api/v1/management/announcements').set(auth(t.driver)).send({ title: 'Hello', body: 'Not allowed.' })).status).toBe(403);
    expect((await request(app).post('/api/v1/management/announcements').set(auth(t.hrm)).send({ title: 'Harvest season briefing', body: 'All staff meet at the yard on Monday.' })).status).toBe(201);
    const dashboard = await request(app).get('/api/v1/management/company-dashboard').set(auth(t.driver));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.headcount).toBe(11);
    expect(dashboard.body.data.announcements[0].title).toBe('Harvest season briefing');
    expect(JSON.stringify(dashboard.body.data)).not.toMatch(/salary|amount|journal/i);
    const chart = await request(app).get('/api/v1/governance/organisation-chart').set(auth(t.driver));
    const hrHead = chart.body.data.find((row: { code: string }) => row.code === 'HR-MANAGER');
    expect(hrHead).toMatchObject({ holderCount: 1, holders: [] });
    const ceoPosition = chart.body.data.find((row: { code: string }) => row.code === 'CEO');
    for (const head of ['HR-MANAGER', 'OPS-MANAGER', 'ACCOUNTS-OFFICER', 'LEGAL-OFFICER', 'IT-MARKETING-MANAGER']) {
      expect(chart.body.data.find((row: { code: string }) => row.code === head).reportsToPositionId).toBe(ceoPosition.id);
    }
    const hrChart = await request(app).get('/api/v1/governance/organisation-chart').set(auth(t.hrm));
    expect(hrChart.body.data.find((row: { code: string }) => row.code === 'HR-MANAGER').holders).toHaveLength(1);
  });

  it('keeps the audit trail immutable', async () => {
    await company();
    const rows = await query<RowDataPacket[]>(pool, 'SELECT id FROM audit_logs LIMIT 1');
    if (rows[0]) {
      await expect(execute(pool, `UPDATE audit_logs SET action = 'edited' WHERE id = ?`, [rows[0].id])).rejects.toThrow();
      await expect(execute(pool, 'DELETE FROM audit_logs WHERE id = ?', [rows[0].id])).rejects.toThrow();
    }
    await execute(pool, `INSERT INTO audit_logs (user_id, action, module, entity_type) VALUES (NULL, 'test.event', 'test', 'test')`);
    const row = await queryOne<RowDataPacket>(pool, `SELECT id FROM audit_logs WHERE action = 'test.event'`);
    await expect(execute(pool, `UPDATE audit_logs SET action = 'edited' WHERE id = ?`, [row!.id])).rejects.toThrow();
  });
});
