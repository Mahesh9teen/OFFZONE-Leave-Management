import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification, NotificationFeed, User } from '@leave/contracts';
import { Database } from './db/database.js';

type NotificationRow = Omit<Notification, 'createdAt' | 'readAt'> & { createdAt: Date; readAt: Date | null };

@Injectable()
export class NotificationsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(actor: User): Promise<NotificationFeed> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<NotificationRow>(`SELECT id, title, message, request_id AS "requestId",
        (SELECT EXTRACT(YEAR FROM start_date)::int FROM leave_requests WHERE id = request_id) AS "requestYear",
        created_at AS "createdAt", read_at AS "readAt" FROM notifications WHERE recipient_id = $1
        ORDER BY created_at DESC, event_sequence DESC LIMIT 100`, [actor.id]);
      const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM notifications WHERE recipient_id = $1 AND read_at IS NULL', [actor.id]);
      return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })), unreadCount: count.rows[0].count };
    }, true);
  }

  async markRead(actor: User, id?: string) {
    const result = await this.db.pool.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE recipient_id = $1 AND ($2::uuid IS NULL OR id = $2)',
      [actor.id, id ?? null]);
    if (id && !result.rowCount) throw new NotFoundException('Notification not found.');
    return { message: 'Notifications marked as read.' };
  }
}
