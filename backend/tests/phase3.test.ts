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
  const officerId = await createAccount('officer', 'HR_OFFICER');
  await createAccount('ceo', 'CEO');
  await createAccount('it', 'IT_MARKETING_MANAGER');
  const hrId = await createAccount('hrm', 'HR_MANAGER');
  const clerkId = await createAccount('clerk', 'PURCHASE_CLERK');
  return {
    hrId,
    officerId,
    clerkId,
    admin: await login(app, 'sysadmin'),
    hr: await login(app, 'hrm'),
    officer: await login(app, 'officer'),
    ceo: await login(app, 'ceo'),
    it: await login(app, 'it'),
    clerk: await login(app, 'clerk'),
  };
}

async function org(admin: string) {
  const branch = await request(app).post('/api/v1/organisation/branches').set(auth(admin)).send({ code: 'HQ', name: 'Head Office' });
  const department = await request(app).post('/api/v1/organisation/departments').set(auth(admin)).send({ code: 'OPS', name: 'Operations' });
  const clerkPosition = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
    code: 'CLERK',
    title: 'Purchase Clerk',
    departmentId: department.body.data.id,
  });
  const leadPosition = await request(app).post('/api/v1/organisation/positions').set(auth(admin)).send({
    code: 'LEAD',
    title: 'Supervisor',
    departmentId: department.body.data.id,
    isManagerial: true,
  });
  return {
    branchId: branch.body.data.id as number,
    departmentId: department.body.data.id as number,
    clerkPositionId: clerkPosition.body.data.id as number,
    leadPositionId: leadPosition.body.data.id as number,
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
  return employee.body.data.id as number;
}

async function placeHr(session: { hr: string; admin: string; hrId: number }, structure: { departmentId: number; leadPositionId: number; branchId: number }) {
  await hire(session.hr, session.admin, session.hrId, {
    firstName: 'Test',
    lastName: 'Officer',
    departmentId: structure.departmentId,
    positionId: structure.leadPositionId,
    branchId: structure.branchId,
  });
}

async function decide(token: string, id: number) {
  const response = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(token)).send({ action: 'approve', comment: 'Reviewed.' });
  expect(response.status).toBe(200);
  return response.body.data.status as string;
}

