export type ScopeType = 'global' | 'branch' | 'department' | 'own';
export type Sensitivity = 'standard' | 'technical' | 'confidential' | 'expenditure';

export interface PermissionGrant {
  permission: string;
  sensitivity: Sensitivity;
  scopeType: ScopeType;
  scopeId: number | null;
  roleId: number;
  roleCode: string;
  isTechnicalAdmin: boolean;
  canApproveExpenditure: boolean;
  hasFinalBusinessAuthority: boolean;
}

export interface AuthContext {
  userId: number;
  sessionId: number;
  employeeId: number | null;
  username: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  grants: PermissionGrant[];
}

export interface AccessFilter {
  all: boolean;
  departmentIds: number[];
  branchIds: number[];
  own: boolean;
}
