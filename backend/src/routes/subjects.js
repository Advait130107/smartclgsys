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
    const { course_id, faculty_id } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (course_id) {
      where += " AND s.course_id = ?";
      params.push(course_id);
    }
    if (faculty_id) {
      where += " AND s.faculty_id = ?";
      params.push(faculty_id);
    }
    if (req.user.role === "faculty") {
      where += " AND s.faculty_id = ?";
      params.push(req.user.faculty_id);
    }
    const q = String(req.query.q || "").trim();
    if (q) {
      where += " AND (s.sub_name ILIKE ? OR c.coursename ILIKE ?)";
      const like = `%${q}%`;
      params.push(like, like);
    }
    const total = (
      await get(
        `SELECT COUNT(*)::int AS c
         FROM subject s
         JOIN course c ON c.course_id = s.course_id
         ${where}`,
        params
      )
    ).c;
    const data = await all(
      `SELECT s.*, c.coursename, f.name AS faculty_name
       FROM subject s
       JOIN course c ON c.course_id = s.course_id
       LEFT JOIN faculty f ON f.faculty_id = s.faculty_id
       ${where}
       ORDER BY s.subject_id
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
    const { faculty_id, course_id, sub_name } = req.body || {};
    if (!course_id || !sub_name) return res.status(400).json({ error: "course_id and sub_name required" });
    const row = await get(
      `INSERT INTO subject (faculty_id, course_id, sub_name) VALUES (?, ?, ?) RETURNING subject_id`,
      [faculty_id || null, course_id, sub_name]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "subject",
      entityId: row.subject_id,
    });
    res.status(201).json({ subject_id: row.subject_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const existing = await get("SELECT * FROM subject WHERE subject_id = ?", [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const { faculty_id, course_id, sub_name } = req.body || {};
    await query(
      `UPDATE subject SET faculty_id = ?, course_id = ?, sub_name = ? WHERE subject_id = ?`,
      [
        faculty_id ?? existing.faculty_id,
        course_id ?? existing.course_id,
        sub_name ?? existing.sub_name,
        req.params.id,
      ]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "UPDATE",
      entity: "subject",
      entityId: req.params.id,
    });
    res.json({ message: "Updated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    await query("DELETE FROM subject WHERE subject_id = ?", [req.params.id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "subject",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
