import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasPermission } from '../../services/access';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import { assertSegregation } from '../../services/governance';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { activeItem, activeWarehouse, changeStock } from '../supply/supply.service';
import {
  type Actor,
  assertFarmInScope,
  farmReference,
  farmScope,
  farmSupervisorUsers,
  notifyFarmManagers,
  notifyUsers,
  num,
  optionalNumber,
  personName,
  PRODUCE_CATEGORY,
  requireFarmPermission,
  scopeSql,
  text,
  todayIso,
} from './farm.common';

async function audit(db: Db, actor: Actor, action: string, entityType: string, entityId: number | string, newValue: unknown, previousValue?: unknown) {
  await writeAudit(db, { userId: actor.userId, action, module: 'farm', entityType, entityId, previousValue, newValue, ipAddress: actor.ipAddress, userAgent: actor.userAgent });
}

function like(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// ---------------------------------------------------------------- farms

const farmSelect = `
  SELECT f.*, d.name AS department_name, w.name AS warehouse_name,
         CONCAT(se.first_name, ' ', se.last_name) AS supervisor_name, se.employee_number AS supervisor_number,
         (SELECT COUNT(*) FROM farm_team_members t WHERE t.farm_id = f.id AND t.team_role <> 'supervisor' AND (t.end_date IS NULL OR t.end_date >= CURRENT_DATE)) AS worker_count,
         (SELECT COUNT(*) FROM farm_crop_cycles c WHERE c.farm_id = f.id AND c.status = 'active') AS active_cycles,
         (SELECT COUNT(*) FROM farm_activities a WHERE a.farm_id = f.id AND a.status IN ('planned', 'in_progress')) AS open_activities,
         (SELECT COUNT(*) FROM farm_incidents i WHERE i.farm_id = f.id AND i.status NOT IN ('resolved', 'closed')) AS open_incidents,
         (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h WHERE h.farm_id = f.id AND h.status = 'verified') AS harvested_kg
  FROM farms f
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN warehouses w ON w.id = f.warehouse_id
  LEFT JOIN employees se ON se.id = f.supervisor_employee_id
`;

function mapFarm(row: RowDataPacket) {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), location: String(row.location), region: text(row.region),
    gpsCoordinates: text(row.gps_coordinates), totalAreaHa: num(row.total_area_ha), cultivatedAreaHa: num(row.cultivated_area_ha),
    ownership: String(row.ownership), status: String(row.status), departmentId: optionalNumber(row.department_id), departmentName: text(row.department_name),
    supervisorEmployeeId: optionalNumber(row.supervisor_employee_id), supervisorName: text(row.supervisor_name),
    warehouseId: optionalNumber(row.warehouse_id), warehouseName: text(row.warehouse_name), notes: text(row.notes),
    workerCount: num(row.worker_count), activeCycles: num(row.active_cycles), openActivities: num(row.open_activities),
    openIncidents: num(row.open_incidents), harvestedKg: num(row.harvested_kg), updatedAt: row.updated_at,
  };
}

export async function listFarms(auth: AuthContext) {
  const scope = scopeSql(await farmScope(auth), 'f.id');
  const rows = await query<RowDataPacket[]>(pool, `${farmSelect} WHERE ${scope.sql} ORDER BY f.name`, scope.params);
  return rows.map(mapFarm);
}

export async function getFarm(auth: AuthContext, id: number) {
  await assertFarmInScope(auth, id);
  const row = await queryOne<RowDataPacket>(pool, `${farmSelect} WHERE f.id = ?`, [id]);
  return {
    ...mapFarm(row!),
    team: await listTeam(auth, { farmId: id }),
    cropCycles: await listCropCycles(auth, { farmId: id }),
    activities: (await listActivities(auth, { farmId: id })).slice(0, 20),
    incidents: (await listIncidents(auth, { farmId: id })).slice(0, 10),
    equipment: (await query<RowDataPacket[]>(pool, `SELECT id, asset_code, name, status, equipment_condition FROM equipment_assets WHERE farm_id = ? ORDER BY name`, [id]))
      .map((item) => ({ id: Number(item.id), assetCode: String(item.asset_code), name: String(item.name), status: String(item.status), condition: String(item.equipment_condition) })),
  };
}

export interface FarmInput {
  code: string; name: string; location: string; region?: string | null; gpsCoordinates?: string | null;
  totalAreaHa: number; cultivatedAreaHa: number; ownership: 'owned' | 'leased' | 'partner'; status?: 'active' | 'fallow' | 'inactive';
  departmentId?: number | null; supervisorEmployeeId?: number | null; warehouseId?: number | null; notes?: string | null;
}

async function assertFarmReferences(db: Db, companyId: number, input: Partial<FarmInput>) {
  if (input.totalAreaHa != null && input.cultivatedAreaHa != null && input.cultivatedAreaHa > input.totalAreaHa) {
    throw new HttpError(422, 'The cultivated area cannot be larger than the total area.', 'INVALID_AREA');
  }
  if (input.supervisorEmployeeId) {
    const employee = await queryOne<RowDataPacket>(db, `SELECT id FROM employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND employment_status IN ('active', 'probation')`, [input.supervisorEmployeeId, companyId]);
    if (!employee) throw new HttpError(422, 'Choose an active employee as the farm supervisor.', 'INVALID_EMPLOYEE');
  }
  if (input.warehouseId) await activeWarehouse(db, companyId, input.warehouseId);
  if (input.departmentId) {
    const department = await queryOne<RowDataPacket>(db, `SELECT id FROM departments WHERE id = ? AND status = 'active'`, [input.departmentId]);
    if (!department) throw new HttpError(422, 'Choose an active department.', 'INVALID_DEPARTMENT');
  }
}

