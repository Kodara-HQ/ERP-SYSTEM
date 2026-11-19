import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { execute, queryOne, scalar } from '../src/database/query';
import { seedOrganisation } from '../src/database/seed';
import type { RowDataPacket } from '../src/database/rows';
import { runFarmNotices } from '../src/modules/farm/farm.jobs';
import { farmReportCatalog } from '../src/modules/farm/farm.analytics';
import { auth, closePool, createAccount, login, resetDatabase } from './helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
  await seedOrganisation();
});

afterAll(async () => {
  await closePool();
});

async function place(userId: number | null, departmentCode: string, positionCode: string, name: string, supervisor: number | null = null): Promise<number> {
  const company = await queryOne<RowDataPacket>(pool, 'SELECT id FROM companies ORDER BY id LIMIT 1');
  const branch = await queryOne<RowDataPacket>(pool, `SELECT id FROM branches WHERE code = 'HQ'`)
    ?? { id: (await execute(pool, `INSERT INTO branches (company_id, code, name, status) VALUES (?, 'HQ', 'Head Office', 'active')`, [company!.id])).insertId };
  const department = await queryOne<RowDataPacket>(pool, 'SELECT id FROM departments WHERE code = ?', [departmentCode]);
  const position = await queryOne<RowDataPacket>(pool, 'SELECT id FROM positions WHERE code = ?', [positionCode]);
  const count = await scalar(pool, 'SELECT COUNT(*) FROM employees');
  const employee = await execute(pool, `INSERT INTO employees (company_id, employee_number, first_name, last_name, employment_status) VALUES (?, ?, ?, ?, 'active')`,
    [company!.id, `F-${count + 1}`, name, 'Test']);
  await execute(pool, `INSERT INTO employee_assignments (employee_id, department_id, position_id, branch_id, supervisor_employee_id, is_primary, start_date) VALUES (?, ?, ?, ?, ?, 1, '2026-01-01')`,
    [employee.insertId, department!.id, position!.id, branch.id, supervisor]);
  if (userId) await execute(pool, 'UPDATE users SET employee_id = ? WHERE id = ?', [employee.insertId, userId]);
  return employee.insertId;
}

async function setup() {
  const ids = {
    ceo: await createAccount('ceo', 'CEO'),
    ops: await createAccount('ops', 'OPERATIONS_MANAGER'),
    sup: await createAccount('sup', 'FARM_SUPERVISOR'),
    store: await createAccount('store', 'STOREKEEPER'),
    hr: await createAccount('hr', 'HR_MANAGER'),
  };
  await createAccount('sysadmin', 'SYSTEM_ADMINISTRATOR');
  // Every manager is an employee, the CEO included.
  await place(ids.ceo, 'EXEC', 'CEO', 'Chief');
  const opsEmployee = await place(ids.ops, 'OPS', 'OPS-MANAGER', 'Vitalis');
  const supEmployee = await place(ids.sup, 'OPS', 'FARM-SUPERVISOR', 'Kojo', opsEmployee);
  const workerEmployee = await place(null, 'OPS', 'TRACTOR-OPERATOR', 'Yaw', supEmployee);
  await place(ids.store, 'OPS-STORES', 'STOREKEEPER', 'Abena', opsEmployee);
  await place(ids.hr, 'HR', 'HR-MANAGER', 'Efua');
  const t: Record<string, string> = {};
  for (const name of ['ceo', 'ops', 'sup', 'store', 'hr', 'sysadmin']) t[name] = await login(app, name);
  return { ids, t, supEmployee, workerEmployee };
}

const post = (token: string, path: string, body: unknown = {}) => request(app).post(`/api/v1${path}`).set(auth(token)).send(body as object);
const get = (token: string, path: string) => request(app).get(`/api/v1${path}`).set(auth(token));

