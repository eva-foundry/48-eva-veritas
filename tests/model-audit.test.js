// EVA-STORY: EO-12-001
// EVA-FEATURE: EO-12
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  checkScreens,
  checkEndpoints,
  checkServices,
  checkContainers,
  modelAudit
} = require("../src/model-audit");

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veritas-ma-"));
}

function cleanDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/** Start a minimal mock data model HTTP server. */
function startMockApi(handlers) {
  const server = http.createServer((req, res) => {
    const handler = handlers[req.url] || handlers[req.method + " " + req.url];
    if (handler) {
      const body = JSON.stringify(handler);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function stopMock(server) {
  return new Promise((res) => server.close(res));
}

// ── Unit Tests: checkScreens ──────────────────────────────────────────────────

test("checkScreens -- valid repo_path on disk -> no drift", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "myScreen.jsx"), "export default function MyScreen() {}");
    const screens = [{ obj_id: "ScreenA", repo_path: "myScreen.jsx" }];
    const drifted = checkScreens(screens, dir);
    assert.equal(drifted.length, 0, "no drift expected when file exists");
  } finally { cleanDir(dir); }
});

test("checkScreens -- missing repo_path on disk -> drift reported", () => {
  const dir = tmpDir();
  try {
    const screens = [{ obj_id: "ScreenB", repo_path: "missing/Screen.jsx" }];
    const drifted = checkScreens(screens, dir);
    assert.equal(drifted.length, 1);
    assert.equal(drifted[0].entity, "ScreenB");
    assert.equal(drifted[0].type, "screen");
    assert.match(drifted[0].gap, /not on disk/);
  } finally { cleanDir(dir); }
});

test("checkScreens -- screen with no repo_path field -> skipped", () => {
  const dir = tmpDir();
  try {
    const screens = [{ obj_id: "ScreenC" }]; // no repo_path
    const drifted = checkScreens(screens, dir);
    assert.equal(drifted.length, 0);
  } finally { cleanDir(dir); }
});

// ── Unit Tests: checkEndpoints ────────────────────────────────────────────────

test("checkEndpoints -- implemented, path found in router file -> no drift", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "router.js"), "app.get('/v1/conversations', listConversations);\n");
    const endpoints = [{ id: "GET /v1/conversations", status: "implemented", path: "/v1/conversations" }];
    const drifted = checkEndpoints(endpoints, dir);
    assert.equal(drifted.length, 0);
  } finally { cleanDir(dir); }
});

test("checkEndpoints -- implemented, path NOT in repo -> drift reported", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "router.js"), "app.get('/v1/other', handler);\n");
    const endpoints = [{ id: "GET /v1/missing-route", status: "implemented", path: "/v1/missing-route" }];
    const drifted = checkEndpoints(endpoints, dir);
    assert.equal(drifted.length, 1);
    assert.equal(drifted[0].type, "endpoint");
    assert.equal(drifted[0].declared_status, "implemented");
    assert.match(drifted[0].gap, /No router file/);
  } finally { cleanDir(dir); }
});

test("checkEndpoints -- stub status -> skipped (not flagged as drift)", () => {
  const dir = tmpDir();
  try {
    const endpoints = [{ id: "GET /v1/stub-endpoint", status: "stub", path: "/v1/stub-endpoint" }];
    const drifted = checkEndpoints(endpoints, dir);
    assert.equal(drifted.length, 0, "stub endpoints are not checked");
  } finally { cleanDir(dir); }
});

// ── Unit Tests: checkServices ─────────────────────────────────────────────────

test("checkServices -- is_active=true, name in docker-compose -> no drift", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      "services:\n  eva-brain:\n    image: eva-brain:latest\n"
    );
    const services = [{ obj_id: "svc-brain", name: "eva-brain", is_active: true }];
    const drifted = checkServices(services, dir);
    assert.equal(drifted.length, 0);
  } finally { cleanDir(dir); }
});

test("checkServices -- is_active=true, name NOT in any docker file -> drift", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), "services:\n  other-svc:\n    image: other\n");
    const services = [{ obj_id: "svc-missing", name: "eva-ghost", is_active: true }];
    const drifted = checkServices(services, dir);
    assert.equal(drifted.length, 1);
    assert.equal(drifted[0].type, "service");
  } finally { cleanDir(dir); }
});

test("checkServices -- is_active=false -> skipped", () => {
  const dir = tmpDir();
  try {
    const services = [{ obj_id: "svc-inactive", name: "dead-service", is_active: false }];
    const drifted = checkServices(services, dir);
    assert.equal(drifted.length, 0);
  } finally { cleanDir(dir); }
});

// ── Unit Tests: checkContainers ───────────────────────────────────────────────

test("checkContainers -- >= 50% of fields found in repo -> no drift", () => {
  const dir = tmpDir();
  try {
    // Put fields in a Python model file
    fs.writeFileSync(
      path.join(dir, "model.py"),
      "class Conversation:\n  conversation_id: str\n  user_id: str\n  created_at: datetime\n"
    );
    const containers = [{
      obj_id: "eva-conversations",
      fields: ["conversation_id", "user_id", "created_at", "some_other_field"]
    }];
    const { driftedEntries, driftedIds } = checkContainers(containers, dir);
    // 3 of 4 fields found = 75% >= 50% -> no drift
    assert.equal(driftedEntries.length, 0);
    assert.equal(driftedIds.length, 0);
  } finally { cleanDir(dir); }
});

