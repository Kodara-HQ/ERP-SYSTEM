import { Router, type Request } from 'express';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { requireWorkspace } from '../../services/workspaces';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { sendReport } from '../../services/reportFiles';
import { todayIso } from '../../utils/pagination';
import {
  addApplicant,
  addAppraisal,
  addContract,
  addDiscipline,
  addOnboardingTask,
  addTraining,
  applyLeave,
  checkInSelf,
  clearExit,
  completeOnboardingTask,
  createVacancy,
  employeeLifecycle,
  getDiscipline,
  hireApplicant,
  hrReportTables,
  hrSummary,
  leaveBalances,
  listApplicants,
  listAttendance,
  listLeave,
  listLeaveTypes,
  listVacancies,
  promoteEmployee,
  recordAttendance,
  recordExit,
  resubmitLeave,
  summaryToCsv,
} from './hr.service';
import {
  applicantWriteSchema,
  appraisalSchema,
  attendanceListSchema,
  attendanceWriteSchema,
  contractSchema,
  disciplineSchema,
  employeeParamSchema,
  exitSchema,
  hireSchema,
  idParamSchema,
  leaveListSchema,
  leaveWriteSchema,
  onboardingSchema,
  promotionSchema,
  reportQuerySchema,
  trainingSchema,
  vacancyWriteSchema,
} from './hr.schema';

export const hrRouter = Router();
hrRouter.use(requireAuth);
const hrDesk = requireWorkspace('hr');

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

function reportRange(query: { from?: string; to?: string }) {
  const today = todayIso();
  return {
    from: query.from ?? `${today.slice(0, 4)}-01-01`,
    to: query.to ?? today,
  };
}

hrRouter.get('/leave-types', requirePermission('leave.apply', 'hr.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await listLeaveTypes() });
}));

hrRouter.get('/leave', requirePermission('leave.apply', 'hr.view'), validate({ query: leaveListSchema }), asyncRoute(async (req, res) => {
  const query = req.query as unknown as { employeeId?: number };
  res.json({ data: await listLeave(req.auth!, query.employeeId) });
}));

hrRouter.get('/leave/balances', requirePermission('leave.apply', 'hr.view'), validate({ query: leaveListSchema }), asyncRoute(async (req, res) => {
  const query = req.query as unknown as { employeeId?: number };
  res.json({ data: await leaveBalances(req.auth!, query.employeeId) });
}));

hrRouter.post('/leave', requirePermission('leave.apply', 'hr.manage'), validate({ body: leaveWriteSchema }), asyncRoute(async (req, res) => {
  const created = await applyLeave(req.auth!, req.body, actor(req));
  res.status(201).json({ data: created });
}));

hrRouter.post('/leave/:id/resubmit', requirePermission('leave.apply', 'hr.manage'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resubmitLeave(req.auth!, Number(req.params.id), actor(req)) });
}));

hrRouter.get('/attendance', requirePermission('attendance.self', 'hr.view'), validate({ query: attendanceListSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await listAttendance(req.auth!, req.query as never) });
}));

hrRouter.post('/attendance/check-in', requirePermission('attendance.self'), asyncRoute(async (req, res) => {
  res.json({ data: await checkInSelf(req.auth!, actor(req)) });
}));

hrRouter.post('/attendance', requirePermission('attendance.self', 'hr.manage'), validate({ body: attendanceWriteSchema }), asyncRoute(async (req, res) => {
  const saved = await recordAttendance(req.auth!, req.body, actor(req));
  res.status(201).json({ data: saved });
}));

hrRouter.get('/vacancies', requirePermission('hr.view'), hrDesk, asyncRoute(async (req, res) => {
  res.json({ data: await listVacancies(req.auth!) });
}));

hrRouter.post('/vacancies', requirePermission('hr.manage'), hrDesk, validate({ body: vacancyWriteSchema }), asyncRoute(async (req, res) => {
  const created = await createVacancy(req.auth!, req.body, actor(req));
  res.status(201).json({ data: created });
}));

hrRouter.get('/vacancies/:id/applicants', requirePermission('hr.manage'), hrDesk, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await listApplicants(Number(req.params.id)) });
}));

hrRouter.post('/vacancies/:id/applicants', requirePermission('hr.manage'), hrDesk, validate({ params: idParamSchema, body: applicantWriteSchema }), asyncRoute(async (req, res) => {
  const email = req.body.email ? String(req.body.email) : null;
  const created = await addApplicant({ ...req.body, vacancyId: Number(req.params.id), email });
  res.status(201).json({ data: created });
}));

