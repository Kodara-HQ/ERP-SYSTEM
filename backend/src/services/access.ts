import type { AccessFilter, AuthContext, PermissionGrant, Sensitivity } from '../types/auth';
import { HttpError } from '../utils/httpError';

export function permissionCodes(auth: AuthContext): string[] {
  return [...new Set(auth.grants.map((grant) => grant.permission))].sort();
}

export function roleCodes(auth: AuthContext): string[] {
  return [...new Set(auth.grants.map((grant) => grant.roleCode))].sort();
}

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.grants.some((grant) => grant.permission === permission);
}

export function requirePermission(auth: AuthContext, permission: string): void {
  if (!hasPermission(auth, permission)) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
}

export function isTechnicalAdmin(auth: AuthContext): boolean {
  return auth.grants.some((grant) => grant.isTechnicalAdmin);
}

export function canApproveExpenditure(auth: AuthContext): boolean {
  return auth.grants.some((grant) => grant.canApproveExpenditure) && !isTechnicalAdmin(auth);
}

export function hasFinalBusinessAuthority(auth: AuthContext): boolean {
  return auth.grants.some((grant) => grant.hasFinalBusinessAuthority) && !isTechnicalAdmin(auth);
}

export function accessFor(auth: AuthContext, permission: string): AccessFilter {
  const grants = auth.grants.filter((grant) => grant.permission === permission);
  if (grants.length === 0) {
    return { all: false, departmentIds: [], branchIds: [], own: false };
  }
  if (grants.some((grant) => grant.scopeType === 'global')) {
    return { all: true, departmentIds: [], branchIds: [], own: false };
  }
  return {
    all: false,
    departmentIds: uniqueNumbers(grants.filter((grant) => grant.scopeType === 'department').map((grant) => grant.scopeId)),
    branchIds: uniqueNumbers(grants.filter((grant) => grant.scopeType === 'branch').map((grant) => grant.scopeId)),
    own: grants.some((grant) => grant.scopeType === 'own'),
  };
}

export function assertScope(
  auth: AuthContext,
  permission: string,
  record: { departmentId?: number | null; branchId?: number | null; employeeId?: number | null },
): void {
  const access = accessFor(auth, permission);
  if (access.all) {
    return;
  }
  const departmentMatch = record.departmentId != null && access.departmentIds.includes(record.departmentId);
  const branchMatch = record.branchId != null && access.branchIds.includes(record.branchId);
  const ownMatch = access.own && record.employeeId != null && record.employeeId === auth.employeeId;
  if (!departmentMatch && !branchMatch && !ownMatch) {
    throw new HttpError(403, 'You do not have access to this record.', 'SCOPE_DENIED');
  }
}

export function canAdministerSensitivity(auth: AuthContext, sensitivity: Sensitivity, targetIsTechnicalAdmin: boolean): boolean {
  if (sensitivity === 'standard') {
    return hasPermission(auth, 'roles.manage');
  }
  if (sensitivity === 'technical') {
    return isTechnicalAdmin(auth) && targetIsTechnicalAdmin;
  }
  if (sensitivity === 'confidential' || sensitivity === 'expenditure') {
    return hasPermission(auth, 'permissions.manage_protected');
  }
  return false;
}

export function roleIsProtected(grants: Array<Pick<PermissionGrant, 'sensitivity' | 'canApproveExpenditure'>>): boolean {
  return grants.some((grant) => grant.canApproveExpenditure || (grant.sensitivity !== 'standard' && grant.sensitivity !== 'technical'));
}

function uniqueNumbers(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => value != null))];
}
