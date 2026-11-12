import type { RowDataPacket } from '../database/rows';
import { pool } from '../database/pool';
import { query, queryOne } from '../database/query';
import type { AuthContext } from '../types/auth';
import { hasFinalBusinessAuthority, isTechnicalAdmin } from './access';

export interface RecordVisibility {
  /** The system administrator and the CEO can see across departments. Other business roles cannot. */
  companyWide: boolean;
  /** A managerial position sees every record in the department and the units under it. */
  manager: boolean;
  departmentIds: number[];
  userId: number;
  employeeId: number | null;
}

export async function recordVisibility(auth: AuthContext): Promise<RecordVisibility> {
  const companyWide = isTechnicalAdmin(auth) || hasFinalBusinessAuthority(auth);
  if (companyWide || !auth.employeeId) {
    return { companyWide, manager: false, departmentIds: [], userId: auth.userId, employeeId: auth.employeeId };
  }
  const assignment = await queryOne<RowDataPacket>(
    pool,
    `SELECT ea.department_id, p.is_managerial
     FROM employee_assignments ea
     JOIN positions p ON p.id = ea.position_id
     WHERE ea.employee_id = ? AND ea.is_primary = 1 AND ea.end_date IS NULL`,
    [auth.employeeId],
  );
  if (!assignment?.department_id) {
    return { companyWide: false, manager: false, departmentIds: [], userId: auth.userId, employeeId: auth.employeeId };
  }
  const departmentId = Number(assignment.department_id);
  const manager = Number(assignment.is_managerial) === 1;
  const departmentIds = manager ? await departmentTree(departmentId) : [departmentId];
  return { companyWide: false, manager, departmentIds, userId: auth.userId, employeeId: auth.employeeId };
}

async function departmentTree(rootId: number): Promise<number[]> {
  const rows = await query<RowDataPacket[]>(
    pool,
    `WITH RECURSIVE tree AS (
       SELECT id FROM departments WHERE id = ?
       UNION ALL
       SELECT d.id FROM departments d JOIN tree t ON d.parent_id = t.id
     )
     SELECT id FROM tree`,
    [rootId],
  );
  return rows.map((row) => Number(row.id));
}

export function departmentClause(visibility: RecordVisibility, column: string): { sql: string; params: unknown[] } {
  if (visibility.companyWide) return { sql: '1 = 1', params: [] };
  if (visibility.departmentIds.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${visibility.departmentIds.map(() => '?').join(', ')})`, params: [...visibility.departmentIds] };
}

/** A branch is visible when it holds a department the person can already see. */
export function branchClause(visibility: RecordVisibility, branchColumn: string): { sql: string; params: unknown[] } {
  if (visibility.companyWide) return { sql: '1 = 1', params: [] };
  const departments = departmentClause(visibility, 'd.id');
  return {
    sql: `EXISTS (SELECT 1 FROM departments d WHERE d.branch_id = ${branchColumn} AND d.deleted_at IS NULL AND ${departments.sql})`,
    params: departments.params,
  };
}

/** Managers see the department's transactions. Other people see the ones they raised. */
export function transactionClause(
  visibility: RecordVisibility,
  columns: { department: string; user?: string; employee?: string },
): { sql: string; params: unknown[] } {
  if (visibility.companyWide) return { sql: '1 = 1', params: [] };
  const own: string[] = [];
  const ownParams: unknown[] = [];
  if (columns.user) {
    own.push(`${columns.user} = ?`);
    ownParams.push(visibility.userId);
  }
  if (columns.employee && visibility.employeeId) {
    own.push(`${columns.employee} = ?`);
    ownParams.push(visibility.employeeId);
  }
  const ownSql = own.length > 0 ? `(${own.join(' OR ')})` : '1 = 0';
  if (visibility.manager && visibility.departmentIds.length > 0) {
    const marks = visibility.departmentIds.map(() => '?').join(', ');
    return { sql: `(${columns.department} IN (${marks}) OR ${ownSql})`, params: [...visibility.departmentIds, ...ownParams] };
  }
  if (visibility.departmentIds.length > 0) {
    const marks = visibility.departmentIds.map(() => '?').join(', ');
    return {
      sql: `(${ownSql} AND (${columns.department} IN (${marks}) OR ${columns.department} IS NULL))`,
      params: [...ownParams, ...visibility.departmentIds],
    };
  }
  return { sql: ownSql, params: ownParams };
}
