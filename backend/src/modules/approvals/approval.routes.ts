import { Router, type Request } from 'express';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import {
  approvalSummary,
  cancelRequest,
  createDelegation,
  createRequest,
  createWorkflow,
  decideRequest,
  getRequest,
  listDelegations,
  listRequests,
  listWorkflows,
  progressRequest,
  remindRequest,
  replaceWorkflowSteps,
  resubmitRequest,
  revokeDelegation,
  runReminders,
  submitRequest,
  updateRequest,
  updateWorkflowSettings,
  runEscalations,
  listRequestDocuments,
  attachRequestDocument,
  downloadRequestDocument,
} from './approval.service';
import {
  commentSchema,
  decisionSchema,
  delegationSchema,
  documentParamSchema,
  documentUploadSchema,
  workflowSettingsSchema,
  idParamSchema,
  requestListSchema,
  requestWriteSchema,
  stepInputSchema,
  workflowCreateSchema,
  workflowReplaceSchema,
} from './approval.schema';

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

approvalsRouter.get('/summary', requirePermission('approvals.view'), asyncRoute(async (req, res) => {
  res.json({ data: await approvalSummary(req.auth!) });
}));

approvalsRouter.get('/workflows', requirePermission('approvals.view', 'approvals.configure'), asyncRoute(async (_req, res) => {
  res.json({ data: await listWorkflows() });
}));

approvalsRouter.post('/workflows', requirePermission('approvals.configure'), validate({ body: workflowCreateSchema }), asyncRoute(async (req, res) => {
  const steps = req.body.steps.map((step: unknown) => stepInputSchema.parse(step));
  const created = await createWorkflow({ ...req.body, steps }, actor(req));
  res.status(201).json({ data: created });
}));

approvalsRouter.put('/workflows/:id', requirePermission('approvals.configure'), validate({ params: idParamSchema, body: workflowReplaceSchema }), asyncRoute(async (req, res) => {
  const steps = req.body.steps.map((step: unknown) => stepInputSchema.parse(step));
  res.json({ data: await replaceWorkflowSteps(Number(req.params.id), steps, actor(req)) });
}));

approvalsRouter.patch('/workflows/:id', requirePermission('approvals.configure'), validate({ params: idParamSchema, body: workflowSettingsSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateWorkflowSettings(Number(req.params.id), req.body, actor(req)) });
}));

approvalsRouter.post('/escalations/run', requirePermission('approvals.configure', 'governance.configure'), asyncRoute(async (req, res) => {
  res.json({ data: await runEscalations(actor(req)) });
}));

approvalsRouter.get('/requests/:id/documents', requirePermission('approvals.view'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await listRequestDocuments(req.auth!, Number(req.params.id)) });
}));

approvalsRouter.post('/requests/:id/documents', requirePermission('approvals.view'), validate({ params: idParamSchema, body: documentUploadSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await attachRequestDocument(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

approvalsRouter.get('/requests/:id/documents/:documentId', requirePermission('approvals.view'), validate({ params: documentParamSchema }), asyncRoute(async (req, res) => {
  const file = await downloadRequestDocument(req.auth!, Number(req.params.id), Number(req.params.documentId));
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.content);
}));

approvalsRouter.get('/requests', requirePermission('approvals.view'), validate({ query: requestListSchema }), asyncRoute(async (req, res) => {
  res.json(await listRequests(req.auth!, req.query as never));
}));

approvalsRouter.post('/requests', requirePermission('approvals.submit'), validate({ body: requestWriteSchema }), asyncRoute(async (req, res) => {
  const created = await createRequest(req.auth!, req.body, actor(req));
  res.status(201).json({ data: created });
}));

approvalsRouter.get('/requests/:id', requirePermission('approvals.view'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await getRequest(req.auth!, Number(req.params.id)) });
}));

approvalsRouter.patch('/requests/:id', requirePermission('approvals.submit'), validate({ params: idParamSchema, body: requestWriteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateRequest(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

approvalsRouter.post('/requests/:id/submit', requirePermission('approvals.submit'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await submitRequest(req.auth!, Number(req.params.id), actor(req)) });
}));

approvalsRouter.post('/requests/:id/resubmit', requirePermission('approvals.submit'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resubmitRequest(req.auth!, Number(req.params.id), actor(req)) });
}));

approvalsRouter.post('/requests/:id/decision', requirePermission('approvals.decide'), validate({ params: idParamSchema, body: decisionSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await decideRequest(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

approvalsRouter.post('/requests/:id/process', requirePermission('approvals.process'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await progressRequest(req.auth!, Number(req.params.id), 'process', actor(req)) });
}));

approvalsRouter.post('/requests/:id/complete', requirePermission('approvals.process'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await progressRequest(req.auth!, Number(req.params.id), 'complete', actor(req)) });
}));

approvalsRouter.post('/requests/:id/cancel', requirePermission('approvals.submit'), validate({ params: idParamSchema, body: commentSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await cancelRequest(req.auth!, Number(req.params.id), req.body.comment, actor(req)) });
}));

approvalsRouter.post('/requests/:id/remind', requirePermission('approvals.view'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await remindRequest(req.auth!, Number(req.params.id), actor(req)) });
}));

approvalsRouter.post('/reminders', requirePermission('approvals.configure'), asyncRoute(async (req, res) => {
  res.json({ data: await runReminders(actor(req)) });
}));

approvalsRouter.get('/delegations', requirePermission('approvals.view'), asyncRoute(async (req, res) => {
  res.json({ data: await listDelegations(req.auth!) });
}));

approvalsRouter.post('/delegations', requirePermission('approvals.delegate'), validate({ body: delegationSchema }), asyncRoute(async (req, res) => {
  const created = await createDelegation(req.auth!, req.body, actor(req));
  res.status(201).json({ data: created });
}));

approvalsRouter.post('/delegations/:id/revoke', requirePermission('approvals.delegate', 'approvals.configure'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await revokeDelegation(req.auth!, Number(req.params.id), actor(req)) });
}));
