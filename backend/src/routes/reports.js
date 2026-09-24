import { Router } from "express";
import { get, all } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/summary", authRequired, requireRole("admin"), async (_req, res) => {
  try {
    const students = (await get("SELECT COUNT(*)::int AS c FROM student")).c;
    const faculty = (await get("SELECT COUNT(*)::int AS c FROM faculty")).c;
    const courses = (await get("SELECT COUNT(*)::int AS c FROM course")).c;
    const departments = (await get("SELECT COUNT(*)::int AS c FROM department")).c;
    const pendingEnrollments = (
      await get(`SELECT COUNT(*)::int AS c FROM student WHERE enrollment_status = 'pending'`)
    ).c;
    const approvedEnrollments = (
      await get(`SELECT COUNT(*)::int AS c FROM student WHERE enrollment_status = 'approved'`)
    ).c;
    const rejectedEnrollments = (
      await get(`SELECT COUNT(*)::int AS c FROM student WHERE enrollment_status = 'rejected'`)
    ).c;
    const attendancePresent = (
      await get(`SELECT COUNT(*)::int AS c FROM attendance WHERE status = 'present'`)
    ).c;
    const attendanceAbsent = (
      await get(`SELECT COUNT(*)::int AS c FROM attendance WHERE status = 'absent'`)
    ).c;
    const avgRow = await get(`SELECT AVG(score) AS avg FROM marks`);
    const avgMarks = avgRow?.avg != null ? Number(Number(avgRow.avg).toFixed(2)) : 0;
    const studentsByCourse = await all(
      `SELECT c.coursename AS label, COUNT(s.student_id)::int AS value
       FROM course c
       LEFT JOIN student s ON s.course_id = c.course_id
       GROUP BY c.course_id, c.coursename
       ORDER BY value DESC, c.coursename
       LIMIT 6`
    );
    const marksByExam = await all(
      `SELECT exam_type AS label, ROUND(AVG(score)::numeric, 1)::float AS value
       FROM marks
       GROUP BY exam_type
       ORDER BY exam_type`
    );
    res.json({
      students,
      faculty,
      courses,
      departments,
      pendingEnrollments,
      approvedEnrollments,
      rejectedEnrollments,
      attendancePresent,
      attendanceAbsent,
      avgMarks,
      studentsByCourse,
      marksByExam,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/faculty-summary", authRequired, requireRole("faculty"), async (req, res) => {
  try {
    const facultyId = req.user.faculty_id;
    const subjects = (
      await get(`SELECT COUNT(*)::int AS c FROM subject WHERE faculty_id = ?`, [facultyId])
    ).c;
    const assignments = (
      await get(
        `SELECT COUNT(*)::int AS c FROM assignment a
         JOIN subject s ON s.subject_id = a.subject_id
         WHERE s.faculty_id = ?`,
        [facultyId]
      )
    ).c;
    const materials = (
      await get(
        `SELECT COUNT(*)::int AS c FROM study_material m
         JOIN subject s ON s.subject_id = m.subject_id
         WHERE s.faculty_id = ?`,
        [facultyId]
      )
    ).c;
    const present = (
      await get(
        `SELECT COUNT(*)::int AS c FROM attendance a
         JOIN subject s ON s.subject_id = a.subject_id
         WHERE s.faculty_id = ? AND a.status = 'present'`,
        [facultyId]
      )
    ).c;
    const absent = (
      await get(
        `SELECT COUNT(*)::int AS c FROM attendance a
         JOIN subject s ON s.subject_id = a.subject_id
         WHERE s.faculty_id = ? AND a.status = 'absent'`,
        [facultyId]
      )
    ).c;
    const avgRow = await get(
      `SELECT AVG(m.score) AS avg FROM marks m
       JOIN subject s ON s.subject_id = m.subject_id
       WHERE s.faculty_id = ?`,
      [facultyId]
    );
    const avgMarks = avgRow?.avg != null ? Number(Number(avgRow.avg).toFixed(2)) : 0;
    const attendanceBySubject = await all(
      `SELECT s.sub_name AS label,
        COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
        COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent
       FROM subject s
       LEFT JOIN attendance a ON a.subject_id = s.subject_id
       WHERE s.faculty_id = ?
       GROUP BY s.subject_id, s.sub_name
       ORDER BY s.sub_name
       LIMIT 6`,
      [facultyId]
    );
    res.json({
      subjects,
      assignments,
      materials,
      present,
      absent,
      avgMarks,
      attendanceBySubject,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/student-summary", authRequired, requireRole("student"), async (req, res) => {
  try {
    const studentId = req.user.student_id;
    const subjects = (
      await get(
        `SELECT COUNT(*)::int AS c FROM student_subject WHERE student_id = ?`,
        [studentId]
      )
    ).c;
    const present = (
      await get(
        `SELECT COUNT(*)::int AS c FROM attendance WHERE student_id = ? AND status = 'present'`,
        [studentId]
      )
    ).c;
    const absent = (
      await get(
        `SELECT COUNT(*)::int AS c FROM attendance WHERE student_id = ? AND status = 'absent'`,
        [studentId]
      )
    ).c;
    const assignments = (
      await get(
        `SELECT COUNT(*)::int AS c FROM assignment a
         JOIN student_subject ss ON ss.subject_id = a.subject_id
         WHERE ss.student_id = ?`,
        [studentId]
      )
    ).c;
    const submissions = (
      await get(
        `SELECT COUNT(*)::int AS c FROM assignment_submission WHERE student_id = ?`,
        [studentId]
      )
    ).c;
    const avgRow = await get(
      `SELECT AVG(score) AS avg FROM marks WHERE student_id = ?`,
      [studentId]
    );
    const avgMarks = avgRow?.avg != null ? Number(Number(avgRow.avg).toFixed(2)) : 0;
    const marksByExam = await all(
      `SELECT exam_type AS label, ROUND(AVG(score)::numeric, 1)::float AS value
       FROM marks
       WHERE student_id = ?
       GROUP BY exam_type
       ORDER BY exam_type`,
      [studentId]
    );
    const student = await get(
      `SELECT enrollment_status FROM student WHERE student_id = ?`,
      [studentId]
    );
    res.json({
      subjects,
      present,
      absent,
      assignments,
      submissions,
      avgMarks,
      marksByExam,
      enrollment_status: student?.enrollment_status || "none",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
