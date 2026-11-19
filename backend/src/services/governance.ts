import type { RowDataPacket } from '../database/rows';
import type { Db } from '../database/query';
import { query, queryOne } from '../database/query';
import { DEFAULT_ESCALATION_HOURS, DEFAULT_EXECUTIVE_THRESHOLD } from '../modules/approvals/workflowCatalog';
import { HttpError } from '../utils/httpError';

export interface SegregationRuleSeed {
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  locked: boolean;
}

/**
 * Separation-of-duty rules. Each rule is a row in `segregation_rules` that an authorised system
 * administrator may switch on or off, except locked rules, which always apply. A rule that has
 * not been stored yet uses the default below, so a missing row never weakens a control.
 */
export const segregationCatalog: SegregationRuleSeed[] = [
  {
    code: 'SELF_APPROVAL',
    name: 'No self-approval',
    description: 'A requester cannot decide any step of their own request, directly or through a delegation.',
    enabled: true,
    locked: true,
  },
  {
    code: 'VERIFIER_NOT_APPROVER',
    name: 'Verification is independent of approval',
    description: 'The person who verified a request cannot also approve it, and an approver cannot verify the same request.',
    enabled: true,
    locked: false,
  },
  {
    code: 'PAYROLL_PREPARER_NOT_SUBMITTER',
    name: 'Payroll preparer cannot submit',
    description: 'The person who prepared a payroll cannot also review and submit it to accounts.',
    enabled: true,
    locked: false,
  },
  {
    code: 'REQUESTER_NOT_PAYER',
    name: 'Requester cannot execute payment',
    description: 'The person who raised a payment request cannot execute that payment.',
    enabled: true,
    locked: false,
  },
  {
    code: 'APPROVER_NOT_PAYER',
    name: 'Approver cannot execute payment',
    description: 'Anyone who approved a payment or payroll cannot also execute the payment.',
    enabled: true,
    locked: false,
  },
  {
    code: 'VERIFIER_NOT_PAYER',
    name: 'Verifier cannot execute payment',
    description: 'The person who verified a payment or payroll cannot execute it. Switch on when finance has more than one officer.',
    enabled: false,
    locked: false,
  },
  {
    code: 'PO_ISSUER_NOT_RECEIVER',
    name: 'Purchase order issuer cannot receive goods',
    description: 'The person who issued a purchase order cannot record the goods received against it.',
    enabled: true,
    locked: false,
  },
  {
    code: 'DISPATCH_REQUESTER_NOT_AUTHORISER',
    name: 'Dispatch requester cannot authorise it',
    description: 'The person who requested a produce dispatch cannot also authorise it and assign transport. Switch on when more than one manager authorises dispatch.',
    enabled: false,
    locked: false,
  },
  {
    code: 'REQUESTER_NOT_PO_ISSUER',
    name: 'Requester cannot issue the purchase order',
    description: 'The person who requested a purchase cannot issue the purchase order for it.',
    enabled: false,
    locked: false,
  },
];

export async function ruleEnabled(db: Db, code: string): Promise<boolean> {
  const seed = segregationCatalog.find((rule) => rule.code === code);
  if (seed?.locked) return true;
  const row = await queryOne<RowDataPacket>(db, 'SELECT enabled FROM segregation_rules WHERE code = ?', [code]);
  if (!row) return seed?.enabled ?? true;
  return Number(row.enabled) === 1;
}

/** Throws when an enabled separation-of-duty rule is broken. The error handler records the refusal in the audit log. */
export async function assertSegregation(db: Db, code: string, violated: boolean, message: string): Promise<void> {
  if (!violated) return;
  if (!(await ruleEnabled(db, code))) return;
  throw new HttpError(403, message, 'SEGREGATION_DENIED', { rule: code });
}

/**
 * Payment execution is separate from initiation, verification, and approval. Checked by every payment
 * path (supplier and expense payments, salary payments) against the approval request behind it.
 */
