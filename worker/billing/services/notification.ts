import { newId } from '@billing/shared';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
  isRead: boolean;
  link?: string;
  createdAt: string;
}

export class NotificationService {
  constructor(private sql: any) {}

  /**
   * Fetches recent notifications with unread count
   */
  getNotifications(): { notifications: NotificationItem[]; unreadCount: number } {
    const rawSql = this.sql;
    const notifications: NotificationItem[] = [];

    if (rawSql?.exec) {
      const cursor = rawSql.exec(
        `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 30`,
      );
      for (const row of cursor) {
        notifications.push({
          id: row.id,
          title: row.title,
          message: row.message,
          type: row.type,
          isRead: Boolean(row.is_read),
          link: row.link,
          createdAt: row.created_at,
        });
      }
    }

    // Default notifications if none seeded yet
    if (notifications.length === 0) {
      notifications.push(
        {
          id: 'notif_1',
          title: 'Low Stock Alert',
          message: 'Basmati Rice (10kg) is below minimum reorder level (3 units left in Kolkata HQ).',
          type: 'WARNING',
          isRead: false,
          link: '/inventory',
          createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
        },
        {
          id: 'notif_2',
          title: 'Payment Received',
          message: 'Payment of ₹14,750.00 received via UPI QR for Invoice GX/25/26-27/0042.',
          type: 'SUCCESS',
          isRead: false,
          link: '/sales',
          createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
        },
        {
          id: 'notif_3',
          title: '14-Day Free Trial Ending Soon',
          message: '11 days remaining in your free trial. Upgrade now to lock in 17% annual savings.',
          type: 'INFO',
          isRead: false,
          link: '/settings/subscription',
          createdAt: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
        },
        {
          id: 'notif_4',
          title: 'Shift Register Closed',
          message: 'Cash drawer shift #12 closed with exactly ₹0.00 cash discrepancy.',
          type: 'SUCCESS',
          isRead: true,
          link: '/pos',
          createdAt: new Date(Date.now() - 1000 * 60 * 720).toISOString(),
        },
      );
    }

    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return { notifications, unreadCount };
  }

  /**
   * Marks a specific notification as read
   */
  markAsRead(id: string): { success: boolean } {
    if (this.sql?.exec) {
      this.sql.exec(`UPDATE notifications SET is_read = 1 WHERE id = ?`, String(id));
    }
    return { success: true };
  }

  /**
   * Marks all notifications as read
   */
  markAllAsRead(): { success: boolean } {
    if (this.sql?.exec) {
      this.sql.exec(`UPDATE notifications SET is_read = 1 WHERE is_read = 0`);
    }
    return { success: true };
  }

  /**
   * Creates a new notification inside BusinessDO
   */
  createNotification(params: {
    title: string;
    message: string;
    type?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
    link?: string;
  }): NotificationItem {
    const item: NotificationItem = {
      id: `notif_${newId()}`,
      title: params.title,
      message: params.message,
      type: params.type || 'INFO',
      isRead: false,
      link: params.link,
      createdAt: new Date().toISOString(),
    };

    if (this.sql?.exec) {
      this.sql.exec(
        `INSERT INTO notifications (id, title, message, type, is_read, link, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
        item.id, item.title, item.message, item.type, item.link ?? null, item.createdAt,
      );
    }

    return item;
  }
}
