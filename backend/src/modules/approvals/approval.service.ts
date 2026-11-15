import type { RowDataPacket } from '../../database/rows';
import { execute, query, queryOne, scalar, withTransaction } from '../../database/query';
import { pool } from '../../database/pool';
import type { Db } from '../../database/query';
import { publishApprovalChange } from './approval.hooks';
import { assertApprovalAllowed } from './policy';
import type { DecisionKind, Resolver, TransactionKind } from './workflowCatalog';
import { requireCompanyId, nextReference } from '../../services/companyContext';
import { writeAudit, type AuditEntry } from '../../services/auditService';
import { notifyUser } from '../../services/notify';
import { hasFinalBusinessAuthority, hasPermission, isTechnicalAdmin } from '../../services/access';
import { assertSegregation, authorityLimitFor, governanceSettings, ruleEnabled, withinLimit } from '../../services/governance';
import { countDocuments, documentContent, listDocuments, storeDocument } from '../../services/documents';
import { conditionFlags } from './workflowCatalog';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';
import { limitOffset, pageMeta, type PageQuery } from '../../utils/pagination';
import type { z } from 'zod';
import { stepInputSchema } from './approval.schema';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };
type StepInput = z.infer<typeof stepInputSchema>;

interface RequestRow extends RowDataPacket {
  id: number;
  reference_number: string;
  workflow_id: number;
  workflow_code: string;
  workflow_name: string;
  transaction_kind: TransactionKind;
  completion_role_code: string | null;
  title: string;
  details: string | null;
  amount: string | null;
  currency_code: string;
  department_id: number | null;
  branch_id: number | null;
  department_name: string | null;
  branch_name: string | null;
  requester_user_id: number;
  requester_username: string;
  requester_employee_id: number | null;
  status: string;
  revision: number;
  submitted_at: string | null;
  decided_at: string | null;
  completed_at: string | null;
  created_at: string;
  company_id: number;
  special_approval: number;
  requires_supporting_document: number;
  source_type: string | null;
  source_id: number | null;
}

interface StepRow extends RowDataPacket {
  id: number;
  request_id: number;
  workflow_step_id: number | null;
  step_order: number;
  parallel_group: number | null;
  name: string;
  resolver: Resolver;
  role_code: string | null;
  position_code: string | null;
  decision_kind: DecisionKind;
  requires_expenditure_authority: number;
  is_final_business_step: number;
  status: string;
  decided_by_user_id: number | null;
  delegation_id: number | null;
  comment: string | null;
  decided_at: string | null;
  decided_by_username: string | null;
  escalate_after_hours: number | null;
  escalation_role_code: string | null;
  activated_at: string | null;
  escalated_at: string | null;
  added_reason: string | null;
}

/** The fields that decide who may act on a step. Planned steps that are not stored yet use the same shape. */
type StepAssignee = Pick<StepRow, 'resolver' | 'role_code' | 'position_code'> & {
  escalated_at?: string | null;
  escalation_role_code?: string | null;
};

const requestSelect = `
  SELECT r.*, w.code AS workflow_code, w.name AS workflow_name, w.transaction_kind, w.completion_role_code, w.requires_supporting_document,
         u.username AS requester_username, u.employee_id AS requester_employee_id,
         d.name AS department_name, b.name AS branch_name
  FROM approval_requests r
  JOIN workflows w ON w.id = r.workflow_id
  JOIN users u ON u.id = r.requester_user_id
  LEFT JOIN departments d ON d.id = r.department_id
  LEFT JOIN branches b ON b.id = r.branch_id
`;

const openStatuses = ['pending_review', 'under_approval', 'returned_for_correction', 'approved', 'processing', 'draft'];

function money(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

function flag(value: number | boolean): boolean {
  return value === true || Number(value) === 1;
}

function mapRequest(row: RequestRow, extra?: { canDecide?: boolean }) {
  return {
    id: Number(row.id),
    referenceNumber: row.reference_number,
    workflowId: Number(row.workflow_id),
    workflowCode: row.workflow_code,
    workflowName: row.workflow_name,
    transactionKind: row.transaction_kind,
    title: row.title,
    details: row.details,
    amount: money(row.amount),
    currencyCode: row.currency_code,
    departmentId: row.department_id == null ? null : Number(row.department_id),
    departmentName: row.department_name,
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    branchName: row.branch_name,
    requesterUserId: Number(row.requester_user_id),
    requester: row.requester_username,
    status: row.status,
    revision: Number(row.revision),
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    specialApproval: flag(row.special_approval ?? 0),
    requiresSupportingDocument: flag(row.requires_supporting_document ?? 0),
    canDecide: extra?.canDecide ?? false,
  };
}

function mapStep(row: StepRow) {
  return {
    id: Number(row.id),
    stepOrder: Number(row.step_order),
    parallelGroup: row.parallel_group == null ? null : Number(row.parallel_group),
    name: row.name,
    resolver: row.resolver,
    roleCode: row.role_code,
    positionCode: row.position_code,
    decisionKind: row.decision_kind,
    requiresExpenditureAuthority: flag(row.requires_expenditure_authority),
    isFinalBusinessStep: flag(row.is_final_business_step),
    status: row.status,
    decidedBy: row.decided_by_username,
    delegationId: row.delegation_id == null ? null : Number(row.delegation_id),
    comment: row.comment,
    decidedAt: row.decided_at,
    activatedAt: row.activated_at ?? null,
    escalatedAt: row.escalated_at ?? null,
    escalationRoleCode: row.escalated_at ? row.escalation_role_code : null,
    addedReason: row.added_reason ?? null,
  };
}

function seesAll(auth: AuthContext): boolean {
  if (isTechnicalAdmin(auth)) {
    return false;
  }
  return hasPermission(auth, 'audit.view') || hasFinalBusinessAuthority(auth);
}

function orderedGroups(steps: StepRow[]): StepRow[][] {
  const sorted = [...steps].sort((left, right) => Number(left.step_order) - Number(right.step_order));
  const buckets = new Map<string, StepRow[]>();
  const order: string[] = [];
  for (const step of sorted) {
    const key = step.parallel_group == null ? `solo-${step.step_order}` : `par-${step.parallel_group}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)?.push(step);
  }
  return order.map((key) => buckets.get(key) ?? []);
}

function isClosed(step: StepRow): boolean {
  return step.status === 'approved' || step.status === 'skipped';
}

async function loadSteps(db: Db, requestId: number): Promise<StepRow[]> {
  return query<StepRow[]>(
    db,
    `SELECT s.*, u.username AS decided_by_username
     FROM approval_request_steps s
     LEFT JOIN users u ON u.id = s.decided_by_user_id
     WHERE s.request_id = ?
     ORDER BY s.step_order`,
    [requestId],
  );
}

/** Principals for a step. An escalated step is also open to the holders of the escalation role. */
async function eligibleUserIds(db: Db, request: RequestRow, step: StepAssignee): Promise<number[]> {
  const base = await assignedUserIds(db, request, step);
  if (step.escalated_at && step.escalation_role_code) {
    const escalated = await assignedUserIds(db, request, { resolver: 'role', role_code: step.escalation_role_code, position_code: null });
    return [...new Set([...base, ...escalated])];
  }
  return base;
}

async function assignedUserIds(db: Db, request: RequestRow, step: StepAssignee): Promise<number[]> {
  const requesterId = Number(request.requester_user_id);
  if (step.resolver === 'role') {
    const rows = await query<RowDataPacket[]>(
      db,
      `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.code = ? AND r.status = 'active'
       WHERE u.status = 'active' AND u.id <> ?
         AND (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE)
         AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)
         AND (
           ur.scope_type = 'global'
           OR (ur.scope_type = 'department' AND ur.scope_id = ?)
           OR (ur.scope_type = 'branch' AND ur.scope_id = ?)
         )`,
      [step.role_code, requesterId, request.department_id, request.branch_id],
    );
    return rows.map((row) => Number(row.id));
  }

  if (step.resolver === 'supervisor') {
    const rows = await query<RowDataPacket[]>(
      db,
      `SELECT u.id
       FROM users requester
       JOIN employee_assignments ea ON ea.employee_id = requester.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
       JOIN users u ON u.employee_id = ea.supervisor_employee_id AND u.status = 'active'
       WHERE requester.id = ? AND u.id <> requester.id`,
      [requesterId],
    );
    return rows.map((row) => Number(row.id));
  }

  if (step.resolver === 'department_manager') {
    if (request.department_id == null) {
      return [];
    }
    const rows = await query<RowDataPacket[]>(
      db,
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id FROM departments WHERE id = ?
         UNION ALL
         SELECT d.id, d.parent_id FROM departments d JOIN chain c ON d.id = c.parent_id
       )
       SELECT DISTINCT u.id
       FROM chain
       JOIN employee_assignments ea ON ea.department_id = chain.id AND ea.is_primary = 1 AND ea.end_date IS NULL
       JOIN positions p ON p.id = ea.position_id AND p.is_managerial = 1 AND p.status = 'active'
       JOIN users u ON u.employee_id = ea.employee_id AND u.status = 'active'
       WHERE u.id <> ?`,
      [request.department_id, requesterId],
    );
    return rows.map((row) => Number(row.id));
  }

  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT DISTINCT u.id
     FROM positions p
     JOIN employee_assignments ea ON ea.position_id = p.id AND ea.is_primary = 1 AND ea.end_date IS NULL
     JOIN users u ON u.employee_id = ea.employee_id AND u.status = 'active'
     WHERE p.company_id = ? AND p.code = ? AND p.status = 'active' AND u.id <> ?`,
    [request.company_id, step.position_code, requesterId],
  );
  return rows.map((row) => Number(row.id));
}

async function activeDelegation(db: Db, delegateUserId: number, delegatorUserId: number, workflowId: number): Promise<number | null> {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT id FROM approval_delegations
     WHERE delegate_user_id = ? AND delegator_user_id = ? AND status = 'active'
       AND starts_on <= CURRENT_DATE AND ends_on >= CURRENT_DATE
       AND (workflow_id IS NULL OR workflow_id = ?)
     ORDER BY id DESC LIMIT 1`,
    [delegateUserId, delegatorUserId, workflowId],
  );
  return row ? Number(row.id) : null;
}

