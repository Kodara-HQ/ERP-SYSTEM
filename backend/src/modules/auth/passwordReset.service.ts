import { createHash, randomBytes } from 'crypto';
import type { RowDataPacket } from '../../database/rows';
import { env } from '../../config/env';
import { pool } from '../../database/pool';
import { execute, query, queryOne, withTransaction, type Db } from '../../database/query';
import { writeAudit } from '../../services/auditService';
import { mailConfigured, sendMail } from '../../services/mail';
import { notifyUsersWithPermission } from '../../services/notify';
import { HttpError } from '../../utils/httpError';
import { hashPassword } from '../../utils/password';

type Meta = { ipAddress: string | null; userAgent: string | null };

const LINK_MINUTES = 30;

export type ResetMethod = 'email' | 'administrator';

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** How a forgotten password is handled right now. Does not depend on the account, so it reveals nothing. */
export function resetMethod(): ResetMethod {
  return mailConfigured() ? 'email' : 'administrator';
}

/**
 * Starts a reset for the account with this username or email. The answer is the same whether or not an
 * account matches, so the form cannot be used to find out who has an account.
 */
export async function requestPasswordReset(identifier: string, meta: Meta): Promise<{ method: ResetMethod }> {
  const value = identifier.trim().toLowerCase();
  const method = resetMethod();
  const users = await query<RowDataPacket[]>(
    pool,
    `SELECT id, username, email, status FROM users
     WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND status <> 'disabled'
     ORDER BY id LIMIT 3`,
    [value, value],
  );
  for (const user of users) {
    const sent = method === 'email' && user.email ? await emailResetLink(user, meta) : false;
    if (!sent) await queueForAdministrator(user, meta);
  }
  return { method };
}

async function emailResetLink(user: RowDataPacket, meta: Meta): Promise<boolean> {
  const token = randomBytes(32).toString('base64url');
  const id = await withTransaction(async (db) => {
    await execute(db, `UPDATE password_reset_requests SET status = 'cancelled' WHERE user_id = ? AND method = 'email' AND status = 'open'`, [user.id]);
    const created = await execute(
      db,
      `INSERT INTO password_reset_requests (user_id, method, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, 'email', ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), ?, ?)`,
      [user.id, tokenHash(token), LINK_MINUTES, meta.ipAddress, meta.userAgent?.slice(0, 255) ?? null],
    );
    await writeAudit(db, { userId: Number(user.id), action: 'auth.password_reset_request', module: 'auth', entityType: 'user', entityId: user.id, newValue: { method: 'email' }, ...meta });
    return created.insertId;
  });
  const link = `${env.erpPublicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await sendMail({
    to: String(user.email),
    subject: 'Reset your BAJOGO ERP password',
    text: [
      `Hello ${user.username},`,
      '',
      'Someone asked to reset the password for your BAJOGO ERP account. To choose a new password, open this link:',
      '',
      link,
      '',
      `The link works once and expires in ${LINK_MINUTES} minutes.`,
      'If you did not ask for this, ignore this email. Your password stays the same.',
      '',
      'BAJOGO ERP',
    ].join('\n'),
  });
  if (!sent) await execute(pool, `UPDATE password_reset_requests SET status = 'cancelled' WHERE id = ?`, [id]);
  return sent;
}

async function queueForAdministrator(user: RowDataPacket, meta: Meta) {
  await withTransaction(async (db) => {
    // One waiting request per person is enough; repeated clicks do not flood the administrators.
    const waiting = await queryOne<RowDataPacket>(
      db,
      `SELECT id FROM password_reset_requests WHERE user_id = ? AND method = 'administrator' AND status = 'open' AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)`,
      [user.id],
    );
    if (waiting) return;
    const created = await execute(
      db,
      `INSERT INTO password_reset_requests (user_id, method, ip_address, user_agent) VALUES (?, 'administrator', ?, ?)`,
      [user.id, meta.ipAddress, meta.userAgent?.slice(0, 255) ?? null],
    );
    await writeAudit(db, { userId: Number(user.id), action: 'auth.password_reset_request', module: 'auth', entityType: 'user', entityId: user.id, newValue: { method: 'administrator' }, ...meta });
    await notifyUsersWithPermission(db, 'users.manage', {
      title: 'Password reset requested',
      body: `${user.username} has forgotten their password. Set a temporary password for them under Administration > Users.`,
      notificationType: 'security.password_reset_request',
      entityType: 'password_reset_request',
      entityId: created.insertId,
      excludeUserId: Number(user.id),
    });
  });
}

/** Checks an emailed link before the form is shown. */
export async function checkResetToken(token: string): Promise<{ username: string }> {
  const row = await activeRequest(pool, token);
  return { username: String(row.username) };
}

async function activeRequest(db: Db, token: string, lock = false) {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT r.id, r.user_id, u.username, u.status
     FROM password_reset_requests r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.method = 'email' AND r.status = 'open' AND r.expires_at > UTC_TIMESTAMP(3)${lock ? ' FOR UPDATE' : ''}`,
    [tokenHash(token)],
  );
  if (!row || row.status === 'disabled') {
    throw new HttpError(410, 'This reset link has expired or was already used. Ask for a new one.', 'RESET_LINK_INVALID');
  }
  return row;
}

/** Sets the new password chosen through an emailed link. Every existing sign-in for the account ends. */
export async function completePasswordReset(token: string, newPassword: string, meta: Meta) {
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (db) => {
    const row = await activeRequest(db, token, true);
    await setPassword(db, Number(row.user_id), passwordHash, false);
    await execute(db, `UPDATE password_reset_requests SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE id = ?`, [row.id]);
    await execute(db, `UPDATE password_reset_requests SET status = 'cancelled' WHERE user_id = ? AND status = 'open'`, [row.user_id]);
    await writeAudit(db, { userId: Number(row.user_id), action: 'auth.password_reset', module: 'auth', entityType: 'user', entityId: row.user_id, newValue: { method: 'email' }, ...meta });
  });
  return { reset: true };
}

/** Replaces the password, unlocks the account and signs it out everywhere. */
export async function setPassword(db: Db, userId: number, passwordHash: string, mustChange: boolean) {
  await execute(
    db,
    `UPDATE users
     SET password_hash = ?, must_change_password = ?, token_version = token_version + 1, password_changed_at = UTC_TIMESTAMP(3),
         failed_login_attempts = 0, locked_until = NULL, status = CASE WHEN status = 'locked' THEN 'active' ELSE status END
     WHERE id = ?`,
    [passwordHash, mustChange ? 1 : 0, userId],
  );
  await execute(db, 'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

/** Requests waiting for an administrator, newest first. */
export async function listResetRequests() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT r.id, r.user_id, r.created_at, u.username, u.email
     FROM password_reset_requests r JOIN users u ON u.id = r.user_id
     WHERE r.method = 'administrator' AND r.status = 'open' AND u.status <> 'disabled'
     ORDER BY r.created_at DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    username: String(row.username),
    email: String(row.email),
    requestedAt: row.created_at,
  }));
}
