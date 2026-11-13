import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction, type Db } from '../../database/query';
import { createRequest, resubmitRequest } from '../approvals/approval.service';
import { onApprovalChange, type ApprovalChange } from '../approvals/approval.hooks';
import { writeAudit } from '../../services/auditService';
import { hasPermission } from '../../services/access';
import { recordVisibility, transactionClause } from '../../services/visibility';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };
type MovementType = 'receipt' | 'issue' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'damage';

function milli(value: number | string): number {
  return Math.round(Number(value) * 1000);
}

function fromMilli(value: number): string {
  return (value / 1000).toFixed(3);
}

function cents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

function fromCents(value: number): string {
  return (value / 100).toFixed(2);
}

function lineTotal(quantity: number, unitCost: number): string {
  return fromCents(Math.round((milli(quantity) * cents(unitCost)) / 1000));
}

async function activeItem(db: Db, companyId: number, itemId: number) {
  const item = await queryOne<RowDataPacket>(
    db,
    'SELECT id, sku, name, unit, status FROM stock_items WHERE id = ? AND company_id = ?',
    [itemId, companyId],
  );
  if (!item || item.status !== 'active') throw new HttpError(422, 'Choose an active stock item.', 'INVALID_ITEM');
  return item;
}

async function activeWarehouse(db: Db, companyId: number, warehouseId: number) {
  const warehouse = await queryOne<RowDataPacket>(
    db,
    'SELECT id, code, name, status FROM warehouses WHERE id = ? AND company_id = ?',
    [warehouseId, companyId],
  );
  if (!warehouse || warehouse.status !== 'active') throw new HttpError(422, 'Choose an active warehouse.', 'INVALID_WAREHOUSE');
  return warehouse;
}

async function lockBalance(db: Db, warehouseId: number, itemId: number) {
  await execute(
    db,
    'INSERT IGNORE INTO stock_balances (warehouse_id, item_id, quantity, average_cost) VALUES (?, ?, 0, 0)',
    [warehouseId, itemId],
  );
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT quantity, average_cost FROM stock_balances WHERE warehouse_id = ? AND item_id = ? FOR UPDATE',
    [warehouseId, itemId],
  );
  if (!row) throw new HttpError(500, 'Stock balance could not be locked.');
  return { quantity: milli(row.quantity), averageCost: cents(row.average_cost) };
}

async function changeStock(db: Db, input: {
  companyId: number;
  warehouseId: number;
  itemId: number;
  quantity: number;
  direction: 'in' | 'out';
  movementType: MovementType;
  unitCost: number;
  lotCode?: string | null;
  expiryDate?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  notes?: string | null;
  userId: number;
  reference: string;
}) {
  const amount = milli(input.quantity);
  if (amount <= 0) throw new HttpError(422, 'Quantity must be greater than zero.', 'INVALID_QUANTITY');
  const balance = await lockBalance(db, input.warehouseId, input.itemId);
  if (input.direction === 'in') {
    const nextQty = balance.quantity + amount;
    const unit = cents(input.unitCost);
    const nextCost = nextQty === 0 ? balance.averageCost : Math.round((balance.quantity * balance.averageCost + amount * unit) / nextQty);
    await execute(
      db,
      'UPDATE stock_balances SET quantity = ?, average_cost = ? WHERE warehouse_id = ? AND item_id = ?',
      [fromMilli(nextQty), fromCents(nextCost), input.warehouseId, input.itemId],
    );
    const lotCode = input.lotCode?.trim() || 'UNLOTTED';
    const lot = await queryOne<RowDataPacket>(
      db,
      'SELECT id, quantity FROM stock_lots WHERE warehouse_id = ? AND item_id = ? AND lot_code = ? FOR UPDATE',
      [input.warehouseId, input.itemId, lotCode],
    );
    if (lot) {
      await execute(
        db,
        'UPDATE stock_lots SET quantity = ?, expiry_date = COALESCE(expiry_date, ?) WHERE id = ?',
        [fromMilli(milli(lot.quantity) + amount), input.expiryDate ?? null, lot.id],
      );
    } else {
      await execute(
        db,
        'INSERT INTO stock_lots (warehouse_id, item_id, lot_code, expiry_date, quantity) VALUES (?, ?, ?, ?, ?)',
        [input.warehouseId, input.itemId, lotCode, input.expiryDate ?? null, fromMilli(amount)],
      );
    }
    await execute(
      db,
      `INSERT INTO stock_movements (
         company_id, reference_number, warehouse_id, item_id, movement_type, quantity, unit_cost, balance_after,
         lot_code, expiry_date, source_type, source_id, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId, input.reference, input.warehouseId, input.itemId, input.movementType,
        fromMilli(amount), fromCents(unit), fromMilli(nextQty), lotCode, input.expiryDate ?? null,
        input.sourceType ?? null, input.sourceId ?? null, input.notes ?? null, input.userId,
      ],
    );
    return;
  }

  if (balance.quantity < amount) throw new HttpError(422, 'That quantity is not in stock.', 'INSUFFICIENT_STOCK');
  const requestedLot = input.lotCode?.trim();
  const lots = await query<RowDataPacket[]>(
    db,
    `SELECT id, lot_code, expiry_date, quantity FROM stock_lots
     WHERE warehouse_id = ? AND item_id = ? AND quantity > 0 ${requestedLot ? 'AND lot_code = ?' : ''}
     ORDER BY (expiry_date IS NULL), expiry_date, id
     FOR UPDATE`,
    requestedLot ? [input.warehouseId, input.itemId, requestedLot] : [input.warehouseId, input.itemId],
  );
  let remaining = amount;
  let running = balance.quantity;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const available = milli(lot.quantity);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    remaining -= take;
    running -= take;
    await execute(db, 'UPDATE stock_lots SET quantity = ? WHERE id = ?', [fromMilli(available - take), lot.id]);
    await execute(
      db,
      `INSERT INTO stock_movements (
         company_id, reference_number, warehouse_id, item_id, movement_type, quantity, unit_cost, balance_after,
         lot_code, expiry_date, source_type, source_id, notes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.companyId, input.reference, input.warehouseId, input.itemId, input.movementType,
        fromMilli(take), fromCents(balance.averageCost), fromMilli(running), lot.lot_code, lot.expiry_date,
        input.sourceType ?? null, input.sourceId ?? null, input.notes ?? null, input.userId,
      ],
    );
  }
  if (remaining > 0) throw new HttpError(422, 'That quantity is not in stock.', 'INSUFFICIENT_STOCK');
  await execute(
    db,
    'UPDATE stock_balances SET quantity = ? WHERE warehouse_id = ? AND item_id = ?',
    [fromMilli(balance.quantity - amount), input.warehouseId, input.itemId],
  );
}

