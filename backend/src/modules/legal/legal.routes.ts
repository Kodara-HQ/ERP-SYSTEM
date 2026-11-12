import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import {
  addObligation,
  createDocument,
  createRisk,
  executeDocument,
  expiringDocuments,
  getDocument,
  listDocuments,
  listRisks,
  reviewDocument,
  setObligationStatus,
  setRiskStatus,
  submitDocument,
} from './legal.service';
import { documentSchema, idParamSchema, legalDecisionSchema, obligationSchema, obligationStatusSchema, riskSchema, riskStatusSchema } from './legal.schema';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

export const legalRouter = Router();
legalRouter.use(requireAuth);

legalRouter.get('/expiring', asyncRoute(async (req, res) => {
  res.json({ data: await expiringDocuments(req.auth!) });
}));

legalRouter.get('/risks', asyncRoute(async (req, res) => {
  res.json({ data: await listRisks(req.auth!) });
}));

legalRouter.post('/risks', validate({ body: riskSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createRisk(req.auth!, req.body, actor(req)) });
}));

legalRouter.patch('/risks/:id', validate({ params: idParamSchema, body: riskStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await setRiskStatus(req.auth!, Number(req.params.id), req.body.status, actor(req)) });
}));

legalRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ data: await listDocuments(req.auth!) });
}));

legalRouter.post('/', validate({ body: documentSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createDocument(req.auth!, req.body, actor(req)) });
}));

legalRouter.get('/:id', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await getDocument(req.auth!, Number(req.params.id)) });
}));

legalRouter.post('/:id/submit', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await submitDocument(req.auth!, Number(req.params.id), actor(req)) });
}));

legalRouter.post('/:id/review', validate({ params: idParamSchema, body: legalDecisionSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await reviewDocument(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

legalRouter.post('/:id/execute', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await executeDocument(req.auth!, Number(req.params.id), actor(req)) });
}));

legalRouter.post('/:id/obligations', validate({ params: idParamSchema, body: obligationSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await addObligation(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

legalRouter.patch('/obligations/:id', validate({ params: idParamSchema, body: obligationStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await setObligationStatus(req.auth!, Number(req.params.id), req.body.status, actor(req)) });
}));
