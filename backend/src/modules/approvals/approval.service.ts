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
}

const requestSelect = `
  SELECT r.*, w.code AS workflow_code, w.name AS workflow_name, w.transaction_kind, w.completion_role_code,
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

async function eligibleUserIds(db: Db, request: RequestRow, step: Pick<StepRow, 'resolver' | 'role_code' | 'position_code'>): Promise<number[]> {
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
        `UPDATE approval_request_steps SET status = 'pending' WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'waiting'`,
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

async function materialize(db: Db, request: RequestRow): Promise<void> {
  await execute(db, 'DELETE FROM approval_request_steps WHERE request_id = ?', [request.id]);
  const definitions = await query<RowDataPacket[]>(
    db,
    `SELECT * FROM workflow_steps WHERE workflow_id = ? AND status = 'active' ORDER BY step_order`,
    [request.workflow_id],
  );
  const amount = money(request.amount) ?? 0;
  const applicable = definitions.filter((step) => {
    if (step.applies_to_department_id != null && Number(step.applies_to_department_id) !== Number(request.department_id)) {
      return false;
    }
    if (step.applies_to_branch_id != null && Number(step.applies_to_branch_id) !== Number(request.branch_id)) {
      return false;
    }
    const min = money(step.min_amount as string | null);
    const max = money(step.max_amount as string | null);
    if (min != null && amount < min) return false;
    if (max != null && amount > max) return false;
    return true;
  });
  if (applicable.length === 0) {
    throw new HttpError(422, 'This request does not match a configured approval route.', 'NO_ROUTE');
  }
  if (request.transaction_kind === 'expenditure' && !applicable.some((step) => flag(step.is_final_business_step) && flag(step.requires_expenditure_authority))) {
    throw new HttpError(422, 'Company expenditure needs the CEO’s final approval.', 'CEO_APPROVAL_REQUIRED');
  }
  for (const step of applicable) {
    await execute(
      db,
      `INSERT INTO approval_request_steps (
         request_id, workflow_step_id, step_order, parallel_group, name, resolver, role_code, position_code,
         decision_kind, requires_expenditure_authority, is_final_business_step, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
      [
        request.id,
        step.id,
        step.step_order,
        step.parallel_group,
        step.name,
        step.resolver,
        step.role_code,
        step.position_code,
        step.decision_kind,
        step.requires_expenditure_authority,
        step.is_final_business_step,
      ],
    );
  }
  const steps = await loadSteps(db, Number(request.id));
  for (const step of steps) {
    const approvers = await eligibleUserIds(db, request, step);
    if (approvers.length === 0) {
      throw new HttpError(422, `No eligible approver is available for “${step.name}”. You cannot approve your own request.`, 'NO_APPROVER');
    }
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
    if (transactionKind === 'expenditure' && step.isFinalBusinessStep && step.requiresExpenditureAuthority && (step.minAmount != null || step.maxAmount != null)) {
      throw new HttpError(422, 'The CEO’s final financial approval applies to every amount.', 'CEO_THRESHOLD_DENIED');
    }
  }
  if (!steps.some((step) => step.isFinalBusinessStep)) {
    throw new HttpError(422, 'The route must keep a final business approval step for the CEO.', 'FINAL_STEP_REQUIRED');
  }
  if (transactionKind === 'expenditure' && !steps.some((step) => step.isFinalBusinessStep && step.requiresExpenditureAuthority)) {
    throw new HttpError(422, 'An expenditure route must keep a final step that requires expenditure authority.', 'EXPENDITURE_STEP_REQUIRED');
  }
}

async function insertSteps(db: Db, workflowId: number, steps: StepInput[]): Promise<void> {
  for (const step of steps) {
    if (step.roleCode) {
      const role = await queryOne<RowDataPacket>(db, 'SELECT id FROM roles WHERE code = ? AND status = \'active\'', [step.roleCode]);
      if (!role) throw new HttpError(422, `Role ${step.roleCode} does not exist.`, 'INVALID_ROLE');
    }
    if (step.positionCode) {
      const position = await queryOne<RowDataPacket>(db, 'SELECT id FROM positions WHERE code = ? AND status = \'active\'', [step.positionCode]);
      if (!position) throw new HttpError(422, `Position ${step.positionCode} does not exist.`, 'INVALID_POSITION');
    }
    await execute(
      db,
      `INSERT INTO workflow_steps (
         workflow_id, step_order, name, resolver, role_code, position_code, parallel_group, decision_kind,
         requires_expenditure_authority, is_final_business_step, min_amount, max_amount,
         applies_to_department_id, applies_to_branch_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
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
      ],
    );
  }
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
    `SELECT s.* FROM workflow_steps s JOIN workflows w ON w.id = s.workflow_id WHERE w.company_id = ? ORDER BY s.step_order`,
    [companyId],
  );
  return workflows.map((workflow) => ({
    id: Number(workflow.id),
    code: workflow.code,
    name: workflow.name,
    description: workflow.description,
    transactionKind: workflow.transaction_kind,
    completionRoleCode: workflow.completion_role_code,
    status: workflow.status,
    steps: steps.filter((step) => Number(step.workflow_id) === Number(workflow.id)).map((step) => ({
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
    })),
  }));
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
    await execute(connection, 'DELETE FROM workflow_steps WHERE workflow_id = ?', [id]);
    await insertSteps(connection, id, steps);
    await writeAudit(connection, {
      userId: actor.userId,
      action: 'workflow.update',
      module: 'approvals',
      entityType: 'workflow',
      entityId: id,
      newValue: { code: workflow.code, steps: steps.map((step) => ({ name: step.name, minAmount: step.minAmount ?? null, maxAmount: step.maxAmount ?? null })) },
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
    `SELECT a.*, u.username FROM approval_actions a JOIN users u ON u.id = a.actor_user_id WHERE a.request_id = ? ORDER BY a.id`,
    [id],
  );
  return {
    ...mapRequest(row, { canDecide: await canDecide(pool, auth.userId, row) }),
    steps: steps.map(mapStep),
    actions: actions.map((action) => ({
      id: Number(action.id),
      action: action.action,
      comment: action.comment,
      actor: action.username,
      createdAt: action.created_at,
    })),
  };
}

export async function createRequest(auth: AuthContext, input: {
  workflowCode?: string;
  title: string;
  details?: string | null;
  amount?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  submit?: boolean;
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
         department_id, branch_id, requester_user_id, status, source_type, source_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
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
      ],
    );
    await audit(connection, actor, 'approval.create', result.insertId, { reference, workflow: input.workflowCode });
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
       SET title = ?, details = ?, amount = ?, department_id = ?, branch_id = ?
       WHERE id = ?`,
      [input.title, input.details ?? null, input.amount ?? null, input.departmentId ?? null, input.branchId ?? null, id],
    );
    await audit(connection, actor, 'approval.update', id, { title: input.title, amount: input.amount ?? null });
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
    assertApprovalAllowed({
      actorUserId: auth.userId,
      requesterUserId: Number(request.requester_user_id),
      actorIsTechnicalAdmin: actorAuthority.technical,
      actorCanApproveExpenditure: !actorAuthority.technical && (actorAuthority.expenditure || principalAuthority.expenditure),
      actorHasFinalBusinessAuthority: !actorAuthority.technical && (actorAuthority.final || principalAuthority.final),
      transactionKind: flag(chosen.requires_expenditure_authority) ? request.transaction_kind : 'general',
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
