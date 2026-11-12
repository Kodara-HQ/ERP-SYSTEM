import { Router } from 'express';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { hasPermission } from '../../services/access';
import {
  branchSchema,
  branchUpdateSchema,
  changeListQuerySchema,
  changeRequestSchema,
  departmentSchema,
  departmentUpdateSchema,
  idParamSchema,
  listQuerySchema,
  locationSchema,
  locationUpdateSchema,
  positionSchema,
  positionUpdateSchema,
  reviewSchema,
} from './organisation.schema';
import {
  actorFrom,
  createBranch,
  createChangeRequest,
  createDepartment,
  createLocation,
  createPosition,
  implementChangeRequest,
  listBranches,
  listChangeRequests,
  listDepartments,
  listLocations,
  listPositions,
  rejectChangeRequest,
  updateBranch,
  updateDepartment,
  updateLocation,
  updatePosition,
} from './organisation.service';

export const organisationRouter = Router();
organisationRouter.use(requireAuth);

organisationRouter.get('/branches', requirePermission('branches.view'), validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json(await listBranches(req.auth!, req.query as never));
}));

organisationRouter.post('/branches', requirePermission('branches.manage'), validate({ body: branchSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createBranch(req.body, actorFrom(req)) });
}));

organisationRouter.patch('/branches/:id', requirePermission('branches.manage'), validate({ params: idParamSchema, body: branchUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateBranch(Number(req.params.id), req.body, actorFrom(req)) });
}));

organisationRouter.get('/locations', requirePermission('locations.view'), validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json(await listLocations(req.auth!, req.query as never));
}));

organisationRouter.post('/locations', requirePermission('locations.manage'), validate({ body: locationSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createLocation(req.body, actorFrom(req)) });
}));

organisationRouter.patch('/locations/:id', requirePermission('locations.manage'), validate({ params: idParamSchema, body: locationUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateLocation(Number(req.params.id), req.body, actorFrom(req)) });
}));

organisationRouter.get('/departments', requirePermission('departments.view'), validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json(await listDepartments(req.auth!, req.query as never));
}));

organisationRouter.post('/departments', requirePermission('departments.manage'), validate({ body: departmentSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createDepartment(req.body, actorFrom(req)) });
}));

organisationRouter.patch('/departments/:id', requirePermission('departments.manage'), validate({ params: idParamSchema, body: departmentUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateDepartment(Number(req.params.id), req.body, actorFrom(req)) });
}));

organisationRouter.get('/positions', requirePermission('positions.view'), validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json(await listPositions(req.auth!, req.query as never));
}));

organisationRouter.post('/positions', requirePermission('positions.manage'), validate({ body: positionSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createPosition(req.body, actorFrom(req)) });
}));

organisationRouter.patch('/positions/:id', requirePermission('positions.manage'), validate({ params: idParamSchema, body: positionUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updatePosition(Number(req.params.id), req.body, actorFrom(req)) });
}));

organisationRouter.get('/change-requests', asyncRoute(async (req, res) => {
  const canImplement = hasPermission(req.auth!, 'organisation.implement_change');
  const canRequest = hasPermission(req.auth!, 'organisation.request_change');
  if (!canImplement && !canRequest) {
    res.status(403).json({ error: { message: 'You do not have permission to perform this action.', code: 'FORBIDDEN' } });
    return;
  }
  const parsed = changeListQuerySchema.parse(req.query);
  res.json(await listChangeRequests(parsed, { userId: req.auth!.userId, canImplement }));
}));

organisationRouter.post('/change-requests', requirePermission('organisation.request_change'), validate({ body: changeRequestSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createChangeRequest(req.body, actorFrom(req)) });
}));

organisationRouter.post('/change-requests/:id/implement', requirePermission('organisation.implement_change'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await implementChangeRequest(Number(req.params.id), actorFrom(req)) });
}));

organisationRouter.post('/change-requests/:id/reject', requirePermission('organisation.implement_change'), validate({ params: idParamSchema, body: reviewSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await rejectChangeRequest(Number(req.params.id), req.body.comment, actorFrom(req)) });
}));
