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
import { onApprovalChange, type ApprovalChange } from '../approvals/approval.hooks';
import { createRequest, decideRequest, listRequests, resubmitRequest } from '../approvals/approval.service';
import { activeItem, activeWarehouse, changeStock } from '../supply/supply.service';
import {
  type Actor,
  assertFarmInScope,
  farmReference,
  farmScope,
  farmSupervisorUsers,
  inputCategories,
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

/** Records a stock movement against a farm so consumption and expenses can be reported per farm. */
async function tagMovements(db: Db, reference: string, farmId: number | null) {
  if (farmId) await execute(db, 'UPDATE stock_movements SET farm_id = ? WHERE reference_number = ?', [farmId, reference]);
}

// ---------------------------------------------------------------- equipment and machinery

const equipmentSelect = `
  SELECT q.*, f.name AS farm_name,
         (SELECT COALESCE(SUM(ev.hours), 0) FROM equipment_events ev WHERE ev.equipment_id = q.id AND ev.event_type = 'usage') AS logged_hours,
         (SELECT COALESCE(SUM(ev.cost), 0) FROM equipment_events ev WHERE ev.equipment_id = q.id AND ev.event_type IN ('maintenance', 'repair')) AS upkeep_cost,
         (SELECT COUNT(*) FROM equipment_events ev WHERE ev.equipment_id = q.id AND ev.event_type = 'repair') AS repairs
  FROM equipment_assets q LEFT JOIN farms f ON f.id = q.farm_id
`;

function mapEquipment(row: RowDataPacket) {
  const due = row.next_service_on != null && String(row.next_service_on) <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return {
    id: Number(row.id), assetCode: String(row.asset_code), name: String(row.name), assetType: String(row.asset_type), registrationNumber: text(row.registration_number),
    condition: String(row.equipment_condition), status: String(row.status), farmId: optionalNumber(row.farm_id), farmName: text(row.farm_name),
    lastServiceOn: text(row.last_service_on), nextServiceOn: text(row.next_service_on), usageHours: num(row.usage_hours), loggedHours: num(row.logged_hours),
    upkeepCost: num(row.upkeep_cost), repairs: num(row.repairs), notes: text(row.notes),
    needsMaintenance: row.status === 'maintenance' || ['poor', 'out_of_service'].includes(String(row.equipment_condition)) || (due && row.status !== 'retired'),
  };
}

export async function listEquipment(auth: AuthContext, filters: { farmId?: number; type?: string; status?: string; maintenance?: boolean }) {
  const scope = await farmScope(auth);
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (!scope.all) {
    const farms = scopeSql(scope, 'q.farm_id');
    where.push(farms.sql);
    params.push(...farms.params);
  }
  if (filters.farmId) { where.push('q.farm_id = ?'); params.push(filters.farmId); }
  if (filters.type) { where.push('q.asset_type = ?'); params.push(filters.type); }
  if (filters.status) { where.push('q.status = ?'); params.push(filters.status); }
  const rows = (await query<RowDataPacket[]>(pool, `${equipmentSelect} WHERE ${where.join(' AND ')} ORDER BY q.name`, params)).map(mapEquipment);
  return filters.maintenance ? rows.filter((row) => row.needsMaintenance) : rows;
}

export async function equipmentHistory(auth: AuthContext, id: number) {
  const item = await queryOne<RowDataPacket>(pool, `${equipmentSelect} WHERE q.id = ?`, [id]);
  if (!item) throw notFound('Equipment');
  if (item.farm_id != null) await assertFarmInScope(auth, Number(item.farm_id));
  else requireFarmPermission(auth, 'farm.manage');
  const events = await query<RowDataPacket[]>(
    pool,
    `SELECT ev.*, f.name AS farm_name, ${personName('r')} AS recorder_name FROM equipment_events ev
     LEFT JOIN farms f ON f.id = ev.farm_id JOIN users ru ON ru.id = ev.recorded_by LEFT JOIN employees re ON re.id = ru.employee_id
     WHERE ev.equipment_id = ? ORDER BY ev.event_date DESC, ev.id DESC`,
    [id],
  );
  return {
    ...mapEquipment(item),
    events: events.map((event) => ({
      id: Number(event.id), eventType: String(event.event_type), eventDate: String(event.event_date), farmName: text(event.farm_name),
      description: String(event.description), cost: optionalNumber(event.cost), hours: optionalNumber(event.hours), recordedBy: String(event.recorder_name),
    })),
  };
}

export async function saveEquipment(auth: AuthContext, id: number | null, input: {
  name: string; assetType: string; registrationNumber?: string | null; condition?: string; status?: string; nextServiceOn?: string | null; notes?: string | null;
}, actor: Actor) {
  requireFarmPermission(auth, 'farm.manage');
  return withTransaction(async (connection) => {
    if (id == null) {
      const companyId = await requireCompanyId(connection);
      const code = await farmReference(connection, 'equipment_asset');
      const result = await execute(
        connection,
        `INSERT INTO equipment_assets (company_id, asset_code, name, asset_type, registration_number, equipment_condition, status, next_service_on, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, code, input.name, input.assetType, input.registrationNumber ?? null, input.condition ?? 'good', input.status ?? 'available', input.nextServiceOn ?? null, input.notes ?? null, auth.userId],
      );
      await audit(connection, actor, 'equipment.create', 'equipment_asset', result.insertId, { code, ...input });
      return mapEquipment((await queryOne<RowDataPacket>(connection, `${equipmentSelect} WHERE q.id = ?`, [result.insertId]))!);
    }
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM equipment_assets WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Equipment');
    await execute(
      connection,
      `UPDATE equipment_assets SET name = ?, asset_type = ?, registration_number = ?, equipment_condition = ?, status = ?, next_service_on = ?, notes = ?, updated_by = ? WHERE id = ?`,
      [input.name, input.assetType, input.registrationNumber ?? null, input.condition ?? row.equipment_condition, input.status ?? row.status, input.nextServiceOn ?? null, input.notes ?? null, auth.userId, id],
    );
    await audit(connection, actor, 'equipment.update', 'equipment_asset', id, input, {
      name: row.name, condition: row.equipment_condition, status: row.status, nextServiceOn: row.next_service_on,
    });
    return mapEquipment((await queryOne<RowDataPacket>(connection, `${equipmentSelect} WHERE q.id = ?`, [id]))!);
  });
}

/**
 * Equipment events: allocate to or release from a farm, log usage hours, record maintenance or repairs
 * (with cost), or change the condition. Each event updates the machine and is kept as history.
 */
export async function recordEquipmentEvent(auth: AuthContext, id: number, input: {
  eventType: 'allocation' | 'release' | 'maintenance' | 'repair' | 'usage' | 'condition'; eventDate: string; farmId?: number | null; description: string;
  cost?: number | null; hours?: number | null; condition?: string; nextServiceOn?: string | null;
}, actor: Actor) {
  const supervisorUsage = input.eventType === 'usage' && hasPermission(auth, 'farm.report');
  if (!supervisorUsage) requireFarmPermission(auth, input.eventType === 'allocation' || input.eventType === 'release' ? 'farm.assign' : 'farm.manage');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM equipment_assets WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Equipment');
    if (row.status === 'retired') throw new HttpError(409, 'This equipment is retired.', 'RETIRED');
    const farmId = input.farmId ?? optionalNumber(row.farm_id);
    if (farmId) await assertFarmInScope(auth, farmId, connection);
    if (input.eventType === 'allocation' && !input.farmId) throw new HttpError(422, 'Choose the farm the equipment is allocated to.', 'FARM_REQUIRED');
    if (input.eventType === 'usage' && !(input.hours && input.hours > 0)) throw new HttpError(422, 'Record the hours used.', 'HOURS_REQUIRED');
    await execute(
      connection,
      `INSERT INTO equipment_events (equipment_id, event_type, event_date, farm_id, description, cost, hours, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.eventType, input.eventDate, farmId, input.description, input.cost ?? null, input.hours ?? null, auth.userId],
    );
    const updates: Record<string, unknown> = {};
    if (input.eventType === 'allocation') Object.assign(updates, { farm_id: input.farmId, status: 'in_use' });
    if (input.eventType === 'release') Object.assign(updates, { farm_id: null, status: 'available' });
    if (input.eventType === 'usage') updates.usage_hours = num(row.usage_hours) + (input.hours ?? 0);
    if (input.eventType === 'maintenance' || input.eventType === 'repair') {
      Object.assign(updates, { last_service_on: input.eventDate, status: row.farm_id ? 'in_use' : 'available' });
      if (input.nextServiceOn !== undefined) updates.next_service_on = input.nextServiceOn;
      if (input.condition) updates.equipment_condition = input.condition;
    }
    if (input.eventType === 'condition' && input.condition) {
      updates.equipment_condition = input.condition;
      if (input.condition === 'out_of_service') updates.status = 'maintenance';
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      await execute(connection, `UPDATE equipment_assets SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_by = ? WHERE id = ?`, [...keys.map((key) => updates[key]), auth.userId, id]);
    }
    await audit(connection, actor, `equipment.${input.eventType}`, 'equipment_asset', id, { ...input, ...updates }, {
      farmId: optionalNumber(row.farm_id), status: row.status, condition: row.equipment_condition, usageHours: num(row.usage_hours),
    });
    if (updates.status === 'maintenance') {
      await notifyFarmManagers(connection, { title: `Equipment needs maintenance: ${row.name}`, body: input.description, type: 'farm.equipment.maintenance', entityType: 'equipment_asset', entityId: id, permission: 'farm.manage' });
    }
    return mapEquipment((await queryOne<RowDataPacket>(connection, `${equipmentSelect} WHERE q.id = ?`, [id]))!);
  });
}

// ---------------------------------------------------------------- farm inputs and materials

/** Stock items in the farm input categories, with balances, consumption by farm, and reorder alerts. */
export async function listInputs(auth: AuthContext, filters: { from?: string; to?: string; farmId?: number }) {
  const from = filters.from ?? `${todayIso().slice(0, 4)}-01-01`;
  const to = filters.to ?? todayIso();
  const marks = inputCategories.map(() => '?').join(', ');
  const items = await query<RowDataPacket[]>(
    pool,
    `SELECT i.id, i.sku, i.name, i.unit, i.reorder_level, c.name AS category,
            COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.item_id = i.id), 0) AS on_hand,
            COALESCE((SELECT SUM(b.quantity * b.average_cost) FROM stock_balances b WHERE b.item_id = i.id), 0) AS stock_value
     FROM stock_items i JOIN stock_categories c ON c.id = i.category_id
     WHERE i.status = 'active' AND c.name IN (${marks})
     ORDER BY c.name, i.name`,
    inputCategories,
  );
  const scope = scopeSql(await farmScope(auth), 'm.farm_id');
  const usage = await query<RowDataPacket[]>(
    pool,
    `SELECT m.item_id, m.farm_id, f.name AS farm_name, SUM(m.quantity) AS quantity, SUM(m.quantity * m.unit_cost) AS value
     FROM stock_movements m JOIN farms f ON f.id = m.farm_id
     WHERE m.movement_type = 'issue' AND m.farm_id IS NOT NULL AND CAST(m.created_at AS DATE) BETWEEN ? AND ? AND ${scope.sql}
       ${filters.farmId ? 'AND m.farm_id = ?' : ''}
     GROUP BY m.item_id, m.farm_id, f.name`,
    [from, to, ...scope.params, ...(filters.farmId ? [filters.farmId] : [])],
  );
  return {
    from,
    to,
    items: items.map((row) => {
      const consumption = usage.filter((use) => Number(use.item_id) === Number(row.id));
      return {
        id: Number(row.id), sku: String(row.sku), name: String(row.name), unit: String(row.unit), category: String(row.category),
        onHand: num(row.on_hand), reorderLevel: num(row.reorder_level), stockValue: Math.round(num(row.stock_value) * 100) / 100,
        reorder: num(row.reorder_level) > 0 && num(row.on_hand) <= num(row.reorder_level),
        consumed: consumption.reduce((sum, use) => sum + num(use.quantity), 0),
        consumedValue: Math.round(consumption.reduce((sum, use) => sum + num(use.value), 0) * 100) / 100,
        byFarm: consumption.map((use) => ({ farmId: Number(use.farm_id), farmName: String(use.farm_name), quantity: num(use.quantity), value: Math.round(num(use.value) * 100) / 100 })),
      };
    }),
  };
}

// ---------------------------------------------------------------- resource requests (approval engine)

const requestSelect = `
  SELECT q.*, f.name AS farm_name, i.name AS item_name, w.name AS warehouse_name, a.reference_number AS approval_reference, a.status AS approval_status,
         ${personName('r')} AS requester_name, ${personName('x')} AS fulfiller_name,
         COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.item_id = q.stock_item_id), 0) AS available
  FROM farm_resource_requests q
  JOIN farms f ON f.id = q.farm_id
  LEFT JOIN stock_items i ON i.id = q.stock_item_id
  LEFT JOIN warehouses w ON w.id = q.warehouse_id
  LEFT JOIN approval_requests a ON a.id = q.approval_request_id
  JOIN users ru ON ru.id = q.requested_by
  LEFT JOIN employees re ON re.id = ru.employee_id
  LEFT JOIN users xu ON xu.id = q.fulfilled_by
  LEFT JOIN employees xe ON xe.id = xu.employee_id
`;

function mapRequest(row: RowDataPacket, pendingStep?: string | null) {
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: Number(row.farm_id), farmName: String(row.farm_name),
    category: String(row.category), stockItemId: optionalNumber(row.stock_item_id), itemName: text(row.item_name), description: String(row.description),
    quantity: num(row.quantity), unit: String(row.unit), estimatedCost: optionalNumber(row.estimated_cost), justification: String(row.justification),
    neededBy: text(row.needed_by), status: String(row.status), approvalRequestId: optionalNumber(row.approval_request_id),
    approvalReference: text(row.approval_reference), approvalStatus: text(row.approval_status), pendingStep: pendingStep ?? null,
    requestedBy: String(row.requester_name), requestedByUserId: Number(row.requested_by), available: row.stock_item_id == null ? null : num(row.available),
    fulfilledQuantity: optionalNumber(row.fulfilled_quantity), fulfilledBy: row.fulfilled_by == null ? null : text(row.fulfiller_name), fulfilledAt: row.fulfilled_at,
    warehouseName: text(row.warehouse_name), remarks: text(row.remarks), createdAt: row.created_at,
  };
}

async function pendingStepName(db: Db, approvalRequestId: number | null): Promise<string | null> {
  if (!approvalRequestId) return null;
  const step = await queryOne<RowDataPacket>(db, `SELECT name FROM approval_request_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_order LIMIT 1`, [approvalRequestId]);
  return step ? String(step.name) : null;
}

export async function listResourceRequests(auth: AuthContext, filters: { farmId?: number; status?: string; category?: string }) {
  const scope = scopeSql(await farmScope(auth), 'q.farm_id');
  const where = [`(${scope.sql} OR q.requested_by = ?)`];
  const params = [...scope.params, auth.userId];
  if (filters.farmId) { where.push('q.farm_id = ?'); params.push(filters.farmId); }
  if (filters.status) { where.push('q.status = ?'); params.push(filters.status); }
  if (filters.category) { where.push('q.category = ?'); params.push(filters.category); }
  const rows = await query<RowDataPacket[]>(pool, `${requestSelect} WHERE ${where.join(' AND ')} ORDER BY q.id DESC LIMIT 1000`, params);
  const result = [];
  for (const row of rows) result.push(mapRequest(row, row.status === 'submitted' ? await pendingStepName(pool, optionalNumber(row.approval_request_id)) : null));
  return result;
}

export async function getResourceRequest(auth: AuthContext, id: number) {
  const row = await queryOne<RowDataPacket>(pool, `${requestSelect} WHERE q.id = ?`, [id]);
  if (!row) throw notFound('Resource request');
  if (Number(row.requested_by) !== auth.userId) await assertFarmInScope(auth, Number(row.farm_id));
  return mapRequest(row, await pendingStepName(pool, optionalNumber(row.approval_request_id)));
}

export interface ResourceInput {
  farmId: number; category: string; stockItemId?: number | null; description: string; quantity: number; unit: string;
  estimatedCost?: number | null; justification: string; neededBy?: string | null; specialApproval?: boolean;
}

/**
 * A supervisor's request goes onto the FARM_RESOURCE approval route. The Operations Manager approves within
 * their financial limit; above it the request continues to the CEO, so the existing limits, delegation,
 * segregation rules, and escalation all apply.
 */
export async function submitResourceRequest(auth: AuthContext, input: ResourceInput, actor: Actor) {
  requireFarmPermission(auth, 'farm.report');
  return withTransaction(async (connection) => {
    const farm = await assertFarmInScope(auth, input.farmId, connection);
    const companyId = await requireCompanyId(connection);
    if (input.stockItemId) await activeItem(connection, companyId, input.stockItemId);
    const reference = await farmReference(connection, 'farm_resource_request');
    const result = await execute(
      connection,
      `INSERT INTO farm_resource_requests (company_id, reference_number, farm_id, category, stock_item_id, description, quantity, unit, estimated_cost, justification, needed_by, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [companyId, reference, input.farmId, input.category, input.stockItemId ?? null, input.description, input.quantity, input.unit, input.estimatedCost ?? null,
        input.justification, input.neededBy ?? null, auth.userId],
    );
    const approval = await createRequest(auth, {
      workflowCode: 'FARM_RESOURCE',
      title: `${farm.name}: ${input.quantity} ${input.unit} ${input.description}`.slice(0, 180),
      details: input.justification,
      amount: input.estimatedCost ?? 0,
      departmentId: farm.department_id == null ? null : Number(farm.department_id),
      specialApproval: input.specialApproval ?? false,
      submit: true,
      sourceType: 'farm_resource_request',
      sourceId: result.insertId,
    }, actor, connection);
    await execute(connection, 'UPDATE farm_resource_requests SET approval_request_id = ? WHERE id = ?', [approval.id, result.insertId]);
    await audit(connection, actor, 'farm.resource_request.submit', 'farm_resource_request', result.insertId, { reference, approval: approval.referenceNumber, ...input });
    const row = await queryOne<RowDataPacket>(connection, `${requestSelect} WHERE q.id = ?`, [result.insertId]);
    return mapRequest(row!, await pendingStepName(connection, approval.id));
  });
}

/** Approve (or recommend, when the CEO decides next), reject, or return through the approval engine. */
export async function decideResourceRequest(auth: AuthContext, id: number, input: { action: 'approve' | 'reject' | 'return'; comment?: string }, actor: Actor) {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM farm_resource_requests WHERE id = ?', [id]);
  if (!row) throw notFound('Resource request');
  await assertFarmInScope(auth, Number(row.farm_id));
  if (!row.approval_request_id || row.status !== 'submitted') throw new HttpError(409, 'This request is not waiting for a decision.', 'NOT_PENDING');
  await decideRequest(auth, Number(row.approval_request_id), input, actor);
  return getResourceRequest(auth, id);
}

export async function resubmitResourceRequest(auth: AuthContext, id: number, input: Partial<ResourceInput>, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_resource_requests WHERE id = ? FOR UPDATE', [id]);
    if (!row || Number(row.requested_by) !== auth.userId) throw notFound('Resource request');
    if (row.status !== 'returned') throw new HttpError(409, 'Only a returned request can be corrected and resubmitted.', 'NOT_RETURNED');
    const next = {
      description: input.description ?? row.description, quantity: input.quantity ?? num(row.quantity), unit: input.unit ?? row.unit,
      estimatedCost: input.estimatedCost === undefined ? optionalNumber(row.estimated_cost) : input.estimatedCost,
      justification: input.justification ?? row.justification, neededBy: input.neededBy === undefined ? row.needed_by : input.neededBy,
    };
    await execute(connection, `UPDATE farm_resource_requests SET description = ?, quantity = ?, unit = ?, estimated_cost = ?, justification = ?, needed_by = ? WHERE id = ?`,
      [next.description, next.quantity, next.unit, next.estimatedCost, next.justification, next.neededBy, id]);
    await execute(connection, 'UPDATE approval_requests SET amount = ?, details = ? WHERE id = ?', [next.estimatedCost ?? 0, next.justification, row.approval_request_id]);
    await audit(connection, actor, 'farm.resource_request.correct', 'farm_resource_request', id, next, {
      description: row.description, quantity: num(row.quantity), estimatedCost: optionalNumber(row.estimated_cost), justification: row.justification,
    });
  }).then(async () => {
    const row = await queryOne<RowDataPacket>(pool, 'SELECT approval_request_id FROM farm_resource_requests WHERE id = ?', [id]);
    await resubmitRequest(auth, Number(row!.approval_request_id), actor);
    return getResourceRequest(auth, id);
  });
}

/** Issues approved stock from a store to the farm (or records non-stock fulfilment) in one transaction. */
export async function fulfilResourceRequest(auth: AuthContext, id: number, input: { warehouseId?: number | null; quantity?: number; remarks?: string | null }, actor: Actor) {
  if (!hasPermission(auth, 'farm.approve') && !hasPermission(auth, 'inventory.manage')) {
    throw new HttpError(403, 'Only the Operations Manager or stores can fulfil resource requests.', 'FORBIDDEN');
  }
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_resource_requests WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Resource request');
    if (row.status !== 'approved') throw new HttpError(409, 'Only an approved request can be fulfilled.', 'NOT_APPROVED');
    if (Number(row.requested_by) === auth.userId) throw new HttpError(403, 'You raised this request, so someone else must issue it.', 'SEGREGATION_DENIED');
    const quantity = input.quantity ?? num(row.quantity);
    if (quantity <= 0 || quantity > num(row.quantity)) throw new HttpError(422, `Issue between 0 and the ${num(row.quantity)} approved.`, 'INVALID_QUANTITY');
    let movementId: number | null = null;
    let reference: string | null = null;
    if (row.stock_item_id) {
      if (!input.warehouseId) throw new HttpError(422, 'Choose the store the items are issued from.', 'WAREHOUSE_REQUIRED');
      const companyId = Number(row.company_id);
      await activeWarehouse(connection, companyId, input.warehouseId);
      reference = await nextReference(connection, 'stock_movement', 'stock_movement_prefix');
      await changeStock(connection, {
        companyId, warehouseId: input.warehouseId, itemId: Number(row.stock_item_id), quantity, direction: 'out', movementType: 'issue', unitCost: 0,
        sourceType: 'farm_resource_request', sourceId: id, notes: `Resource request ${row.reference_number}`, userId: auth.userId, reference,
      });
      await tagMovements(connection, reference, Number(row.farm_id));
      movementId = Number((await queryOne<RowDataPacket>(connection, 'SELECT MIN(id) AS id FROM stock_movements WHERE reference_number = ?', [reference]))!.id);
    }
    await execute(
      connection,
      `UPDATE farm_resource_requests SET status = 'fulfilled', fulfilled_quantity = ?, fulfilled_by = ?, fulfilled_at = UTC_TIMESTAMP(3), warehouse_id = ?, stock_movement_id = ?, remarks = COALESCE(?, remarks) WHERE id = ?`,
      [quantity, auth.userId, input.warehouseId ?? null, movementId, input.remarks ?? null, id],
    );
    if (row.approval_request_id) {
      await execute(connection, `UPDATE approval_requests SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE id = ? AND status IN ('approved', 'processing')`, [row.approval_request_id]);
      await execute(connection, `INSERT INTO approval_actions (request_id, actor_user_id, action, comment) VALUES (?, ?, 'complete', ?)`, [row.approval_request_id, auth.userId, reference ? `Issued as ${reference}` : 'Fulfilled']);
    }
    await audit(connection, actor, 'farm.resource_request.fulfil', 'farm_resource_request', id, { status: 'fulfilled', quantity, warehouseId: input.warehouseId ?? null, stockMovement: reference }, { status: 'approved' });
    await notifyUsers(connection, [Number(row.requested_by)], { title: `Resources issued: ${row.reference_number}`, body: `${quantity} ${row.unit} ${row.description}`, type: 'farm.resource_request.fulfilled', entityType: 'farm_resource_request', entityId: id });
    return getResourceRequestWithin(connection, id);
  });
}

async function getResourceRequestWithin(db: Db, id: number) {
  const row = await queryOne<RowDataPacket>(db, `${requestSelect} WHERE q.id = ?`, [id]);
  return mapRequest(row!, null);
}

async function syncResourceRequest(db: Db, event: ApprovalChange) {
  if (event.sourceType !== 'farm_resource_request') return;
  const mapped: Record<string, string> = {
    pending_review: 'submitted', under_approval: 'submitted', approved: 'approved', processing: 'approved',
    rejected: 'rejected', returned_for_correction: 'returned', cancelled: 'cancelled',
  };
  const status = mapped[event.status];
  if (!status) return;
  const row = await queryOne<RowDataPacket>(db, 'SELECT status FROM farm_resource_requests WHERE id = ? FOR UPDATE', [event.sourceId]);
  if (!row || row.status === 'fulfilled' || row.status === status) return;
  await execute(db, 'UPDATE farm_resource_requests SET status = ? WHERE id = ?', [status, event.sourceId]);
}

onApprovalChange(syncResourceRequest);

// ---------------------------------------------------------------- produce and storage

/**
 * Harvested produce by stock item and store: harvested (verified), received, dispatched, other use,
 * and the balance in stock. Figures come from verified harvests and stock movements.
 */
export async function producePosition(auth: AuthContext) {
  const scope = scopeSql(await farmScope(auth), 'h.farm_id');
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT i.id AS item_id, i.sku, i.name AS item_name, i.unit, w.id AS warehouse_id, w.name AS warehouse_name,
            COALESCE(b.quantity, 0) AS on_hand,
            COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.item_id = i.id AND m.warehouse_id = w.id AND m.movement_type = 'receipt' AND m.source_type = 'farm_harvest'), 0) AS harvested_in,
            COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.item_id = i.id AND m.warehouse_id = w.id AND m.movement_type = 'issue' AND m.source_type = 'farm_dispatch'), 0) AS dispatched,
            COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.item_id = i.id AND m.warehouse_id = w.id AND m.movement_type IN ('issue', 'damage', 'adjustment', 'transfer_out') AND COALESCE(m.source_type, '') <> 'farm_dispatch'), 0) AS other_use,
            COALESCE((SELECT SUM(d.quantity) FROM farm_dispatches d WHERE d.stock_item_id = i.id AND d.warehouse_id = w.id AND d.status IN ('requested', 'scheduled')), 0) AS awaiting_dispatch
     FROM stock_items i
     JOIN stock_categories c ON c.id = i.category_id AND c.name = ?
     JOIN stock_balances b ON b.item_id = i.id
     JOIN warehouses w ON w.id = b.warehouse_id
     ORDER BY i.name, w.name`,
    [PRODUCE_CATEGORY],
  );
  const harvests = await query<RowDataPacket[]>(
    pool,
    `SELECT h.stock_item_id, h.warehouse_id, STRING_AGG(DISTINCT f.name, ', ') AS sources, STRING_AGG(DISTINCT h.grade, ', ') AS grades
     FROM farm_harvests h JOIN farms f ON f.id = h.farm_id
     WHERE h.status = 'verified' AND ${scope.sql}
     GROUP BY h.stock_item_id, h.warehouse_id`,
    scope.params,
  );
  return rows.map((row) => {
    const origin = harvests.find((item) => Number(item.stock_item_id) === Number(row.item_id) && Number(item.warehouse_id) === Number(row.warehouse_id));
    return {
      itemId: Number(row.item_id), sku: String(row.sku), itemName: String(row.item_name), unit: String(row.unit),
      warehouseId: Number(row.warehouse_id), warehouseName: String(row.warehouse_name), harvestSources: text(origin?.sources), grades: text(origin?.grades),
      harvested: num(row.harvested_in), inStorage: num(row.on_hand), dispatched: num(row.dispatched), otherUse: num(row.other_use),
      awaitingDispatch: num(row.awaiting_dispatch), availableToDispatch: Math.max(0, num(row.on_hand) - num(row.awaiting_dispatch)),
    };
  });
}

// ---------------------------------------------------------------- haulage (the existing haulage module, now with vehicles)

const tripSelect = `
  SELECT t.*, q.name AS vehicle_name, q.registration_number,
         (SELECT STRING_AGG(d.reference_number, ', ') FROM farm_dispatches d WHERE d.haulage_trip_id = t.id) AS dispatches
  FROM haulage_trips t LEFT JOIN equipment_assets q ON q.id = t.vehicle_id
`;

function mapTrip(row: RowDataPacket) {
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), tripDate: String(row.trip_date), vehicleId: optionalNumber(row.vehicle_id),
    vehicle: text(row.vehicle_name) ? `${row.vehicle_name}${row.registration_number ? ` (${row.registration_number})` : ''}` : text(row.vehicle_label),
    driverName: text(row.driver_name), origin: String(row.origin), destination: String(row.destination), cargo: text(row.cargo),
    quantityKg: optionalNumber(row.quantity_kg), distanceKm: optionalNumber(row.distance_km), fuelLitres: optionalNumber(row.fuel_litres),
    status: String(row.status), departedAt: row.departed_at, deliveredAt: row.delivered_at, notes: text(row.notes), dispatches: text(row.dispatches),
  };
}

export async function listTrips(filters: { status?: string; from?: string; to?: string }) {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (filters.status) { where.push('t.status = ?'); params.push(filters.status); }
  if (filters.from) { where.push('t.trip_date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('t.trip_date <= ?'); params.push(filters.to); }
  const rows = await query<RowDataPacket[]>(pool, `${tripSelect} WHERE ${where.join(' AND ')} ORDER BY t.trip_date DESC, t.id DESC LIMIT 1000`, params);
  return rows.map(mapTrip);
}

async function assertVehicle(db: Db, vehicleId: number | null | undefined) {
  if (!vehicleId) return;
  const vehicle = await queryOne<RowDataPacket>(db, 'SELECT id, asset_type, status FROM equipment_assets WHERE id = ?', [vehicleId]);
  if (!vehicle || !['truck', 'vehicle', 'tractor'].includes(String(vehicle.asset_type))) throw new HttpError(422, 'Choose a truck, vehicle, or tractor from equipment.', 'INVALID_VEHICLE');
  if (['maintenance', 'retired'].includes(String(vehicle.status))) throw new HttpError(422, 'That vehicle is under maintenance or retired.', 'VEHICLE_UNAVAILABLE');
}

export async function saveTrip(auth: AuthContext, id: number | null, input: {
  tripDate: string; vehicleId?: number | null; driverName?: string | null; origin: string; destination: string; cargo?: string | null;
  quantityKg?: number | null; distanceKm?: number | null; fuelLitres?: number | null; status?: string; notes?: string | null;
}, actor: Actor, db?: Db) {
  requireFarmPermission(auth, 'farm.manage');
  const run = async (connection: Db) => {
    await assertVehicle(connection, input.vehicleId);
    if (id == null) {
      const companyId = await requireCompanyId(connection);
      const reference = await farmReference(connection, 'haulage_trip');
      const result = await execute(
        connection,
        `INSERT INTO haulage_trips (company_id, reference_number, trip_date, vehicle_id, driver_name, origin, destination, cargo, quantity_kg, distance_km, fuel_litres, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
        [companyId, reference, input.tripDate, input.vehicleId ?? null, input.driverName ?? null, input.origin, input.destination, input.cargo ?? null,
          input.quantityKg ?? null, input.distanceKm ?? null, input.fuelLitres ?? null, input.notes ?? null, auth.userId],
      );
      await audit(connection, actor, 'haulage.trip.create', 'haulage_trip', result.insertId, { reference, ...input });
      return mapTrip((await queryOne<RowDataPacket>(connection, `${tripSelect} WHERE t.id = ?`, [result.insertId]))!);
    }
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM haulage_trips WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Trip');
    const linked = await queryOne<RowDataPacket>(connection, `SELECT id FROM farm_dispatches WHERE haulage_trip_id = ? AND status NOT IN ('delivered', 'cancelled')`, [id]);
    const status = input.status ?? String(row.status);
    if (linked && status !== row.status) throw new HttpError(409, 'This trip carries a produce dispatch. Move it forward from Harvest Dispatch Coordination.', 'DISPATCH_TRIP');
    await execute(
      connection,
      `UPDATE haulage_trips SET trip_date = ?, vehicle_id = ?, driver_name = ?, origin = ?, destination = ?, cargo = ?, quantity_kg = ?, distance_km = ?, fuel_litres = ?, status = ?,
         departed_at = CASE WHEN ? = 'in_transit' AND departed_at IS NULL THEN UTC_TIMESTAMP(3) ELSE departed_at END,
         delivered_at = CASE WHEN ? = 'delivered' AND delivered_at IS NULL THEN UTC_TIMESTAMP(3) ELSE delivered_at END,
         notes = ?, updated_by = ? WHERE id = ?`,
      [input.tripDate, input.vehicleId ?? null, input.driverName ?? null, input.origin, input.destination, input.cargo ?? null, input.quantityKg ?? null,
        input.distanceKm ?? null, input.fuelLitres ?? null, status, status, status, input.notes ?? null, auth.userId, id],
    );
    await audit(connection, actor, 'haulage.trip.update', 'haulage_trip', id, input, { status: row.status, vehicleId: optionalNumber(row.vehicle_id), tripDate: row.trip_date });
    return mapTrip((await queryOne<RowDataPacket>(connection, `${tripSelect} WHERE t.id = ?`, [id]))!);
  };
  return db ? run(db) : withTransaction(run);
}

// ---------------------------------------------------------------- harvest dispatch coordination

const dispatchSelect = `
  SELECT d.*, f.name AS farm_name, i.name AS item_name, i.unit, w.name AS warehouse_name, t.reference_number AS trip_reference, t.status AS trip_status,
         t.driver_name, q.name AS vehicle_name, q.registration_number, m.reference_number AS movement_reference,
         ${personName('r')} AS requester_name, ${personName('a')} AS authoriser_name
  FROM farm_dispatches d
  LEFT JOIN farms f ON f.id = d.farm_id
  JOIN stock_items i ON i.id = d.stock_item_id
  JOIN warehouses w ON w.id = d.warehouse_id
  LEFT JOIN haulage_trips t ON t.id = d.haulage_trip_id
  LEFT JOIN equipment_assets q ON q.id = t.vehicle_id
  LEFT JOIN stock_movements m ON m.id = d.stock_movement_id
  JOIN users ru ON ru.id = d.requested_by
  LEFT JOIN employees re ON re.id = ru.employee_id
  LEFT JOIN users au ON au.id = d.authorised_by
  LEFT JOIN employees ae ON ae.id = au.employee_id
`;

function mapDispatch(row: RowDataPacket) {
  return {
    id: Number(row.id), referenceNumber: String(row.reference_number), farmId: optionalNumber(row.farm_id), farmName: text(row.farm_name),
    stockItemId: Number(row.stock_item_id), itemName: String(row.item_name), unit: String(row.unit), warehouseId: Number(row.warehouse_id), warehouseName: String(row.warehouse_name),
    quantity: num(row.quantity), collectionLocation: String(row.collection_location), destination: String(row.destination), purpose: String(row.purpose),
    requiredBy: text(row.required_by), status: String(row.status), requestedBy: String(row.requester_name), requestedByUserId: Number(row.requested_by),
    authorisedBy: row.authorised_by == null ? null : text(row.authoriser_name), authorisedAt: row.authorised_at,
    tripId: optionalNumber(row.haulage_trip_id), tripReference: text(row.trip_reference), tripStatus: text(row.trip_status), driverName: text(row.driver_name),
    vehicle: text(row.vehicle_name) ? `${row.vehicle_name}${row.registration_number ? ` (${row.registration_number})` : ''}` : null,
    movementReference: text(row.movement_reference), dispatchedAt: row.dispatched_at, deliveredAt: row.delivered_at, remarks: text(row.remarks), createdAt: row.created_at,
  };
}

export async function listDispatches(auth: AuthContext, filters: { status?: string; farmId?: number; from?: string; to?: string }) {
  const scope = await farmScope(auth);
  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (!scope.all) {
    const farms = scopeSql(scope, 'd.farm_id');
    where.push(`(${farms.sql} OR d.requested_by = ?)`);
    params.push(...farms.params, auth.userId);
  }
  if (filters.status) { where.push('d.status = ?'); params.push(filters.status); }
  if (filters.farmId) { where.push('d.farm_id = ?'); params.push(filters.farmId); }
  if (filters.from) { where.push('CAST(d.created_at AS DATE) >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('CAST(d.created_at AS DATE) <= ?'); params.push(filters.to); }
  const rows = await query<RowDataPacket[]>(pool, `${dispatchSelect} WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT 1000`, params);
  return rows.map(mapDispatch);
}

async function loadDispatch(db: Db, id: number) {
  return mapDispatch((await queryOne<RowDataPacket>(db, `${dispatchSelect} WHERE d.id = ?`, [id]))!);
}

/** A transport request for produce in store. It reserves nothing yet; stock leaves only when the load departs. */
export async function requestDispatch(auth: AuthContext, input: {
  farmId?: number | null; stockItemId: number; warehouseId: number; quantity: number; collectionLocation: string; destination: string;
  purpose: 'sale' | 'processing' | 'transfer' | 'other'; requiredBy?: string | null; remarks?: string | null;
}, actor: Actor) {
  if (!hasPermission(auth, 'farm.report') && !hasPermission(auth, 'farm.manage')) throw new HttpError(403, 'You do not have permission to request dispatch.', 'FORBIDDEN');
  return withTransaction(async (connection) => {
    if (input.farmId) await assertFarmInScope(auth, input.farmId, connection);
    else requireFarmPermission(auth, 'farm.manage');
    const companyId = await requireCompanyId(connection);
    await activeItem(connection, companyId, input.stockItemId);
    await activeWarehouse(connection, companyId, input.warehouseId);
    const position = (await producePosition(auth)).find((row) => row.itemId === input.stockItemId && row.warehouseId === input.warehouseId);
    if (!position) throw new HttpError(422, 'That store holds none of this produce.', 'NO_PRODUCE');
    if (input.quantity > position.availableToDispatch) {
      throw new HttpError(422, `Only ${position.availableToDispatch} ${position.unit} is available after other dispatch requests.`, 'INSUFFICIENT_STOCK');
    }
    const reference = await farmReference(connection, 'farm_dispatch');
    const result = await execute(
      connection,
      `INSERT INTO farm_dispatches (company_id, reference_number, farm_id, stock_item_id, warehouse_id, quantity, collection_location, destination, purpose, required_by, status, requested_by, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
      [companyId, reference, input.farmId ?? null, input.stockItemId, input.warehouseId, input.quantity, input.collectionLocation, input.destination, input.purpose,
        input.requiredBy ?? null, auth.userId, input.remarks ?? null],
    );
    await audit(connection, actor, 'farm.dispatch.request', 'farm_dispatch', result.insertId, { reference, ...input });
    await notifyFarmManagers(connection, {
      title: `Dispatch awaiting authorisation: ${reference}`, body: `${input.quantity} ${position.unit} of ${position.itemName} to ${input.destination}`,
      type: 'farm.dispatch.requested', entityType: 'farm_dispatch', entityId: result.insertId, excludeUserId: auth.userId, permission: 'farm.approve',
    });
    return loadDispatch(connection, result.insertId);
  });
}

/**
 * Authorising a dispatch assigns transport through the haulage module: an existing planned trip, or a new trip
 * created here. The person who requested the dispatch cannot authorise it when that control is on.
 */
export async function scheduleDispatch(auth: AuthContext, id: number, input: {
  tripId?: number | null; tripDate?: string; vehicleId?: number | null; driverName?: string | null; distanceKm?: number | null; remarks?: string | null;
}, actor: Actor) {
  requireFarmPermission(auth, 'farm.approve');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_dispatches WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Dispatch');
    if (row.status !== 'requested') throw new HttpError(409, 'Only a requested dispatch can be scheduled.', 'NOT_REQUESTED');
    await assertSegregation(connection, 'DISPATCH_REQUESTER_NOT_AUTHORISER', Number(row.requested_by) === auth.userId, 'You requested this dispatch, so someone else must authorise it.');
    let tripId = input.tripId ?? null;
    if (tripId) {
      const trip = await queryOne<RowDataPacket>(connection, 'SELECT status FROM haulage_trips WHERE id = ? FOR UPDATE', [tripId]);
      if (!trip || trip.status !== 'planned') throw new HttpError(422, 'Choose a planned trip.', 'INVALID_TRIP');
    } else {
      if (!input.tripDate) throw new HttpError(422, 'Choose a planned trip or give the trip date to create one.', 'TRIP_REQUIRED');
      const item = await queryOne<RowDataPacket>(connection, 'SELECT name, unit FROM stock_items WHERE id = ?', [row.stock_item_id]);
      const trip = await saveTrip(auth, null, {
        tripDate: input.tripDate, vehicleId: input.vehicleId ?? null, driverName: input.driverName ?? null, origin: String(row.collection_location),
        destination: String(row.destination), cargo: `${item?.name ?? 'Produce'} (${row.reference_number})`,
        quantityKg: String(item?.unit ?? '').toLowerCase() === 'kg' ? num(row.quantity) : null, distanceKm: input.distanceKm ?? null, notes: input.remarks ?? null,
      }, actor, connection);
      tripId = trip.id;
    }
    await execute(connection, `UPDATE farm_dispatches SET status = 'scheduled', authorised_by = ?, authorised_at = UTC_TIMESTAMP(3), haulage_trip_id = ?, remarks = COALESCE(?, remarks) WHERE id = ?`,
      [auth.userId, tripId, input.remarks ?? null, id]);
    await audit(connection, actor, 'farm.dispatch.authorise', 'farm_dispatch', id, { status: 'scheduled', tripId }, { status: 'requested' });
    await notifyUsers(connection, [Number(row.requested_by)].filter((user) => user !== auth.userId), {
      title: `Dispatch scheduled: ${row.reference_number}`, body: `Transport is assigned to ${row.destination}.`, type: 'farm.dispatch.scheduled', entityType: 'farm_dispatch', entityId: id,
    });
    return loadDispatch(connection, id);
  });
}

/** Loading the produce issues it from stock and puts the trip in transit, in one transaction. */
export async function departDispatch(auth: AuthContext, id: number, actor: Actor) {
  requireFarmPermission(auth, 'farm.approve');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_dispatches WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Dispatch');
    if (row.status !== 'scheduled' || row.stock_movement_id != null) throw new HttpError(409, 'Only a scheduled dispatch can leave, and only once.', 'NOT_SCHEDULED');
    const reference = await nextReference(connection, 'stock_movement', 'stock_movement_prefix');
    await changeStock(connection, {
      companyId: Number(row.company_id), warehouseId: Number(row.warehouse_id), itemId: Number(row.stock_item_id), quantity: num(row.quantity),
      direction: 'out', movementType: 'issue', unitCost: 0, sourceType: 'farm_dispatch', sourceId: id,
      notes: `Dispatch ${row.reference_number} to ${row.destination}`, userId: auth.userId, reference,
    });
    await tagMovements(connection, reference, optionalNumber(row.farm_id));
    const movement = await queryOne<RowDataPacket>(connection, 'SELECT MIN(id) AS id FROM stock_movements WHERE reference_number = ?', [reference]);
    await execute(connection, `UPDATE farm_dispatches SET status = 'in_transit', stock_movement_id = ?, dispatched_at = UTC_TIMESTAMP(3) WHERE id = ?`, [movement!.id, id]);
    await execute(connection, `UPDATE haulage_trips SET status = 'in_transit', departed_at = COALESCE(departed_at, UTC_TIMESTAMP(3)), updated_by = ? WHERE id = ?`, [auth.userId, row.haulage_trip_id]);
    await audit(connection, actor, 'farm.dispatch.depart', 'farm_dispatch', id, { status: 'in_transit', stockMovement: reference, quantity: num(row.quantity) }, { status: 'scheduled' });
    return loadDispatch(connection, id);
  });
}