function mapSupplier(row: RowDataPacket) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    name: String(row.name),
    contactName: row.contact_name == null ? null : String(row.contact_name),
    phone: row.phone == null ? null : String(row.phone),
    email: row.email == null ? null : String(row.email),
    notes: row.notes == null ? null : String(row.notes),
    status: String(row.status),
  };
}

export async function listSuppliers() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM suppliers ORDER BY name LIMIT 200');
  return rows.map(mapSupplier);
}

export async function createSupplier(auth: AuthContext, input: {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const reference = await nextReference(connection, 'supplier', 'supplier_prefix');
    const created = await execute(
      connection,
      `INSERT INTO suppliers (company_id, reference_number, name, contact_name, phone, email, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.name, input.contactName ?? null, input.phone ?? null, input.email ?? null, input.notes ?? null, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'supplier.create', module: 'procurement', entityType: 'supplier', entityId: created.insertId,
      newValue: { reference, name: input.name }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM suppliers WHERE id = ?', [created.insertId]);
    return mapSupplier(row!);
  });
}

export async function setSupplierStatus(id: number, status: 'active' | 'inactive', actor: Actor) {
  const existing = await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM suppliers WHERE id = ?', [id]);
  if (!existing) throw notFound('Supplier');
  await withTransaction(async (connection) => {
    await execute(connection, 'UPDATE suppliers SET status = ? WHERE id = ?', [status, id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'supplier.status', module: 'procurement', entityType: 'supplier', entityId: id,
      previousValue: { status: existing.status }, newValue: { status }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
  });
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM suppliers WHERE id = ?', [id]);
  return mapSupplier(row!);
}

export async function listCategories() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT id, name, status FROM stock_categories ORDER BY name');
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), status: String(row.status) }));
}

export async function createCategory(name: string) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const existing = await queryOne<RowDataPacket>(connection, 'SELECT id FROM stock_categories WHERE company_id = ? AND name = ?', [companyId, name]);
    if (existing) throw new HttpError(409, 'That category already exists.', 'DUPLICATE_CATEGORY');
    const created = await execute(connection, 'INSERT INTO stock_categories (company_id, name) VALUES (?, ?)', [companyId, name]);
    return { id: created.insertId, name, status: 'active' };
  });
}

export async function listWarehouses() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT w.id, w.code, w.name, w.branch_id, w.notes, w.status, b.name AS branch_name
     FROM warehouses w LEFT JOIN branches b ON b.id = w.branch_id ORDER BY w.name`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    branchName: row.branch_name == null ? null : String(row.branch_name),
    notes: row.notes == null ? null : String(row.notes),
    status: String(row.status),
  }));
}

export async function createWarehouse(input: { code: string; name: string; branchId?: number | null; notes?: string | null }) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const code = input.code.toUpperCase();
    const existing = await queryOne<RowDataPacket>(connection, 'SELECT id FROM warehouses WHERE company_id = ? AND code = ?', [companyId, code]);
    if (existing) throw new HttpError(409, 'That warehouse code is already used.', 'DUPLICATE_WAREHOUSE');
    if (input.branchId) {
      const branch = await queryOne<RowDataPacket>(connection, 'SELECT id FROM branches WHERE id = ? AND company_id = ? AND status = \'active\'', [input.branchId, companyId]);
      if (!branch) throw new HttpError(422, 'Choose an active branch.', 'INVALID_BRANCH');
    }
    const created = await execute(
      connection,
      'INSERT INTO warehouses (company_id, code, name, branch_id, notes) VALUES (?, ?, ?, ?, ?)',
      [companyId, code, input.name, input.branchId ?? null, input.notes ?? null],
    );
    return { id: created.insertId, code, name: input.name, branchId: input.branchId ?? null, status: 'active' };
  });
}

