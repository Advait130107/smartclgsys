import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { get, all, query } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { nowUtc, toUtcIso } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    cb(null, safe);
  },
});
const upload = multer({ storage });

const router = Router();

router.get("/", authRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    let where = "WHERE 1=1";
    const params = [];
    if (req.query.subject_id) {
      where += " AND a.subject_id = ?";
      params.push(req.query.subject_id);
    }
    if (req.user.role === "faculty") {
      where += " AND a.faculty_id = ?";
      params.push(req.user.faculty_id);
    }
    const total = (await get(`SELECT COUNT(*)::int AS c FROM assignment a ${where}`, params)).c;
    const data = await all(
      `SELECT a.*, s.sub_name
       FROM assignment a
       JOIN subject s ON s.subject_id = a.subject_id
       ${where}
       ORDER BY a.due_date ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (req.user.role === "student") {
      const enriched = [];
      for (const row of data) {
        const sub = await get(
          `SELECT * FROM assignment_submission WHERE assign_id = ? AND student_id = ?`,
          [row.assign_id, req.user.student_id]
        );
        enriched.push({ ...row, submission: sub || null });
      }
      return res.json({ data: enriched, total, page, limit });
    }
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", authRequired, requireRole("faculty"), async (req, res) => {
  try {
    const { subject_id, title, due_date } = req.body || {};
    if (!subject_id || !title || !due_date) {
      return res.status(400).json({ error: "subject_id, title, due_date required" });
    }
    const subject = await get("SELECT * FROM subject WHERE subject_id = ?", [subject_id]);
    if (!subject || subject.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Not your subject" });
    }
    const row = await get(
      `INSERT INTO assignment (subject_id, faculty_id, title, due_date, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING assign_id`,
      [subject_id, req.user.faculty_id, title, toUtcIso(due_date), nowUtc()]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "assignment",
      entityId: row.assign_id,
    });
    res.status(201).json({ assign_id: row.assign_id, message: "Assignment created" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/submit", authRequired, requireRole("student"), upload.single("file"), async (req, res) => {
  try {
    const assign = await get("SELECT * FROM assignment WHERE assign_id = ?", [req.params.id]);
    if (!assign) return res.status(404).json({ error: "Assignment not found" });
    if (!req.file) return res.status(400).json({ error: "file required" });
    const row = await get(
      `INSERT INTO assignment_submission (assign_id, student_id, file_name, status, submitted_at)
       VALUES (?, ?, ?, 'submitted', ?)
       ON CONFLICT (assign_id, student_id) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         status = 'submitted',
         submitted_at = EXCLUDED.submitted_at
       RETURNING submission_id`,
      [req.params.id, req.user.student_id, req.file.filename, nowUtc()]
    );
    const facultyUser = await get(`SELECT user_id FROM faculty WHERE faculty_id = ?`, [
      assign.faculty_id,
    ]);
    if (facultyUser) {
      await notificationService.create({
        userId: facultyUser.user_id,
        title: "Assignment submitted",
        message: `A student submitted: ${assign.title}`,
      });
    }
    await auditService.log({
      userId: req.user.user_id,
      action: "SUBMIT",
      entity: "assignment_submission",
      entityId: row.submission_id,
    });
    res.status(201).json({ message: "Submission successful" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/submissions", authRequired, requireRole("faculty", "admin"), async (req, res) => {
  try {
    const assign = await get("SELECT * FROM assignment WHERE assign_id = ?", [req.params.id]);
    if (!assign) return res.status(404).json({ error: "Not found" });
    if (req.user.role === "faculty" && assign.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const data = await all(
      `SELECT sub.*, st.stud_name
       FROM assignment_submission sub
       JOIN student st ON st.student_id = sub.student_id
       WHERE sub.assign_id = ?`,
      [req.params.id]
    );
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("faculty", "admin"), async (req, res) => {
  try {
    const assign = await get("SELECT * FROM assignment WHERE assign_id = ?", [req.params.id]);
    if (!assign) return res.status(404).json({ error: "Not found" });
    if (req.user.role === "faculty" && assign.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await query("DELETE FROM assignment WHERE assign_id = ?", [req.params.id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "assignment",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
