import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne } from '../../database/query';
import type { Db } from '../../database/query';
import { hasFinalBusinessAuthority, hasPermission } from '../../services/access';
import { notifyUser, notifyUsersWithPermission } from '../../services/notify';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

export type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

export const activityTypes = ['land_preparation', 'planting', 'fertilisation', 'irrigation', 'weeding', 'pest_control', 'pruning', 'harvesting', 'equipment_servicing', 'inspection', 'other'] as const;
export const incidentCategories = ['crop_disease', 'pest_infestation', 'equipment_breakdown', 'labour_shortage', 'weather', 'damaged_produce', 'resource_shortage', 'safety', 'other'] as const;
export const requestCategories = ['seeds', 'fertiliser', 'pesticide', 'herbicide', 'irrigation', 'equipment', 'fuel', 'labour', 'other'] as const;

/** Stock categories that make up farm inputs, and the one that holds harvested produce. */
export const PRODUCE_CATEGORY = 'Farm produce';
export const inputCategories = ['Seeds', 'Fertilisers', 'Pesticides', 'Herbicides', 'Irrigation materials', 'Other farm inputs'];

export interface FarmScope {
  /** The Operations Manager, farm reviewers, and the CEO see every farm. */
  all: boolean;
  farmIds: number[];
}

/**
 * Farm supervisors see the farms they supervise (as the farm's supervisor or as an active team supervisor).
 * Anyone who manages or reviews farms, and the CEO, sees every farm.
 */
export async function farmScope(auth: AuthContext, db: Db = pool): Promise<FarmScope> {
  if (hasFinalBusinessAuthority(auth) || hasPermission(auth, 'farm.manage') || hasPermission(auth, 'farm.review')) {
    return { all: true, farmIds: [] };
  }
  if (!auth.employeeId) return { all: false, farmIds: [] };
  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT id FROM farms WHERE supervisor_employee_id = ?
     UNION
     SELECT farm_id AS id FROM farm_team_members
     WHERE employee_id = ? AND team_role = 'supervisor' AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
    [auth.employeeId, auth.employeeId],
  );
  return { all: false, farmIds: rows.map((row) => Number(row.id)) };
}

export function scopeSql(scope: FarmScope, column: string): { sql: string; params: unknown[] } {
  if (scope.all) return { sql: '1 = 1', params: [] };
  if (scope.farmIds.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${scope.farmIds.map(() => '?').join(', ')})`, params: [...scope.farmIds] };
}

export async function assertFarmInScope(auth: AuthContext, farmId: number, db: Db = pool): Promise<RowDataPacket> {
  const farm = await queryOne<RowDataPacket>(db, 'SELECT * FROM farms WHERE id = ?', [farmId]);
  if (!farm) throw notFound('Farm');
  const scope = await farmScope(auth, db);
  if (!scope.all && !scope.farmIds.includes(farmId)) {
    throw new HttpError(403, 'This farm is not one of yours.', 'SCOPE_DENIED');
  }
  return farm;
}

export function requireFarmPermission(auth: AuthContext, permission: string): void {
  if (!hasPermission(auth, permission)) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
}

const prefixes: Record<string, string> = {
  farm_crop_cycle: 'BJG-CRP',
  farm_activity: 'BJG-FAC',
  farm_daily_report: 'BJG-FDR',
  farm_inspection: 'BJG-FIN',
  farm_harvest: 'BJG-HRV',
  farm_resource_request: 'BJG-FRR',
  farm_incident: 'BJG-FIC',
  haulage_trip: 'BJG-TRP',
  farm_dispatch: 'BJG-DSP',
  equipment_asset: 'BJG-EQP',
};

export async function farmReference(db: Db, key: keyof typeof prefixes): Promise<string> {
  await execute(db, `INSERT INTO reference_sequences (sequence_key, next_value) VALUES (?, 1) ON DUPLICATE KEY UPDATE sequence_key = sequence_key`, [key]);
  const row = await queryOne<RowDataPacket>(db, 'SELECT next_value FROM reference_sequences WHERE sequence_key = ? FOR UPDATE', [key]);
  const value = Number(row?.next_value ?? 1);
  await db.query('UPDATE reference_sequences SET next_value = next_value + 1 WHERE sequence_key = ?', [key]);
  return `${prefixes[key]}-${String(value).padStart(5, '0')}`;
}

/** The users who supervise a farm, for notifications. */
export async function farmSupervisorUsers(db: Db, farmId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT DISTINCT u.id FROM users u
     WHERE u.status = 'active' AND u.employee_id IN (
       SELECT supervisor_employee_id FROM farms WHERE id = ? AND supervisor_employee_id IS NOT NULL
       UNION
       SELECT employee_id FROM farm_team_members WHERE farm_id = ? AND team_role = 'supervisor' AND (end_date IS NULL OR end_date >= CURRENT_DATE)
     )`,
    [farmId, farmId],
  );
  return rows.map((row) => Number(row.id));
}

export async function notifyFarmManagers(db: Db, notice: { title: string; body: string; type: string; entityType: string; entityId: number; excludeUserId?: number; permission?: string }) {
  await notifyUsersWithPermission(db, notice.permission ?? 'farm.review', {
    title: notice.title, body: notice.body, notificationType: notice.type, entityType: notice.entityType, entityId: notice.entityId, excludeUserId: notice.excludeUserId,
  });
}

export async function notifyUsers(db: Db, userIds: number[], notice: { title: string; body: string; type: string; entityType: string; entityId: number }) {
  for (const userId of new Set(userIds)) {
    await notifyUser(db, userId, { title: notice.title, body: notice.body, notificationType: notice.type, entityType: notice.entityType, entityId: notice.entityId });
  }
}

/** A person's display name: the employee name when the login is linked to an employee, otherwise the username. */
export const personName = (alias: string) =>
  `COALESCE(NULLIF(TRIM(CONCAT(${alias}e.first_name, ' ', ${alias}e.last_name)), ''), ${alias}u.username)`;

export function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

export function optionalNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

export function text(value: unknown): string | null {
  return value == null ? null : String(value);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
