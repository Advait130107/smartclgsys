import "dotenv/config";
import bcrypt from "bcryptjs";
import { get, initSchema, withTransaction } from "./index.js";
import { nowUtc } from "../utils/dates.js";

await initSchema();

const existing = await get("SELECT COUNT(*)::int AS c FROM users");
if (existing.c > 0) {
  console.log("Database already seeded");
  process.exit(0);
}

const hash = (p) => bcrypt.hashSync(p, 10);
const ts = nowUtc();

await withTransaction(async (tx) => {
  const adminUser = await tx.get(
    `INSERT INTO users (name, email, password, role, created_at)
     VALUES (?, ?, ?, 'admin', ?) RETURNING user_id`,
    ["System Admin", "admin@college.edu", hash("admin123"), ts]
  );
  await tx.query(`INSERT INTO admin (user_id, username) VALUES (?, ?)`, [
    adminUser.user_id,
    "admin",
  ]);

  const d1 = await tx.get(
    `INSERT INTO department (dept_name) VALUES (?) RETURNING dept_id`,
    ["Computer Science"]
  );
  const d2 = await tx.get(
    `INSERT INTO department (dept_name) VALUES (?) RETURNING dept_id`,
    ["Electronics"]
  );

  const c1 = await tx.get(
    `INSERT INTO course (dept_id, coursename, dur_yrs, seats) VALUES (?, ?, ?, ?) RETURNING course_id`,
    [d1.dept_id, "B.Tech CSE", 4, 60]
  );
  await tx.query(
    `INSERT INTO course (dept_id, coursename, dur_yrs, seats) VALUES (?, ?, ?, ?)`,
    [d2.dept_id, "B.Tech ECE", 4, 40]
  );

  const fUser = await tx.get(
    `INSERT INTO users (name, email, password, role, created_at)
     VALUES (?, ?, ?, 'faculty', ?) RETURNING user_id`,
    ["Dr. Sharma", "faculty@college.edu", hash("faculty123"), ts]
  );
  const faculty = await tx.get(
    `INSERT INTO faculty (user_id, dept_id, name) VALUES (?, ?, ?) RETURNING faculty_id`,
    [fUser.user_id, d1.dept_id, "Dr. Sharma"]
  );

  const fUser2 = await tx.get(
    `INSERT INTO users (name, email, password, role, created_at)
     VALUES (?, ?, ?, 'faculty', ?) RETURNING user_id`,
    ["Prof. Mehta", "mehta@college.edu", hash("faculty123"), ts]
  );
  await tx.query(`INSERT INTO faculty (user_id, dept_id, name) VALUES (?, ?, ?)`, [
    fUser2.user_id,
    d2.dept_id,
    "Prof. Mehta",
  ]);

  const sUser = await tx.get(
    `INSERT INTO users (name, email, password, role, created_at)
     VALUES (?, ?, ?, 'student', ?) RETURNING user_id`,
    ["Atharav Student", "student@college.edu", hash("student123"), ts]
  );
  const student = await tx.get(
    `INSERT INTO student (user_id, course_id, stud_name, enrollment_status)
     VALUES (?, ?, ?, ?) RETURNING student_id`,
    [sUser.user_id, c1.course_id, "Atharav Student", "approved"]
  );

  const sUser2 = await tx.get(
    `INSERT INTO users (name, email, password, role, created_at)
     VALUES (?, ?, ?, 'student', ?) RETURNING user_id`,
    ["Riya Patel", "riya@college.edu", hash("student123"), ts]
  );
  await tx.query(
    `INSERT INTO student (user_id, course_id, stud_name, enrollment_status) VALUES (?, ?, ?, ?)`,
    [sUser2.user_id, c1.course_id, "Riya Patel", "approved"]
  );

  const sub1 = await tx.get(
    `INSERT INTO subject (faculty_id, course_id, sub_name) VALUES (?, ?, ?) RETURNING subject_id`,
    [faculty.faculty_id, c1.course_id, "Data Structures"]
  );
  const sub2 = await tx.get(
    `INSERT INTO subject (faculty_id, course_id, sub_name) VALUES (?, ?, ?) RETURNING subject_id`,
    [faculty.faculty_id, c1.course_id, "Operating Systems"]
  );

  await tx.query(
    `INSERT INTO student_subject (student_id, subject_id) VALUES (?, ?), (?, ?)`,
    [student.student_id, sub1.subject_id, student.student_id, sub2.subject_id]
  );

  await tx.query(
    `INSERT INTO timetable (subject_id, faculty_id, course_id, day, time_slot) VALUES (?, ?, ?, ?, ?)`,
    [sub1.subject_id, faculty.faculty_id, c1.course_id, "Monday", "09:00-10:00"]
  );
  await tx.query(
    `INSERT INTO timetable (subject_id, faculty_id, course_id, day, time_slot) VALUES (?, ?, ?, ?, ?)`,
    [sub2.subject_id, faculty.faculty_id, c1.course_id, "Tuesday", "11:00-12:00"]
  );

  await tx.query(
    `INSERT INTO assignment (subject_id, faculty_id, title, due_date, created_at) VALUES (?, ?, ?, ?, ?)`,
    [
      sub1.subject_id,
      faculty.faculty_id,
      "Linked List Assignment",
      new Date(Date.now() + 7 * 86400000).toISOString(),
      ts,
    ]
  );

  await tx.query(
    `INSERT INTO study_material (subject_id, faculty_id, type, file_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    [sub1.subject_id, faculty.faculty_id, "notes", "ds-intro.pdf", ts]
  );

  await tx.query(
    `INSERT INTO marks (student_id, subject_id, score, exam_type, created_at) VALUES (?, ?, ?, ?, ?)`,
    [student.student_id, sub1.subject_id, 86, "midterm", ts]
  );

  await tx.query(
    `INSERT INTO attendance (student_id, subject_id, date, status, created_at) VALUES (?, ?, ?, ?, ?)`,
    [student.student_id, sub1.subject_id, ts.slice(0, 10), "present", ts]
  );
});

console.log("Seed complete on Supabase");
console.log("Admin: admin / admin123 (or admin@college.edu)");
console.log("Faculty: faculty@college.edu / faculty123");
console.log("Student: student@college.edu / student123");
process.exit(0);
