import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from '../database/rows';
import { pool } from '../database/pool';
import { query, scalar } from '../database/query';
import { hasFinalBusinessAuthority, isTechnicalAdmin } from './access';
import { recordVisibility } from './visibility';
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
    return { mode: 'listed', codes: [] };
  }
  const visibility = await recordVisibility(auth);
  if (visibility.departmentIds.length === 0) {
    return { mode: 'listed', codes: [] };
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
  return { mode: 'listed', codes: rows.map((row) => String(row.workspace_code)) };
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
