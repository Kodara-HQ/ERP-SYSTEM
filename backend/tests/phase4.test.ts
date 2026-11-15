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
  const opsId = await createAccount('ops', 'OPERATIONS_MANAGER');
  await createAccount('accounts', 'ACCOUNTS_OFFICER');
  await createAccount('ceo', 'CEO');
  await createAccount('it', 'IT_MARKETING_MANAGER');
  const clerkId = await createAccount('clerk', 'PURCHASE_CLERK');
  return {
    opsId,
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

async function decide(token: string, id: number) {
  const response = await request(app).post(`/api/v1/approvals/requests/${id}/decision`).set(auth(token)).send({ action: 'approve', comment: 'Reviewed.' });
  expect(response.status).toBe(200);
  return response.body.data.status as string;
}

/**
 * A routine purchase within the operations manager's limit: the supervisor review is skipped because the
 * same manager reviews operations next, finance verifies the budget, and the manager approves. No CEO step.
 */
async function approvePurchase(session: Awaited<ReturnType<typeof tokens>>, approvalId: number) {
  await decide(session.ops, approvalId);
  await decide(session.accounts, approvalId);
  const ceoTooEarly = await request(app).post(`/api/v1/approvals/requests/${approvalId}/decision`).set(auth(session.ceo)).send({ action: 'approve' });
  expect(ceoTooEarly.status).toBe(403);
  const status = await decide(session.ops, approvalId);
  expect(status).toBe('approved');
  const detail = await request(app).get(`/api/v1/approvals/requests/${approvalId}`).set(auth(session.ops));
  expect(detail.body.data.steps.map((step: { status: string }) => step.status)).toEqual(['skipped', 'approved', 'approved', 'approved']);
}

describe('phase 4 procurement and inventory', () => {
  it('keeps stock at zero until the purchase is approved, then traces receipt, damage, and issue', async () => {
    const session = await tokens();
    const org = await structure(session.admin);
    const leadId = await hire(session.hr, session.admin, session.opsId, {
      firstName: 'Test', lastName: 'Lead', ...org, positionId: org.leadPositionId,
    });
    await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test', lastName: 'Clerk', ...org, positionId: org.clerkPositionId, supervisorEmployeeId: leadId,
    });

    const hidden = await request(app).post('/api/v1/procurement/requisitions').set(auth(session.admin)).send({
      purpose: 'Stores request that an administrator must not raise.',
      lines: [{ description: 'Seed', quantity: 1, estimatedUnitCost: 1 }],
    });
    expect(hidden.status).toBe(403);
    const reports = await request(app).get('/api/v1/inventory/reports').set(auth(session.it));
    expect(reports.status).toBe(403);

    const supplier = await request(app).post('/api/v1/procurement/suppliers').set(auth(session.ops)).send({ name: 'North Store' });
    expect(supplier.status).toBe(201);
    const warehouse = await request(app).post('/api/v1/inventory/warehouses').set(auth(session.ops)).send({ code: 'MAIN', name: 'Main store' });
    const yard = await request(app).post('/api/v1/inventory/warehouses').set(auth(session.ops)).send({ code: 'YARD', name: 'Yard store' });
    const item = await request(app).post('/api/v1/inventory/items').set(auth(session.ops)).send({
      sku: 'SEED', name: 'Seed bag', unit: 'bag', reorderLevel: 5,
    });
    expect(item.status).toBe(201);

    const early = await request(app).post('/api/v1/procurement/orders').set(auth(session.clerk)).send({
      requisitionId: 1, supplierId: supplier.body.data.id, lines: [{ requisitionLineId: 1, unitCost: 10 }],
    });
    expect(early.status).toBe(404);

    const requisition = await request(app).post('/api/v1/procurement/requisitions').set(auth(session.clerk)).send({
      purpose: 'Seed for the next planting window.',
      lines: [{ itemId: item.body.data.id, description: 'Seed bag', quantity: 6, estimatedUnitCost: 10 }],
    });
    expect(requisition.status).toBe(201);
    expect(requisition.body.data.status).toBe('submitted');
    expect(requisition.body.data.totalAmount).toBe(60);
    const blocked = await request(app).post('/api/v1/procurement/orders').set(auth(session.clerk)).send({
      requisitionId: requisition.body.data.id,
      supplierId: supplier.body.data.id,
      lines: [{ requisitionLineId: requisition.body.data.lines[0].id, unitCost: 10 }],
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('REQUISITION_NOT_APPROVED');

    await approvePurchase(session, requisition.body.data.approvalRequestId);
    const order = await request(app).post('/api/v1/procurement/orders').set(auth(session.clerk)).send({
      requisitionId: requisition.body.data.id,
      supplierId: supplier.body.data.id,
      lines: [{ requisitionLineId: requisition.body.data.lines[0].id, unitCost: 10 }],
    });
    expect(order.status).toBe(201);
    expect(order.body.data.status).toBe('issued');
    expect(order.body.data.totalAmount).toBe(60);

    const tooMany = await request(app).post('/api/v1/procurement/receipts').set(auth(session.ops)).send({
      purchaseOrderId: order.body.data.id,
      warehouseId: warehouse.body.data.id,
      receivedOn: '2026-11-11',
      lines: [{ orderLineId: order.body.data.lines[0].id, quantity: 7, damagedQuantity: 0 }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('OVER_RECEIPT');

    const received = await request(app).post('/api/v1/procurement/receipts').set(auth(session.ops)).send({
      purchaseOrderId: order.body.data.id,
      warehouseId: warehouse.body.data.id,
      receivedOn: '2026-11-11',
      lines: [{ orderLineId: order.body.data.lines[0].id, quantity: 4, damagedQuantity: 1, lotCode: 'LOT-A' }],
    });
    expect(received.status).toBe(201);
    expect(received.body.data.status).toBe('partial');
    let balances = await request(app).get('/api/v1/inventory/balances').set(auth(session.ops));
    expect(balances.body.data).toEqual([expect.objectContaining({ sku: 'SEED', quantity: 4 })]);

    const expired = await request(app).post('/api/v1/procurement/receipts').set(auth(session.ops)).send({
      purchaseOrderId: order.body.data.id,
      warehouseId: warehouse.body.data.id,
      receivedOn: '2026-11-11',
      lines: [{ orderLineId: order.body.data.lines[0].id, quantity: 1, damagedQuantity: 0, lotCode: 'LOT-OLD', expiryDate: '2020-01-01' }],
    });
    expect(expired.status).toBe(201);
    expect(expired.body.data.status).toBe('received');
    const stock = await request(app).get('/api/v1/inventory/reports?from=2026-11-01&to=2026-11-30').set(auth(session.ops));
    expect(stock.status).toBe(200);
    expect(stock.body.data.stockValue).toBe(50);
    expect(stock.body.data.belowReorder).toEqual([expect.objectContaining({ sku: 'SEED', onHand: 5, reorderLevel: 5 })]);
    expect(stock.body.data.expired).toEqual([expect.objectContaining({ sku: 'SEED', lotCode: 'LOT-OLD', quantity: 1 })]);
    const csv = await request(app).get('/api/v1/inventory/reports.csv?from=2026-11-01&to=2026-11-30').set(auth(session.ops));
    expect(csv.text).toContain('movement,receipt,');
    expect(csv.text).toContain('expired,SEED,1');
    const stockPdf = await request(app).get('/api/v1/inventory/reports.pdf?from=2026-11-01&to=2026-11-30').set(auth(session.ops));
    expect(stockPdf.status).toBe(200);
    const stockWorkbook = await request(app).get('/api/v1/inventory/reports.xlsx?from=2026-11-01&to=2026-11-30').set(auth(session.ops));
    expect(stockWorkbook.status).toBe(200);
    const buying = await request(app).get('/api/v1/procurement/reports.pdf?from=2026-11-01&to=2026-11-30').set(auth(session.ops));
    expect(buying.status).toBe(200);

    const closed = await request(app).post('/api/v1/procurement/receipts').set(auth(session.ops)).send({
      purchaseOrderId: order.body.data.id,
      warehouseId: warehouse.body.data.id,
      receivedOn: '2026-11-12',
      lines: [{ orderLineId: order.body.data.lines[0].id, quantity: 1, damagedQuantity: 0 }],
    });
    expect(closed.status).toBe(409);

    const issued = await request(app).post('/api/v1/inventory/movements').set(auth(session.ops)).send({
      type: 'issue', warehouseId: warehouse.body.data.id, itemId: item.body.data.id, quantity: 1, notes: 'Issued the expired lot first.',
    });
    expect(issued.status).toBe(201);
    const afterIssue = await request(app).get('/api/v1/inventory/reports').set(auth(session.ops));
    expect(afterIssue.body.data.expired).toEqual([]);

    const transfer = await request(app).post('/api/v1/inventory/movements').set(auth(session.ops)).send({
      type: 'transfer', warehouseId: warehouse.body.data.id, destinationWarehouseId: yard.body.data.id,
      itemId: item.body.data.id, quantity: 1, notes: 'Move one bag to the yard.',
    });
    expect(transfer.status).toBe(201);
    balances = await request(app).get('/api/v1/inventory/balances').set(auth(session.ops));
    const quantities = balances.body.data.map((row: { warehouseName: string; quantity: number }) => [row.warehouseName, row.quantity]);
    expect(quantities).toEqual(expect.arrayContaining([['Main store', 3], ['Yard store', 1]]));

    const short = await request(app).post('/api/v1/inventory/movements').set(auth(session.ops)).send({
      type: 'issue', warehouseId: warehouse.body.data.id, itemId: item.body.data.id, quantity: 1, notes: 'short',
    });
    expect(short.status).toBe(422);
    const missing = await request(app).post('/api/v1/inventory/movements').set(auth(session.ops)).send({
      type: 'issue', warehouseId: warehouse.body.data.id, itemId: item.body.data.id, quantity: 20, notes: 'More than the store holds.',
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('refuses an inactive supplier and cancels an order that has not been received', async () => {
    const session = await tokens();
    const org = await structure(session.admin);
    const leadId = await hire(session.hr, session.admin, session.opsId, {
      firstName: 'Test', lastName: 'Lead', ...org, positionId: org.leadPositionId,
    });
    await hire(session.hr, session.admin, session.clerkId, {
      firstName: 'Test', lastName: 'Clerk', ...org, positionId: org.clerkPositionId, supervisorEmployeeId: leadId,
    });
    const supplier = await request(app).post('/api/v1/procurement/suppliers').set(auth(session.ops)).send({ name: 'Closed Yard' });
    await request(app).patch(`/api/v1/procurement/suppliers/${supplier.body.data.id}`).set(auth(session.ops)).send({ status: 'inactive' });
    const requisition = await request(app).post('/api/v1/procurement/requisitions').set(auth(session.clerk)).send({
      purpose: 'Bags for the yard store.',
      lines: [{ description: 'Empty bag', quantity: 2, estimatedUnitCost: 1 }],
    });
    expect(requisition.status).toBe(201);
    await approvePurchase(session, requisition.body.data.approvalRequestId);
    const refused = await request(app).post('/api/v1/procurement/orders').set(auth(session.clerk)).send({
      requisitionId: requisition.body.data.id,
      supplierId: supplier.body.data.id,
      lines: [{ requisitionLineId: requisition.body.data.lines[0].id, unitCost: 1 }],
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('INVALID_SUPPLIER');

    const active = await request(app).post('/api/v1/procurement/suppliers').set(auth(session.ops)).send({ name: 'Open Yard' });
    const order = await request(app).post('/api/v1/procurement/orders').set(auth(session.clerk)).send({
      requisitionId: requisition.body.data.id,
      supplierId: active.body.data.id,
      lines: [{ requisitionLineId: requisition.body.data.lines[0].id, unitCost: 1 }],
    });
    expect(order.status).toBe(201);
    const cancelled = await request(app).post(`/api/v1/procurement/orders/${order.body.data.id}/cancel`).set(auth(session.ops)).send({});
    expect(cancelled.status).toBe(200);
    const again = await request(app).get('/api/v1/procurement/requisitions').set(auth(session.clerk));
    expect(again.body.data[0].status).toBe('approved');
    const replacement = await request(app).post('/api/v1/procurement/orders').set(auth(session.clerk)).send({
      requisitionId: requisition.body.data.id,
      supplierId: active.body.data.id,
      lines: [{ requisitionLineId: requisition.body.data.lines[0].id, unitCost: 1 }],
    });
    expect(replacement.status).toBe(201);
    const invoice = await request(app).post('/api/v1/procurement/invoices').set(auth(session.clerk)).send({
      supplierId: active.body.data.id,
      purchaseOrderId: replacement.body.data.id,
      invoiceNumber: 'YARD-1',
      invoiceDate: '2026-11-11',
      amount: 2,
    });
    expect(invoice.status).toBe(201);
    const duplicate = await request(app).post('/api/v1/procurement/invoices').set(auth(session.clerk)).send({
      supplierId: active.body.data.id,
      invoiceNumber: 'YARD-1',
      invoiceDate: '2026-11-11',
      amount: 2,
    });
    expect(duplicate.status).toBe(409);
  });
});
