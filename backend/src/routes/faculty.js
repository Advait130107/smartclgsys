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

router.get("/", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || "").trim();
    let where = "";
    const params = [];
    if (q) {
      where = "WHERE f.name ILIKE ? OR u.email ILIKE ? OR COALESCE(d.dept_name, '') ILIKE ?";
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const total = (
      await get(
        `SELECT COUNT(*)::int AS c
         FROM faculty f
         JOIN users u ON u.user_id = f.user_id
         LEFT JOIN department d ON d.dept_id = f.dept_id
         ${where}`,
        params
      )
    ).c;
    const data = await all(
      `SELECT f.*, u.email, d.dept_name
       FROM faculty f
       JOIN users u ON u.user_id = f.user_id
       LEFT JOIN department d ON d.dept_id = f.dept_id
       ${where}
       ORDER BY f.faculty_id
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
    const rows = await all(`SELECT f.faculty_id, f.name, u.email, f.dept_id FROM faculty f JOIN users u ON u.user_id = f.user_id ORDER BY f.faculty_id`);
    csvResponse(res, "faculty.csv", ["faculty_id", "name", "email", "password", "dept_id"], rows.map((r) => [r.faculty_id, r.name, r.email, "", r.dept_id ?? ""]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/import", authRequired, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "CSV file required" });
    const rows = parseCsv(req.file.buffer.toString("utf8"));
    let imported = 0;
    for (const row of rows) {
      const name = row.name || row.full_name;
      const email = row.email;
      if (!name || !email) continue;
      const exists = await get("SELECT user_id FROM users WHERE email = ?", [email]);
      if (exists) continue;
      const hash = bcrypt.hashSync(row.password || "faculty123", 10);
      await withTransaction(async (tx) => {
        const u = await tx.get(`INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'faculty', ?) RETURNING user_id`, [name, email, hash, nowUtc()]);
        await tx.query(`INSERT INTO faculty (user_id, dept_id, name) VALUES (?, ?, ?)`, [u.user_id, row.dept_id ? Number(row.dept_id) : null, name]);
      });
      imported += 1;
    }
    res.json({ message: `Imported ${imported} faculty rows` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { name, email, password, dept_id } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password required" });
    }
    const hash = bcrypt.hashSync(password, 10);
    const ids = await withTransaction(async (tx) => {
      const u = await tx.get(
        `INSERT INTO users (name, email, password, role, created_at)
         VALUES (?, ?, ?, 'faculty', ?) RETURNING user_id`,
        [name, email, hash, nowUtc()]
      );
      const f = await tx.get(
        `INSERT INTO faculty (user_id, dept_id, name) VALUES (?, ?, ?) RETURNING faculty_id`,
        [u.user_id, dept_id || null, name]
      );
      return { userId: u.user_id, facultyId: f.faculty_id };
    });
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "faculty",
      entityId: ids.facultyId,
    });
    await notificationService.create({
      userId: ids.userId,
      title: "Account created",
      message: "Your faculty account has been created by admin.",
    });
    res.status(201).json({ faculty_id: ids.facultyId, message: "Success" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { name, dept_id, email } = req.body || {};
    const faculty = await get("SELECT * FROM faculty WHERE faculty_id = ?", [req.params.id]);
    if (!faculty) return res.status(404).json({ error: "Not found" });
    await query(`UPDATE faculty SET name = ?, dept_id = ? WHERE faculty_id = ?`, [
      name ?? faculty.name,
      dept_id ?? faculty.dept_id,
      req.params.id,
    ]);
    if (email) {
      await query(`UPDATE users SET name = COALESCE(?, name), email = ? WHERE user_id = ?`, [
        name,
        email,
        faculty.user_id,
      ]);
    } else if (name) {
      await query(`UPDATE users SET name = ? WHERE user_id = ?`, [name, faculty.user_id]);
    }
    await auditService.log({
      userId: req.user.user_id,
      action: "UPDATE",
      entity: "faculty",
      entityId: req.params.id,
    });
    res.json({ message: "Success" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const faculty = await get("SELECT * FROM faculty WHERE faculty_id = ?", [req.params.id]);
    if (!faculty) return res.status(404).json({ error: "Not found" });
    await query("DELETE FROM users WHERE user_id = ?", [faculty.user_id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "faculty",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
