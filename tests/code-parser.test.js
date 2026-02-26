// EVA-STORY: EO-03-002
// EVA-STORY: EO-09-002
// EVA-FEATURE: EO-03
// EVA-FEATURE: EO-09
"use strict";

const { test } = require("node:test");
const assert   = require("node:assert/strict");
const fs       = require("fs");
const os       = require("os");
const path     = require("path");

const { parseCodeStructure, shouldEnrich } = require("../src/lib/code-parser");
const { parseOpenApi } = require("../src/lib/openapi-parser");
const { importAdoCsv, parseCsv } = require("../src/lib/ado-import");
const { loadConfig, DEFAULTS } = require("../src/lib/config");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veritas-b4-"));
}

function write(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function cleanDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldEnrich
// ─────────────────────────────────────────────────────────────────────────────

test("shouldEnrich: returns false when plan already has >= 20 stories", () => {
  assert.equal(shouldEnrich(20, 500), false);
  assert.equal(shouldEnrich(25, 1000), false);
  assert.equal(shouldEnrich(100, 5000), false);
});

test("shouldEnrich: returns false for thin plan but tiny codebase (<= 100 files)", () => {
  assert.equal(shouldEnrich(5, 100), false);
  assert.equal(shouldEnrich(0, 0),   false);
});

test("shouldEnrich: returns true for thin plan AND large codebase (> 100 files)", () => {
  assert.equal(shouldEnrich(5, 200),  true);
  assert.equal(shouldEnrich(0, 101),  true);
  assert.equal(shouldEnrich(19, 500), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// code-parser: FastAPI routes
// ─────────────────────────────────────────────────────────────────────────────

test("parseCodeStructure: extracts 3 FastAPI routes as 3 CS- stories", async () => {
  const dir = tmpDir();
  write(dir, "api/chat.py", [
    "from fastapi import APIRouter",
    "router = APIRouter()",
    "",
    "@router.get('/v1/chat/history')",
    "async def get_history(): pass",
    "",
    "@router.post('/v1/chat/message')",
    "async def send_message(): pass",
    "",
    "@router.delete('/v1/chat/{id}')",
    "async def delete_message(): pass",
  ].join("\n"));

  const result = await parseCodeStructure(dir, "CS");

  assert.equal(result.stories.length, 3, "should extract exactly 3 routes");
  assert.ok(result.stories.every((s) => s.id.startsWith("CS-")), "all stories use CS- prefix");
  assert.ok(result.stories.every((s) => s.source === "code-structure"));
  assert.ok(result.features.length >= 1, "at least one feature created");

  cleanDir(dir);
});

test("parseCodeStructure: Flask routes extracted", async () => {
  const dir = tmpDir();
  write(dir, "app.py", [
    "from flask import Flask",
    "app = Flask(__name__)",
    "",
    "@app.route('/users', methods=['GET'])",
    "def list_users(): pass",
    "",
    "@app.route('/users/<int:id>', methods=['PUT'])",
    "def update_user(id): pass",
  ].join("\n"));

  const result = await parseCodeStructure(dir, "CS");

  assert.ok(result.stories.length >= 2, "at least 2 Flask routes extracted");
  cleanDir(dir);
});

test("parseCodeStructure: Express routes extracted", async () => {
  const dir = tmpDir();
  write(dir, "src/routes/users.js", [
    "const express = require('express');",
    "const router = express.Router();",
    "",
    "router.get('/users', listUsers);",
    "router.post('/users', createUser);",
    "router.delete('/users/:id', deleteUser);",
    "",
    "module.exports = router;",
  ].join("\n"));

  const result = await parseCodeStructure(dir, "CS");
  assert.ok(result.stories.length >= 3, "at least 3 Express routes extracted");
  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// code-parser: Terraform
// ─────────────────────────────────────────────────────────────────────────────

test("parseCodeStructure: extracts 5 Terraform resources as CS-INFRA stories", async () => {
  const dir = tmpDir();
  write(dir, "infra/main.tf", [
    'resource "azurerm_resource_group" "rg" {',
    '  name = "my-rg"',
    "}",
    "",
    'resource "azurerm_storage_account" "sa" {',
    '  name = "mysa"',
    "}",
    "",
    'resource "azurerm_key_vault" "kv" {',
    '  name = "mykv"',
    "}",
    "",
    'resource "azurerm_app_service" "app" {',
    '  name = "myapp"',
    "}",
    "",
    'resource "azurerm_cosmos_db_account" "cosmos" {',
    '  name = "mycosmos"',
    "}",
  ].join("\n"));

  const result = await parseCodeStructure(dir, "CS");

  const infraStories = result.stories.filter((s) => s.feature_id === "CS-INFRA");
  assert.equal(infraStories.length, 5, "5 azurerm_* resources → 5 CS-INFRA stories");
  assert.ok(result.features.some((f) => f.id === "CS-INFRA"), "CS-INFRA feature created");

  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// code-parser: empty repo / no matches
// ─────────────────────────────────────────────────────────────────────────────

test("parseCodeStructure: empty repo returns empty arrays (no throw)", async () => {
  const dir = tmpDir();
  let result;
  await assert.doesNotReject(async () => { result = await parseCodeStructure(dir); });
  assert.deepEqual(result.stories, []);
  assert.deepEqual(result.features, []);
  cleanDir(dir);
});

test("parseCodeStructure: story IDs follow 3-part format PREFIX-DOMAIN-seq", async () => {
  const dir = tmpDir();
  write(dir, "infra/main.tf", [
    'resource "azurerm_resource_group" "rg" { name = "rg" }',
  ].join("\n"));

  const result = await parseCodeStructure(dir, "MY");
  assert.ok(result.stories.length >= 1);
  const id = result.stories[0].id;
  const parts = id.split("-");
  assert.ok(parts.length >= 3, `story ID "${id}" should have 3+ parts`);
  assert.equal(parts[0], "MY", "prefix matches");

  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// openapi-parser
// ─────────────────────────────────────────────────────────────────────────────

test("parseOpenApi: extracts stories from openapi.json in repo root", () => {
  const dir = tmpDir();
  write(dir, "openapi.json", JSON.stringify({
    openapi: "3.0.0",
    info: { title: "My API", version: "1.0.0" },
    paths: {
      "/v1/chat": {
        get:  { summary: "List chats" },
        post: { summary: "Create chat" },
      },
      "/v1/users/{id}": {
        get:    { summary: "Get user" },
        delete: { summary: "Delete user" },
      },
      "/health": {
        get: { summary: "Health check" },
      }
    }
  }));

  const result = parseOpenApi(dir, "OA");
  assert.ok(result.stories.length >= 5, "5 operations → 5 stories");
  assert.ok(result.features.length >= 2, "at least 2 feature groups");
  assert.equal(result.specPath, path.join(dir, "openapi.json"));
  assert.ok(result.stories.every((s) => s.source === "openapi"));

  cleanDir(dir);
});

test("parseOpenApi: returns empty arrays when no spec file exists", () => {
  const dir = tmpDir();
  const result = parseOpenApi(dir, "OA");
  assert.deepEqual(result.stories, []);
  assert.deepEqual(result.features, []);
  assert.equal(result.specPath, null);
  cleanDir(dir);
});

test("parseOpenApi: probes docs/ directory for openapi.json", () => {
  const dir = tmpDir();
  write(dir, "docs/openapi.json", JSON.stringify({
    paths: { "/api/items": { get: { summary: "List items" } } }
  }));

  const result = parseOpenApi(dir, "OA");
  assert.ok(result.stories.length >= 1);

  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// ado-import: parseCsv
// ─────────────────────────────────────────────────────────────────────────────

test("parseCsv: basic unquoted CSV", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n");
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.deepEqual(rows[1], ["1", "2", "3"]);
});

test("parseCsv: handles quoted fields with commas", () => {
  const rows = parseCsv('"hello, world",two,three\n');
  assert.deepEqual(rows[0], ["hello, world", "two", "three"]);
});

test("parseCsv: handles escaped quotes inside quoted fields", () => {
  const rows = parseCsv('"say ""hi""",end\n');
  assert.deepEqual(rows[0], ['say "hi"', "end"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// ado-import: importAdoCsv
// ─────────────────────────────────────────────────────────────────────────────

test("importAdoCsv: parses Feature/User Story/Task hierarchy", () => {
  const dir = tmpDir();
  const csv = [
    "Work Item Type,Title,Parent,Description,Acceptance Criteria,Tags,Evidence Sources",
    "Epic,My Epic,,,,,",
    "Feature,F33-01 Core Feature,My Epic,,,,",
    "User Story,F33-01-001 First story,F33-01 Core Feature,Desc,- must work,eva;story,",
    "User Story,F33-01-002 Second story,F33-01 Core Feature,,,eva;story,",
    "Task,F33-01-001-T001 Do the thing,F33-01-001 First story,,,eva;task,",
  ].join("\n");

  write(dir, "ado.csv", csv);
  const result = importAdoCsv(path.join(dir, "ado.csv"));

  assert.equal(result.features.length, 1, "one feature");
  assert.equal(result.features[0].id, "F33-01", "feature ID extracted from title prefix");
  assert.equal(result.features[0].title, "Core Feature");

  assert.equal(result.stories.length, 2, "two user stories");
  assert.equal(result.stories[0].id, "F33-01-001");
  assert.equal(result.stories[0].feature_id, "F33-01", "story wired to parent feature");

  assert.equal(result.tasks.length, 1, "one task");
  assert.equal(result.tasks[0].story_id, "F33-01-001", "task wired to parent story");

  cleanDir(dir);
});

test("importAdoCsv: handles rows without a veritas ID prefix (auto-generates IDs)", () => {
  const dir = tmpDir();
  const csv = [
    "Work Item Type,Title,Parent",
    "Feature,Authentication,,",
    "User Story,Login page,Authentication,",
    "User Story,Logout flow,Authentication,",
  ].join("\n");

  write(dir, "ado.csv", csv);
  const result = importAdoCsv(path.join(dir, "ado.csv"));

  assert.equal(result.features.length, 1);
  assert.ok(result.features[0].id.startsWith("ADO-"), "auto-generated ID starts with ADO-");
  assert.equal(result.stories.length, 2);
  assert.equal(result.stories[0].feature_id, result.features[0].id,
    "auto-ID stories correctly wired to auto-ID feature");

  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// config.js
// ─────────────────────────────────────────────────────────────────────────────

test("loadConfig: returns defaults when .evarc.json absent", () => {
  const dir = tmpDir();
  const cfg = loadConfig(dir);
  assert.equal(cfg.threshold, 70);
  assert.equal(cfg.data_model_url, "http://localhost:8010");
  assert.deepEqual(cfg.ignore, []);
  cleanDir(dir);
});

test("loadConfig: merges .evarc.json over defaults", () => {
  const dir = tmpDir();
  write(dir, ".evarc.json", JSON.stringify({ threshold: 85, prefix: "F33" }));
  const cfg = loadConfig(dir);
  assert.equal(cfg.threshold, 85, ".evarc threshold overrides default");
  assert.equal(cfg.prefix, "F33",   ".evarc prefix applied");
  assert.equal(cfg.data_model_url, "http://localhost:8010", "default still present");
  cleanDir(dir);
});

test("loadConfig: returns defaults gracefully on malformed .evarc.json", () => {
  const dir = tmpDir();
  write(dir, ".evarc.json", "{ bad json !!!");
  let cfg;
  assert.doesNotThrow(() => { cfg = loadConfig(dir); });
  assert.equal(cfg.threshold, DEFAULTS.threshold, "falls back to default threshold");
  cleanDir(dir);
});

test("loadConfig: returns defaults for .evarc.json with non-object root value", () => {
  const dir = tmpDir();
  write(dir, ".evarc.json", '"just a string"');
  let cfg;
  assert.doesNotThrow(() => { cfg = loadConfig(dir); });
  assert.equal(cfg.threshold, DEFAULTS.threshold);
  cleanDir(dir);
});
