import type { RowDataPacket } from '../database/rows';
import type { Db } from '../database/query';
import { execute, query, queryOne } from '../database/query';
import { writeAudit } from './auditService';
import { nextReference } from './companyContext';

/**
 * Every manager is an employee. Each management role has its home department and head position.
 * Listed in reporting order: the CEO first, so department heads can report to the CEO.
 */
export const managerPlacements: Array<{ roleCode: string; departmentCode: string; positionCode: string }> = [
  { roleCode: 'CEO', departmentCode: 'EXEC', positionCode: 'CEO' },
  { roleCode: 'HR_MANAGER', departmentCode: 'HR', positionCode: 'HR-MANAGER' },
  { roleCode: 'OPERATIONS_MANAGER', departmentCode: 'OPS', positionCode: 'OPS-MANAGER' },
  { roleCode: 'ACCOUNTS_OFFICER', departmentCode: 'FIN', positionCode: 'ACCOUNTS-OFFICER' },
  { roleCode: 'LEGAL_AFFAIRS', departmentCode: 'LEG', positionCode: 'LEGAL-OFFICER' },
  { roleCode: 'IT_MARKETING_MANAGER', departmentCode: 'ITM', positionCode: 'IT-MARKETING-MANAGER' },
];

/** A starting name from the login (franco → Franco, ama.mensah → Ama Mensah). HR corrects it on the employee record. */
function namesFrom(username: string): { first: string; last: string } {
  const parts = username.split(/[._\-\s]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  return { first: parts[0] ?? username, last: parts.slice(1).join(' ') };
}

function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

async function headOffice(db: Db, companyId: number, actorUserId: number | null): Promise<number> {
  const branch = await queryOne<RowDataPacket>(db, `SELECT id FROM branches WHERE company_id = ? AND status = 'active' ORDER BY id LIMIT 1`, [companyId]);
  if (branch) return Number(branch.id);
  // An employee needs a branch. A company with none gets its head office, which the administrator can rename.
  const created = await execute(db, `INSERT INTO branches (company_id, code, name, is_head_office, status) VALUES (?, 'HQ', 'Head Office', 1, 'active')`, [companyId]);
  await writeAudit(db, { userId: actorUserId, action: 'branch.create', module: 'organisation', entityType: 'branch', entityId: created.insertId, newValue: { code: 'HQ', name: 'Head Office', reason: 'Needed to place managers as employees.' } });
  return created.insertId;
}

async function ceoEmployee(db: Db): Promise<number | null> {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT ea.employee_id FROM employee_assignments ea JOIN positions p ON p.id = ea.position_id AND p.code = 'CEO'
     WHERE ea.is_primary = 1 AND ea.end_date IS NULL ORDER BY ea.id LIMIT 1`,
  );
  return row ? Number(row.employee_id) : null;
}

/**
 * Makes sure a user who holds a management role is an employee placed in that role's department and head
 * position, and linked to the login. Does nothing for other users or for logins already linked to an employee.
 * Returns the employee id created, or null.
 */
export async function ensureManagerEmployee(db: Db, userId: number, actorUserId: number | null): Promise<number | null> {
  const user = await queryOne<RowDataPacket>(db, `SELECT id, username, email, employee_id, created_at FROM users WHERE id = ? AND status = 'active'`, [userId]);
  if (!user || user.employee_id != null) return null;
  const roles = await query<RowDataPacket[]>(
    db,
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     WHERE ur.user_id = ? AND (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE) AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
    [userId],
  );
  const placement = managerPlacements.find((item) => roles.some((role) => String(role.code) === item.roleCode));
  if (!placement) return null;
  const position = await queryOne<RowDataPacket>(
    db,
    `SELECT p.id, p.company_id, d.id AS department_id FROM positions p JOIN departments d ON d.code = ? AND d.company_id = p.company_id AND d.status = 'active'
     WHERE p.code = ? AND p.status = 'active' ORDER BY p.id LIMIT 1`,
    [placement.departmentCode, placement.positionCode],
  );
  if (!position) return null;
  const companyId = Number(position.company_id);
  const branchId = await headOffice(db, companyId, actorUserId);
  const supervisor = placement.roleCode === 'CEO' ? null : await ceoEmployee(db);
  const names = namesFrom(String(user.username));
  const emailTaken = await queryOne<RowDataPacket>(db, 'SELECT id FROM employees WHERE company_id = ? AND LOWER(work_email) = LOWER(?)', [companyId, user.email]);
  const startDate = isoDate(user.created_at);
  const employeeNumber = await nextReference(db, 'employee', 'employee_number_prefix');
  const employee = await execute(
    db,
    `INSERT INTO employees (company_id, employee_number, first_name, last_name, work_email, hire_date, employment_status, confidentiality_level)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 'standard')`,
    [companyId, employeeNumber, names.first, names.last, emailTaken ? null : user.email, startDate],
  );
  const employeeId = employee.insertId;
  await execute(db, `INSERT INTO employment_records (employee_id, employment_type, start_date, status, created_by) VALUES (?, 'permanent', ?, 'active', ?)`, [employeeId, startDate, actorUserId]);
  await execute(
    db,
    `INSERT INTO employee_assignments (employee_id, department_id, position_id, branch_id, supervisor_employee_id, assignment_type, is_primary, start_date, reason, created_by)
     VALUES (?, ?, ?, ?, ?, 'substantive', 1, ?, ?, ?)`,
    [employeeId, position.department_id, position.id, branchId, supervisor, startDate, 'Placed automatically from the management role.', actorUserId],
  );
  if (supervisor) {
    await execute(db, `INSERT INTO reporting_relationships (employee_id, reports_to_employee_id, relationship_type, is_primary, start_date, created_by) VALUES (?, ?, 'line', 1, ?, ?)`,
      [employeeId, supervisor, startDate, actorUserId]);
  }
  await execute(db, 'UPDATE users SET employee_id = ? WHERE id = ?', [employeeId, userId]);
  await writeAudit(db, {
    userId: actorUserId, action: 'employee.create_for_manager', module: 'employees', entityType: 'employee', entityId: employeeId,
    newValue: { employeeNumber, userId, username: user.username, role: placement.roleCode, department: placement.departmentCode, position: placement.positionCode, reportsTo: supervisor },
  });
  return employeeId;
}

/**
 * Links every manager login that is not yet an employee, CEO first. Department heads placed before a CEO
 * existed are then given the CEO as their supervisor.
 */
export async function ensureAllManagerEmployees(db: Db, actorUserId: number | null = null): Promise<number> {
  let created = 0;
  for (const placement of managerPlacements) {
    const users = await query<RowDataPacket[]>(
      db,
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.code = ? AND r.status = 'active'
       WHERE u.employee_id IS NULL AND u.status = 'active' AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE) ORDER BY u.id`,
      [placement.roleCode],
    );
    for (const user of users) {
      if (await ensureManagerEmployee(db, Number(user.id), actorUserId)) created += 1;
    }
  }
  const ceo = await ceoEmployee(db);
  if (ceo) {
    const heads = await query<RowDataPacket[]>(
      db,
      `SELECT ea.id, ea.employee_id, ea.start_date FROM employee_assignments ea JOIN positions p ON p.id = ea.position_id
       WHERE ea.is_primary = 1 AND ea.end_date IS NULL AND ea.supervisor_employee_id IS NULL AND ea.employee_id <> ?
         AND p.code IN (${managerPlacements.filter((item) => item.roleCode !== 'CEO').map(() => '?').join(', ')})`,
      [ceo, ...managerPlacements.filter((item) => item.roleCode !== 'CEO').map((item) => item.positionCode)],
    );
    for (const head of heads) {
      await execute(db, 'UPDATE employee_assignments SET supervisor_employee_id = ? WHERE id = ?', [ceo, head.id]);
      const line = await queryOne<RowDataPacket>(db, `SELECT id FROM reporting_relationships WHERE employee_id = ? AND reports_to_employee_id = ? AND end_date IS NULL`, [head.employee_id, ceo]);
      if (!line) {
        await execute(db, `INSERT INTO reporting_relationships (employee_id, reports_to_employee_id, relationship_type, is_primary, start_date, created_by) VALUES (?, ?, 'line', 1, ?, ?)`,
          [head.employee_id, ceo, isoDate(head.start_date), actorUserId]);
      }
    }
  }
  return created;
}