export async function createFarm(auth: AuthContext, input: FarmInput, actor: Actor) {
  requireFarmPermission(auth, 'farm.manage');
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    await assertFarmReferences(connection, companyId, input);
    const department = input.departmentId ?? Number((await queryOne<RowDataPacket>(connection, `SELECT id FROM departments WHERE code = 'OPS'`))?.id ?? 0) ?? null;
    const result = await execute(
      connection,
      `INSERT INTO farms (company_id, code, name, location, region, gps_coordinates, total_area_ha, cultivated_area_ha, ownership, status, department_id, supervisor_employee_id, warehouse_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, input.code.toUpperCase(), input.name, input.location, input.region ?? null, input.gpsCoordinates ?? null, input.totalAreaHa, input.cultivatedAreaHa,
        input.ownership, input.status ?? 'active', department || null, input.supervisorEmployeeId ?? null, input.warehouseId ?? null, input.notes ?? null, auth.userId],
    );
    if (input.supervisorEmployeeId) {
      await execute(connection, `INSERT INTO farm_team_members (farm_id, employee_id, team_role, start_date, created_by) VALUES (?, ?, 'supervisor', CURRENT_DATE, ?)`,
        [result.insertId, input.supervisorEmployeeId, auth.userId]);
    }
    await audit(connection, actor, 'farm.create', 'farm', result.insertId, input);
    return mapFarm((await queryOne<RowDataPacket>(connection, `${farmSelect} WHERE f.id = ?`, [result.insertId]))!);
  });
}

export async function updateFarm(auth: AuthContext, id: number, input: Partial<FarmInput>, actor: Actor) {
  requireFarmPermission(auth, 'farm.manage');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farms WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Farm');
    const next = {
      name: input.name ?? row.name, location: input.location ?? row.location, region: input.region === undefined ? row.region : input.region,
      gpsCoordinates: input.gpsCoordinates === undefined ? row.gps_coordinates : input.gpsCoordinates,
      totalAreaHa: input.totalAreaHa ?? num(row.total_area_ha), cultivatedAreaHa: input.cultivatedAreaHa ?? num(row.cultivated_area_ha),
      ownership: input.ownership ?? row.ownership, status: input.status ?? row.status,
      departmentId: input.departmentId === undefined ? optionalNumber(row.department_id) : input.departmentId,
      supervisorEmployeeId: input.supervisorEmployeeId === undefined ? optionalNumber(row.supervisor_employee_id) : input.supervisorEmployeeId,
      warehouseId: input.warehouseId === undefined ? optionalNumber(row.warehouse_id) : input.warehouseId,
      notes: input.notes === undefined ? row.notes : input.notes,
    };
    await assertFarmReferences(connection, Number(row.company_id), next);
    await execute(
      connection,
      `UPDATE farms SET name = ?, location = ?, region = ?, gps_coordinates = ?, total_area_ha = ?, cultivated_area_ha = ?, ownership = ?, status = ?,
         department_id = ?, supervisor_employee_id = ?, warehouse_id = ?, notes = ?, updated_by = ? WHERE id = ?`,
      [next.name, next.location, next.region, next.gpsCoordinates, next.totalAreaHa, next.cultivatedAreaHa, next.ownership, next.status,
        next.departmentId, next.supervisorEmployeeId, next.warehouseId, next.notes, auth.userId, id],
    );
    if (next.supervisorEmployeeId && next.supervisorEmployeeId !== optionalNumber(row.supervisor_employee_id)) {
      await execute(connection, `UPDATE farm_team_members SET end_date = CURRENT_DATE WHERE farm_id = ? AND team_role = 'supervisor' AND end_date IS NULL AND employee_id <> ?`, [id, next.supervisorEmployeeId]);
      const existing = await queryOne<RowDataPacket>(connection, `SELECT id FROM farm_team_members WHERE farm_id = ? AND employee_id = ? AND team_role = 'supervisor' AND end_date IS NULL`, [id, next.supervisorEmployeeId]);
      if (!existing) await execute(connection, `INSERT INTO farm_team_members (farm_id, employee_id, team_role, start_date, created_by) VALUES (?, ?, 'supervisor', CURRENT_DATE, ?)`, [id, next.supervisorEmployeeId, auth.userId]);
    }
    await audit(connection, actor, 'farm.update', 'farm', id, next, {
      name: row.name, location: row.location, totalAreaHa: num(row.total_area_ha), cultivatedAreaHa: num(row.cultivated_area_ha), status: row.status,
      supervisorEmployeeId: optionalNumber(row.supervisor_employee_id), warehouseId: optionalNumber(row.warehouse_id),
    });
    return mapFarm((await queryOne<RowDataPacket>(connection, `${farmSelect} WHERE f.id = ?`, [id]))!);
  });
}

// ---------------------------------------------------------------- supervisors and teams

export async function listTeam(auth: AuthContext, filters: { farmId?: number }) {
  const scope = scopeSql(await farmScope(auth), 't.farm_id');
  const where = [scope.sql, '(t.end_date IS NULL OR t.end_date >= CURRENT_DATE)'];
  const params = [...scope.params];
  if (filters.farmId) { where.push('t.farm_id = ?'); params.push(filters.farmId); }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT t.*, f.name AS farm_name, e.first_name, e.last_name, e.employee_number, e.phone, p.title AS position_title
     FROM farm_team_members t
     JOIN farms f ON f.id = t.farm_id
     JOIN employees e ON e.id = t.employee_id
     LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     LEFT JOIN positions p ON p.id = ea.position_id
     WHERE ${where.join(' AND ')}
     ORDER BY f.name, t.team_role, e.last_name`,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id), farmId: Number(row.farm_id), farmName: String(row.farm_name), employeeId: Number(row.employee_id),
    name: `${row.first_name} ${row.last_name}`, employeeNumber: String(row.employee_number), phone: text(row.phone), positionTitle: text(row.position_title),
    teamRole: String(row.team_role), responsibilities: text(row.responsibilities), startDate: String(row.start_date),
  }));
}

/** Supervisors with their farms, workers, responsibilities, completion rate, reports, and outstanding work. */
export async function listSupervisors(auth: AuthContext) {
  const scope = scopeSql(await farmScope(auth), 'f.id');
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT e.id AS employee_id, e.first_name, e.last_name, e.employee_number, e.phone, u.id AS user_id,
            STRING_AGG(DISTINCT f.name, ', ') AS farms,
            COUNT(DISTINCT f.id) AS farm_count,
            STRING_AGG(DISTINCT t.responsibilities, '; ') AS responsibilities
     FROM farms f
     JOIN farm_team_members t ON t.farm_id = f.id AND t.team_role = 'supervisor' AND (t.end_date IS NULL OR t.end_date >= CURRENT_DATE)
     JOIN employees e ON e.id = t.employee_id
     LEFT JOIN users u ON u.employee_id = e.id
     WHERE ${scope.sql}
     GROUP BY e.id, e.first_name, e.last_name, e.employee_number, e.phone, u.id
     ORDER BY e.last_name`,
    scope.params,
  );
  const result = [];
  for (const row of rows) {
    const userId = optionalNumber(row.user_id);
    const farmIds = (await query<RowDataPacket[]>(pool, `SELECT farm_id FROM farm_team_members WHERE employee_id = ? AND team_role = 'supervisor' AND (end_date IS NULL OR end_date >= CURRENT_DATE)`, [row.employee_id])).map((item) => Number(item.farm_id));
    const marks = farmIds.map(() => '?').join(', ') || 'NULL';
    const workers = await queryOne<RowDataPacket>(pool, `SELECT COUNT(DISTINCT employee_id) AS total FROM farm_team_members WHERE farm_id IN (${marks}) AND team_role <> 'supervisor' AND (end_date IS NULL OR end_date >= CURRENT_DATE)`, farmIds);
    const activities = await queryOne<RowDataPacket>(
      pool,
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE status IN ('planned', 'in_progress')) AS outstanding,
              COUNT(*) FILTER (WHERE status IN ('planned', 'in_progress') AND due_date < CURRENT_DATE) AS overdue
       FROM farm_activities WHERE (assigned_user_id = ? OR (assigned_user_id IS NULL AND farm_id IN (${marks}))) AND status <> 'cancelled'`,
      [userId, ...farmIds],
    );
    const reports = userId ? await queryOne<RowDataPacket>(pool, `SELECT COUNT(*) AS total, MAX(activity_date) AS latest FROM farm_daily_reports WHERE submitted_by = ?`, [userId]) : null;
    const total = num(activities?.total);
    result.push({
      employeeId: Number(row.employee_id), userId, name: `${row.first_name} ${row.last_name}`, employeeNumber: String(row.employee_number), phone: text(row.phone),
      farms: text(row.farms), farmCount: num(row.farm_count), responsibilities: text(row.responsibilities), workers: num(workers?.total),
      activitiesTotal: total, activitiesCompleted: num(activities?.completed), outstanding: num(activities?.outstanding), overdue: num(activities?.overdue),
      completionRate: total ? Math.round((num(activities?.completed) / total) * 1000) / 10 : null,
      reportsSubmitted: num(reports?.total), latestReport: text(reports?.latest),
    });
  }
  return result;
}

