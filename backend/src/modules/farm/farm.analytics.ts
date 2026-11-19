import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { query, queryOne } from '../../database/query';
import type { ReportTable } from '../../services/reportFiles';
import type { AuthContext } from '../../types/auth';
import { HttpError } from '../../utils/httpError';
import { farmScope, inputCategories, num, PRODUCE_CATEGORY, scopeSql, todayIso } from './farm.common';
import { listTargets, yieldPerformance } from './farm.service';
import { listEquipment, producePosition } from './farm.resources';

export interface Range { from: string; to: string }

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Today, this week (Monday start), this month, this quarter, this year, or a custom range. */
export function resolveRange(period: string | undefined, from?: string, to?: string): Range {
  const now = new Date(`${todayIso()}T00:00:00Z`);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (period) {
    case 'today': return { from: isoDay(now), to: isoDay(now) };
    case 'week': {
      const start = new Date(now);
      start.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
      return { from: isoDay(start), to: isoDay(now) };
    }
    case 'quarter': return { from: isoDay(new Date(Date.UTC(y, m - (m % 3), 1))), to: isoDay(now) };
    case 'year': return { from: `${y}-01-01`, to: isoDay(now) };
    case 'custom': {
      if (!from || !to) throw new HttpError(422, 'Choose both dates for a custom range.', 'RANGE_REQUIRED');
      if (to < from) throw new HttpError(422, 'The range ends before it starts.', 'INVALID_RANGE');
      return { from, to };
    }
    default: return { from: isoDay(new Date(Date.UTC(y, m, 1))), to: isoDay(now) };
  }
}

function buckets(range: Range): Array<{ key: string; label: string }> {
  const start = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const result: Array<{ key: string; label: string }> = [];
  if (days <= 31) {
    for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) result.push({ key: isoDay(date), label: isoDay(date).slice(5) });
    return result;
  }
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); date <= end; date.setUTCMonth(date.getUTCMonth() + 1)) {
    result.push({ key: isoDay(date).slice(0, 7), label: `${names[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}` });
  }
  return result;
}

function bucketOf(range: Range, date: string): string {
  const start = new Date(`${range.from}T00:00:00Z`).getTime();
  const end = new Date(`${range.to}T00:00:00Z`).getTime();
  return (end - start) / 86400000 + 1 <= 31 ? date.slice(0, 10) : date.slice(0, 7);
}

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

