import { Router } from 'express';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { companyUpdateSchema } from '../organisation/organisation.schema';
import { getCompany, updateCompany } from './company.service';

export const companyRouter = Router();

companyRouter.get('/', requireAuth, requirePermission('company.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await getCompany() });
}));

companyRouter.put('/', requireAuth, requirePermission('company.edit'), validate({ body: companyUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateCompany(req.body, { userId: req.auth!.userId, ...requestMeta(req) }) });
}));