export async function addTeamMember(auth: AuthContext, farmId: number, input: { employeeId: number; teamRole: 'supervisor' | 'worker' | 'operator'; responsibilities?: string | null; startDate?: string }, actor: Actor) {
  requireFarmPermission(auth, 'farm.assign');
  return withTransaction(async (connection) => {
    await assertFarmInScope(auth, farmId, connection);
    const employee = await queryOne<RowDataPacket>(connection, `SELECT id FROM employees WHERE id = ? AND deleted_at IS NULL AND employment_status IN ('active', 'probation')`, [input.employeeId]);
    if (!employee) throw new HttpError(422, 'Choose an active employee.', 'INVALID_EMPLOYEE');
    const existing = await queryOne<RowDataPacket>(connection, `SELECT id FROM farm_team_members WHERE farm_id = ? AND employee_id = ? AND end_date IS NULL`, [farmId, input.employeeId]);
    if (existing) throw new HttpError(409, 'This employee is already on the farm team.', 'DUPLICATE_MEMBER');
    const result = await execute(connection, `INSERT INTO farm_team_members (farm_id, employee_id, team_role, responsibilities, start_date, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [farmId, input.employeeId, input.teamRole, input.responsibilities ?? null, input.startDate ?? todayIso(), auth.userId]);
    if (input.teamRole === 'supervisor') {
      await execute(connection, 'UPDATE farms SET supervisor_employee_id = COALESCE(supervisor_employee_id, ?) WHERE id = ?', [input.employeeId, farmId]);
    }
    await audit(connection, actor, 'farm.team.add', 'farm_team_member', result.insertId, { farmId, ...input });
    return { id: result.insertId };
  });
}

export async function endTeamMember(auth: AuthContext, id: number, actor: Actor) {
  requireFarmPermission(auth, 'farm.assign');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_team_members WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Team member');
    await assertFarmInScope(auth, Number(row.farm_id), connection);
    await execute(connection, 'UPDATE farm_team_members SET end_date = CURRENT_DATE WHERE id = ?', [id]);
    await execute(connection, 'UPDATE farms SET supervisor_employee_id = NULL WHERE id = ? AND supervisor_employee_id = ? AND ? = \'supervisor\'', [row.farm_id, row.employee_id, row.team_role]);
    await audit(connection, actor, 'farm.team.end', 'farm_team_member', id, { endDate: todayIso() }, { endDate: null });
    return { id };
  });
}

// ---------------------------------------------------------------- crop production

function mapCycle(row: RowDataPacket) {
  const harvested = num(row.harvested_kg);
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name),
    crop: String(row.crop), variety: text(row.variety), season: String(row.season), areaHa: num(row.area_ha),
    plantingDate: text(row.planting_date), expectedHarvestDate: text(row.expected_harvest_date), stage: String(row.stage),
    expectedYieldKg: optionalNumber(row.expected_yield_kg), status: String(row.status), notes: text(row.notes), harvestedKg: harvested,
    yieldPerHa: num(row.area_ha) > 0 ? Math.round((harvested / num(row.area_ha)) * 10) / 10 : null,
  };
}

export async function listCropCycles(auth: AuthContext, filters: { farmId?: number; crop?: string; season?: string; status?: string }) {
  const scope = scopeSql(await farmScope(auth), 'c.farm_id');
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.farmId) { where.push('c.farm_id = ?'); params.push(filters.farmId); }
  if (filters.crop) { where.push('LOWER(c.crop) = LOWER(?)'); params.push(filters.crop); }
  if (filters.season) { where.push('c.season = ?'); params.push(filters.season); }
  if (filters.status) { where.push('c.status = ?'); params.push(filters.status); }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT c.*, f.name AS farm_name,
            (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h WHERE h.crop_cycle_id = c.id AND h.status = 'verified') AS harvested_kg
     FROM farm_crop_cycles c JOIN farms f ON f.id = c.farm_id
     WHERE ${where.join(' AND ')} ORDER BY c.status, c.expected_harvest_date NULLS LAST, c.id DESC`,
    params,
  );
  return rows.map(mapCycle);
}

export async function saveCropCycle(auth: AuthContext, id: number | null, input: {
  farmId: number; crop: string; variety?: string | null; season: string; areaHa: number; plantingDate?: string | null; expectedHarvestDate?: string | null;
  stage?: string; expectedYieldKg?: number | null; status?: string; notes?: string | null;
}, actor: Actor) {
  requireFarmPermission(auth, 'farm.manage');
  return withTransaction(async (connection) => {
    const farm = await assertFarmInScope(auth, input.farmId, connection);
    if (input.areaHa > num(farm.total_area_ha) && num(farm.total_area_ha) > 0) {
      throw new HttpError(422, `The crop area is larger than the farm's ${num(farm.total_area_ha)} ha.`, 'INVALID_AREA');
    }
    if (input.plantingDate && input.expectedHarvestDate && input.expectedHarvestDate < input.plantingDate) {
      throw new HttpError(422, 'The expected harvest is before planting.', 'INVALID_DATES');
    }
    if (id == null) {
      const companyId = await requireCompanyId(connection);
      const reference = await farmReference(connection, 'farm_crop_cycle');
      const result = await execute(
        connection,
        `INSERT INTO farm_crop_cycles (company_id, reference_number, farm_id, crop, variety, season, area_ha, planting_date, expected_harvest_date, stage, expected_yield_kg, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, reference, input.farmId, input.crop, input.variety ?? null, input.season, input.areaHa, input.plantingDate ?? null, input.expectedHarvestDate ?? null,
          input.stage ?? 'planned', input.expectedYieldKg ?? null, input.status ?? 'active', input.notes ?? null, auth.userId],
      );
      await audit(connection, actor, 'farm.crop_cycle.create', 'farm_crop_cycle', result.insertId, { reference, ...input });
      return { id: result.insertId, referenceNumber: reference };
    }
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_crop_cycles WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Crop production record');
    await execute(
      connection,
      `UPDATE farm_crop_cycles SET farm_id = ?, crop = ?, variety = ?, season = ?, area_ha = ?, planting_date = ?, expected_harvest_date = ?, stage = ?, expected_yield_kg = ?, status = ?, notes = ?, updated_by = ? WHERE id = ?`,
      [input.farmId, input.crop, input.variety ?? null, input.season, input.areaHa, input.plantingDate ?? null, input.expectedHarvestDate ?? null,
        input.stage ?? row.stage, input.expectedYieldKg ?? null, input.status ?? row.status, input.notes ?? null, auth.userId, id],
    );
    await audit(connection, actor, 'farm.crop_cycle.update', 'farm_crop_cycle', id, input, {
      crop: row.crop, season: row.season, areaHa: num(row.area_ha), stage: row.stage, status: row.status, expectedHarvestDate: row.expected_harvest_date,
    });
    return { id, referenceNumber: String(row.reference_number) };
  });
}

// ---------------------------------------------------------------- activity schedule

const activitySelect = `
  SELECT a.*, f.name AS farm_name, c.crop, ${personName('a')} AS assignee_name
  FROM farm_activities a
  JOIN farms f ON f.id = a.farm_id
  LEFT JOIN farm_crop_cycles c ON c.id = a.crop_cycle_id
  LEFT JOIN users au ON au.id = a.assigned_user_id
  LEFT JOIN employees ae ON ae.id = au.employee_id
`;

function mapActivity(row: RowDataPacket) {
  const open = ['planned', 'in_progress'].includes(String(row.status));
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name),
    cropCycleId: optionalNumber(row.crop_cycle_id), crop: text(row.crop), activityType: String(row.activity_type), title: String(row.title),
    scheduledDate: String(row.scheduled_date), dueDate: String(row.due_date), assignedUserId: optionalNumber(row.assigned_user_id),
    assigneeName: row.assigned_user_id == null ? null : text(row.assignee_name), status: String(row.status), completedOn: text(row.completed_on),
    overdue: open && String(row.due_date) < todayIso(), notes: text(row.notes), createdAt: row.created_at,
  };
}

export async function listActivities(auth: AuthContext, filters: { farmId?: number; from?: string; to?: string; status?: string; type?: string; overdue?: boolean }) {
  const scope = scopeSql(await farmScope(auth), 'a.farm_id');
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.farmId) { where.push('a.farm_id = ?'); params.push(filters.farmId); }
  if (filters.from) { where.push('a.due_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('a.scheduled_date <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('a.status = ?'); params.push(filters.status); }
  if (filters.type) { where.push('a.activity_type = ?'); params.push(filters.type); }
  if (filters.overdue) where.push(`a.status IN ('planned', 'in_progress') AND a.due_date < CURRENT_DATE`);
  const rows = await query<RowDataPacket[]>(pool, `${activitySelect} WHERE ${where.join(' AND ')} ORDER BY a.scheduled_date, a.id LIMIT 1000`, params);
  return rows.map(mapActivity);
}

export async function saveActivity(auth: AuthContext, id: number | null, input: {
  farmId: number; cropCycleId?: number | null; activityType: string; title: string; scheduledDate: string; dueDate: string;
  assignedUserId?: number | null; status?: 'planned' | 'in_progress' | 'completed' | 'cancelled'; notes?: string | null;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    await assertFarmInScope(auth, input.farmId, connection);
    if (input.dueDate < input.scheduledDate) throw new HttpError(422, 'The due date is before the scheduled date.', 'INVALID_DATES');
    if (input.cropCycleId) {
      const cycle = await queryOne<RowDataPacket>(connection, 'SELECT farm_id FROM farm_crop_cycles WHERE id = ?', [input.cropCycleId]);
      if (!cycle || Number(cycle.farm_id) !== input.farmId) throw new HttpError(422, 'The crop record belongs to another farm.', 'INVALID_CYCLE');
    }
    if (id == null) {
      requireFarmPermission(auth, 'farm.assign');
      const companyId = await requireCompanyId(connection);
      const reference = await farmReference(connection, 'farm_activity');
      const result = await execute(
        connection,
        `INSERT INTO farm_activities (company_id, reference_number, farm_id, crop_cycle_id, activity_type, title, scheduled_date, due_date, assigned_user_id, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, reference, input.farmId, input.cropCycleId ?? null, input.activityType, input.title, input.scheduledDate, input.dueDate,
          input.assignedUserId ?? null, input.status ?? 'planned', input.notes ?? null, auth.userId],
      );
      await audit(connection, actor, 'farm.activity.create', 'farm_activity', result.insertId, { reference, ...input });
      const recipients = input.assignedUserId ? [input.assignedUserId] : await farmSupervisorUsers(connection, input.farmId);
      await notifyUsers(connection, recipients.filter((user) => user !== auth.userId), {
        title: `Farm activity assigned: ${reference}`, body: `${input.title} — ${input.scheduledDate} to ${input.dueDate}`, type: 'farm.activity.assigned', entityType: 'farm_activity', entityId: result.insertId,
      });
      return { id: result.insertId, referenceNumber: reference };
    }
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_activities WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Activity');
    const rescheduling = input.scheduledDate !== String(row.scheduled_date) || input.dueDate !== String(row.due_date)
      || (input.assignedUserId ?? null) !== optionalNumber(row.assigned_user_id) || input.farmId !== Number(row.farm_id);
    if (rescheduling || !hasPermission(auth, 'farm.report')) requireFarmPermission(auth, 'farm.assign');
    const status = input.status ?? String(row.status);
    await execute(
      connection,
      `UPDATE farm_activities SET farm_id = ?, crop_cycle_id = ?, activity_type = ?, title = ?, scheduled_date = ?, due_date = ?, assigned_user_id = ?, status = ?,
         completed_on = ?, notes = ?, updated_by = ? WHERE id = ?`,
      [input.farmId, input.cropCycleId ?? null, input.activityType, input.title, input.scheduledDate, input.dueDate, input.assignedUserId ?? null, status,
        status === 'completed' ? (row.completed_on ?? todayIso()) : null, input.notes ?? null, auth.userId, id],
    );
    await audit(connection, actor, rescheduling ? 'farm.activity.reschedule' : 'farm.activity.update', 'farm_activity', id, input, {
      scheduledDate: row.scheduled_date, dueDate: row.due_date, assignedUserId: optionalNumber(row.assigned_user_id), status: row.status,
    });
    return { id, referenceNumber: String(row.reference_number) };
  });
}

// ---------------------------------------------------------------- daily activity reports

const dailySelect = `
  SELECT r.*, f.name AS farm_name, a.reference_number AS activity_reference, ${personName('s')} AS submitter_name, ${personName('v')} AS reviewer_name,
         (SELECT COUNT(*) FROM supporting_documents d WHERE d.entity_type = 'farm_daily_report' AND d.entity_id = r.id) AS attachments
  FROM farm_daily_reports r
  JOIN farms f ON f.id = r.farm_id
  LEFT JOIN farm_activities a ON a.id = r.activity_id
  JOIN users su ON su.id = r.submitted_by
  LEFT JOIN employees se ON se.id = su.employee_id
  LEFT JOIN users vu ON vu.id = r.reviewed_by
  LEFT JOIN employees ve ON ve.id = vu.employee_id
`;

function mapDaily(row: RowDataPacket) {
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name),
    activityId: optionalNumber(row.activity_id), activityReference: text(row.activity_reference), activityDate: String(row.activity_date),
    activityType: String(row.activity_type), workPerformed: String(row.work_performed), workersCount: num(row.workers_count), workerNames: text(row.worker_names),
    resourcesUsed: text(row.resources_used), workCompleted: text(row.work_completed), areaCoveredHa: optionalNumber(row.area_covered_ha),
    challenges: text(row.challenges), supervisorRemarks: text(row.supervisor_remarks), status: String(row.status),
    submittedBy: String(row.submitter_name), submittedByUserId: Number(row.submitted_by), submittedAt: row.submitted_at, createdAt: row.created_at,
    reviewedBy: row.reviewed_by == null ? null : text(row.reviewer_name), reviewedAt: row.reviewed_at, reviewRemarks: text(row.review_remarks),
    attachments: num(row.attachments),
  };
}

