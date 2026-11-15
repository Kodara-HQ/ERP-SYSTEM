import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, scalar, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasPermission, isTechnicalAdmin } from '../../services/access';
import { requireCompanyId } from '../../services/companyContext';
import { notifyUsersWithPermission } from '../../services/notify';
import { workspaceAllows, workspaceGate } from '../../services/workspaces';
import type { ReportTable } from '../../services/reportFiles';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { registerByCode, registerCatalog, type RegisterDefinition } from './registerCatalog';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };
type Access = 'manage' | 'view' | 'self' | 'none';

/**
 * Register access is decided on the server: the department workspace must be open to the user and the
 * register permission held. Technical administrators do not read department registers. A self-service
 * register lets staff raise records and read only their own.
 */
export async function accessTo(auth: AuthContext, register: RegisterDefinition): Promise<Access> {
  if (isTechnicalAdmin(auth)) return register.selfServicePermission && hasPermission(auth, register.selfServicePermission) ? 'self' : 'none';
  const gate = await workspaceGate(auth);
  const open = workspaceAllows(gate, register.workspace);
  if (open && hasPermission(auth, register.managePermission)) return 'manage';
  if (open && hasPermission(auth, register.viewPermission)) return 'view';
  if (register.selfServicePermission && hasPermission(auth, register.selfServicePermission)) return 'self';
  return 'none';
}

async function requireRegister(auth: AuthContext, code: string, need: 'read' | 'write') {
  const register = registerByCode(code);
  if (!register) throw notFound('Register');
  const access = await accessTo(auth, register);
  if (access === 'none') throw new HttpError(403, 'This register belongs to another department.', 'WORKSPACE_DENIED');
  if (need === 'write' && access === 'view') throw new HttpError(403, 'You can view this register but not change it.', 'FORBIDDEN');
  return { register, access };
}

export async function listRegisters(auth: AuthContext) {
  const result = [];
  for (const register of registerCatalog) {
    const access = await accessTo(auth, register);
    if (access === 'none') continue;
    result.push({
      code: register.code, name: register.name, description: register.description, group: register.group,
      statuses: register.statuses, fields: register.fields, access, dueAlertDays: register.dueAlertDays ?? null,
    });
  }
  return result;
}

function mapEntry(register: RegisterDefinition, row: RowDataPacket) {
  const details = (typeof row.details === 'string' ? JSON.parse(row.details) : row.details ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = { ...details };
  for (const field of register.fields) {
    if (field.column === 'title') values[field.key] = row.title;
    if (field.column === 'entry_date') values[field.key] = row.entry_date ?? null;
    if (field.column === 'due_on') values[field.key] = row.due_on ?? null;
    if (field.column === 'amount') values[field.key] = row.amount == null ? null : Number(row.amount);
    if (field.column === 'quantity') values[field.key] = row.quantity == null ? null : Number(row.quantity);
  }
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    status: String(row.status),
    departmentName: row.department_name == null ? null : String(row.department_name),
    createdBy: String(row.created_by_username),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    values,
  };
}

function normalise(register: RegisterDefinition, input: Record<string, unknown>, partial: boolean) {
  const columns: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  for (const field of register.fields) {
    const present = Object.prototype.hasOwnProperty.call(input, field.key);
    let value = input[field.key];
    if (!present) {
      if (!partial && field.required) throw new HttpError(422, `${field.label} is required.`, 'VALIDATION_ERROR');
      continue;
    }
    if (value === '' || value === undefined) value = null;
    if (value === null && field.required) throw new HttpError(422, `${field.label} is required.`, 'VALIDATION_ERROR');
    if (value !== null) {
      if (field.type === 'number') {
        const number = Number(value);
        if (!Number.isFinite(number) || Math.abs(number) > 999999999999) throw new HttpError(422, `${field.label} must be a number.`, 'VALIDATION_ERROR');
        value = number;
      } else if (field.type === 'date') {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(422, `${field.label} must be a date.`, 'VALIDATION_ERROR');
      } else if (field.type === 'select') {
        if (!field.options?.includes(String(value))) throw new HttpError(422, `${field.label} must be one of ${field.options?.join(', ')}.`, 'VALIDATION_ERROR');
        value = String(value);
      } else {
        const text = String(value).trim();
        const max = field.type === 'textarea' ? 4000 : 200;
        if (text.length > max) throw new HttpError(422, `${field.label} is too long.`, 'VALIDATION_ERROR');
        value = text;
      }
    }
    if (field.column) columns[field.column] = value;
    else details[field.key] = value;
  }
  return { columns, details };
}

const entrySelect = `
  SELECT e.*, d.name AS department_name, u.username AS created_by_username
  FROM department_register_entries e
  LEFT JOIN departments d ON d.id = e.department_id
  JOIN users u ON u.id = e.created_by
`;

