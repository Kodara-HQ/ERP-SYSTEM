import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { activitySchema, idParamSchema, issueSchema, issueUpdateSchema, taskSchema, taskStatusSchema } from './operations.schema';
import { createActivity, createIssue, createTask, listActivities, listIssues, listTasks, operationsOverview, setTaskStatus, updateIssue } from './operations.service';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

export const operationsRouter = Router();
operationsRouter.use(requireAuth);

operationsRouter.get('/overview', asyncRoute(async (req, res) => {
  res.json({ data: await operationsOverview(req.auth!) });
}));

operationsRouter.get('/activities', asyncRoute(async (req, res) => {
  res.json({ data: await listActivities(req.auth!) });
}));

operationsRouter.post('/activities', validate({ body: activitySchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createActivity(req.auth!, req.body, actor(req)) });
}));

operationsRouter.get('/tasks', asyncRoute(async (req, res) => {
  res.json({ data: await listTasks(req.auth!) });
}));

operationsRouter.post('/tasks', validate({ body: taskSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createTask(req.auth!, req.body, actor(req)) });
}));

operationsRouter.patch('/tasks/:id', validate({ params: idParamSchema, body: taskStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await setTaskStatus(req.auth!, Number(req.params.id), req.body.status, actor(req)) });
}));

operationsRouter.get('/issues', asyncRoute(async (req, res) => {
  res.json({ data: await listIssues(req.auth!) });
}));

operationsRouter.post('/issues', validate({ body: issueSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createIssue(req.auth!, req.body, actor(req)) });
}));

operationsRouter.patch('/issues/:id', validate({ params: idParamSchema, body: issueUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateIssue(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));
