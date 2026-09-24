import { Router } from "express";
import { get, all, query } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { auditService } from "../services/auditService.js";
import multer from "multer";
import { parseCsv, csvResponse } from "../utils/csv.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || "").trim();
    let where = "";
    const params = [];
    if (q) {
      where = "WHERE dept_name ILIKE ?";
      params.push(`%${q}%`);
    }
    const total = (await get(`SELECT COUNT(*)::int AS c FROM department ${where}`, params)).c;
    const data = await all(
      `SELECT * FROM department ${where} ORDER BY dept_id LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/export", authRequired, requireRole("admin"), async (_req, res) => {
  try {
    const rows = await all("SELECT dept_id, dept_name FROM department ORDER BY dept_id");
    csvResponse(res, "departments.csv", ["dept_id", "dept_name"], rows.map((r) => [r.dept_id, r.dept_name]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/import", authRequired, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "CSV file required" });
    const rows = parseCsv(req.file.buffer.toString("utf8"));
    let imported = 0;
    for (const row of rows) {
      const name = row.dept_name || row.department || row.name;
      if (!name) continue;
      await query("INSERT INTO department (dept_name) VALUES (?) ON CONFLICT (dept_name) DO NOTHING", [name]);
      imported += 1;
    }
    res.json({ message: `Imported ${imported} department rows` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { dept_name } = req.body || {};
    if (!dept_name) return res.status(400).json({ error: "dept_name required" });
    const row = await get(
      "INSERT INTO department (dept_name) VALUES (?) RETURNING dept_id, dept_name",
      [dept_name]
    );
    await auditService.log({
      userId: req.user.user_id,
      action: "CREATE",
      entity: "department",
      entityId: row.dept_id,
      details: { dept_name },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const { dept_name } = req.body || {};
    const id = req.params.id;
    const existing = await get("SELECT * FROM department WHERE dept_id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Not found" });
    await query("UPDATE department SET dept_name = ? WHERE dept_id = ?", [dept_name, id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "UPDATE",
      entity: "department",
      entityId: id,
      details: { dept_name },
    });
    res.json({ message: "Updated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id;
    await query("DELETE FROM department WHERE dept_id = ?", [id]);
    await auditService.log({
      userId: req.user.user_id,
      action: "DELETE",
      entity: "department",
      entityId: id,
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
