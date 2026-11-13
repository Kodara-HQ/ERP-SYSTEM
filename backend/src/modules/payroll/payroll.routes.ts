import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { sendReport } from '../../services/reportFiles';
import {
  completePayroll,
  correctPayroll,
  createPayroll,
  decidePayroll,
  failSalary,
  forwardPayroll,
  getEmployeeSalary,
  getPayroll,
  listCompensation,
  listPayroll,
  paySalaries,
  payrollReport,
  payrollReportTables,
  releasePayroll,
  resendSalarySms,
  resubmitPayroll,
  returnPayroll,
  reviewPayroll,
  saveCompensation,
  submitPayroll,
  updatePayrollLines,
} from './payroll.service';
import {
  compensationSchema,
  idParamSchema,
  payrollCreateSchema,
  payrollLinesSchema,
  payrollDecisionSchema,
  payrollNoteSchema,
  salaryFailSchema,
  salaryPaySchema,
} from './payroll.schema';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

payrollRouter.get('/compensation', asyncRoute(async (req, res) => {
  res.json({ data: await listCompensation(req.auth!) });
}));

payrollRouter.post('/compensation', validate({ body: compensationSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await saveCompensation(req.auth!, req.body, actor(req)) });
}));

payrollRouter.get('/compensation/:id', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await getEmployeeSalary(req.auth!, Number(req.params.id)) });
}));

payrollRouter.get('/reports.xlsx', asyncRoute(async (req, res) => {
  const rows = await payrollReport(req.auth!);
  await sendReport(res, 'xlsx', 'salary-payments', 'Salary payments', payrollReportTables(rows));
}));

payrollRouter.get('/reports.pdf', asyncRoute(async (req, res) => {
  const rows = await payrollReport(req.auth!);
  await sendReport(res, 'pdf', 'salary-payments', 'Salary payments', payrollReportTables(rows));
}));

payrollRouter.get('/reports.csv', asyncRoute(async (req, res) => {
  const rows = await payrollReport(req.auth!);
  const lines = ['payroll,period,status,total,payment,payment_status,amount,date,employee'];
  for (const row of rows) {
    lines.push([row.payroll, row.period, row.status, row.totalNet, row.payment, row.paymentStatus, row.amount, row.paymentDate, row.employeeNumber].join(','));
  }
  res.type('text/csv').send(`${lines.join('\n')}\n`);
}));

payrollRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ data: await listPayroll(req.auth!) });
}));

payrollRouter.post('/', validate({ body: payrollCreateSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createPayroll(req.auth!, req.body, actor(req)) });
}));

payrollRouter.get('/:id', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await getPayroll(req.auth!, Number(req.params.id)) });
}));

payrollRouter.patch('/:id/lines', validate({ params: idParamSchema, body: payrollLinesSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updatePayrollLines(req.auth!, Number(req.params.id), req.body.lines, actor(req)) });
}));

payrollRouter.post('/:id/submit', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await submitPayroll(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/resubmit', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resubmitPayroll(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/review', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await reviewPayroll(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/forward', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await forwardPayroll(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/return', validate({ params: idParamSchema, body: payrollNoteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await returnPayroll(req.auth!, Number(req.params.id), req.body.comment, actor(req)) });
}));

payrollRouter.post('/:id/decision', validate({ params: idParamSchema, body: payrollDecisionSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await decidePayroll(req.auth!, Number(req.params.id), req.body.action, req.body.comment ?? '', actor(req)) });
}));

payrollRouter.post('/:id/release', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await releasePayroll(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/payments', validate({ params: idParamSchema, body: salaryPaySchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await paySalaries(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

payrollRouter.post('/:id/failures', validate({ params: idParamSchema, body: salaryFailSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await failSalary(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

payrollRouter.post('/:id/sms/resend', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resendSalarySms(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/complete', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await completePayroll(req.auth!, Number(req.params.id), actor(req)) });
}));

payrollRouter.post('/:id/correction', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await correctPayroll(req.auth!, Number(req.params.id), actor(req)) });
}));
