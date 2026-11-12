import type { Request } from 'express';
import type { Db } from '../database/query';
import { execute } from '../database/query';
import { redact } from '../utils/redact';

export interface AuditEntry {
  userId: number | null;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | number | null;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
  };
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await execute(
    db,
    `INSERT INTO audit_logs
      (user_id, action, module, entity_type, entity_id, previous_value, new_value, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.userId,
      entry.action,
      entry.module,
      entry.entityType,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.previousValue === undefined ? null : JSON.stringify(redact(entry.previousValue)),
      entry.newValue === undefined ? null : JSON.stringify(redact(entry.newValue)),
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ],
  );
}