export async function assertPaymentSegregation(db: Db, input: { approvalRequestId: number | null; payerUserId: number; requesterUserId?: number | null }): Promise<void> {
  if (input.requesterUserId != null) {
    await assertSegregation(db, 'REQUESTER_NOT_PAYER', input.requesterUserId === input.payerUserId,
      'You raised this payment, so someone else must execute it.');
  }
  if (input.approvalRequestId == null) return;
  const decisions = await query<RowDataPacket[]>(
    db,
    `SELECT decision_kind FROM approval_request_steps WHERE request_id = ? AND status = 'approved' AND decided_by_user_id = ?`,
    [input.approvalRequestId, input.payerUserId],
  );
  await assertSegregation(db, 'APPROVER_NOT_PAYER', decisions.some((row) => row.decision_kind === 'approve'),
    'You approved this payment, so someone else must execute it.');
  await assertSegregation(db, 'VERIFIER_NOT_PAYER', decisions.some((row) => row.decision_kind === 'verify'),
    'You verified this payment, so someone else must execute it.');
}

export interface GovernanceSettings {
  /** Expenditure at or above this amount needs the CEO. `null` turns the company threshold off. */
  executiveThreshold: number | null;
  /** A step pending longer than this escalates. 0 turns time-based escalation off. */
  escalationHours: number;
  escalationRoleCode: string;
}

function settingNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(typeof value === 'string' ? value.replace(/"/g, '') : value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function governanceSettings(db: Db): Promise<GovernanceSettings> {
  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key IN ('executive_approval_threshold', 'approval_escalation_hours', 'approval_escalation_role')`,
  );
  const values = new Map(rows.map((row) => [String(row.setting_key), row.setting_value as unknown]));
  const threshold = values.has('executive_approval_threshold') ? settingNumber(values.get('executive_approval_threshold')) : DEFAULT_EXECUTIVE_THRESHOLD;
  const hours = values.has('approval_escalation_hours') ? settingNumber(values.get('approval_escalation_hours')) : DEFAULT_ESCALATION_HOURS;
  const role = values.get('approval_escalation_role');
  return {
    executiveThreshold: threshold,
    escalationHours: Math.max(0, hours ?? DEFAULT_ESCALATION_HOURS),
    escalationRoleCode: typeof role === 'string' && role ? role.replace(/"/g, '') : 'CEO',
  };
}

/**
 * The largest amount a user may approve on a workflow for a department. `null` means unlimited
 * (final business authority). 0 means the user holds no spending authority. For each role the most
 * specific active limit counts (workflow and department, then workflow, then department, then general),
 * and the user receives the highest of their roles' limits. Technical administrators hold no authority.
 */
export async function authorityLimitFor(db: Db, userId: number, workflowId: number, departmentId: number | null): Promise<number | null> {
  const roles = await query<RowDataPacket[]>(
    db,
    `SELECT r.code, r.is_technical_admin, r.has_final_business_authority
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     WHERE ur.user_id = ?
       AND (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE)
       AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
    [userId],
  );
  if (roles.some((role) => Number(role.is_technical_admin) === 1)) return 0;
  if (roles.some((role) => Number(role.has_final_business_authority) === 1)) return null;
  if (roles.length === 0) return 0;
  const codes = roles.map((role) => String(role.code));
  const limits = await query<RowDataPacket[]>(
    db,
    `SELECT role_code, workflow_id, department_id, max_amount FROM approval_authority_limits
     WHERE status = 'active' AND role_code IN (${codes.map(() => '?').join(', ')})
       AND (workflow_id IS NULL OR workflow_id = ?)
       AND (department_id IS NULL OR department_id = ?)`,
    [...codes, workflowId, departmentId],
  );
  let best: number | null = 0;
  for (const code of codes) {
    const rows = limits.filter((row) => String(row.role_code) === code);
    if (rows.length === 0) continue;
    const specificity = (row: RowDataPacket) => (row.workflow_id != null ? 2 : 0) + (row.department_id != null ? 1 : 0);
    const top = Math.max(...rows.map(specificity));
    for (const row of rows.filter((item) => specificity(item) === top)) {
      if (row.max_amount == null) return null;
      const amount = Number(row.max_amount);
      if (best !== null && amount > best) best = amount;
    }
  }
  return best;
}

export function withinLimit(limit: number | null, amount: number): boolean {
  return limit === null || Math.round(amount * 100) <= Math.round(limit * 100);
}