async function resolveActor(db: Db, actorUserId: number, request: RequestRow, step: StepRow): Promise<{ delegationId: number | null; principalUserId: number }> {
  const principals = await eligibleUserIds(db, request, step);
  if (principals.includes(actorUserId)) {
    return { delegationId: null, principalUserId: actorUserId };
  }
  for (const principalUserId of principals) {
    const delegationId = await activeDelegation(db, actorUserId, principalUserId, Number(request.workflow_id));
    if (delegationId) {
      return { delegationId, principalUserId };
    }
  }
  throw new HttpError(403, 'This request is not waiting for your decision.', 'NOT_ASSIGNED');
}

async function authorityOf(db: Db, userId: number): Promise<{ technical: boolean; expenditure: boolean; final: boolean }> {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT MAX(r.is_technical_admin) AS is_technical,
            MAX(r.can_approve_expenditure) AS can_spend,
            MAX(r.has_final_business_authority) AS is_final
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     WHERE ur.user_id = ?
       AND (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE)
       AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
    [userId],
  );
  return {
    technical: flag(row?.is_technical ?? 0),
    expenditure: flag(row?.can_spend ?? 0),
    final: flag(row?.is_final ?? 0),
  };
}

async function notifyEligible(db: Db, request: RequestRow, step: StepRow, title: string, body: string): Promise<void> {
  const principals = await eligibleUserIds(db, request, step);
  if (principals.length === 0) {
    throw new HttpError(422, `No eligible approver is available for “${step.name}”.`, 'NO_APPROVER');
  }
  const recipients = new Set(principals);
  const delegates = await query<RowDataPacket[]>(
    db,
    `SELECT delegate_user_id, delegator_user_id FROM approval_delegations
     WHERE status = 'active' AND starts_on <= CURRENT_DATE AND ends_on >= CURRENT_DATE
       AND (workflow_id IS NULL OR workflow_id = ?)
       AND delegator_user_id IN (${principals.map(() => '?').join(', ')})`,
    [request.workflow_id, ...principals],
  );
  for (const delegate of delegates) {
    if (Number(delegate.delegate_user_id) !== Number(request.requester_user_id)) {
      recipients.add(Number(delegate.delegate_user_id));
    }
  }
  for (const userId of recipients) {
    await notifyUser(db, userId, {
      title,
      body,
      notificationType: 'approval.pending',
      entityType: 'approval_request',
      entityId: request.id,
    });
  }
}

async function recordAction(db: Db, requestId: number, stepId: number | null, actorUserId: number, action: string, comment?: string | null): Promise<void> {
  await execute(
    db,
    `INSERT INTO approval_actions (request_id, request_step_id, actor_user_id, action, comment)
     VALUES (?, ?, ?, ?, ?)`,
    [requestId, stepId, actorUserId, action, comment ?? null],
  );
}

async function audit(db: Db, actor: Actor, action: string, entityId: number, value: unknown): Promise<void> {
  const entry: AuditEntry = {
    userId: actor.userId,
    action,
    module: 'approvals',
    entityType: 'approval_request',
    entityId,
    newValue: value,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  };
  await writeAudit(db, entry);
}

function statusForGroup(group: StepRow[]): 'pending_review' | 'under_approval' {
  return group.every((step) => step.decision_kind === 'review') ? 'pending_review' : 'under_approval';
}

