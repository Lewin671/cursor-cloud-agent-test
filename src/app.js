const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
});

const MIN_DURATION_MINUTES = 0.05;
const MAX_DURATION_MINUTES = 180;
const MIN_LONG_BREAK_INTERVAL = 2;
const MAX_LONG_BREAK_INTERVAL = 12;

const PHASE_TO_SETTINGS_KEY = Object.freeze({
  focus: "focusMinutes",
  shortBreak: "shortBreakMinutes",
  longBreak: "longBreakMinutes",
});

const STATIC_FILES = Object.freeze({
  "/": { fileName: "index.html", contentType: "text/html; charset=utf-8" },
  "/styles.css": { fileName: "styles.css", contentType: "text/css; charset=utf-8" },
  "/client.js": { fileName: "client.js", contentType: "application/javascript; charset=utf-8" },
});

const ACTIONS = Object.freeze({
  START: "START",
  PAUSE: "PAUSE",
  RESET: "RESET",
  SKIP: "SKIP",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
  ADD_TASK: "ADD_TASK",
  TOGGLE_TASK: "TOGGLE_TASK",
  DELETE_TASK: "DELETE_TASK",
});

function createApiError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function minutesToMs(minutes) {
  return Math.round(minutes * 60 * 1000);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeUserId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function validateUserId(userId) {
  if (!userId) {
    throw createApiError(400, "userId is required");
  }

  if (userId.length > 40) {
    throw createApiError(400, "userId must be at most 40 characters");
  }

  if (/\s/.test(userId)) {
    throw createApiError(400, "userId cannot contain spaces");
  }
}

function validateDuration(value, fieldName) {
  const parsed = Number(value);

  if (!isFiniteNumber(parsed)) {
    throw createApiError(400, `${fieldName} must be a number`);
  }

  if (parsed < MIN_DURATION_MINUTES || parsed > MAX_DURATION_MINUTES) {
    throw createApiError(
      400,
      `${fieldName} must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}`,
    );
  }

  return roundToTwoDecimals(parsed);
}

function validateLongBreakInterval(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw createApiError(400, "longBreakEvery must be an integer");
  }

  if (parsed < MIN_LONG_BREAK_INTERVAL || parsed > MAX_LONG_BREAK_INTERVAL) {
    throw createApiError(
      400,
      `longBreakEvery must be between ${MIN_LONG_BREAK_INTERVAL} and ${MAX_LONG_BREAK_INTERVAL}`,
    );
  }

  return parsed;
}

function getPhaseDurationMs(settings, phase) {
  const settingsKey = PHASE_TO_SETTINGS_KEY[phase];
  if (!settingsKey) {
    throw createApiError(500, "Unknown timer phase");
  }
  return minutesToMs(settings[settingsKey]);
}

function createDefaultUserState(now) {
  const focusDurationMs = getPhaseDurationMs(DEFAULT_SETTINGS, "focus");

  return {
    version: 1,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    stats: {
      completedFocusSessions: 0,
    },
    timer: {
      phase: "focus",
      status: "idle",
      durationMs: focusDurationMs,
      remainingMs: focusDurationMs,
      startedAt: null,
      endAt: null,
    },
    tasks: [],
  };
}

function pickBreakPhase(settings, focusSessionCount) {
  if (focusSessionCount % settings.longBreakEvery === 0) {
    return "longBreak";
  }

  return "shortBreak";
}

function setPhaseState(userState, phase, status, now, remainingMs) {
  const durationMs = getPhaseDurationMs(userState.settings, phase);

  userState.timer.phase = phase;
  userState.timer.durationMs = durationMs;
  userState.timer.status = status;

  if (status === "running") {
    userState.timer.startedAt = now;
    userState.timer.endAt = now + durationMs;
    userState.timer.remainingMs = durationMs;
    return;
  }

  const safeRemainingMs = Number.isInteger(remainingMs)
    ? Math.max(0, Math.min(remainingMs, durationMs))
    : durationMs;

  userState.timer.startedAt = null;
  userState.timer.endAt = null;
  userState.timer.remainingMs = safeRemainingMs;
}