export async function listItems() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT i.id, i.sku, i.name, i.unit, i.reorder_level, i.status, i.category_id, c.name AS category_name,
            COALESCE(SUM(b.quantity), 0) AS on_hand
     FROM stock_items i
     LEFT JOIN stock_categories c ON c.id = i.category_id
     LEFT JOIN stock_balances b ON b.item_id = i.id
     GROUP BY i.id, c.name
     ORDER BY i.name LIMIT 300`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    sku: String(row.sku),
    name: String(row.name),
    unit: String(row.unit),
    reorderLevel: Number(row.reorder_level),
    status: String(row.status),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: row.category_name == null ? null : String(row.category_name),
    onHand: Number(row.on_hand),
  }));
}

export async function createItem(input: { sku: string; name: string; categoryId?: number | null; unit: string; reorderLevel: number }) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const sku = input.sku.toUpperCase();
    const existing = await queryOne<RowDataPacket>(connection, 'SELECT id FROM stock_items WHERE company_id = ? AND sku = ?', [companyId, sku]);
    if (existing) throw new HttpError(409, 'That item code is already used.', 'DUPLICATE_ITEM');
    if (input.categoryId) {
      const category = await queryOne<RowDataPacket>(connection, 'SELECT id FROM stock_categories WHERE id = ? AND company_id = ?', [input.categoryId, companyId]);
      if (!category) throw new HttpError(422, 'Choose a stock category.', 'INVALID_CATEGORY');
    }
    const created = await execute(
      connection,
      'INSERT INTO stock_items (company_id, sku, name, category_id, unit, reorder_level) VALUES (?, ?, ?, ?, ?, ?)',
      [companyId, sku, input.name, input.categoryId ?? null, input.unit, input.reorderLevel],
    );
    return { id: created.insertId, sku, name: input.name, unit: input.unit, reorderLevel: input.reorderLevel, status: 'active', onHand: 0 };
  });
}

export async function setItemStatus(id: number, status: 'active' | 'inactive') {
  const existing = await queryOne<RowDataPacket>(pool, 'SELECT id FROM stock_items WHERE id = ?', [id]);
  if (!existing) throw notFound('Stock item');
  await execute(pool, 'UPDATE stock_items SET status = ? WHERE id = ?', [status, id]);
  const rows = await listItems();
  return rows.find((row) => row.id === id) ?? null;
}

function mapRequisition(row: RowDataPacket, lines: RowDataPacket[]) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    purpose: String(row.purpose),
    status: String(row.status),
    totalAmount: Number(row.total_amount),
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
    approvalReference: row.approval_reference == null ? null : String(row.approval_reference),
    requesterUserId: Number(row.requester_user_id),
    lines: lines.map((line) => ({
      id: Number(line.id),
      itemId: line.item_id == null ? null : Number(line.item_id),
      description: String(line.description),
      quantity: Number(line.quantity),
      unit: String(line.unit),
      estimatedUnitCost: Number(line.estimated_unit_cost),
      lineTotal: Number(line.line_total),
    })),
  };
}

const requisitionSelect = `SELECT r.*, ar.reference_number AS approval_reference
  FROM purchase_requisitions r
  LEFT JOIN approval_requests ar ON ar.id = r.approval_request_id`;

export async function listRequisitions(auth: AuthContext) {
  const visibility = await recordVisibility(auth);
  const scope = transactionClause(visibility, { department: 'r.department_id', user: 'r.requester_user_id' });
  const rows = await query<RowDataPacket[]>(
    pool,
    `${requisitionSelect} WHERE ${scope.sql} ORDER BY r.id DESC LIMIT 200`,
    scope.params,
  );
  if (rows.length === 0) return [];
  const lines = await query<RowDataPacket[]>(
    pool,
    `SELECT * FROM purchase_requisition_lines WHERE requisition_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapRequisition(row, lines.filter((line) => Number(line.requisition_id) === Number(row.id))));
}

export async function createRequisition(auth: AuthContext, input: {
  purpose: string;
  lines: Array<{ itemId?: number | null; description: string; quantity: number; estimatedUnitCost: number }>;
}, actor: Actor) {
  if (!hasPermission(auth, 'procurement.request') && !hasPermission(auth, 'procurement.manage')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const assignment = auth.employeeId
      ? await queryOne<RowDataPacket>(
        connection,
        `SELECT department_id, branch_id FROM employee_assignments
         WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL`,
        [auth.employeeId],
      )
      : null;
    let total = 0;
    const prepared = [];
    for (const line of input.lines) {
      let unit = 'unit';
      if (line.itemId) {
        const item = await activeItem(connection, companyId, line.itemId);
        unit = String(item.unit);
      }
      const amount = lineTotal(line.quantity, line.estimatedUnitCost);
      total += cents(amount);
      prepared.push({ ...line, unit, lineTotal: amount });
    }
    const reference = await nextReference(connection, 'purchase_requisition', 'purchase_requisition_prefix');
    const created = await execute(
      connection,
      `INSERT INTO purchase_requisitions (company_id, reference_number, requester_user_id, department_id, branch_id, purpose, status, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [companyId, reference, auth.userId, assignment?.department_id ?? null, assignment?.branch_id ?? null, input.purpose, fromCents(total)],
    );
    for (const line of prepared) {
      await execute(
        connection,
        `INSERT INTO purchase_requisition_lines (requisition_id, item_id, description, quantity, unit, estimated_unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, line.itemId ?? null, line.description, line.quantity, line.unit, line.estimatedUnitCost, line.lineTotal],
      );
    }
    const approval = await createRequest(auth, {
      workflowCode: 'PURCHASE',
      title: `Purchase ${reference}`,
      details: input.purpose,
      amount: Number(fromCents(total)),
      departmentId: assignment ? Number(assignment.department_id) : null,
      branchId: assignment ? Number(assignment.branch_id) : null,
      submit: true,
      sourceType: 'purchase_requisition',
      sourceId: created.insertId,
    }, actor, connection);
    await execute(connection, 'UPDATE purchase_requisitions SET approval_request_id = ? WHERE id = ?', [approval.id, created.insertId]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'requisition.submit', module: 'procurement', entityType: 'purchase_requisition', entityId: created.insertId,
      newValue: { reference, total: fromCents(total), approval: approval.referenceNumber }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, `${requisitionSelect} WHERE r.id = ?`, [created.insertId]);
    const lines = await query<RowDataPacket[]>(connection, 'SELECT * FROM purchase_requisition_lines WHERE requisition_id = ? ORDER BY id', [created.insertId]);
    return mapRequisition(row!, lines);
  });
}

