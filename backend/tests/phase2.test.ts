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
  await createAccount('hrm', 'HR_MANAGER');
  await createAccount('ops', 'OPERATIONS_MANAGER');
  await createAccount('accounts', 'ACCOUNTS_OFFICER');
  await createAccount('ceo', 'CEO');
  const clerkId = await createAccount('clerk', 'PURCHASE_CLERK');
  const supervisorId = await createAccount('lead', 'LOADING_ATTENDANT');
  return {
    clerkId,
    supervisorId,
    admin: await login(app, 'sysadmin'),
    hr: await login(app, 'hrm'),
    ops: await login(app, 'ops'),
    accounts: await login(app, 'accounts'),
    ceo: await login(app, 'ceo'),
    clerk: await login(app, 'clerk'),
    lead: await login(app, 'lead'),
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

describe('phase 2 approval engine', () => {
  it('routes a purchase through supervisor, operations, accounts verification, and the CEO', async () => {
    const session = await tokens();
    const structure = await org(session.admin);
    const supervisorEmployeeId = await hire(session.hr, session.admin, session.supervisorId, {
      firstName: 'Test',
      lastName: 'Supervisor',
      ...structure,
      positionId: structure.leadPositionId,
    });
    await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test',
      lastName: 'Clerk',
      ...structure,
      positionId: structure.clerkPositionId,
      supervisorEmployeeId,
    });

    const created = await request(app).post('/api/v1/approvals/requests').set(auth(session.clerk)).send({
      workflowCode: 'PURCHASE',
      title: 'Spare parts for the yard',
      amount: 2500,
      departmentId: structure.departmentId,
      branchId: structure.branchId,
      submit: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('pending_review');
    const id = created.body.data.id as number;

    const own = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.clerk)).send({ action: 'approve' });
    expect(own.status).toBe(403);

    const supervisor = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.lead)).send({ action: 'approve', comment: 'Needed for dispatch.' });
    expect(supervisor.status).toBe(200);
    const operations = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.ops)).send({ action: 'approve' });
    expect(operations.status).toBe(200);
    const verified = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.accounts)).send({ action: 'approve', comment: 'Funds are available.' });
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('under_approval');

    const accountsFinal = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.accounts)).send({ action: 'approve' });
    expect(accountsFinal.status).toBe(403);
    const adminFinal = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.admin)).send({ action: 'approve' });
    expect(adminFinal.status).toBe(403);

    const ceo = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.ceo)).send({ action: 'approve', comment: 'Approved.' });
    expect(ceo.status).toBe(200);
    expect(ceo.body.data.status).toBe('approved');

    const processed = await request(app).post(`/api/v1/approvals/requests/${id}/process`).set(auth(session.accounts));
    expect(processed.status).toBe(200);
    const completed = await request(app).post(`/api/v1/approvals/requests/${id}/complete`).set(auth(session.accounts));
    expect(completed.body.data.status).toBe('completed');

    const detail = await request(app).get(`/api/v1/approvals/requests/${id}`).set(auth(session.ceo));
    expect(detail.body.data.actions.map((action: { action: string }) => action.action)).toEqual(['submit', 'approve', 'approve', 'approve', 'approve', 'process', 'complete']);
    expect(detail.body.data.steps.some((step: { name: string; decidedBy: string }) => step.name === 'CEO final approval' && step.decidedBy === 'ceo')).toBe(true);
  });

  it('returns a leave request for correction and accepts the resubmission', async () => {
    const session = await tokens();
    const created = await request(app).post('/api/v1/approvals/requests').set(auth(session.clerk)).send({
      workflowCode: 'LEAVE',
      title: 'Annual leave',
      submit: true,
    });
    const id = created.body.data.id as number;
    const missing = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.hr)).send({ action: 'return', comment: 'short' });
    expect(missing.status).toBe(422);
    const returned = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.hr)).send({
      action: 'return',
      comment: 'Add the dates and the covering officer.',
    });
    expect(returned.body.data.status).toBe('returned_for_correction');
    const resubmitted = await request(app).post(`/api/v1/approvals/requests/${id}/resubmit`).set(auth(session.clerk));
    expect(resubmitted.body.data.status).toBe('pending_review');
    await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.hr)).send({ action: 'approve' });
    const final = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.ceo)).send({ action: 'approve' });
    expect(final.body.data.status).toBe('approved');
  });

  it('keeps the CEO as the final approver of a small fuel request', async () => {
    const session = await tokens();
    const structure = await org(session.admin);
    const fleet = await request(app).post('/api/v1/organisation/positions').set(auth(session.admin)).send({
      code: 'FLEET-SUPERVISOR',
      title: 'Fleet Supervisor',
      departmentId: structure.departmentId,
      isManagerial: true,
    });
    const fleetUserId = await createAccount('fleet', 'FARM_SUPERVISOR');
    await hire(session.hr, session.admin, fleetUserId, {
      firstName: 'Test',
      lastName: 'Fleet',
      departmentId: structure.departmentId,
      positionId: fleet.body.data.id,
      branchId: structure.branchId,
    });
    const fleetToken = await login(app, 'fleet');
    const created = await request(app).post('/api/v1/approvals/requests').set(auth(session.clerk)).send({
      workflowCode: 'FUEL',
      title: 'Fuel for a local delivery',
      amount: 100,
      submit: true,
    });
    const id = created.body.data.id as number;
    expect((await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(fleetToken)).send({ action: 'approve' })).status).toBe(200);
    expect((await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.ops)).send({ action: 'approve' })).status).toBe(200);
    const verified = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.accounts)).send({ action: 'approve' });
    expect(verified.body.data.status).toBe('under_approval');
    const early = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.accounts)).send({ action: 'approve' });
    expect(early.status).toBe(403);
    const final = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.ceo)).send({ action: 'approve' });
    expect(final.body.data.status).toBe('approved');
    const detail = await request(app).get(`/api/v1/approvals/requests/${id}`).set(auth(session.ops));
    expect(detail.body.data.steps.some((step: { name: string; isFinalBusinessStep: boolean }) => step.name === 'CEO final approval' && step.isFinalBusinessStep)).toBe(true);
  });

  it('requires every parallel approver before the route continues', async () => {
    const session = await tokens();
    const createdWorkflow = await request(app).post('/api/v1/approvals/workflows').set(auth(session.admin)).send({
      code: 'PARALLEL',
      name: 'Parallel review',
      transactionKind: 'general',
      completionRoleCode: 'HR_MANAGER',
      steps: [
        { stepOrder: 1, name: 'HR review', resolver: 'role', roleCode: 'HR_MANAGER', parallelGroup: 1, decisionKind: 'review', isFinalBusinessStep: false, requiresExpenditureAuthority: false },
        { stepOrder: 2, name: 'Operations review', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', parallelGroup: 1, decisionKind: 'review', isFinalBusinessStep: false, requiresExpenditureAuthority: false },
        { stepOrder: 3, name: 'CEO final approval', resolver: 'role', roleCode: 'CEO', decisionKind: 'approve', isFinalBusinessStep: true, requiresExpenditureAuthority: false },
      ],
    });
    expect(createdWorkflow.status).toBe(201);
    const denied = await request(app).post('/api/v1/approvals/workflows').set(auth(session.hr)).send(createdWorkflow.body);
    expect(denied.status).toBe(403);

    const created = await request(app).post('/api/v1/approvals/requests').set(auth(session.clerk)).send({
      workflowCode: 'PARALLEL',
      title: 'Joint review',
      submit: true,
    });
    const id = created.body.data.id as number;
    const first = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.hr)).send({ action: 'approve' });
    expect(first.body.data.status).toBe('pending_review');
    const second = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(session.ops)).send({ action: 'approve' });
    expect(second.body.data.status).toBe('under_approval');
  });

  it('lets a delegate give final approval and still blocks expenditure without authority', async () => {
    const session = await tokens();
    const hrUser = await request(app).get('/api/v1/users?search=hrm').set(auth(session.admin));
    const hrId = hrUser.body.data.find((user: { username: string }) => user.username === 'hrm').id as number;
    const delegation = await request(app).post('/api/v1/approvals/delegations').set(auth(session.ceo)).send({
      delegateUserId: hrId,
      startsOn: '2020-01-01',
      endsOn: '2030-12-31',
      reason: 'Covering final approval while travelling.',
    });
    expect(delegation.status).toBe(201);

    const leave = await request(app).post('/api/v1/approvals/requests').set(auth(session.clerk)).send({
      workflowCode: 'LEAVE',
      title: 'Compassionate leave',
      submit: true,
    });
    const leaveId = leave.body.data.id as number;
    await request(app).post(`/api/v1/approvals/requests/${leaveId}/decision`).set(auth(session.hr)).send({ action: 'approve' });
    const delegated = await request(app).post(`/api/v1/approvals/requests/${leaveId}/decision`).set(auth(session.hr)).send({ action: 'approve', comment: 'Acting for the CEO.' });
    expect(delegated.status).toBe(200);
    expect(delegated.body.data.status).toBe('approved');

    const trap = await request(app).post('/api/v1/approvals/workflows').set(auth(session.admin)).send({
      code: 'SPEND-TRAP',
      name: 'Expenditure trap',
      transactionKind: 'expenditure',
      completionRoleCode: 'ACCOUNTS_OFFICER',
      steps: [
        { stepOrder: 1, name: 'Accounts tries to approve spend', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'approve', isFinalBusinessStep: true, requiresExpenditureAuthority: true },
      ],
    });
    expect(trap.status).toBe(201);
    const spend = await request(app).post('/api/v1/approvals/requests').set(auth(session.clerk)).send({
      workflowCode: 'SPEND-TRAP',
      title: 'Unbudgeted payment',
      amount: 20,
      submit: true,
    });
    const denied = await request(app).post(`/api/v1/approvals/requests/${spend.body.data.id}/decision`).set(auth(session.accounts)).send({ action: 'approve' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/expenditure/);
  });

  it('stops the CEO approving their own request', async () => {
    const session = await tokens();
    const created = await request(app).post('/api/v1/approvals/requests').set(auth(session.ceo)).send({
      workflowCode: 'LEAVE',
      title: 'CEO leave',
      submit: true,
    });
    expect(created.status).toBe(422);
    expect(created.body.error.message).toMatch(/own request/);
  });
});
