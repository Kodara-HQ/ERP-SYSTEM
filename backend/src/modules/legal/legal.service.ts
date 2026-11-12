import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import type { Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasFinalBusinessAuthority, hasPermission, isTechnicalAdmin } from '../../services/access';
import { requireCompanyId, nextReference } from '../../services/companyContext';
import { recordVisibility, departmentClause } from '../../services/visibility';
import { workspaceAllows, workspaceGate } from '../../services/workspaces';
import { createRequest, decideRequest } from '../approvals/approval.service';
import { onApprovalChange, type ApprovalChange } from '../approvals/approval.hooks';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

async function legalDesk(auth: AuthContext) {
  if (isTechnicalAdmin(auth)) return false;
  const gate = await workspaceGate(auth);
  return (hasPermission(auth, 'legal.manage') || hasPermission(auth, 'legal.view_confidential')) && (hasFinalBusinessAuthority(auth) || workspaceAllows(gate, 'legal'));
}

async function assertReader(auth: AuthContext) {
  if (isTechnicalAdmin(auth)) throw new HttpError(403, 'Legal records are outside technical administration.', 'FORBIDDEN');
  if (await legalDesk(auth)) return;
  if (hasPermission(auth, 'legal.request')) return;
  throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
}

function mapDocument(row: RowDataPacket) {
  return {
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    documentType: String(row.document_type),
    title: String(row.title),
    counterparty: String(row.counterparty),
    departmentId: Number(row.department_id),
    department: row.department_name == null ? null : String(row.department_name),
    effectiveOn: row.effective_on == null ? null : String(row.effective_on).slice(0, 10),
    expiryOn: row.expiry_on == null ? null : String(row.expiry_on).slice(0, 10),
    status: String(row.status),
    custodyNote: row.custody_note == null ? null : String(row.custody_note),
    summary: String(row.summary),
    approvalRequestId: row.approval_request_id == null ? null : Number(row.approval_request_id),
    clearedAt: row.cleared_at ?? null,
  };
}

const documentFrom = `FROM legal_documents d LEFT JOIN departments dep ON dep.id = d.department_id`;