describe('phase 3 human resources', () => {
  it('approves five days of leave, deducts the balance, and refuses a request that exceeds it', async () => {
    const session = await tokens();
    const structure = await org(session.admin);
    await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test',
      lastName: 'Clerk',
      ...structure,
      positionId: structure.clerkPositionId,
    });
    const ceoUser = await request(app).get('/api/v1/auth/me').set(auth(session.ceo));
    await hire(session.hr, session.admin, ceoUser.body.data.id, {
      firstName: 'Test',
      lastName: 'Executive',
      ...structure,
      positionId: structure.leadPositionId,
    });

    const denied = await request(app).post('/api/v1/hr/leave').set(auth(session.admin)).send({
      leaveTypeCode: 'ANNUAL',
      startDate: '2026-11-16',
      endDate: '2026-11-20',
      reason: 'Annual rest days.',
    });
    expect(denied.status).toBe(403);

    const own = await request(app).post('/api/v1/hr/leave').set(auth(session.ceo)).send({
      leaveTypeCode: 'ANNUAL',
      startDate: '2026-11-16',
      endDate: '2026-11-20',
      reason: 'The executive is away.',
    });
    expect(own.status).toBe(422);
    expect(own.body.error.message).toMatch(/own request/i);

    const created = await request(app).post('/api/v1/hr/leave').set(auth(session.clerk)).send({
      leaveTypeCode: 'ANNUAL',
      startDate: '2026-11-16',
      endDate: '2026-11-20',
      reason: 'Annual rest days.',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.days).toBe(5);
    expect(created.body.data.status).toBe('submitted');
    await decide(session.hr, created.body.data.approvalRequestId);
    const approved = await decide(session.ceo, created.body.data.approvalRequestId);
    expect(approved).toBe('approved');

    const balances = await request(app).get('/api/v1/hr/leave/balances').set(auth(session.clerk));
    const annual = balances.body.data.find((row: { code: string }) => row.code === 'ANNUAL');
    expect(annual.used).toBe(5);
    expect(annual.available).toBe(16);

    const tooLong = await request(app).post('/api/v1/hr/leave').set(auth(session.clerk)).send({
      leaveTypeCode: 'ANNUAL',
      startDate: '2026-11-23',
      endDate: '2026-12-18',
      reason: 'A longer absence than the balance allows.',
    });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.code).toBe('INSUFFICIENT_LEAVE');
  });

  it('includes recorded attendance in the HR report', async () => {
    const session = await tokens();
    const structure = await org(session.admin);
    await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test',
      lastName: 'Clerk',
      ...structure,
      positionId: structure.clerkPositionId,
    });
    const recorded = await request(app).post('/api/v1/hr/attendance').set(auth(session.clerk)).send({
      workDate: '2026-11-11',
      status: 'present',
      checkIn: '08:00:00',
    });
    expect(recorded.status).toBe(201);
    await placeHr(session, structure);
    const report = await request(app).get('/api/v1/hr/reports?from=2026-11-01&to=2026-11-30').set(auth(session.hr));
    expect(report.status).toBe(200);
    expect(report.body.data.attendance).toEqual([{ status: 'present', days: 1 }]);
    const csv = await request(app).get('/api/v1/hr/reports.csv?from=2026-11-01&to=2026-11-30').set(auth(session.hr));
    expect(csv.text).toContain('attendance,present,1');
    const pdf = await request(app).get('/api/v1/hr/reports.pdf?from=2026-11-01&to=2026-11-30').set(auth(session.hr));
    expect(pdf.status).toBe(200);
    const workbook = await request(app).get('/api/v1/hr/reports.xlsx?from=2026-11-01&to=2026-11-30').set(auth(session.hr));
    expect(workbook.status).toBe(200);
    const hidden = await request(app).get('/api/v1/hr/reports').set(auth(session.admin));
    expect(hidden.status).toBe(403);
  });

  it('opens a vacancy only after approval and hires the applicant as an employee', async () => {
    const session = await tokens();
    const structure = await org(session.admin);
    await placeHr(session, structure);
    await hire(session.hr, session.admin, session.officerId, {
      firstName: 'Test',
      lastName: 'Reviewer',
      departmentId: structure.departmentId,
      positionId: structure.clerkPositionId,
      branchId: structure.branchId,
    });
    const vacancy = await request(app).post('/api/v1/hr/vacancies').set(auth(session.officer)).send({
      title: 'Yard clerk',
      departmentId: structure.departmentId,
      positionId: structure.clerkPositionId,
      branchId: structure.branchId,
      openings: 1,
      description: 'Cover the yard counter.',
      submit: true,
    });
    expect(vacancy.status).toBe(201);
    expect(vacancy.body.data.status).toBe('pending_approval');
    const blocked = await request(app).post(`/api/v1/hr/vacancies/${vacancy.body.data.id}/applicants`).set(auth(session.officer)).send({
      firstName: 'Test',
      lastName: 'Applicant',
    });
    expect(blocked.status).toBe(409);
    await decide(session.hr, vacancy.body.data.approvalRequestId);
    await decide(session.ceo, vacancy.body.data.approvalRequestId);
    const open = await request(app).get('/api/v1/hr/vacancies').set(auth(session.hr));
    expect(open.body.data[0].status).toBe('open');
    const applicant = await request(app).post(`/api/v1/hr/vacancies/${vacancy.body.data.id}/applicants`).set(auth(session.officer)).send({
      firstName: 'Test',
      lastName: 'Applicant',
    });
    expect(applicant.status).toBe(201);
    const hired = await request(app).post(`/api/v1/hr/applicants/${applicant.body.data.id}/hire`).set(auth(session.hr)).send({
      startDate: '2026-12-01',
    });
    expect(hired.status).toBe(201);
    expect(hired.body.data.employeeNumber).toMatch(/^BJG-EMP-/);
    const people = await request(app).get('/api/v1/employees?search=Applicant').set(auth(session.hr));
    expect(people.body.data.some((row: { lastName: string }) => row.lastName === 'Applicant')).toBe(true);
  });

  it('keeps promotion history, closes an exit, and hides disciplinary records', async () => {
    const session = await tokens();
    const structure = await org(session.admin);
    const employeeId = await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test',
      lastName: 'Clerk',
      ...structure,
      positionId: structure.clerkPositionId,
    });
    await placeHr(session, structure);
    const discipline = await request(app).post('/api/v1/hr/disciplinary').set(auth(session.hr)).send({
      employeeId,
      incidentDate: '2026-06-01',
      category: 'Conduct',
      description: 'A recorded warning for the file.',
    });
    expect(discipline.status).toBe(201);
    const itView = await request(app).get(`/api/v1/hr/disciplinary/${discipline.body.data.id}`).set(auth(session.it));
    expect(itView.status).toBe(403);
    const officerView = await request(app).get(`/api/v1/hr/disciplinary/${discipline.body.data.id}`).set(auth(session.officer));
    expect(officerView.status).toBe(403);
    const hrView = await request(app).get(`/api/v1/hr/disciplinary/${discipline.body.data.id}`).set(auth(session.hr));
    expect(hrView.status).toBe(200);

    const promotion = await request(app).post('/api/v1/hr/promotions').set(auth(session.hr)).send({
      employeeId,
      departmentId: structure.departmentId,
      positionId: structure.leadPositionId,
      branchId: structure.branchId,
      effectiveDate: '2026-07-01',
      reason: 'Moved into the supervisor post.',
    });
    expect(promotion.status).toBe(201);
    const detail = await request(app).get(`/api/v1/employees/${employeeId}`).set(auth(session.hr));
    expect(detail.body.data.assignments).toHaveLength(2);
    expect(detail.body.data.assignments.filter((row: { endDate: string | null }) => row.endDate == null)).toHaveLength(1);

    const exited = await request(app).post('/api/v1/hr/exits').set(auth(session.hr)).send({
      employeeId,
      exitDate: '2026-10-31',
      reason: 'Employment ended.',
    });
    expect(exited.status).toBe(201);
    const after = await request(app).get(`/api/v1/employees/${employeeId}`).set(auth(session.hr));
    expect(after.body.data.employmentStatus).toBe('exited');
    expect(after.body.data.assignments.every((row: { endDate: string | null }) => row.endDate != null)).toBe(true);
  });
});
