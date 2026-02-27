const express = require("express");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { userQueries, timerQueries, sessionQueries, settingsQueries } = require("./db");
const { syncManager, JWT_SECRET } = require("./ws");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Auth middleware ---
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --- Auth routes ---
app.post("/api/auth/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  if (username.length < 2 || username.length > 30) {
    return res.status(400).json({ error: "Username must be 2-30 characters" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }

  const existing = userQueries.findByUsername(username);
  if (existing) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const user = userQueries.create(username, hash);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });

  res.status(201).json({ user: { id: user.id, username: user.username }, token });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = userQueries.findByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ user: { id: user.id, username: user.username }, token });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const user = userQueries.findById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

// --- Timer routes ---
app.get("/api/timer", authMiddleware, (req, res) => {
  const state = timerQueries.get(req.userId);
  const settings = settingsQueries.get(req.userId);
  const deviceCount = syncManager.getDeviceCount(req.userId);
  res.json({ timer: state, settings, deviceCount });
});

app.post("/api/timer/start", authMiddleware, (req, res) => {
  const state = timerQueries.get(req.userId);
  const settings = settingsQueries.get(req.userId);

  let duration;
  let timerType = state.timer_type;

  if (state.status === "paused") {
    duration = state.remaining;
  } else {
    timerType = req.body.timerType || state.timer_type || "work";
    switch (timerType) {
      case "short_break": duration = settings.short_break_duration; break;
      case "long_break": duration = settings.long_break_duration; break;
      default: duration = settings.work_duration; timerType = "work"; break;
    }
  }

  const now = new Date().toISOString();
  const updated = timerQueries.update(req.userId, {
    timer_type: timerType,
    status: "running",
    duration: state.status === "paused" ? state.duration : duration,
    remaining: duration,
    started_at: now,
  });

  syncManager.broadcastAll(req.userId, { type: "timer:state", data: updated });
  res.json({ timer: updated });
});

app.post("/api/timer/pause", authMiddleware, (req, res) => {
  const state = timerQueries.get(req.userId);
  if (state.status !== "running") {
    return res.status(400).json({ error: "Timer is not running" });
  }

  const elapsed = Math.floor((Date.now() - new Date(state.started_at).getTime()) / 1000);
  const remaining = Math.max(0, state.remaining - elapsed);

  const updated = timerQueries.update(req.userId, {
    status: "paused",
    remaining,
    started_at: null,
  });

  syncManager.broadcastAll(req.userId, { type: "timer:state", data: updated });
  res.json({ timer: updated });
});

app.post("/api/timer/reset", authMiddleware, (req, res) => {
  const settings = settingsQueries.get(req.userId);
  const timerType = req.body.timerType || "work";

  let duration;
  switch (timerType) {
    case "short_break": duration = settings.short_break_duration; break;
    case "long_break": duration = settings.long_break_duration; break;
    default: duration = settings.work_duration; break;
  }

  const updated = timerQueries.update(req.userId, {
    timer_type: timerType,
    status: "idle",
    duration,
    remaining: duration,
    started_at: null,
  });

  syncManager.broadcastAll(req.userId, { type: "timer:state", data: updated });
  res.json({ timer: updated });
});

app.post("/api/timer/complete", authMiddleware, (req, res) => {
  const state = timerQueries.get(req.userId);
  const settings = settingsQueries.get(req.userId);

  const session = sessionQueries.create(req.userId, state.timer_type, state.duration);

  let nextType;
  let nextDuration;
  let completedCount = state.completed_count;

  if (state.timer_type === "work") {
    completedCount += 1;
    if (completedCount % settings.long_break_interval === 0) {
      nextType = "long_break";
      nextDuration = settings.long_break_duration;
    } else {
      nextType = "short_break";
      nextDuration = settings.short_break_duration;
    }
  } else {
    nextType = "work";
    nextDuration = settings.work_duration;
  }

  const updated = timerQueries.update(req.userId, {
    timer_type: nextType,
    status: "idle",
    duration: nextDuration,
    remaining: nextDuration,
    started_at: null,
    completed_count: completedCount,
  });

  syncManager.broadcastAll(req.userId, {
    type: "timer:completed",
    data: { timer: updated, session },
  });
  res.json({ timer: updated, session });
});

// --- Session routes ---
app.get("/api/sessions", authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const sessions = sessionQueries.listByUser(req.userId, limit);
  const stats = sessionQueries.todayStats(req.userId);
  res.json({ sessions, stats });
});

app.delete("/api/sessions", authMiddleware, (req, res) => {
  sessionQueries.deleteAll(req.userId);
  res.json({ message: "All sessions deleted" });
});

// --- Settings routes ---
app.get("/api/settings", authMiddleware, (req, res) => {
  const settings = settingsQueries.get(req.userId);
  res.json({ settings });
});

app.put("/api/settings", authMiddleware, (req, res) => {
  const settings = settingsQueries.update(req.userId, req.body);

  syncManager.broadcastAll(req.userId, { type: "settings:updated", data: settings });
  res.json({ settings });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

module.exports = { app };
