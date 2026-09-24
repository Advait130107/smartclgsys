import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import db, { initSchema } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import departmentRoutes from "./routes/departments.js";
import courseRoutes from "./routes/courses.js";
import facultyRoutes from "./routes/faculty.js";
import studentRoutes from "./routes/students.js";
import subjectRoutes from "./routes/subjects.js";
import attendanceRoutes from "./routes/attendance.js";
import marksRoutes from "./routes/marks.js";
import materialRoutes from "./routes/materials.js";
import assignmentRoutes from "./routes/assignments.js";
import timetableRoutes from "./routes/timetable.js";
import feedbackRoutes from "./routes/feedback.js";
import reportRoutes from "./routes/reports.js";
import notificationRoutes from "./routes/notifications.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, db: "supabase" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/faculty", facultyRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/marks", marksRoutes);
app.use("/api/materials", materialRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/timetable", timetableRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notifications", notificationRoutes);

const port = Number(process.env.PORT) || 5001;

initSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to init database:", err.message);
    process.exit(1);
  });
