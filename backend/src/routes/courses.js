import { Router } from "express";
import { get, all, query } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";
import multer from "multer";
import { parseCsv, csvResponse } from "../utils/csv.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || "").trim();
    let where = "";
    const params = [];
    if (q) {
      where = "WHERE c.coursename ILIKE ? OR d.dept_name ILIKE ?";
      const like = `%${q}%`;
      params.push(like, like);
    }
    const total = (
      await get(
        `SELECT COUNT(*)::int AS c
         FROM course c
         JOIN department d ON d.dept_id = c.dept_id
         ${where}`,
        params
      )
    ).c;
    const data = await all(
      `SELECT c.*, d.dept_name,
        (SELECT COUNT(*)::int FROM student s WHERE s.course_id = c.course_id AND s.enrollment_status = 'approved') AS enrolled
       FROM course c
       JOIN department d ON d.dept_id = c.dept_id
       ${where}
       ORDER BY c.course_id
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const course = await get(
      `SELECT c.*, d.dept_name,
        (SELECT COUNT(*)::int FROM student s WHERE s.course_id = c.course_id AND s.enrollment_status = 'approved') AS enrolled
       FROM course c JOIN department d ON d.dept_id = c.dept_id WHERE c.course_id = ?`,
      [req.params.id]
    );
    if (!course) return res.status(404).json({ error: "Not found" });
    res.json(course);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/export", authRequired, requireRole("admin"), async (_req, res) => {
  try {
    const rows = await all("SELECT course_id, dept_id, coursename, dur_yrs, seats FROM course ORDER BY course_id");
    csvResponse(res, "courses.csv", ["course_id", "dept_id", "coursename", "dur_yrs", "seats"], rows.map((r) => [r.course_id, r.dept_id, r.coursename, r.dur_yrs, r.seats]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/import", authRequired, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "CSV file required" });
    const rows = parseCsv(req.file.buffer.toString("utf8"));
    let imported = 0;
    for (const row of rows) {
      const deptId = Number(row.dept_id);
      const name = row.coursename || row.course_name || row.name;
      if (!deptId || !name) continue;
      await query("INSERT INTO course (dept_id, coursename, dur_yrs, seats) VALUES (?, ?, ?, ?)", [deptId, name, Number(row.dur_yrs || 4), Number(row.seats || 60)]);
      imported += 1;
    }
    res.json({ message: `Imported ${imported} course rows` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { dept_id, coursename, dur_yrs = 4, seats = 60 } = req.body || {};
    if (!dept_id || !coursename) return res.status(400).json({ error: "dept_id and coursename required" });
    const row = await get(
      `INSERT INTO course (dept_id, coursename, dur_yrs, seats) VALUES (?, ?, ?, ?) RETURNING course_id`,
      [dept_id, coursename, dur_yrs, seats]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "course",
      entityId: row.course_id,
      details: { coursename, dept_id },
    });
    res.status(201).json({ course_id: row.course_id, message: "Course updated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { dept_id, coursename, dur_yrs, seats } = req.body || {};
    const existing = await get("SELECT * FROM course WHERE course_id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Not found" });
    await query(
      `UPDATE course SET dept_id = ?, coursename = ?, dur_yrs = ?, seats = ? WHERE course_id = ?`,
      [
        dept_id ?? existing.dept_id,
        coursename ?? existing.coursename,
        dur_yrs ?? existing.dur_yrs,
        seats ?? existing.seats,
        req.params.id,
      ]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "UPDATE",
      entity: "course",
      entityId: req.params.id,
    });
    res.json({ message: "Course updated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    await query("DELETE FROM course WHERE course_id = ?", [req.params.id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "course",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/enroll", authRequired, requireRole("student"), async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    const course = await get("SELECT * FROM course WHERE course_id = ?", [courseId]);
    if (!course) return res.status(404).json({ error: "Course not found" });
    const enrolled = await get(
      `SELECT COUNT(*)::int AS c FROM student WHERE course_id = ? AND enrollment_status = 'approved'`,
      [courseId]
    );
    if (enrolled.c >= course.seats) {
      return res.status(400).json({ error: "No seats available" });
    }
    const student = await get("SELECT * FROM student WHERE user_id = ?", [req.user.user_id]);
    if (!student) return res.status(404).json({ error: "Student profile not found" });
    await query(
      `UPDATE student SET course_id = ?, enrollment_status = 'pending' WHERE student_id = ?`,
      [courseId, student.student_id]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "ENROLL",
      entity: "course",
      entityId: courseId,
    });
    await notificationService.notifyAdmins({
      title: "Enrollment request",
      message: `${student.stud_name} requested enrollment in ${course.coursename}`,
    });
    res.json({ message: "Enrollment confirmed (pending admin approval)" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