export async function listEntries(auth: AuthContext, code: string, filters: { status?: string; search?: string }) {
  const { register, access } = await requireRegister(auth, code, 'read');
  const where = ['e.register_code = ?'];
  const params: unknown[] = [register.code];
  if (access === 'self') { where.push('e.created_by = ?'); params.push(auth.userId); }
  if (filters.status) { where.push('e.status = ?'); params.push(filters.status); }
  if (filters.search) {
    where.push(`(e.title LIKE ? ESCAPE '\\\\' OR e.reference_number LIKE ? ESCAPE '\\\\')`);
    const term = `%${filters.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    params.push(term, term);
  }
  const rows = await query<RowDataPacket[]>(pool, `${entrySelect} WHERE ${where.join(' AND ')} ORDER BY COALESCE(e.entry_date, CAST(e.created_at AS DATE)) DESC, e.id DESC LIMIT 1000`, params);
  return { register: { code: register.code, name: register.name, fields: register.fields, statuses: register.statuses, access }, data: rows.map((row) => mapEntry(register, row)) };
}

async function nextRegisterReference(db: Db, register: RegisterDefinition): Promise<string> {
  const key = `register_${register.code}`;
  await execute(db, `INSERT INTO reference_sequences (sequence_key, next_value) VALUES (?, 1) ON DUPLICATE KEY UPDATE sequence_key = sequence_key`, [key]);
  const row = await queryOne<RowDataPacket>(db, 'SELECT next_value FROM reference_sequences WHERE sequence_key = ? FOR UPDATE', [key]);
  const value = Number(row?.next_value ?? 1);
  await db.query('UPDATE reference_sequences SET next_value = next_value + 1 WHERE sequence_key = ?', [key]);
  return `${register.prefix}-${String(value).padStart(5, '0')}`;
}

async function primaryDepartment(db: Db, auth: AuthContext): Promise<number | null> {
  if (!auth.employeeId) return null;
  const row = await queryOne<RowDataPacket>(db, 'SELECT department_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL', [auth.employeeId]);
  return row?.department_id == null ? null : Number(row.department_id);
}

export async function createEntry(auth: AuthContext, code: string, input: { status?: string; values: Record<string, unknown> }, actor: Actor) {
  const { register, access } = await requireRegister(auth, code, 'write');
  const status = access === 'self' ? register.statuses[0]! : input.status ?? register.statuses[0]!;
  if (!register.statuses.includes(status)) throw new HttpError(422, `Status must be one of ${register.statuses.join(', ')}.`, 'VALIDATION_ERROR');
  const { columns, details } = normalise(register, input.values, false);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const reference = await nextRegisterReference(connection, register);
    const departmentId = await primaryDepartment(connection, auth);
    const result = await execute(
      connection,
      `INSERT INTO department_register_entries (company_id, register_code, reference_number, department_id, title, status, entry_date, due_on, amount, quantity, details, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, register.code, reference, departmentId, columns.title, status, columns.entry_date ?? null, columns.due_on ?? null,
        columns.amount ?? null, columns.quantity ?? null, JSON.stringify(details), auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: `register.${register.code}.create`, module: register.workspace, entityType: 'register_entry', entityId: result.insertId,
      newValue: { reference, status, ...columns, ...details }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    if (register.selfServicePermission && access === 'self') {
      await notifyUsersWithPermission(connection, register.managePermission, {
        title: `New ${register.name.toLowerCase()} request: ${reference}`, body: String(columns.title), notificationType: 'register.created',
        entityType: 'register_entry', entityId: result.insertId, excludeUserId: auth.userId,
      });
    }
    return mapEntry(register, (await queryOne<RowDataPacket>(connection, `${entrySelect} WHERE e.id = ?`, [result.insertId]))!);
  });
}

export async function updateEntry(auth: AuthContext, code: string, id: number, input: { status?: string; values?: Record<string, unknown> }, actor: Actor) {
  const { register, access } = await requireRegister(auth, code, 'write');
  if (access === 'self') throw new HttpError(403, 'Only the department that owns this register can update its records.', 'FORBIDDEN');
  if (input.status && !register.statuses.includes(input.status)) throw new HttpError(422, `Status must be one of ${register.statuses.join(', ')}.`, 'VALIDATION_ERROR');
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM department_register_entries WHERE id = ? AND register_code = ? FOR UPDATE', [id, register.code]);
    if (!row) throw notFound('Record');
    const before = mapEntry(register, { ...row, created_by_username: '' } as RowDataPacket);
    const { columns, details } = normalise(register, input.values ?? {}, true);
    const mergedDetails = { ...(typeof row.details === 'string' ? JSON.parse(row.details) : row.details ?? {}), ...details };
    const next = {
      title: columns.title ?? row.title,
      status: input.status ?? String(row.status),
      entry_date: 'entry_date' in columns ? columns.entry_date : row.entry_date,
      due_on: 'due_on' in columns ? columns.due_on : row.due_on,
      amount: 'amount' in columns ? columns.amount : row.amount,
      quantity: 'quantity' in columns ? columns.quantity : row.quantity,
    };
    await execute(
      connection,
      `UPDATE department_register_entries SET title = ?, status = ?, entry_date = ?, due_on = ?, amount = ?, quantity = ?, details = ?, updated_by = ? WHERE id = ?`,
      [next.title, next.status, next.entry_date ?? null, next.due_on ?? null, next.amount ?? null, next.quantity ?? null, JSON.stringify(mergedDetails), auth.userId, id],
    );
    const saved = mapEntry(register, (await queryOne<RowDataPacket>(connection, `${entrySelect} WHERE e.id = ?`, [id]))!);
    await writeAudit(connection, {
      userId: actor.userId, action: `register.${register.code}.update`, module: register.workspace, entityType: 'register_entry', entityId: id,
      previousValue: { status: before.status, ...before.values }, newValue: { status: saved.status, ...saved.values }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return saved;
  });
}

