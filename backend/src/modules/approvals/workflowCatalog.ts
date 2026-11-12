export type TransactionKind = 'general' | 'expenditure' | 'organisational';
export type Resolver = 'role' | 'supervisor' | 'department_manager' | 'position';
export type DecisionKind = 'review' | 'verify' | 'approve';

export interface WorkflowStepSeed {
  name: string;
  resolver: Resolver;
  roleCode?: string;
  positionCode?: string;
  parallelGroup?: number | null;
  decisionKind: DecisionKind;
  requiresExpenditureAuthority?: boolean;
  isFinalBusinessStep?: boolean;
  minAmount?: number | null;
}

export interface WorkflowSeed {
  code: string;
  name: string;
  description: string;
  transactionKind: TransactionKind;
  completionRoleCode: string;
  steps: WorkflowStepSeed[];
}

const ceo = {
  name: 'CEO final approval',
  resolver: 'role' as const,
  roleCode: 'CEO',
  decisionKind: 'approve' as const,
  isFinalBusinessStep: true,
};

/**
 * Opening routes. Role assignments live in workflow_steps so an administrator
 * can change them without a code release. The CEO's final financial approval
 * is on every expenditure route and is not limited by amount.
 */
export const workflowCatalog: WorkflowSeed[] = [
  {
    code: 'LEAVE',
    name: 'Leave request',
    description: 'Employee leave. HR reviews, then the CEO gives final approval.',
    transactionKind: 'general',
    completionRoleCode: 'HR_MANAGER',
    steps: [
      { name: 'HR review', resolver: 'role', roleCode: 'HR_MANAGER', decisionKind: 'review' },
      ceo,
    ],
  },
  {
    code: 'PURCHASE',
    name: 'Purchase request',
    description: 'Requester, supervisor, operations, accounts verification, then the CEO.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    steps: [
      { name: 'Supervisor', resolver: 'supervisor', decisionKind: 'review' },
      { name: 'Operations', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'approve' },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
  {
    code: 'PAYMENT',
    name: 'Payment request',
    description: 'Department manager, accounts verification, then the CEO.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    steps: [
      { name: 'Department manager', resolver: 'department_manager', decisionKind: 'approve' },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
  {
    code: 'FUEL',
    name: 'Fuel request',
    description: 'Driver, fleet supervisor, operations, accounts verification, then the CEO’s final financial approval.',
    transactionKind: 'expenditure',
    completionRoleCode: 'OPERATIONS_MANAGER',
    steps: [
      { name: 'Fleet supervisor', resolver: 'position', positionCode: 'FLEET-SUPERVISOR', decisionKind: 'review' },
      { name: 'Operations', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'approve' },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
  {
    code: 'VEHICLE_REPAIR',
    name: 'Vehicle repair',
    description: 'Driver, fleet supervisor, operations, accounts verification, then the CEO’s final financial approval.',
    transactionKind: 'expenditure',
    completionRoleCode: 'OPERATIONS_MANAGER',
    steps: [
      { name: 'Fleet supervisor', resolver: 'position', positionCode: 'FLEET-SUPERVISOR', decisionKind: 'review' },
      { name: 'Operations', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'approve' },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
  {
    code: 'RECRUITMENT',
    name: 'Recruitment',
    description: 'Department request reviewed by HR, with final approval by the CEO.',
    transactionKind: 'general',
    completionRoleCode: 'HR_MANAGER',
    steps: [
      { name: 'HR review', resolver: 'role', roleCode: 'HR_MANAGER', decisionKind: 'review' },
      ceo,
    ],
  },
  {
    code: 'CONTRACT',
    name: 'Contract',
    description: 'Requesting department to Legal Affairs, then the CEO.',
    transactionKind: 'general',
    completionRoleCode: 'LEGAL_AFFAIRS',
    steps: [
      { name: 'Legal review', resolver: 'role', roleCode: 'LEGAL_AFFAIRS', decisionKind: 'review' },
      ceo,
    ],
  },
  {
    code: 'PAYROLL',
    name: 'Payroll',
    description: 'HR submits, accounts verifies, and the CEO gives final approval before accounts pays.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    steps: [
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
  {
    code: 'BUDGET',
    name: 'Budget',
    description: 'Department budget verified by accounts, then approved by the CEO.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    steps: [
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
  {
    code: 'MARKETING_EXPENDITURE',
    name: 'Marketing expenditure',
    description: 'Marketing review, accounts verification, then the CEO.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    steps: [
      { name: 'Marketing review', resolver: 'role', roleCode: 'IT_MARKETING_MANAGER', decisionKind: 'review' },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { ...ceo, requiresExpenditureAuthority: true },
    ],
  },
];