async function activateNext(db: Db, request: RequestRow): Promise<string> {
  const steps = await loadSteps(db, Number(request.id));
  for (const group of orderedGroups(steps)) {
    if (group.every(isClosed)) {
      continue;
    }
    if (!group.some((step) => step.status === 'pending')) {
      const ids = group.map((step) => Number(step.id));
      await execute(
        db,
        `UPDATE approval_request_steps SET status = 'pending', activated_at = UTC_TIMESTAMP(3) WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'waiting'`,
        ids,
      );
      for (const step of group) {
        step.status = 'pending';
        await notifyEligible(
          db,
          request,
          step,
          `Approval needed: ${request.reference_number}`,
          `${request.title} is waiting for ${step.name}.`,
        );
      }
    }
    const status = statusForGroup(group);
    await execute(db, 'UPDATE approval_requests SET status = ? WHERE id = ?', [status, request.id]);
    return status;
  }

  await execute(db, `UPDATE approval_requests SET status = 'approved', decided_at = UTC_TIMESTAMP(3) WHERE id = ?`, [request.id]);
  await notifyUser(db, Number(request.requester_user_id), {
    title: `Approved: ${request.reference_number}`,
    body: `${request.title} has been approved.`,
    notificationType: 'approval.approved',
    entityType: 'approval_request',
    entityId: request.id,
  });
  if (request.completion_role_code) {
    const holders = await query<RowDataPacket[]>(
      db,
      `SELECT DISTINCT ur.user_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.code = ? AND r.status = 'active'
       JOIN users u ON u.id = ur.user_id AND u.status = 'active'
       WHERE (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE)
         AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
      [request.completion_role_code],
    );
    for (const holder of holders) {
      if (Number(holder.user_id) === Number(request.requester_user_id)) continue;
      await notifyUser(db, Number(holder.user_id), {
        title: `Ready to process: ${request.reference_number}`,
        body: `${request.title} is approved and can be completed.`,
        notificationType: 'approval.approved',
        entityType: 'approval_request',
        entityId: request.id,
      });
    }
  }
  return 'approved';
}

interface PlannedStep {
  workflow_step_id: number | null;
  step_order: number;
  parallel_group: number | null;
  name: string;
  resolver: Resolver;
  role_code: string | null;
  position_code: string | null;
  decision_kind: DecisionKind;
  requires_expenditure_authority: number;
  is_final_business_step: number;
  escalate_after_hours: number | null;
  escalation_role_code: string | null;
  added_reason: string | null;
  status: 'waiting' | 'skipped';
  comment: string | null;
}

function formatAmount(value: number | null): string {
  return value === null ? 'unlimited' : value.toFixed(2);
}

function planStep(step: RowDataPacket): PlannedStep {
  return {
    workflow_step_id: Number(step.id),
    step_order: Number(step.step_order),
    parallel_group: step.parallel_group == null ? null : Number(step.parallel_group),
    name: String(step.name),
    resolver: step.resolver as Resolver,
    role_code: step.role_code == null ? null : String(step.role_code),
    position_code: step.position_code == null ? null : String(step.position_code),
    decision_kind: step.decision_kind as DecisionKind,
    requires_expenditure_authority: Number(step.requires_expenditure_authority) ? 1 : 0,
    is_final_business_step: Number(step.is_final_business_step) ? 1 : 0,
    escalate_after_hours: step.escalate_after_hours == null ? null : Number(step.escalate_after_hours),
    escalation_role_code: step.escalation_role_code == null ? null : String(step.escalation_role_code),
    added_reason: null,
    status: 'waiting',
    comment: null,
  };
}

async function requesterPositionCode(db: Db, requesterUserId: number): Promise<string | null> {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT p.code FROM users u
     JOIN employee_assignments ea ON ea.employee_id = u.employee_id AND ea.is_primary = 1 AND ea.end_date IS NULL
     JOIN positions p ON p.id = ea.position_id
     WHERE u.id = ?`,
    [requesterUserId],
  );
  return row?.code ? String(row.code) : null;
}

function escalateToCeo(step: PlannedStep, reason: string): void {
  step.resolver = 'role';
  step.role_code = 'CEO';
  step.position_code = null;
  step.added_reason = reason;
}

function sameSet(left: number[], right: number[]): boolean {
  return left.length > 0 && left.length === right.length && left.every((id) => right.includes(id));
}

/**
 * Copies the applicable route onto the request. The route decides the stages; company governance
 * decides when the CEO joins:
 * - steps are filtered by department, branch, amount band, requester position, and condition flag;
 * - a step nobody else can decide (no supervisor, no department manager, or the requester holds the
 *   only approving role) escalates to the next authority and finally the CEO;
 * - an expenditure that reaches the executive threshold, is marked special, or is above the limit of the
 *   manager who would give the last spending approval brings in the route's executive step (or the CEO);
 * - a review step decided by the same people as the next step is skipped, so nobody approves twice;
 * - when the only approver is also the only verifier, the approval escalates to keep verification independent.
 */
async function materialize(db: Db, request: RequestRow): Promise<void> {
  await execute(db, 'DELETE FROM approval_request_steps WHERE request_id = ?', [request.id]);
  const definitions = await query<RowDataPacket[]>(
    db,
    `SELECT * FROM workflow_steps WHERE workflow_id = ? AND status = 'active' ORDER BY step_order`,
    [request.workflow_id],
  );
  const amount = money(request.amount) ?? 0;
  const special = flag(request.special_approval ?? 0);
  const position = await requesterPositionCode(db, Number(request.requester_user_id));
  const matches = (step: RowDataPacket) => {
    if (step.applies_to_department_id != null && Number(step.applies_to_department_id) !== Number(request.department_id)) return false;
    if (step.applies_to_branch_id != null && Number(step.applies_to_branch_id) !== Number(request.branch_id)) return false;
    if (step.applies_to_position_code != null && String(step.applies_to_position_code) !== position) return false;
    const min = money(step.min_amount as string | null);
    const max = money(step.max_amount as string | null);
    if (min != null && amount < min) return false;
    if (max != null && amount > max) return false;
    const condition = String(step.condition_flag ?? 'always');
    if (condition === 'special' && !special) return false;
    if (condition === 'standard' && special) return false;
    return true;
  };
  const plan = definitions.filter((step) => matches(step) && String(step.condition_flag ?? 'always') !== 'executive').map(planStep);
  const executive = definitions.filter((step) => matches(step) && String(step.condition_flag ?? 'always') === 'executive').map(planStep);
  if (plan.length === 0 && executive.length === 0) {
    throw new HttpError(422, 'This request does not match a configured approval route.', 'NO_ROUTE');
  }

  for (const step of plan) {
    if ((await eligibleUserIds(db, request, step)).length > 0) continue;
    if (step.resolver === 'supervisor') {
      const manager = { ...step, resolver: 'department_manager' as Resolver };
      if ((await eligibleUserIds(db, request, manager)).length > 0) {
        step.resolver = 'department_manager';
        step.added_reason = 'No supervisor is available. The department manager decides this step.';
        continue;
      }
    }
    if (step.role_code !== 'CEO') {
      const reason = step.resolver === 'supervisor' || step.resolver === 'department_manager'
        ? 'No supervisor or department manager can decide this step. Escalated to the CEO.'
        : 'Nobody other than the requester can decide this step. Escalated to the CEO.';
      escalateToCeo(step, reason);
    }
  }

  let executiveReason: string | null = null;
  const settings = await governanceSettings(db);
  if (special) {
    executiveReason = 'The request is marked for special management approval.';
  } else if (request.transaction_kind === 'expenditure') {
    const threshold = settings.executiveThreshold;
    const hasFinalSpend = plan.some((step) => step.is_final_business_step && step.requires_expenditure_authority);
    if (threshold !== null && amount >= threshold) {
      executiveReason = `The amount reaches the executive approval threshold of ${formatAmount(threshold)}.`;
    } else if (!hasFinalSpend) {
      const authority = plan.filter((step) => step.requires_expenditure_authority && !step.is_final_business_step);
      const last = authority[authority.length - 1];
      if (!last) {
        executiveReason = 'No step on this route holds spending authority for this request.';
      } else {
        const principals = await eligibleUserIds(db, request, last);
        let best: number | null = 0;
        for (const userId of principals) {
          const limit = await authorityLimitFor(db, userId, Number(request.workflow_id), request.department_id == null ? null : Number(request.department_id));
          if (limit === null) { best = null; break; }
          if (best !== null && limit > best) best = limit;
        }
        if (!withinLimit(best, amount)) {
          executiveReason = `The amount is above the approval limit of ${formatAmount(best)} for “${last.name}”.`;
        }
      }
    }
  }
  if (executiveReason) {
    if (executive.length > 0) {
      for (const step of executive) step.added_reason = executiveReason;
      plan.push(...executive);
    } else if (!plan.some((step) => step.is_final_business_step)) {
      plan.push({
        workflow_step_id: null,
        step_order: Math.max(0, ...plan.map((step) => step.step_order)) + 1,
        parallel_group: null,
        name: 'CEO executive approval',
        resolver: 'role',
        role_code: 'CEO',
        position_code: null,
        decision_kind: 'approve',
        requires_expenditure_authority: request.transaction_kind === 'expenditure' ? 1 : 0,
        is_final_business_step: 1,
        escalate_after_hours: null,
        escalation_role_code: null,
        added_reason: executiveReason,
        status: 'waiting',
        comment: null,
      });
    }
  }
  plan.sort((left, right) => left.step_order - right.step_order);

  const principals = new Map<PlannedStep, number[]>();
  for (const step of plan) principals.set(step, await eligibleUserIds(db, request, step));

  for (const step of plan) {
    if (step.decision_kind !== 'approve' || step.is_final_business_step) continue;
    const approvers = principals.get(step) ?? [];
    const conflict = plan.some((other) => other !== step && other.decision_kind === 'verify' && approvers.length === 1 && sameSet(approvers, principals.get(other) ?? []));
    if (conflict && (await ruleEnabled(db, 'VERIFIER_NOT_APPROVER'))) {
      escalateToCeo(step, 'The only approver also verifies this request. Escalated to the CEO so verification stays independent.');
      principals.set(step, await eligibleUserIds(db, request, step));
    }
  }

  for (let index = 0; index < plan.length - 1; index += 1) {
    const step = plan[index]!;
    const next = plan[index + 1]!;
    if (step.decision_kind !== 'review' || step.parallel_group != null) continue;
    if (sameSet(principals.get(step) ?? [], principals.get(next) ?? [])) {
      step.status = 'skipped';
      step.comment = `The same approver decides “${next.name}”.`;
    }
  }

  for (const step of plan) {
    if (step.status === 'skipped') continue;
    if ((principals.get(step) ?? []).length === 0) {
      throw new HttpError(422, `No eligible approver is available for “${step.name}”. You cannot approve your own request.`, 'NO_APPROVER');
    }
  }

  for (const step of plan) {
    await execute(
      db,
      `INSERT INTO approval_request_steps (
         request_id, workflow_step_id, step_order, parallel_group, name, resolver, role_code, position_code,
         decision_kind, requires_expenditure_authority, is_final_business_step, status, comment,
         escalate_after_hours, escalation_role_code, added_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.id,
        step.workflow_step_id,
        step.step_order,
        step.parallel_group,
        step.name,
        step.resolver,
        step.role_code,
        step.position_code,
        step.decision_kind,
        step.requires_expenditure_authority,
        step.is_final_business_step,
        step.status,
        step.comment,
        step.escalate_after_hours,
        step.escalation_role_code,
        step.added_reason,
      ],
    );
  }
  await activateNext(db, request);
}

async function lockRequest(db: Db, id: number): Promise<RequestRow> {
  const row = await queryOne<RequestRow>(db, `${requestSelect} WHERE r.id = ? FOR UPDATE`, [id]);
  if (!row) {
    throw notFound('Approval request');
  }
  return row;
}

async function assertOwned(request: RequestRow, userId: number): Promise<void> {
  if (Number(request.requester_user_id) !== userId) {
    throw new HttpError(403, 'Only the requester can change this request.', 'NOT_REQUESTER');
  }
}

async function assertReferences(db: Db, companyId: number, departmentId?: number | null, branchId?: number | null): Promise<void> {
  if (departmentId) {
    const department = await queryOne<RowDataPacket>(db, 'SELECT id FROM departments WHERE id = ? AND company_id = ? AND status = \'active\'', [departmentId, companyId]);
    if (!department) throw new HttpError(422, 'Select an active department.', 'INVALID_DEPARTMENT');
  }
  if (branchId) {
    const branch = await queryOne<RowDataPacket>(db, 'SELECT id FROM branches WHERE id = ? AND company_id = ? AND status = \'active\'', [branchId, companyId]);
    if (!branch) throw new HttpError(422, 'Select an active branch.', 'INVALID_BRANCH');
  }
}

/**
 * A route must have someone who approves. An expenditure route must have a step that carries spending
 * authority (a manager within their limit, or the CEO). The CEO is not required on every route:
 * the engine adds executive approval from the company threshold and the approvers' limits.
 */
function validateSteps(steps: StepInput[], transactionKind: TransactionKind): void {
  const orders = new Set<number>();
  for (const step of steps) {
    if (orders.has(step.stepOrder)) {
      throw new HttpError(422, 'Each workflow step needs its own order.', 'DUPLICATE_STEP');
    }
    orders.add(step.stepOrder);
    if (step.resolver === 'role' && !step.roleCode) {
      throw new HttpError(422, `Step ${step.name} needs a role.`, 'STEP_ROLE_REQUIRED');
    }
    if (step.resolver === 'position' && !step.positionCode) {
      throw new HttpError(422, `Step ${step.name} needs a position code.`, 'STEP_POSITION_REQUIRED');
    }
    if (step.minAmount != null && step.maxAmount != null && step.maxAmount < step.minAmount) {
      throw new HttpError(422, `Step ${step.name} has a maximum below its minimum.`, 'INVALID_THRESHOLD');
    }
    if (!conditionFlags.includes(step.conditionFlag ?? 'always')) {
      throw new HttpError(422, `Step ${step.name} has an unknown condition.`, 'INVALID_CONDITION');
    }
    if (step.isFinalBusinessStep && step.resolver !== 'role') {
      throw new HttpError(422, `The executive step ${step.name} must be assigned to a role with final business authority.`, 'FINAL_STEP_ROLE');
    }
  }
  if (!steps.some((step) => step.decisionKind === 'approve')) {
    throw new HttpError(422, 'The route needs at least one approval step.', 'APPROVAL_STEP_REQUIRED');
  }
  if (transactionKind === 'expenditure' && !steps.some((step) => step.requiresExpenditureAuthority)) {
    throw new HttpError(422, 'An expenditure route needs a step that carries spending authority.', 'EXPENDITURE_STEP_REQUIRED');
  }
}

async function insertSteps(db: Db, workflowId: number, steps: StepInput[]): Promise<void> {
  for (const step of steps) {
    if (step.roleCode) {
      const role = await queryOne<RowDataPacket>(db, 'SELECT id, has_final_business_authority FROM roles WHERE code = ? AND status = \'active\'', [step.roleCode]);
      if (!role) throw new HttpError(422, `Role ${step.roleCode} does not exist.`, 'INVALID_ROLE');
      if (step.isFinalBusinessStep && Number(role.has_final_business_authority) !== 1) {
        throw new HttpError(422, `Only a role with final business authority can hold the executive step ${step.name}.`, 'FINAL_STEP_ROLE');
      }
    }
    if (step.escalationRoleCode) {
      const role = await queryOne<RowDataPacket>(db, 'SELECT id FROM roles WHERE code = ? AND status = \'active\'', [step.escalationRoleCode]);
      if (!role) throw new HttpError(422, `Escalation role ${step.escalationRoleCode} does not exist.`, 'INVALID_ROLE');
    }
    for (const code of [step.positionCode, step.appliesToPositionCode]) {
      if (!code) continue;
      const position = await queryOne<RowDataPacket>(db, 'SELECT id FROM positions WHERE code = ? AND status = \'active\'', [code]);
      if (!position) throw new HttpError(422, `Position ${code} does not exist.`, 'INVALID_POSITION');
    }
    await execute(
      db,
      `INSERT INTO workflow_steps (
         workflow_id, step_order, name, resolver, role_code, position_code, parallel_group, decision_kind,
         requires_expenditure_authority, is_final_business_step, min_amount, max_amount,
         applies_to_department_id, applies_to_branch_id, applies_to_position_code, condition_flag,
         escalate_after_hours, escalation_role_code, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        workflowId,
        step.stepOrder,
        step.name,
        step.resolver,
        step.roleCode ?? null,
        step.positionCode ?? null,
        step.parallelGroup ?? null,
        step.decisionKind,
        step.requiresExpenditureAuthority ? 1 : 0,
        step.isFinalBusinessStep ? 1 : 0,
        step.minAmount ?? null,
        step.maxAmount ?? null,
        step.appliesToDepartmentId ?? null,
        step.appliesToBranchId ?? null,
        step.appliesToPositionCode ?? null,
        step.conditionFlag ?? 'always',
        step.escalateAfterHours ?? null,
        step.escalationRoleCode ?? null,
      ],
    );
  }
}

function mapWorkflowStep(step: RowDataPacket) {
  return {
    id: Number(step.id),
    stepOrder: Number(step.step_order),
    name: step.name,
    resolver: step.resolver,
    roleCode: step.role_code,
    positionCode: step.position_code,
    parallelGroup: step.parallel_group == null ? null : Number(step.parallel_group),
    decisionKind: step.decision_kind,
    requiresExpenditureAuthority: flag(step.requires_expenditure_authority),
    isFinalBusinessStep: flag(step.is_final_business_step),
    minAmount: money(step.min_amount),
    maxAmount: money(step.max_amount),
    appliesToDepartmentId: step.applies_to_department_id == null ? null : Number(step.applies_to_department_id),
    appliesToBranchId: step.applies_to_branch_id == null ? null : Number(step.applies_to_branch_id),
    appliesToPositionCode: step.applies_to_position_code ?? null,
    conditionFlag: step.condition_flag ?? 'always',
    escalateAfterHours: step.escalate_after_hours == null ? null : Number(step.escalate_after_hours),
    escalationRoleCode: step.escalation_role_code ?? null,
  };
}

export async function listWorkflows() {
  const companyId = await requireCompanyId(pool);
  const workflows = await query<RowDataPacket[]>(
    pool,
    `SELECT * FROM workflows WHERE company_id = ? ORDER BY name`,
    [companyId],
  );
  const steps = await query<RowDataPacket[]>(
    pool,
    `SELECT s.* FROM workflow_steps s JOIN workflows w ON w.id = s.workflow_id WHERE w.company_id = ? AND s.status = 'active' ORDER BY s.step_order`,
    [companyId],
  );
  return workflows.map((workflow) => ({
    id: Number(workflow.id),
    code: workflow.code,
    name: workflow.name,
    description: workflow.description,
    transactionKind: workflow.transaction_kind,
    completionRoleCode: workflow.completion_role_code,
    requiresSupportingDocument: flag(workflow.requires_supporting_document ?? 0),
    status: workflow.status,
    steps: steps.filter((step) => Number(step.workflow_id) === Number(workflow.id)).map(mapWorkflowStep),
  }));
}

export async function updateWorkflowSettings(id: number, input: {
  name?: string;
  description?: string | null;
  status?: 'active' | 'inactive';
  requiresSupportingDocument?: boolean;
  completionRoleCode?: string;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const workflow = await queryOne<RowDataPacket>(connection, 'SELECT * FROM workflows WHERE id = ? FOR UPDATE', [id]);
    if (!workflow) throw notFound('Workflow');
    if (input.completionRoleCode) {
      const role = await queryOne<RowDataPacket>(connection, 'SELECT id FROM roles WHERE code = ? AND status = \'active\'', [input.completionRoleCode]);
      if (!role) throw new HttpError(422, 'The completion role does not exist.', 'INVALID_ROLE');
    }
    const next = {
      name: input.name ?? String(workflow.name),
      description: input.description === undefined ? workflow.description : input.description,
      status: input.status ?? String(workflow.status),
      requiresSupportingDocument: input.requiresSupportingDocument ?? flag(workflow.requires_supporting_document ?? 0),
      completionRoleCode: input.completionRoleCode ?? workflow.completion_role_code,
    };
    await execute(
      connection,
      `UPDATE workflows SET name = ?, description = ?, status = ?, requires_supporting_document = ?, completion_role_code = ? WHERE id = ?`,
      [next.name, next.description, next.status, next.requiresSupportingDocument ? 1 : 0, next.completionRoleCode, id],
    );
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'workflow.settings',
      module: 'approvals',
      entityType: 'workflow',
      entityId: id,
      previousValue: {
        name: workflow.name,
        description: workflow.description,
        status: workflow.status,
        requiresSupportingDocument: flag(workflow.requires_supporting_document ?? 0),
        completionRoleCode: workflow.completion_role_code,
      },
      newValue: next,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id, code: workflow.code, ...next };
  });
}