export async function registerTables(auth: AuthContext, code: string): Promise<{ title: string; tables: ReportTable[] }> {
  const { register, data } = await listEntries(auth, code, {});
  return {
    title: register.name,
    tables: [{
      title: register.name,
      columns: ['Reference', 'Status', ...register.fields.map((field) => field.label), 'Recorded by'],
      rows: data.map((row) => [row.referenceNumber, row.status, ...register.fields.map((field) => {
        const value = row.values[field.key];
        return value == null ? '' : typeof value === 'number' ? value : String(value);
      }), row.createdBy]),
    }],
  };
}

/** Open records due within each register's alert window, limited to registers the user may read. */
export async function dueAlerts(auth: AuthContext) {
  const alerts = [];
  for (const register of registerCatalog.filter((item) => item.dueAlertDays)) {
    const access = await accessTo(auth, register);
    if (access !== 'manage' && access !== 'view') continue;
    const closed = register.closedStatuses;
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT id, reference_number, title, status, due_on FROM department_register_entries
       WHERE register_code = ? AND due_on IS NOT NULL AND due_on <= (CURRENT_DATE + (? * INTERVAL '1 day'))
         ${closed.length ? `AND status NOT IN (${closed.map(() => '?').join(', ')})` : ''}
       ORDER BY due_on LIMIT 20`,
      [register.code, register.dueAlertDays, ...closed],
    );
    for (const row of rows) {
      alerts.push({ register: register.code, registerName: register.name, id: Number(row.id), referenceNumber: String(row.reference_number), title: String(row.title), status: String(row.status), dueOn: String(row.due_on) });
    }
  }
  return alerts;
}

/** Daily renewal and service reminders to the owning department. Each record is notified at most once a day. */
export async function notifyDueRecords(): Promise<number> {
  let sent = 0;
  for (const register of registerCatalog.filter((item) => item.dueAlertDays)) {
    const closed = register.closedStatuses;
    const rows = await query<RowDataPacket[]>(
      pool,
      `SELECT e.id, e.reference_number, e.title, e.due_on FROM department_register_entries e
       WHERE e.register_code = ? AND e.due_on IS NOT NULL AND e.due_on <= (CURRENT_DATE + (? * INTERVAL '1 day'))
         ${closed.length ? `AND e.status NOT IN (${closed.map(() => '?').join(', ')})` : ''}
         AND NOT EXISTS (
           SELECT 1 FROM notifications n WHERE n.entity_type = 'register_entry' AND n.entity_id = CAST(e.id AS VARCHAR)
             AND n.notification_type = 'register.due' AND n.created_at > (CURRENT_TIMESTAMP - INTERVAL '1 day')
         )`,
      [register.code, register.dueAlertDays, ...closed],
    );
    for (const row of rows) {
      await notifyUsersWithPermission(pool, register.managePermission, {
        title: `Due soon: ${row.reference_number}`,
        body: `${register.name}: ${row.title} is due on ${row.due_on}.`,
        notificationType: 'register.due',
        entityType: 'register_entry',
        entityId: Number(row.id),
      });
      sent += 1;
    }
  }
  return sent;
}

export async function registerSummary(auth: AuthContext) {
  const result: Record<string, { total: number; open: number; quantity: number; amount: number }> = {};
  for (const register of registerCatalog) {
    const access = await accessTo(auth, register);
    if (access !== 'manage' && access !== 'view') continue;
    const closed = register.closedStatuses;
    const total = await scalar(pool, 'SELECT COUNT(*) FROM department_register_entries WHERE register_code = ?', [register.code]);
    const open = closed.length
      ? await scalar(pool, `SELECT COUNT(*) FROM department_register_entries WHERE register_code = ? AND status NOT IN (${closed.map(() => '?').join(', ')})`, [register.code, ...closed])
      : total;
    const sums = await queryOne<RowDataPacket>(pool, 'SELECT COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(amount), 0) AS amount FROM department_register_entries WHERE register_code = ?', [register.code]);
    result[register.code] = { total, open, quantity: Number(sums?.quantity ?? 0), amount: Number(sums?.amount ?? 0) };
  }
  return result;
}
