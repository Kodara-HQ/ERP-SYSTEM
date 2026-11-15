import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { hasPermission } from '../../services/access';
import { sendReport } from '../../services/reportFiles';
import {
  assessableEmployees,
  companyDashboard,
  createAnnouncement,
  createAssessment,
  createReport,
  createTarget,
  departmentPerformance,
  getReport,
  listAnnouncements,
  listAssessments,
  listReports,
  listTargets,
  reportTables,
  reviewReport,
  submitReport,
  updateReport,
  updateTarget,
  withdrawAnnouncement,
} from './management.service';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const periodType = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'annual']);
const reportBody = z.object({
  periodType,
  periodStart: date,
  periodEnd: date,
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(10).max(4000),
  achievements: z.string().trim().max(4000).nullable().optional(),
  challenges: z.string().trim().max(4000).nullable().optional(),
  nextSteps: z.string().trim().max(4000).nullable().optional(),
  submit: z.boolean().optional(),
});
const reportFilters = z.object({
  periodType: periodType.optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  status: z.enum(['draft', 'submitted', 'reviewed', 'returned']).optional(),
});
const reviewBody = z.object({ action: z.enum(['reviewed', 'returned']), comment: z.string().trim().max(1000).optional() });
const targetBody = z.object({
  departmentId: z.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  metric: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(40),
  targetValue: z.number().positive().max(999999999999),
  actualValue: z.number().nonnegative().max(999999999999).optional(),
  periodStart: date,
  periodEnd: date,
});
const targetUpdate = z.object({
  actualValue: z.number().nonnegative().max(999999999999).optional(),
  targetValue: z.number().positive().max(999999999999).optional(),
  status: z.enum(['active', 'achieved', 'missed', 'cancelled']).optional(),
});
const targetFilters = z.object({ departmentId: z.coerce.number().int().positive().optional(), status: z.string().max(20).optional() });
const assessmentBody = z.object({
  employeeId: z.number().int().positive(),
  periodStart: date,
  periodEnd: date,
  rating: z.number().int().min(1).max(5),
  strengths: z.string().trim().max(2000).nullable().optional(),
  improvements: z.string().trim().max(2000).nullable().optional(),
  comments: z.string().trim().max(2000).nullable().optional(),
  share: z.boolean().optional(),
});
const announcementBody = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(4000),
  expiresOn: date.nullable().optional(),
});

export const managementRouter = Router();
managementRouter.use(requireAuth);

managementRouter.get('/company-dashboard', requirePermission('dashboard.view'), asyncRoute(async (req, res) => {
  res.json({ data: await companyDashboard(req.auth!) });
}));

managementRouter.get('/performance', requirePermission('reports.review', 'executive.review'), asyncRoute(async (req, res) => {
  res.json({ data: await departmentPerformance(req.auth!) });
}));

managementRouter.get('/reports', requirePermission('reports.submit', 'reports.review'), validate({ query: reportFilters }), asyncRoute(async (req, res) => {
  res.json({ data: await listReports(req.auth!, req.query as never) });
}));

for (const format of ['xlsx', 'pdf'] as const) {
  managementRouter.get(`/reports.${format}`, requirePermission('reports.submit', 'reports.review'), validate({ query: reportFilters }), asyncRoute(async (req, res) => {
    const rows = await listReports(req.auth!, req.query as never);
    await sendReport(res, format, 'departmental-reports', 'Departmental reports', reportTables(rows));
  }));
}

managementRouter.post('/reports', requirePermission('reports.submit'), validate({ body: reportBody }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createReport(req.auth!, req.body, actor(req)) });
}));

managementRouter.get('/reports/:id', requirePermission('reports.submit', 'reports.review'), validate({ params: idParam }), asyncRoute(async (req, res) => {
  res.json({ data: await getReport(req.auth!, Number(req.params.id)) });
}));

managementRouter.put('/reports/:id', requirePermission('reports.submit'), validate({ params: idParam, body: reportBody }), asyncRoute(async (req, res) => {
  res.json({ data: await updateReport(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

managementRouter.post('/reports/:id/submit', requirePermission('reports.submit'), validate({ params: idParam }), asyncRoute(async (req, res) => {
  res.json({ data: await submitReport(req.auth!, Number(req.params.id), actor(req)) });
}));

managementRouter.post('/reports/:id/review', requirePermission('reports.review'), validate({ params: idParam, body: reviewBody }), asyncRoute(async (req, res) => {
  res.json({ data: await reviewReport(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

managementRouter.get('/targets', requirePermission('reports.submit', 'targets.manage'), validate({ query: targetFilters }), asyncRoute(async (req, res) => {
  res.json({ data: await listTargets(req.auth!, req.query as never) });
}));

managementRouter.post('/targets', requirePermission('targets.manage'), validate({ body: targetBody }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createTarget(req.auth!, req.body, actor(req)) });
}));

managementRouter.patch('/targets/:id', requirePermission('targets.manage'), validate({ params: idParam, body: targetUpdate }), asyncRoute(async (req, res) => {
  res.json({ data: await updateTarget(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

managementRouter.get('/assessments', requirePermission('profile.view'), validate({ query: z.object({ employeeId: z.coerce.number().int().positive().optional() }) }), asyncRoute(async (req, res) => {
  res.json({ data: await listAssessments(req.auth!, (req.query as { employeeId?: number }).employeeId) });
}));

managementRouter.get('/assessments/employees', requirePermission('assessments.manage'), asyncRoute(async (req, res) => {
  res.json({ data: await assessableEmployees(req.auth!) });
}));

managementRouter.post('/assessments', requirePermission('assessments.manage'), validate({ body: assessmentBody }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createAssessment(req.auth!, req.body, actor(req)) });
}));

managementRouter.get('/announcements', requirePermission('dashboard.view'), asyncRoute(async (req, res) => {
  res.json({ data: await listAnnouncements(hasPermission(req.auth!, 'announcements.manage')) });
}));

managementRouter.post('/announcements', requirePermission('announcements.manage'), validate({ body: announcementBody }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createAnnouncement(req.auth!, req.body, actor(req)) });
}));

managementRouter.post('/announcements/:id/withdraw', requirePermission('announcements.manage'), validate({ params: idParam }), asyncRoute(async (req, res) => {
  res.json({ data: await withdrawAnnouncement(Number(req.params.id), actor(req)) });
}));