export async function createWorkflow(input: {
  code: string;
  name: string;
  description?: string | null;
  transactionKind: TransactionKind;
  completionRoleCode: string;
  steps: StepInput[];
}, actor: Actor) {
  validateSteps(input.steps, input.transactionKind);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const role = await queryOne<RowDataPacket>(connection, 'SELECT id FROM roles WHERE code = ? AND status = \'active\'', [input.completionRoleCode]);
    if (!role) throw new HttpError(422, 'The completion role does not exist.', 'INVALID_ROLE');
    const result = await execute(
      connection,
      `INSERT INTO workflows (company_id, code, name, description, transaction_kind, completion_role_code, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [companyId, input.code, input.name, input.description ?? null, input.transactionKind, input.completionRoleCode],
    );
    await insertSteps(connection, result.insertId, input.steps);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'workflow.create',
      module: 'approvals',
      entityType: 'workflow',
      entityId: result.insertId,
      newValue: { code: input.code, steps: input.steps.length },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id: result.insertId, code: input.code };
  });
}

export async function replaceWorkflowSteps(id: number, steps: StepInput[], actor: Actor) {
  return withTransaction(async (connection) => {
    const workflow = await queryOne<RowDataPacket>(connection, 'SELECT id, code, transaction_kind FROM workflows WHERE id = ? FOR UPDATE', [id]);
    if (!workflow) throw notFound('Workflow');
    validateSteps(steps, workflow.transaction_kind as TransactionKind);
    const previous = await query<RowDataPacket[]>(connection, `SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order`, [id]);
    await execute(connection, 'DELETE FROM workflow_steps WHERE workflow_id = ?', [id]);
    await insertSteps(connection, id, steps);
    const summary = (step: { name: unknown; roleCode?: unknown; decisionKind?: unknown; minAmount?: unknown; maxAmount?: unknown; conditionFlag?: unknown }) => ({
      name: step.name, role: step.roleCode ?? null, kind: step.decisionKind, minAmount: step.minAmount ?? null, maxAmount: step.maxAmount ?? null, condition: step.conditionFlag ?? 'always',
    });
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'workflow.update',
      module: 'approvals',
      entityType: 'workflow',
      entityId: id,
      previousValue: { code: workflow.code, steps: previous.map((step) => summary(mapWorkflowStep(step))) },
      newValue: { code: workflow.code, steps: steps.map(summary) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id, code: workflow.code };
  });
}

async function canDecide(db: Db, userId: number, request: RequestRow): Promise<boolean> {
  if (!['pending_review', 'under_approval'].includes(request.status)) return false;
  const steps = await loadSteps(db, Number(request.id));
  const pending = steps.filter((step) => step.status === 'pending');
  for (const step of pending) {
    try {
      await resolveActor(db, userId, request, step);
      return true;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  return false;
}

export async function listRequests(auth: AuthContext, filters: PageQuery & { queue: 'mine' | 'inbox' | 'all'; status: string; search: string }) {
  if (filters.queue === 'all' && !seesAll(auth)) {
    throw new HttpError(403, 'You can view your own requests and the requests assigned to you.', 'QUEUE_DENIED');
  }
  if (filters.queue === 'inbox') {
    const rows = await query<RequestRow[]>(
      pool,
      `${requestSelect}
       WHERE r.status IN ('pending_review', 'under_approval')
       ORDER BY r.submitted_at`,
    );
    const visible = [];
    for (const row of rows) {
      if (await canDecide(pool, auth.userId, row)) visible.push(mapRequest(row, { canDecide: true }));
    }
    const start = (filters.page - 1) * filters.pageSize;
    return { data: visible.slice(start, start + filters.pageSize), meta: pageMeta(filters, visible.length) };
  }

  const where = ['1 = 1'];
  const params: unknown[] = [];
  if (filters.queue === 'mine') {
    where.push('r.requester_user_id = ?');
    params.push(auth.userId);
  } else {
    where.push('(r.status <> \'draft\' OR r.requester_user_id = ?)');
    params.push(auth.userId);
  }
  if (filters.status === 'open') {
    where.push(`r.status IN (${openStatuses.map(() => '?').join(', ')})`);
    params.push(...openStatuses);
  } else if (filters.status !== 'all') {
    where.push('r.status = ?');
    params.push(filters.status);
  }
  if (filters.search) {
    where.push('(r.reference_number LIKE ? ESCAPE \'\\\\\' OR r.title LIKE ? ESCAPE \'\\\\\')');
    const term = `%${filters.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    params.push(term, term);
  }
  const whereSql = where.join(' AND ');
  const total = await scalar(pool, `SELECT COUNT(*) FROM approval_requests r WHERE ${whereSql}`, params);
  const { limit, offset } = limitOffset(filters);
  const rows = await query<RequestRow[]>(pool, `${requestSelect} WHERE ${whereSql} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  return { data: rows.map((row) => mapRequest(row)), meta: pageMeta(filters, total) };
}

export async function getRequest(auth: AuthContext, id: number) {
  const row = await queryOne<RequestRow>(pool, `${requestSelect} WHERE r.id = ?`, [id]);
  if (!row) throw notFound('Approval request');
  const allowed = Number(row.requester_user_id) === auth.userId || seesAll(auth) || await canDecide(pool, auth.userId, row);
  const steps = await loadSteps(pool, id);
  const decided = steps.some((step) => Number(step.decided_by_user_id) === auth.userId);
  const processor = row.completion_role_code != null && auth.grants.some((grant) => grant.roleCode === row.completion_role_code);
  if (!allowed && !decided && !processor) throw notFound('Approval request');
  const actions = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, u.username FROM approval_actions a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.request_id = ? ORDER BY a.id`,
    [id],
  );
  const financeReader = hasFinalBusinessAuthority(auth) || hasPermission(auth, 'finance.view');
  return {
    ...mapRequest(row, { canDecide: await canDecide(pool, auth.userId, row) }),
    steps: steps.map(mapStep),
    actions: actions.map((action) => ({
      id: Number(action.id),
      action: action.action,
      comment: action.comment,
      actor: action.username ?? 'System',
      createdAt: action.created_at,
    })),
    documents: await listDocuments(pool, requestEntities(row)),
    budget: financeReader ? await budgetPosition(row) : null,
  };
}

function requestEntities(row: RequestRow): Array<{ type: string; id: number }> {
  const entities = [{ type: 'approval_request', id: Number(row.id) }];
  if (row.source_type && row.source_id != null) entities.push({ type: String(row.source_type), id: Number(row.source_id) });
  return entities;
}

/**
 * Budget availability for finance verification: the department's approved budgets for the year, the
 * expense already posted, and other approved spending that has not been completed.
 */
async function budgetPosition(row: RequestRow) {
  if (row.transaction_kind !== 'expenditure' || row.department_id == null) return null;
  const year = new Date().getUTCFullYear();
  const departmentId = Number(row.department_id);
  const approved = Number((await queryOne<RowDataPacket>(
    pool,
    `SELECT COALESCE(SUM(amount), 0) AS total FROM budgets WHERE status = 'approved' AND budget_year = ? AND department_id = ?`,
    [year, departmentId],
  ))?.total ?? 0);
  const spent = Number((await queryOne<RowDataPacket>(
    pool,
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS total
     FROM journal_lines l
     JOIN journals j ON j.id = l.journal_id
     JOIN ledger_accounts a ON a.id = l.ledger_account_id
     WHERE a.account_type = 'expense' AND l.department_id = ? AND j.journal_date BETWEEN ? AND ?`,
    [departmentId, `${year}-01-01`, `${year}-12-31`],
  ))?.total ?? 0);
  const committed = Number((await queryOne<RowDataPacket>(
    pool,
    `SELECT COALESCE(SUM(r.amount), 0) AS total FROM approval_requests r JOIN workflows w ON w.id = r.workflow_id
     WHERE w.transaction_kind = 'expenditure' AND r.department_id = ? AND r.id <> ?
       AND r.status IN ('approved', 'processing') AND r.decided_at >= ?`,
    [departmentId, row.id, `${year}-01-01`],
  ))?.total ?? 0);
  const available = Math.round((approved - spent - committed) * 100) / 100;
  const amount = money(row.amount) ?? 0;
  return { year, approvedBudget: approved, spent, committed, available, amount, sufficient: approved > 0 && amount <= available };
}

async function assertCanSee(auth: AuthContext, row: RequestRow): Promise<void> {
  const allowed = Number(row.requester_user_id) === auth.userId || seesAll(auth) || await canDecide(pool, auth.userId, row);
  if (allowed) return;
  const steps = await loadSteps(pool, Number(row.id));
  if (steps.some((step) => Number(step.decided_by_user_id) === auth.userId)) return;
  if (row.completion_role_code != null && auth.grants.some((grant) => grant.roleCode === row.completion_role_code)) return;
  throw notFound('Approval request');
}

export async function listRequestDocuments(auth: AuthContext, id: number) {
  const row = await queryOne<RequestRow>(pool, `${requestSelect} WHERE r.id = ?`, [id]);
  if (!row) throw notFound('Approval request');
  await assertCanSee(auth, row);
  return listDocuments(pool, requestEntities(row));
}

/** The requester, an assigned approver, or a past decider may attach evidence. Documents are never removed. */
export async function attachRequestDocument(auth: AuthContext, id: number, input: {
  fileName: string; contentType: string; contentBase64: string; description?: string | null;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await lockRequest(connection, id);
    await assertCanSee(auth, row);
    if (['rejected', 'cancelled', 'completed'].includes(row.status)) {
      throw new HttpError(409, 'Documents cannot be added to a closed request.', 'REQUEST_CLOSED');
    }
    const stored = await storeDocument(connection, {
      companyId: Number(row.company_id), entityType: 'approval_request', entityId: id,
      fileName: input.fileName, contentType: input.contentType, contentBase64: input.contentBase64,
      description: input.description ?? null, userId: auth.userId,
    });
    await recordAction(connection, id, null, auth.userId, 'attach', stored.fileName);
    await audit(connection, actor, 'approval.attach', id, { documentId: stored.id, fileName: stored.fileName, sha256: stored.sha256, sizeBytes: stored.sizeBytes });
    return stored;
  });
}

export async function downloadRequestDocument(auth: AuthContext, id: number, documentId: number) {
  const row = await queryOne<RequestRow>(pool, `${requestSelect} WHERE r.id = ?`, [id]);
  if (!row) throw notFound('Approval request');
  await assertCanSee(auth, row);
  return documentContent(pool, documentId, requestEntities(row));
}

/**
 * Time-based escalation. A step pending longer than its escalation window (the step's own hours, or the
 * company default) opens to the escalation role (the step's, or the company default, normally the CEO),
 * which is notified. The original approver can still decide.
 */
export async function runEscalations(actor: { userId: number | null; ipAddress: string | null; userAgent: string | null }, now: Date = new Date()) {
  const settings = await governanceSettings(pool);
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT s.id, s.request_id, s.name, s.role_code, s.activated_at, s.escalate_after_hours, s.escalation_role_code
     FROM approval_request_steps s
     JOIN approval_requests r ON r.id = s.request_id
     WHERE s.status = 'pending' AND s.escalated_at IS NULL AND s.activated_at IS NOT NULL
       AND r.status IN ('pending_review', 'under_approval')`,
  );
  let escalated = 0;
  for (const row of rows) {
    const hours = row.escalate_after_hours == null ? settings.escalationHours : Number(row.escalate_after_hours);
    if (!hours) continue;
    const activated = new Date(`${String(row.activated_at).replace(' ', 'T')}${String(row.activated_at).endsWith('Z') ? '' : 'Z'}`);
    if (Number.isNaN(activated.getTime()) || activated.getTime() + hours * 3600_000 > now.getTime()) continue;
    const target = row.escalation_role_code ? String(row.escalation_role_code) : settings.escalationRoleCode;
    if (target === row.role_code) continue;
    await withTransaction(async (connection) => {
      const request = await lockRequest(connection, Number(row.request_id));
      await execute(
        connection,
        `UPDATE approval_request_steps SET escalated_at = UTC_TIMESTAMP(3), escalation_role_code = ? WHERE id = ? AND escalated_at IS NULL`,
        [target, row.id],
      );
      const comment = `“${row.name}” waited more than ${hours} hours and was escalated to ${target}.`;
      await execute(
        connection,
        `INSERT INTO approval_actions (request_id, request_step_id, actor_user_id, action, comment) VALUES (?, ?, ?, 'escalate', ?)`,
        [request.id, row.id, actor.userId, comment],
      );
      const holders = await assignedUserIds(connection, request, { resolver: 'role', role_code: target, position_code: null });
      for (const userId of holders) {
        await notifyUser(connection, userId, {
          title: `Escalated: ${request.reference_number}`,
          body: `${request.title} — ${comment}`,
          notificationType: 'approval.escalated',
          entityType: 'approval_request',
          entityId: request.id,
        });
      }
      await writeAudit(connection, {
        userId: actor.userId, action: 'approval.escalate', module: 'approvals', entityType: 'approval_request', entityId: request.id,
        newValue: { step: row.name, escalatedTo: target, afterHours: hours }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
      });
    });
    escalated += 1;
  }
  return { escalated };
}

export async function createRequest(auth: AuthContext, input: {
  workflowCode?: string;
  title: string;
  details?: string | null;
  amount?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  submit?: boolean;
  specialApproval?: boolean;
  sourceType?: string | null;
  sourceId?: number | null;
}, actor: Actor, db?: Db) {
  if (!input.workflowCode) {
    throw new HttpError(422, 'Choose a workflow.', 'WORKFLOW_REQUIRED');
  }
  const run = async (connection: Db) => {
    const companyId = await requireCompanyId(connection);
    const company = await queryOne<RowDataPacket>(connection, 'SELECT currency_code FROM companies WHERE id = ?', [companyId]);
    const workflow = await queryOne<RowDataPacket>(connection, 'SELECT id FROM workflows WHERE company_id = ? AND code = ? AND status = \'active\'', [companyId, input.workflowCode]);
    if (!workflow) throw new HttpError(422, 'That workflow is not available.', 'INVALID_WORKFLOW');
    await assertReferences(connection, companyId, input.departmentId, input.branchId);
    const reference = await nextReference(connection, 'approval_request', 'approval_request_prefix');
    const result = await execute(
      connection,
      `INSERT INTO approval_requests (
         company_id, reference_number, workflow_id, title, details, amount, currency_code,
         department_id, branch_id, requester_user_id, status, source_type, source_id, special_approval
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        companyId,
        reference,
        workflow.id,
        input.title,
        input.details ?? null,
        input.amount ?? null,
        company?.currency_code ?? 'USD',
        input.departmentId ?? null,
        input.branchId ?? null,
        auth.userId,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.specialApproval ? 1 : 0,
      ],
    );
    await audit(connection, actor, 'approval.create', result.insertId, { reference, workflow: input.workflowCode, amount: input.amount ?? null, specialApproval: Boolean(input.specialApproval) });
    if (input.submit) {
      const request = await lockRequest(connection, result.insertId);
      await materialize(connection, request);
      await execute(connection, 'UPDATE approval_requests SET submitted_at = UTC_TIMESTAMP(3) WHERE id = ?', [result.insertId]);
      await recordAction(connection, result.insertId, null, auth.userId, 'submit', null);
      await audit(connection, actor, 'approval.submit', result.insertId, { reference });
      await publishApprovalChange(connection, result.insertId);
    }
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [result.insertId]);
    return mapRequest(saved!);
  };
  if (db) {
    return run(db);
  }
  return withTransaction(run);
}

export async function updateRequest(auth: AuthContext, id: number, input: {
  title: string;
  details?: string | null;
  amount?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  specialApproval?: boolean;
}, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    await assertOwned(request, auth.userId);
    if (request.status !== 'draft' && request.status !== 'returned_for_correction') {
      throw new HttpError(409, 'Only a draft or a returned request can be edited.', 'NOT_EDITABLE');
    }
    await assertReferences(connection, Number(request.company_id), input.departmentId, input.branchId);
    await execute(
      connection,
      `UPDATE approval_requests
       SET title = ?, details = ?, amount = ?, department_id = ?, branch_id = ?, special_approval = ?
       WHERE id = ?`,
      [input.title, input.details ?? null, input.amount ?? null, input.departmentId ?? null, input.branchId ?? null,
        input.specialApproval === undefined ? Number(request.special_approval ?? 0) : (input.specialApproval ? 1 : 0), id],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'approval.update', module: 'approvals', entityType: 'approval_request', entityId: id,
      previousValue: { title: request.title, details: request.details, amount: money(request.amount), departmentId: request.department_id, branchId: request.branch_id, specialApproval: flag(request.special_approval ?? 0) },
      newValue: { title: input.title, details: input.details ?? null, amount: input.amount ?? null, departmentId: input.departmentId ?? null, branchId: input.branchId ?? null, specialApproval: input.specialApproval ?? flag(request.special_approval ?? 0) },
      ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [id]);
    return mapRequest(saved!);
  });
}

export async function submitRequest(auth: AuthContext, id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    await assertOwned(request, auth.userId);
    if (request.status !== 'draft') {
      throw new HttpError(409, 'Only a draft can be submitted. Use resubmit after a return.', 'NOT_DRAFT');
    }
    await materialize(connection, request);
    await execute(connection, 'UPDATE approval_requests SET submitted_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]);
    await recordAction(connection, id, null, auth.userId, 'submit', null);
    await audit(connection, actor, 'approval.submit', id, { reference: request.reference_number });
    await publishApprovalChange(connection, id);
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [id]);
    return mapRequest(saved!);
  });
}

export async function resubmitRequest(auth: AuthContext, id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    await assertOwned(request, auth.userId);
    if (request.status !== 'returned_for_correction') {
      throw new HttpError(409, 'Only a returned request can be resubmitted.', 'NOT_RETURNED');
    }
    await execute(connection, 'UPDATE approval_requests SET revision = revision + 1 WHERE id = ?', [id]);
    await materialize(connection, request);
    await recordAction(connection, id, null, auth.userId, 'resubmit', null);
    await audit(connection, actor, 'approval.resubmit', id, { reference: request.reference_number });
    await publishApprovalChange(connection, id);
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [id]);
    return mapRequest(saved!);
  });
}

export async function decideRequest(auth: AuthContext, id: number, input: { action: 'approve' | 'reject' | 'return'; comment?: string }, actor: Actor) {
  const comment = input.comment?.trim() ?? '';
  if ((input.action === 'reject' || input.action === 'return') && comment.length < 8) {
    throw new HttpError(422, 'A reason of at least 8 characters is required.', 'REASON_REQUIRED');
  }
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    if (!['pending_review', 'under_approval'].includes(request.status)) {
      throw new HttpError(409, 'This request is not awaiting a decision.', 'NOT_PENDING');
    }
    const steps = await loadSteps(connection, id);
    const pending = steps.filter((step) => step.status === 'pending');
    let chosen: StepRow | null = null;
    let delegationId: number | null = null;
    let principalUserId = auth.userId;
    for (const step of pending) {
      try {
        const resolved = await resolveActor(connection, auth.userId, request, step);
        chosen = step;
        delegationId = resolved.delegationId;
        principalUserId = resolved.principalUserId;
        break;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
      }
    }
    if (!chosen) {
      throw new HttpError(403, 'This request is not waiting for your decision.', 'NOT_ASSIGNED');
    }
    if (auth.userId === Number(request.requester_user_id) || principalUserId === Number(request.requester_user_id)) {
      throw new HttpError(403, 'You cannot approve your own request.', 'SELF_APPROVAL_DENIED');
    }
    const actorAuthority = await authorityOf(connection, auth.userId);
    const principalAuthority = principalUserId === auth.userId ? actorAuthority : await authorityOf(connection, principalUserId);
    let authorityCheck: { amount: number; limit: number | null } | null = null;
    if (input.action === 'approve') {
      const decidedByMe = steps.filter((step) => step.id !== chosen!.id && step.status === 'approved'
        && [auth.userId, principalUserId].includes(Number(step.decided_by_user_id)));
      if (chosen.decision_kind === 'approve') {
        await assertSegregation(connection, 'VERIFIER_NOT_APPROVER', decidedByMe.some((step) => step.decision_kind === 'verify'),
          'You verified this request, so you cannot also approve it.');
      }
      if (chosen.decision_kind === 'verify') {
        await assertSegregation(connection, 'VERIFIER_NOT_APPROVER', decidedByMe.some((step) => step.decision_kind === 'approve'),
          'You approved this request, so you cannot also verify it.');
      }
      if (flag(request.requires_supporting_document ?? 0) && chosen.decision_kind !== 'review') {
        const entities = [{ type: 'approval_request', id }];
        if (request.source_type && request.source_id != null) entities.push({ type: String(request.source_type), id: Number(request.source_id) });
        if ((await countDocuments(connection, entities)) === 0) {
          throw new HttpError(422, 'Attach a supporting document before this request is verified or approved.', 'DOCUMENT_REQUIRED');
        }
      }
      const laterExecutive = steps.some((step) => Number(step.step_order) > Number(chosen!.step_order)
        && flag(step.is_final_business_step) && step.status !== 'skipped');
      if (flag(chosen.requires_expenditure_authority) && !flag(chosen.is_final_business_step) && !laterExecutive && request.transaction_kind === 'expenditure') {
        const departmentId = request.department_id == null ? null : Number(request.department_id);
        const ownLimit = await authorityLimitFor(connection, auth.userId, Number(request.workflow_id), departmentId);
        const principalLimit = principalUserId === auth.userId ? ownLimit : await authorityLimitFor(connection, principalUserId, Number(request.workflow_id), departmentId);
        const limit = ownLimit === null || principalLimit === null ? null : Math.max(ownLimit, principalLimit);
        authorityCheck = { amount: money(request.amount) ?? 0, limit };
      }
    }
    assertApprovalAllowed({
      authorityCheck,
      actorUserId: auth.userId,
      requesterUserId: Number(request.requester_user_id),
      actorIsTechnicalAdmin: actorAuthority.technical,
      actorCanApproveExpenditure: !actorAuthority.technical && (actorAuthority.expenditure || principalAuthority.expenditure),
      actorHasFinalBusinessAuthority: !actorAuthority.technical && (actorAuthority.final || principalAuthority.final),
      // The executive step needs expenditure authority. A manager's spending step is checked against their limit instead.
      transactionKind: flag(chosen.requires_expenditure_authority) && flag(chosen.is_final_business_step) ? request.transaction_kind : 'general',
      isFinalBusinessStep: flag(chosen.is_final_business_step),
    });

    if (input.action === 'approve') {
      await execute(
        connection,
        `UPDATE approval_request_steps
         SET status = 'approved', decided_by_user_id = ?, delegation_id = ?, comment = ?, decided_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [auth.userId, delegationId, comment || null, chosen.id],
      );
      await recordAction(connection, id, Number(chosen.id), auth.userId, 'approve', comment || null);
      await activateNext(connection, request);
    } else {
      const terminal = input.action === 'reject' ? 'rejected' : 'returned';
      const requestStatus = input.action === 'reject' ? 'rejected' : 'returned_for_correction';
      await execute(
        connection,
        `UPDATE approval_request_steps
         SET status = ?, decided_by_user_id = ?, delegation_id = ?, comment = ?, decided_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [terminal, auth.userId, delegationId, comment, chosen.id],
      );
      await execute(
        connection,
        `UPDATE approval_request_steps SET status = 'skipped' WHERE request_id = ? AND status IN ('waiting', 'pending')`,
        [id],
      );
      await execute(connection, 'UPDATE approval_requests SET status = ?, decided_at = UTC_TIMESTAMP(3) WHERE id = ?', [requestStatus, id]);
      await recordAction(connection, id, Number(chosen.id), auth.userId, input.action === 'reject' ? 'reject' : 'return', comment);
      await notifyUser(connection, Number(request.requester_user_id), {
        title: `${input.action === 'reject' ? 'Rejected' : 'Returned'}: ${request.reference_number}`,
        body: comment,
        notificationType: input.action === 'reject' ? 'approval.rejected' : 'approval.returned',
        entityType: 'approval_request',
        entityId: id,
      });
    }
    await audit(connection, actor, `approval.${input.action}`, id, { step: chosen.name, comment: comment || null, delegationId });
    await publishApprovalChange(connection, id);
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [id]);
    return mapRequest(saved!);
  });
}

async function assertProcessor(auth: AuthContext, request: RequestRow): Promise<void> {
  const holdsRole = request.completion_role_code != null && auth.grants.some((grant) => grant.roleCode === request.completion_role_code);
  if (!holdsRole && !hasFinalBusinessAuthority(auth)) {
    throw new HttpError(403, 'You are not assigned to complete this request.', 'NOT_PROCESSOR');
  }
}

export async function progressRequest(auth: AuthContext, id: number, action: 'process' | 'complete', actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    await assertProcessor(auth, request);
    if (action === 'process' && request.status !== 'approved') {
      throw new HttpError(409, 'Only an approved request can move into processing.', 'NOT_APPROVED');
    }
    if (action === 'complete' && request.status !== 'processing') {
      throw new HttpError(409, 'Only a request in processing can be completed.', 'NOT_PROCESSING');
    }
    const status = action === 'process' ? 'processing' : 'completed';
    await execute(
      connection,
      `UPDATE approval_requests SET status = ?, completed_at = IF(? = 'completed', UTC_TIMESTAMP(3), completed_at) WHERE id = ?`,
      [status, status, id],
    );
    await recordAction(connection, id, null, auth.userId, action, null);
    await publishApprovalChange(connection, id);
    await notifyUser(connection, Number(request.requester_user_id), {
      title: `${status === 'completed' ? 'Completed' : 'Processing'}: ${request.reference_number}`,
      body: request.title,
      notificationType: 'approval.progress',
      entityType: 'approval_request',
      entityId: id,
    });
    await audit(connection, actor, `approval.${action}`, id, { reference: request.reference_number });
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [id]);
    return mapRequest(saved!);
  });
}

export async function cancelRequest(auth: AuthContext, id: number, comment: string | undefined, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    await assertOwned(request, auth.userId);
    if (!['draft', 'pending_review', 'under_approval', 'returned_for_correction'].includes(request.status)) {
      throw new HttpError(409, 'This request can no longer be cancelled.', 'NOT_CANCELLABLE');
    }
    await execute(connection, `UPDATE approval_requests SET status = 'cancelled', decided_at = UTC_TIMESTAMP(3) WHERE id = ?`, [id]);
    await recordAction(connection, id, null, auth.userId, 'cancel', comment ?? null);
    await publishApprovalChange(connection, id);
    await audit(connection, actor, 'approval.cancel', id, { reference: request.reference_number });
    const saved = await queryOne<RequestRow>(connection, `${requestSelect} WHERE r.id = ?`, [id]);
    return mapRequest(saved!);
  });
}

export async function remindRequest(auth: AuthContext, id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const request = await lockRequest(connection, id);
    const allowed = Number(request.requester_user_id) === auth.userId || seesAll(auth);
    if (!allowed) throw new HttpError(403, 'You cannot send a reminder for this request.', 'REMINDER_DENIED');
    if (!['pending_review', 'under_approval'].includes(request.status)) {
      throw new HttpError(409, 'There is no pending approver to remind.', 'NOT_PENDING');
    }
    const steps = await loadSteps(connection, id);
    for (const step of steps.filter((item) => item.status === 'pending')) {
      await notifyEligible(connection, request, step, `Reminder: ${request.reference_number}`, `${request.title} is still waiting for ${step.name}.`);
    }
    await recordAction(connection, id, null, auth.userId, 'remind', null);
    await audit(connection, actor, 'approval.remind', id, { reference: request.reference_number });
    return { id };
  });
}

export async function runReminders(actor: Actor) {
  const setting = await queryOne<RowDataPacket>(pool, 'SELECT setting_value FROM system_settings WHERE setting_key = ?', ['approval_reminder_days']);
  const days = Math.max(1, Number(String(setting?.setting_value ?? '2').replace(/"/g, '')) || 2);
  const rows = await query<RequestRow[]>(
    pool,
    `${requestSelect}
     WHERE r.status IN ('pending_review', 'under_approval')
       AND r.updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)
       AND NOT EXISTS (
         SELECT 1 FROM approval_actions a
         WHERE a.request_id = r.id AND a.action = 'remind' AND a.created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
       )`,
    [days],
  );
  let sent = 0;
  for (const request of rows) {
    await withTransaction(async (connection) => {
      const steps = await loadSteps(connection, Number(request.id));
      for (const step of steps.filter((item) => item.status === 'pending')) {
        await notifyEligible(connection, request, step, `Reminder: ${request.reference_number}`, `${request.title} is still waiting for ${step.name}.`);
      }
      await recordAction(connection, Number(request.id), null, actor.userId, 'remind', null);
    });
    sent += 1;
  }
  return { sent, olderThanDays: days };
}

export async function approvalSummary(auth: AuthContext) {
  const mine = await scalar(
    pool,
    `SELECT COUNT(*) FROM approval_requests WHERE requester_user_id = ? AND status IN ('draft', 'pending_review', 'under_approval', 'returned_for_correction', 'approved', 'processing')`,
    [auth.userId],
  );
  const inboxRows = await query<RequestRow[]>(
    pool,
    `${requestSelect} WHERE r.status IN ('pending_review', 'under_approval')`,
  );
  let inbox = 0;
  for (const row of inboxRows) {
    if (await canDecide(pool, auth.userId, row)) inbox += 1;
  }
  return { mine, inbox };
}

export async function listDelegations(auth: AuthContext) {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT d.*, du.username AS delegate_username, su.username AS delegator_username, w.code AS workflow_code
     FROM approval_delegations d
     JOIN users du ON du.id = d.delegate_user_id
     JOIN users su ON su.id = d.delegator_user_id
     LEFT JOIN workflows w ON w.id = d.workflow_id
     WHERE d.delegator_user_id = ? OR d.delegate_user_id = ? OR ? = 1
     ORDER BY d.starts_on DESC`,
    [auth.userId, auth.userId, seesAll(auth) ? 1 : 0],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    delegator: row.delegator_username,
    delegate: row.delegate_username,
    delegateUserId: Number(row.delegate_user_id),
    workflowCode: row.workflow_code,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    reason: row.reason,
    status: row.status,
  }));
}

export async function createDelegation(auth: AuthContext, input: {
  delegateUserId: number;
  workflowId?: number | null;
  startsOn: string;
  endsOn: string;
  reason: string;
}, actor: Actor) {
  if (input.delegateUserId === auth.userId) {
    throw new HttpError(422, 'Choose another person to act for you.', 'DELEGATION_SELF');
  }
  if (input.endsOn < input.startsOn) {
    throw new HttpError(422, 'The delegation end date is before the start date.', 'INVALID_DATES');
  }
  return withTransaction(async (connection) => {
    const delegate = await queryOne<RowDataPacket>(connection, 'SELECT id, status FROM users WHERE id = ?', [input.delegateUserId]);
    if (!delegate || delegate.status !== 'active') throw new HttpError(422, 'Choose an active user.', 'INVALID_DELEGATE');
    if (input.workflowId) {
      const workflow = await queryOne<RowDataPacket>(connection, 'SELECT id FROM workflows WHERE id = ? AND status = \'active\'', [input.workflowId]);
      if (!workflow) throw new HttpError(422, 'That workflow is not available.', 'INVALID_WORKFLOW');
    }
    const result = await execute(
      connection,
      `INSERT INTO approval_delegations (delegator_user_id, delegate_user_id, workflow_id, starts_on, ends_on, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [auth.userId, input.delegateUserId, input.workflowId ?? null, input.startsOn, input.endsOn, input.reason],
    );
    await notifyUser(connection, input.delegateUserId, {
      title: 'Approval authority delegated to you',
      body: input.reason,
      notificationType: 'approval.delegation',
      entityType: 'approval_delegation',
      entityId: result.insertId,
    });
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'approval.delegate',
      module: 'approvals',
      entityType: 'approval_delegation',
      entityId: result.insertId,
      newValue: { delegateUserId: input.delegateUserId, startsOn: input.startsOn, endsOn: input.endsOn },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id: result.insertId };
  });
}

export async function revokeDelegation(auth: AuthContext, id: number, actor: Actor) {
  return withTransaction(async (connection) => {
    const row = await queryOne<RowDataPacket>(connection, 'SELECT * FROM approval_delegations WHERE id = ? FOR UPDATE', [id]);
    if (!row) throw notFound('Delegation');
    if (Number(row.delegator_user_id) !== auth.userId && !hasPermission(auth, 'approvals.configure')) {
      throw new HttpError(403, 'Only the delegator can revoke this delegation.', 'NOT_DELEGATOR');
    }
    await execute(connection, `UPDATE approval_delegations SET status = 'revoked', revoked_at = UTC_TIMESTAMP(3) WHERE id = ?`, [id]);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'approval.delegation.revoke',
      module: 'approvals',
      entityType: 'approval_delegation',
      entityId: id,
      newValue: { status: 'revoked' },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { id, status: 'revoked' };
  });
}
