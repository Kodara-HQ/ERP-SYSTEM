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

/** Links an account to a new employee in its own department, so its department workspaces apply. */
async function place(admin: string, hr: string, userId: number, name: string) {
  const branch = await request(app).post('/api/v1/organisation/branches').set(auth(admin)).send({ code: `B-${name}`, name });
  const department = await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: `D-${name}`, name });
  const position = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({ code: `P-${name}`, title: name, departmentId: department.body.data.id });
  const employee = await request(app).post('/api/v1/employees').set(auth(hr)).send({
    firstName: 'Test', lastName: name, employmentType: 'permanent',
    departmentId: department.body.data.id, positionId: position.body.data.id, branchId: branch.body.data.id, assignmentStartDate: '2026-01-15',
  });
  expect(employee.status).toBe(201);
  const linked = await request(app).patch(`/api/v1/users/${userId}`).set(auth(admin)).send({ employeeId: employee.body.data.id });
  expect(linked.status).toBe(200);
}

describe('Role dashboards', () => {
  it('gives the CEO, finance, operations and HR the figures their dashboards draw', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    await createAccount('ceo', 'CEO');
    const hrId = await createAccount('hrm', 'HR_MANAGER');
    const accountsId = await createAccount('accounts', 'ACCOUNTS_OFFICER');
    const opsId = await createAccount('ops', 'OPERATIONS_MANAGER');
    const admin = await login(app, 'sysadmin');
    const hrToken = await login(app, 'hrm');
    await place(admin, hrToken, hrId, 'Hr');
    await place(admin, hrToken, accountsId, 'Accounts');
    await place(admin, hrToken, opsId, 'Operations');

    const ceo = await request(app).get('/api/v1/dashboard/summary').set(auth(await login(app, 'ceo')));
    expect(ceo.status).toBe(200);
    expect(ceo.body.data.financeTrend).toHaveLength(6);
    expect(ceo.body.data.budgetUse).toEqual(expect.objectContaining({ budget: expect.any(Number), spent: expect.any(Number) }));
    expect(Array.isArray(ceo.body.data.departmentTasks)).toBe(true);

    const finance = await request(app).get('/api/v1/dashboard/summary').set(auth(await login(app, 'accounts')));
    expect(finance.status).toBe(200);
    expect(finance.body.data.financeTrend).toHaveLength(6);
    expect(finance.body.data.financeDetail).toEqual(expect.objectContaining({ receivables: 0, payables: 0, expenseByDepartment: [] }));
    expect(finance.body.data.executive).toBeUndefined();

    const ops = await request(app).get('/api/v1/dashboard/summary').set(auth(await login(app, 'ops')));
    expect(ops.status).toBe(200);
    expect(ops.body.data.operationsDetail.trend).toHaveLength(6);
    expect(ops.body.data.operationsDetail).toEqual(expect.objectContaining({ activitiesToday: 0, areas: [], alerts: [] }));

    const hr = await request(app).get('/api/v1/dashboard/summary').set(auth(await login(app, 'hrm')));
    expect(hr.status).toBe(200);
    expect(hr.body.data.hrDetail.attendance).toHaveLength(7);
    expect(hr.body.data.hrDetail.hiredThisYear).toBeGreaterThanOrEqual(0);
  });
});
