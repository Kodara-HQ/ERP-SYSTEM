import { Router } from 'express';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  actorFrom,
  addAssignment,
  addReportingLine,
  createEmployee,
  endReportingLine,
  getEmployee,
  getOwnEmployee,
  listEmployees,
  transferEmployee,
  updateEmployee,
} from './employees.service';
import {
  assignmentSchema,
  employeeCreateSchema,
  employeeListSchema,
  employeeUpdateSchema,
  endDateSchema,
  idParamSchema,
  relationshipParamSchema,
  reportingSchema,
  transferSchema,
} from './employees.schema';

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

employeesRouter.get('/me', asyncRoute(async (req, res) => {
  res.json({ data: await getOwnEmployee(req.auth!) });
}));

employeesRouter.get('/', requirePermission('employees.view'), validate({ query: employeeListSchema }), asyncRoute(async (req, res) => {
  res.json(await listEmployees(req.auth!, req.query as never));
}));

employeesRouter.post('/', requirePermission('employees.create'), validate({ body: employeeCreateSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createEmployee(req.auth!, req.body, actorFrom(req)) });
}));

employeesRouter.get('/:id', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await getEmployee(req.auth!, Number(req.params.id)) });
}));

employeesRouter.patch('/:id', requirePermission('employees.edit'), validate({ params: idParamSchema, body: employeeUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateEmployee(req.auth!, Number(req.params.id), req.body, actorFrom(req)) });
}));

employeesRouter.post('/:id/transfers', requirePermission('employees.edit'), validate({ params: idParamSchema, body: transferSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await transferEmployee(req.auth!, Number(req.params.id), req.body, actorFrom(req)) });
}));

employeesRouter.post('/:id/assignments', requirePermission('employees.edit'), validate({ params: idParamSchema, body: assignmentSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await addAssignment(req.auth!, Number(req.params.id), req.body, actorFrom(req)) });
}));

employeesRouter.post('/:id/reporting-lines', requirePermission('employees.edit'), validate({ params: idParamSchema, body: reportingSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await addReportingLine(req.auth!, Number(req.params.id), req.body, actorFrom(req)) });
}));

employeesRouter.post(
  '/:id/reporting-lines/:relationshipId/end',
  requirePermission('employees.edit'),
  validate({ params: relationshipParamSchema, body: endDateSchema }),
  asyncRoute(async (req, res) => {
    res.json({
      data: await endReportingLine(req.auth!, Number(req.params.id), Number(req.params.relationshipId), req.body.endDate, actorFrom(req)),
    });
  }),
);