export async function listDailyReports(auth: AuthContext, filters: { farmId?: number; from?: string; to?: string; status?: string; submittedBy?: number; search?: string }) {
  const scope = scopeSql(await farmScope(auth), 'r.farm_id');
  const where = [`(${scope.sql} OR r.submitted_by = ?)`];
  const params = [...scope.params, auth.userId];
  if (filters.farmId) { where.push('r.farm_id = ?'); params.push(filters.farmId); }
  if (filters.from) { where.push('r.activity_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('r.activity_date <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
  if (filters.submittedBy) { where.push('r.submitted_by = ?'); params.push(filters.submittedBy); }
  if (filters.search) { where.push(`(r.work_performed ILIKE ? OR r.reference_number ILIKE ?)`); params.push(like(filters.search), like(filters.search)); }
  const rows = await query<RowDataPacket[]>(pool, `${dailySelect} WHERE ${where.join(' AND ')} ORDER BY r.activity_date DESC, r.id DESC LIMIT 1000`, params);
  return rows.map(mapDaily);
}

export interface DailyInput {
  farmId: number; activityId?: number | null; activityDate: string; activityType: string; workPerformed: string; workersCount: number;
  workerNames?: string | null; resourcesUsed?: string | null; workCompleted?: string | null; areaCoveredHa?: number | null;
  challenges?: string | null; supervisorRemarks?: string | null; markActivityCompleted?: boolean;
}

export async function submitDailyReport(auth: AuthContext, input: DailyInput, actor: Actor) {
  requireFarmPermission(auth, 'farm.report');
  if (input.activityDate > todayIso()) throw new HttpError(422, 'A daily report cannot be dated in the future.', 'INVALID_DATE');
  return withTransaction(async (connection) => {
    const farm = await assertFarmInScope(auth, input.farmId, connection);
    if (input.activityId) {
      const activity = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_activities WHERE id = ? FOR UPDATE', [input.activityId]);
      if (!activity || Number(activity.farm_id) !== input.farmId) throw new HttpError(422, 'That activity belongs to another farm.', 'INVALID_ACTIVITY');
      const next = input.markActivityCompleted ? 'completed' : activity.status === 'planned' ? 'in_progress' : String(activity.status);
      if (next !== activity.status) {
        await execute(connection, 'UPDATE farm_activities SET status = ?, completed_on = ?, updated_by = ? WHERE id = ?',
          [next, next === 'completed' ? input.activityDate : null, auth.userId, input.activityId]);
      }
    }
    const companyId = await requireCompanyId(connection);
    const reference = await farmReference(connection, 'farm_daily_report');
    const result = await execute(
      connection,
      `INSERT INTO farm_daily_reports (company_id, reference_number, farm_id, activity_id, activity_date, activity_type, work_performed, workers_count, worker_names,
         resources_used, work_completed, area_covered_ha, challenges, supervisor_remarks, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [companyId, reference, input.farmId, input.activityId ?? null, input.activityDate, input.activityType, input.workPerformed, input.workersCount, input.workerNames ?? null,
        input.resourcesUsed ?? null, input.workCompleted ?? null, input.areaCoveredHa ?? null, input.challenges ?? null, input.supervisorRemarks ?? null, auth.userId],
    );
    await audit(connection, actor, 'farm.daily_report.submit', 'farm_daily_report', result.insertId, { reference, farmId: input.farmId, activityDate: input.activityDate, backdated: input.activityDate < todayIso() });
    await notifyFarmManagers(connection, {
      title: `Daily farm report: ${farm.name}`, body: `${reference} for ${input.activityDate}: ${input.workPerformed.slice(0, 200)}`,
      type: 'farm.daily_report.submitted', entityType: 'farm_daily_report', entityId: result.insertId, excludeUserId: auth.userId,
    });
    return mapDaily((await queryOne<RowDataPacket>(connection, `${dailySelect} WHERE r.id = ?`, [result.insertId]))!);
  });
}

export async function resubmitDailyReport(auth: AuthContext, id: number, input: DailyInput, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_daily_reports WHERE id = ? FOR UPDATE', [id]);
    if (!row || Number(row.submitted_by) !== auth.userId) throw notFound('Daily report');
    if (row.status !== 'returned') throw new HttpError(409, 'Only a report returned for correction can be changed.', 'NOT_RETURNED');
    await assertFarmInScope(auth, input.farmId, connection);
    await execute(
      connection,
      `UPDATE farm_daily_reports SET farm_id = ?, activity_id = ?, activity_date = ?, activity_type = ?, work_performed = ?, workers_count = ?, worker_names = ?,
         resources_used = ?, work_completed = ?, area_covered_ha = ?, challenges = ?, supervisor_remarks = ?, status = 'submitted', submitted_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [input.farmId, input.activityId ?? null, input.activityDate, input.activityType, input.workPerformed, input.workersCount, input.workerNames ?? null,
        input.resourcesUsed ?? null, input.workCompleted ?? null, input.areaCoveredHa ?? null, input.challenges ?? null, input.supervisorRemarks ?? null, id],
    );
    await audit(connection, actor, 'farm.daily_report.resubmit', 'farm_daily_report', id, input, { workPerformed: row.work_performed, workersCount: num(row.workers_count), activityDate: row.activity_date });
    await notifyFarmManagers(connection, {
      title: `Corrected daily report: ${row.reference_number}`, body: input.workPerformed.slice(0, 200),
      type: 'farm.daily_report.submitted', entityType: 'farm_daily_report', entityId: id, excludeUserId: auth.userId,
    });
    return mapDaily((await queryOne<RowDataPacket>(connection, `${dailySelect} WHERE r.id = ?`, [id]))!);
  });
}

export async function reviewDailyReport(auth: AuthContext, id: number, input: { action: 'acknowledge' | 'return'; remarks?: string }, actor: Actor) {
  requireFarmPermission(auth, 'farm.review');
  const remarks = input.remarks?.trim() ?? '';
  if (input.action === 'return' && remarks.length < 8) throw new HttpError(422, 'Say what needs correcting (at least 8 characters).', 'REASON_REQUIRED');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_daily_reports WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Daily report');
    await assertFarmInScope(auth, Number(row.farm_id), connection);
    if (Number(row.submitted_by) === auth.userId) throw new HttpError(403, 'You cannot review your own report.', 'SEGREGATION_DENIED');
    if (row.status !== 'submitted') throw new HttpError(409, 'This report has already been reviewed.', 'NOT_SUBMITTED');
    const status = input.action === 'acknowledge' ? 'acknowledged' : 'returned';
    await execute(connection, 'UPDATE farm_daily_reports SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3), review_remarks = ? WHERE id = ?', [status, auth.userId, remarks || null, id]);
    await audit(connection, actor, `farm.daily_report.${input.action}`, 'farm_daily_report', id, { status, remarks: remarks || null }, { status: row.status });
    await notifyUsers(connection, [Number(row.submitted_by)], {
      title: `Daily report ${status}: ${row.reference_number}`, body: remarks || 'Acknowledged by the Operations Manager.', type: `farm.daily_report.${status}`, entityType: 'farm_daily_report', entityId: id,
    });
    return mapDaily((await queryOne<RowDataPacket>(connection, `${dailySelect} WHERE r.id = ?`, [id]))!);
  });
}

