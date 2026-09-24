import { Router } from "express";
import bcrypt from "bcryptjs";
import { get, withTransaction } from "../db/index.js";
import { authRequired, signToken } from "../middleware/auth.js";
import { nowUtc } from "../utils/dates.js";
import { auditService } from "../services/auditService.js";
import { notificationService } from "../services/notificationService.js";

const router = Router();

async function buildProfile(user) {
  const profile = { role: user.role, user_id: user.user_id, name: user.name, email: user.email };
  if (user.role === "admin") {
    const a = await get("SELECT * FROM admin WHERE user_id = ?", [user.user_id]);
    profile.admin_id = a?.admin_id;
    profile.username = a?.username;
  } else if (user.role === "faculty") {
    const f = await get("SELECT * FROM faculty WHERE user_id = ?", [user.user_id]);
    profile.faculty_id = f?.faculty_id;
    profile.dept_id = f?.dept_id;
  } else if (user.role === "student") {
    const s = await get("SELECT * FROM student WHERE user_id = ?", [user.user_id]);
    profile.student_id = s?.student_id;
    profile.course_id = s?.course_id;
    profile.enrollment_status = s?.enrollment_status;
  }
  return profile;
}

router.get("/me", authRequired, async (req, res) => {
  try {
    const user = await get("SELECT * FROM users WHERE user_id = ?", [req.user.user_id]);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: await buildProfile(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, course_id } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Validation error: name, email, password required" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Validation error: password must be at least 6 characters" });
    }
    const existing = await get("SELECT user_id FROM users WHERE email = ?", [email]);
    if (existing) return res.status(409).json({ error: "Email already registered" });

    if (course_id) {
      const course = await get("SELECT * FROM course WHERE course_id = ?", [course_id]);
      if (!course) return res.status(400).json({ error: "Invalid course" });
      const enrolled = await get(
        `SELECT COUNT(*)::int AS c FROM student WHERE course_id = ? AND enrollment_status = 'approved'`,
        [course_id]
      );
      if (enrolled.c >= course.seats) {
        return res.status(400).json({ error: "No seats available for this course" });
      }
    }

    const hash = bcrypt.hashSync(password, 10);
    const userId = await withTransaction(async (tx) => {
      const user = await tx.get(
        `INSERT INTO users (name, email, password, role, created_at)
         VALUES (?, ?, ?, 'student', ?) RETURNING user_id`,
        [name, email, hash, nowUtc()]
      );
      await tx.query(
        `INSERT INTO student (user_id, course_id, stud_name, enrollment_status)
         VALUES (?, ?, ?, ?)`,
        [user.user_id, course_id || null, name, course_id ? "pending" : "none"]
      );
      return user.user_id;
    });

    await auditService.log({
      userId,
      action: "CREATE",
      entity: "student",
      entityId: userId,
      details: { email, course_id },
    });
    await notificationService.notifyAdmins({
      title: "New student registration",
      message: `${name} registered and awaits enrollment approval.`,
    });
    return res.status(201).json({ message: "Registration successful" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password, username } = req.body || {};
    let user = null;
    if (username) {
      user = await get(
        `SELECT u.* FROM admin a JOIN users u ON u.user_id = a.user_id WHERE a.username = ?`,
        [username]
      );
    } else if (email) {
      user = await get("SELECT * FROM users WHERE email = ?", [email]);
    } else {
      return res.status(400).json({ error: "Email or username required" });
    }

    if (!user || !bcrypt.compareSync(password || "", user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const profile = await buildProfile(user);

    const token = signToken({
      user_id: user.user_id,
      role: user.role,
      faculty_id: profile.faculty_id,
      student_id: profile.student_id,
      admin_id: profile.admin_id,
    });

    await auditService.log({
      userId: user.user_id,
      action: "LOGIN",
      entity: "users",
      entityId: user.user_id,
    });

    return res.json({ token, user: profile, message: "Login successfully" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
