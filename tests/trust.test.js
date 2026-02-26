// tests/trust.test.js
// A5 -- QA: Scoring Engine test suite (Batch 1)
// Runner: node --test tests/trust.test.js  (Node 18+ built-in test runner)
//
// Critical contract: MTI floor fix (VP-A1 + VP-A2)
// Before fix: repo with no STATUS.md entries produced consistency=1.0 -> MTI=30
// After fix:  same repo produces consistency=0.0 -> MTI=0

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeTrustScore } = require("../src/lib/trust");

// ── Helper ──────────────────────────────────────────────────────────────────────

/**
 * Build a minimal reconciliation object for testing.
 * All params default to 0.
 */
function makeRecon({ total = 0, withArtifacts = 0, withEvidence = 0, consistency = 0 } = {}) {
  return {
    coverage: {
      stories_total: total,
      stories_with_artifacts: withArtifacts,
      stories_with_evidence: withEvidence,
      consistency_score: consistency
    }
  };
}

// ── Ungoverned (0 stories) ──────────────────────────────────────────────────────

test("VP-A2: empty repo (0 stories) -> score 0, not null, ungoverned true", () => {
  const result = computeTrustScore(makeRecon());
  assert.equal(result.score, 0,           "score must be 0 (not null) so comparisons work");
  assert.equal(result.ungoverned, true,   "ungoverned flag must be set");
});

test("VP-A2: null/undefined recon -> score 0, ungoverned true", () => {
  const result = computeTrustScore(null);
  assert.equal(result.score, 0);
  assert.equal(result.ungoverned, true);
});

// ── MTI floor fix (the regression test) ────────────────────────────────────────

test("VP-A1+A2 REGRESSION: plan with stories, 0 tags, no STATUS.md -> MTI 0 (was 30)", () => {
  // Simulates EVA-JP-v1.2 'before' state:
  // - Plan has stories (total > 0)
  // - No tags in source files => 0 artifacts => coverage=0, evidence=0
  // - No STATUS.md declared_status entries => consistency=0 (after fix; was 1.0 before)
  const result = computeTrustScore(makeRecon({ total: 10, withArtifacts: 0, withEvidence: 0, consistency: 0 }));
  assert.equal(result.score, 0,
    `MTI should be 0 when coverage=0, evidence=0, consistency=0. Got ${result.score}. ` +
    "If this is 30, the floor fix in reconcile.js (checks === 0 ? 0 :) did not land.");
  assert.equal(result.ungoverned, false, "project with a plan is not ungoverned");
});

// ── Formula assertions ──────────────────────────────────────────────────────────
// MTI = coverage*0.5 + evidenceCompleteness*0.2 + consistencyScore*0.3 (all 0..1) * 100

test("50% coverage, 0 evidence, 0 consistency -> MTI 25", () => {
  // coverage=0.5*0.5=0.25; evidence=0; consistency=0; total=25
  const result = computeTrustScore(makeRecon({ total: 10, withArtifacts: 5, withEvidence: 0, consistency: 0 }));
  assert.equal(result.score, 25);
});

test("0 coverage, 100% evidence, 0 consistency -> MTI 20", () => {
  // evidenceCompleteness=1.0*0.2=0.20; total=20
  const result = computeTrustScore(makeRecon({ total: 10, withArtifacts: 0, withEvidence: 10, consistency: 0 }));
  assert.equal(result.score, 20);
});

test("0 coverage, 0 evidence, 100% consistency -> MTI 30", () => {
  // Before the floor fix this was the default (consistency=1.0 for free).
  // Now it only reaches 30 if consistency is EXPLICITLY 1.0.
  const result = computeTrustScore(makeRecon({ total: 10, withArtifacts: 0, withEvidence: 0, consistency: 1 }));
  assert.equal(result.score, 30);
});

test("100% coverage, 100% evidence, 100% consistency -> MTI 100", () => {
  const result = computeTrustScore(makeRecon({ total: 10, withArtifacts: 10, withEvidence: 10, consistency: 1 }));
  assert.equal(result.score, 100);
  assert.equal(result.ungoverned, false);
});

test("50% coverage, 50% evidence, 50% consistency -> MTI 50", () => {
  // 0.5*0.5 + 0.5*0.2 + 0.5*0.3 = 0.25 + 0.10 + 0.15 = 0.50 -> 50
  const result = computeTrustScore(makeRecon({ total: 10, withArtifacts: 5, withEvidence: 5, consistency: 0.5 }));
  assert.equal(result.score, 50);
});

test("100% coverage, 0 evidence, 0 consistency -> MTI 50", () => {
  // coverage=1.0*0.5=50; rest=0
  const result = computeTrustScore(makeRecon({ total: 5, withArtifacts: 5, withEvidence: 0, consistency: 0 }));
  assert.equal(result.score, 50);
});

// ── Component shape ─────────────────────────────────────────────────────────────

test("result includes components object for governed project", () => {
  const result = computeTrustScore(makeRecon({ total: 4, withArtifacts: 2, withEvidence: 1, consistency: 0.5 }));
  assert.ok(typeof result.components === "object", "components must be an object");
  assert.ok("coverage" in result.components,            "components.coverage must exist");
  assert.ok("evidenceCompleteness" in result.components,"components.evidenceCompleteness must exist");
  assert.ok("consistencyScore" in result.components,    "components.consistencyScore must exist");
});

test("components.coverage is proportional to withArtifacts/total", () => {
  const result = computeTrustScore(makeRecon({ total: 8, withArtifacts: 4, withEvidence: 0, consistency: 0 }));
  assert.equal(result.components.coverage, 0.5);
});

// ── Boundary / edge cases ────────────────────────────────────────────────────────

test("consistency clamped to 1 (cannot exceed 100%)", () => {
  const result = computeTrustScore(makeRecon({ total: 5, withArtifacts: 5, withEvidence: 5, consistency: 2.0 }));
  assert.equal(result.score, 100, "consistency > 1.0 should be clamped, not inflate score beyond 100");
});

test("consistency clamped to 0 (cannot go negative)", () => {
  const result = computeTrustScore(makeRecon({ total: 5, withArtifacts: 5, withEvidence: 5, consistency: -0.5 }));
  // coverage=1.0*0.5=50; evidence=1.0*0.2=20; consistency=0*0.3=0 -> 70
  assert.equal(result.score, 70);
});
