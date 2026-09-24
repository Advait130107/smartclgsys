import { Router } from "express";
import { get, all, withTransaction } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { nowUtc, toUtcDateOnly } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";

const router = Router();

router.get("/", authRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { subject_id, student_id, date } = req.query;

    let where = "WHERE 1=1";
    const params = [];

    if (req.user.role === "student") {
      where += " AND a.student_id = ?";
      params.push(req.user.student_id);
    } else {
      if (student_id) {
        where += " AND a.student_id = ?";
        params.push(student_id);
      }
      if (req.user.role === "faculty") {
        where += " AND s.faculty_id = ?";
        params.push(req.user.faculty_id);
      }
    }
    if (subject_id) {
      where += " AND a.subject_id = ?";
      params.push(subject_id);
    }
    if (date) {
      where += " AND a.date = ?";
      params.push(toUtcDateOnly(date));
    }

    const total = (
      await get(
        `SELECT COUNT(*)::int AS c FROM attendance a
         JOIN subject s ON s.subject_id = a.subject_id
         ${where}`,
        params
      )
    ).c;

    const data = await all(
      `SELECT a.*, st.stud_name, s.sub_name
       FROM attendance a
       JOIN student st ON st.student_id = a.student_id
       JOIN subject s ON s.subject_id = a.subject_id
       ${where}
       ORDER BY a.date DESC, a.att_id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", authRequired, requireRole("faculty"), async (req, res) => {
  try {
    const { subject_id, date, records } = req.body || {};
    if (!subject_id || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "subject_id and records required" });
    }
    const subject = await get("SELECT * FROM subject WHERE subject_id = ?", [subject_id]);
    if (!subject || subject.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Not your subject" });
    }
    const attDate = toUtcDateOnly(date);
    await withTransaction(async (tx) => {
      for (const r of records) {
        if (!["present", "absent"].includes(r.status)) continue;
        await tx.query(
          `INSERT INTO attendance (student_id, subject_id, date, status, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (student_id, subject_id, date) DO UPDATE SET status = EXCLUDED.status`,
          [r.student_id, subject_id, attDate, r.status, nowUtc()]
        );
        const st = await tx.get("SELECT user_id FROM student WHERE student_id = ?", [r.student_id]);
        if (st) {
          await notificationService.create({
            userId: st.user_id,
            title: "Attendance marked",
            message: `Attendance for ${subject.sub_name} on ${attDate}: ${r.status}`,
          });
        }
      }
    });
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "attendance",
      entityId: subject_id,
      details: { date: attDate, count: records.length },
    });
    res.status(201).json({ message: "Attendance saved" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
