import { Router, type Request } from 'express';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { requireWorkspace } from '../../services/workspaces';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { sendReport } from '../../services/reportFiles';
import { todayIso } from '../../utils/pagination';
import {
  createAccount,
  createBudget,
  createCashAccount,
  createCustomer,
  createCustomerInvoice,
  createJournal,
  createPayment,
  financeReportTables,
  financeSummary,
  financeSummaryToCsv,
  listAccounts,
  listBudgets,
  listCashAccounts,
  listCustomerInvoices,
  listCustomers,
  listJournals,
  listPayments,
  payRequest,
  postPettyExpense,
  postSupplierInvoice,
  receiveCustomerPayment,
  reconcile,
  resubmitPayment,
  reverseJournal,
  setAccountStatus,
  unclearedLines,
} from './finance.service';
import {
  accountStatusSchema,
  accountWriteSchema,
  budgetWriteSchema,
  cashWriteSchema,
  customerInvoiceSchema,
  customerWriteSchema,
  idParamSchema,
  journalWriteSchema,
  paymentWriteSchema,
  pettySchema,
  receiptSchema,
  reconcileSchema,
  reportQuerySchema,
  reverseSchema,
  supplierPostSchema,
} from './finance.schema';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

function reportRange(query: { from?: string; to?: string; year?: number; quarter?: number; financialYear?: number }) {
  const pad = (value: number) => String(value).padStart(2, '0');
  if (query.financialYear) {
    return { from: `${query.financialYear}-01-01`, to: `${query.financialYear}-12-31` };
  }
  if (query.year && query.quarter) {
    const startMonth = (query.quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const endDay = new Date(Date.UTC(query.year, endMonth, 0)).getUTCDate();
    return { from: `${query.year}-${pad(startMonth)}-01`, to: `${query.year}-${pad(endMonth)}-${pad(endDay)}` };
  }
  if (query.year) return { from: `${query.year}-01-01`, to: `${query.year}-12-31` };
  const today = todayIso();
  return { from: query.from ?? `${today.slice(0, 4)}-01-01`, to: query.to ?? today };
}

export const financeRouter = Router();
financeRouter.use(requireAuth);
const books = requireWorkspace('finance');

financeRouter.get('/accounts', requirePermission('finance.view', 'finance.manage', 'finance.request'), books, asyncRoute(async (_req, res) => {
  res.json({ data: await listAccounts() });
}));

financeRouter.post('/accounts', requirePermission('finance.manage'), books, validate({ body: accountWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createAccount(req.body) });
}));

financeRouter.patch('/accounts/:id', requirePermission('finance.manage'), books, validate({ params: idParamSchema, body: accountStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await setAccountStatus(Number(req.params.id), req.body.status) });
}));

financeRouter.get('/cash', requirePermission('finance.view', 'finance.manage', 'finance.request'), books, asyncRoute(async (_req, res) => {
  res.json({ data: await listCashAccounts() });
}));

financeRouter.post('/cash', requirePermission('finance.manage'), books, validate({ body: cashWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createCashAccount(req.body) });
}));

financeRouter.get('/cash/:id/lines', requirePermission('finance.manage'), books, validate({ params: idParamSchema, query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const query = req.query as { to?: string };
  res.json({ data: await unclearedLines(Number(req.params.id), query.to ?? todayIso()) });
}));

financeRouter.post('/cash/:id/reconcile', requirePermission('finance.manage'), books, validate({ params: idParamSchema, body: reconcileSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await reconcile(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

financeRouter.get('/journals', requirePermission('finance.view', 'finance.manage'), books, asyncRoute(async (_req, res) => {
  res.json({ data: await listJournals() });
}));

financeRouter.post('/journals', requirePermission('finance.manage'), books, validate({ body: journalWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createJournal(req.auth!, req.body, actor(req)) });
}));

financeRouter.post('/journals/:id/reverse', requirePermission('finance.manage'), books, validate({ params: idParamSchema, body: reverseSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await reverseJournal(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

financeRouter.post('/petty', requirePermission('finance.manage'), books, validate({ body: pettySchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await postPettyExpense(req.auth!, req.body, actor(req)) });
}));

financeRouter.get('/payments', requirePermission('finance.view', 'finance.request'), asyncRoute(async (req, res) => {
  res.json({ data: await listPayments(req.auth!) });
}));

financeRouter.post('/payments', requirePermission('finance.request', 'finance.manage'), validate({ body: paymentWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createPayment(req.auth!, req.body, actor(req)) });
}));

financeRouter.post('/payments/:id/resubmit', requirePermission('finance.request', 'finance.manage'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resubmitPayment(req.auth!, Number(req.params.id), actor(req)) });
}));

financeRouter.post('/payments/:id/pay', requirePermission('finance.manage'), books, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await payRequest(req.auth!, Number(req.params.id), actor(req)) });
}));

financeRouter.post('/supplier-invoices/:id/post', requirePermission('finance.manage'), books, validate({ params: idParamSchema, body: supplierPostSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await postSupplierInvoice(req.auth!, Number(req.params.id), req.body.expenseAccountId, actor(req)) });
}));

financeRouter.get('/customers', requirePermission('finance.view', 'finance.manage'), books, asyncRoute(async (_req, res) => {
  res.json({ data: await listCustomers() });
}));

financeRouter.post('/customers', requirePermission('finance.manage'), books, validate({ body: customerWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createCustomer(req.auth!, req.body.name, actor(req)) });
}));

financeRouter.get('/customer-invoices', requirePermission('finance.view', 'finance.manage'), books, asyncRoute(async (_req, res) => {
  res.json({ data: await listCustomerInvoices() });
}));

financeRouter.post('/customer-invoices', requirePermission('finance.manage'), books, validate({ body: customerInvoiceSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createCustomerInvoice(req.auth!, req.body, actor(req)) });
}));

financeRouter.post('/customer-invoices/:id/receipts', requirePermission('finance.manage'), books, validate({ params: idParamSchema, body: receiptSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await receiveCustomerPayment(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

financeRouter.get('/budgets', requirePermission('finance.view', 'finance.request'), asyncRoute(async (req, res) => {
  res.json({ data: await listBudgets(req.auth!) });
}));

financeRouter.post('/budgets', requirePermission('finance.request', 'finance.manage'), validate({ body: budgetWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createBudget(req.auth!, req.body, actor(req)) });
}));

financeRouter.get('/reports', requirePermission('finance.view'), books, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  res.json({ data: await financeSummary(reportRange(req.query as { from?: string; to?: string; year?: number; quarter?: number; financialYear?: number })) });
}));

financeRouter.get('/reports.csv', requirePermission('finance.view'), books, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await financeSummary(reportRange(req.query as { from?: string; to?: string; year?: number; quarter?: number; financialYear?: number }));
  res.type('text/csv').send(financeSummaryToCsv(summary));
}));

financeRouter.get('/reports.xlsx', requirePermission('finance.view'), books, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await financeSummary(reportRange(req.query as { from?: string; to?: string; year?: number; quarter?: number; financialYear?: number }));
  await sendReport(res, 'xlsx', 'financial-report', `Financial report ${summary.from} to ${summary.to}`, financeReportTables(summary));
}));

financeRouter.get('/reports.pdf', requirePermission('finance.view'), books, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const summary = await financeSummary(reportRange(req.query as { from?: string; to?: string; year?: number; quarter?: number; financialYear?: number }));
  await sendReport(res, 'pdf', 'financial-report', `Financial report ${summary.from} to ${summary.to}`, financeReportTables(summary));
}));