// ---------------------------------------------------------------- inspections

export async function listInspections(auth: AuthContext, filters: { farmId?: number; from?: string; to?: string; status?: string }) {
  const scope = scopeSql(await farmScope(auth), 'i.farm_id');
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.farmId) { where.push('i.farm_id = ?'); params.push(filters.farmId); }
  if (filters.from) { where.push('i.inspection_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('i.inspection_date <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('i.status = ?'); params.push(filters.status); }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT i.*, f.name AS farm_name, c.crop, ${personName('n')} AS inspector_name
     FROM farm_inspections i JOIN farms f ON f.id = i.farm_id LEFT JOIN farm_crop_cycles c ON c.id = i.crop_cycle_id
     JOIN users nu ON nu.id = i.inspector_user_id LEFT JOIN employees ne ON ne.id = nu.employee_id
     WHERE ${where.join(' AND ')} ORDER BY i.inspection_date DESC, i.id DESC LIMIT 1000`,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name), crop: text(row.crop),
    cropCycleId: optionalNumber(row.crop_cycle_id), inspectionDate: String(row.inspection_date), inspectionType: String(row.inspection_type),
    rating: optionalNumber(row.rating), findings: String(row.findings), recommendations: text(row.recommendations), followUpDate: text(row.follow_up_date),
    status: String(row.status), inspector: String(row.inspector_name), createdAt: row.created_at,
  }));
}

export async function saveInspection(auth: AuthContext, id: number | null, input: {
  farmId: number; cropCycleId?: number | null; inspectionDate: string; inspectionType: string; rating?: number | null; findings: string;
  recommendations?: string | null; followUpDate?: string | null; status?: 'open' | 'follow_up' | 'closed';
}, actor: Actor) {
  requireFarmPermission(auth, 'farm.review');
  return withTransaction(async (connection) => {
    await assertFarmInScope(auth, input.farmId, connection);
    if (id == null) {
      const companyId = await requireCompanyId(connection);
      const reference = await farmReference(connection, 'farm_inspection');
      const result = await execute(
        connection,
        `INSERT INTO farm_inspections (company_id, reference_number, farm_id, crop_cycle_id, inspection_date, inspection_type, rating, findings, recommendations, follow_up_date, status, inspector_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, reference, input.farmId, input.cropCycleId ?? null, input.inspectionDate, input.inspectionType, input.rating ?? null, input.findings,
          input.recommendations ?? null, input.followUpDate ?? null, input.status ?? (input.followUpDate ? 'follow_up' : 'open'), auth.userId],
      );
      await audit(connection, actor, 'farm.inspection.create', 'farm_inspection', result.insertId, { reference, ...input });
      await notifyUsers(connection, (await farmSupervisorUsers(connection, input.farmId)).filter((user) => user !== auth.userId), {
        title: `Farm inspection: ${reference}`, body: input.findings.slice(0, 200), type: 'farm.inspection', entityType: 'farm_inspection', entityId: result.insertId,
      });
      return { id: result.insertId, referenceNumber: reference };
    }
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_inspections WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Inspection');
    const status = input.status ?? String(row.status);
    await execute(
      connection,
      `UPDATE farm_inspections SET crop_cycle_id = ?, inspection_date = ?, inspection_type = ?, rating = ?, findings = ?, recommendations = ?, follow_up_date = ?, status = ?,
         closed_by = ?, closed_at = ? WHERE id = ?`,
      [input.cropCycleId ?? null, input.inspectionDate, input.inspectionType, input.rating ?? null, input.findings, input.recommendations ?? null, input.followUpDate ?? null, status,
        status === 'closed' ? auth.userId : null, status === 'closed' ? new Date().toISOString() : null, id],
    );
    await audit(connection, actor, 'farm.inspection.update', 'farm_inspection', id, input, { status: row.status, findings: row.findings, rating: optionalNumber(row.rating) });
    return { id, referenceNumber: String(row.reference_number) };
  });
}