function advanceTimerIfNeeded(userState, now) {
  let changed = false;
  let safetyCounter = 0;

  while (
    userState.timer.status === "running" &&
    Number.isInteger(userState.timer.endAt) &&
    now >= userState.timer.endAt &&
    safetyCounter < 100
  ) {
    const finishedPhase = userState.timer.phase;
    const transitionTime = userState.timer.endAt;

    if (finishedPhase === "focus") {
      userState.stats.completedFocusSessions += 1;
      const nextBreak = pickBreakPhase(userState.settings, userState.stats.completedFocusSessions);
      setPhaseState(userState, nextBreak, "running", transitionTime);
    } else {
      setPhaseState(userState, "focus", "running", transitionTime);
    }

    changed = true;
    safetyCounter += 1;
  }

  return changed;
}

function parseStoredTask(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  if (typeof task.id !== "string" || !task.id) {
    return null;
  }

  if (typeof task.title !== "string" || !task.title.trim()) {
    return null;
  }

  return {
    id: task.id,
    title: task.title.trim().slice(0, 120),
    completed: Boolean(task.completed),
    createdAt: Number.isInteger(task.createdAt) ? task.createdAt : Date.now(),
  };
}

function parseStoredUserState(rawUser, now) {
  const fallback = createDefaultUserState(now);
  if (!rawUser || typeof rawUser !== "object") {
    return fallback;
  }

  const settings = { ...DEFAULT_SETTINGS };
  try {
    if (rawUser.settings && typeof rawUser.settings === "object") {
      settings.focusMinutes = validateDuration(rawUser.settings.focusMinutes, "focusMinutes");
      settings.shortBreakMinutes = validateDuration(
        rawUser.settings.shortBreakMinutes,
        "shortBreakMinutes",
      );
      settings.longBreakMinutes = validateDuration(rawUser.settings.longBreakMinutes, "longBreakMinutes");
      settings.longBreakEvery = validateLongBreakInterval(rawUser.settings.longBreakEvery);
    }
  } catch {
    return fallback;
  }

  const timerPhase = Object.hasOwn(PHASE_TO_SETTINGS_KEY, rawUser.timer?.phase)
    ? rawUser.timer.phase
    : "focus";
  const timerStatus =
    rawUser.timer?.status === "running" ||
    rawUser.timer?.status === "paused" ||
    rawUser.timer?.status === "idle"
      ? rawUser.timer.status
      : "idle";

  const phaseDurationMs = getPhaseDurationMs(settings, timerPhase);
  const safeRemainingMs = Number.isInteger(rawUser.timer?.remainingMs)
    ? Math.max(0, Math.min(rawUser.timer.remainingMs, phaseDurationMs))
    : phaseDurationMs;

  const normalizedTimer = {
    phase: timerPhase,
    status: timerStatus,
    durationMs: phaseDurationMs,
    remainingMs: safeRemainingMs,
    startedAt: Number.isInteger(rawUser.timer?.startedAt) ? rawUser.timer.startedAt : null,
    endAt: Number.isInteger(rawUser.timer?.endAt) ? rawUser.timer.endAt : null,
  };

  if (timerStatus !== "running") {
    normalizedTimer.startedAt = null;
    normalizedTimer.endAt = null;
  }

  const tasks = Array.isArray(rawUser.tasks)
    ? rawUser.tasks.map(parseStoredTask).filter(Boolean)
    : [];

  const completedFocusSessions = Number.isInteger(rawUser.stats?.completedFocusSessions)
    ? Math.max(0, rawUser.stats.completedFocusSessions)
    : 0;

  return {
    version: Number.isInteger(rawUser.version) ? Math.max(1, rawUser.version) : 1,
    updatedAt: Number.isInteger(rawUser.updatedAt) ? rawUser.updatedAt : now,
    settings,
    stats: {
      completedFocusSessions,
    },
    timer: normalizedTimer,
    tasks,
  };
}

class PomodoroService {
  constructor(options = {}) {
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.dataFile =
      options.dataFile || path.join(__dirname, "..", "data", "pomodoro-store.json");
    this.tickIntervalMs =
      Number.isInteger(options.tickIntervalMs) && options.tickIntervalMs > 0
        ? options.tickIntervalMs
        : 1000;
    this.heartbeatIntervalMs =
      Number.isInteger(options.heartbeatIntervalMs) && options.heartbeatIntervalMs > 0
        ? options.heartbeatIntervalMs
        : 15000;
    this.clients = new Map();
    this.store = this.loadStore();

    this.maintenanceTimer = setInterval(() => {
      this.handleMaintenanceTick();
    }, this.tickIntervalMs);

    this.heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  loadStore() {
    const directory = path.dirname(this.dataFile);
    fs.mkdirSync(directory, { recursive: true });

    if (!fs.existsSync(this.dataFile)) {
      return { users: {} };
    }

    try {
      const rawText = fs.readFileSync(this.dataFile, "utf8");
      if (!rawText.trim()) {
        return { users: {} };
      }

      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed !== "object" || typeof parsed.users !== "object") {
        return { users: {} };
      }

      const now = this.now();
      const users = {};
      for (const [userId, rawUserState] of Object.entries(parsed.users)) {
        users[userId] = parseStoredUserState(rawUserState, now);
      }

      return { users };
    } catch {
      return { users: {} };
    }
  }

