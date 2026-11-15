import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { requireCompanyId } from '../../services/companyContext';
import { governanceSettings, segregationCatalog } from '../../services/governance';
import { notifyUsersWithPermission } from '../../services/notify';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

/** Governance changes are configuration of company policy. The CEO is told about every change. */
async function tellExecutive(db: Db, actor: Actor, title: string, body: string) {
  await notifyUsersWithPermission(db, 'executive.review', {
    title, body, notificationType: 'governance.changed', entityType: 'governance', excludeUserId: actor.userId,
  });
}

export async function listSegregationRules() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM segregation_rules');
  const stored = new Map(rows.map((row) => [String(row.code), row]));
  return segregationCatalog.map((rule) => {
    const row = stored.get(rule.code);
    return {
      code: rule.code,
      name: rule.name,
      description: rule.description,
      locked: rule.locked,
      enabled: rule.locked ? true : row ? Number(row.enabled) === 1 : rule.enabled,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export async function setSegregationRule(code: string, enabled: boolean, reason: string, actor: Actor) {
  const rule = segregationCatalog.find((item) => item.code === code);
  if (!rule) throw notFound('Separation-of-duty rule');
  if (rule.locked && !enabled) throw new HttpError(422, `${rule.name} is a mandatory control and cannot be switched off.`, 'RULE_LOCKED');
  return withTransaction(async (connection) => {
    const existing = await queryOne<RowDataPacket>(connection, 'SELECT * FROM segregation_rules WHERE code = ? FOR UPDATE', [code]);
    const previous = existing ? Number(existing.enabled) === 1 : rule.enabled;
    if (existing) {
      await execute(connection, 'UPDATE segregation_rules SET enabled = ?, updated_by = ? WHERE code = ?', [enabled ? 1 : 0, actor.userId, code]);
    } else {
      await execute(
        connection,
        `INSERT INTO segregation_rules (code, name, description, enabled, is_locked, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
        [code, rule.name, rule.description, enabled ? 1 : 0, rule.locked ? 1 : 0, actor.userId],
      );
    }
    await writeAudit(connection, {
      userId: actor.userId, action: 'governance.segregation', module: 'governance', entityType: 'segregation_rule', entityId: code,
      previousValue: { enabled: previous }, newValue: { enabled, reason }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    await tellExecutive(connection, actor, 'Separation-of-duty control changed', `${rule.name} was switched ${enabled ? 'on' : 'off'}. Reason: ${reason}`);
    return { code, enabled };
  });
}

function mapLimit(row: RowDataPacket) {
  return {
    id: Number(row.id),
    roleCode: String(row.role_code),
    roleName: row.role_name == null ? null : String(row.role_name),
    workflowId: row.workflow_id == null ? null : Number(row.workflow_id),
    workflowCode: row.workflow_code == null ? null : String(row.workflow_code),
    departmentId: row.department_id == null ? null : Number(row.department_id),
    departmentName: row.department_name == null ? null : String(row.department_name),
    maxAmount: row.max_amount == null ? null : Number(row.max_amount),
    notes: row.notes == null ? null : String(row.notes),
    status: String(row.status),
  };
}

const limitSelect = `
  SELECT l.*, r.name AS role_name, w.code AS workflow_code, d.name AS department_name
  FROM approval_authority_limits l
  LEFT JOIN roles r ON r.code = l.role_code
  LEFT JOIN workflows w ON w.id = l.workflow_id
  LEFT JOIN departments d ON d.id = l.department_id
`;

export async function listAuthorityLimits() {
  const rows = await query<RowDataPacket[]>(pool, `${limitSelect} ORDER BY l.status, l.role_code, l.id`);
  return rows.map(mapLimit);
}

export interface LimitInput {
  roleCode: string;
  workflowId?: number | null;
  departmentId?: number | null;
  maxAmount: number | null;
  notes?: string | null;
}

async function assertLimitReferences(db: Db, input: LimitInput) {
  const role = await queryOne<RowDataPacket>(db, `SELECT id, is_technical_admin FROM roles WHERE code = ? AND status = 'active'`, [input.roleCode]);
  if (!role) throw new HttpError(422, 'Choose an active role.', 'INVALID_ROLE');
  if (Number(role.is_technical_admin) === 1) throw new HttpError(422, 'A technical administration role cannot hold spending authority.', 'TECHNICAL_ROLE');
  if (input.workflowId) {
    const workflow = await queryOne<RowDataPacket>(db, 'SELECT id FROM workflows WHERE id = ?', [input.workflowId]);
    if (!workflow) throw new HttpError(422, 'That workflow does not exist.', 'INVALID_WORKFLOW');
  }
  if (input.departmentId) {
    const department = await queryOne<RowDataPacket>(db, 'SELECT id FROM departments WHERE id = ?', [input.departmentId]);
    if (!department) throw new HttpError(422, 'That department does not exist.', 'INVALID_DEPARTMENT');
  }
}

export async function createAuthorityLimit(input: LimitInput, actor: Actor) {
  return withTransaction(async (connection) => {
    await assertLimitReferences(connection, input);
    const companyId = await requireCompanyId(connection);
    const duplicate = await queryOne<RowDataPacket>(
      connection,
      `SELECT id FROM approval_authority_limits WHERE status = 'active' AND role_code = ?
         AND workflow_id IS NOT DISTINCT FROM ? AND department_id IS NOT DISTINCT FROM ?`,
      [input.roleCode, input.workflowId ?? null, input.departmentId ?? null],
    );
    if (duplicate) throw new HttpError(409, 'An active limit already covers this role, workflow, and department. Edit it instead.', 'DUPLICATE_LIMIT');
    const result = await execute(
      connection,
      `INSERT INTO approval_authority_limits (company_id, role_code, workflow_id, department_id, max_amount, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [companyId, input.roleCode, input.workflowId ?? null, input.departmentId ?? null, input.maxAmount, input.notes ?? null, actor.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'governance.limit.create', module: 'governance', entityType: 'approval_authority_limit', entityId: result.insertId,
      newValue: input, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    await tellExecutive(connection, actor, 'Approval limit added', `${input.roleCode}: ${input.maxAmount === null ? 'unlimited' : input.maxAmount.toFixed(2)}.`);
    return mapLimit((await queryOne<RowDataPacket>(connection, `${limitSelect} WHERE l.id = ?`, [result.insertId]))!);
  });
}

export async function updateAuthorityLimit(id: number, input: { maxAmount?: number | null; notes?: string | null; status?: 'active' | 'inactive' }, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM approval_authority_limits WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Approval limit');
    const next = {
      maxAmount: input.maxAmount === undefined ? (row.max_amount == null ? null : Number(row.max_amount)) : input.maxAmount,
      notes: input.notes === undefined ? row.notes : input.notes,
      status: input.status ?? String(row.status),
    };
    await execute(connection, 'UPDATE approval_authority_limits SET max_amount = ?, notes = ?, status = ? WHERE id = ?', [next.maxAmount, next.notes, next.status, id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'governance.limit.update', module: 'governance', entityType: 'approval_authority_limit', entityId: id,
      previousValue: { maxAmount: row.max_amount == null ? null : Number(row.max_amount), notes: row.notes, status: row.status },
      newValue: next, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    await tellExecutive(connection, actor, 'Approval limit changed', `${row.role_code}: ${next.maxAmount === null ? 'unlimited' : Number(next.maxAmount).toFixed(2)} (${next.status}).`);
    return mapLimit((await queryOne<RowDataPacket>(connection, `${limitSelect} WHERE l.id = ?`, [id]))!);
  });
}

export async function getSettings() {
  return governanceSettings(pool);
}

export async function updateSettings(input: { executiveThreshold?: number | null; escalationHours?: number; escalationRoleCode?: string }, actor: Actor) {
  return withTransaction(async (connection) => {
    const previous = await governanceSettings(connection);
    if (input.escalationRoleCode) {
      const role = await queryOne<RowDataPacket>(connection, `SELECT id, is_technical_admin FROM roles WHERE code = ? AND status = 'active'`, [input.escalationRoleCode]);
      if (!role || Number(role.is_technical_admin) === 1) throw new HttpError(422, 'Choose an active business role for escalation.', 'INVALID_ROLE');
    }
    const entries: Array<[string, string]> = [];
    if (input.executiveThreshold !== undefined) entries.push(['executive_approval_threshold', input.executiveThreshold === null ? 'null' : JSON.stringify(input.executiveThreshold)]);
    if (input.escalationHours !== undefined) entries.push(['approval_escalation_hours', JSON.stringify(input.escalationHours)]);
    if (input.escalationRoleCode !== undefined) entries.push(['approval_escalation_role', JSON.stringify(input.escalationRoleCode)]);
    for (const [key, value] of entries) {
      await execute(
        connection,
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [key, value, actor.userId],
      );
    }
    const next = await governanceSettings(connection);
    await writeAudit(connection, {
      userId: actor.userId, action: 'governance.settings', module: 'governance', entityType: 'system_settings', entityId: 'approval_governance',
      previousValue: previous, newValue: next, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    await tellExecutive(connection, actor, 'Approval governance settings changed',
      `Executive threshold ${next.executiveThreshold === null ? 'off' : next.executiveThreshold.toFixed(2)}, escalation after ${next.escalationHours} hours to ${next.escalationRoleCode}.`);
    return next;
  });
}

/** The management structure: each department, its head position, who holds it, and the reporting line. */
export async function organisationChart(showNames: boolean) {
  const companyId = await requireCompanyId(pool);
  const positions = await query<RowDataPacket[]>(
    pool,
    `SELECT p.id, p.code, p.title, p.department_id, p.reports_to_position_id, p.is_managerial, d.name AS department_name, d.code AS department_code
     FROM positions p LEFT JOIN departments d ON d.id = p.department_id
     WHERE p.company_id = ? AND p.status = 'active'
     ORDER BY p.id`,
    [companyId],
  );
  const holders = await query<RowDataPacket[]>(
    pool,
    `SELECT ea.position_id, e.first_name, e.last_name
     FROM employee_assignments ea JOIN employees e ON e.id = ea.employee_id AND e.deleted_at IS NULL
     WHERE ea.end_date IS NULL`,
  );
  return positions.map((position) => {
    const people = holders.filter((holder) => Number(holder.position_id) === Number(position.id));
    return {
      id: Number(position.id),
      code: String(position.code),
      title: String(position.title),
      departmentId: position.department_id == null ? null : Number(position.department_id),
      departmentCode: position.department_code == null ? null : String(position.department_code),
      departmentName: position.department_name == null ? null : String(position.department_name),
      reportsToPositionId: position.reports_to_position_id == null ? null : Number(position.reports_to_position_id),
      isManagerial: Number(position.is_managerial) === 1,
      holderCount: people.length,
      holders: showNames ? people.map((person) => `${person.first_name} ${person.last_name}`) : [],
    };
  });
}
