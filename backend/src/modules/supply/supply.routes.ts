import { Router, type Request } from 'express';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { requireWorkspace } from '../../services/workspaces';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { sendReport } from '../../services/reportFiles';
import { todayIso } from '../../utils/pagination';
import {
  cancelOrder,
  createCategory,
  createItem,
  createOrder,
  createRequisition,
  createSupplier,
  createWarehouse,
  inventoryReportTables,
  inventorySummary,
  inventorySummaryToCsv,
  listBalances,
  listCategories,
  listInvoices,
  listItems,
  listMovements,
  listOrders,
  listReceipts,
  listRequisitions,
  listSuppliers,
  listWarehouses,
  postMovement,
  procurementReportTables,
  procurementSummary,
  procurementSummaryToCsv,
  receiveGoods,
  recordInvoice,
  resubmitRequisition,
  setItemStatus,
  setSupplierStatus,
} from './supply.service';
import {
  categoryWriteSchema,
  idParamSchema,
  invoiceWriteSchema,
  itemStatusSchema,
  itemWriteSchema,
  movementWriteSchema,
  orderWriteSchema,
  receiptWriteSchema,
  reportQuerySchema,
  requisitionWriteSchema,
  supplierStatusSchema,
  supplierWriteSchema,
  warehouseWriteSchema,
} from './supply.schema';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

function reportRange(query: { from?: string; to?: string }) {
  const today = todayIso();
  return { from: query.from ?? `${today.slice(0, 4)}-01-01`, to: query.to ?? today };
}

export const procurementRouter = Router();
procurementRouter.use(requireAuth, requireWorkspace('procurement'));

procurementRouter.get('/suppliers', requirePermission('procurement.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await listSuppliers() });
}));

procurementRouter.post('/suppliers', requirePermission('procurement.manage'), validate({ body: supplierWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createSupplier(req.auth!, req.body, actor(req)) });
}));

procurementRouter.patch('/suppliers/:id', requirePermission('procurement.manage'), validate({ params: idParamSchema, body: supplierStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await setSupplierStatus(Number(req.params.id), req.body.status, actor(req)) });
}));

procurementRouter.get('/requisitions', requirePermission('procurement.view', 'procurement.request'), asyncRoute(async (req, res) => {
  res.json({ data: await listRequisitions(req.auth!) });
}));

procurementRouter.post('/requisitions', requirePermission('procurement.request', 'procurement.manage'), validate({ body: requisitionWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createRequisition(req.auth!, req.body, actor(req)) });
}));

procurementRouter.post('/requisitions/:id/resubmit', requirePermission('procurement.request', 'procurement.manage'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resubmitRequisition(req.auth!, Number(req.params.id), actor(req)) });
}));

procurementRouter.get('/orders', requirePermission('procurement.view', 'inventory.manage'), asyncRoute(async (req, res) => {
  res.json({ data: await listOrders(req.auth!) });
}));

procurementRouter.post('/orders', requirePermission('procurement.manage'), validate({ body: orderWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createOrder(req.auth!, req.body, actor(req)) });
}));

procurementRouter.post('/orders/:id/cancel', requirePermission('procurement.manage'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await cancelOrder(Number(req.params.id), actor(req)) });
}));

procurementRouter.get('/receipts', requirePermission('procurement.view', 'inventory.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await listReceipts() });
}));

procurementRouter.post('/receipts', requirePermission('procurement.manage', 'inventory.manage'), validate({ body: receiptWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await receiveGoods(req.auth!, req.body, actor(req)) });
}));

procurementRouter.get('/invoices', requirePermission('procurement.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await listInvoices() });
}));

procurementRouter.post('/invoices', requirePermission('procurement.manage'), validate({ body: invoiceWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await recordInvoice(req.auth!, req.body, actor(req)) });
}));

procurementRouter.get('/reports', requirePermission('procurement.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  res.json({ data: await procurementSummary(reportRange(req.query as { from?: string; to?: string })) });
}));

procurementRouter.get('/reports.csv', requirePermission('procurement.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await procurementSummary(reportRange(req.query as { from?: string; to?: string }));
  res.type('text/csv').send(procurementSummaryToCsv(summary));
}));

procurementRouter.get('/reports.xlsx', requirePermission('procurement.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await procurementSummary(reportRange(req.query as { from?: string; to?: string }));
  await sendReport(res, 'xlsx', 'procurement-report', `Procurement report ${summary.from} to ${summary.to}`, procurementReportTables(summary));
}));

procurementRouter.get('/reports.pdf', requirePermission('procurement.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await procurementSummary(reportRange(req.query as { from?: string; to?: string }));
  await sendReport(res, 'pdf', 'procurement-report', `Procurement report ${summary.from} to ${summary.to}`, procurementReportTables(summary));
}));

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireWorkspace('inventory'));

inventoryRouter.get('/categories', requirePermission('inventory.view', 'inventory.manage'), asyncRoute(async (_req, res) => {
  res.json({ data: await listCategories() });
}));

inventoryRouter.post('/categories', requirePermission('inventory.manage'), validate({ body: categoryWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createCategory(req.body.name) });
}));

inventoryRouter.get('/warehouses', requirePermission('inventory.view', 'inventory.manage', 'procurement.manage'), asyncRoute(async (_req, res) => {
  res.json({ data: await listWarehouses() });
}));

inventoryRouter.post('/warehouses', requirePermission('inventory.manage'), validate({ body: warehouseWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createWarehouse(req.body) });
}));

inventoryRouter.get('/items', requirePermission('inventory.view', 'inventory.manage', 'procurement.request', 'procurement.manage'), asyncRoute(async (_req, res) => {
  res.json({ data: await listItems() });
}));

inventoryRouter.post('/items', requirePermission('inventory.manage'), validate({ body: itemWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createItem(req.body) });
}));

inventoryRouter.patch('/items/:id', requirePermission('inventory.manage'), validate({ params: idParamSchema, body: itemStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await setItemStatus(Number(req.params.id), req.body.status) });
}));

inventoryRouter.get('/balances', requirePermission('inventory.view', 'inventory.manage'), asyncRoute(async (_req, res) => {
  res.json({ data: await listBalances() });
}));

inventoryRouter.get('/movements', requirePermission('inventory.view', 'inventory.manage'), asyncRoute(async (_req, res) => {
  res.json({ data: await listMovements() });
}));

inventoryRouter.post('/movements', requirePermission('inventory.manage'), validate({ body: movementWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await postMovement(req.auth!, req.body, actor(req)) });
}));

inventoryRouter.get('/reports', requirePermission('inventory.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  res.json({ data: await inventorySummary(reportRange(req.query as { from?: string; to?: string })) });
}));

inventoryRouter.get('/reports.csv', requirePermission('inventory.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await inventorySummary(reportRange(req.query as { from?: string; to?: string }));
  res.type('text/csv').send(inventorySummaryToCsv(summary));
}));

inventoryRouter.get('/reports.xlsx', requirePermission('inventory.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await inventorySummary(reportRange(req.query as { from?: string; to?: string }));
  await sendReport(res, 'xlsx', 'inventory-report', `Stock report ${summary.from} to ${summary.to}`, inventoryReportTables(summary));
}));

inventoryRouter.get('/reports.pdf', requirePermission('inventory.view'), validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await inventorySummary(reportRange(req.query as { from?: string; to?: string }));
  await sendReport(res, 'pdf', 'inventory-report', `Stock report ${summary.from} to ${summary.to}`, inventoryReportTables(summary));
}));
