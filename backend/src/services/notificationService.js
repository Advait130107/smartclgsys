import { get, all, query, withTransaction } from "../db/index.js";
import { nowUtc } from "../utils/dates.js";

export const notificationService = {
  async create({ userId, title, message }) {
    const row = await get(
      `INSERT INTO notifications (user_id, title, message, is_read, created_at)
       VALUES (?, ?, ?, 0, ?) RETURNING notification_id`,
      [userId, title, message, nowUtc()]
    );
    return row.notification_id;
  },
  async notifyAdmins({ title, message }) {
    const admins = await all(`SELECT user_id FROM users WHERE role = 'admin'`);
    const ts = nowUtc();
    await withTransaction(async (tx) => {
      for (const a of admins) {
        await tx.query(
          `INSERT INTO notifications (user_id, title, message, is_read, created_at)
           VALUES (?, ?, ?, 0, ?)`,
          [a.user_id, title, message, ts]
        );
      }
    });
  },
  async listForUser(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const totalRow = await get(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ?`,
      [userId]
    );
    const data = await all(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY notification_id DESC LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
    return { data, total: totalRow.c, page, limit };
  },
  async markRead(notificationId, userId) {
    await query(
      `UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`,
      [notificationId, userId]
    );
  },
};
