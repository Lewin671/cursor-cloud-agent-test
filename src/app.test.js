const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { setTimeout: sleep } = require("node:timers/promises");
const { createApp } = require("./app");

async function listen(server) {
  await new Promise((resolve) => {
    server.listen(0, resolve);
  });
}

async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
  });
}

function parseSseChunk(rawChunk) {
  if (!rawChunk.trim()) {
    return null;
  }

  const lines = rawChunk.split("\n");
  let event = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

function openSse(baseUrl, token) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}/api/stream?token=${encodeURIComponent(token)}`,
      { method: "GET", headers: { Accept: "text/event-stream" } },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Unexpected SSE status: ${response.statusCode}`));
          response.resume();
          return;
        }

        response.setEncoding("utf8");
        let buffer = "";
        const queue = [];
        const waiters = [];

        function fulfillWaiters(eventPayload) {
          for (let index = 0; index < waiters.length; index += 1) {
            const waiter = waiters[index];
            if (waiter.predicate(eventPayload)) {
              waiters.splice(index, 1);
              clearTimeout(waiter.timeoutHandle);
              waiter.resolve(eventPayload);
              return true;
            }
          }
          return false;
        }

        function pushEvent(eventPayload) {
          if (!fulfillWaiters(eventPayload)) {
            queue.push(eventPayload);
          }
        }

        response.on("data", (chunk) => {
          buffer += chunk;
          let separatorIndex = buffer.indexOf("\n\n");

          while (separatorIndex !== -1) {
            const chunkData = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            const parsed = parseSseChunk(chunkData);
            if (parsed) {
              pushEvent(parsed);
            }
            separatorIndex = buffer.indexOf("\n\n");
          }
        });

        resolve({
          async nextEvent(predicate = () => true, timeoutMs = 2000) {
            for (let index = 0; index < queue.length; index += 1) {
              if (predicate(queue[index])) {
                const matched = queue[index];
                queue.splice(index, 1);
                return matched;
              }
            }

            return new Promise((resolveNext, rejectNext) => {
              const timeoutHandle = setTimeout(() => {
                const waiterIndex = waiters.findIndex((item) => item.resolve === resolveNext);
                if (waiterIndex >= 0) {
                  waiters.splice(waiterIndex, 1);
                }
                rejectNext(new Error("Timed out waiting for SSE event"));
              }, timeoutMs);

              waiters.push({
                predicate,
                resolve: resolveNext,
                timeoutHandle,
              });
            });
          },
          close() {
            request.destroy();
            response.destroy();
          },
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

describe("Pomodoro app with auth", () => {
  let server;
  let baseUrl;
  let tempDir;

  async function request(method, requestPath, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (Object.hasOwn(options, "token") && options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    let body;
    if (Object.hasOwn(options, "body")) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await fetch(`${baseUrl}${requestPath}`, { method, headers, body });
    const rawText = await response.text();
    let payload = {};
    if (rawText.trim()) {
      payload = JSON.parse(rawText);
    }
    return { response, payload };
  }

  async function register(userId, password = "password-1234") {
    return request("POST", "/api/auth/register", {
      body: { userId, password },
    });
  }

  async function login(userId, password = "password-1234") {
    return request("POST", "/api/auth/login", {
      body: { userId, password },
    });
  }

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pomodoro-app-auth-"));
    const dataFile = path.join(tempDir, "store.json");
    server = createApp({
      dataFile,
      tickIntervalMs: 20,
      heartbeatIntervalMs: 1000,
    });
    await listen(server);
    const { port } = server.address();
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await close(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("GET / returns frontend HTML", async () => {
    const response = await fetch(baseUrl);
    const body = await response.text();
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(body, /同步番茄钟/);
  });

  it("GET /health returns ok status", async () => {
    const { response, payload } = await request("GET", "/health");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(payload.status, "ok");
  });

  it("registers account and returns token", async () => {
    const { response, payload } = await register("alice-auth");
    assert.strictEqual(response.status, 201);
    assert.strictEqual(payload.userId, "alice-auth");
    assert.ok(typeof payload.token === "string" && payload.token.length > 20);
  });

  it("does not allow duplicate registration", async () => {
    await register("duplicate-user");
    const { response, payload } = await register("duplicate-user");
    assert.strictEqual(response.status, 409);
    assert.strictEqual(payload.error, "Account already exists");
  });

  it("login succeeds with correct password and fails with wrong password", async () => {
    await register("login-user");

    const success = await login("login-user");
    assert.strictEqual(success.response.status, 200);
    assert.strictEqual(success.payload.userId, "login-user");
    assert.ok(success.payload.token);

    const failed = await login("login-user", "wrong-password");
    assert.strictEqual(failed.response.status, 401);
    assert.strictEqual(failed.payload.error, "Invalid credentials");
  });

  it("protects state endpoint when unauthorized", async () => {
    const { response, payload } = await request("GET", "/api/state");
    assert.strictEqual(response.status, 401);
    assert.strictEqual(payload.error, "Unauthorized");
  });

  it("auth token can read state and update timer", async () => {
    const auth = await register("timer-user");
    const token = auth.payload.token;

    const stateRes = await request("GET", "/api/state", { token });
    assert.strictEqual(stateRes.response.status, 200);
    assert.strictEqual(stateRes.payload.userId, "timer-user");
    assert.strictEqual(stateRes.payload.state.timer.status, "idle");

    const started = await request("POST", "/api/action", {
      token,
      body: { type: "START" },
    });
    assert.strictEqual(started.response.status, 200);
    assert.strictEqual(started.payload.state.timer.status, "running");

    await sleep(60);

    const paused = await request("POST", "/api/action", {
      token,
      body: { type: "PAUSE" },
    });
    assert.strictEqual(paused.response.status, 200);
    assert.strictEqual(paused.payload.state.timer.status, "paused");
    assert.ok(paused.payload.state.timer.remainingMs < paused.payload.state.timer.durationMs);
  });

  it("task actions add, toggle and delete with auth", async () => {
    const auth = await register("task-auth-user");
    const token = auth.payload.token;

    const added = await request("POST", "/api/action", {
      token,
      body: { type: "ADD_TASK", payload: { title: "完成登录功能验证" } },
    });
    assert.strictEqual(added.response.status, 200);
    assert.strictEqual(added.payload.state.tasks.length, 1);
    assert.strictEqual(added.payload.state.tasks[0].completed, false);
    const taskId = added.payload.state.tasks[0].id;

    const toggled = await request("POST", "/api/action", {
      token,
      body: { type: "TOGGLE_TASK", payload: { taskId, completed: true } },
    });
    assert.strictEqual(toggled.response.status, 200);
    assert.strictEqual(toggled.payload.state.tasks[0].completed, true);

    const deleted = await request("POST", "/api/action", {
      token,
      body: { type: "DELETE_TASK", payload: { taskId } },
    });
    assert.strictEqual(deleted.response.status, 200);
    assert.strictEqual(deleted.payload.state.tasks.length, 0);
  });

  it("SSE stream pushes updates when token is valid", async () => {
    const auth = await register("stream-auth-user");
    const token = auth.payload.token;
    const stream = await openSse(baseUrl, token);

    const initialEvent = await stream.nextEvent((event) => event.event === "state");
    const initialPayload = JSON.parse(initialEvent.data);
    assert.strictEqual(initialPayload.userId, "stream-auth-user");
    assert.strictEqual(initialPayload.state.timer.status, "idle");

    await request("POST", "/api/action", {
      token,
      body: { type: "START" },
    });

    const updateEvent = await stream.nextEvent((event) => {
      if (event.event !== "state") {
        return false;
      }
      const data = JSON.parse(event.data);
      return data.reason === "action:START";
    });
    const updatePayload = JSON.parse(updateEvent.data);
    assert.strictEqual(updatePayload.state.timer.status, "running");

    stream.close();
  });

  it("auto transitions to break phase after focus countdown", async () => {
    const auth = await register("auto-auth-user");
    const token = auth.payload.token;

    await request("POST", "/api/action", {
      token,
      body: {
        type: "UPDATE_SETTINGS",
        payload: {
          focusMinutes: 0.002,
          shortBreakMinutes: 0.02,
          longBreakMinutes: 0.03,
          longBreakEvery: 2,
        },
      },
    });

    await request("POST", "/api/action", {
      token,
      body: { type: "START" },
    });

    await sleep(260);

    const stateRes = await request("GET", "/api/state", { token });
    assert.strictEqual(stateRes.response.status, 200);
    assert.strictEqual(stateRes.payload.state.timer.phase, "shortBreak");
    assert.strictEqual(stateRes.payload.state.timer.status, "running");
    assert.strictEqual(stateRes.payload.state.stats.completedFocusSessions, 1);
  });

  it("supports me and logout endpoints", async () => {
    const auth = await register("logout-user");
    const token = auth.payload.token;

    const meRes = await request("GET", "/api/auth/me", { token });
    assert.strictEqual(meRes.response.status, 200);
    assert.strictEqual(meRes.payload.userId, "logout-user");

    const logoutRes = await request("POST", "/api/auth/logout", { token });
    assert.strictEqual(logoutRes.response.status, 200);
    assert.strictEqual(logoutRes.payload.success, true);

    const stateRes = await request("GET", "/api/state", { token });
    assert.strictEqual(stateRes.response.status, 401);
  });

  it("returns 404 for unknown route", async () => {
    const { response, payload } = await request("GET", "/unknown-path");
    assert.strictEqual(response.status, 404);
    assert.strictEqual(payload.error, "Not found");
  });
});
