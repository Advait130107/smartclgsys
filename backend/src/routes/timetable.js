import { Router } from "express";
import { get, all, query } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { auditService } from "../services/auditService.js";

const router = Router();

router.get("/", authRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    let where = "WHERE 1=1";
    const params = [];

    if (req.user.role === "student") {
      const student = await get("SELECT course_id FROM student WHERE student_id = ?", [
        req.user.student_id,
      ]);
      if (student?.course_id) {
        where += " AND t.course_id = ?";
        params.push(student.course_id);
      }
    } else if (req.user.role === "faculty") {
      where += " AND t.faculty_id = ?";
      params.push(req.user.faculty_id);
    }
    if (req.query.course_id) {
      where += " AND t.course_id = ?";
      params.push(req.query.course_id);
    }

    const total = (await get(`SELECT COUNT(*)::int AS c FROM timetable t ${where}`, params)).c;
    const data = await all(
      `SELECT t.*, s.sub_name, c.coursename, f.name AS faculty_name
       FROM timetable t
       JOIN subject s ON s.subject_id = t.subject_id
       JOIN course c ON c.course_id = t.course_id
       JOIN faculty f ON f.faculty_id = t.faculty_id
       ${where}
       ORDER BY
         CASE t.day
           WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
           WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 ELSE 7 END,
         t.time_slot
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { subject_id, faculty_id, course_id, day, time_slot } = req.body || {};
    if (!subject_id || !faculty_id || !course_id || !day || !time_slot) {
      return res.status(400).json({ error: "All fields required" });
    }
    const row = await get(
      `INSERT INTO timetable (subject_id, faculty_id, course_id, day, time_slot)
       VALUES (?, ?, ?, ?, ?) RETURNING timetable_id`,
      [subject_id, faculty_id, course_id, day, time_slot]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "timetable",
      entityId: row.timetable_id,
    });
    res.status(201).json({ timetable_id: row.timetable_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    await query("DELETE FROM timetable WHERE timetable_id = ?", [req.params.id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "timetable",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
