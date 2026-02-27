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

function openSse(baseUrl, userId) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}/api/stream?userId=${encodeURIComponent(userId)}`,
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

describe("Pomodoro app", () => {
  let server;
  let baseUrl;
  let tempDir;

  async function getState(userId) {
    const response = await fetch(`${baseUrl}/api/state?userId=${encodeURIComponent(userId)}`);
    const payload = await response.json();
    return { response, payload };
  }

  async function postAction(userId, type, payload = {}) {
    const response = await fetch(`${baseUrl}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, type, payload }),
    });
    const result = await response.json();
    return { response, payload: result };
  }

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pomodoro-app-"));
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
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.status, "ok");
  });

  it("GET /api/state initializes per-user state", async () => {
    const { response, payload } = await getState("alice");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(payload.userId, "alice");
    assert.strictEqual(payload.state.timer.phase, "focus");
    assert.strictEqual(payload.state.timer.status, "idle");
    assert.strictEqual(payload.state.settings.focusMinutes, 25);
    assert.deepStrictEqual(payload.state.tasks, []);
  });

  it("POST /api/action START and PAUSE update timer state", async () => {
    const started = await postAction("bob", "START");
    assert.strictEqual(started.response.status, 200);
    assert.strictEqual(started.payload.state.timer.status, "running");
    assert.ok(Number.isInteger(started.payload.state.timer.endAt));

    await sleep(60);

    const paused = await postAction("bob", "PAUSE");
    assert.strictEqual(paused.response.status, 200);
    assert.strictEqual(paused.payload.state.timer.status, "paused");
    assert.ok(paused.payload.state.timer.remainingMs < paused.payload.state.timer.durationMs);
  });

  it("UPDATE_SETTINGS applies new durations", async () => {
    const updated = await postAction("settings-user", "UPDATE_SETTINGS", {
      focusMinutes: 1,
      shortBreakMinutes: 0.5,
      longBreakMinutes: 2,
      longBreakEvery: 3,
    });

    assert.strictEqual(updated.response.status, 200);
    assert.strictEqual(updated.payload.state.settings.focusMinutes, 1);
    assert.strictEqual(updated.payload.state.settings.shortBreakMinutes, 0.5);
    assert.strictEqual(updated.payload.state.settings.longBreakMinutes, 2);
    assert.strictEqual(updated.payload.state.settings.longBreakEvery, 3);
    assert.strictEqual(updated.payload.state.timer.durationMs, 60000);
    assert.strictEqual(updated.payload.state.timer.remainingMs, 60000);
  });

  it("task actions add, toggle and delete data", async () => {
    const added = await postAction("task-user", "ADD_TASK", { title: "完成需求开发" });
    assert.strictEqual(added.response.status, 200);
    assert.strictEqual(added.payload.state.tasks.length, 1);
    assert.strictEqual(added.payload.state.tasks[0].completed, false);
    const taskId = added.payload.state.tasks[0].id;

    const toggled = await postAction("task-user", "TOGGLE_TASK", {
      taskId,
      completed: true,
    });
    assert.strictEqual(toggled.response.status, 200);
    assert.strictEqual(toggled.payload.state.tasks[0].completed, true);

    const deleted = await postAction("task-user", "DELETE_TASK", { taskId });
    assert.strictEqual(deleted.response.status, 200);
    assert.strictEqual(deleted.payload.state.tasks.length, 0);
  });

  it("SSE stream pushes updates for the same user", async () => {
    const stream = await openSse(baseUrl, "stream-user");
    const initialEvent = await stream.nextEvent((event) => event.event === "state");
    const initialPayload = JSON.parse(initialEvent.data);
    assert.strictEqual(initialPayload.userId, "stream-user");
    assert.strictEqual(initialPayload.state.timer.status, "idle");

    await postAction("stream-user", "START");

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

  it("auto transitions to break after focus countdown ends", async () => {
    await postAction("auto-user", "UPDATE_SETTINGS", {
      focusMinutes: 0.002,
      shortBreakMinutes: 0.02,
      longBreakMinutes: 0.03,
      longBreakEvery: 2,
    });
    await postAction("auto-user", "START");

    await sleep(260);

    const { response, payload } = await getState("auto-user");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(payload.state.timer.phase, "shortBreak");
    assert.strictEqual(payload.state.timer.status, "running");
    assert.strictEqual(payload.state.stats.completedFocusSessions, 1);
  });

  it("returns 404 for unknown route", async () => {
    const response = await fetch(`${baseUrl}/unknown-path`);
    const body = await response.json();
    assert.strictEqual(response.status, 404);
    assert.strictEqual(body.error, "Not found");
  });
});
