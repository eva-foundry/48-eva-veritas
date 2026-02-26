// EVA-STORY: EO-03-001
// EVA-STORY: EO-09-001
// EVA-FEATURE: EO-03
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { mineCommits, mergeEvidenceMaps } = require("../src/lib/evidence");
const { scanRepo } = require("../src/lib/scan-repo");

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veritas-ev-"));
}

function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function initRepo(dir) {
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test Runner");
}

function emptyCommit(dir, message) {
  git(dir, "commit", "--allow-empty", "-m", message);
}

function cleanDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// mineCommits
// ─────────────────────────────────────────────────────────────────────────────

test("mineCommits: returns {} for non-git directory (graceful no-throw)", () => {
  const dir = tmpDir(); // plain temp dir — NOT a git repo
  let map;
  assert.doesNotThrow(() => { map = mineCommits(dir, ["EO-05-001"]); });
  assert.deepEqual(map, {});
  cleanDir(dir);
});

test("mineCommits: returns {} when knownIds is empty", () => {
  const dir = tmpDir();
  initRepo(dir);
  emptyCommit(dir, "fix EO-05-001 threshold");
  const map = mineCommits(dir, []);
  assert.deepEqual(map, {});
  cleanDir(dir);
});

test("mineCommits: extracts story IDs from commit messages", () => {
  const dir = tmpDir();
  initRepo(dir);
  emptyCommit(dir, "fix EO-05-001 threshold calculation");
  emptyCommit(dir, "chore: unrelated change");
  emptyCommit(dir, "feat EO-05-002 and EO-06-001 dual story");

  const map = mineCommits(dir, ["EO-05-001", "EO-05-002", "EO-06-001", "EO-07-001"]);

  assert.ok(map["EO-05-001"]?.length >= 1, "EO-05-001 should have 1+ commit entry");
  assert.equal(map["EO-05-001"][0].source, "commit");
  assert.equal(typeof map["EO-05-001"][0].sha, "string");
  assert.equal(map["EO-05-001"][0].sha.length, 7, "sha should be 7-char short hash");
  assert.ok(typeof map["EO-05-001"][0].snippet === "string");

  assert.ok(map["EO-05-002"]?.length >= 1, "EO-05-002 should appear");
  assert.ok(map["EO-06-001"]?.length >= 1, "EO-06-001 should appear");
  assert.equal(map["EO-07-001"], undefined, "EO-07-001 absent from log should be undefined");

  cleanDir(dir);
});

test("mineCommits: does not include story IDs not in knownIds", () => {
  const dir = tmpDir();
  initRepo(dir);
  emptyCommit(dir, "fix EO-99-999 unknown story");
  const map = mineCommits(dir, ["EO-05-001"]);
  assert.equal(map["EO-99-999"], undefined, "unlisted story ID should not appear");
  cleanDir(dir);
});

test("mineCommits: deduplicates same SHA for same story ID", () => {
  const dir = tmpDir();
  initRepo(dir);
  // Only one commit, so the sha appears once even though we call twice via regex global
  emptyCommit(dir, "EO-05-001 EO-05-001 duplicate mention in same commit");
  const map = mineCommits(dir, ["EO-05-001"]);
  assert.equal(map["EO-05-001"].length, 1, "same SHA should be deduped");
  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeEvidenceMaps
// ─────────────────────────────────────────────────────────────────────────────

test("mergeEvidenceMaps: concatenates entries across maps", () => {
  const a = { "EO-01-001": [{ sha: "abc1234", snippet: "commit", source: "commit" }] };
  const b = {
    "EO-01-001": [{ sha: "PR#42", snippet: "PR title", source: "pr" }],
    "EO-02-001": [{ sha: "def5678", snippet: "other",  source: "commit" }]
  };
  const merged = mergeEvidenceMaps(a, b);
  assert.equal(merged["EO-01-001"].length, 2, "two sources for EO-01-001");
  assert.equal(merged["EO-02-001"].length, 1, "one source for EO-02-001");
});

test("mergeEvidenceMaps: handles empty maps without throwing", () => {
  const merged = mergeEvidenceMaps(
    {},
    null,
    undefined,
    { "EO-01-001": [{ sha: "aaa0000", snippet: "x", source: "filename" }] }
  );
  assert.equal(merged["EO-01-001"].length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// scan-repo.js: is_test flag
// ─────────────────────────────────────────────────────────────────────────────

test("scanRepo: is_test=true on .test.js artifacts", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tests", "foo.test.js"), "// test\n");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "main.js"), "// code\n");

  const result = await scanRepo(dir);
  const testArt = result.artifacts.find((a) => a.path.includes("foo.test.js"));
  const codeArt = result.artifacts.find((a) => a.path.includes("main.js"));

  assert.ok(testArt, "test artifact must be found");
  assert.equal(testArt.type, "test");
  assert.equal(testArt.is_test, true, "foo.test.js → is_test should be true");

  assert.ok(codeArt, "code artifact must be found");
  assert.notEqual(codeArt.is_test, true, "main.js should NOT have is_test=true");

  cleanDir(dir);
});

test("scanRepo: is_test=true for files under tests/ directory", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tests", "helper.py"), "# test helper\n");

  const result = await scanRepo(dir);
  const art = result.artifacts.find((a) => a.path.includes("helper.py"));
  assert.ok(art, "must find helper.py");
  assert.equal(art.is_test, true);

  cleanDir(dir);
});

// ─────────────────────────────────────────────────────────────────────────────
// scan-repo.js: implicit_evidence_for from filename
// ─────────────────────────────────────────────────────────────────────────────

test("scanRepo: implicit_evidence_for populated when story ID in filename", async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "tests", "test_EO-05-001_chat.py"),
    "def test_something(): pass\n"   // no EVA-STORY tag in content
  );

  const result = await scanRepo(dir);
  const art = result.artifacts.find((a) => a.path.includes("test_EO-05-001_chat.py"));

  assert.ok(art, "artifact must be found");
  assert.deepEqual(art.implicit_evidence_for, ["EO-05-001"]);
  assert.ok(art.story_tags.includes("EO-05-001"), "story_tags should include the filename ID");

  cleanDir(dir);
});

test("scanRepo: no implicit_evidence_for when filename has no story ID", async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "util.js"), "// generic\n");

  const result = await scanRepo(dir);
  const art = result.artifacts.find((a) => a.path === "util.js");

  assert.ok(art, "artifact must be found");
  assert.equal(art.implicit_evidence_for, undefined,
    "no story ID in filename → implicit_evidence_for must be absent");

  cleanDir(dir);
});

test("scanRepo: implicit_evidence_for excludes IDs already in story_tags (no duplication)", async () => {
  const dir = tmpDir();
  // File that has EVA-STORY tag AND its ID in the filename
  fs.writeFileSync(
    path.join(dir, "EO-05-001-handler.js"),
    "// EVA-STORY: EO-05-001\n// logic\n"
  );

  const result = await scanRepo(dir);
  const art = result.artifacts.find((a) => a.path.includes("EO-05-001-handler.js"));

  assert.ok(art, "artifact must be found");
  // The ID is already in story_tags from content — implicit_evidence_for should be absent
  // because the filter excludes IDs already present in storyTags
  assert.equal(art.implicit_evidence_for, undefined,
    "ID already in story_tags should not appear in implicit_evidence_for");
  assert.ok(art.story_tags.includes("EO-05-001"), "ID should still be in story_tags");

  cleanDir(dir);
});
