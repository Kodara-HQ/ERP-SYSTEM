import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { query, queryOne } from '../../database/query';
import { notifyUser, notifyUsersWithPermission } from '../../services/notify';
import { farmSupervisorUsers, num } from './farm.common';

/** True when this kind of notice for this record went out within the window, so jobs never repeat themselves hourly. */
async function sentRecently(type: string, entityType: string, entityId: number, days: number): Promise<boolean> {
  const row = await queryOne<RowDataPacket>(
    pool,
    `SELECT 1 AS hit FROM notifications WHERE notification_type = ? AND entity_type = ? AND entity_id = ? AND created_at > (CURRENT_TIMESTAMP - (? * INTERVAL '1 day')) LIMIT 1`,
    [type, entityType, String(entityId), days],
  );
  return Boolean(row);
}

async function tell(farmId: number | null, permission: string, notice: { title: string; body: string; type: string; entityType: string; entityId: number }) {
  await notifyUsersWithPermission(pool, permission, { title: notice.title, body: notice.body, notificationType: notice.type, entityType: notice.entityType, entityId: notice.entityId });
  if (farmId) {
    for (const userId of await farmSupervisorUsers(pool, farmId)) {
      await notifyUser(pool, userId, { title: notice.title, body: notice.body, notificationType: notice.type, entityType: notice.entityType, entityId: notice.entityId });
    }
  }
}

/**
 * Scheduled farm notices: overdue activities, harvests coming up in the next 7 days, production running below
 * target, and equipment due for service. Each record is notified at most once a day (targets once a week).
 */
export async function runFarmNotices(): Promise<number> {
  let sent = 0;
  const overdue = await query<RowDataPacket[]>(pool,
    `SELECT a.id, a.reference_number, a.title, a.due_date, a.farm_id, a.assigned_user_id, f.name AS farm_name FROM farm_activities a JOIN farms f ON f.id = a.farm_id
     WHERE a.status IN ('planned', 'in_progress') AND a.due_date < CURRENT_DATE`);
  for (const row of overdue) {
    if (await sentRecently('farm.activity.overdue', 'farm_activity', Number(row.id), 1)) continue;
    const notice = { title: `Overdue farm activity: ${row.reference_number}`, body: `${row.farm_name}: ${row.title} was due on ${row.due_date}.`, type: 'farm.activity.overdue', entityType: 'farm_activity', entityId: Number(row.id) };
    await tell(Number(row.farm_id), 'farm.assign', notice);
    if (row.assigned_user_id) await notifyUser(pool, Number(row.assigned_user_id), { title: notice.title, body: notice.body, notificationType: notice.type, entityType: notice.entityType, entityId: notice.entityId });
    sent += 1;
  }
  const harvests = await query<RowDataPacket[]>(pool,
    `SELECT c.id, c.reference_number, c.crop, c.expected_harvest_date, c.farm_id, f.name AS farm_name FROM farm_crop_cycles c JOIN farms f ON f.id = c.farm_id
     WHERE c.status = 'active' AND c.expected_harvest_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`);
  for (const row of harvests) {
    if (await sentRecently('farm.harvest.approaching', 'farm_crop_cycle', Number(row.id), 1)) continue;
    await tell(Number(row.farm_id), 'farm.manage', {
      title: `Harvest approaching: ${row.farm_name}`, body: `${row.crop} (${row.reference_number}) is expected on ${row.expected_harvest_date}.`,
      type: 'farm.harvest.approaching', entityType: 'farm_crop_cycle', entityId: Number(row.id),
    });
    sent += 1;
  }
  const targets = await query<RowDataPacket[]>(pool,
    `SELECT t.id, t.crop, t.season, t.target_kg, t.period_start, t.period_end, t.farm_id, f.name AS farm_name,
            (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM farm_harvests h WHERE h.farm_id = t.farm_id AND LOWER(h.crop) = LOWER(t.crop) AND h.status = 'verified' AND h.harvest_date BETWEEN t.period_start AND t.period_end) AS actual,
            (CURRENT_DATE - t.period_start)::numeric / NULLIF(t.period_end - t.period_start, 0) AS elapsed
     FROM farm_production_targets t JOIN farms f ON f.id = t.farm_id
     WHERE CURRENT_DATE BETWEEN t.period_start AND t.period_end + 7`);
  for (const row of targets) {
    const elapsed = Math.min(1, num(row.elapsed));
    const achieved = num(row.target_kg) > 0 ? num(row.actual) / num(row.target_kg) : 1;
    if (elapsed < 0.25 || achieved >= elapsed * 0.8) continue;
    if (await sentRecently('farm.target.below', 'farm_production_target', Number(row.id), 7)) continue;
    await tell(null, 'farm.manage', {
      title: `Production below target: ${row.farm_name}`,
      body: `${row.crop} ${row.season}: ${Math.round(num(row.actual))} of ${Math.round(num(row.target_kg))} kg (${Math.round(achieved * 100)}%) with ${Math.round(elapsed * 100)}% of the period gone.`,
      type: 'farm.target.below', entityType: 'farm_production_target', entityId: Number(row.id),
    });
    sent += 1;
  }
  const equipment = await query<RowDataPacket[]>(pool,
    `SELECT id, asset_code, name, next_service_on, farm_id FROM equipment_assets
     WHERE status <> 'retired' AND next_service_on IS NOT NULL AND next_service_on <= CURRENT_DATE + INTERVAL '7 days'`);
  for (const row of equipment) {
    if (await sentRecently('farm.equipment.maintenance', 'equipment_asset', Number(row.id), 1)) continue;
    await tell(row.farm_id == null ? null : Number(row.farm_id), 'farm.manage', {
      title: `Equipment service due: ${row.name}`, body: `${row.asset_code} is due for service on ${row.next_service_on}.`,
      type: 'farm.equipment.maintenance', entityType: 'equipment_asset', entityId: Number(row.id),
    });
    sent += 1;
  }
  return sent;
}
