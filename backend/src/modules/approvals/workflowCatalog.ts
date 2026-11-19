export type TransactionKind = 'general' | 'expenditure' | 'organisational';
export type Resolver = 'role' | 'supervisor' | 'department_manager' | 'position';
export type DecisionKind = 'review' | 'verify' | 'approve';
/**
 * When a configured step joins a request.
 * - `always`: every request on the route.
 * - `executive`: only when executive approval is required: the amount reaches the company
 *   executive threshold, the request is marked for special management approval, or the amount
 *   is above the financial limit of the manager who would otherwise give the final approval.
 * - `special`: only on requests marked for special management approval.
 * - `standard`: only on requests that are not marked for special approval.
 */
export type ConditionFlag = 'always' | 'executive' | 'special' | 'standard';

export const conditionFlags: ConditionFlag[] = ['always', 'executive', 'special', 'standard'];

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
  conditionFlag?: ConditionFlag;
}

export interface WorkflowSeed {
  code: string;
  name: string;
  description: string;
  transactionKind: TransactionKind;
  completionRoleCode: string;
  requiresSupportingDocument?: boolean;
  steps: WorkflowStepSeed[];
  /** Step names of the first release. A stored route that still matches is upgraded once by the seed. */
  previousStepNames?: string[];
}

/** Bumped when the opening routes change. `workflows.governance_version` records what a stored route follows. */
export const GOVERNANCE_VERSION = 2;

const ceo = {
  name: 'CEO final approval',
  resolver: 'role' as const,
  roleCode: 'CEO',
  decisionKind: 'approve' as const,
  isFinalBusinessStep: true,
};

/** The CEO joins an expenditure route only when executive approval is required. */
const ceoWhenRequired = { ...ceo, requiresExpenditureAuthority: true, conditionFlag: 'executive' as const };

/**
 * Opening routes. Role assignments, thresholds, and conditions live in workflow_steps so an
 * administrator can change them without a code release. Routine spending is approved by the
 * accountable manager within their financial limit. The CEO is added by the engine when the
 * amount reaches the executive threshold, exceeds that manager's limit, or is marked special.
 */