export async function deliverDispatch(auth: AuthContext, id: number, input: { remarks?: string | null }, actor: Actor) {
  requireFarmPermission(auth, 'farm.approve');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_dispatches WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Dispatch');
    if (row.status !== 'in_transit') throw new HttpError(409, 'Only a dispatch in transit can be delivered.', 'NOT_IN_TRANSIT');
    await execute(connection, `UPDATE farm_dispatches SET status = 'delivered', delivered_at = UTC_TIMESTAMP(3), remarks = COALESCE(?, remarks) WHERE id = ?`, [input.remarks ?? null, id]);
    const open = await queryOne<RowDataPacket>(connection, `SELECT id FROM farm_dispatches WHERE haulage_trip_id = ? AND status <> 'delivered' AND status <> 'cancelled'`, [row.haulage_trip_id]);
    if (!open) await execute(connection, `UPDATE haulage_trips SET status = 'delivered', delivered_at = UTC_TIMESTAMP(3), updated_by = ? WHERE id = ?`, [auth.userId, row.haulage_trip_id]);
    await audit(connection, actor, 'farm.dispatch.deliver', 'farm_dispatch', id, { status: 'delivered', remarks: input.remarks ?? null }, { status: 'in_transit' });
    await notifyUsers(connection, [Number(row.requested_by)].filter((user) => user !== auth.userId), {
      title: `Dispatch delivered: ${row.reference_number}`, body: `Delivered to ${row.destination}.`, type: 'farm.dispatch.delivered', entityType: 'farm_dispatch', entityId: id,
    });
    return loadDispatch(connection, id);
  });
}