  saveStore() {
    fs.writeFileSync(this.dataFile, JSON.stringify(this.store, null, 2));
  }

  stop() {
    clearInterval(this.maintenanceTimer);
    clearInterval(this.heartbeatTimer);

    for (const [userId, clients] of this.clients.entries()) {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // Ignore termination errors for stale SSE sockets.
        }
      }
      this.clients.delete(userId);
    }
  }

  ensureUser(userId) {
    let userState = this.store.users[userId];
    if (!userState) {
      userState = createDefaultUserState(this.now());
      this.store.users[userId] = userState;
      this.saveStore();
    }

    return userState;
  }

  createStatePayload(userId, reason, now, userState) {
    const snapshot = this.buildStateSnapshot(userState, now);
    return {
      userId,
      reason,
      serverNow: now,
      state: snapshot,
    };
  }

  buildStateSnapshot(userState, now) {
    const dynamicRemainingMs =
      userState.timer.status === "running" && Number.isInteger(userState.timer.endAt)
        ? Math.max(0, userState.timer.endAt - now)
        : userState.timer.remainingMs;

    return {
      version: userState.version,
      updatedAt: userState.updatedAt,
      settings: { ...userState.settings },
      stats: { ...userState.stats },
      timer: {
        phase: userState.timer.phase,
        status: userState.timer.status,
        durationMs: userState.timer.durationMs,
        remainingMs: dynamicRemainingMs,
        startedAt: userState.timer.startedAt,
        endAt: userState.timer.endAt,
      },
      tasks: userState.tasks.map((task) => ({ ...task })),
    };
  }

  syncUserTimer(userId, reasonWhenChanged = "timer:auto") {
    const userState = this.ensureUser(userId);
    const now = this.now();
    const changed = advanceTimerIfNeeded(userState, now);

    if (changed) {
      this.commitUserState(userId, userState, reasonWhenChanged, now);
    }

    return { userState, now: this.now() };
  }

  commitUserState(userId, userState, reason, now) {
    userState.version += 1;
    userState.updatedAt = now;
    this.saveStore();
    this.broadcastState(userId, reason, now, userState);
  }

  getState(userId) {
    validateUserId(userId);
    const { userState, now } = this.syncUserTimer(userId);
    return this.createStatePayload(userId, "state:read", now, userState);
  }

  applyAction(rawBody) {
    const userId = normalizeUserId(rawBody.userId);
    validateUserId(userId);

    if (typeof rawBody.type !== "string" || !Object.hasOwn(ACTIONS, rawBody.type)) {
      throw createApiError(400, "Unknown action type");
    }

    const { userState } = this.syncUserTimer(userId);
    const actionNow = this.now();
    const payload = rawBody.payload && typeof rawBody.payload === "object" ? rawBody.payload : {};

    let changed = false;
    const actionType = rawBody.type;

    switch (actionType) {
      case ACTIONS.START:
        changed = this.handleStartAction(userState, actionNow);
        break;
      case ACTIONS.PAUSE:
        changed = this.handlePauseAction(userState, actionNow);
        break;
      case ACTIONS.RESET:
        changed = this.handleResetAction(userState, actionNow);
        break;
      case ACTIONS.SKIP:
        changed = this.handleSkipAction(userState, actionNow);
        break;
      case ACTIONS.UPDATE_SETTINGS:
        changed = this.handleUpdateSettingsAction(userState, payload);
        break;
      case ACTIONS.ADD_TASK:
        changed = this.handleAddTaskAction(userState, payload, actionNow);
        break;
      case ACTIONS.TOGGLE_TASK:
        changed = this.handleToggleTaskAction(userState, payload);
        break;
      case ACTIONS.DELETE_TASK:
        changed = this.handleDeleteTaskAction(userState, payload);
        break;
      default:
        throw createApiError(400, "Unsupported action type");
    }

    if (changed) {
      this.commitUserState(userId, userState, `action:${actionType}`, actionNow);
    }

    return this.createStatePayload(
      userId,
      changed ? `action:${actionType}` : `action:${actionType}:noop`,
      this.now(),
      userState,
    );
  }

  handleStartAction(userState, now) {
    if (userState.timer.status === "running") {
      return false;
    }

    const remainingMs =
      userState.timer.status === "paused"
        ? userState.timer.remainingMs
        : getPhaseDurationMs(userState.settings, userState.timer.phase);

    userState.timer.status = "running";
    userState.timer.startedAt = now;
    userState.timer.endAt = now + remainingMs;
    userState.timer.remainingMs = remainingMs;
    return true;
  }

  handlePauseAction(userState, now) {
    if (userState.timer.status !== "running" || !Number.isInteger(userState.timer.endAt)) {
      return false;
    }

    userState.timer.remainingMs = Math.max(0, userState.timer.endAt - now);
    userState.timer.status = "paused";
    userState.timer.startedAt = null;
    userState.timer.endAt = null;
    return true;
  }

  handleResetAction(userState, now) {
    const focusDurationMs = getPhaseDurationMs(userState.settings, "focus");

    userState.timer.phase = "focus";
    userState.timer.status = "idle";
    userState.timer.durationMs = focusDurationMs;
    userState.timer.remainingMs = focusDurationMs;
    userState.timer.startedAt = null;
    userState.timer.endAt = null;
    userState.updatedAt = now;
    return true;
  }

  handleSkipAction(userState, now) {
    let nextPhase = "focus";

    if (userState.timer.phase === "focus") {
      const expectedFocusOrder = userState.stats.completedFocusSessions + 1;
      nextPhase = pickBreakPhase(userState.settings, expectedFocusOrder);
    }

    if (userState.timer.phase === "shortBreak" || userState.timer.phase === "longBreak") {
      nextPhase = "focus";
    }

    const shouldKeepRunning = userState.timer.status === "running";
    setPhaseState(userState, nextPhase, shouldKeepRunning ? "running" : "idle", now);
    return true;
  }

  handleUpdateSettingsAction(userState, payload) {
    const updates = {};
    let hasUpdate = false;

    if (Object.hasOwn(payload, "focusMinutes")) {
      updates.focusMinutes = validateDuration(payload.focusMinutes, "focusMinutes");
      hasUpdate = true;
    }

    if (Object.hasOwn(payload, "shortBreakMinutes")) {
      updates.shortBreakMinutes = validateDuration(payload.shortBreakMinutes, "shortBreakMinutes");
      hasUpdate = true;
    }

    if (Object.hasOwn(payload, "longBreakMinutes")) {
      updates.longBreakMinutes = validateDuration(payload.longBreakMinutes, "longBreakMinutes");
      hasUpdate = true;
    }

    if (Object.hasOwn(payload, "longBreakEvery")) {
      updates.longBreakEvery = validateLongBreakInterval(payload.longBreakEvery);
      hasUpdate = true;
    }

    if (!hasUpdate) {
      throw createApiError(400, "No valid settings fields provided");
    }

    userState.settings = { ...userState.settings, ...updates };

    const currentPhaseDurationMs = getPhaseDurationMs(userState.settings, userState.timer.phase);
    userState.timer.durationMs = currentPhaseDurationMs;

    if (userState.timer.status === "idle") {
      userState.timer.remainingMs = currentPhaseDurationMs;
    }

    if (userState.timer.status === "paused") {
      userState.timer.remainingMs = Math.min(userState.timer.remainingMs, currentPhaseDurationMs);
    }

    return true;
  }

  handleAddTaskAction(userState, payload, now) {
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (!title) {
      throw createApiError(400, "Task title is required");
    }

    if (title.length > 120) {
      throw createApiError(400, "Task title must be at most 120 characters");
    }

    userState.tasks.unshift({
      id: randomUUID(),
      title,
      completed: false,
      createdAt: now,
    });

    return true;
  }

  handleToggleTaskAction(userState, payload) {
    if (typeof payload.taskId !== "string" || !payload.taskId.trim()) {
      throw createApiError(400, "taskId is required");
    }

    const task = userState.tasks.find((item) => item.id === payload.taskId);
    if (!task) {
      throw createApiError(404, "Task not found");
    }

    if (Object.hasOwn(payload, "completed")) {
      task.completed = Boolean(payload.completed);
    } else {
      task.completed = !task.completed;
    }

    return true;
  }

  handleDeleteTaskAction(userState, payload) {
    if (typeof payload.taskId !== "string" || !payload.taskId.trim()) {
      throw createApiError(400, "taskId is required");
    }

    const taskIndex = userState.tasks.findIndex((item) => item.id === payload.taskId);
    if (taskIndex === -1) {
      throw createApiError(404, "Task not found");
    }

    userState.tasks.splice(taskIndex, 1);
    return true;
  }

  handleMaintenanceTick() {
    const now = this.now();

    for (const [userId, userState] of Object.entries(this.store.users)) {
      if (advanceTimerIfNeeded(userState, now)) {
        this.commitUserState(userId, userState, "timer:auto", now);
      }
    }
  }

  registerClient(userId, res) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }

    this.clients.get(userId).add(res);
  }

  unregisterClient(userId, res) {
    const bucket = this.clients.get(userId);
    if (!bucket) {
      return;
    }

    bucket.delete(res);
    if (bucket.size === 0) {
      this.clients.delete(userId);
    }
  }

  sendSseEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  broadcastState(userId, reason, now, userState) {
    const clients = this.clients.get(userId);
    if (!clients || clients.size === 0) {
      return;
    }

    const payload = this.createStatePayload(userId, reason, now, userState);
    for (const res of clients) {
      this.sendSseEvent(res, "state", payload);
    }
  }

  broadcastHeartbeat() {
    const payload = { serverNow: this.now() };

    for (const clients of this.clients.values()) {
      for (const res of clients) {
        this.sendSseEvent(res, "heartbeat", payload);
      }
    }
  }

  openStateStream(userId, req, res) {
    validateUserId(userId);
    const { userState, now } = this.syncUserTimer(userId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write("retry: 2000\n\n");

    this.registerClient(userId, res);
    this.sendSseEvent(res, "state", this.createStatePayload(userId, "stream:connected", now, userState));

    req.on("close", () => {
      this.unregisterClient(userId, res);
    });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let finished = false;
    const MAX_BODY_LENGTH = 1_000_000;

    function rejectOnce(error) {
      if (finished) {
        return;
      }
      finished = true;
      reject(error);
    }

    function resolveOnce(value) {
      if (finished) {
        return;
      }
      finished = true;
      resolve(value);
    }

    req.on("data", (chunk) => {
      if (finished) {
        return;
      }

      body += chunk;
      if (body.length > MAX_BODY_LENGTH) {
        rejectOnce(createApiError(413, "Body too large"));
      }
    });

    req.on("end", () => {
      if (finished) {
        return;
      }

      if (!body.trim()) {
        resolveOnce({});
        return;
      }

      try {
        resolveOnce(JSON.parse(body));
      } catch {
        rejectOnce(createApiError(400, "Invalid JSON body"));
      }
    });

    req.on("error", (error) => {
      rejectOnce(error);
    });
  });
}

