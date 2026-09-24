import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { get, all, query } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { nowUtc } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";

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
      where += " AND m.subject_id = ?";
      params.push(req.query.subject_id);
    }
    if (req.user.role === "faculty") {
      where += " AND m.faculty_id = ?";
      params.push(req.user.faculty_id);
    }
    const total = (await get(`SELECT COUNT(*)::int AS c FROM study_material m ${where}`, params)).c;
    const data = await all(
      `SELECT m.*, s.sub_name, f.name AS faculty_name
       FROM study_material m
       JOIN subject s ON s.subject_id = m.subject_id
       JOIN faculty f ON f.faculty_id = m.faculty_id
       ${where}
       ORDER BY m.material_id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", authRequired, requireRole("faculty"), upload.single("file"), async (req, res) => {
  try {
    const { subject_id, type } = req.body || {};
    if (!subject_id || !req.file) {
      return res.status(400).json({ error: "subject_id and file required" });
    }
    const subject = await get("SELECT * FROM subject WHERE subject_id = ?", [subject_id]);
    if (!subject || subject.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Not your subject" });
    }
    const row = await get(
      `INSERT INTO study_material (subject_id, faculty_id, type, file_name, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING material_id`,
      [subject_id, req.user.faculty_id, type || "notes", req.file.filename, nowUtc()]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "study_material",
      entityId: row.material_id,
    });
    res.status(201).json({ material_id: row.material_id, message: "Uploaded" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("faculty", "admin"), async (req, res) => {
  try {
    const row = await get("SELECT * FROM study_material WHERE material_id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (req.user.role === "faculty" && row.faculty_id !== req.user.faculty_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const filePath = path.join(uploadRoot, row.file_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await query("DELETE FROM study_material WHERE material_id = ?", [req.params.id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "study_material",
      entityId: req.params.id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