hrRouter.post('/applicants/:id/hire', requirePermission('hr.manage'), hrDesk, validate({ params: idParamSchema, body: hireSchema }), asyncRoute(async (req, res) => {
  const hired = await hireApplicant(req.auth!, Number(req.params.id), req.body.startDate, actor(req));
  res.status(201).json({ data: hired });
}));

hrRouter.post('/promotions', requirePermission('hr.manage'), hrDesk, validate({ body: promotionSchema }), asyncRoute(async (req, res) => {
  const created = await promoteEmployee(req.auth!, req.body, actor(req));
  res.status(201).json({ data: created });
}));

hrRouter.post('/exits', requirePermission('hr.manage'), hrDesk, validate({ body: exitSchema }), asyncRoute(async (req, res) => {
  const recorded = await recordExit(req.auth!, req.body, actor(req));
  res.status(201).json({ data: recorded });
}));

hrRouter.post('/exits/:employeeId/clear', requirePermission('hr.manage'), hrDesk, validate({ params: employeeParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await clearExit(Number(req.params.employeeId), actor(req)) });
}));

hrRouter.post('/contracts', requirePermission('hr.manage'), hrDesk, validate({ body: contractSchema }), asyncRoute(async (req, res) => {
  const created = await addContract(req.auth!, req.body);
  res.status(201).json({ data: created });
}));

hrRouter.post('/disciplinary', requirePermission('hr.view_confidential'), hrDesk, validate({ body: disciplineSchema }), asyncRoute(async (req, res) => {
  const created = await addDiscipline(req.auth!, req.body);
  res.status(201).json({ data: created });
}));

hrRouter.get('/disciplinary/:id', hrDesk, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await getDiscipline(req.auth!, Number(req.params.id)) });
}));

hrRouter.post('/appraisals', requirePermission('hr.view_confidential'), hrDesk, validate({ body: appraisalSchema }), asyncRoute(async (req, res) => {
  const created = await addAppraisal(req.auth!, req.body);
  res.status(201).json({ data: created });
}));

hrRouter.post('/training', requirePermission('hr.manage'), hrDesk, validate({ body: trainingSchema }), asyncRoute(async (req, res) => {
  const created = await addTraining(req.auth!, req.body);
  res.status(201).json({ data: created });
}));

hrRouter.post('/onboarding', requirePermission('hr.manage'), hrDesk, validate({ body: onboardingSchema }), asyncRoute(async (req, res) => {
  const created = await addOnboardingTask(req.auth!, req.body);
  res.status(201).json({ data: created });
}));

hrRouter.post('/onboarding/:id/complete', requirePermission('hr.manage'), hrDesk, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await completeOnboardingTask(Number(req.params.id)) });
}));

hrRouter.get('/employees/:employeeId/lifecycle', requirePermission('hr.view', 'leave.apply'), validate({ params: employeeParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await employeeLifecycle(req.auth!, Number(req.params.employeeId)) });
}));

hrRouter.get('/reports.csv', requirePermission('hr.view'), hrDesk, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const range = reportRange(req.query as { from?: string; to?: string });
  const summary = await hrSummary(req.auth!, range.from, range.to);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hr-report.csv"');
  res.send(summaryToCsv(summary));
}));

hrRouter.get('/reports.xlsx', requirePermission('hr.view'), hrDesk, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const range = reportRange(req.query as { from?: string; to?: string });
  const summary = await hrSummary(req.auth!, range.from, range.to);
  await sendReport(res, 'xlsx', 'hr-report', `HR report ${range.from} to ${range.to}`, hrReportTables(summary));
}));

hrRouter.get('/reports.pdf', requirePermission('hr.view'), hrDesk, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const range = reportRange(req.query as { from?: string; to?: string });
  const summary = await hrSummary(req.auth!, range.from, range.to);
  await sendReport(res, 'pdf', 'hr-report', `HR report ${range.from} to ${range.to}`, hrReportTables(summary));
}));

hrRouter.get('/reports', requirePermission('hr.view'), hrDesk, validate({ query: reportQuerySchema }), asyncRoute(async (req, res) => {
  const range = reportRange(req.query as { from?: string; to?: string });
  res.json({ data: { ...await hrSummary(req.auth!, range.from, range.to), from: range.from, to: range.to } });
}));
