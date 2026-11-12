import type { Db } from '../../database/query';
import { queryOne } from '../../database/query';
import type { RowDataPacket } from '../../database/rows';

export interface ApprovalChange {
  requestId: number;
  status: string;
  sourceType: string;
  sourceId: number;
}

type Listener = (db: Db, event: ApprovalChange) => Promise<void>;

const listeners: Listener[] = [];

export function onApprovalChange(listener: Listener): void {
  listeners.push(listener);
}

export async function publishApprovalChange(db: Db, requestId: number): Promise<void> {
  const row = await queryOne<RowDataPacket>(
    db,
    'SELECT id, status, source_type, source_id FROM approval_requests WHERE id = ?',
    [requestId],
  );
  if (!row?.source_type || row.source_id == null) {
    return;
  }
  const event: ApprovalChange = {
    requestId: Number(row.id),
    status: String(row.status),
    sourceType: String(row.source_type),
    sourceId: Number(row.source_id),
  };
  for (const listener of listeners) {
    await listener(db, event);
  }
}