// ---------------------------------------------------------------- production targets

/** Actual production is the verified harvest of that crop on that farm inside the target period. */
export async function listTargets(auth: AuthContext, filters: { farmId?: number; crop?: string; season?: string }) {
  const scope = scopeSql(await farmScope(auth), 't.farm_id');
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.farmId) { where.push('t.farm_id = ?'); params.push(filters.farmId); }
  if (filters.crop) { where.push('LOWER(t.crop) = LOWER(?)'); params.push(filters.crop); }
  if (filters.season) { where.push('t.season = ?'); params.push(filters.season); }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT t.*, f.name AS farm_name,
            (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h
              WHERE h.farm_id = t.farm_id AND LOWER(h.crop) = LOWER(t.crop) AND h.status = 'verified' AND h.harvest_date BETWEEN t.period_start AND t.period_end) AS actual_kg
     FROM farm_production_targets t JOIN farms f ON f.id = t.farm_id
     WHERE ${where.join(' AND ')} ORDER BY t.season DESC, f.name, t.crop`,
    params,
  );
  const today = todayIso();
  return rows.map((row) => {
    const target = num(row.target_kg);
    const actual = num(row.actual_kg);
    const start = new Date(`${row.period_start}T00:00:00Z`).getTime();
    const end = new Date(`${row.period_end}T00:00:00Z`).getTime();
    const now = new Date(`${today}T00:00:00Z`).getTime();
    const elapsed = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
    const achievement = target > 0 ? Math.round((actual / target) * 1000) / 10 : 0;
    return {
      id: Number(row.id), farmId: Number(row.farm_id), farmName: String(row.farm_name), crop: String(row.crop), season: String(row.season),
      periodStart: String(row.period_start), periodEnd: String(row.period_end), targetKg: target, actualKg: actual, achievement,
      expectedByNow: Math.round(elapsed * 1000) / 10,
      underperforming: elapsed > 0.25 && achievement < elapsed * 100 * 0.8,
      notes: text(row.notes),
    };
  });
}

export async function saveTarget(auth: AuthContext, id: number | null, input: { farmId: number; crop: string; season: string; periodStart: string; periodEnd: string; targetKg: number; notes?: string | null }, actor: Actor) {
  requireFarmPermission(auth, 'farm.manage');
  if (input.periodEnd < input.periodStart) throw new HttpError(422, 'The period ends before it starts.', 'INVALID_PERIOD');
  return withTransaction(async (connection) => {
    await assertFarmInScope(auth, input.farmId, connection);
    if (id == null) {
      const companyId = await requireCompanyId(connection);
      const result = await execute(
        connection,
        `INSERT INTO farm_production_targets (company_id, farm_id, crop, season, period_start, period_end, target_kg, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, input.farmId, input.crop, input.season, input.periodStart, input.periodEnd, input.targetKg, input.notes ?? null, auth.userId],
      );
      await audit(connection, actor, 'farm.target.create', 'farm_production_target', result.insertId, input);
      return { id: result.insertId };
    }
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_production_targets WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Production target');
    await execute(connection, `UPDATE farm_production_targets SET farm_id = ?, crop = ?, season = ?, period_start = ?, period_end = ?, target_kg = ?, notes = ?, updated_by = ? WHERE id = ?`,
      [input.farmId, input.crop, input.season, input.periodStart, input.periodEnd, input.targetKg, input.notes ?? null, auth.userId, id]);
    await audit(connection, actor, 'farm.target.update', 'farm_production_target', id, input, { targetKg: num(row.target_kg), periodStart: row.period_start, periodEnd: row.period_end });
    return { id };
  });
}

// ---------------------------------------------------------------- harvests and produce stock

const harvestSelect = `
  SELECT h.*, f.name AS farm_name, i.name AS item_name, i.unit AS item_unit, w.name AS warehouse_name, m.reference_number AS movement_reference,
         ${personName('r')} AS recorder_name, ${personName('v')} AS verifier_name
  FROM farm_harvests h
  JOIN farms f ON f.id = h.farm_id
  LEFT JOIN stock_items i ON i.id = h.stock_item_id
  LEFT JOIN warehouses w ON w.id = h.warehouse_id
  LEFT JOIN stock_movements m ON m.id = h.stock_movement_id
  JOIN users ru ON ru.id = h.recorded_by
  LEFT JOIN employees re ON re.id = ru.employee_id
  LEFT JOIN users vu ON vu.id = h.verified_by
  LEFT JOIN employees ve ON ve.id = vu.employee_id
`;

function mapHarvest(row: RowDataPacket) {
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name),
    cropCycleId: optionalNumber(row.crop_cycle_id), crop: String(row.crop), season: String(row.season), harvestDate: String(row.harvest_date),
    expectedKg: optionalNumber(row.expected_kg), quantityKg: num(row.quantity_kg), lossKg: num(row.loss_kg), grade: text(row.grade),
    moisturePercent: optionalNumber(row.moisture_percent), qualityNotes: text(row.quality_notes), status: String(row.status),
    stockItemId: optionalNumber(row.stock_item_id), itemName: text(row.item_name), warehouseId: optionalNumber(row.warehouse_id), warehouseName: text(row.warehouse_name),
    movementReference: text(row.movement_reference), recordedBy: String(row.recorder_name), verifiedBy: row.verified_by == null ? null : text(row.verifier_name),
    verifiedAt: row.verified_at, rejectionReason: text(row.rejection_reason), createdAt: row.created_at,
  };
}