test("checkContainers -- < 50% of fields found -> drift reported", () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "schema.py"), "# empty schema file\n");
    const containers = [{
      obj_id: "eva-messages",
      fields: ["message_id", "thread_id", "content", "token_count", "model_name"]
    }];
    const { driftedEntries, driftedIds } = checkContainers(containers, dir);
    assert.equal(driftedEntries.length, 1);
    assert.equal(driftedIds[0], "eva-messages");
    assert.equal(driftedEntries[0].type, "container");
    assert.match(driftedEntries[0].gap, /< 50%/);
  } finally { cleanDir(dir); }
});

test("checkContainers -- container with no fields -> skipped", () => {
  const dir = tmpDir();
  try {
    const containers = [{ obj_id: "empty-container", fields: [] }];
    const { driftedEntries } = checkContainers(containers, dir);
    assert.equal(driftedEntries.length, 0);
  } finally { cleanDir(dir); }
});

// ── Integration: modelAudit() graceful degrade ────────────────────────────────

test("modelAudit -- API not reachable -> writes error fidelity.json, does not throw", async () => {
  const dir = tmpDir();
  try {
    await modelAudit({
      repo: dir,
      dataModel: "http://127.0.0.1:19999", // guaranteed dead port
      warnOnly: true
    });
    const outPath = path.join(dir, ".eva", "model-fidelity.json");
    assert.ok(fs.existsSync(outPath), "model-fidelity.json should be written even on API error");
    const fidelity = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.ok(fidelity.error, "error field should be present");
    assert.match(fidelity.schema, /eva\.model-fidelity/);
  } finally { cleanDir(dir); }
});

// ── Integration: modelAudit() with mock server ────────────────────────────────

test("modelAudit -- all entities clean -> score 100, no drift", async () => {
  const dir = tmpDir();
  // Create a fake router file so endpoint path will be found
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "router.js"), "app.get('/v1/ping', pingHandler);\n");
  // Create a fake screen file
  fs.writeFileSync(path.join(dir, "HomeScreen.jsx"), "export default HomeScreen;\n");
  // Create a docker-compose with the service
  fs.writeFileSync(path.join(dir, "docker-compose.yml"), "services:\n  active-svc:\n    image: x\n");

  const mockHandlers = {
    "/model/screens/": [{ obj_id: "screen-home", repo_path: "HomeScreen.jsx" }],
    "/model/endpoints/": [{ id: "GET /v1/ping", status: "implemented", path: "/v1/ping" }],
    "/model/services/": [{ obj_id: "svc-active", name: "active-svc", is_active: true }],
    "/model/containers/": [{ obj_id: "container-x", fields: [] }] // no fields -> skipped
  };

  let mock;
  try {
    mock = await startMockApi(mockHandlers);
    await modelAudit({
      repo: dir,
      dataModel: mock.base,
      warnOnly: true
    });
    const fidelity = JSON.parse(
      fs.readFileSync(path.join(dir, ".eva", "model-fidelity.json"), "utf8")
    );
    assert.equal(fidelity.model_fidelity_score, 100);
    assert.equal(fidelity.drifted.length, 0);
    assert.equal(fidelity.declared_total, 4); // screen + endpoint + service + container (all declared)
  } finally {
    cleanDir(dir);
    if (mock) await stopMock(mock.server);
  }
});

test("modelAudit -- screen with missing file -> drift captured", async () => {
  const dir = tmpDir();
  // Do NOT create the screen file on disk

  const mockHandlers = {
    "/model/screens/": [{ obj_id: "screen-missing", repo_path: "ghost/MissingScreen.jsx" }],
    "/model/endpoints/": [],
    "/model/services/": [],
    "/model/containers/": []
  };

  let mock;
  try {
    mock = await startMockApi(mockHandlers);
    // Reset exitCode before run
    process.exitCode = 0;
    await modelAudit({
      repo: dir,
      dataModel: mock.base,
      warnOnly: true // avoid setting exit code in test
    });
    const fidelity = JSON.parse(
      fs.readFileSync(path.join(dir, ".eva", "model-fidelity.json"), "utf8")
    );
    assert.equal(fidelity.drifted.length, 1);
    assert.equal(fidelity.drifted[0].entity, "screen-missing");
    assert.equal(fidelity.drifted[0].type, "screen");
    assert.ok(fidelity.model_fidelity_score < 100);
  } finally {
    cleanDir(dir);
    if (mock) await stopMock(mock.server);
    process.exitCode = 0;
  }
});

test("modelAudit -- fidelity score proportional to verified/declared", async () => {
  const dir = tmpDir();
  // Create only one of two screen files
  fs.writeFileSync(path.join(dir, "ScreenA.jsx"), "");

  const mockHandlers = {
    "/model/screens/": [
      { obj_id: "screen-a", repo_path: "ScreenA.jsx" },
      { obj_id: "screen-b", repo_path: "ScreenB.jsx" } // missing
    ],
    "/model/endpoints/": [],
    "/model/services/": [],
    "/model/containers/": []
  };

  let mock;
  try {
    mock = await startMockApi(mockHandlers);
    await modelAudit({ repo: dir, dataModel: mock.base, warnOnly: true });
    const fidelity = JSON.parse(
      fs.readFileSync(path.join(dir, ".eva", "model-fidelity.json"), "utf8")
    );
    // 1 verified out of 2 declared = 50%
    assert.equal(fidelity.declared_total, 2);
    assert.equal(fidelity.verified_total, 1);
    assert.equal(fidelity.model_fidelity_score, 50);
  } finally {
    cleanDir(dir);
    if (mock) await stopMock(mock.server);
    process.exitCode = 0;
  }
});
