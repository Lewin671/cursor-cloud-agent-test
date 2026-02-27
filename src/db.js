const Database = require("better-sqlite3");
const path = require("node:path");
const crypto = require("node:crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "pomodoro.db");

let db;

function getDb() {
  if (db) return db;

  const fs = require("node:fs");
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS timer_state (
      user_id TEXT PRIMARY KEY,
      timer_type TEXT DEFAULT 'work',
      status TEXT DEFAULT 'idle',
      duration INTEGER DEFAULT 1500,
      remaining INTEGER DEFAULT 1500,
      started_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      completed_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timer_type TEXT NOT NULL,
      duration INTEGER NOT NULL,
      completed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      work_duration INTEGER DEFAULT 1500,
      short_break_duration INTEGER DEFAULT 300,
      long_break_duration INTEGER DEFAULT 900,
      long_break_interval INTEGER DEFAULT 4,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  return db;
}

function generateId() {
  return crypto.randomUUID();
}

// User queries
const userQueries = {
  create(username, passwordHash) {
    const id = generateId();
    getDb().prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(id, username, passwordHash);
    return { id, username };
  },

  findByUsername(username) {
    return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username);
  },

  findById(id) {
    return getDb().prepare("SELECT id, username, created_at FROM users WHERE id = ?").get(id);
  },
};

// Timer state queries
const timerQueries = {
  get(userId) {
    let state = getDb().prepare("SELECT * FROM timer_state WHERE user_id = ?").get(userId);
    if (!state) {
      const settings = settingsQueries.get(userId);
      getDb().prepare(
        "INSERT INTO timer_state (user_id, duration, remaining) VALUES (?, ?, ?)"
      ).run(userId, settings.work_duration, settings.work_duration);
      state = getDb().prepare("SELECT * FROM timer_state WHERE user_id = ?").get(userId);
    }
    return state;
  },

  update(userId, fields) {
    const allowedFields = ["timer_type", "status", "duration", "remaining", "started_at", "completed_count"];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return;

    updates.push("updated_at = datetime('now')");
    values.push(userId);

    getDb().prepare(`UPDATE timer_state SET ${updates.join(", ")} WHERE user_id = ?`).run(...values);
    return timerQueries.get(userId);
  },

  reset(userId) {
    const settings = settingsQueries.get(userId);
    return timerQueries.update(userId, {
      timer_type: "work",
      status: "idle",
      duration: settings.work_duration,
      remaining: settings.work_duration,
      started_at: null,
      completed_count: 0,
    });
  },
};

// Session queries
const sessionQueries = {
  create(userId, timerType, duration) {
    const id = generateId();
    getDb().prepare(
      "INSERT INTO sessions (id, user_id, timer_type, duration) VALUES (?, ?, ?, ?)"
    ).run(id, userId, timerType, duration);
    return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  },

  listByUser(userId, limit = 50) {
    return getDb().prepare(
      "SELECT * FROM sessions WHERE user_id = ? ORDER BY completed_at DESC LIMIT ?"
    ).all(userId, limit);
  },

  todayStats(userId) {
    const row = getDb().prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(CASE WHEN timer_type = 'work' THEN duration ELSE 0 END), 0) as total_work_seconds,
        COALESCE(SUM(CASE WHEN timer_type = 'work' THEN 1 ELSE 0 END), 0) as work_sessions
      FROM sessions
      WHERE user_id = ? AND date(completed_at) = date('now')
    `).get(userId);
    return row;
  },

  deleteAll(userId) {
    getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  },
};

// Settings queries
const settingsQueries = {
  get(userId) {
    let settings = getDb().prepare("SELECT * FROM settings WHERE user_id = ?").get(userId);
    if (!settings) {
      getDb().prepare("INSERT INTO settings (user_id) VALUES (?)").run(userId);
      settings = getDb().prepare("SELECT * FROM settings WHERE user_id = ?").get(userId);
    }
    return settings;
  },

  update(userId, fields) {
    const allowedFields = ["work_duration", "short_break_duration", "long_break_duration", "long_break_interval"];
    const updates = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowedFields.includes(key) && typeof value === "number" && value > 0) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) return settingsQueries.get(userId);

    values.push(userId);
    getDb().prepare(`UPDATE settings SET ${updates.join(", ")} WHERE user_id = ?`).run(...values);
    return settingsQueries.get(userId);
  },
};

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  closeDb,
  userQueries,
  timerQueries,
  sessionQueries,
  settingsQueries,
};
