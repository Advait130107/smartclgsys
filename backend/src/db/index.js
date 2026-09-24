import "dotenv/config";
import pg from "pg";

const connectionString =
  process.env.DATABASE_URL || process.env.Database_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function query(sql, params = []) {
  return pool.query(toPg(sql), params);
}

export async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

export async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {
      async query(sql, params = []) {
        return client.query(toPg(sql), params);
      },
      async get(sql, params = []) {
        const res = await client.query(toPg(sql), params);
        return res.rows[0] || null;
      },
      async all(sql, params = []) {
        const res = await client.query(toPg(sql), params);
        return res.rows;
      },
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','faculty','student')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin (
      admin_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS department (
      dept_id SERIAL PRIMARY KEY,
      dept_name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS course (
      course_id SERIAL PRIMARY KEY,
      dept_id INTEGER NOT NULL REFERENCES department(dept_id),
      coursename TEXT NOT NULL,
      dur_yrs INTEGER NOT NULL DEFAULT 4,
      seats INTEGER NOT NULL DEFAULT 60
    );

    CREATE TABLE IF NOT EXISTS faculty (
      faculty_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
      dept_id INTEGER REFERENCES department(dept_id),
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student (
      student_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES course(course_id),
      stud_name TEXT NOT NULL,
      enrollment_status TEXT NOT NULL DEFAULT 'pending' CHECK(enrollment_status IN ('pending','approved','rejected','none'))
    );

    CREATE TABLE IF NOT EXISTS subject (
      subject_id SERIAL PRIMARY KEY,
      faculty_id INTEGER REFERENCES faculty(faculty_id),
      course_id INTEGER NOT NULL REFERENCES course(course_id),
      sub_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_subject (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subject(subject_id) ON DELETE CASCADE,
      UNIQUE(student_id, subject_id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      att_id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subject(subject_id),
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent')),
      created_at TEXT NOT NULL,
      UNIQUE(student_id, subject_id, date)
    );

    CREATE TABLE IF NOT EXISTS marks (
      mark_id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subject(subject_id),
      score DOUBLE PRECISION NOT NULL,
      exam_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_material (
      material_id SERIAL PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subject(subject_id),
      faculty_id INTEGER NOT NULL REFERENCES faculty(faculty_id),
      type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignment (
      assign_id SERIAL PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subject(subject_id),
      faculty_id INTEGER NOT NULL REFERENCES faculty(faculty_id),
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignment_submission (
      submission_id SERIAL PRIMARY KEY,
      assign_id INTEGER NOT NULL REFERENCES assignment(assign_id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      submitted_at TEXT NOT NULL,
      UNIQUE(assign_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS timetable (
      timetable_id SERIAL PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subject(subject_id),
      faculty_id INTEGER NOT NULL REFERENCES faculty(faculty_id),
      course_id INTEGER NOT NULL REFERENCES course(course_id),
      day TEXT NOT NULL,
      time_slot TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      feedback_id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      audit_id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      notification_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

export default { pool, query, get, all, withTransaction, initSchema };