export async function resubmitRequisition(auth: AuthContext, id: number, actor: Actor) {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM purchase_requisitions WHERE id = ?', [id]);
  if (!row) throw notFound('Purchase requisition');
  if (Number(row.requester_user_id) !== auth.userId && !hasPermission(auth, 'procurement.manage')) {
    throw new HttpError(403, 'Only the requester can resubmit this requisition.', 'NOT_REQUESTER');
  }
  if (row.status !== 'returned' || !row.approval_request_id) {
    throw new HttpError(409, 'Only a returned requisition can be resubmitted.', 'NOT_RETURNED');
  }
  await resubmitRequest(auth, Number(row.approval_request_id), actor);
  const updated = await queryOne<RowDataPacket>(pool, `${requisitionSelect} WHERE r.id = ?`, [id]);
  const lines = await query<RowDataPacket[]>(pool, 'SELECT * FROM purchase_requisition_lines WHERE requisition_id = ? ORDER BY id', [id]);
  return mapRequisition(updated!, lines);
}

async function syncRequisition(db: Db, event: ApprovalChange) {
  const mapped: Record<string, string> = {
    pending_review: 'submitted',
    under_approval: 'submitted',
    approved: 'approved',
    processing: 'approved',
    completed: 'approved',
    rejected: 'rejected',
    returned_for_correction: 'returned',
    cancelled: 'cancelled',
  };
  const status = mapped[event.status];
  if (!status) return;
  const row = await queryOne<RowDataPacket>(db, 'SELECT status FROM purchase_requisitions WHERE id = ? FOR UPDATE', [event.sourceId]);
  if (!row || row.status === 'ordered') return;
  await execute(db, 'UPDATE purchase_requisitions SET status = ? WHERE id = ?', [status, event.sourceId]);
}

function mapOrder(row: RowDataPacket, lines: RowDataPacket[]) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    requisitionId: Number(row.requisition_id),
    requisitionReference: row.requisition_reference == null ? null : String(row.requisition_reference),
    supplierId: Number(row.supplier_id),
    supplierName: row.supplier_name == null ? null : String(row.supplier_name),
    status: String(row.status),
    totalAmount: Number(row.total_amount),
    lines: lines.map((line) => ({
      id: Number(line.id),
      requisitionLineId: Number(line.requisition_line_id),
      itemId: line.item_id == null ? null : Number(line.item_id),
      description: String(line.description),
      quantity: Number(line.quantity),
      unitCost: Number(line.unit_cost),
      receivedQuantity: Number(line.received_quantity),
    })),
  };
}

const orderSelect = `SELECT o.*, s.name AS supplier_name, r.reference_number AS requisition_reference
  FROM purchase_orders o
  JOIN suppliers s ON s.id = o.supplier_id
  JOIN purchase_requisitions r ON r.id = o.requisition_id`;

