import { get, all, query } from "../db/index.js";
import { nowUtc } from "../utils/dates.js";

export const auditService = {
  async log({ userId = null, action, entity, entityId = null, details = null }) {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        entity,
        entityId != null ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        nowUtc(),
      ]
    );
  },
  async list({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const totalRow = await get("SELECT COUNT(*)::int AS c FROM audit_logs");
    const data = await all(
      `SELECT * FROM audit_logs ORDER BY audit_id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return { data, total: totalRow.c, page, limit };
  },
};