function serveStatic(pathname, res) {
  const staticConfig = STATIC_FILES[pathname];
  if (!staticConfig) {
    return false;
  }

  const filePath = path.join(__dirname, "public", staticConfig.fileName);
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": staticConfig.contentType,
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch {
    sendJson(res, 500, { error: "Failed to load static resource" });
    return true;
  }
}

async function handleRequest(req, res, service) {
  const method = req.method || "GET";
  const requestUrl = new URL(req.url || "/", "http://localhost");
  const pathname = requestUrl.pathname;

  if (method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (method === "GET" && pathname === "/api/state") {
    const userId = normalizeUserId(requestUrl.searchParams.get("userId"));
    const payload = service.getState(userId);
    sendJson(res, 200, payload);
    return;
  }

  if (method === "POST" && pathname === "/api/action") {
    const body = await readJsonBody(req);
    const payload = service.applyAction(body);
    sendJson(res, 200, payload);
    return;
  }

  if (method === "GET" && pathname === "/api/stream") {
    const userId = normalizeUserId(requestUrl.searchParams.get("userId"));
    service.openStateStream(userId, req, res);
    return;
  }

  if (method === "GET" && serveStatic(pathname, res)) {
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function createApp(options = {}) {
  const service = new PomodoroService(options);

  const server = http.createServer((req, res) => {
    handleRequest(req, res, service).catch((error) => {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      const message = statusCode >= 500 ? "Internal server error" : error.message;
      sendJson(res, statusCode, { error: message });
    });
  });

  server.on("close", () => {
    service.stop();
  });

  return server;
}

module.exports = { createApp };
