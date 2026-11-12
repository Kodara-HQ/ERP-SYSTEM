import { Router } from 'express';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { requireWorkspace } from '../../services/workspaces';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { idParamSchema, roleAssignmentSchema, userCreateSchema, userListSchema, userRoleParamSchema, userUpdateSchema } from './users.schema';
import { assignRole, createUser, listUserRoles, listUsers, removeRole, updateUser } from './users.service';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireWorkspace('administration'));

usersRouter.get('/', requirePermission('users.view'), validate({ query: userListSchema }), asyncRoute(async (req, res) => {
  res.json(await listUsers(req.query as never));
}));

usersRouter.post('/', requirePermission('users.manage'), validate({ body: userCreateSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createUser(req.body, { userId: req.auth!.userId, ...requestMeta(req) }) });
}));

usersRouter.patch('/:id', requirePermission('users.manage'), validate({ params: idParamSchema, body: userUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateUser(req.auth!, Number(req.params.id), req.body, { userId: req.auth!.userId, ...requestMeta(req) }) });
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
