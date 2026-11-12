import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { auth, closePool, createAccount, login, resetDatabase, testPassword } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

async function structure(token: string) {
  const branch = await request(app).post('/api/v1/organisation/branches').set(auth(token)).send({ code: 'HQ', name: 'Head Office' });
  const department = await request(app).post('/api/v1/organisation/departments').set(auth(token)).send({ code: 'HR', name: 'Human Resources' });
  const other = await request(app).post('/api/v1/organisation/departments').set(auth(token)).send({ code: 'FIN', name: 'Accounts and Finance' });
  const position = await request(app).post('/api/v1/organisation/positions').set(auth(token)).send({
    code: 'HR-OFFICER',
    title: 'HR Officer',
    departmentId: department.body.data.id,
  });
  const otherPosition = await request(app).post('/api/v1/organisation/positions').set(auth(token)).send({
    code: 'ACCT',
    title: 'Accounts Officer',
    departmentId: other.body.data.id,
  });
  return {
    branchId: branch.body.data.id as number,
    departmentId: department.body.data.id as number,
    otherDepartmentId: other.body.data.id as number,
    positionId: position.body.data.id as number,
    otherPositionId: otherPosition.body.data.id as number,
  };
}

describe('phase 1 access and organisation', () => {
  it('lets a system administrator create a department and records the audit', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    const token = await login(app, 'sysadmin');
    const created = await request(app).post('/api/v1/organisation/departments').set(auth(token)).send({
      code: 'OPS',
      name: 'Operations',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Operations');

    const position = await request(app).post('/api/v1/organisation/positions').set(auth(token)).send({
      code: 'OPS-MANAGER',
      title: 'Operations Manager',
      departmentId: created.body.data.id,
      isManagerial: true,
    });
    expect(position.status).toBe(201);

    const audit = await request(app).get('/api/v1/audit').set(auth(token));
    expect(audit.status).toBe(200);
    expect(audit.body.data.some((entry: { action: string }) => entry.action === 'department.create')).toBe(true);
    const tamper = await request(app).patch(`/api/v1/audit/${audit.body.data[0].id}`).set(auth(token)).send({ action: 'tamper' });
    expect(tamper.status).toBe(405);
    await expect(pool.query('DELETE FROM audit_logs WHERE id = ?', [audit.body.data[0].id])).rejects.toThrow();
  });

  it('stops a department manager from restructuring the organisation directly', async () => {
    await createAccount('hrm', 'HR_MANAGER');
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    const hrToken = await login(app, 'hrm');
    const adminToken = await login(app, 'sysadmin');

    const denied = await request(app).post('/api/v1/organisation/departments').set(auth(hrToken)).send({ code: 'NEW', name: 'New Unit' });
    expect(denied.status).toBe(403);

    const requestChange = await request(app).post('/api/v1/organisation/change-requests').set(auth(hrToken)).send({
      changeType: 'create_department',
      reason: 'Operations needs a planning desk.',
      payload: { code: 'OPS-PLAN', name: 'Operations Planning' },
    });
    expect(requestChange.status).toBe(201);

    const selfImplement = await request(app)
      .post(`/api/v1/organisation/change-requests/${requestChange.body.data.id}/implement`)
      .set(auth(hrToken));
    expect(selfImplement.status).toBe(403);

    const implemented = await request(app)
      .post(`/api/v1/organisation/change-requests/${requestChange.body.data.id}/implement`)
      .set(auth(adminToken));
    expect(implemented.status).toBe(200);
    const departments = await request(app).get('/api/v1/organisation/departments?search=OPS-PLAN').set(auth(adminToken));
    expect(departments.body.data).toHaveLength(1);
  });

  it('hides confidential employees from IT and preserves transfer history', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    const hrId = await createAccount('hrm', 'HR_MANAGER');
    await createAccount('it', 'IT_MARKETING_MANAGER');
    await createAccount('driver', 'DRIVER');
    const adminToken = await login(app, 'sysadmin');
    const hrToken = await login(app, 'hrm');
    const itToken = await login(app, 'it');
    const driverToken = await login(app, 'driver');
    const org = await structure(adminToken);

    const employee = await request(app).post('/api/v1/employees').set(auth(hrToken)).send({
      firstName: 'Test',
      lastName: 'Employee',
      employmentType: 'permanent',
      confidentialityLevel: 'confidential',
      nationalId: 'NID-10001',
      departmentId: org.departmentId,
      positionId: org.positionId,
      branchId: org.branchId,
      assignmentStartDate: '2026-01-15',
    });
    expect(employee.status).toBe(201);
    const employeeId = employee.body.data.id as number;
    const officer = await request(app).post('/api/v1/employees').set(auth(hrToken)).send({
      firstName: 'Test',
      lastName: 'Officer',
      employmentType: 'permanent',
      departmentId: org.departmentId,
      positionId: org.positionId,
      branchId: org.branchId,
      assignmentStartDate: '2026-01-15',
    });
    expect(officer.status).toBe(201);
    const linked = await request(app).patch(`/api/v1/users/${hrId}`).set(auth(adminToken)).send({ employeeId: officer.body.data.id });
    expect(linked.status).toBe(200);

    const itView = await request(app).get(`/api/v1/employees/${employeeId}`).set(auth(itToken));
    expect(itView.status).toBe(404);
    const itList = await request(app).get('/api/v1/employees').set(auth(itToken));
    expect(itList.status).toBe(403);

    const hrView = await request(app).get(`/api/v1/employees/${employeeId}`).set(auth(hrToken));
    expect(hrView.status).toBe(200);
    expect(hrView.body.data.nationalId).toBe('NID-10001');

    const driverView = await request(app).get(`/api/v1/employees/${employeeId}`).set(auth(driverToken));
    expect(driverView.status).toBe(404);

    const transfer = await request(app).post(`/api/v1/employees/${employeeId}/transfers`).set(auth(hrToken)).send({
      departmentId: org.otherDepartmentId,
      positionId: org.otherPositionId,
      branchId: org.branchId,
      startDate: '2026-06-01',
      reason: 'Transfer to accounts for the season.',
    });
    expect(transfer.status).toBe(200);
    expect(transfer.body.data.assignments).toHaveLength(2);
    const closed = transfer.body.data.assignments.find((item: { endDate: string | null }) => item.endDate);
    const current = transfer.body.data.assignments.find((item: { endDate: string | null }) => !item.endDate);
    expect(closed.departmentName).toBe('Human Resources');
    expect(current.departmentName).toBe('Accounts and Finance');
    expect(String(closed.endDate).slice(0, 10)).toBe('2026-05-31');
  });

  it('stops a system administrator granting expenditure authority to themselves', async () => {
    const adminId = await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    await createAccount('ceo', 'CEO');
    const adminToken = await login(app, 'sysadmin');
    const ceoToken = await login(app, 'ceo');
    const roles = await request(app).get('/api/v1/roles').set(auth(adminToken));
    const ceoRole = roles.body.data.find((role: { code: string }) => role.code === 'CEO');
    const adminRole = roles.body.data.find((role: { code: string }) => role.code === 'SYSTEM_ADMINISTRATOR');

    const grant = await request(app).put(`/api/v1/roles/${adminRole.id}/permissions`).set(auth(adminToken)).send({
      permissions: [...adminRole.permissions.map((permission: { code: string }) => permission.code), 'finance.approve_expenditure'],
    });
    expect(grant.status).toBe(403);

    const selfAssign = await request(app).post(`/api/v1/users/${adminId}/roles`).set(auth(adminToken)).send({
      roleId: ceoRole.id,
      scopeType: 'global',
      reason: 'Trying to grant myself expenditure authority.',
    });
    expect(selfAssign.status).toBe(403);

    const summary = await request(app).get('/api/v1/dashboard/summary').set(auth(ceoToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.employees).toBeUndefined();
    expect(summary.body.data.revenue).toBeUndefined();
  });

  it('rejects an invalid login and does not reveal which part failed', async () => {
    await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
    const response = await request(app).post('/api/v1/auth/login').send({ username: 'sysadmin', password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid username or password.');
    expect(testPassword.length).toBeGreaterThan(8);
  });
});
