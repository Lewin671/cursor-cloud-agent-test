CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pomodoro_states (
  user_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('focus', 'short_break', 'long_break')),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'paused')),
  remaining_seconds INTEGER NOT NULL,
  focus_duration_seconds INTEGER NOT NULL DEFAULT 1500,
  short_break_duration_seconds INTEGER NOT NULL DEFAULT 300,
  long_break_duration_seconds INTEGER NOT NULL DEFAULT 900,
  started_at TEXT,
  session_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('focus', 'short_break', 'long_break')),
  planned_duration_seconds INTEGER NOT NULL,
  actual_duration_seconds INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_user_started
ON pomodoro_sessions(user_id, started_at DESC);
