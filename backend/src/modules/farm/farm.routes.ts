import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { query, queryOne, withTransaction } from '../../database/query';
import { requestMeta, writeAudit } from '../../services/auditService';
import { requireCompanyId } from '../../services/companyContext';
import { documentContent, listDocuments, storeDocument } from '../../services/documents';
import { sendReport } from '../../services/reportFiles';
import { requireWorkspace } from '../../services/workspaces';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { buildFarmReport, farmDashboard, farmReportCatalog, resolveRange } from './farm.analytics';
import { activityTypes, assertFarmInScope, farmScope, incidentCategories, inputCategories, PRODUCE_CATEGORY, requestCategories, scopeSql } from './farm.common';
import * as farm from './farm.service';
import * as resources from './farm.resources';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

const id = z.object({ id: z.coerce.number().int().positive() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = date.nullable().optional();
const money = z.number().nonnegative().max(999999999999);
const qty = z.number().positive().max(999999999);
const optionalId = z.number().int().positive().nullable().optional();
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => (value === '' ? null : value));
const queryId = z.coerce.number().int().positive().optional();
const listFilters = z.object({
  farmId: queryId, from: date.optional(), to: date.optional(), status: z.string().max(30).optional(), crop: z.string().max(80).optional(),
  season: z.string().max(20).optional(), type: z.string().max(40).optional(), priority: z.string().max(20).optional(), category: z.string().max(40).optional(),
  search: z.string().trim().max(120).optional(), overdue: z.coerce.boolean().optional(), open: z.coerce.boolean().optional(), maintenance: z.coerce.boolean().optional(),
  submittedBy: queryId,
});

const farmBody = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers, and dashes.'), name: shortText(160), location: shortText(200),
  region: optionalText(120), gpsCoordinates: optionalText(80), totalAreaHa: money, cultivatedAreaHa: money,
  ownership: z.enum(['owned', 'leased', 'partner']).default('owned'), status: z.enum(['active', 'fallow', 'inactive']).optional(),
  departmentId: optionalId, supervisorEmployeeId: optionalId, warehouseId: optionalId, notes: optionalText(1000),
});
const teamBody = z.object({ employeeId: z.number().int().positive(), teamRole: z.enum(['supervisor', 'worker', 'operator']), responsibilities: optionalText(500), startDate: date.optional() });
const cycleBody = z.object({
  farmId: z.number().int().positive(), crop: shortText(80), variety: optionalText(80), season: shortText(20), areaHa: z.number().positive().max(1000000),
  plantingDate: optionalDate, expectedHarvestDate: optionalDate, stage: z.enum(['planned', 'land_preparation', 'planting', 'vegetative', 'flowering', 'fruiting', 'harvesting', 'completed']).optional(),
  expectedYieldKg: money.nullable().optional(), status: z.enum(['active', 'completed', 'abandoned']).optional(), notes: optionalText(1000),
});
const activityBody = z.object({
  farmId: z.number().int().positive(), cropCycleId: optionalId, activityType: z.enum(activityTypes), title: shortText(200), scheduledDate: date, dueDate: date,
  assignedUserId: optionalId, status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(), notes: optionalText(1000),
});
const dailyBody = z.object({
  farmId: z.number().int().positive(), activityId: optionalId, activityDate: date, activityType: z.enum(activityTypes), workPerformed: z.string().trim().min(5).max(2000),
  workersCount: z.number().int().min(0).max(100000), workerNames: optionalText(1000), resourcesUsed: optionalText(1000), workCompleted: optionalText(1000),
  areaCoveredHa: money.nullable().optional(), challenges: optionalText(1000), supervisorRemarks: optionalText(1000), markActivityCompleted: z.boolean().optional(),
});
const reviewBody = z.object({ action: z.enum(['acknowledge', 'return']), remarks: z.string().trim().max(1000).optional() });
const inspectionBody = z.object({
  farmId: z.number().int().positive(), cropCycleId: optionalId, inspectionDate: date,
  inspectionType: z.enum(['routine', 'crop_health', 'pest', 'compliance', 'harvest_readiness', 'equipment', 'safety']), rating: z.number().int().min(1).max(5).nullable().optional(),
  findings: z.string().trim().min(5).max(2000), recommendations: optionalText(2000), followUpDate: optionalDate, status: z.enum(['open', 'follow_up', 'closed']).optional(),
});
const targetBody = z.object({ farmId: z.number().int().positive(), crop: shortText(80), season: shortText(20), periodStart: date, periodEnd: date, targetKg: qty, notes: optionalText(500) });
const harvestBody = z.object({
  farmId: z.number().int().positive(), cropCycleId: optionalId, crop: z.string().trim().max(80).optional(), season: z.string().trim().max(20).optional(), harvestDate: date,
  expectedKg: money.nullable().optional(), quantityKg: qty, lossKg: money.optional(), grade: optionalText(40), moisturePercent: z.number().min(0).max(100).nullable().optional(),
  qualityNotes: optionalText(1000), stockItemId: optionalId, warehouseId: optionalId,
});
const verifyBody = z.object({ stockItemId: optionalId, warehouseId: optionalId, unitCost: money.optional() });
const reasonBody = z.object({ reason: z.string().trim().min(8).max(500) });
const equipmentBody = z.object({
  name: shortText(160), assetType: z.enum(['truck', 'vehicle', 'tractor', 'harvester', 'irrigation_pump', 'sprayer', 'processing_machine', 'generator', 'tool', 'other']),
  registrationNumber: optionalText(60), condition: z.enum(['good', 'fair', 'poor', 'out_of_service']).optional(), status: z.enum(['available', 'in_use', 'maintenance', 'retired']).optional(),
  nextServiceOn: optionalDate, notes: optionalText(1000),
});
const eventBody = z.object({
  eventType: z.enum(['allocation', 'release', 'maintenance', 'repair', 'usage', 'condition']), eventDate: date, farmId: optionalId, description: z.string().trim().min(3).max(1000),
  cost: money.nullable().optional(), hours: z.number().min(0).max(100000).nullable().optional(), condition: z.enum(['good', 'fair', 'poor', 'out_of_service']).optional(), nextServiceOn: optionalDate,
});
const requestBody = z.object({
  farmId: z.number().int().positive(), category: z.enum(requestCategories), stockItemId: optionalId, description: shortText(300), quantity: qty, unit: shortText(20),
  estimatedCost: money.nullable().optional(), justification: z.string().trim().min(10).max(1000), neededBy: optionalDate, specialApproval: z.boolean().optional(),
});
const decisionBody = z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(1000).optional() });
const fulfilBody = z.object({ warehouseId: optionalId, quantity: qty.optional(), remarks: optionalText(1000) });
const incidentBody = z.object({
  farmId: z.number().int().positive(), category: z.enum(incidentCategories), title: shortText(200), description: z.string().trim().min(10).max(2000),
  priority: z.enum(['low', 'medium', 'high', 'critical']), occurredOn: date,
});
const incidentUpdate = z.object({
  status: z.enum(['reported', 'investigating', 'in_progress', 'resolved', 'closed']).optional(), assignedToUserId: optionalId,
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(), resolutionRemarks: optionalText(2000),
});
const tripBody = z.object({
  tripDate: date, vehicleId: optionalId, driverName: optionalText(160), origin: shortText(200), destination: shortText(200), cargo: optionalText(200),
  quantityKg: money.nullable().optional(), distanceKm: money.nullable().optional(), fuelLitres: money.nullable().optional(),
  status: z.enum(['planned', 'in_transit', 'delivered', 'cancelled']).optional(), notes: optionalText(1000),
});
const dispatchBody = z.object({
  farmId: optionalId, stockItemId: z.number().int().positive(), warehouseId: z.number().int().positive(), quantity: qty, collectionLocation: shortText(200),
  destination: shortText(200), purpose: z.enum(['sale', 'processing', 'transfer', 'other']), requiredBy: optionalDate, remarks: optionalText(1000),
});
const scheduleBody = z.object({ tripId: optionalId, tripDate: date.optional(), vehicleId: optionalId, driverName: optionalText(160), distanceKm: money.nullable().optional(), remarks: optionalText(1000) });
const reportQuery = z.object({
  period: z.enum(['today', 'week', 'month', 'quarter', 'year', 'custom']).optional(), from: date.optional(), to: date.optional(),
  farmId: queryId, crop: z.string().max(80).optional(), season: z.string().max(20).optional(), supervisorUserId: queryId,
});
const documentBody = z.object({ fileName: z.string().trim().min(1).max(200), contentType: z.string().trim().min(3).max(120), description: optionalText(300), contentBase64: z.string().min(4).max(7_000_000) });
const attachmentParams = z.object({ entity: z.enum(['daily-reports', 'incidents']), id: z.coerce.number().int().positive() });
const attachmentFile = attachmentParams.extend({ documentId: z.coerce.number().int().positive() });

