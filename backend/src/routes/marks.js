import { Router } from "express";
import { get, all, query } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { nowUtc } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";
import multer from "multer";
import { parseCsv, csvResponse } from "../utils/csv.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/export", authRequired, requireRole("faculty", "admin"), async (req, res) => {
  try {
    let rows;
    if (req.user.role === "faculty") {
      rows = await all(`SELECT m.mark_id, m.student_id, m.subject_id, m.score, m.exam_type FROM marks m JOIN subject s ON s.subject_id = m.subject_id WHERE s.faculty_id = ? ORDER BY m.mark_id`, [req.user.faculty_id]);
    } else {
      rows = await all(`SELECT mark_id, student_id, subject_id, score, exam_type FROM marks ORDER BY mark_id`);
    }
    csvResponse(res, "marks.csv", ["mark_id", "student_id", "subject_id", "score", "exam_type"], rows.map((r) => [r.mark_id, r.student_id, r.subject_id, r.score, r.exam_type]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/import", authRequired, requireRole("faculty", "admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "CSV file required" });
    const rows = parseCsv(req.file.buffer.toString("utf8"));
    let imported = 0;
    for (const row of rows) {
      const studentId = Number(row.student_id);
      const subjectId = Number(row.subject_id);
      const score = Number(row.score);
      const examType = row.exam_type || "midterm";
      if (!studentId || !subjectId || Number.isNaN(score)) continue;
      const subject = await get("SELECT * FROM subject WHERE subject_id = ?", [subjectId]);
      if (!subject || (req.user.role === "faculty" && subject.faculty_id !== req.user.faculty_id)) continue;
      await query(`INSERT INTO marks (student_id, subject_id, score, exam_type, created_at) VALUES (?, ?, ?, ?, ?)`, [studentId, subjectId, score, examType, nowUtc()]);
      imported += 1;
    }
    res.json({ message: `Imported ${imported} mark rows` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/", authRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    let where = "WHERE 1=1";
    const params = [];
    if (req.user.role === "student") {
      where += " AND m.student_id = ?";
      params.push(req.user.student_id);
    } else if (req.user.role === "faculty") {
      where += " AND s.faculty_id = ?";
      params.push(req.user.faculty_id);
    }
    if (req.query.subject_id) {
      where += " AND m.subject_id = ?";
      params.push(req.query.subject_id);
    }
    const total = (
      await get(
        `SELECT COUNT(*)::int AS c FROM marks m JOIN subject s ON s.subject_id = m.subject_id ${where}`,
        params
      )
    ).c;
    const data = await all(
      `SELECT m.*, st.stud_name, s.sub_name
       FROM marks m
       JOIN student st ON st.student_id = m.student_id
       JOIN subject s ON s.subject_id = m.subject_id
       ${where}
       ORDER BY m.mark_id DESC
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
    const { student_id, subject_id, score, exam_type } = req.body || {};
    if (!student_id || !subject_id || score == null || !exam_type) {
      return res.status(400).json({ error: "student_id, subject_id, score, exam_type required" });
    }
    const subject = await get("SELECT * FROM subject WHERE subject_id = ?", [subject_id]);
    if (!subject || subject.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Not your subject" });
    }
    const row = await get(
      `INSERT INTO marks (student_id, subject_id, score, exam_type, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING mark_id`,
      [student_id, subject_id, score, exam_type, nowUtc()]
    );
    const st = await get("SELECT user_id FROM student WHERE student_id = ?", [student_id]);
    if (st) {
      await notificationService.create({
        userId: st.user_id,
        title: "Marks entered",
        message: `${exam_type} score for ${subject.sub_name}: ${score}`,
      });
    }
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "marks",
      entityId: row.mark_id,
    });
    res.status(201).json({ mark_id: row.mark_id, message: "Marks saved" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", authRequired, requireRole("faculty"), async (req, res) => {
  try {
    const existing = await get("SELECT * FROM marks WHERE mark_id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const subject = await get("SELECT * FROM subject WHERE subject_id = ?", [existing.subject_id]);
    if (!subject || subject.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { score, exam_type } = req.body || {};
    await query(`UPDATE marks SET score = ?, exam_type = ? WHERE mark_id = ?`, [
      score ?? existing.score,
      exam_type ?? existing.exam_type,
      req.params.id,
    ]);
    await auditService.log({
      userId: req.user.user_id,
      action: "UPDATE",
      entity: "marks",
      entityId: req.params.id,
    });
    res.json({ message: "Updated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