export async function listOrders(auth: AuthContext) {
  const visibility = await recordVisibility(auth);
  const scope = transactionClause(visibility, { department: 'r.department_id', user: 'r.requester_user_id' });
  const rows = await query<RowDataPacket[]>(pool, `${orderSelect} WHERE ${scope.sql} ORDER BY o.id DESC LIMIT 200`, scope.params);
  if (rows.length === 0) return [];
  const lines = await query<RowDataPacket[]>(
    pool,
    `SELECT * FROM purchase_order_lines WHERE order_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapOrder(row, lines.filter((line) => Number(line.order_id) === Number(row.id))));
}

export async function createOrder(auth: AuthContext, input: {
  requisitionId: number;
  supplierId: number;
  lines: Array<{ requisitionLineId: number; unitCost: number }>;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const requisition = await queryOne<RowDataPacket>(connection, 'SELECT * FROM purchase_requisitions WHERE id = ? FOR UPDATE', [input.requisitionId]);
    if (!requisition) throw notFound('Purchase requisition');
    if (requisition.status !== 'approved') {
      throw new HttpError(409, 'A purchase order can be raised only after the requisition is approved.', 'REQUISITION_NOT_APPROVED');
    }
    const open = await queryOne<RowDataPacket>(
      connection,
      `SELECT id FROM purchase_orders WHERE requisition_id = ? AND status <> 'cancelled'`,
      [input.requisitionId],
    );
    if (open) throw new HttpError(409, 'This requisition already has a purchase order.', 'ORDER_EXISTS');
    const supplier = await queryOne<RowDataPacket>(connection, 'SELECT id, status FROM suppliers WHERE id = ? AND company_id = ?', [input.supplierId, companyId]);
    if (!supplier || supplier.status !== 'active') throw new HttpError(422, 'Choose an active supplier.', 'INVALID_SUPPLIER');
    const sourceLines = await query<RowDataPacket[]>(connection, 'SELECT * FROM purchase_requisition_lines WHERE requisition_id = ? ORDER BY id', [input.requisitionId]);
    if (sourceLines.length !== input.lines.length) {
      throw new HttpError(422, 'The purchase order must include every requisition line.', 'ORDER_LINES');
    }
    if (new Set(input.lines.map((line) => line.requisitionLineId)).size !== input.lines.length) {
      throw new HttpError(422, 'Each requisition line can appear only once.', 'ORDER_LINES');
    }
    const priced = new Map(input.lines.map((line) => [line.requisitionLineId, line.unitCost]));
    let total = 0;
    const prepared = sourceLines.map((line) => {
      if (!priced.has(Number(line.id))) throw new HttpError(422, 'The purchase order must include every requisition line.', 'ORDER_LINES');
      const unitCost = priced.get(Number(line.id)) ?? 0;
      const amount = lineTotal(Number(line.quantity), unitCost);
      total += cents(amount);
      return { line, unitCost, amount };
    });
    const reference = await nextReference(connection, 'purchase_order', 'purchase_order_prefix');
    const created = await execute(
      connection,
      `INSERT INTO purchase_orders (company_id, reference_number, requisition_id, supplier_id, status, total_amount, issued_by)
       VALUES (?, ?, ?, ?, 'issued', ?, ?)`,
      [companyId, reference, input.requisitionId, input.supplierId, fromCents(total), auth.userId],
    );
    for (const row of prepared) {
      await execute(
        connection,
        `INSERT INTO purchase_order_lines (order_id, requisition_line_id, item_id, description, quantity, unit_cost)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [created.insertId, row.line.id, row.line.item_id, row.line.description, row.line.quantity, row.unitCost],
      );
    }
    await execute(connection, `UPDATE purchase_requisitions SET status = 'ordered' WHERE id = ?`, [input.requisitionId]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'purchase_order.issue', module: 'procurement', entityType: 'purchase_order', entityId: created.insertId,
      newValue: { reference, requisition: requisition.reference_number, total: fromCents(total) }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const order = await queryOne<RowDataPacket>(connection, `${orderSelect} WHERE o.id = ?`, [created.insertId]);
    const lines = await query<RowDataPacket[]>(connection, 'SELECT * FROM purchase_order_lines WHERE order_id = ? ORDER BY id', [created.insertId]);
    return mapOrder(order!, lines);
  });
}

export async function cancelOrder(id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const order = await queryOne<RowDataPacket>(connection, 'SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [id]);
    if (!order) throw notFound('Purchase order');
    if (order.status === 'cancelled') return { id, status: 'cancelled' as const };
    const received = await scalar(connection, 'SELECT COALESCE(SUM(received_quantity), 0) FROM purchase_order_lines WHERE order_id = ?', [id]);
    if (received > 0) throw new HttpError(409, 'A purchase order with receipts cannot be cancelled.', 'ORDER_RECEIVED');
    await execute(connection, `UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?`, [id]);
    await execute(connection, `UPDATE purchase_requisitions SET status = 'approved' WHERE id = ? AND status = 'ordered'`, [order.requisition_id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'purchase_order.cancel', module: 'procurement', entityType: 'purchase_order', entityId: id,
      previousValue: { status: order.status }, newValue: { status: 'cancelled' }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id, status: 'cancelled' as const };
  });
}

export async function listReceipts() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT g.id, g.reference_number, g.received_on, g.notes, o.reference_number AS order_reference, w.name AS warehouse_name
     FROM goods_received_notes g
     JOIN purchase_orders o ON o.id = g.purchase_order_id
     JOIN warehouses w ON w.id = g.warehouse_id
     ORDER BY g.id DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    receivedOn: String(row.received_on).slice(0, 10),
    notes: row.notes == null ? null : String(row.notes),
    orderReference: String(row.order_reference),
    warehouseName: String(row.warehouse_name),
  }));
}