/** The Operations Manager's farm dashboard for a period. Every figure is read from farm, stock, and haulage records. */
export async function farmDashboard(auth: AuthContext, range: Range) {
  const scope = await farmScope(auth);
  const f = scopeSql(scope, 'f.id');
  const x = (column: string) => scopeSql(scope, column);
  const one = async (sql: string, params: unknown[]) => (await queryOne<RowDataPacket>(pool, sql, params)) ?? {};
  const farms = await one(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active, COALESCE(SUM(cultivated_area_ha), 0) AS cultivated, COALESCE(SUM(total_area_ha), 0) AS land
     FROM farms f WHERE ${f.sql}`, f.params);
  const team = await one(
    `SELECT COUNT(DISTINCT t.employee_id) FILTER (WHERE t.team_role = 'supervisor') AS supervisors,
            COUNT(DISTINCT t.employee_id) FILTER (WHERE t.team_role <> 'supervisor') AS workers
     FROM farm_team_members t JOIN farms f ON f.id = t.farm_id WHERE (t.end_date IS NULL OR t.end_date >= CURRENT_DATE) AND ${f.sql}`, f.params);
  const cycles = x('c.farm_id');
  const projects = await one(`SELECT COUNT(*) AS total FROM farm_crop_cycles c WHERE c.status = 'active' AND ${cycles.sql}`, cycles.params);
  const acts = x('a.farm_id');
  const activities = await one(
    `SELECT COUNT(*) FILTER (WHERE a.status = 'in_progress' OR (a.status = 'planned' AND a.scheduled_date <= CURRENT_DATE AND a.due_date >= CURRENT_DATE)) AS current,
            COUNT(*) FILTER (WHERE a.status IN ('planned', 'in_progress') AND a.due_date < CURRENT_DATE) AS overdue
     FROM farm_activities a WHERE ${acts.sql}`, acts.params);
  const upcoming = await one(
    `SELECT (SELECT COUNT(*) FROM farm_crop_cycles c WHERE c.status = 'active' AND c.expected_harvest_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' AND ${cycles.sql})
          + (SELECT COUNT(*) FROM farm_activities a WHERE a.activity_type = 'harvesting' AND a.status = 'planned' AND a.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' AND ${acts.sql}) AS total`,
    [...cycles.params, ...acts.params]);
  const hv = x('h.farm_id');
  const harvested = await one(
    `SELECT COALESCE(SUM(h.quantity_kg), 0) AS kg, COALESCE(SUM(h.loss_kg), 0) AS loss, COUNT(*) FILTER (WHERE h.status = 'recorded') AS unverified
     FROM farm_harvests h WHERE h.status IN ('verified', 'recorded') AND h.harvest_date BETWEEN ? AND ? AND ${hv.sql}`, [range.from, range.to, ...hv.params]);
  const verifiedKg = num((await one(`SELECT COALESCE(SUM(h.quantity_kg), 0) AS kg FROM farm_harvests h WHERE h.status = 'verified' AND h.harvest_date BETWEEN ? AND ? AND ${hv.sql}`, [range.from, range.to, ...hv.params])).kg);
  const targets = (await listTargets(auth, {})).filter((target) => target.periodEnd >= range.from && target.periodStart <= range.to);
  const targetKg = targets.reduce((sum, target) => sum + target.targetKg, 0);
  const actualKg = targets.reduce((sum, target) => sum + target.actualKg, 0);
  const rq = x('q.farm_id');
  const requests = await one(`SELECT COUNT(*) AS total FROM farm_resource_requests q WHERE q.status = 'submitted' AND ${rq.sql}`, rq.params);
  const ic = x('i.farm_id');
  const incidents = await one(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE i.priority IN ('high', 'critical')) AS urgent FROM farm_incidents i WHERE i.status NOT IN ('resolved', 'closed') AND ${ic.sql}`, ic.params);
  const equipment = await listEquipment(auth, {});
  const produce = await producePosition(auth);
  const awaiting = produce.reduce((sum, row) => sum + row.inStorage, 0);

  const periods = buckets(range);
  const harvestRows = await query<RowDataPacket[]>(pool,
    `SELECT h.harvest_date, h.crop, h.status, h.quantity_kg, h.loss_kg, h.expected_kg, f.name AS farm_name, h.farm_id
     FROM farm_harvests h JOIN farms f ON f.id = h.farm_id WHERE h.status IN ('verified', 'recorded') AND h.harvest_date BETWEEN ? AND ? AND ${hv.sql}`,
    [range.from, range.to, ...hv.params]);
  const crops = [...new Set(harvestRows.map((row) => String(row.crop)))].slice(0, 6);
  const cropTrend = periods.map((period) => {
    const entry: Record<string, string | number> = { period: period.label };
    for (const crop of crops) {
      entry[crop] = round(harvestRows.filter((row) => String(row.crop) === crop && row.status === 'verified' && bucketOf(range, String(row.harvest_date)) === period.key)
        .reduce((sum, row) => sum + num(row.quantity_kg), 0));
    }
    return entry;
  });
  // Expected production is the crop's expected yield, placed in the period of its expected harvest date.
  const expectedRows = await query<RowDataPacket[]>(pool,
    `SELECT c.expected_harvest_date, c.expected_yield_kg FROM farm_crop_cycles c
     WHERE c.status <> 'abandoned' AND c.expected_yield_kg IS NOT NULL AND c.expected_harvest_date BETWEEN ? AND ? AND ${cycles.sql}`,
    [range.from, range.to, ...cycles.params]);
  const harvestPerformance = periods.map((period) => {
    const rows = harvestRows.filter((row) => bucketOf(range, String(row.harvest_date)) === period.key);
    return {
      period: period.label,
      expected: round(expectedRows.filter((row) => bucketOf(range, String(row.expected_harvest_date)) === period.key).reduce((sum, row) => sum + num(row.expected_yield_kg), 0)),
      harvested: round(rows.filter((row) => row.status === 'verified').reduce((sum, row) => sum + num(row.quantity_kg), 0)),
      losses: round(rows.reduce((sum, row) => sum + num(row.loss_kg), 0)),
    };
  });
  const byFarm = await query<RowDataPacket[]>(pool,
    `SELECT f.id, f.name, f.cultivated_area_ha,
            (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h WHERE h.farm_id = f.id AND h.status = 'verified' AND h.harvest_date BETWEEN ? AND ?) AS harvested,
            (SELECT COUNT(*) FROM farm_activities a WHERE a.farm_id = f.id AND a.status <> 'cancelled' AND a.due_date BETWEEN ? AND ?) AS activities,
            (SELECT COUNT(*) FROM farm_activities a WHERE a.farm_id = f.id AND a.status = 'completed' AND a.due_date BETWEEN ? AND ?) AS completed,
            (SELECT COUNT(*) FROM farm_incidents i WHERE i.farm_id = f.id AND i.occurred_on BETWEEN ? AND ?) AS incidents
     FROM farms f WHERE f.status <> 'inactive' AND ${f.sql} ORDER BY f.name`,
    [range.from, range.to, range.from, range.to, range.from, range.to, range.from, range.to, ...f.params]);
  const completion = await query<RowDataPacket[]>(pool,
    `SELECT a.activity_type, COUNT(*) AS total, COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE a.status IN ('planned', 'in_progress') AND a.due_date < CURRENT_DATE) AS overdue
     FROM farm_activities a WHERE a.status <> 'cancelled' AND a.due_date BETWEEN ? AND ? AND ${acts.sql} GROUP BY a.activity_type ORDER BY a.activity_type`,
    [range.from, range.to, ...acts.params]);
  const mv = x('m.farm_id');
  const marks = inputCategories.map(() => '?').join(', ');
  const utilisation = await query<RowDataPacket[]>(pool,
    `SELECT c.name AS category, COALESCE(SUM(m.quantity), 0) AS quantity, COALESCE(SUM(m.quantity * m.unit_cost), 0) AS value
     FROM stock_movements m JOIN stock_items i ON i.id = m.item_id JOIN stock_categories c ON c.id = i.category_id
     WHERE m.movement_type = 'issue' AND m.farm_id IS NOT NULL AND c.name IN (${marks}) AND CAST(m.created_at AS DATE) BETWEEN ? AND ? AND ${mv.sql}
     GROUP BY c.name ORDER BY c.name`,
    [...inputCategories, range.from, range.to, ...mv.params]);
  const equipmentHours = await query<RowDataPacket[]>(pool,
    `SELECT q.asset_type, COALESCE(SUM(ev.hours), 0) AS hours FROM equipment_events ev JOIN equipment_assets q ON q.id = ev.equipment_id
     WHERE ev.event_type = 'usage' AND ev.event_date BETWEEN ? AND ? GROUP BY q.asset_type ORDER BY q.asset_type`, [range.from, range.to]);

  return {
    range,
    cards: {
      totalFarms: num(farms.total), activeFarms: num(farms.active), cultivatedAreaHa: round(num(farms.cultivated)), totalLandHa: round(num(farms.land)),
      activeCropProjects: num(projects.total), supervisors: num(team.supervisors), workers: num(team.workers),
      currentActivities: num(activities.current), overdueActivities: num(activities.overdue), upcomingHarvests: num(upcoming.total),
      harvestedKg: round(verifiedKg), unverifiedHarvests: num(harvested.unverified), harvestLossKg: round(num(harvested.loss)),
      targetAchievement: targetKg > 0 ? round((actualKg / targetKg) * 100) : null, targetKg: round(targetKg), actualKg: round(actualKg),
      pendingResourceRequests: num(requests.total), openIncidents: num(incidents.total), urgentIncidents: num(incidents.urgent),
      equipmentMaintenance: equipment.filter((item) => item.needsMaintenance).length, produceInStore: round(awaiting),
    },
    charts: {
      targetVsActual: targets.map((target) => ({ name: `${target.farmName} · ${target.crop}`, target: target.targetKg, actual: target.actualKg })),
      byLocation: byFarm.map((row) => ({
        farm: String(row.name), harvested: round(num(row.harvested)),
        yieldPerHa: num(row.cultivated_area_ha) > 0 ? round(num(row.harvested) / num(row.cultivated_area_ha)) : 0,
        completion: num(row.activities) ? round((num(row.completed) / num(row.activities)) * 100) : 0, incidents: num(row.incidents),
      })),
      cropTrend: { crops, rows: cropTrend },
      harvestPerformance,
      activityCompletion: completion.map((row) => ({ type: String(row.activity_type), total: num(row.total), completed: num(row.completed), overdue: num(row.overdue) })),
      resourceUtilisation: utilisation.map((row) => ({ category: String(row.category), quantity: round(num(row.quantity)), value: round(num(row.value), 2) })),
      equipmentHours: equipmentHours.map((row) => ({ type: String(row.asset_type), hours: round(num(row.hours)) })),
    },
  };
}

// ---------------------------------------------------------------- reports

export interface ReportFilters extends Range { farmId?: number; crop?: string; season?: string; supervisorUserId?: number }

export const farmReportCatalog: Array<{ code: string; name: string }> = [
  { code: 'daily_operations', name: 'Farm Daily Operations Report' },
  { code: 'weekly_operations', name: 'Farm Weekly Operations Report' },
  { code: 'monthly_performance', name: 'Monthly Farm Performance Report' },
  { code: 'farm_production', name: 'Farm Production Report' },
  { code: 'crop_production', name: 'Crop Production Report' },
  { code: 'planting_activities', name: 'Planting Activities Report' },
  { code: 'harvest', name: 'Harvest Report' },
  { code: 'yield_performance', name: 'Yield Performance Report' },
  { code: 'labour', name: 'Farm Labour Report' },
  { code: 'equipment_utilisation', name: 'Farm Equipment Utilisation Report' },
  { code: 'inputs_consumption', name: 'Farm Inputs Consumption Report' },
  { code: 'expenses', name: 'Farm Expenses Report' },
  { code: 'inventory', name: 'Farm Inventory Report' },
  { code: 'dispatch', name: 'Farm Dispatch Report' },
  { code: 'incidents', name: 'Farm Incident Report' },
  { code: 'inspections', name: 'Farm Inspection Report' },
  { code: 'target_achievement', name: 'Production Target Achievement Report' },
];

interface Clause { sql: string; params: unknown[] }

function and(...clauses: Array<Clause | null>): Clause {
  const used = clauses.filter((clause): clause is Clause => clause != null);
  return { sql: used.map((clause) => clause.sql).join(' AND ') || '1 = 1', params: used.flatMap((clause) => clause.params) };
}

function eq(column: string, value: unknown): Clause | null {
  return value == null || value === '' ? null : { sql: `${column} = ?`, params: [value] };
}

function between(column: string, range: Range): Clause {
  return { sql: `${column} BETWEEN ? AND ?`, params: [range.from, range.to] };
}

function crop(column: string, value?: string): Clause | null {
  return value ? { sql: `LOWER(${column}) = LOWER(?)`, params: [value] } : null;
}

/** Farms supervised by the chosen supervisor, so supervisor filters apply to every report. */
function supervisedBy(column: string, userId?: number): Clause | null {
  if (!userId) return null;
  return {
    sql: `${column} IN (SELECT t.farm_id FROM farm_team_members t JOIN users u ON u.employee_id = t.employee_id WHERE u.id = ? AND t.team_role = 'supervisor'
           UNION SELECT f2.id FROM farms f2 JOIN users u2 ON u2.employee_id = f2.supervisor_employee_id WHERE u2.id = ?)`,
    params: [userId, userId],
  };
}

const names = (alias: string) => `COALESCE(NULLIF(TRIM(CONCAT(${alias}e.first_name, ' ', ${alias}e.last_name)), ''), ${alias}u.username)`;

export async function buildFarmReport(auth: AuthContext, code: string, filters: ReportFilters): Promise<{ title: string; tables: ReportTable[] }> {
  const entry = farmReportCatalog.find((item) => item.code === code);
  if (!entry) throw new HttpError(404, 'That report does not exist.', 'UNKNOWN_REPORT');
  const scope = await farmScope(auth);
  const s = (column: string) => scopeSql(scope, column);
  const period = `${filters.from} to ${filters.to}`;
  const rows = async (sql: string, params: unknown[]) => query<RowDataPacket[]>(pool, sql, params);
  const table = (title: string, columns: string[], data: Array<Array<string | number>>): ReportTable => ({ title, columns, rows: data.length ? data : [columns.map((_, index) => (index === 0 ? 'No records for these filters' : ''))] });
  const v = (value: unknown) => (value == null ? '' : typeof value === 'number' ? value : String(value));

  switch (code) {
    case 'daily_operations':
    case 'planting_activities':
    case 'labour': {
      const where = and(s('r.farm_id'), between('r.activity_date', filters), eq('r.farm_id', filters.farmId), eq('r.submitted_by', filters.supervisorUserId),
        code === 'planting_activities' ? { sql: `r.activity_type IN ('planting', 'land_preparation')`, params: [] } : null,
        filters.crop ? { sql: `r.activity_id IN (SELECT a.id FROM farm_activities a JOIN farm_crop_cycles c ON c.id = a.crop_cycle_id WHERE LOWER(c.crop) = LOWER(?))`, params: [filters.crop] } : null);
      const data = await rows(
        `SELECT r.*, f.name AS farm_name, ${names('s')} AS submitter, ${names('v')} AS reviewer FROM farm_daily_reports r JOIN farms f ON f.id = r.farm_id
         JOIN users su ON su.id = r.submitted_by LEFT JOIN employees se ON se.id = su.employee_id LEFT JOIN users vu ON vu.id = r.reviewed_by LEFT JOIN employees ve ON ve.id = vu.employee_id
         WHERE ${where.sql} ORDER BY r.activity_date, f.name`, where.params);
      if (code === 'labour') {
        const totals = new Map<string, { farm: string; days: Set<string>; workerDays: number; reports: number }>();
        for (const row of data) {
          const key = String(row.farm_name);
          const item = totals.get(key) ?? { farm: key, days: new Set<string>(), workerDays: 0, reports: 0 };
          item.days.add(String(row.activity_date));
          item.workerDays += num(row.workers_count);
          item.reports += 1;
          totals.set(key, item);
        }
        const teams = await rows(`SELECT f.name, COUNT(*) FILTER (WHERE t.team_role <> 'supervisor') AS workers, COUNT(*) FILTER (WHERE t.team_role = 'supervisor') AS supervisors
          FROM farms f LEFT JOIN farm_team_members t ON t.farm_id = f.id AND (t.end_date IS NULL OR t.end_date >= CURRENT_DATE) WHERE ${and(s('f.id'), eq('f.id', filters.farmId)).sql} GROUP BY f.name ORDER BY f.name`,
          and(s('f.id'), eq('f.id', filters.farmId)).params);
        return {
          title: `${entry.name} (${period})`,
          tables: [
            table('Labour by farm', ['Farm', 'Team workers', 'Team supervisors', 'Days worked', 'Worker-days', 'Reports', 'Average workers per day'],
              teams.map((team) => {
                const item = totals.get(String(team.name));
                return [String(team.name), num(team.workers), num(team.supervisors), item?.days.size ?? 0, item?.workerDays ?? 0, item?.reports ?? 0, item && item.days.size ? round(item.workerDays / item.days.size) : 0];
              })),
            table('Daily labour', ['Activity date', 'Farm', 'Activity', 'Workers', 'Names', 'Submitted by'], data.map((row) => [v(row.activity_date), v(row.farm_name), v(row.activity_type), num(row.workers_count), v(row.worker_names), v(row.submitter)])),
          ],
        };
      }
      return {
        title: `${entry.name} (${period})`,
        tables: [table(entry.name, ['Reference', 'Activity date', 'Submitted on', 'Farm', 'Activity', 'Work performed', 'Workers', 'Resources used', 'Completed', 'Challenges', 'Submitted by', 'Status', 'Reviewed by', 'Review remarks'],
          data.map((row) => [v(row.reference_number), v(row.activity_date), String(row.submitted_at).slice(0, 16), v(row.farm_name), v(row.activity_type), v(row.work_performed), num(row.workers_count),
            v(row.resources_used), v(row.work_completed), v(row.challenges), v(row.submitter), v(row.status), v(row.reviewer), v(row.review_remarks)]))],
      };
    }
    case 'weekly_operations': {
      const where = and(s('r.farm_id'), between('r.activity_date', filters), eq('r.farm_id', filters.farmId), eq('r.submitted_by', filters.supervisorUserId));
      const data = await rows(
        `SELECT TO_CHAR(DATE_TRUNC('week', r.activity_date), 'YYYY-MM-DD') AS week, f.name AS farm_name, COUNT(*) AS reports, COALESCE(SUM(r.workers_count), 0) AS worker_days,
                COALESCE(SUM(r.area_covered_ha), 0) AS area, STRING_AGG(DISTINCT r.activity_type, ', ') AS activities,
                COUNT(*) FILTER (WHERE r.status = 'acknowledged') AS acknowledged, COUNT(*) FILTER (WHERE r.challenges IS NOT NULL AND r.challenges <> '') AS with_challenges
         FROM farm_daily_reports r JOIN farms f ON f.id = r.farm_id WHERE ${where.sql} GROUP BY 1, f.name ORDER BY 1, f.name`, where.params);
      const done = await rows(
        `SELECT TO_CHAR(DATE_TRUNC('week', a.completed_on), 'YYYY-MM-DD') AS week, f.name AS farm_name, COUNT(*) AS completed
         FROM farm_activities a JOIN farms f ON f.id = a.farm_id WHERE a.status = 'completed' AND ${and(s('a.farm_id'), between('a.completed_on', filters), eq('a.farm_id', filters.farmId), supervisedBy('a.farm_id', filters.supervisorUserId)).sql} GROUP BY 1, f.name`,
        and(s('a.farm_id'), between('a.completed_on', filters), eq('a.farm_id', filters.farmId), supervisedBy('a.farm_id', filters.supervisorUserId)).params);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Weekly operations', ['Week starting', 'Farm', 'Daily reports', 'Acknowledged', 'Worker-days', 'Area covered (ha)', 'Activities', 'Scheduled activities completed', 'Reports with challenges'],
          data.map((row) => [v(row.week), v(row.farm_name), num(row.reports), num(row.acknowledged), num(row.worker_days), round(num(row.area)), v(row.activities),
            num(done.find((item) => item.week === row.week && item.farm_name === row.farm_name)?.completed), num(row.with_challenges)]))],
      };
    }
    case 'monthly_performance':
    case 'farm_production': {
      const farms = await rows(`SELECT f.id, f.name, f.cultivated_area_ha FROM farms f WHERE ${and(s('f.id'), eq('f.id', filters.farmId), supervisedBy('f.id', filters.supervisorUserId)).sql} ORDER BY f.name`,
        and(s('f.id'), eq('f.id', filters.farmId), supervisedBy('f.id', filters.supervisorUserId)).params);
      const harvest = await rows(
        `SELECT h.farm_id, TO_CHAR(h.harvest_date, 'YYYY-MM') AS month, COALESCE(SUM(h.quantity_kg), 0) AS kg, COALESCE(SUM(h.loss_kg), 0) AS loss, COUNT(*) AS harvests
         FROM farm_harvests h WHERE h.status = 'verified' AND ${and(between('h.harvest_date', filters), crop('h.crop', filters.crop), eq('h.season', filters.season)).sql} GROUP BY h.farm_id, 2`,
        and(between('h.harvest_date', filters), crop('h.crop', filters.crop), eq('h.season', filters.season)).params);
      const activity = await rows(
        `SELECT a.farm_id, TO_CHAR(a.due_date, 'YYYY-MM') AS month, COUNT(*) AS total, COUNT(*) FILTER (WHERE a.status = 'completed') AS completed
         FROM farm_activities a WHERE a.status <> 'cancelled' AND a.due_date BETWEEN ? AND ? GROUP BY a.farm_id, 2`, [filters.from, filters.to]);
      const incidents = await rows(`SELECT i.farm_id, TO_CHAR(i.occurred_on, 'YYYY-MM') AS month, COUNT(*) AS total FROM farm_incidents i WHERE i.occurred_on BETWEEN ? AND ? GROUP BY i.farm_id, 2`, [filters.from, filters.to]);
      const targets = (await listTargets(auth, { farmId: filters.farmId, crop: filters.crop, season: filters.season })).filter((t) => t.periodEnd >= filters.from && t.periodStart <= filters.to);
      if (code === 'farm_production') {
        return {
          title: `${entry.name} (${period})`,
          tables: [table('Production by farm', ['Farm', 'Cultivated (ha)', 'Verified harvests', 'Harvested (kg)', 'Losses (kg)', 'Yield (kg/ha)', 'Target (kg)', 'Achievement %'],
            farms.map((farm) => {
              const own = harvest.filter((row) => Number(row.farm_id) === Number(farm.id));
              const kg = own.reduce((sum, row) => sum + num(row.kg), 0);
              const target = targets.filter((t) => t.farmId === Number(farm.id)).reduce((sum, t) => sum + t.targetKg, 0);
              return [String(farm.name), num(farm.cultivated_area_ha), own.reduce((sum, row) => sum + num(row.harvests), 0), round(kg), round(own.reduce((sum, row) => sum + num(row.loss), 0)),
                num(farm.cultivated_area_ha) > 0 ? round(kg / num(farm.cultivated_area_ha)) : '', round(target), target > 0 ? round((kg / target) * 100) : ''];
            }))],
        };
      }
      const months = [...new Set([...harvest, ...activity, ...incidents].map((row) => String(row.month)))].sort();
      const data: Array<Array<string | number>> = [];
      for (const month of months) {
        for (const farm of farms) {
          const id = Number(farm.id);
          const h = harvest.find((row) => Number(row.farm_id) === id && row.month === month);
          const a = activity.find((row) => Number(row.farm_id) === id && row.month === month);
          const i = incidents.find((row) => Number(row.farm_id) === id && row.month === month);
          if (!h && !a && !i) continue;
          data.push([month, String(farm.name), round(num(h?.kg)), round(num(h?.loss)), num(a?.total), num(a?.completed), num(a?.total) ? round((num(a?.completed) / num(a?.total)) * 100) : '', num(i?.total)]);
        }
      }
      return { title: `${entry.name} (${period})`, tables: [table('Monthly performance', ['Month', 'Farm', 'Harvested (kg)', 'Losses (kg)', 'Activities due', 'Completed', 'Completion %', 'Incidents'], data)] };
    }
    case 'crop_production': {
      const where = and(s('c.farm_id'), eq('c.farm_id', filters.farmId), crop('c.crop', filters.crop), eq('c.season', filters.season), supervisedBy('c.farm_id', filters.supervisorUserId),
        { sql: `(c.planting_date IS NULL OR c.planting_date <= ?) AND (c.expected_harvest_date IS NULL OR c.expected_harvest_date >= ? OR c.status = 'active')`, params: [filters.to, filters.from] });
      const data = await rows(
        `SELECT c.*, f.name AS farm_name, (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h WHERE h.crop_cycle_id = c.id AND h.status = 'verified') AS harvested
         FROM farm_crop_cycles c JOIN farms f ON f.id = c.farm_id WHERE ${where.sql} ORDER BY c.season DESC, f.name, c.crop`, where.params);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Crop production', ['Reference', 'Farm', 'Crop', 'Variety', 'Season', 'Area (ha)', 'Planted', 'Expected harvest', 'Stage', 'Status', 'Expected (kg)', 'Harvested (kg)', 'Yield (kg/ha)'],
          data.map((row) => [v(row.reference_number), v(row.farm_name), v(row.crop), v(row.variety), v(row.season), num(row.area_ha), v(row.planting_date), v(row.expected_harvest_date), v(row.stage), v(row.status),
            row.expected_yield_kg == null ? '' : num(row.expected_yield_kg), round(num(row.harvested)), num(row.area_ha) ? round(num(row.harvested) / num(row.area_ha)) : '']))],
      };
    }
    case 'harvest': {
      const where = and(s('h.farm_id'), between('h.harvest_date', filters), eq('h.farm_id', filters.farmId), crop('h.crop', filters.crop), eq('h.season', filters.season), supervisedBy('h.farm_id', filters.supervisorUserId));
      const data = await rows(
        `SELECT h.*, f.name AS farm_name, ${names('r')} AS recorder, ${names('v')} AS verifier, w.name AS warehouse FROM farm_harvests h JOIN farms f ON f.id = h.farm_id
         JOIN users ru ON ru.id = h.recorded_by LEFT JOIN employees re ON re.id = ru.employee_id LEFT JOIN users vu ON vu.id = h.verified_by LEFT JOIN employees ve ON ve.id = vu.employee_id
         LEFT JOIN warehouses w ON w.id = h.warehouse_id WHERE ${where.sql} ORDER BY h.harvest_date, f.name`, where.params);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Harvests', ['Reference', 'Harvest date', 'Recorded on', 'Farm', 'Crop', 'Season', 'Expected (kg)', 'Harvested (kg)', 'Losses (kg)', 'Grade', 'Moisture %', 'Status', 'Store', 'Recorded by', 'Verified by'],
          data.map((row) => [v(row.reference_number), v(row.harvest_date), String(row.created_at).slice(0, 16), v(row.farm_name), v(row.crop), v(row.season), row.expected_kg == null ? '' : num(row.expected_kg),
            num(row.quantity_kg), num(row.loss_kg), v(row.grade), row.moisture_percent == null ? '' : num(row.moisture_percent), v(row.status), v(row.warehouse), v(row.recorder), v(row.verifier)]))],
      };
    }
    case 'yield_performance': {
      const data = (await yieldPerformance(auth, { farmId: filters.farmId, crop: filters.crop, season: filters.season }));
      return {
        title: `${entry.name}`,
        tables: [table('Yield performance', ['Farm', 'Crop', 'Season', 'Area (ha)', 'Expected (kg)', 'Harvested (kg)', 'Losses (kg)', 'Yield (kg/ha)', 'Yield (kg/acre)', 'Expected (kg/ha)'],
          data.map((row) => [row.farmName, row.crop, row.season, row.areaHa, row.expectedKg, row.harvestedKg, row.lossKg, row.yieldPerHa ?? '', row.yieldPerAcre ?? '', row.expectedPerHa ?? '']))],
      };
    }
    case 'equipment_utilisation': {
      const where = and(between('ev.event_date', filters), eq('ev.farm_id', filters.farmId));
      const events = await rows(
        `SELECT q.asset_code, q.name, q.asset_type, q.status, q.equipment_condition, f.name AS farm_name,
                COALESCE(SUM(ev.hours) FILTER (WHERE ev.event_type = 'usage'), 0) AS hours,
                COUNT(*) FILTER (WHERE ev.event_type = 'maintenance') AS services, COUNT(*) FILTER (WHERE ev.event_type = 'repair') AS repairs,
                COALESCE(SUM(ev.cost) FILTER (WHERE ev.event_type IN ('maintenance', 'repair')), 0) AS cost
         FROM equipment_assets q LEFT JOIN farms f ON f.id = q.farm_id LEFT JOIN equipment_events ev ON ev.equipment_id = q.id AND ${where.sql}
         GROUP BY q.id, q.asset_code, q.name, q.asset_type, q.status, q.equipment_condition, f.name ORDER BY q.name`, where.params);
      const days = Math.round((new Date(`${filters.to}T00:00:00Z`).getTime() - new Date(`${filters.from}T00:00:00Z`).getTime()) / 86400000) + 1;
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Equipment utilisation', ['Asset', 'Name', 'Type', 'Allocated to', 'Status', 'Condition', 'Hours used', 'Utilisation % (8 h/day)', 'Services', 'Repairs', 'Upkeep cost'],
          events.map((row) => [v(row.asset_code), v(row.name), v(row.asset_type), v(row.farm_name), v(row.status), v(row.equipment_condition), round(num(row.hours)),
            round((num(row.hours) / (days * 8)) * 100), num(row.services), num(row.repairs), round(num(row.cost), 2)]))],
      };
    }
    case 'inputs_consumption':
    case 'expenses': {
      const where = and(s('m.farm_id'), { sql: 'm.farm_id IS NOT NULL', params: [] }, { sql: 'CAST(m.created_at AS DATE) BETWEEN ? AND ?', params: [filters.from, filters.to] }, eq('m.farm_id', filters.farmId), supervisedBy('m.farm_id', filters.supervisorUserId));
      const consumption = await rows(
        `SELECT f.name AS farm_name, c.name AS category, i.name AS item_name, i.unit, SUM(m.quantity) AS quantity, SUM(m.quantity * m.unit_cost) AS value
         FROM stock_movements m JOIN farms f ON f.id = m.farm_id JOIN stock_items i ON i.id = m.item_id LEFT JOIN stock_categories c ON c.id = i.category_id
         WHERE m.movement_type = 'issue' AND COALESCE(c.name, '') <> ? AND ${where.sql} GROUP BY f.name, c.name, i.name, i.unit ORDER BY f.name, c.name, i.name`,
        [PRODUCE_CATEGORY, ...where.params]);
      if (code === 'inputs_consumption') {
        return {
          title: `${entry.name} (${period})`,
          tables: [table('Inputs issued to farms', ['Farm', 'Category', 'Item', 'Quantity', 'Unit', 'Value'], consumption.map((row) => [v(row.farm_name), v(row.category), v(row.item_name), round(num(row.quantity), 3), v(row.unit), round(num(row.value), 2)]))],
        };
      }
      const upkeep = await rows(
        `SELECT f.name AS farm_name, COALESCE(SUM(ev.cost), 0) AS cost FROM equipment_events ev JOIN farms f ON f.id = ev.farm_id
         WHERE ev.event_type IN ('maintenance', 'repair') AND ${and(s('ev.farm_id'), between('ev.event_date', filters), eq('ev.farm_id', filters.farmId)).sql} GROUP BY f.name`,
        and(s('ev.farm_id'), between('ev.event_date', filters), eq('ev.farm_id', filters.farmId)).params);
      const services = await rows(
        `SELECT f.name AS farm_name, COALESCE(SUM(q.estimated_cost), 0) AS cost FROM farm_resource_requests q JOIN farms f ON f.id = q.farm_id
         WHERE q.status = 'fulfilled' AND q.stock_item_id IS NULL AND ${and(s('q.farm_id'), { sql: 'CAST(q.fulfilled_at AS DATE) BETWEEN ? AND ?', params: [filters.from, filters.to] }, eq('q.farm_id', filters.farmId)).sql} GROUP BY f.name`,
        and(s('q.farm_id'), { sql: 'CAST(q.fulfilled_at AS DATE) BETWEEN ? AND ?', params: [filters.from, filters.to] }, eq('q.farm_id', filters.farmId)).params);
      const farmsSeen = [...new Set([...consumption, ...upkeep, ...services].map((row) => String(row.farm_name)))].sort();
      return {
        title: `${entry.name} (${period})`,
        tables: [
          table('Expenses by farm', ['Farm', 'Inputs issued (stock value)', 'Equipment maintenance and repairs', 'Fulfilled non-stock requests (estimate)', 'Total'],
            farmsSeen.map((farm) => {
              const inputs = consumption.filter((row) => row.farm_name === farm).reduce((sum, row) => sum + num(row.value), 0);
              const equipment = num(upkeep.find((row) => row.farm_name === farm)?.cost);
              const other = num(services.find((row) => row.farm_name === farm)?.cost);
              return [farm, round(inputs, 2), round(equipment, 2), round(other, 2), round(inputs + equipment + other, 2)];
            })),
          table('Inputs detail', ['Farm', 'Category', 'Item', 'Quantity', 'Value'], consumption.map((row) => [v(row.farm_name), v(row.category), v(row.item_name), round(num(row.quantity), 3), round(num(row.value), 2)])),
        ],
      };
    }
    case 'inventory': {
      const produce = await producePosition(auth);
      const movements = await rows(
        `SELECT i.name, w.name AS warehouse, m.movement_type, COALESCE(SUM(m.quantity), 0) AS quantity FROM stock_movements m JOIN stock_items i ON i.id = m.item_id
         JOIN stock_categories c ON c.id = i.category_id AND c.name = ? JOIN warehouses w ON w.id = m.warehouse_id
         WHERE CAST(m.created_at AS DATE) BETWEEN ? AND ? GROUP BY i.name, w.name, m.movement_type ORDER BY i.name, w.name`, [PRODUCE_CATEGORY, filters.from, filters.to]);
      const sum = (item: string, warehouse: string, types: string[]) => round(movements.filter((row) => row.name === item && row.warehouse === warehouse && types.includes(String(row.movement_type))).reduce((total, row) => total + num(row.quantity), 0), 3);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Farm produce inventory', ['Produce', 'Store', 'Source farms', 'Grades', `Received ${period}`, `Issued ${period}`, 'In storage now', 'Awaiting dispatch', 'Available'],
          produce.map((row) => [row.itemName, row.warehouseName, row.harvestSources ?? '', row.grades ?? '', sum(row.itemName, row.warehouseName, ['receipt', 'transfer_in']),
            sum(row.itemName, row.warehouseName, ['issue', 'damage', 'transfer_out']), row.inStorage, row.awaitingDispatch, row.availableToDispatch]))],
      };
    }
    case 'dispatch': {
      const where = and(scope.all ? null : { sql: `(d.farm_id IS NULL OR ${s('d.farm_id').sql})`, params: s('d.farm_id').params }, { sql: 'CAST(d.created_at AS DATE) BETWEEN ? AND ?', params: [filters.from, filters.to] },
        eq('d.farm_id', filters.farmId), supervisedBy('d.farm_id', filters.supervisorUserId));
      const data = await rows(
        `SELECT d.*, f.name AS farm_name, i.name AS item_name, i.unit, w.name AS warehouse, t.reference_number AS trip, t.driver_name, q.name AS vehicle
         FROM farm_dispatches d LEFT JOIN farms f ON f.id = d.farm_id JOIN stock_items i ON i.id = d.stock_item_id JOIN warehouses w ON w.id = d.warehouse_id
         LEFT JOIN haulage_trips t ON t.id = d.haulage_trip_id LEFT JOIN equipment_assets q ON q.id = t.vehicle_id WHERE ${where.sql} ORDER BY d.id`, where.params);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Dispatches', ['Reference', 'Requested on', 'Farm', 'Produce', 'Quantity', 'Unit', 'From store', 'Collection', 'Destination', 'Purpose', 'Status', 'Trip', 'Vehicle', 'Driver', 'Left', 'Delivered'],
          data.map((row) => [v(row.reference_number), String(row.created_at).slice(0, 10), v(row.farm_name), v(row.item_name), num(row.quantity), v(row.unit), v(row.warehouse), v(row.collection_location),
            v(row.destination), v(row.purpose), v(row.status), v(row.trip), v(row.vehicle), v(row.driver_name), row.dispatched_at ? String(row.dispatched_at).slice(0, 16) : '', row.delivered_at ? String(row.delivered_at).slice(0, 16) : '']))],
      };
    }
    case 'incidents': {
      const where = and(s('i.farm_id'), between('i.occurred_on', filters), eq('i.farm_id', filters.farmId), supervisedBy('i.farm_id', filters.supervisorUserId));
      const data = await rows(
        `SELECT i.*, f.name AS farm_name, ${names('r')} AS reporter, ${names('a')} AS assignee FROM farm_incidents i JOIN farms f ON f.id = i.farm_id
         JOIN users ru ON ru.id = i.reported_by LEFT JOIN employees re ON re.id = ru.employee_id LEFT JOIN users au ON au.id = i.assigned_to_user_id LEFT JOIN employees ae ON ae.id = au.employee_id
         WHERE ${where.sql} ORDER BY i.occurred_on`, where.params);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Incidents', ['Reference', 'Occurred', 'Reported on', 'Farm', 'Category', 'Title', 'Priority', 'Status', 'Reported by', 'Assigned to', 'Resolution'],
          data.map((row) => [v(row.reference_number), v(row.occurred_on), String(row.created_at).slice(0, 16), v(row.farm_name), v(row.category), v(row.title), v(row.priority), v(row.status), v(row.reporter),
            row.assigned_to_user_id ? v(row.assignee) : '', v(row.resolution_remarks)]))],
      };
    }
    case 'inspections': {
      const where = and(s('i.farm_id'), between('i.inspection_date', filters), eq('i.farm_id', filters.farmId), supervisedBy('i.farm_id', filters.supervisorUserId));
      const data = await rows(
        `SELECT i.*, f.name AS farm_name, ${names('n')} AS inspector FROM farm_inspections i JOIN farms f ON f.id = i.farm_id JOIN users nu ON nu.id = i.inspector_user_id
         LEFT JOIN employees ne ON ne.id = nu.employee_id WHERE ${where.sql} ORDER BY i.inspection_date`, where.params);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Inspections', ['Reference', 'Date', 'Farm', 'Type', 'Rating', 'Findings', 'Recommendations', 'Follow-up', 'Status', 'Inspector'],
          data.map((row) => [v(row.reference_number), v(row.inspection_date), v(row.farm_name), v(row.inspection_type), row.rating == null ? '' : num(row.rating), v(row.findings), v(row.recommendations), v(row.follow_up_date), v(row.status), v(row.inspector)]))],
      };
    }
    case 'target_achievement': {
      const targets = (await listTargets(auth, { farmId: filters.farmId, crop: filters.crop, season: filters.season })).filter((t) => t.periodEnd >= filters.from && t.periodStart <= filters.to);
      return {
        title: `${entry.name} (${period})`,
        tables: [table('Target achievement', ['Farm', 'Crop', 'Season', 'Period', 'Target (kg)', 'Actual (kg)', 'Achievement %', 'Expected by now %', 'Status'],
          targets.map((t) => [t.farmName, t.crop, t.season, `${t.periodStart} – ${t.periodEnd}`, t.targetKg, t.actualKg, t.achievement, t.expectedByNow, t.underperforming ? 'Below target' : t.achievement >= 100 ? 'Achieved' : 'On track']))],
      };
    }
    default:
      throw new HttpError(404, 'That report does not exist.', 'UNKNOWN_REPORT');
  }
}
