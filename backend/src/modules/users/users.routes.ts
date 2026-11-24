import { Router } from 'express';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { requireWorkspace } from '../../services/workspaces';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { listResetRequests } from '../auth/passwordReset.service';
import { idParamSchema, passwordResetSchema, roleAssignmentSchema, userCreateSchema, userListSchema, userRoleParamSchema, userUpdateSchema } from './users.schema';
import { assignRole, createUser, listDirectory, listUserRoles, listUsers, removeRole, resetUserPassword, updateUser } from './users.service';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireWorkspace('administration'));

usersRouter.get('/', requirePermission('users.view'), validate({ query: userListSchema }), asyncRoute(async (req, res) => {
  res.json(await listUsers(req.query as never));
}));

usersRouter.post('/', requirePermission('users.manage'), validate({ body: userCreateSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createUser(req.auth!, req.body, { userId: req.auth!.userId, ...requestMeta(req) }) });
}));

usersRouter.patch('/:id', requirePermission('users.manage'), validate({ params: idParamSchema, body: userUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateUser(req.auth!, Number(req.params.id), req.body, { userId: req.auth!.userId, ...requestMeta(req) }) });
}));

usersRouter.get('/password-requests', requirePermission('users.manage'), asyncRoute(async (_req, res) => {
  res.json({ data: await listResetRequests() });
}));

usersRouter.post('/:id/reset-password', requirePermission('users.manage'), validate({ params: idParamSchema, body: passwordResetSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await resetUserPassword(req.auth!, Number(req.params.id), req.body.temporaryPassword, { userId: req.auth!.userId, ...requestMeta(req) }) });
}));

usersRouter.get('/:id/roles', requirePermission('users.view', 'users.manage'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await listUserRoles(Number(req.params.id)) });
}));

usersRouter.post('/:id/roles', requirePermission('users.manage'), validate({ params: idParamSchema, body: roleAssignmentSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({
    data: await assignRole(req.auth!, Number(req.params.id), req.body, { userId: req.auth!.userId, ...requestMeta(req) }),
  });
}));

usersRouter.delete('/:id/roles/:userRoleId', requirePermission('users.manage'), validate({ params: userRoleParamSchema }), asyncRoute(async (req, res) => {
  res.json({
    data: await removeRole(req.auth!, Number(req.params.id), Number(req.params.userRoleId), {
      userId: req.auth!.userId,
      ...requestMeta(req),
    }),
  });
}));

/** Active people to pick from, for screens that assign work or delegate approvals. No account details. */
export const directoryRouter = Router();
directoryRouter.use(requireAuth);
directoryRouter.get('/users', requirePermission('approvals.delegate', 'executive.review', 'users.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await listDirectory() });
}));
