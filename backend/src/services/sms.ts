import { env } from '../config/env';
import { pool } from '../database/pool';
import { execute, query } from '../database/query';
import type { Db } from '../database/query';
import type { RowDataPacket } from '../database/rows';
import { logger } from '../utils/logger';

const maxAttempts = 3;
const requestTimeoutMs = 15000;

export type SmsStatus = 'queued' | 'sent' | 'failed' | 'skipped';

type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 10 && digits.length <= 15 ? digits : null;
  if (digits.startsWith('00')) return normalizePhone(`+${digits.slice(2)}`);
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  if (/^233\d{9}$/.test(digits)) return digits;
  if (/^[235]\d{8}$/.test(digits)) return `233${digits}`;
  return null;
}

export function formatCedis(amount: number): string {
  return `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function queueSms(
  db: Db,
  input: {
    companyId: number;
    employeeId?: number | null;
    purpose: string;
    sourceType?: string;
    sourceId?: string | number;
    payrollLineId?: number | null;
    phone: string | null | undefined;
    message: string;
  },
): Promise<number> {
  const recipient = normalizePhone(input.phone);
  const created = await execute(
    db,
    `INSERT INTO sms_messages (company_id, employee_id, purpose, source_type, source_id, payroll_line_id, recipient, message, status, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.companyId,
      input.employeeId ?? null,
      input.purpose,
      input.sourceType ?? null,
      input.sourceId === undefined ? null : String(input.sourceId),
      input.payrollLineId ?? null,
      recipient,
      input.message,
      recipient ? 'queued' : 'skipped',
      recipient ? null : input.phone ? 'The phone number on file is not a valid mobile number.' : 'No phone number on file.',
    ],
  );
  return created.insertId;
}

async function post(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

async function sendArkesel(to: string, message: string): Promise<SendResult> {
  const { status, body } = await post('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': env.sms.arkeselApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: env.sms.senderId, message, recipients: [to] }),
  });
  if (status === 200 && body.status === 'success') {
    const data = Array.isArray(body.data) ? (body.data as Array<{ id?: string }>) : [];
    const id = data.find((item) => item.id)?.id ?? null;
    if (id) return { ok: true, messageId: id };
    return { ok: false, error: 'Arkesel rejected the phone number.' };
  }
  return { ok: false, error: `Arkesel ${status}: ${String(body.message ?? 'send failed')}` };
}

async function sendHubtel(to: string, message: string): Promise<SendResult> {
  const credentials = Buffer.from(`${env.sms.hubtelClientId}:${env.sms.hubtelClientSecret}`).toString('base64');
  const { status, body } = await post('https://sms.hubtel.com/v1/messages/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ From: env.sms.senderId, To: to, Content: message }),
  });
  if (status >= 200 && status < 300 && Number(body.status) === 0) {
    return { ok: true, messageId: body.messageId == null ? null : String(body.messageId) };
  }
  return { ok: false, error: `Hubtel ${status}: ${String(body.statusDescription ?? body.message ?? 'send failed')}` };
}

export async function sendOne(to: string, message: string): Promise<SendResult> {
  try {
    if (env.sms.provider === 'arkesel') return await sendArkesel(to, message);
    if (env.sms.provider === 'hubtel') return await sendHubtel(to, message);
    logger.info('SMS (log provider, not sent to a network)', { to, message });
    return { ok: true, messageId: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'SMS provider could not be reached.' };
  }
}

export async function dispatchSms(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT id, recipient, message, attempts FROM sms_messages
     WHERE id IN (${ids.map(() => '?').join(', ')}) AND status IN ('queued', 'failed') AND recipient IS NOT NULL AND attempts < ?`,
    [...ids, maxAttempts],
  );
  for (const row of rows) {
    const result = await sendOne(String(row.recipient), String(row.message));
    if (result.ok) {
      await execute(
        pool,
        `UPDATE sms_messages SET status = 'sent', provider = ?, provider_message_id = ?, attempts = attempts + 1, last_error = NULL, sent_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [env.sms.provider, result.messageId, row.id],
      );
    } else {
      logger.warn('SMS send failed', { id: Number(row.id), error: result.error });
      await execute(
        pool,
        `UPDATE sms_messages SET status = 'failed', provider = ?, attempts = attempts + 1, last_error = ? WHERE id = ?`,
        [env.sms.provider, result.error.slice(0, 400), row.id],
      );
    }
  }
}

export function dispatchSmsInBackground(ids: number[]): void {
  dispatchSms(ids).catch((error: unknown) => logger.error('SMS dispatch crashed', { error: error instanceof Error ? error.message : String(error) }));
}

export async function resetForRetry(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT id FROM sms_messages WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'failed' AND recipient IS NOT NULL`,
    ids,
  );
  const retry = rows.map((row) => Number(row.id));
  if (retry.length > 0) {
    await execute(pool, `UPDATE sms_messages SET attempts = 0 WHERE id IN (${retry.map(() => '?').join(', ')})`, retry);
  }
  return retry;
}