export async function listDocuments(auth: AuthContext) {
  await assertReader(auth);
  const desk = await legalDesk(auth);
  const visibility = await recordVisibility(auth);
  const scope = desk ? { sql: '1=1', params: [] as unknown[] } : departmentClause(visibility, 'd.department_id');
  const own = desk ? '' : ' OR d.created_by = ?';
  const params = desk ? [] : [...scope.params, auth.userId];
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT d.*, dep.name AS department_name ${documentFrom} WHERE (${scope.sql}${own}) ORDER BY d.id DESC LIMIT 200`,
    params,
  );
  return rows.map(mapDocument);
}

export async function getDocument(auth: AuthContext, id: number) {
  await assertReader(auth);
  const row = await queryOne<RowDataPacket>(pool, `SELECT d.*, dep.name AS department_name ${documentFrom} WHERE d.id = ?`, [id]);
  if (!row) throw notFound('Legal document');
  if (!(await legalDesk(auth)) && Number(row.created_by) !== auth.userId) {
    const visibility = await recordVisibility(auth);
    if (!visibility.companyWide && !visibility.departmentIds.includes(Number(row.department_id))) throw notFound('Legal document');
  }
  const obligations = await query<RowDataPacket[]>(pool, 'SELECT * FROM legal_obligations WHERE document_id = ? ORDER BY due_on', [id]);
  const comments = await query<RowDataPacket[]>(
    pool,
    `SELECT c.*, u.username FROM legal_comments c JOIN users u ON u.id = c.user_id WHERE c.document_id = ? ORDER BY c.id`,
    [id],
  );
  return {
    ...mapDocument(row),
    obligations: obligations.map((item) => ({
      id: Number(item.id), description: String(item.description), dueOn: String(item.due_on).slice(0, 10), status: String(item.status),
    })),
    comments: comments.map((item) => ({
      id: Number(item.id), recommendation: String(item.recommendation), comment: String(item.comment), actor: String(item.username), createdAt: item.created_at,
    })),
  };
}

async function primaryDepartment(db: Db, auth: AuthContext) {
  if (!auth.employeeId) throw new HttpError(422, 'A legal request needs an employee assignment in a department.', 'NO_DEPARTMENT');
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT department_id, branch_id FROM employee_assignments WHERE employee_id = ? AND is_primary = 1 AND end_date IS NULL',
    [auth.employeeId],
  );
  if (!row?.department_id) throw new HttpError(422, 'A legal request needs an employee assignment in a department.', 'NO_DEPARTMENT');
  return { departmentId: Number(row.department_id), branchId: row.branch_id == null ? null : Number(row.branch_id) };
}

export async function createDocument(auth: AuthContext, input: {
  documentType: 'contract' | 'mou' | 'agreement';
  title: string;
  counterparty: string;
  effectiveOn?: string;
  expiryOn?: string;
  custodyNote?: string;
  summary: string;
}, actor: Actor) {
  await assertReader(auth);
  if (!hasPermission(auth, 'legal.request') && !hasPermission(auth, 'legal.manage')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const place = await primaryDepartment(connection, auth);
    const reference = await nextReference(connection, 'legal_document', 'legal_document_prefix');
    const created = await execute(
      connection,
      `INSERT INTO legal_documents (
         company_id, reference_number, document_type, title, counterparty, department_id, effective_on, expiry_on, status, custody_note, summary, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [companyId, reference, input.documentType, input.title, input.counterparty, place.departmentId, input.effectiveOn ?? null, input.expiryOn ?? null, input.custodyNote ?? null, input.summary, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'legal.create', module: 'legal', entityType: 'legal_document', entityId: created.insertId,
      newValue: { reference, documentType: input.documentType, title: input.title }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, `SELECT d.*, dep.name AS department_name ${documentFrom} WHERE d.id = ?`, [created.insertId]);
    return mapDocument(row!);
  });
}

