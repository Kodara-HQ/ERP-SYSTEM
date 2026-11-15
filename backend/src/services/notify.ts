import type { RowDataPacket } from '../database/rows';
import type { Db } from '../database/query';
import { execute, query } from '../database/query';

export async function notifyUser(
  db: Db,
  userId: number,
  notification: {
    title: string;
    body: string;
    notificationType: string;
    entityType?: string;
    entityId?: string | number;
  },
): Promise<void> {
  await execute(
    db,
    `INSERT INTO notifications (user_id, title, body, notification_type, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      notification.title.slice(0, 180),
      notification.body.slice(0, 500),
      notification.notificationType,
      notification.entityType ?? null,
      notification.entityId === undefined ? null : String(notification.entityId),
    ],
  );
}

export async function notifyUsersWithPermission(
  db: Db,
  permission: string,
  notification: {
    title: string;
    body: string;
    notificationType: string;
    entityType?: string;
    entityId?: string | number;
    excludeUserId?: number;
  },
): Promise<void> {
  const recipients = await query<RowDataPacket[]>(
    db,
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     JOIN users u ON u.id = ur.user_id AND u.status = 'active'
     WHERE p.code = ?
       AND (ur.starts_on IS NULL OR ur.starts_on <= CURRENT_DATE)
       AND (ur.ends_on IS NULL OR ur.ends_on >= CURRENT_DATE)`,
    [permission],
  );

  for (const recipient of recipients) {
    const userId = Number(recipient.user_id);
    if (notification.excludeUserId === userId) {
      continue;
    }
    await execute(
      db,
      `INSERT INTO notifications (user_id, title, body, notification_type, entity_type, entity_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        notification.title.slice(0, 180),
        notification.body.slice(0, 500),
        notification.notificationType,
        notification.entityType ?? null,
        notification.entityId === undefined ? null : String(notification.entityId),
      ],
    );
  }
}
