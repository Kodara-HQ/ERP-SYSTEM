import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { sendReport } from '../../services/reportFiles';
import { todayIso } from '../../utils/pagination';
import { availableReports, buildReport, reportCsv } from './reports.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form.');
const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const typeParam = z.object({ type: z.string().regex(/^[a-z]+$/), format: z.enum(['csv', 'xlsx', 'pdf']).optional() });

function rangeFrom(query: { from?: string; to?: string }) {
  const today = todayIso();
  return { from: query.from ?? `${today.slice(0, 8)}01`, to: query.to ?? today };
}

/** The CEO's company-wide reports. Each report also needs the permission for its own area. */
export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission('executive.review'));

reportsRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ data: availableReports(req.auth!) });
}));

reportsRouter.get('/:type.:format', validate({ params: typeParam, query: rangeQuery }), asyncRoute(async (req, res) => {
  const report = await buildReport(req.auth!, req.params.type, rangeFrom(req.query as { from?: string; to?: string }));
  const filename = `${report.code}-report-${report.from}-to-${report.to}`;
  if (req.params.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(reportCsv(report));
    return;
  }
  await sendReport(res, req.params.format as 'xlsx' | 'pdf', filename, report.title, report.tables);
}));

reportsRouter.get('/:type', validate({ params: typeParam, query: rangeQuery }), asyncRoute(async (req, res) => {
  res.json({ data: await buildReport(req.auth!, req.params.type, rangeFrom(req.query as { from?: string; to?: string })) });
}));