export async function receiveGoods(auth: AuthContext, input: {
  purchaseOrderId: number;
  warehouseId: number;
  receivedOn: string;
  notes?: string | null;
  lines: Array<{ orderLineId: number; quantity: number; damagedQuantity: number; lotCode?: string | null; expiryDate?: string | null }>;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const order = await queryOne<RowDataPacket>(connection, 'SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [input.purchaseOrderId]);
    if (!order) throw notFound('Purchase order');
    if (!['issued', 'partial'].includes(String(order.status))) {
      throw new HttpError(409, 'Goods can be received only against an open purchase order.', 'ORDER_NOT_OPEN');
    }
    await activeWarehouse(connection, companyId, input.warehouseId);
    const orderLines = await query<RowDataPacket[]>(connection, 'SELECT * FROM purchase_order_lines WHERE order_id = ? FOR UPDATE', [input.purchaseOrderId]);
    const byId = new Map(orderLines.map((line) => [Number(line.id), line]));
    const reference = await nextReference(connection, 'goods_received', 'goods_received_prefix');
    const stockReference = await nextReference(connection, 'stock_movement', 'stock_movement_prefix');
    const created = await execute(
      connection,
      `INSERT INTO goods_received_notes (company_id, reference_number, purchase_order_id, warehouse_id, received_by, received_on, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.purchaseOrderId, input.warehouseId, auth.userId, input.receivedOn, input.notes ?? null],
    );
    let accepted = false;
    for (const line of input.lines) {
      const source = byId.get(line.orderLineId);
      if (!source) throw new HttpError(422, 'A receipt line does not belong to this purchase order.', 'INVALID_ORDER_LINE');
      const good = milli(line.quantity);
      const damaged = milli(line.damagedQuantity);
      if (good + damaged <= 0) continue;
      accepted = true;
      const outstanding = milli(source.quantity) - milli(source.received_quantity);
      if (good + damaged > outstanding) throw new HttpError(422, 'The receipt is more than the quantity still on order.', 'OVER_RECEIPT');
      await execute(
        connection,
        `INSERT INTO goods_received_lines (grn_id, order_line_id, quantity, damaged_quantity, unit_cost, lot_code, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, line.orderLineId, fromMilli(good), fromMilli(damaged), source.unit_cost, line.lotCode ?? null, line.expiryDate ?? null],
      );
      await execute(
        connection,
        'UPDATE purchase_order_lines SET received_quantity = received_quantity + ? WHERE id = ?',
        [fromMilli(good + damaged), line.orderLineId],
      );
      source.received_quantity = fromMilli(milli(source.received_quantity) + good + damaged);
      if (source.item_id != null && good > 0) {
        await changeStock(connection, {
          companyId, warehouseId: input.warehouseId, itemId: Number(source.item_id), quantity: Number(fromMilli(good)),
          direction: 'in', movementType: 'receipt', unitCost: Number(source.unit_cost),
          lotCode: line.lotCode || `${reference}-${line.orderLineId}`, expiryDate: line.expiryDate ?? null,
          sourceType: 'goods_received', sourceId: created.insertId, notes: input.notes ?? `Receipt ${reference}`,
          userId: auth.userId, reference: stockReference,
        });
      }
      if (source.item_id != null && damaged > 0) {
        await changeStock(connection, {
          companyId, warehouseId: input.warehouseId, itemId: Number(source.item_id), quantity: Number(fromMilli(damaged)),
          direction: 'in', movementType: 'receipt', unitCost: Number(source.unit_cost),
          lotCode: `${line.lotCode || reference}-DMG`, expiryDate: line.expiryDate ?? null,
          sourceType: 'goods_received', sourceId: created.insertId, notes: `Damaged on ${reference}`,
          userId: auth.userId, reference: stockReference,
        });
        await changeStock(connection, {
          companyId, warehouseId: input.warehouseId, itemId: Number(source.item_id), quantity: Number(fromMilli(damaged)),
          direction: 'out', movementType: 'damage', unitCost: Number(source.unit_cost),
          lotCode: `${line.lotCode || reference}-DMG`,
          sourceType: 'goods_received', sourceId: created.insertId, notes: `Damaged on ${reference}`,
          userId: auth.userId, reference: stockReference,
        });
      }
    }
    if (!accepted) throw new HttpError(422, 'Enter a quantity received or damaged.', 'EMPTY_RECEIPT');
    const remaining = await scalar(
      connection,
      'SELECT COALESCE(SUM(quantity - received_quantity), 0) FROM purchase_order_lines WHERE order_id = ?',
      [input.purchaseOrderId],
    );
    await execute(connection, 'UPDATE purchase_orders SET status = ? WHERE id = ?', [remaining <= 0 ? 'received' : 'partial', input.purchaseOrderId]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'goods.receive', module: 'procurement', entityType: 'goods_received_note', entityId: created.insertId,
      newValue: { reference, order: order.reference_number }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference, status: remaining <= 0 ? 'received' : 'partial' };
  });
}

export async function listInvoices() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT i.id, i.reference_number, i.invoice_number, i.invoice_date, i.amount, i.notes, s.name AS supplier_name, o.reference_number AS order_reference
     FROM supplier_invoices i
     JOIN suppliers s ON s.id = i.supplier_id
     LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
     ORDER BY i.id DESC LIMIT 200`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    invoiceNumber: String(row.invoice_number),
    invoiceDate: String(row.invoice_date).slice(0, 10),
    amount: Number(row.amount),
    notes: row.notes == null ? null : String(row.notes),
    supplierName: String(row.supplier_name),
    orderReference: row.order_reference == null ? null : String(row.order_reference),
  }));
}

export async function recordInvoice(auth: AuthContext, input: {
  supplierId: number;
  purchaseOrderId?: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  notes?: string | null;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const supplier = await queryOne<RowDataPacket>(connection, 'SELECT id, status FROM suppliers WHERE id = ? AND company_id = ?', [input.supplierId, companyId]);
    if (!supplier || supplier.status !== 'active') throw new HttpError(422, 'Choose an active supplier.', 'INVALID_SUPPLIER');
    if (input.purchaseOrderId) {
      const order = await queryOne<RowDataPacket>(connection, 'SELECT supplier_id FROM purchase_orders WHERE id = ?', [input.purchaseOrderId]);
      if (!order || Number(order.supplier_id) !== input.supplierId) {
        throw new HttpError(422, 'That purchase order is not for this supplier.', 'INVALID_ORDER');
      }
    }
    const duplicate = await queryOne<RowDataPacket>(
      connection,
      'SELECT id FROM supplier_invoices WHERE supplier_id = ? AND invoice_number = ?',
      [input.supplierId, input.invoiceNumber],
    );
    if (duplicate) throw new HttpError(409, 'That supplier invoice number is already recorded.', 'DUPLICATE_INVOICE');
    const reference = await nextReference(connection, 'supplier_invoice', 'supplier_invoice_prefix');
    const created = await execute(
      connection,
      `INSERT INTO supplier_invoices (company_id, reference_number, supplier_id, purchase_order_id, invoice_number, invoice_date, amount, outstanding, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.supplierId, input.purchaseOrderId ?? null, input.invoiceNumber, input.invoiceDate, input.amount, input.amount, input.notes ?? null, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'supplier_invoice.record', module: 'procurement', entityType: 'supplier_invoice', entityId: created.insertId,
      newValue: { reference, invoiceNumber: input.invoiceNumber, amount: input.amount }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference, invoiceNumber: input.invoiceNumber, amount: input.amount };
  });
}