export const farmRouter = Router();
farmRouter.use(requireAuth, requireWorkspace('operations'), requirePermission('farm.view'));

const q = (req: Request) => req.query as never;

// Lists for forms: farms, crops, seasons, people, stock items, stores, vehicles.
farmRouter.get('/meta', asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const scope = scopeSql(await farmScope(auth), 'f.id');
  const farms = await query<RowDataPacket[]>(pool, `SELECT f.id, f.code, f.name, f.warehouse_id FROM farms f WHERE ${scope.sql} AND f.status <> 'inactive' ORDER BY f.name`, scope.params);
  const crops = await query<RowDataPacket[]>(pool, `SELECT DISTINCT crop FROM farm_crop_cycles UNION SELECT DISTINCT crop FROM farm_production_targets ORDER BY 1`);
  const seasons = await query<RowDataPacket[]>(pool, `SELECT DISTINCT season FROM farm_crop_cycles UNION SELECT DISTINCT season FROM farm_production_targets ORDER BY 1 DESC`);
  const employees = await query<RowDataPacket[]>(pool,
    `SELECT e.id, e.first_name, e.last_name, e.employee_number, d.name AS department FROM employees e
     JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL JOIN departments d ON d.id = ea.department_id
     WHERE e.deleted_at IS NULL AND e.employment_status IN ('active', 'probation') AND (d.code LIKE 'OPS%' OR d.code = 'EXEC') ORDER BY e.last_name, e.first_name`);
  const people = await query<RowDataPacket[]>(pool,
    `SELECT DISTINCT u.id, COALESCE(NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), ''), u.username) AS name FROM users u
     JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id AND p.code IN ('farm.report', 'farm.manage')
     LEFT JOIN employees e ON e.id = u.employee_id WHERE u.status = 'active' ORDER BY 2`);
  const items = await query<RowDataPacket[]>(pool,
    `SELECT i.id, i.sku, i.name, i.unit, c.name AS category FROM stock_items i LEFT JOIN stock_categories c ON c.id = i.category_id
     WHERE i.status = 'active' AND c.name IN (${[PRODUCE_CATEGORY, ...inputCategories].map(() => '?').join(', ')}) ORDER BY c.name, i.name`, [PRODUCE_CATEGORY, ...inputCategories]);
  const warehouses = await query<RowDataPacket[]>(pool, `SELECT id, code, name FROM warehouses WHERE status = 'active' ORDER BY name`);
  const vehicles = await query<RowDataPacket[]>(pool, `SELECT id, asset_code, name, registration_number, status FROM equipment_assets WHERE asset_type IN ('truck', 'vehicle', 'tractor') AND status <> 'retired' ORDER BY name`);
  const trips = await query<RowDataPacket[]>(pool, `SELECT id, reference_number, trip_date, origin, destination FROM haulage_trips WHERE status = 'planned' ORDER BY trip_date`);
  res.json({ data: {
    farms: farms.map((row) => ({ id: Number(row.id), code: String(row.code), name: String(row.name), warehouseId: row.warehouse_id == null ? null : Number(row.warehouse_id) })),
    crops: crops.map((row) => String(row.crop)), seasons: seasons.map((row) => String(row.season)),
    employees: employees.map((row) => ({ id: Number(row.id), name: `${row.first_name} ${row.last_name}`, employeeNumber: String(row.employee_number), department: String(row.department) })),
    people: people.map((row) => ({ id: Number(row.id), name: String(row.name) })),
    produceItems: items.filter((row) => row.category === PRODUCE_CATEGORY).map((row) => ({ id: Number(row.id), name: String(row.name), unit: String(row.unit), sku: String(row.sku) })),
    inputItems: items.filter((row) => row.category !== PRODUCE_CATEGORY).map((row) => ({ id: Number(row.id), name: String(row.name), unit: String(row.unit), category: String(row.category) })),
    warehouses: warehouses.map((row) => ({ id: Number(row.id), name: String(row.name), code: String(row.code) })),
    vehicles: vehicles.map((row) => ({ id: Number(row.id), name: `${row.name}${row.registration_number ? ` (${row.registration_number})` : ''}`, status: String(row.status) })),
    plannedTrips: trips.map((row) => ({ id: Number(row.id), label: `${row.reference_number} · ${row.trip_date} · ${row.origin} → ${row.destination}` })),
    activityTypes, incidentCategories, requestCategories,
    reports: farmReportCatalog,
  } });
}));

