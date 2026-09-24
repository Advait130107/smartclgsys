import { Router } from "express";
import { get, all } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { nowUtc } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";

const router = Router();

router.get("/", authRequired, requireRole("admin", "faculty"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const total = (await get("SELECT COUNT(*)::int AS c FROM feedback")).c;
    const data = await all(
      `SELECT f.*, s.stud_name
       FROM feedback f
       JOIN student s ON s.student_id = f.student_id
       ORDER BY f.feedback_id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", authRequired, requireRole("student"), async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const row = await get(
      `INSERT INTO feedback (student_id, message, created_at) VALUES (?, ?, ?) RETURNING feedback_id`,
      [req.user.student_id, message, nowUtc()]
    );
    await notificationService.notifyAdmins({
      title: "New feedback",
      message: "A student submitted feedback.",
    });
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "feedback",
      entityId: row.feedback_id,
    });
    res.status(201).json({ feedback_id: row.feedback_id, message: "Feedback submitted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
