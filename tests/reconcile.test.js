// tests/reconcile.test.js
// A5 -- QA: Reconciliation + Feature Breakdown tests (Batch 2)
// Runner: node --test tests/reconcile.test.js
"use strict";

const { test } = require("node:test");
const assert  = require("node:assert/strict");
const path    = require("node:path");
const fs      = require("node:fs");
const os      = require("node:os");

const { reconcile } = require("../src/reconcile");

// ── Fixture Helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(discovery) {
  const dir    = fs.mkdtempSync(path.join(os.tmpdir(), "veritas-b2-"));
  const evaDir = path.join(dir, ".eva");
  fs.mkdirSync(evaDir);
  fs.writeFileSync(path.join(evaDir, "discovery.json"), JSON.stringify(discovery), "utf8");
  return dir;
}

function makeDiscovery({ features = [], stories = [], storyMap = {}, declared = {} } = {}) {
  return {
    project: "test",
    planned: {
      epic:            { title: "Test Epic" },
      features,
      stories,
      tasks:           [],
      acceptance:      [],
      declared_status: declared
    },
    actual: { story_artifact_map: storyMap, artifacts: [] }
  };
}

function readRecon(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".eva", "reconciliation.json"), "utf8"));
}

// ── VP-A4: features[] Array ─────────────────────────────────────────────────────

test("VP-A4: reconciliation.json includes features[] array", async () => {
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "F-01", title: "Feature One" }],
    stories:  [
      { id: "F-01-001", title: "Story 1", feature_id: "F-01" },
      { id: "F-01-002", title: "Story 2", feature_id: "F-01" }
    ],
    storyMap: {
      "F-01-001": { artifacts: [{ path: "foo.js", type: "source" }] }
    }
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  assert.ok(Array.isArray(out.features),    "features must be an array");
  assert.equal(out.features.length, 1,      "one feature");
  assert.equal(out.features[0].id,              "F-01");
  assert.equal(out.features[0].story_count,     2);
  assert.equal(out.features[0].stories_with_artifacts, 1);
  assert.equal(out.features[0].gap_count,       1);
  fs.rmSync(dir, { recursive: true });
});

test("VP-A4: per-feature MTI is 0 when no artifacts and no STATUS entries", async () => {
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "G-01", title: "Empty Feature" }],
    stories:  [{ id: "G-01-001", title: "Story A", feature_id: "G-01" }],
    storyMap: {}
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  assert.equal(out.features[0].mti, 0);
  fs.rmSync(dir, { recursive: true });
});

test("VP-A4: per-feature MTI is 50 with 100% coverage, 0 evidence, 0 consistency", async () => {
  // coverage=1.0*0.5 + evidence=0*0.2 + consistency=0*0.3 = 50
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "H-01", title: "Covered Feature" }],
    stories:  [{ id: "H-01-001", title: "Story 1", feature_id: "H-01" }],
    storyMap: {
      "H-01-001": { artifacts: [{ path: "a.js", type: "source" }] }
    }
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  assert.equal(out.features[0].mti, 50, "100% coverage, 0 evidence, 0 consistency = MTI 50");
  fs.rmSync(dir, { recursive: true });
});

test("VP-A4: per-feature MTI is 100 when fully covered with evidence and consistency", async () => {
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "I-01", title: "Perfect Feature" }],
    stories:  [{ id: "I-01-001", title: "S", feature_id: "I-01" }],
    storyMap: {
      "I-01-001": { artifacts: [{ path: "a.js", type: "evidence" }] }
    },
    declared: { "STORY:I-01-001": "Done" }
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  // coverage=1.0*0.5=50; evidence=1.0*0.2=20; consistency=1.0*0.3=30 -> 100
  assert.equal(out.features[0].mti, 100);
  fs.rmSync(dir, { recursive: true });
});

test("VP-A4: features[] sorted highest gap_count first", async () => {
  const dir = makeTmpDir(makeDiscovery({
    features: [
      { id: "A-01", title: "Mostly done" },
      { id: "A-02", title: "All missing" }
    ],
    stories: [
      { id: "A-01-001", title: "Done story",  feature_id: "A-01" },
      { id: "A-02-001", title: "Missing 1",   feature_id: "A-02" },
      { id: "A-02-002", title: "Missing 2",   feature_id: "A-02" }
    ],
    storyMap: {
      "A-01-001": { artifacts: [{ path: "a.js", type: "source" }] }
    }
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  assert.equal(out.features[0].id,        "A-02", "highest gap feature must come first");
  assert.equal(out.features[0].gap_count, 2);
  assert.equal(out.features[1].gap_count, 0);
  fs.rmSync(dir, { recursive: true });
});

test("coverage top-level object still present alongside features[]", async () => {
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "C-01", title: "F" }],
    stories:  [{ id: "C-01-001", title: "S", feature_id: "C-01" }],
    storyMap: {}
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  assert.ok(out.coverage,                            "coverage object must still exist");
  assert.ok(typeof out.coverage.stories_total === "number");
  assert.ok(Array.isArray(out.features),             "features[] must exist alongside coverage");
  fs.rmSync(dir, { recursive: true });
});

test("schema version updated to v2", async () => {
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "V-01", title: "Version check" }],
    stories:  [{ id: "V-01-001", title: "S", feature_id: "V-01" }],
    storyMap: {}
  }));
  await reconcile({ repo: dir });
  const out = readRecon(dir);
  assert.equal(out.meta.schema, "eva.reconciliation.v2");
  fs.rmSync(dir, { recursive: true });
});

// ── Trust Sparkline (VP-A6) ─────────────────────────────────────────────────────

test("VP-A6: trust-history.json written with at least 1 run after compute-trust", async () => {
  const { computeTrust } = require("../src/compute-trust");
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "T-01", title: "Trust test" }],
    stories:  [{ id: "T-01-001", title: "S", feature_id: "T-01" }],
    storyMap: {}
  }));
  await reconcile({ repo: dir });
  await computeTrust({ repo: dir });
  const histPath = path.join(dir, ".eva", "trust-history.json");
  assert.ok(fs.existsSync(histPath), "trust-history.json must exist after compute-trust");
  const hist = JSON.parse(fs.readFileSync(histPath, "utf8"));
  assert.ok(Array.isArray(hist.runs) && hist.runs.length >= 1, "at least 1 run in history");
  assert.ok(typeof hist.runs[0].score === "number", "run must have numeric score");
  fs.rmSync(dir, { recursive: true });
});

test("VP-A6: trust.json includes sparkline field after two runs", async () => {
  const { computeTrust } = require("../src/compute-trust");
  const dir = makeTmpDir(makeDiscovery({
    features: [{ id: "U-01", title: "Sparkline test" }],
    stories:  [{ id: "U-01-001", title: "S", feature_id: "U-01" }],
    storyMap: {}
  }));
  await reconcile({ repo: dir });
  await computeTrust({ repo: dir });
  await computeTrust({ repo: dir }); // second run to create a -> trend
  const trust = JSON.parse(fs.readFileSync(path.join(dir, ".eva", "trust.json"), "utf8"));
  assert.ok(typeof trust.sparkline === "string",       "sparkline must be a string");
  assert.ok(trust.sparkline.includes("->"),            "sparkline must contain '->' after 2 runs");
  assert.ok(typeof trust.sparkline_delta === "string", "sparkline_delta must be a string");
  fs.rmSync(dir, { recursive: true });
});