farmRouter.get('/dashboard', validate({ query: reportQuery }), asyncRoute(async (req, res) => {
  const query = req.query as { period?: string; from?: string; to?: string };
  res.json({ data: await farmDashboard(req.auth!, resolveRange(query.period, query.from, query.to)) });
}));

farmRouter.get('/farms', asyncRoute(async (req, res) => { res.json({ data: await farm.listFarms(req.auth!) }); }));
farmRouter.get('/farms/:id', validate({ params: id }), asyncRoute(async (req, res) => { res.json({ data: await farm.getFarm(req.auth!, Number(req.params.id)) }); }));
farmRouter.post('/farms', validate({ body: farmBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.createFarm(req.auth!, req.body, actor(req)) }); }));
farmRouter.patch('/farms/:id', validate({ params: id, body: farmBody.partial() }), asyncRoute(async (req, res) => { res.json({ data: await farm.updateFarm(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/farms/:id/team', validate({ params: id, body: teamBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.addTeamMember(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/team', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listTeam(req.auth!, q(req)) }); }));
farmRouter.post('/team/:id/end', validate({ params: id }), asyncRoute(async (req, res) => { res.json({ data: await farm.endTeamMember(req.auth!, Number(req.params.id), actor(req)) }); }));
farmRouter.get('/supervisors', asyncRoute(async (req, res) => { res.json({ data: await farm.listSupervisors(req.auth!) }); }));

farmRouter.get('/crop-cycles', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listCropCycles(req.auth!, q(req)) }); }));
farmRouter.post('/crop-cycles', validate({ body: cycleBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.saveCropCycle(req.auth!, null, req.body, actor(req)) }); }));
farmRouter.put('/crop-cycles/:id', validate({ params: id, body: cycleBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.saveCropCycle(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/activities', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listActivities(req.auth!, q(req)) }); }));
farmRouter.post('/activities', validate({ body: activityBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.saveActivity(req.auth!, null, req.body, actor(req)) }); }));
farmRouter.put('/activities/:id', validate({ params: id, body: activityBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.saveActivity(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/daily-reports', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listDailyReports(req.auth!, q(req)) }); }));
farmRouter.post('/daily-reports', validate({ body: dailyBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.submitDailyReport(req.auth!, req.body, actor(req)) }); }));
farmRouter.put('/daily-reports/:id', validate({ params: id, body: dailyBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.resubmitDailyReport(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/daily-reports/:id/review', validate({ params: id, body: reviewBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.reviewDailyReport(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/inspections', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listInspections(req.auth!, q(req)) }); }));
farmRouter.post('/inspections', validate({ body: inspectionBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.saveInspection(req.auth!, null, req.body, actor(req)) }); }));
farmRouter.put('/inspections/:id', validate({ params: id, body: inspectionBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.saveInspection(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/targets', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listTargets(req.auth!, q(req)) }); }));
farmRouter.post('/targets', validate({ body: targetBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.saveTarget(req.auth!, null, req.body, actor(req)) }); }));
farmRouter.put('/targets/:id', validate({ params: id, body: targetBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.saveTarget(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/harvests', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listHarvests(req.auth!, q(req)) }); }));
farmRouter.post('/harvests', validate({ body: harvestBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.recordHarvest(req.auth!, req.body, actor(req)) }); }));
farmRouter.post('/harvests/:id/verify', validate({ params: id, body: verifyBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.verifyHarvest(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/harvests/:id/reject', validate({ params: id, body: reasonBody }), asyncRoute(async (req, res) => { res.json({ data: await farm.rejectHarvest(req.auth!, Number(req.params.id), req.body.reason, actor(req)) }); }));
farmRouter.get('/yield', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.yieldPerformance(req.auth!, q(req)) }); }));

farmRouter.get('/equipment', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await resources.listEquipment(req.auth!, q(req)) }); }));
farmRouter.get('/equipment/:id', validate({ params: id }), asyncRoute(async (req, res) => { res.json({ data: await resources.equipmentHistory(req.auth!, Number(req.params.id)) }); }));
farmRouter.post('/equipment', validate({ body: equipmentBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await resources.saveEquipment(req.auth!, null, req.body, actor(req)) }); }));
farmRouter.put('/equipment/:id', validate({ params: id, body: equipmentBody }), asyncRoute(async (req, res) => { res.json({ data: await resources.saveEquipment(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/equipment/:id/events', validate({ params: id, body: eventBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await resources.recordEquipmentEvent(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/inputs', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await resources.listInputs(req.auth!, q(req)) }); }));

farmRouter.get('/resource-requests', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await resources.listResourceRequests(req.auth!, q(req)) }); }));
farmRouter.get('/resource-requests/:id', validate({ params: id }), asyncRoute(async (req, res) => { res.json({ data: await resources.getResourceRequest(req.auth!, Number(req.params.id)) }); }));
farmRouter.post('/resource-requests', validate({ body: requestBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await resources.submitResourceRequest(req.auth!, req.body, actor(req)) }); }));
farmRouter.post('/resource-requests/:id/decision', validate({ params: id, body: decisionBody }), asyncRoute(async (req, res) => { res.json({ data: await resources.decideResourceRequest(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.put('/resource-requests/:id', validate({ params: id, body: requestBody.partial() }), asyncRoute(async (req, res) => { res.json({ data: await resources.resubmitResourceRequest(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/resource-requests/:id/fulfil', validate({ params: id, body: fulfilBody }), asyncRoute(async (req, res) => { res.json({ data: await resources.fulfilResourceRequest(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/produce', asyncRoute(async (req, res) => { res.json({ data: await resources.producePosition(req.auth!) }); }));

farmRouter.get('/incidents', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await farm.listIncidents(req.auth!, q(req)) }); }));
farmRouter.post('/incidents', validate({ body: incidentBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await farm.reportIncident(req.auth!, req.body, actor(req)) }); }));
farmRouter.patch('/incidents/:id', validate({ params: id, body: incidentUpdate }), asyncRoute(async (req, res) => { res.json({ data: await farm.updateIncident(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/trips', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await resources.listTrips(q(req)) }); }));
farmRouter.post('/trips', validate({ body: tripBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await resources.saveTrip(req.auth!, null, req.body, actor(req)) }); }));
farmRouter.put('/trips/:id', validate({ params: id, body: tripBody }), asyncRoute(async (req, res) => { res.json({ data: await resources.saveTrip(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));

farmRouter.get('/dispatches', validate({ query: listFilters }), asyncRoute(async (req, res) => { res.json({ data: await resources.listDispatches(req.auth!, q(req)) }); }));
farmRouter.post('/dispatches', validate({ body: dispatchBody }), asyncRoute(async (req, res) => { res.status(201).json({ data: await resources.requestDispatch(req.auth!, req.body, actor(req)) }); }));
farmRouter.post('/dispatches/:id/schedule', validate({ params: id, body: scheduleBody }), asyncRoute(async (req, res) => { res.json({ data: await resources.scheduleDispatch(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/dispatches/:id/depart', validate({ params: id }), asyncRoute(async (req, res) => { res.json({ data: await resources.departDispatch(req.auth!, Number(req.params.id), actor(req)) }); }));
farmRouter.post('/dispatches/:id/deliver', validate({ params: id, body: z.object({ remarks: optionalText(1000) }) }), asyncRoute(async (req, res) => { res.json({ data: await resources.deliverDispatch(req.auth!, Number(req.params.id), req.body, actor(req)) }); }));
farmRouter.post('/dispatches/:id/cancel', validate({ params: id, body: reasonBody }), asyncRoute(async (req, res) => { res.json({ data: await resources.cancelDispatch(req.auth!, Number(req.params.id), req.body.reason, actor(req)) }); }));

farmRouter.get('/pending', asyncRoute(async (req, res) => { res.json({ data: await resources.pendingWork(req.auth!) }); }));

// Reports: JSON for the screen, PDF and Excel for export.
farmRouter.get('/reports/:code', validate({ query: reportQuery }), asyncRoute(async (req, res) => {
  const filters = req.query as { period?: string; from?: string; to?: string; farmId?: number; crop?: string; season?: string; supervisorUserId?: number };
  res.json({ data: await buildFarmReport(req.auth!, String(req.params.code), { ...filters, ...resolveRange(filters.period ?? 'month', filters.from, filters.to) }) });
}));
for (const format of ['xlsx', 'pdf'] as const) {
  farmRouter.get(`/reports/:code/export.${format}`, requirePermission('farm.export'), validate({ query: reportQuery }), asyncRoute(async (req, res) => {
    const filters = req.query as { period?: string; from?: string; to?: string; farmId?: number; crop?: string; season?: string; supervisorUserId?: number };
    const report = await buildFarmReport(req.auth!, String(req.params.code), { ...filters, ...resolveRange(filters.period ?? 'month', filters.from, filters.to) });
    await writeAudit(pool, { userId: req.auth!.userId, action: 'farm.report.export', module: 'farm', entityType: 'farm_report', entityId: String(req.params.code), newValue: { format, filters }, ...requestMeta(req) });
    await sendReport(res, format, `farm-${String(req.params.code).replace(/_/g, '-')}`, report.title, report.tables);
  }));
}

// Photographs and documents on daily reports and incidents, kept in the shared supporting-documents store.
const entityTypes = { 'daily-reports': 'farm_daily_report', incidents: 'farm_incident' } as const;
async function assertAttachable(auth: AuthContext, entity: keyof typeof entityTypes, entityId: number) {
  const table = entity === 'daily-reports' ? 'farm_daily_reports' : 'farm_incidents';
  const owner = entity === 'daily-reports' ? 'submitted_by' : 'reported_by';
  const row = await queryOne<RowDataPacket>(pool, `SELECT farm_id, ${owner} AS owner FROM ${table} WHERE id = ?`, [entityId]);
  if (!row) throw notFound('Record');
  if (Number(row.owner) !== auth.userId) await assertFarmInScope(auth, Number(row.farm_id));
  return row;
}
farmRouter.get('/:entity/:id/documents', validate({ params: attachmentParams }), asyncRoute(async (req, res) => {
  const entity = String(req.params.entity) as keyof typeof entityTypes;
  await assertAttachable(req.auth!, entity, Number(req.params.id));
  res.json({ data: await listDocuments(pool, [{ type: entityTypes[entity], id: Number(req.params.id) }]) });
}));
farmRouter.post('/:entity/:id/documents', validate({ params: attachmentParams, body: documentBody }), asyncRoute(async (req, res) => {
  const entity = String(req.params.entity) as keyof typeof entityTypes;
  const row = await assertAttachable(req.auth!, entity, Number(req.params.id));
  if (Number(row.owner) !== req.auth!.userId && !req.auth!.grants.some((grant) => grant.permission === 'farm.review')) {
    throw new HttpError(403, 'Only the author or a reviewer can add attachments.', 'FORBIDDEN');
  }
  const stored = await withTransaction(async (connection) => {
    const saved = await storeDocument(connection, { companyId: await requireCompanyId(connection), entityType: entityTypes[entity], entityId: Number(req.params.id), ...req.body, userId: req.auth!.userId });
    await writeAudit(connection, { userId: req.auth!.userId, action: 'farm.attachment.add', module: 'farm', entityType: entityTypes[entity], entityId: Number(req.params.id), newValue: { documentId: saved.id, fileName: saved.fileName, sha256: saved.sha256 }, ...requestMeta(req) });
    return saved;
  });
  res.status(201).json({ data: stored });
}));
farmRouter.get('/:entity/:id/documents/:documentId', validate({ params: attachmentFile }), asyncRoute(async (req, res) => {
  const entity = String(req.params.entity) as keyof typeof entityTypes;
  await assertAttachable(req.auth!, entity, Number(req.params.id));
  const file = await documentContent(pool, Number(req.params.documentId), [{ type: entityTypes[entity], id: Number(req.params.id) }]);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `${file.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.content);
}));
