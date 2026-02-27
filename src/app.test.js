const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { app } = require("./app");
const { closeDb } = require("./db");

let server;
let baseUrl;

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const res = await fetch(baseUrl + path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

function authApi(token) {
  return (path, options = {}) =>
    api(path, {
      ...options,
      headers: { ...options.headers, Authorization: "Bearer " + token },
    });
}

describe("Pomodoro API", () => {
  before((_, done) => {
    process.env.DB_PATH = ":memory:";
    delete require.cache[require.resolve("./db")];

    server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(() => {
      closeDb();
      done();
    });
  });

  describe("Health", () => {
    it("GET /api/health returns ok", async () => {
      const { status, data } = await api("/api/health");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.status, "ok");
    });
  });

  describe("Auth", () => {
    it("registers a new user", async () => {
      const { status, data } = await api("/api/auth/register", {
        method: "POST",
        body: { username: "testuser", password: "pass1234" },
      });
      assert.strictEqual(status, 201);
      assert.ok(data.token);
      assert.strictEqual(data.user.username, "testuser");
    });

    it("rejects duplicate username", async () => {
      const { status, data } = await api("/api/auth/register", {
        method: "POST",
        body: { username: "testuser", password: "pass1234" },
      });
      assert.strictEqual(status, 409);
      assert.ok(data.error);
    });

    it("logs in with correct credentials", async () => {
      const { status, data } = await api("/api/auth/login", {
        method: "POST",
        body: { username: "testuser", password: "pass1234" },
      });
      assert.strictEqual(status, 200);
      assert.ok(data.token);
    });

    it("rejects wrong password", async () => {
      const { status } = await api("/api/auth/login", {
        method: "POST",
        body: { username: "testuser", password: "wrong" },
      });
      assert.strictEqual(status, 401);
    });

    it("rejects missing fields", async () => {
      const { status } = await api("/api/auth/register", {
        method: "POST",
        body: { username: "" },
      });
      assert.strictEqual(status, 400);
    });
  });

  describe("Timer", () => {
    let authed;

    before(async () => {
      const { data } = await api("/api/auth/register", {
        method: "POST",
        body: { username: "timeruser", password: "pass1234" },
      });
      authed = authApi(data.token);
    });

    it("GET /api/timer returns initial state", async () => {
      const { status, data } = await authed("/api/timer");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.timer.status, "idle");
      assert.strictEqual(data.timer.timer_type, "work");
      assert.strictEqual(data.timer.duration, 1500);
    });

    it("POST /api/timer/start starts the timer", async () => {
      const { status, data } = await authed("/api/timer/start", { method: "POST" });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.timer.status, "running");
      assert.ok(data.timer.started_at);
    });

    it("POST /api/timer/pause pauses the timer", async () => {
      const { status, data } = await authed("/api/timer/pause", { method: "POST" });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.timer.status, "paused");
      assert.ok(data.timer.remaining > 0);
    });

    it("POST /api/timer/start resumes paused timer", async () => {
      const { status, data } = await authed("/api/timer/start", { method: "POST" });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.timer.status, "running");
    });

    it("POST /api/timer/reset resets the timer", async () => {
      const { status, data } = await authed("/api/timer/reset", {
        method: "POST",
        body: { timerType: "work" },
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.timer.status, "idle");
      assert.strictEqual(data.timer.remaining, 1500);
    });

    it("POST /api/timer/complete completes and moves to break", async () => {
      await authed("/api/timer/start", { method: "POST" });
      const { status, data } = await authed("/api/timer/complete", { method: "POST" });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.timer.timer_type, "short_break");
      assert.strictEqual(data.timer.completed_count, 1);
      assert.ok(data.session);
    });

    it("switches to long break after interval", async () => {
      for (let i = 0; i < 3; i++) {
        await authed("/api/timer/reset", { method: "POST", body: { timerType: "work" } });
        await authed("/api/timer/start", { method: "POST" });
        await authed("/api/timer/complete", { method: "POST" });
      }
      const { data } = await authed("/api/timer");
      assert.strictEqual(data.timer.timer_type, "long_break");
      assert.strictEqual(data.timer.completed_count, 4);
    });
  });

  describe("Sessions", () => {
    let authed;

    before(async () => {
      const { data } = await api("/api/auth/register", {
        method: "POST",
        body: { username: "sessionuser", password: "pass1234" },
      });
      authed = authApi(data.token);

      await authed("/api/timer/start", { method: "POST" });
      await authed("/api/timer/complete", { method: "POST" });
    });

    it("GET /api/sessions returns history and stats", async () => {
      const { status, data } = await authed("/api/sessions");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.sessions));
      assert.ok(data.sessions.length > 0);
      assert.ok(data.stats);
    });

    it("DELETE /api/sessions clears history", async () => {
      await authed("/api/sessions", { method: "DELETE" });
      const { data } = await authed("/api/sessions");
      assert.strictEqual(data.sessions.length, 0);
    });
  });

  describe("Settings", () => {
    let authed;

    before(async () => {
      const { data } = await api("/api/auth/register", {
        method: "POST",
        body: { username: "settingsuser", password: "pass1234" },
      });
      authed = authApi(data.token);
    });

    it("GET /api/settings returns defaults", async () => {
      const { status, data } = await authed("/api/settings");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.settings.work_duration, 1500);
      assert.strictEqual(data.settings.short_break_duration, 300);
    });

    it("PUT /api/settings updates settings", async () => {
      const { status, data } = await authed("/api/settings", {
        method: "PUT",
        body: { work_duration: 1800, short_break_duration: 600 },
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.settings.work_duration, 1800);
      assert.strictEqual(data.settings.short_break_duration, 600);
    });
  });

  describe("Auth protection", () => {
    it("rejects unauthenticated requests", async () => {
      const { status } = await api("/api/timer");
      assert.strictEqual(status, 401);
    });

    it("rejects invalid token", async () => {
      const { status } = await api("/api/timer", {
        headers: { Authorization: "Bearer invalid" },
      });
      assert.strictEqual(status, 401);
    });
  });
});
