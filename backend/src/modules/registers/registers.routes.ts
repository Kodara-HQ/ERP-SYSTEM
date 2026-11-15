import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate';
import { asyncRoute } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { requestMeta } from '../../services/auditService';
import { sendReport } from '../../services/reportFiles';
import { createEntry, dueAlerts, listEntries, listRegisters, registerSummary, registerTables, updateEntry } from './registers.service';

function actor(req: Request) {
  return { userId: req.auth!.userId, ...requestMeta(req) };
}

const codeParam = z.object({ code: z.string().regex(/^[a-z_]{2,40}$/) });
const entryParam = codeParam.extend({ id: z.coerce.number().int().positive() });
const listQuery = z.object({ status: z.string().max(40).optional(), search: z.string().trim().max(120).optional() });
const createBody = z.object({ status: z.string().max(40).optional(), values: z.record(z.unknown()) });
const updateBody = z.object({ status: z.string().max(40).optional(), values: z.record(z.unknown()).optional() });

export const registersRouter = Router();
registersRouter.use(requireAuth);

registersRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ data: await listRegisters(req.auth!) });
}));

registersRouter.get('/alerts', asyncRoute(async (req, res) => {
  res.json({ data: await dueAlerts(req.auth!) });
}));

registersRouter.get('/summary', asyncRoute(async (req, res) => {
  res.json({ data: await registerSummary(req.auth!) });
}));

for (const format of ['xlsx', 'pdf'] as const) {
  registersRouter.get(`/:code/export.${format}`, validate({ params: codeParam }), asyncRoute(async (req, res) => {
    const { title, tables } = await registerTables(req.auth!, String(req.params.code));
    await sendReport(res, format, String(req.params.code).replace(/_/g, '-'), title, tables);
  }));
}

registersRouter.get('/:code', validate({ params: codeParam, query: listQuery }), asyncRoute(async (req, res) => {
  res.json(await listEntries(req.auth!, String(req.params.code), req.query as never));
}));

registersRouter.post('/:code', validate({ params: codeParam, body: createBody }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createEntry(req.auth!, String(req.params.code), req.body, actor(req)) });
}));

registersRouter.patch('/:code/:id', validate({ params: entryParam, body: updateBody }), asyncRoute(async (req, res) => {
  res.json({ data: await updateEntry(req.auth!, String(req.params.code), Number(req.params.id), req.body, actor(req)) });
}));
