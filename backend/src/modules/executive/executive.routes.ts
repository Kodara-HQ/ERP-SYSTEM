import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { actionSchema, idParamSchema, meetingSchema, resolveSchema, responseSchema, reviewSchema } from './executive.schema';
import { createAction, createMeeting, createReview, listActions, listMeetings, listReviews, resolveAction, respondAction } from './executive.service';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

export const executiveRouter = Router();
executiveRouter.use(requireAuth);

executiveRouter.get('/reviews', asyncRoute(async (req, res) => {
  res.json({ data: await listReviews(req.auth!) });
}));

executiveRouter.post('/reviews', validate({ body: reviewSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createReview(req.auth!, req.body, actor(req)) });
}));

executiveRouter.get('/actions', asyncRoute(async (req, res) => {
  res.json({ data: await listActions(req.auth!) });
}));

executiveRouter.post('/actions', validate({ body: actionSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createAction(req.auth!, req.body, actor(req)) });
}));

executiveRouter.post('/actions/:id/response', validate({ params: idParamSchema, body: responseSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await respondAction(req.auth!, Number(req.params.id), req.body.response, actor(req)) });
}));

executiveRouter.post('/actions/:id/resolve', validate({ params: idParamSchema, body: resolveSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resolveAction(req.auth!, Number(req.params.id), req.body, actor(req)) });
}));

executiveRouter.get('/meetings', asyncRoute(async (req, res) => {
  res.json({ data: await listMeetings(req.auth!) });
}));

executiveRouter.post('/meetings', validate({ body: meetingSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createMeeting(req.auth!, req.body, actor(req)) });
}));