export async function cancelDispatch(auth: AuthContext, id: number, reason: string, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM farm_dispatches WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Dispatch');
    if (Number(row.requested_by) !== auth.userId) requireFarmPermission(auth, 'farm.approve');
    if (!['requested', 'scheduled'].includes(String(row.status))) throw new HttpError(409, 'A dispatch that has left cannot be cancelled. Record the return as a stock adjustment.', 'NOT_CANCELLABLE');
    await execute(connection, `UPDATE farm_dispatches SET status = 'cancelled', remarks = ? WHERE id = ?`, [reason, id]);
    if (row.haulage_trip_id) {
      const others = await queryOne<RowDataPacket>(connection, `SELECT id FROM farm_dispatches WHERE haulage_trip_id = ? AND id <> ? AND status <> 'cancelled'`, [row.haulage_trip_id, id]);
      if (!others) await execute(connection, `UPDATE haulage_trips SET status = 'cancelled', updated_by = ? WHERE id = ? AND status = 'planned'`, [auth.userId, row.haulage_trip_id]);
    }
    await audit(connection, actor, 'farm.dispatch.cancel', 'farm_dispatch', id, { status: 'cancelled', reason }, { status: row.status });
    return loadDispatch(connection, id);
  });
}

// ---------------------------------------------------------------- pending reviews and approvals

