import { Router } from 'express';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { requireWorkspace } from '../../services/workspaces';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { hasPermission } from '../../services/access';
import { HttpError } from '../../utils/httpError';
import { idParamSchema, permissionUpdateSchema, roleCreateSchema, roleUpdateSchema } from './roles.schema';
import { createRole, listPermissions, listRoles, loadRole, replacePermissions, updateRole } from './roles.service';

export const rolesRouter = Router();
rolesRouter.use(requireAuth, requireWorkspace('administration'));

rolesRouter.get('/permissions', requirePermission('roles.view', 'roles.manage', 'permissions.manage_protected'), asyncRoute(async (_req, res) => {
  res.json({ data: await listPermissions() });
}));

rolesRouter.get('/', requirePermission('roles.view', 'roles.manage', 'permissions.manage_protected'), asyncRoute(async (_req, res) => {
  res.json({ data: await listRoles() });
}));

rolesRouter.get('/:id', requirePermission('roles.view', 'roles.manage', 'permissions.manage_protected'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await loadRole(Number(req.params.id)) });
}));

rolesRouter.post('/', requirePermission('roles.manage'), validate({ body: roleCreateSchema }), asyncRoute(async (req, res) => {
  const actor = { userId: req.auth!.userId, ...requestMeta(req) };
  res.status(201).json({ data: await createRole(req.body, req.auth!, actor) });
}));

rolesRouter.patch('/:id', requirePermission('roles.manage'), validate({ params: idParamSchema, body: roleUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateRole(Number(req.params.id), req.body, { userId: req.auth!.userId, ...requestMeta(req) }) });
}));

rolesRouter.put('/:id/permissions', validate({ params: idParamSchema, body: permissionUpdateSchema }), asyncRoute(async (req, res) => {
  const allowed = hasPermission(req.auth!, 'roles.manage') || hasPermission(req.auth!, 'permissions.manage_protected');
  if (!allowed) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  res.json({
    data: await replacePermissions(Number(req.params.id), req.body.permissions, req.auth!, {
      userId: req.auth!.userId,
      ...requestMeta(req),
    }),
  });
}));
