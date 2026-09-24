import { Router } from "express";
import bcrypt from "bcryptjs";
import { get, all, query, withTransaction } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { nowUtc } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";
import multer from "multer";
import { parseCsv, csvResponse } from "../utils/csv.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authRequired, requireRole("admin", "faculty"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const courseId = req.query.course_id;
    const q = String(req.query.q || "").trim();
    const like = `%${q}%`;
    let where = "WHERE 1=1";
    const params = [];
    if (courseId) {
      where += " AND s.course_id = ?";
      params.push(courseId);
    }
    if (q) {
      where += " AND (s.stud_name ILIKE ? OR u.email ILIKE ?)";
      params.push(like, like);
    }
    const total = (
      await get(
        `SELECT COUNT(*)::int AS c
         FROM student s
         JOIN users u ON u.user_id = s.user_id
         ${where}`,
        params
      )
    ).c;
    const data = await all(
      `SELECT s.*, u.email, c.coursename
       FROM student s
       JOIN users u ON u.user_id = s.user_id
       LEFT JOIN course c ON c.course_id = s.course_id
       ${where}
       ORDER BY s.student_id
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/export", authRequired, requireRole("admin"), async (_req, res) => {
  try {
    const rows = await all(`
      SELECT
        s.student_id,
        COALESCE(s.stud_name, u.name) AS name,
        u.email,
        s.course_id,
        s.enrollment_status
      FROM student s
      INNER JOIN users u ON u.user_id = s.user_id
      ORDER BY s.student_id
    `);
    csvResponse(
      res,
      "students.csv",
      ["student_id", "name", "email", "password", "course_id", "enrollment_status"],
      rows.map((r) => [
        r.student_id,
        r.name,
        r.email,
        "",
        r.course_id ?? "",
        r.enrollment_status || "none",
      ])
    );
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/import", authRequired, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "CSV file required" });
    const rows = parseCsv(req.file.buffer.toString("utf8"));
    let imported = 0;
    for (const row of rows) {
      const name = row.name || row.stud_name || row.full_name;
      const email = row.email;
      const password = row.password || "student123";
      if (!name || !email) continue;
      const exists = await get("SELECT user_id FROM users WHERE email = ?", [email]);
      if (exists) continue;
      const hash = bcrypt.hashSync(password, 10);
      await withTransaction(async (tx) => {
        const u = await tx.get(`INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'student', ?) RETURNING user_id`, [name, email, hash, nowUtc()]);
        await tx.query(`INSERT INTO student (user_id, course_id, stud_name, enrollment_status) VALUES (?, ?, ?, ?)`, [u.user_id, row.course_id ? Number(row.course_id) : null, name, row.enrollment_status || (row.course_id ? "approved" : "none")]);
      });
      imported += 1;
    }
    res.json({ message: `Imported ${imported} student rows` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { name, email, password, course_id } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password required" });
    }
    const hash = bcrypt.hashSync(password, 10);
    const ids = await withTransaction(async (tx) => {
      const u = await tx.get(
        `INSERT INTO users (name, email, password, role, created_at)
         VALUES (?, ?, ?, 'student', ?) RETURNING user_id`,
        [name, email, hash, nowUtc()]
      );
      const s = await tx.get(
        `INSERT INTO student (user_id, course_id, stud_name, enrollment_status)
         VALUES (?, ?, ?, ?) RETURNING student_id`,
        [u.user_id, course_id || null, name, course_id ? "approved" : "none"]
      );
      return { userId: u.user_id, studentId: s.student_id };
    });
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "student",
      entityId: ids.studentId,
    });
    await notificationService.create({
      userId: ids.userId,
      title: "Account created",
      message: "Your student account has been created by admin.",
    });
    res.status(201).json({ student_id: ids.studentId, message: "Success" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { stud_name, course_id, email, enrollment_status } = req.body || {};
    const student = await get("SELECT * FROM student WHERE student_id = ?", [req.params.id]);
    if (!student) return res.status(404).json({ error: "Not found" });
    await query(
      `UPDATE student SET stud_name = ?, course_id = ?, enrollment_status = ? WHERE student_id = ?`,
      [
        stud_name ?? student.stud_name,
        course_id ?? student.course_id,
        enrollment_status ?? student.enrollment_status,
        req.params.id,
      ]
    );
    if (email || stud_name) {
      await query(
        `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE user_id = ?`,
        [stud_name, email, student.user_id]
      );
    }
    if (enrollment_status && enrollment_status !== student.enrollment_status) {
      await notificationService.create({
        userId: student.user_id,
        title: "Enrollment update",
        message: `Your enrollment status is now: ${enrollment_status}`,
      });
    }
    await auditService.log({
      userId: req.user.user_id,
      action: "UPDATE",
      entity: "student",
      entityId: req.params.id,
    });
    res.json({ message: "Success" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/:id/enrollment", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const student = await get("SELECT * FROM student WHERE student_id = ?", [req.params.id]);
    if (!student) return res.status(404).json({ error: "Not found" });
    if (status === "approved" && student.course_id) {
      const course = await get("SELECT * FROM course WHERE course_id = ?", [student.course_id]);
      const enrolled = await get(
        `SELECT COUNT(*)::int AS c FROM student WHERE course_id = ? AND enrollment_status = 'approved'`,
        [student.course_id]
      );
      if (enrolled.c >= course.seats) {
        return res.status(400).json({ error: "No seats available" });
      }
    }
    await query(`UPDATE student SET enrollment_status = ? WHERE student_id = ?`, [
      status,
      req.params.id,
    ]);
    await notificationService.create({
      userId: student.user_id,
      title: "Enrollment decision",
      message: `Your enrollment was ${status}`,
    });
    await auditService.log({
      userId: req.user.user_id,
      action: "ENROLLMENT",
      entity: "student",
      entityId: req.params.id,
      details: { status },
    });
    res.json({ message: `Enrollment ${status}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const student = await get("SELECT * FROM student WHERE student_id = ?", [req.params.id]);
    if (!student) return res.status(404).json({ error: "Not found" });
    await query("DELETE FROM users WHERE user_id = ?", [student.user_id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "student",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/me/subjects", authRequired, requireRole("student"), async (req, res) => {
  try {
    const { subject_ids } = req.body || {};
    if (!Array.isArray(subject_ids) || subject_ids.length === 0) {
      return res.status(400).json({ error: "subject_ids required" });
    }
    const student = await get("SELECT * FROM student WHERE user_id = ?", [req.user.user_id]);
    if (!student) return res.status(404).json({ error: "Student not found" });
    await withTransaction(async (tx) => {
      for (const sid of subject_ids) {
        await tx.query(
          `INSERT INTO student_subject (student_id, subject_id) VALUES (?, ?)
           ON CONFLICT (student_id, subject_id) DO NOTHING`,
          [student.student_id, sid]
        );
      }
    });
    await auditService.log({
      userId: req.user.user_id,
      action: "SELECT_SUBJECTS",
      entity: "student_subject",
      entityId: student.student_id,
      details: { subject_ids },
    });
    res.json({ message: "Subjects selected" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/me/subjects", authRequired, requireRole("student"), async (req, res) => {
  try {
    const student = await get("SELECT * FROM student WHERE user_id = ?", [req.user.user_id]);
    if (!student) return res.status(404).json({ error: "Student not found" });
    const data = await all(
      `SELECT sub.* FROM student_subject ss
       JOIN subject sub ON sub.subject_id = ss.subject_id
       WHERE ss.student_id = ?`,
      [student.student_id]
    );
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