describe('farm operations', () => {
  it('runs from supervisor submission through review, harvest stock, resource approval, and haulage dispatch', async () => {
    const { t, supEmployee, workerEmployee } = await setup();
    const categories = await get(t.ops, '/inventory/categories');
    const produceCategory = categories.body.data.find((row: { name: string }) => row.name === 'Farm produce');
    const fertiliserCategory = categories.body.data.find((row: { name: string }) => row.name === 'Fertilisers');
    expect(produceCategory).toBeDefined();
    const store = await post(t.ops, '/inventory/warehouses', { code: 'FARMSTORE', name: 'Farm store' });
    const rcn = await post(t.ops, '/inventory/items', { sku: 'RCN', name: 'Raw cashew nuts', unit: 'kg', reorderLevel: 0, categoryId: produceCategory.id });
    const npk = await post(t.ops, '/inventory/items', { sku: 'NPK', name: 'NPK fertiliser', unit: 'bag', reorderLevel: 20, categoryId: fertiliserCategory.id });
    expect(rcn.status).toBe(201);
    await post(t.ops, '/inventory/movements', { type: 'adjustment', direction: 'increase', warehouseId: store.body.data.id, itemId: npk.body.data.id, quantity: 100, notes: 'Opening fertiliser stock.' });

    // Farms and teams
    const farm = await post(t.ops, '/farm/farms', { code: 'WENCHI-1', name: 'Wenchi Farm', location: 'Wenchi', totalAreaHa: 120, cultivatedAreaHa: 100, ownership: 'owned', supervisorEmployeeId: supEmployee, warehouseId: store.body.data.id });
    expect(farm.status).toBe(201);
    const other = await post(t.ops, '/farm/farms', { code: 'TECHI-1', name: 'Techiman Farm', location: 'Techiman', totalAreaHa: 50, cultivatedAreaHa: 40, ownership: 'leased' });
    expect((await post(t.sup, '/farm/farms', { code: 'X-1', name: 'Nope', location: 'Nope', totalAreaHa: 1, cultivatedAreaHa: 1, ownership: 'owned' })).status).toBe(403);
    expect((await post(t.ops, `/farm/farms/${farm.body.data.id}/team`, { employeeId: workerEmployee, teamRole: 'operator', responsibilities: 'Tractor and spraying' })).status).toBe(201);
    const supFarms = await get(t.sup, '/farm/farms');
    expect(supFarms.body.data.map((row: { name: string }) => row.name)).toEqual(['Wenchi Farm']);
    expect((await get(t.sup, `/farm/farms/${other.body.data.id}`)).status).toBe(403);
    const supervisors = await get(t.ops, '/farm/supervisors');
    expect(supervisors.body.data[0]).toMatchObject({ name: 'Kojo Test', workers: 1, farmCount: 1 });

    // Production planning
    const cycle = await post(t.ops, '/farm/crop-cycles', { farmId: farm.body.data.id, crop: 'Cashew', season: '2026/27', areaHa: 100, plantingDate: '2020-05-01', expectedHarvestDate: '2026-11-25', stage: 'fruiting', expectedYieldKg: 8000 });
    expect(cycle.status).toBe(201);
    expect((await post(t.ops, '/farm/targets', { farmId: farm.body.data.id, crop: 'Cashew', season: '2026/27', periodStart: '2026-01-01', periodEnd: '2026-12-31', targetKg: 10000 })).status).toBe(201);
    const activity = await post(t.ops, '/farm/activities', { farmId: farm.body.data.id, cropCycleId: cycle.body.data.id, activityType: 'weeding', title: 'Weed rows 1-20', scheduledDate: '2026-11-01', dueDate: '2026-11-03', assignedUserId: null });
    expect(activity.status).toBe(201);
    expect((await post(t.sup, '/farm/activities', { farmId: farm.body.data.id, activityType: 'weeding', title: 'Self-assigned', scheduledDate: '2026-11-01', dueDate: '2026-11-02' })).status).toBe(403);

    // Daily report by the supervisor, backdated, with a photograph, reviewed by the Operations Manager
    const report = await post(t.sup, '/farm/daily-reports', {
      farmId: farm.body.data.id, activityId: activity.body.data.id, activityDate: '2026-11-02', activityType: 'weeding', workPerformed: 'Weeded rows 1 to 12 by hand.',
      workersCount: 6, resourcesUsed: '6 cutlasses', workCompleted: '60%', challenges: 'Rain stopped work at 2 pm.', markActivityCompleted: false,
    });
    expect(report.status).toBe(201);
    expect(report.body.data.activityDate).toBe('2026-11-02');
    expect(await scalar(pool, `SELECT COUNT(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = 'ops' AND n.notification_type = 'farm.daily_report.submitted'`)).toBe(1);
    const photo = await post(t.sup, `/farm/daily-reports/${report.body.data.id}/documents`, { fileName: 'rows.jpg', contentType: 'image/jpeg', contentBase64: Buffer.from('jpeg-bytes').toString('base64') });
    expect(photo.status).toBe(201);
    expect((await post(t.sup, `/farm/daily-reports/${report.body.data.id}/review`, { action: 'acknowledge' })).status).toBe(403);
    const returned = await post(t.ops, `/farm/daily-reports/${report.body.data.id}/review`, { action: 'return', remarks: 'Give the number of rows remaining.' });
    expect(returned.body.data.status).toBe('returned');
    const corrected = await request(app).put(`/api/v1/farm/daily-reports/${report.body.data.id}`).set(auth(t.sup)).send({
      farmId: farm.body.data.id, activityId: activity.body.data.id, activityDate: '2026-11-02', activityType: 'weeding', workPerformed: 'Weeded rows 1 to 12; rows 13 to 20 remain.', workersCount: 6,
    });
    expect(corrected.body.data.status).toBe('submitted');
    expect((await post(t.ops, `/farm/daily-reports/${report.body.data.id}/review`, { action: 'acknowledge', remarks: 'Thank you.' })).body.data.status).toBe('acknowledged');

    // Harvest recorded by the supervisor, verified by the Operations Manager into produce stock
    const harvest = await post(t.sup, '/farm/harvests', { farmId: farm.body.data.id, cropCycleId: cycle.body.data.id, harvestDate: '2026-11-10', quantityKg: 4000, lossKg: 120, grade: 'A', moisturePercent: 8 });
    expect(harvest.status).toBe(201);
    expect((await post(t.sup, `/farm/harvests/${harvest.body.data.id}/verify`, { stockItemId: rcn.body.data.id })).status).toBe(403);
    expect((await post(t.ops, `/farm/harvests/${harvest.body.data.id}/verify`, { stockItemId: npk.body.data.id, warehouseId: store.body.data.id })).body.error.code).toBe('NOT_PRODUCE');
    const verified = await post(t.ops, `/farm/harvests/${harvest.body.data.id}/verify`, { stockItemId: rcn.body.data.id, warehouseId: store.body.data.id });
    expect(verified.body.data.status).toBe('verified');
    expect((await post(t.ops, `/farm/harvests/${harvest.body.data.id}/verify`, { stockItemId: rcn.body.data.id, warehouseId: store.body.data.id })).status).toBe(409);
    const balance = async () => Number((await queryOne<RowDataPacket>(pool, 'SELECT quantity FROM stock_balances WHERE item_id = ? AND warehouse_id = ?', [rcn.body.data.id, store.body.data.id]))!.quantity);
    expect(await balance()).toBe(4000);
    expect(await scalar(pool, `SELECT COUNT(*) FROM stock_movements WHERE source_type = 'farm_harvest' AND farm_id = ?`, [farm.body.data.id])).toBe(1);

    // Resource requests through the approval engine: within the Operations Manager's limit, and above it (CEO)
    const small = await post(t.sup, '/farm/resource-requests', { farmId: farm.body.data.id, category: 'fertiliser', stockItemId: npk.body.data.id, description: 'NPK for rows 1-20', quantity: 30, unit: 'bag', estimatedCost: 2000, justification: 'Second application before flowering.' });
    expect(small.status).toBe(201);
    expect(small.body.data.pendingStep).toBe('Operations Manager approval');
    const pending = await get(t.ops, '/farm/pending');
    expect(pending.body.data.resourceRequests).toBe(1);
    expect((await post(t.sup, `/farm/resource-requests/${small.body.data.id}/decision`, { action: 'approve' })).status).toBe(403);
    expect((await post(t.ops, `/farm/resource-requests/${small.body.data.id}/decision`, { action: 'approve', comment: 'Within budget.' })).body.data.status).toBe('approved');
    expect((await post(t.sup, `/farm/resource-requests/${small.body.data.id}/fulfil`, { warehouseId: store.body.data.id })).status).toBe(403);
    const fulfilled = await post(t.ops, `/farm/resource-requests/${small.body.data.id}/fulfil`, { warehouseId: store.body.data.id });
    expect(fulfilled.body.data.status).toBe('fulfilled');
    expect(Number((await queryOne<RowDataPacket>(pool, 'SELECT quantity FROM stock_balances WHERE item_id = ?', [npk.body.data.id]))!.quantity)).toBe(70);
    const big = await post(t.sup, '/farm/resource-requests', { farmId: farm.body.data.id, category: 'equipment', description: 'Hire of a combine for 3 days', quantity: 3, unit: 'day', estimatedCost: 15000, justification: 'Our harvester is out of service.' });
    const recommended = await post(t.ops, `/farm/resource-requests/${big.body.data.id}/decision`, { action: 'approve', comment: 'Recommended to the CEO.' });
    expect(recommended.body.data).toMatchObject({ status: 'submitted', pendingStep: 'CEO final approval' });
    expect((await post(t.ops, `/farm/resource-requests/${big.body.data.id}/decision`, { action: 'approve' })).status).toBe(403);
    const ceoApproved = await post(t.ceo, `/approvals/requests/${big.body.data.approvalRequestId}/decision`, { action: 'approve', comment: 'Approved.' });
    expect(ceoApproved.status).toBe(200);
    expect((await get(t.ops, `/farm/resource-requests/${big.body.data.id}`)).body.data.status).toBe('approved');

    // Dispatch through the existing haulage module
    const truck = await post(t.ops, '/farm/equipment', { name: 'Tata truck', assetType: 'truck', registrationNumber: 'GR-1234-20' });
    expect(truck.status).toBe(201);
    expect((await post(t.sup, '/farm/dispatches', { farmId: farm.body.data.id, stockItemId: rcn.body.data.id, warehouseId: store.body.data.id, quantity: 5000, collectionLocation: 'Wenchi farm store', destination: 'Techiman processing', purpose: 'processing' })).body.error.code).toBe('INSUFFICIENT_STOCK');
    const dispatch = await post(t.sup, '/farm/dispatches', { farmId: farm.body.data.id, stockItemId: rcn.body.data.id, warehouseId: store.body.data.id, quantity: 1500, collectionLocation: 'Wenchi farm store', destination: 'Techiman processing', purpose: 'processing' });
    expect(dispatch.status).toBe(201);
    expect((await post(t.sup, `/farm/dispatches/${dispatch.body.data.id}/schedule`, { tripDate: '2026-11-20' })).status).toBe(403);
    const scheduled = await post(t.ops, `/farm/dispatches/${dispatch.body.data.id}/schedule`, { tripDate: '2026-11-20', vehicleId: truck.body.data.id, driverName: 'Kwesi', distanceKm: 45 });
    expect(scheduled.body.data).toMatchObject({ status: 'scheduled', driverName: 'Kwesi' });
    expect(scheduled.body.data.tripReference).toMatch(/^BJG-TRP-/);
    expect(await balance()).toBe(4000);
    const departed = await post(t.ops, `/farm/dispatches/${dispatch.body.data.id}/depart`);
    expect(departed.body.data.status).toBe('in_transit');
    expect(await balance()).toBe(2500);
    expect((await post(t.ops, `/farm/dispatches/${dispatch.body.data.id}/depart`)).status).toBe(409);
    const delivered = await post(t.ops, `/farm/dispatches/${dispatch.body.data.id}/deliver`, { remarks: 'Weighed in at 1,498 kg.' });
    expect(delivered.body.data.status).toBe('delivered');
    const trips = await get(t.ops, '/farm/trips');
    expect(trips.body.data[0]).toMatchObject({ status: 'delivered', vehicle: 'Tata truck (GR-1234-20)' });
    const produce = await get(t.ops, '/farm/produce');
    expect(produce.body.data[0]).toMatchObject({ harvested: 4000, dispatched: 1500, inStorage: 2500, harvestSources: 'Wenchi Farm', grades: 'A' });

    // Incident reported, assigned, and resolved
    const incident = await post(t.sup, '/farm/incidents', { farmId: farm.body.data.id, category: 'pest_infestation', title: 'Tea mosquito bug on block C', description: 'Leaf damage on about 40 trees in block C.', priority: 'high', occurredOn: '2026-11-12' });
    expect(incident.status).toBe(201);
    const opsUser = await queryOne<RowDataPacket>(pool, `SELECT id FROM users WHERE username = 'sup'`);
    const assigned = await request(app).patch(`/api/v1/farm/incidents/${incident.body.data.id}`).set(auth(t.ops)).send({ status: 'in_progress', assignedToUserId: Number(opsUser!.id) });
    expect(assigned.body.data.assignedTo).toBe('Kojo Test');
    expect((await request(app).patch(`/api/v1/farm/incidents/${incident.body.data.id}`).set(auth(t.sup)).send({ status: 'resolved' })).status).toBe(422);
    const resolved = await request(app).patch(`/api/v1/farm/incidents/${incident.body.data.id}`).set(auth(t.sup)).send({ status: 'resolved', resolutionRemarks: 'Sprayed block C; follow-up in 10 days.' });
    expect(resolved.body.data.status).toBe('resolved');

    // Dashboard figures come from these records
    const dashboard = await get(t.ops, '/farm/dashboard?period=year');
    expect(dashboard.body.data.cards).toMatchObject({ totalFarms: 2, activeFarms: 2, cultivatedAreaHa: 140, supervisors: 1, workers: 1, harvestedKg: 4000, targetAchievement: 40, produceInStore: 2500, openIncidents: 0, pendingResourceRequests: 0 });
    expect(dashboard.body.data.charts.targetVsActual[0]).toMatchObject({ target: 10000, actual: 4000 });
    expect(dashboard.body.data.charts.resourceUtilisation[0]).toMatchObject({ category: 'Fertilisers', quantity: 30 });
    expect((await get(t.ops, '/farm/dashboard?period=custom&from=2026-12-01&to=2026-11-01')).status).toBe(422);
    const supDashboard = await get(t.sup, '/farm/dashboard?period=year');
    expect(supDashboard.body.data.cards.totalFarms).toBe(1);

    // Every report runs with filters and exports
    for (const report of farmReportCatalog) {
      const result = await get(t.ops, `/farm/reports/${report.code}?period=custom&from=2026-01-01&to=2026-12-31&farmId=${farm.body.data.id}&crop=Cashew&season=2026/27`);
      expect(result.status, report.code).toBe(200);
      expect(result.body.data.tables.length, report.code).toBeGreaterThan(0);
    }
    const harvestReport = await get(t.ops, '/farm/reports/harvest?period=year');
    expect(harvestReport.body.data.tables[0].rows[0]).toEqual(expect.arrayContaining(['2026-11-10', 'Wenchi Farm', 4000]));
    expect((await get(t.ops, '/farm/reports/yield_performance/export.xlsx?period=year')).status).toBe(200);
    expect((await get(t.ops, '/farm/reports/dispatch/export.pdf?period=year')).status).toBe(200);
    expect((await get(t.sup, '/farm/reports/dispatch/export.pdf?period=year')).status).toBe(403);

    // Notifications from the scheduled job: the weeding activity is overdue
    await runFarmNotices();
    expect(await scalar(pool, `SELECT COUNT(*) FROM notifications WHERE notification_type = 'farm.activity.overdue'`)).toBeGreaterThan(0);
    const again = await scalar(pool, 'SELECT COUNT(*) FROM notifications');
    await runFarmNotices();
    expect(await scalar(pool, 'SELECT COUNT(*) FROM notifications')).toBe(again);

    // Audit trail of who did what
    const actions = (await pool.query(`SELECT action FROM audit_logs WHERE module = 'farm' ORDER BY id`))[0] as RowDataPacket[];
    expect(actions.map((row) => row.action)).toEqual(expect.arrayContaining([
      'farm.create', 'farm.daily_report.submit', 'farm.daily_report.return', 'farm.daily_report.resubmit', 'farm.daily_report.acknowledge', 'farm.harvest.record',
      'farm.harvest.verify', 'farm.resource_request.submit', 'farm.resource_request.fulfil', 'farm.dispatch.request', 'farm.dispatch.authorise', 'farm.dispatch.depart',
      'farm.dispatch.deliver', 'farm.incident.report', 'farm.incident.update', 'farm.report.export',
    ]));
    const verifyAudit = await queryOne<RowDataPacket>(pool, `SELECT previous_value, new_value FROM audit_logs WHERE action = 'farm.harvest.verify'`);
    expect(JSON.stringify(verifyAudit!.previous_value)).toContain('recorded');
  });

  it('keeps the Operations Manager out of payroll, salaries, administration, and structure, and other departments out of farms', async () => {
    const { t } = await setup();
    expect((await get(t.ops, '/payroll')).status).toBe(403);
    expect((await get(t.ops, '/payroll/compensation')).status).toBe(403);
    expect((await post(t.ops, '/users', { username: 'x', email: 'x@x.test' })).status).toBe(403);
    expect((await post(t.ops, '/organisation/departments', { code: 'NEW', name: 'New' })).status).toBe(403);
    expect((await request(app).put('/api/v1/governance/settings').set(auth(t.ops)).send({ executiveThreshold: 1 })).status).toBe(403);
    expect((await get(t.hr, '/farm/farms')).status).toBe(403);
    expect((await get(t.store, '/farm/farms')).status).toBe(403);
    expect((await get(t.sysadmin, '/farm/farms')).status).toBe(403);
    expect((await get(t.ceo, '/farm/farms')).status).toBe(200);
    expect((await post(t.ceo, '/farm/farms', { code: 'C-1', name: 'CEO farm', location: 'x', totalAreaHa: 1, cultivatedAreaHa: 1, ownership: 'owned' })).status).toBe(403);
    // The CEO is an employee too.
    const me = await get(t.ceo, '/auth/me');
    expect(me.body.data.employeeId).not.toBeNull();
  });
});