export async function listHarvests(auth: AuthContext, filters: { farmId?: number; from?: string; to?: string; status?: string; crop?: string; season?: string }) {
  const scope = scopeSql(await farmScope(auth), 'h.farm_id');
  const where = [scope.sql];
  const params = [...scope.params];
  if (filters.farmId) { where.push('h.farm_id = ?'); params.push(filters.farmId); }
  if (filters.from) { where.push('h.harvest_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('h.harvest_date <= ?'); params.push(filters.to); }
  if (filters.status) { where.push('h.status = ?'); params.push(filters.status); }
  if (filters.crop) { where.push('LOWER(h.crop) = LOWER(?)'); params.push(filters.crop); }
  if (filters.season) { where.push('h.season = ?'); params.push(filters.season); }
  const rows = await query<RowDataPacket[]>(pool, `${harvestSelect} WHERE ${where.join(' AND ')} ORDER BY h.harvest_date DESC, h.id DESC LIMIT 1000`, params);
  return rows.map(mapHarvest);
}

export async function recordHarvest(auth: AuthContext, input: {
  farmId: number; cropCycleId?: number | null; crop?: string; season?: string; harvestDate: string; expectedKg?: number | null; quantityKg: number; lossKg?: number;
  grade?: string | null; moisturePercent?: number | null; qualityNotes?: string | null; stockItemId?: number | null; warehouseId?: number | null;
}, actor: Actor) {
  requireFarmPermission(auth, 'farm.report');
  if (input.harvestDate > todayIso()) throw new HttpError(422, 'A harvest cannot be dated in the future.', 'INVALID_DATE');
  return withTransaction(async (connection) => {
    const farm = await assertFarmInScope(auth, input.farmId, connection);
    let crop = input.crop;
    let season = input.season;
    const expected = input.expectedKg ?? null;
    if (input.cropCycleId) {
      const cycle = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_crop_cycles WHERE id = ?', [input.cropCycleId]);
      if (!cycle || Number(cycle.farm_id) !== input.farmId) throw new HttpError(422, 'The crop record belongs to another farm.', 'INVALID_CYCLE');
      crop = crop || String(cycle.crop);
      season = season || String(cycle.season);
    }
    if (!crop || !season) throw new HttpError(422, 'Give the crop and season, or choose the crop record.', 'CROP_REQUIRED');
    const companyId = await requireCompanyId(connection);
    if (input.stockItemId) await activeItem(connection, companyId, input.stockItemId);
    if (input.warehouseId) await activeWarehouse(connection, companyId, input.warehouseId);
    const reference = await farmReference(connection, 'farm_harvest');
    const result = await execute(
      connection,
      `INSERT INTO farm_harvests (company_id, reference_number, farm_id, crop_cycle_id, crop, season, harvest_date, expected_kg, quantity_kg, loss_kg, grade, moisture_percent,
         quality_notes, stock_item_id, warehouse_id, status, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?)`,
      [companyId, reference, input.farmId, input.cropCycleId ?? null, crop, season, input.harvestDate, expected, input.quantityKg, input.lossKg ?? 0,
        input.grade ?? null, input.moisturePercent ?? null, input.qualityNotes ?? null, input.stockItemId ?? null, input.warehouseId ?? farm.warehouse_id ?? null, auth.userId],
    );
    if (input.cropCycleId) await execute(connection, `UPDATE farm_crop_cycles SET stage = 'harvesting' WHERE id = ? AND stage NOT IN ('harvesting', 'completed')`, [input.cropCycleId]);
    await audit(connection, actor, 'farm.harvest.record', 'farm_harvest', result.insertId, { reference, ...input, crop, season });
    await notifyFarmManagers(connection, {
      title: `Harvest to verify: ${reference}`, body: `${farm.name}: ${input.quantityKg} kg of ${crop} on ${input.harvestDate}.`,
      type: 'farm.harvest.recorded', entityType: 'farm_harvest', entityId: result.insertId, excludeUserId: auth.userId,
    });
    return mapHarvest((await queryOne<RowDataPacket>(connection, `${harvestSelect} WHERE h.id = ?`, [result.insertId]))!);
  });
}

/**
 * Verifying a harvest receives it into produce stock in the same transaction. The harvest row is locked,
 * can be verified once, and the receipt is unique per harvest, so the quantity cannot be counted twice.
 */
export async function verifyHarvest(auth: AuthContext, id: number, input: { stockItemId?: number | null; warehouseId?: number | null; unitCost?: number }, actor: Actor) {
  requireFarmPermission(auth, 'farm.review');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_harvests WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Harvest');
    await assertFarmInScope(auth, Number(row.farm_id), connection);
    if (row.status !== 'recorded') throw new HttpError(409, 'This harvest has already been verified or rejected.', 'ALREADY_DECIDED');
    if (Number(row.recorded_by) === auth.userId) throw new HttpError(403, 'Someone other than the person who recorded the harvest must verify it.', 'SEGREGATION_DENIED');
    const companyId = Number(row.company_id);
    const itemId = input.stockItemId ?? optionalNumber(row.stock_item_id);
    const warehouseId = input.warehouseId ?? optionalNumber(row.warehouse_id);
    if (!itemId || !warehouseId) throw new HttpError(422, 'Choose the produce stock item and the store that receives this harvest.', 'STOCK_TARGET_REQUIRED');
    const item = await activeItem(connection, companyId, itemId);
    await activeWarehouse(connection, companyId, warehouseId);
    const category = await queryOne<RowDataPacket>(connection, `SELECT c.name FROM stock_items i LEFT JOIN stock_categories c ON c.id = i.category_id WHERE i.id = ?`, [itemId]);
    if (String(category?.name ?? '') !== PRODUCE_CATEGORY) throw new HttpError(422, `Choose a stock item in the “${PRODUCE_CATEGORY}” category.`, 'NOT_PRODUCE');
    const reference = await nextReference(connection, 'stock_movement', 'stock_movement_prefix');
    await changeStock(connection, {
      companyId, warehouseId, itemId, quantity: num(row.quantity_kg), direction: 'in', movementType: 'receipt', unitCost: input.unitCost ?? 0,
      lotCode: String(row.reference_number), sourceType: 'farm_harvest', sourceId: id,
      notes: `Harvest ${row.reference_number} (${row.crop}${row.grade ? `, grade ${row.grade}` : ''})`, userId: auth.userId, reference,
    });
    const movement = await queryOne<RowDataPacket>(connection, `SELECT id FROM stock_movements WHERE source_type = 'farm_harvest' AND source_id = ? AND movement_type = 'receipt'`, [id]);
    await execute(connection, 'UPDATE stock_movements SET farm_id = ? WHERE id = ?', [row.farm_id, movement!.id]);
    await execute(
      connection,
      `UPDATE farm_harvests SET status = 'verified', verified_by = ?, verified_at = UTC_TIMESTAMP(3), stock_item_id = ?, warehouse_id = ?, stock_movement_id = ? WHERE id = ?`,
      [auth.userId, itemId, warehouseId, movement!.id, id],
    );
    await audit(connection, actor, 'farm.harvest.verify', 'farm_harvest', id, { status: 'verified', stockMovement: reference, itemId, warehouseId, quantityKg: num(row.quantity_kg) }, { status: 'recorded' });
    await notifyFarmManagers(connection, {
      title: `Produce ready for dispatch: ${row.reference_number}`, body: `${num(row.quantity_kg)} ${item.unit} of ${item.name} is in store.`,
      type: 'farm.produce.ready', entityType: 'farm_harvest', entityId: id, permission: 'farm.approve',
    });
    await notifyUsers(connection, [Number(row.recorded_by)], {
      title: `Harvest verified: ${row.reference_number}`, body: `Received into stock as ${reference}.`, type: 'farm.harvest.verified', entityType: 'farm_harvest', entityId: id,
    });
    return mapHarvest((await queryOne<RowDataPacket>(connection, `${harvestSelect} WHERE h.id = ?`, [id]))!);
  });
}

export async function rejectHarvest(auth: AuthContext, id: number, reason: string, actor: Actor) {
  requireFarmPermission(auth, 'farm.review');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_harvests WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Harvest');
    await assertFarmInScope(auth, Number(row.farm_id), connection);
    if (row.status !== 'recorded') throw new HttpError(409, 'This harvest has already been verified or rejected.', 'ALREADY_DECIDED');
    await execute(connection, `UPDATE farm_harvests SET status = 'rejected', verified_by = ?, verified_at = UTC_TIMESTAMP(3), rejection_reason = ? WHERE id = ?`, [auth.userId, reason, id]);
    await audit(connection, actor, 'farm.harvest.reject', 'farm_harvest', id, { status: 'rejected', reason }, { status: 'recorded' });
    await notifyUsers(connection, [Number(row.recorded_by)], {
      title: `Harvest not accepted: ${row.reference_number}`, body: reason, type: 'farm.harvest.rejected', entityType: 'farm_harvest', entityId: id,
    });
    return mapHarvest((await queryOne<RowDataPacket>(connection, `${harvestSelect} WHERE h.id = ?`, [id]))!);
  });
}