/** Everything waiting on the Operations Manager across farm operations, with links. */
export async function pendingWork(auth: AuthContext) {
  const scope = scopeSql(await farmScope(auth), 'x.farm_id');
  const count = async (sql: string, params: unknown[] = []) => num((await queryOne<RowDataPacket>(pool, sql, params))?.total);
  // Only the requests the approval engine says this person (or their delegate authority) can decide now.
  const inbox = await listRequests(auth, { queue: 'inbox', page: 1, pageSize: 100, status: 'all', search: '' });
  const ids = inbox.data.filter((request) => request.workflowCode === 'FARM_RESOURCE').map((request) => request.id);
  const mine = [];
  if (ids.length) {
    const rows = await query<RowDataPacket[]>(pool, `SELECT id FROM farm_resource_requests WHERE approval_request_id IN (${ids.map(() => '?').join(', ')})`, ids);
    for (const row of rows) mine.push(await getResourceRequest(auth, Number(row.id)));
  }
  return {
    dailyReports: await count(`SELECT COUNT(*) AS total FROM farm_daily_reports x WHERE x.status = 'submitted' AND ${scope.sql}`, scope.params),
    harvestsToVerify: await count(`SELECT COUNT(*) AS total FROM farm_harvests x WHERE x.status = 'recorded' AND ${scope.sql}`, scope.params),
    resourceRequests: mine.length,
    dispatchRequests: await count(`SELECT COUNT(*) AS total FROM farm_dispatches x WHERE x.status = 'requested' AND (x.farm_id IS NULL OR ${scope.sql})`, scope.params),
    approvedToFulfil: await count(`SELECT COUNT(*) AS total FROM farm_resource_requests x WHERE x.status = 'approved' AND ${scope.sql}`, scope.params),
    newIncidents: await count(`SELECT COUNT(*) AS total FROM farm_incidents x WHERE x.status = 'reported' AND ${scope.sql}`, scope.params),
    inspectionFollowUps: await count(`SELECT COUNT(*) AS total FROM farm_inspections x WHERE x.status = 'follow_up' AND ${scope.sql}`, scope.params),
    overdueActivities: await count(`SELECT COUNT(*) AS total FROM farm_activities x WHERE x.status IN ('planned', 'in_progress') AND x.due_date < CURRENT_DATE AND ${scope.sql}`, scope.params),
    resourceQueue: mine,
  };
}

export { farmSupervisorUsers, inputCategories };
