const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { createApp } = require("./app");

describe("App", () => {
  let server;
  let baseUrl;

  before((_, done) => {
    server = createApp();
    server.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  it("GET / returns Hello, World!", async () => {
    const res = await fetch(baseUrl);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.message, "Hello, World!");
  });

  it("GET /health returns ok status", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, "ok");
  });

  it("POST /api/greet with name returns greeting", async () => {
    const res = await fetch(`${baseUrl}/api/greet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agent" }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.message, "Hello, Agent!");
  });

  it("POST /api/greet with invalid JSON returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/greet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.error, "Invalid JSON body");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    const body = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(body.error, "Not found");
  });
});