export async function listBalances() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT b.warehouse_id, w.name AS warehouse_name, b.item_id, i.sku, i.name AS item_name, i.unit, b.quantity, b.average_cost
     FROM stock_balances b
     JOIN warehouses w ON w.id = b.warehouse_id
     JOIN stock_items i ON i.id = b.item_id
     WHERE b.quantity > 0
     ORDER BY w.name, i.name`,
  );
  return rows.map((row) => ({
    warehouseId: Number(row.warehouse_id),
    warehouseName: String(row.warehouse_name),
    itemId: Number(row.item_id),
    sku: String(row.sku),
    itemName: String(row.item_name),
    unit: String(row.unit),
    quantity: Number(row.quantity),
    averageCost: Number(row.average_cost),
    value: Number(fromCents(Math.round(milli(row.quantity) * cents(row.average_cost) / 1000))),
  }));
}

export async function listMovements() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT m.id, m.reference_number, m.movement_type, m.quantity, m.unit_cost, m.balance_after, m.lot_code, m.expiry_date, m.notes, m.created_at,
            w.name AS warehouse_name, i.sku, i.name AS item_name
     FROM stock_movements m
     JOIN warehouses w ON w.id = m.warehouse_id
     JOIN stock_items i ON i.id = m.item_id
     ORDER BY m.id DESC LIMIT 300`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    movementType: String(row.movement_type),
    quantity: Number(row.quantity),
    unitCost: Number(row.unit_cost),
    balanceAfter: Number(row.balance_after),
    lotCode: row.lot_code == null ? null : String(row.lot_code),
    expiryDate: row.expiry_date == null ? null : String(row.expiry_date).slice(0, 10),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: String(row.created_at),
    warehouseName: String(row.warehouse_name),
    sku: String(row.sku),
    itemName: String(row.item_name),
  }));
}

