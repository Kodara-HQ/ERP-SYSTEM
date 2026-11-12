import type { RowDataPacket } from '../database/rows';
import type { Db } from '../database/query';
import { queryOne } from '../database/query';
import { HttpError } from '../utils/httpError';

export async function requireCompanyId(db: Db): Promise<number> {
  const row = await queryOne<RowDataPacket>(
    db,
    `SELECT id FROM companies WHERE status = 'active' ORDER BY id LIMIT 1`,
  );
  if (!row) {
    throw new HttpError(409, 'Company profile has not been configured.', 'COMPANY_NOT_CONFIGURED');
  }
  return Number(row.id);
}

export async function nextReference(db: Db, sequenceKey: string, prefixSetting: string): Promise<string> {
  const sequence = await queryOne<RowDataPacket>(
    db,
    'SELECT next_value FROM reference_sequences WHERE sequence_key = ? FOR UPDATE',
    [sequenceKey],
  );
  if (!sequence) {
    throw new HttpError(500, `Reference sequence ${sequenceKey} is not configured.`);
  }
  const setting = await queryOne<RowDataPacket>(
    db,
    'SELECT setting_value FROM system_settings WHERE setting_key = ?',
    [prefixSetting],
  );
  const prefix = setting ? String(setting.setting_value).replace(/^"|"$/g, '') : sequenceKey.toUpperCase();
  const value = Number(sequence.next_value);
  await db.query('UPDATE reference_sequences SET next_value = next_value + 1 WHERE sequence_key = ?', [sequenceKey]);
  return `${prefix}-${String(value).padStart(5, '0')}`;
}
