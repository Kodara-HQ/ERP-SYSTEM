import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { hasFinalBusinessAuthority, hasPermission } from '../../services/access';
import {
  createAuthorityLimit,
  getSettings,
  listAuthorityLimits,
  listSegregationRules,
  organisationChart,
  setSegregationRule,
  updateAuthorityLimit,
  updateSettings,
} from './governance.service';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

const amount = z.number().nonnegative().max(999999999999.99);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const limitCreate = z.object({
  roleCode: z.string().trim().min(2).max(60),
  workflowId: z.number().int().positive().nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  maxAmount: amount.nullable(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const limitUpdate = z.object({
  maxAmount: amount.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
const ruleUpdate = z.object({ enabled: z.boolean(), reason: z.string().trim().min(8).max(500) });
const settingsUpdate = z.object({
  executiveThreshold: amount.nullable().optional(),
  escalationHours: z.number().int().min(0).max(2160).optional(),
  escalationRoleCode: z.string().trim().min(2).max(60).optional(),
});

export const governanceRouter = Router();
governanceRouter.use(requireAuth);

const viewer = requirePermission('governance.view', 'governance.configure');
const configurer = requirePermission('governance.configure');

governanceRouter.get('/segregation-rules', viewer, asyncRoute(async (_req, res) => {
  res.json({ data: await listSegregationRules() });
}));

governanceRouter.put('/segregation-rules/:code', configurer, validate({ body: ruleUpdate }), asyncRoute(async (req, res) => {
  res.json({ data: await setSegregationRule(String(req.params.code), req.body.enabled, req.body.reason, actor(req)) });
}));

governanceRouter.get('/authority-limits', viewer, asyncRoute(async (_req, res) => {
  res.json({ data: await listAuthorityLimits() });
}));

governanceRouter.post('/authority-limits', configurer, validate({ body: limitCreate }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createAuthorityLimit(req.body, actor(req)) });
}));

governanceRouter.patch('/authority-limits/:id', configurer, validate({ params: idParam, body: limitUpdate }), asyncRoute(async (req, res) => {
  res.json({ data: await updateAuthorityLimit(Number(req.params.id), req.body, actor(req)) });
}));

governanceRouter.get('/settings', viewer, asyncRoute(async (_req, res) => {
  res.json({ data: await getSettings() });
}));

governanceRouter.put('/settings', configurer, validate({ body: settingsUpdate }), asyncRoute(async (req, res) => {
  res.json({ data: await updateSettings(req.body, actor(req)) });
}));

/** Every signed-in employee may see the structure. Names of position holders are shown to HR, the CEO, and administrators. */
governanceRouter.get('/organisation-chart', requirePermission('positions.view', 'departments.view'), asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const showNames = hasFinalBusinessAuthority(auth) || hasPermission(auth, 'employees.view');
  res.json({ data: await organisationChart(showNames) });
}));