export const workflowCatalog: WorkflowSeed[] = [
  {
    code: 'LEAVE',
    name: 'Leave request',
    description: 'The supervisor approves and HR confirms the leave. The CEO joins only when special approval is requested.',
    transactionKind: 'general',
    completionRoleCode: 'HR_MANAGER',
    previousStepNames: ['HR review', 'CEO final approval'],
    steps: [
      { name: 'Supervisor approval', resolver: 'supervisor', decisionKind: 'approve' },
      { name: 'HR confirmation', resolver: 'role', roleCode: 'HR_MANAGER', decisionKind: 'approve' },
      { ...ceo, conditionFlag: 'special' },
    ],
  },
  {
    code: 'PURCHASE',
    name: 'Purchase request',
    description: 'Supervisor, operations review, finance budget verification, then the department manager approves within their limit. The CEO joins above the executive threshold or the manager’s limit.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    previousStepNames: ['Supervisor', 'Operations', 'Accounts verification', 'CEO final approval'],
    steps: [
      { name: 'Supervisor review', resolver: 'supervisor', decisionKind: 'review' },
      { name: 'Operations review', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'review' },
      { name: 'Finance budget verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      { name: 'Manager approval', resolver: 'department_manager', decisionKind: 'approve', requiresExpenditureAuthority: true },
      ceoWhenRequired,
    ],
  },
  {
    code: 'PAYMENT',
    name: 'Payment request',
    description: 'Department manager approval within their limit, then accounts verification. The CEO joins above the executive threshold or the manager’s limit.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    requiresSupportingDocument: false,
    previousStepNames: ['Department manager', 'Accounts verification', 'CEO final approval'],
    steps: [
      { name: 'Department manager', resolver: 'department_manager', decisionKind: 'approve', requiresExpenditureAuthority: true },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      ceoWhenRequired,
    ],
  },
  {
    code: 'FUEL',
    name: 'Fuel request',
    description: 'Fleet supervisor, operations approval within its limit, accounts verification. The CEO joins above the executive threshold or the limit.',
    transactionKind: 'expenditure',
    completionRoleCode: 'OPERATIONS_MANAGER',
    previousStepNames: ['Fleet supervisor', 'Operations', 'Accounts verification', 'CEO final approval'],
    steps: [
      { name: 'Fleet supervisor', resolver: 'position', positionCode: 'FLEET-SUPERVISOR', decisionKind: 'review' },
      { name: 'Operations', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'approve', requiresExpenditureAuthority: true },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      ceoWhenRequired,
    ],
  },
  {
    code: 'VEHICLE_REPAIR',
    name: 'Vehicle repair',
    description: 'Fleet supervisor, operations approval within its limit, accounts verification. The CEO joins above the executive threshold or the limit.',
    transactionKind: 'expenditure',
    completionRoleCode: 'OPERATIONS_MANAGER',
    previousStepNames: ['Fleet supervisor', 'Operations', 'Accounts verification', 'CEO final approval'],
    steps: [
      { name: 'Fleet supervisor', resolver: 'position', positionCode: 'FLEET-SUPERVISOR', decisionKind: 'review' },
      { name: 'Operations', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'approve', requiresExpenditureAuthority: true },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      ceoWhenRequired,
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
    description: 'The HR Manager submits payroll prepared by HR, accounts verifies the calculations, and the CEO approves payment before accounts pays.',
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
    description: 'Marketing manager approval within the limit, accounts verification. The CEO joins above the executive threshold or the limit.',
    transactionKind: 'expenditure',
    completionRoleCode: 'ACCOUNTS_OFFICER',
    previousStepNames: ['Marketing review', 'Accounts verification', 'CEO final approval'],
    steps: [
      { name: 'Marketing approval', resolver: 'role', roleCode: 'IT_MARKETING_MANAGER', decisionKind: 'approve', requiresExpenditureAuthority: true },
      { name: 'Accounts verification', resolver: 'role', roleCode: 'ACCOUNTS_OFFICER', decisionKind: 'verify' },
      ceoWhenRequired,
    ],
  },
];

workflowCatalog.push({
  code: 'FARM_RESOURCE',
  name: 'Farm resource request',
  description: 'A farm supervisor asks for inputs, equipment, fuel, or labour. The Operations Manager approves within their limit; above it, or when special approval is asked, the Operations Manager recommends and the CEO decides.',
  transactionKind: 'expenditure',
  completionRoleCode: 'OPERATIONS_MANAGER',
  steps: [
    { name: 'Operations Manager approval', resolver: 'role', roleCode: 'OPERATIONS_MANAGER', decisionKind: 'approve', requiresExpenditureAuthority: true },
    ceoWhenRequired,
  ],
});

/** Opening financial limits per role, in company currency. A missing role has no spending authority. */
export const authorityLimitCatalog: Array<{ roleCode: string; maxAmount: number; notes: string }> = [
  { roleCode: 'OPERATIONS_MANAGER', maxAmount: 10000, notes: 'Routine operational purchases and haulage costs.' },
  { roleCode: 'HR_MANAGER', maxAmount: 5000, notes: 'Routine HR department spending.' },
  { roleCode: 'ACCOUNTS_OFFICER', maxAmount: 5000, notes: 'Routine finance department spending.' },
  { roleCode: 'LEGAL_AFFAIRS', maxAmount: 5000, notes: 'Routine legal department spending.' },
  { roleCode: 'IT_MARKETING_MANAGER', maxAmount: 5000, notes: 'Routine IT and marketing spending.' },
];

/** Company-wide default above which every expenditure needs the CEO. Stored in system_settings. */
export const DEFAULT_EXECUTIVE_THRESHOLD = 20000;
export const DEFAULT_ESCALATION_HOURS = 72;
