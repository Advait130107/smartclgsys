import { Router } from "express";
import { authRequired, requireRole } from "../middleware/auth.js";
import { notificationService } from "../services/notificationService.js";
import { auditService } from "../services/auditService.js";

const router = Router();

router.get("/", authRequired, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await notificationService.listForUser(req.user.user_id, { page, limit }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/:id/read", authRequired, async (req, res) => {
  try {
    await notificationService.markRead(req.params.id, req.user.user_id);
    res.json({ message: "Marked read" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/audit", authRequired, requireRole("admin"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await auditService.list({ page, limit }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
