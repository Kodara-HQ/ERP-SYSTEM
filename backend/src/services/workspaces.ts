import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from '../database/rows';
import { pool } from '../database/pool';
import { query, scalar } from '../database/query';
import { hasFinalBusinessAuthority, hasPermission, isTechnicalAdmin } from './access';
import { recordVisibility, type RecordVisibility } from './visibility';
import type { AuthContext } from '../types/auth';
import { HttpError } from '../utils/httpError';

const technicalWorkspaces = ['organisation', 'administration', 'people'];

export interface WorkspaceGate {
  /** `all` follows the caller's permissions. `listed` is the department configuration. */
  mode: 'all' | 'listed';
  codes: string[];
}

export async function workspaceGate(auth: AuthContext): Promise<WorkspaceGate> {
  if (hasFinalBusinessAuthority(auth)) {
    return { mode: 'all', codes: [] };
  }
  if (isTechnicalAdmin(auth)) {
    return { mode: 'listed', codes: [...technicalWorkspaces] };
  }
  if (!auth.employeeId) {
    return roleHome(auth);
  }
  const visibility = await recordVisibility(auth);
  if (visibility.departmentIds.length === 0) {
    return roleHome(auth);
  }
  const marks = visibility.departmentIds.map(() => '?').join(', ');
  const configured = await scalar(
    pool,
    `SELECT COUNT(*) FROM department_workspaces WHERE department_id IN (${marks})`,
    visibility.departmentIds,
  );
  if (configured === 0) {
    return { mode: 'all', codes: [] };
  }
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT DISTINCT workspace_code FROM department_workspaces WHERE department_id IN (${marks})`,
    visibility.departmentIds,
  );
  // A role always works in its own department's workspaces, even when the person is placed elsewhere,
  // so an HR Manager keeps HR and People whatever department their employee record sits in.
  const codes = new Set([...rows.map((row) => String(row.workspace_code)), ...roleHome(auth).codes]);
  return { mode: 'listed', codes: [...codes] };
}

/**
 * The home department of each business role. An account that is not yet linked to an employee with a
 * department (for example an HR Manager setting up the company before any employee is registered) works
 * in its role's own department workspaces. Permissions still apply, so this never opens another
 * department's records.
 */
export const roleHomeWorkspaces: Record<string, string[]> = {
  HR_MANAGER: ['hr', 'people'],
  HR_OFFICER: ['hr', 'people'],
  OPERATIONS_MANAGER: ['operations', 'procurement', 'inventory', 'people'],
  ACCOUNTS_OFFICER: ['finance', 'people'],
  ACCOUNTS_CLERK: ['finance'],
  LEGAL_AFFAIRS: ['legal', 'people'],
  IT_MARKETING_MANAGER: ['it', 'marketing', 'people', 'website'],
  IT_OFFICER: ['it'],
  MARKETING_OFFICER: ['marketing', 'website'],
  PROCUREMENT_OFFICER: ['procurement'],
  PURCHASE_CLERK: ['procurement'],
  STOREKEEPER: ['inventory'],
  FARM_SUPERVISOR: ['operations'],
  DRIVER: ['operations'],
};

function roleHome(auth: AuthContext): WorkspaceGate {
  const codes = new Set<string>();
  for (const grant of auth.grants) {
    for (const code of roleHomeWorkspaces[grant.roleCode] ?? []) codes.add(code);
  }
  return { mode: 'listed', codes: [...codes] };
}

/**
 * Personnel records are an HR function across the whole company. Someone who manages HR in the HR
 * workspace sees every employee; everyone else keeps their normal department boundary.
 */
export async function personnelVisibility(auth: AuthContext): Promise<RecordVisibility> {
  const visibility = await recordVisibility(auth);
  if (visibility.companyWide || isTechnicalAdmin(auth)) return visibility;
  if (hasPermission(auth, 'hr.manage') && workspaceAllows(await workspaceGate(auth), 'hr')) {
    return { ...visibility, companyWide: true };
  }
  return visibility;
}

export function workspaceAllows(gate: WorkspaceGate, code: string): boolean {
  return gate.mode === 'all' || gate.codes.includes(code);
}

export function workspaceList(gate: WorkspaceGate): string[] {
  return gate.mode === 'all' ? ['*'] : gate.codes;
}

export function requireWorkspace(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new HttpError(401, 'Authentication is required.', 'UNAUTHENTICATED'));
      return;
    }
    workspaceGate(req.auth)
      .then((gate) => {
        if (codes.some((code) => workspaceAllows(gate, code))) {
          next();
          return;
        }
        next(new HttpError(403, 'This workspace is outside your department.', 'WORKSPACE_DENIED'));
      })
      .catch(next);
  };
}