export async function submitDocument(auth: AuthContext, id: number, actor: Actor) {
  await assertReader(auth);
  return withTransaction(async (connection) => {
    const document = await queryOne<RowDataPacket>(connection, 'SELECT * FROM legal_documents WHERE id = ? FOR UPDATE', [id]);
    if (!document) throw notFound('Legal document');
    if (Number(document.created_by) !== auth.userId && !hasPermission(auth, 'legal.manage')) {
      throw new HttpError(403, 'Only the requesting department can submit this document.', 'FORBIDDEN');
    }
    if (String(document.status) !== 'draft') throw new HttpError(409, 'Only a draft can be submitted for legal review.', 'NOT_DRAFT');
    const place = await queryOne<RowDataPacket>(connection, 'SELECT branch_id FROM departments WHERE id = ?', [document.department_id]);
    const approval = await createRequest(auth, {
      workflowCode: 'CONTRACT',
      title: `${document.document_type} ${document.reference_number}`,
      details: String(document.summary),
      departmentId: Number(document.department_id),
      branchId: place?.branch_id == null ? null : Number(place.branch_id),
      submit: true,
      sourceType: 'legal_document',
      sourceId: id,
    }, actor, connection);
    await execute(connection, `UPDATE legal_documents SET approval_request_id = ?, status = 'in_review' WHERE id = ?`, [approval.id, id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'legal.submit', module: 'legal', entityType: 'legal_document', entityId: id,
      newValue: { approvalId: approval.id }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, `SELECT d.*, dep.name AS department_name ${documentFrom} WHERE d.id = ?`, [id]);
    return mapDocument(row!);
  });
}

export async function reviewDocument(auth: AuthContext, id: number, input: { action: 'approve' | 'reject' | 'return'; recommendation: 'recommend' | 'amend' | 'concern'; comment: string }, actor: Actor) {
  if (!(await legalDesk(auth)) || !hasPermission(auth, 'legal.manage') && !hasPermission(auth, 'legal.view_confidential')) {
    if (!hasFinalBusinessAuthority(auth)) throw new HttpError(403, 'Legal review stays with Legal Affairs or the CEO.', 'FORBIDDEN');
  }
  const document = await queryOne<RowDataPacket>(pool, 'SELECT * FROM legal_documents WHERE id = ?', [id]);
  if (!document) throw notFound('Legal document');
  if (!document.approval_request_id) throw new HttpError(409, 'This document has not been submitted.', 'NOT_SUBMITTED');
  if (hasPermission(auth, 'legal.manage') || hasPermission(auth, 'legal.view_confidential')) {
    await execute(
      pool,
      'INSERT INTO legal_comments (document_id, recommendation, comment, user_id) VALUES (?, ?, ?, ?)',
      [id, input.recommendation, input.comment, auth.userId],
    );
  }
  await decideRequest(auth, Number(document.approval_request_id), { action: input.action, comment: input.comment }, actor);
  await writeAudit(pool, {
    userId: actor.userId, action: 'legal.review', module: 'legal', entityType: 'legal_document', entityId: id,
    newValue: { recommendation: input.recommendation, action: input.action }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return getDocument(auth, id);
}

export async function executeDocument(auth: AuthContext, id: number, actor: Actor) {
  if (!hasPermission(auth, 'legal.manage')) throw new HttpError(403, 'Only Legal Affairs can record execution.', 'FORBIDDEN');
  return withTransaction(async (connection) => {
    const document = await queryOne<RowDataPacket>(connection, 'SELECT * FROM legal_documents WHERE id = ? FOR UPDATE', [id]);
    if (!document) throw notFound('Legal document');
    if (String(document.status) !== 'approved') throw new HttpError(409, 'Legal clearance and CEO approval are required before execution.', 'NOT_CLEARED');
    if (!document.cleared_at) throw new HttpError(409, 'Legal clearance has not been recorded.', 'NOT_CLEARED');
    await execute(connection, `UPDATE legal_documents SET status = 'executed' WHERE id = ?`, [id]);
    await writeAudit(connection, {
      userId: actor.userId, action: 'legal.execute', module: 'legal', entityType: 'legal_document', entityId: id,
      newValue: { reference: document.reference_number }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    const row = await queryOne<RowDataPacket>(connection, `SELECT d.*, dep.name AS department_name ${documentFrom} WHERE d.id = ?`, [id]);
    return mapDocument(row!);
  });
}

export async function addObligation(auth: AuthContext, id: number, input: { description: string; dueOn: string }, actor: Actor) {
  if (!hasPermission(auth, 'legal.manage')) throw new HttpError(403, 'Only Legal Affairs can record obligations.', 'FORBIDDEN');
  const document = await queryOne<RowDataPacket>(pool, 'SELECT id FROM legal_documents WHERE id = ?', [id]);
  if (!document) throw notFound('Legal document');
  const created = await execute(pool, 'INSERT INTO legal_obligations (document_id, description, due_on) VALUES (?, ?, ?)', [id, input.description, input.dueOn]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'legal.obligation', module: 'legal', entityType: 'legal_obligation', entityId: created.insertId,
    newValue: { documentId: id, dueOn: input.dueOn }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id: created.insertId };
}

export async function setObligationStatus(auth: AuthContext, id: number, status: 'open' | 'met' | 'overdue', actor: Actor) {
  if (!hasPermission(auth, 'legal.manage')) throw new HttpError(403, 'Only Legal Affairs can update obligations.', 'FORBIDDEN');
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id FROM legal_obligations WHERE id = ?', [id]);
  if (!row) throw notFound('Obligation');
  await execute(pool, 'UPDATE legal_obligations SET status = ? WHERE id = ?', [status, id]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'legal.obligation_status', module: 'legal', entityType: 'legal_obligation', entityId: id,
    newValue: { status }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id, status };
}

export async function listRisks(auth: AuthContext) {
  if (!(await legalDesk(auth))) throw new HttpError(403, 'The risk register stays with Legal Affairs.', 'FORBIDDEN');
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM legal_risks ORDER BY id DESC LIMIT 200');
  return rows.map((row) => ({
    id: Number(row.id),
    referenceNumber: String(row.reference_number),
    title: String(row.title),
    description: String(row.description),
    likelihood: String(row.likelihood),
    impact: String(row.impact),
    status: String(row.status),
    departmentId: row.department_id == null ? null : Number(row.department_id),
  }));
}

export async function createRisk(auth: AuthContext, input: {
  title: string; description: string; likelihood: 'low' | 'medium' | 'high'; impact: 'low' | 'medium' | 'high'; departmentId?: number;
}, actor: Actor) {
  if (!hasPermission(auth, 'legal.manage')) throw new HttpError(403, 'Only Legal Affairs can record legal risks.', 'FORBIDDEN');
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const reference = await nextReference(connection, 'legal_risk', 'legal_risk_prefix');
    const created = await execute(
      connection,
      `INSERT INTO legal_risks (company_id, reference_number, title, description, likelihood, impact, department_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.title, input.description, input.likelihood, input.impact, input.departmentId ?? null, auth.userId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'legal.risk', module: 'legal', entityType: 'legal_risk', entityId: created.insertId,
      newValue: { reference, title: input.title }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}

export async function setRiskStatus(auth: AuthContext, id: number, status: 'open' | 'monitoring' | 'closed', actor: Actor) {
  if (!hasPermission(auth, 'legal.manage')) throw new HttpError(403, 'Only Legal Affairs can update legal risks.', 'FORBIDDEN');
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id FROM legal_risks WHERE id = ?', [id]);
  if (!row) throw notFound('Legal risk');
  await execute(pool, 'UPDATE legal_risks SET status = ? WHERE id = ?', [status, id]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'legal.risk_status', module: 'legal', entityType: 'legal_risk', entityId: id,
    newValue: { status }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id, status };
}

export async function expiringDocuments(auth: AuthContext) {
  if (!(await legalDesk(auth)) && !hasFinalBusinessAuthority(auth)) throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT id, reference_number, title, expiry_on FROM legal_documents
     WHERE expiry_on IS NOT NULL AND expiry_on <= DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY) AND status NOT IN ('rejected', 'draft')
     ORDER BY expiry_on`,
  );
  return rows.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), title: String(row.title), expiryOn: String(row.expiry_on).slice(0, 10),
  }));
}

async function syncDocument(db: Db, event: ApprovalChange) {
  if (event.sourceType !== 'legal_document') return;
  const document = await queryOne<RowDataPacket>(db, 'SELECT * FROM legal_documents WHERE id = ? FOR UPDATE', [event.sourceId]);
  if (!document || String(document.status) === 'executed') return;
  let status = String(document.status);
  let cleared = document.cleared_at;
  if (event.status === 'rejected') status = 'rejected';
  else if (event.status === 'returned_for_correction') status = 'returned';
  else if (['approved', 'processing', 'completed'].includes(event.status)) status = 'approved';
  else {
    const step = await queryOne<RowDataPacket>(
      db,
      `SELECT name FROM approval_request_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_order LIMIT 1`,
      [event.requestId],
    );
    const name = String(step?.name ?? '');
    if (name.toLowerCase().includes('ceo')) {
      status = 'awaiting_ceo';
      cleared = cleared ?? new Date();
    } else status = 'in_review';
  }
  await execute(db, 'UPDATE legal_documents SET status = ?, cleared_at = ? WHERE id = ?', [status, cleared, document.id]);
}

onApprovalChange(syncDocument);
