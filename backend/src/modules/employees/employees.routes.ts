import { Router } from 'express';
import { z } from 'zod';
import { requireWorkspace } from '../../services/workspaces';
import { importEmployees, importTemplate } from './employees.import';
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

const importSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(4).max(7_000_000),
  commit: z.boolean().optional().default(false),
});

/** Spreadsheet import is an HR task: it needs the right to register employees in the people workspace. */
employeesRouter.get('/import/template.xlsx', requirePermission('employees.create'), requireWorkspace('people'), asyncRoute(async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.xlsx"');
  res.send(await importTemplate());
}));

employeesRouter.post('/import', requirePermission('employees.create'), requireWorkspace('people'), validate({ body: importSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await importEmployees(req.auth!, req.body, actorFrom(req)) });
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
