import type { RowDataPacket } from '../../database/rows';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { hasPermission, isTechnicalAdmin } from '../../services/access';
import { nextReference, requireCompanyId } from '../../services/companyContext';
import type { AuthContext } from '../../types/auth';
import { HttpError, notFound } from '../../utils/httpError';

type Actor = { userId: number; ipAddress: string | null; userAgent: string | null };

function assertExecutive(auth: AuthContext) {
  if (isTechnicalAdmin(auth) || !hasPermission(auth, 'executive.review')) {
    throw new HttpError(403, 'Department checks stay with the CEO.', 'FORBIDDEN');
  }
}

export async function listReviews(auth: AuthContext) {
  assertExecutive(auth);
  const reviews = await query<RowDataPacket[]>(
    pool,
    `SELECT r.*, d.name AS department_name FROM departmental_reviews r JOIN departments d ON d.id = r.department_id ORDER BY r.review_date DESC, r.id DESC LIMIT 100`,
  );
  return reviews.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), departmentId: Number(row.department_id),
    department: String(row.department_name), reviewDate: String(row.review_date).slice(0, 10), status: String(row.status), summary: String(row.summary),
  }));
}

export async function createReview(auth: AuthContext, input: {
  departmentId: number;
  reviewDate: string;
  summary: string;
  findings?: Array<{ description: string; severity: 'low' | 'medium' | 'high' }>;
}, actor: Actor) {
  assertExecutive(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const department = await queryOne<RowDataPacket>(connection, 'SELECT id FROM departments WHERE id = ? AND company_id = ?', [input.departmentId, companyId]);
    if (!department) throw new HttpError(422, 'Choose a department.', 'INVALID_DEPARTMENT');
    const reference = await nextReference(connection, 'departmental_review', 'departmental_review_prefix');
    const created = await execute(
      connection,
      `INSERT INTO departmental_reviews (company_id, reference_number, department_id, review_date, summary, reviewer_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.departmentId, input.reviewDate, input.summary, auth.userId],
    );
    for (const finding of input.findings ?? []) {
      await execute(connection, 'INSERT INTO management_findings (review_id, description, severity) VALUES (?, ?, ?)', [created.insertId, finding.description, finding.severity]);
    }
    await writeAudit(connection, {
      userId: actor.userId, action: 'executive.review', module: 'executive', entityType: 'departmental_review', entityId: created.insertId,
      newValue: { reference, departmentId: input.departmentId }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}

export async function listActions(auth: AuthContext) {
  const executive = hasPermission(auth, 'executive.review') && !isTechnicalAdmin(auth);
  const rows = await query<RowDataPacket[]>(
    pool,
    executive
      ? `SELECT a.*, d.name AS department_name, u.username FROM corrective_actions a
         JOIN departments d ON d.id = a.department_id JOIN users u ON u.id = a.assigned_to_user_id
         ORDER BY a.due_on, a.id DESC LIMIT 200`
      : `SELECT a.*, d.name AS department_name, u.username FROM corrective_actions a
         JOIN departments d ON d.id = a.department_id JOIN users u ON u.id = a.assigned_to_user_id
         WHERE a.assigned_to_user_id = ? ORDER BY a.due_on, a.id DESC LIMIT 200`,
    executive ? [] : [auth.userId],
  );
  if (!executive && rows.length === 0 && !hasPermission(auth, 'dashboard.view')) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
  return rows.map((row) => ({
    id: Number(row.id), referenceNumber: String(row.reference_number), reviewId: Number(row.review_id),
    department: String(row.department_name), title: String(row.title), dueOn: String(row.due_on).slice(0, 10),
    status: String(row.status), assignee: String(row.username), assignedToUserId: Number(row.assigned_to_user_id),
    response: row.response == null ? null : String(row.response), reviewNote: row.review_note == null ? null : String(row.review_note),
  }));
}

export async function createAction(auth: AuthContext, input: { reviewId: number; findingId?: number; title: string; dueOn: string; assignedToUserId: number }, actor: Actor) {
  assertExecutive(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const review = await queryOne<RowDataPacket>(connection, 'SELECT * FROM departmental_reviews WHERE id = ? AND company_id = ?', [input.reviewId, companyId]);
    if (!review) throw notFound('Department review');
    const assignee = await queryOne<RowDataPacket>(connection, `SELECT id FROM users WHERE id = ? AND status = 'active'`, [input.assignedToUserId]);
    if (!assignee) throw new HttpError(422, 'Choose an active user.', 'INVALID_USER');
    const reference = await nextReference(connection, 'corrective_action', 'corrective_action_prefix');
    const created = await execute(
      connection,
      `INSERT INTO corrective_actions (company_id, reference_number, review_id, finding_id, department_id, title, due_on, assigned_to_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.reviewId, input.findingId ?? null, review.department_id, input.title, input.dueOn, input.assignedToUserId],
    );
    await writeAudit(connection, {
      userId: actor.userId, action: 'executive.action', module: 'executive', entityType: 'corrective_action', entityId: created.insertId,
      newValue: { reference, assignedToUserId: input.assignedToUserId }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}

export async function respondAction(auth: AuthContext, id: number, response: string, actor: Actor) {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM corrective_actions WHERE id = ?', [id]);
  if (!row) throw notFound('Corrective action');
  if (Number(row.assigned_to_user_id) !== auth.userId) throw new HttpError(403, 'This action is assigned to someone else.', 'FORBIDDEN');
  if (!['open', 'outstanding'].includes(String(row.status))) throw new HttpError(409, 'This action is not waiting for a response.', 'NOT_OPEN');
  await execute(pool, `UPDATE corrective_actions SET response = ?, status = 'responded' WHERE id = ?`, [response, id]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'executive.respond', module: 'executive', entityType: 'corrective_action', entityId: id,
    newValue: { status: 'responded' }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id, status: 'responded' };
}

export async function resolveAction(auth: AuthContext, id: number, input: { status: 'resolved' | 'outstanding'; reviewNote: string }, actor: Actor) {
  assertExecutive(auth);
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id FROM corrective_actions WHERE id = ?', [id]);
  if (!row) throw notFound('Corrective action');
  await execute(pool, 'UPDATE corrective_actions SET status = ?, review_note = ? WHERE id = ?', [input.status, input.reviewNote, id]);
  await writeAudit(pool, {
    userId: actor.userId, action: 'executive.resolve', module: 'executive', entityType: 'corrective_action', entityId: id,
    newValue: input, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
  });
  return { id, status: input.status };
}

export async function listMeetings(auth: AuthContext) {
  assertExecutive(auth);
  const meetings = await query<RowDataPacket[]>(pool, 'SELECT * FROM management_meetings ORDER BY held_on DESC, id DESC LIMIT 100');
  const actions = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, d.name AS department_name FROM meeting_actions a JOIN departments d ON d.id = a.department_id ORDER BY a.id`,
  );
  return meetings.map((meeting) => ({
    id: Number(meeting.id),
    referenceNumber: String(meeting.reference_number),
    heldOn: String(meeting.held_on).slice(0, 10),
    title: String(meeting.title),
    notes: String(meeting.notes),
    actions: actions.filter((action) => Number(action.meeting_id) === Number(meeting.id)).map((action) => ({
      id: Number(action.id), description: String(action.description), department: String(action.department_name),
      dueOn: action.due_on == null ? null : String(action.due_on).slice(0, 10), status: String(action.status),
    })),
  }));
}

export async function createMeeting(auth: AuthContext, input: {
  heldOn: string;
  title: string;
  notes: string;
  actions?: Array<{ description: string; departmentId: number; dueOn?: string }>;
}, actor: Actor) {
  assertExecutive(auth);
  return withTransaction(async (connection) => {
    const companyId = await requireCompanyId(connection);
    const reference = await nextReference(connection, 'management_meeting', 'management_meeting_prefix');
    const created = await execute(
      connection,
      `INSERT INTO management_meetings (company_id, reference_number, held_on, title, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [companyId, reference, input.heldOn, input.title, input.notes, auth.userId],
    );
    for (const action of input.actions ?? []) {
      await execute(
        connection,
        'INSERT INTO meeting_actions (meeting_id, description, department_id, due_on) VALUES (?, ?, ?, ?)',
        [created.insertId, action.description, action.departmentId, action.dueOn ?? null],
      );
    }
    await writeAudit(connection, {
      userId: actor.userId, action: 'executive.meeting', module: 'executive', entityType: 'management_meeting', entityId: created.insertId,
      newValue: { reference, title: input.title }, ipAddress: actor.ipAddress, userAgent: actor.userAgent,
    });
    return { id: created.insertId, referenceNumber: reference };
  });
}