/** Yield per hectare by farm, crop, and season, from verified harvests and the area under each crop. */
export async function yieldPerformance(auth: AuthContext, filters: { farmId?: number; crop?: string; season?: string }) {
  const scope = scopeSql(await farmScope(auth), 'c.farm_id');
  const where = [scope.sql, `c.status <> 'abandoned'`];
  const params = [...scope.params];
  if (filters.farmId) { where.push('c.farm_id = ?'); params.push(filters.farmId); }
  if (filters.crop) { where.push('LOWER(c.crop) = LOWER(?)'); params.push(filters.crop); }
  if (filters.season) { where.push('c.season = ?'); params.push(filters.season); }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT f.id AS farm_id, f.name AS farm_name, c.crop, c.season, SUM(c.area_ha) AS area_ha, SUM(COALESCE(c.expected_yield_kg, 0)) AS expected_kg,
            (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h WHERE h.farm_id = f.id AND LOWER(h.crop) = LOWER(c.crop) AND h.season = c.season AND h.status = 'verified') AS harvested_kg,
            (SELECT COALESCE(SUM(h.loss_kg), 0) FROM farm_harvests h WHERE h.farm_id = f.id AND LOWER(h.crop) = LOWER(c.crop) AND h.season = c.season AND h.status = 'verified') AS loss_kg
     FROM farm_crop_cycles c JOIN farms f ON f.id = c.farm_id
     WHERE ${where.join(' AND ')}
     GROUP BY f.id, f.name, c.crop, c.season
     ORDER BY c.season DESC, f.name, c.crop`,
    params,
  );
  return rows.map((row) => {
    const area = num(row.area_ha);
    const harvested = num(row.harvested_kg);
    return {
      farmId: Number(row.farm_id), farmName: String(row.farm_name), crop: String(row.crop), season: String(row.season), areaHa: area,
      expectedKg: num(row.expected_kg), harvestedKg: harvested, lossKg: num(row.loss_kg),
      yieldPerHa: area > 0 ? Math.round((harvested / area) * 10) / 10 : null,
      yieldPerAcre: area > 0 ? Math.round((harvested / (area * 2.4710538)) * 10) / 10 : null,
      expectedPerHa: area > 0 && num(row.expected_kg) > 0 ? Math.round((num(row.expected_kg) / area) * 10) / 10 : null,
    };
  });
}

// ---------------------------------------------------------------- incidents

const incidentSelect = `
  SELECT i.*, f.name AS farm_name, ${personName('r')} AS reporter_name, ${personName('a')} AS assignee_name, ${personName('s')} AS resolver_name,
         (SELECT COUNT(*) FROM supporting_documents d WHERE d.entity_type = 'farm_incident' AND d.entity_id = i.id) AS attachments
  FROM farm_incidents i
  JOIN farms f ON f.id = i.farm_id
  JOIN users ru ON ru.id = i.reported_by
  LEFT JOIN employees re ON re.id = ru.employee_id
  LEFT JOIN users au ON au.id = i.assigned_to_user_id
  LEFT JOIN employees ae ON ae.id = au.employee_id
  LEFT JOIN users su ON su.id = i.resolved_by
  LEFT JOIN employees se ON se.id = su.employee_id
`;

function mapIncident(row: RowDataPacket) {
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name),
    category: String(row.category), title: String(row.title), description: String(row.description), priority: String(row.priority),
    occurredOn: String(row.occurred_on), reportedAt: row.created_at, status: String(row.status), reportedBy: String(row.reporter_name),
    reportedByUserId: Number(row.reported_by), assignedToUserId: optionalNumber(row.assigned_to_user_id),
    assignedTo: row.assigned_to_user_id == null ? null : text(row.assignee_name), resolutionRemarks: text(row.resolution_remarks),
    resolvedBy: row.resolved_by == null ? null : text(row.resolver_name), resolvedAt: row.resolved_at, attachments: num(row.attachments),
  };
}

export async function listIncidents(auth: AuthContext, filters: { farmId?: number; status?: string; priority?: string; category?: string; from?: string; to?: string; open?: boolean }) {
  const scope = scopeSql(await farmScope(auth), 'i.farm_id');
  const where = [`(${scope.sql} OR i.reported_by = ? OR i.assigned_to_user_id = ?)`];
  const params = [...scope.params, auth.userId, auth.userId];
  if (filters.farmId) { where.push('i.farm_id = ?'); params.push(filters.farmId); }
  if (filters.status) { where.push('i.status = ?'); params.push(filters.status); }
  if (filters.priority) { where.push('i.priority = ?'); params.push(filters.priority); }
  if (filters.category) { where.push('i.category = ?'); params.push(filters.category); }
  if (filters.from) { where.push('i.occurred_on >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('i.occurred_on <= ?'); params.push(filters.to); }
  if (filters.open) where.push(`i.status NOT IN ('resolved', 'closed')`);
  const rows = await query<RowDataPacket[]>(
    pool,
    `${incidentSelect} WHERE ${where.join(' AND ')}
     ORDER BY CASE i.status WHEN 'reported' THEN 0 WHEN 'investigating' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
              CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.id DESC LIMIT 1000`,
    params,
  );
  return rows.map(mapIncident);
}

export async function reportIncident(auth: AuthContext, input: { farmId: number; category: string; title: string; description: string; priority: string; occurredOn: string }, actor: Actor) {
  requireFarmPermission(auth, 'farm.report');
  if (input.occurredOn > todayIso()) throw new HttpError(422, 'An incident cannot be dated in the future.', 'INVALID_DATE');
  return withTransaction(async (connection) => {
    const farm = await assertFarmInScope(auth, input.farmId, connection);
    const companyId = await requireCompanyId(connection);
    const reference = await farmReference(connection, 'farm_incident');
    const result = await execute(
      connection,
      `INSERT INTO farm_incidents (company_id, reference_number, farm_id, category, title, description, priority, occurred_on, reported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.farmId, input.category, input.title, input.description, input.priority, input.occurredOn, auth.userId],
    );
    await audit(connection, actor, 'farm.incident.report', 'farm_incident', result.insertId, { reference, ...input });
    await notifyFarmManagers(connection, {
      title: `Farm incident (${input.priority}): ${farm.name}`, body: `${reference}: ${input.title}`, type: 'farm.incident.reported', entityType: 'farm_incident', entityId: result.insertId, excludeUserId: auth.userId,
    });
    return mapIncident((await queryOne<RowDataPacket>(connection, `${incidentSelect} WHERE i.id = ?`, [result.insertId]))!);
  });
}

export async function updateIncident(auth: AuthContext, id: number, input: { status?: string; assignedToUserId?: number | null; priority?: string; resolutionRemarks?: string | null }, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_incidents WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Incident');
    await assertFarmInScope(auth, Number(row.farm_id), connection);
    const assignee = Number(row.assigned_to_user_id) === auth.userId;
    if (!hasPermission(auth, 'farm.review') && !(assignee && hasPermission(auth, 'farm.report'))) {
      throw new HttpError(403, 'Only the Operations Manager or the person assigned can update this incident.', 'FORBIDDEN');
    }
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== optionalNumber(row.assigned_to_user_id)) requireFarmPermission(auth, 'farm.assign');
    const status = input.status ?? String(row.status);
    const resolving = ['resolved', 'closed'].includes(status) && !['resolved', 'closed'].includes(String(row.status));
    if (resolving && !(input.resolutionRemarks ?? row.resolution_remarks)) throw new HttpError(422, 'Record how the incident was resolved.', 'REMARKS_REQUIRED');
    if (status === 'closed') requireFarmPermission(auth, 'farm.review');
    await execute(
      connection,
      `UPDATE farm_incidents SET status = ?, assigned_to_user_id = ?, priority = ?, resolution_remarks = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
      [status, input.assignedToUserId === undefined ? row.assigned_to_user_id : input.assignedToUserId, input.priority ?? row.priority,
        input.resolutionRemarks === undefined ? row.resolution_remarks : input.resolutionRemarks,
        resolving ? auth.userId : row.resolved_by, resolving ? new Date().toISOString() : row.resolved_at, id],
    );
    await audit(connection, actor, 'farm.incident.update', 'farm_incident', id, input, {
      status: row.status, assignedToUserId: optionalNumber(row.assigned_to_user_id), priority: row.priority, resolutionRemarks: row.resolution_remarks,
    });
    if (input.assignedToUserId && input.assignedToUserId !== optionalNumber(row.assigned_to_user_id)) {
      await notifyUsers(connection, [input.assignedToUserId], { title: `Incident assigned to you: ${row.reference_number}`, body: String(row.title), type: 'farm.incident.assigned', entityType: 'farm_incident', entityId: id });
    }
    if (resolving) {
      await notifyUsers(connection, [Number(row.reported_by)].filter((user) => user !== auth.userId), { title: `Incident ${status}: ${row.reference_number}`, body: String(input.resolutionRemarks ?? row.resolution_remarks), type: 'farm.incident.resolved', entityType: 'farm_incident', entityId: id });
    }
    return mapIncident((await queryOne<RowDataPacket>(connection, `${incidentSelect} WHERE i.id = ?`, [id]))!);
  });
}

/** For separation-of-duty checks shared by dispatch. */
export { assertSegregation };