export async function postMovement(auth: AuthContext, input: {
  type: 'issue' | 'transfer' | 'adjustment' | 'damage';
  warehouseId: number;
  destinationWarehouseId?: number | null;
  itemId: number;
  quantity: number;
  direction?: 'increase' | 'decrease';
  notes: string;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    await activeWarehouse(connection, companyId, input.warehouseId);
    await activeItem(connection, companyId, input.itemId);
    const reference = await nextReference(connection, 'stock_movement', 'stock_movement_prefix');
    if (input.type === 'transfer') {
      if (!input.destinationWarehouseId || input.destinationWarehouseId === input.warehouseId) {
        throw new HttpError(422, 'Choose a different destination warehouse.', 'INVALID_WAREHOUSE');
      }
      await activeWarehouse(connection, companyId, input.destinationWarehouseId);
      const balance = await lockBalance(connection, input.warehouseId, input.itemId);
      await changeStock(connection, {
        companyId, warehouseId: input.warehouseId, itemId: input.itemId, quantity: input.quantity,
        direction: 'out', movementType: 'transfer_out', unitCost: Number(fromCents(balance.averageCost)),
        notes: input.notes, userId: auth.userId, reference,
      });
      await changeStock(connection, {
        companyId, warehouseId: input.destinationWarehouseId, itemId: input.itemId, quantity: input.quantity,
        direction: 'in', movementType: 'transfer_in', unitCost: Number(fromCents(balance.averageCost)),
        lotCode: reference, notes: input.notes, userId: auth.userId, reference,
      });
    } else if (input.type === 'adjustment') {
      const balance = await lockBalance(connection, input.warehouseId, input.itemId);
      await changeStock(connection, {
        companyId, warehouseId: input.warehouseId, itemId: input.itemId, quantity: input.quantity,
        direction: input.direction === 'increase' ? 'in' : 'out', movementType: 'adjustment',
        unitCost: Number(fromCents(balance.averageCost)),
        lotCode: input.direction === 'increase' ? reference : null, notes: input.notes, userId: auth.userId, reference,
      });
    } else {
      await changeStock(connection, {
        companyId, warehouseId: input.warehouseId, itemId: input.itemId, quantity: input.quantity,
        direction: 'out', movementType: input.type === 'damage' ? 'damage' : 'issue', unitCost: 0,
        notes: input.notes, userId: auth.userId, reference,
      });
    }
    await writeAudit(connection, {
      userId: actor.userId, action: `stock.${input.type}`, module: 'inventory', entityType: 'stock_movement', entityId: reference,
      newValue: { reference, itemId: input.itemId, quantity: input.quantity, warehouseId: input.warehouseId },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { referenceNumber: reference };
  });
}

export async function procurementSummary(range: { from: string; to: string }) {
  const requisitions = await query<RowDataPacket[]>(
    pool,
    `SELECT status, COUNT(*) AS total FROM purchase_requisitions GROUP BY status ORDER BY status`,
  );
  const openOrders = await scalar(
    pool,
    `SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders WHERE status IN ('issued', 'partial')`,
  );
  const receipts = await scalar(
    pool,
    `SELECT COUNT(*) FROM goods_received_notes WHERE received_on BETWEEN ? AND ?`,
    [range.from, range.to],
  );
  return {
    from: range.from,
    to: range.to,
    requisitions: requisitions.map((row) => ({ status: String(row.status), total: Number(row.total) })),
    openOrderAmount: Number(openOrders),
    receipts: Number(receipts),
  };
}

export function procurementReportTables(summary: Awaited<ReturnType<typeof procurementSummary>>) {
  return [
    {
      title: 'Requisitions',
      columns: ['Status', 'Total'],
      rows: summary.requisitions.map((row) => [row.status, row.total]),
    },
    {
      title: 'Orders and receipts',
      columns: ['Label', 'Value'],
      rows: [
        ['Open order amount', summary.openOrderAmount],
        ['Receipts', summary.receipts],
      ],
    },
  ];
}

export function procurementSummaryToCsv(summary: Awaited<ReturnType<typeof procurementSummary>>): string {
  const lines = ['section,label,value'];
  for (const row of summary.requisitions) lines.push(['requisitions', row.status, row.total].join(','));
  lines.push(['orders', 'open_amount', summary.openOrderAmount].join(','));
  lines.push(['receipts', 'count', summary.receipts].join(','));
  return `${lines.join('\n')}\n`;
}

export async function inventorySummary(range: { from: string; to: string }) {
  const value = await scalar(pool, 'SELECT COALESCE(SUM(quantity * average_cost), 0) FROM stock_balances');
  const belowReorder = await query<RowDataPacket[]>(
    pool,
    `SELECT i.sku, i.name, i.reorder_level, COALESCE(SUM(b.quantity), 0) AS on_hand
     FROM stock_items i
     LEFT JOIN stock_balances b ON b.item_id = i.id
     WHERE i.status = 'active' AND i.reorder_level > 0
     GROUP BY i.id
     HAVING COALESCE(SUM(b.quantity), 0) <= i.reorder_level
     ORDER BY i.sku`,
  );
  const expired = await query<RowDataPacket[]>(
    pool,
    `SELECT i.sku, i.name, w.name AS warehouse_name, l.lot_code, l.expiry_date, l.quantity
     FROM stock_lots l
     JOIN stock_items i ON i.id = l.item_id
     JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.quantity > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date < CURRENT_DATE
     ORDER BY l.expiry_date`,
  );
  const movements = await query<RowDataPacket[]>(
    pool,
    `SELECT movement_type, COUNT(*) AS total
     FROM stock_movements
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY movement_type ORDER BY movement_type`,
    [`${range.from} 00:00:00`, range.to],
  );
  return {
    from: range.from,
    to: range.to,
    stockValue: Number(Number(value).toFixed(2)),
    belowReorder: belowReorder.map((row) => ({
      sku: String(row.sku),
      name: String(row.name),
      reorderLevel: Number(row.reorder_level),
      onHand: Number(row.on_hand),
    })),
    expired: expired.map((row) => ({
      sku: String(row.sku),
      name: String(row.name),
      warehouseName: String(row.warehouse_name),
      lotCode: String(row.lot_code),
      expiryDate: String(row.expiry_date).slice(0, 10),
      quantity: Number(row.quantity),
    })),
    movements: movements.map((row) => ({ movementType: String(row.movement_type), total: Number(row.total) })),
  };
}

export function inventoryReportTables(summary: Awaited<ReturnType<typeof inventorySummary>>) {
  return [
    {
      title: 'Valuation',
      columns: ['Label', 'Amount'],
      rows: [['Stock value', summary.stockValue]],
    },
    {
      title: 'Reorder',
      columns: ['SKU', 'Item', 'On hand', 'Reorder level'],
      rows: summary.belowReorder.map((row) => [row.sku, row.name, row.onHand, row.reorderLevel]),
    },
    {
      title: 'Expired lots',
      columns: ['SKU', 'Item', 'Warehouse', 'Lot', 'Expiry', 'Quantity'],
      rows: summary.expired.map((row) => [row.sku, row.name, row.warehouseName, row.lotCode, row.expiryDate, row.quantity]),
    },
    {
      title: 'Movements',
      columns: ['Type', 'Total'],
      rows: summary.movements.map((row) => [row.movementType, row.total]),
    },
  ];
}

export function inventorySummaryToCsv(summary: Awaited<ReturnType<typeof inventorySummary>>): string {
  const lines = ['section,label,value'];
  lines.push(['valuation', 'stock_value', summary.stockValue].join(','));
  for (const row of summary.belowReorder) lines.push(['reorder', row.sku, row.onHand].join(','));
  for (const row of summary.expired) lines.push(['expired', row.sku, row.quantity].join(','));
  for (const row of summary.movements) lines.push(['movement', row.movementType, row.total].join(','));
  return `${lines.join('\n')}\n`;
}

onApprovalChange(async (db, event) => {
  if (event.sourceType === 'purchase_requisition') await syncRequisition(db, event);
});
