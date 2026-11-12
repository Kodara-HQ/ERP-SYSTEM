import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { execute } from '../src/database/query';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

async function hire(hr: string, admin: string, userId: number, input: {
  firstName: string;
  lastName: string;
  departmentId: number;
  positionId: number;
  branchId: number;
  supervisorEmployeeId?: number;
}) {
  const employee = await request(app).post('/api/v1/employees').set(auth(hr)).send({
    firstName: input.firstName,
    lastName: input.lastName,
    employmentType: 'permanent',
    departmentId: input.departmentId,
    positionId: input.positionId,
    branchId: input.branchId,
    supervisorEmployeeId: input.supervisorEmployeeId,
    assignmentStartDate: '2026-01-15',
  });
  expect(employee.status).toBe(201);
  const linked = await request(app).patch(`/api/v1/users/${userId}`).set(auth(admin)).send({ employeeId: employee.body.data.id });
  expect(linked.status).toBe(200);
  return employee.body.data.id as number;
}

async function workspaces(departmentId: number, codes: string[]) {
  for (const code of codes) {
    await execute(pool, 'INSERT INTO department_workspaces (department_id, workspace_code) VALUES (?, ?)', [departmentId, code]);
  }
}

describe('department visibility', () => {
  it('keeps a department inside its own records and lets the administrator and system administrator see further', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    await createAccount('hrm', 'HR_MANAGER');
    const opsId = await createAccount('ops', 'OPERATIONS_MANAGER');
    const clerkId = await createAccount('clerk', 'PURCHASE_CLERK');
    const otherId = await createAccount('other', 'PURCHASE_CLERK');
    const accountsId = await createAccount('accounts', 'ACCOUNTS_OFFICER');
    await createAccount('ceo', 'CEO');
    const admin = await login(app, 'sysadmin');
    const hr = await login(app, 'hrm');
    const ops = await login(app, 'ops');
    const clerk = await login(app, 'clerk');
    const other = await login(app, 'other');
    const accounts = await login(app, 'accounts');

    const branch = await request(app).post('/api/v1/organisation/branches').set(auth(admin)).send({ code: 'HQ', name: 'Head Office' });
    const operations = await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: 'OPS', name: 'Operations' });
    const buying = await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: 'PROC', name: 'Procurement' });
    const finance = await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: 'FIN', name: 'Finance' });
    const lead = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
      code: 'LEAD', title: 'Operations Lead', departmentId: operations.body.data.id, isManagerial: true,
    });
    const clerkPosition = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
      code: 'CLERK', title: 'Purchase Clerk', departmentId: operations.body.data.id,
    });
    const buyerPosition = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
      code: 'BUYER', title: 'Buyer', departmentId: buying.body.data.id,
    });
    const financePosition = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
      code: 'FIN-CLERK', title: 'Finance Clerk', departmentId: finance.body.data.id,
    });
    await workspaces(operations.body.data.id, ['procurement', 'people']);
    await workspaces(buying.body.data.id, ['procurement', 'people']);
    await workspaces(finance.body.data.id, ['finance', 'people']);
    const place = { branchId: branch.body.data.id as number };
    const leadId = await hire(hr, admin, opsId, { firstName: 'Test', lastName: 'Lead', ...place, departmentId: operations.body.data.id, positionId: lead.body.data.id });
    await hire(hr, admin, clerkId, { firstName: 'Test', lastName: 'Clerk', ...place, departmentId: operations.body.data.id, positionId: clerkPosition.body.data.id, supervisorEmployeeId: leadId });
    await hire(hr, admin, otherId, { firstName: 'Test', lastName: 'Other', ...place, departmentId: buying.body.data.id, positionId: buyerPosition.body.data.id, supervisorEmployeeId: leadId });

    const ownRequest = await request(app).post('/api/v1/procurement/requisitions').set(auth(clerk)).send({
      purpose: 'Seed for the operations yard.',
      lines: [{ description: 'Seed bag', quantity: 2, estimatedUnitCost: 10 }],
    });
    expect(ownRequest.status).toBe(201);
    const otherRequest = await request(app).post('/api/v1/procurement/requisitions').set(auth(other)).send({
      purpose: 'Paper for the finance desk.',
      lines: [{ description: 'Paper', quantity: 1, estimatedUnitCost: 5 }],
    });
    expect(otherRequest.status).toBe(201);

    const clerkList = await request(app).get('/api/v1/procurement/requisitions').set(auth(clerk));
    expect(clerkList.body.data.map((row: { referenceNumber: string }) => row.referenceNumber)).toEqual([ownRequest.body.data.referenceNumber]);
    const managerList = await request(app).get('/api/v1/procurement/requisitions').set(auth(ops));
    expect(managerList.body.data.map((row: { referenceNumber: string }) => row.referenceNumber)).toEqual([ownRequest.body.data.referenceNumber]);
    const accountsList = await request(app).get('/api/v1/procurement/requisitions').set(auth(accounts));
    expect(accountsList.status).toBe(403);

    const clerkPeople = await request(app).get('/api/v1/employees').set(auth(clerk));
    expect(clerkPeople.status).toBe(403);
    const hrPeople = await request(app).get('/api/v1/employees').set(auth(hr));
    expect(hrPeople.body.data).toHaveLength(0);
    const adminPeople = await request(app).get('/api/v1/employees').set(auth(admin));
    expect(adminPeople.body.data).toHaveLength(3);

    const clerkDepartments = await request(app).get('/api/v1/organisation/departments').set(auth(clerk));
    expect(clerkDepartments.body.data.map((row: { code: string }) => row.code)).toEqual(['OPS']);
    const adminDepartments = await request(app).get('/api/v1/organisation/departments').set(auth(admin));
    expect(adminDepartments.body.data).toHaveLength(3);
    const ceo = await login(app, 'ceo');
    const ceoDepartments = await request(app).get('/api/v1/organisation/departments').set(auth(ceo));
    expect(ceoDepartments.body.data).toHaveLength(3);
    const ceoPeople = await request(app).get('/api/v1/employees').set(auth(ceo));
    expect(ceoPeople.status).toBe(403);

    const users = await request(app).get('/api/v1/users').set(auth(admin));
    expect(users.status).toBe(200);
    const hiddenUsers = await request(app).get('/api/v1/users').set(auth(hr));
    expect(hiddenUsers.status).toBe(403);
    const managerUsers = await request(app).get('/api/v1/users').set(auth(ops));
    expect(managerUsers.status).toBe(403);
    const financeBooks = await request(app).get('/api/v1/finance/journals').set(auth(admin));
    expect(financeBooks.status).toBe(403);

    const accountsDash = await request(app).get('/api/v1/dashboard/summary').set(auth(accounts));
    expect(accountsDash.body.data.departments).toBeUndefined();
    expect(accountsDash.body.data.positions).toBeUndefined();
    expect(accountsDash.body.data.finance).toBeUndefined();
    expect(accountsDash.body.data.procurement).toBeUndefined();
    const adminDash = await request(app).get('/api/v1/dashboard/summary').set(auth(admin));
    expect(adminDash.body.data.departments).toBe(3);
    expect(adminDash.body.data.positions).toBeGreaterThan(0);

    const blockedBooks = await request(app).get('/api/v1/finance/journals').set(auth(accounts));
    expect(blockedBooks.status).toBe(403);
    await hire(hr, admin, accountsId, { firstName: 'Test', lastName: 'Accounts', ...place, departmentId: finance.body.data.id, positionId: financePosition.body.data.id });
    const books = await request(app).get('/api/v1/finance/journals').set(auth(accounts));
    expect(books.status).toBe(200);
    const stillPurchasing = await request(app).get('/api/v1/procurement/requisitions').set(auth(accounts));
    expect(stillPurchasing.status).toBe(403);
    const hrDesk = await request(app).get('/api/v1/hr/reports').set(auth(accounts));
    expect(hrDesk.status).toBe(403);
  });
});
