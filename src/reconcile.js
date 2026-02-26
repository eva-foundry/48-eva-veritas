// EVA-STORY: EO-02-001
// EVA-STORY: EO-02-002
// EVA-STORY: EO-02-003
// EVA-FEATURE: EO-02
"use strict";

const path = require("path");
const { readJsonIfExists, writeJson, ensureDir } = require("./lib/fs-utils");

function unique(arr) {
  return [...new Set(arr)];
}

async function reconcile(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const inPath = path.resolve(opts.in || path.join(repoPath, ".eva", "discovery.json"));
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "reconciliation.json"));
  ensureDir(path.dirname(outPath));

  const discovery = readJsonIfExists(inPath);
  if (!discovery) {
    throw new Error(`discovery.json not found at ${inPath}. Run: eva discover`);
  }

  const plannedStories = discovery.planned?.stories || [];
  const acceptance = discovery.planned?.acceptance || [];
  const storyMap = discovery.actual?.story_artifact_map || {};
  const evidenceMap = discovery.actual?.commit_evidence_map || {};

  const stories_total = plannedStories.length;

  const stories_with_artifacts = plannedStories.filter(
    (s) => (storyMap[s.id]?.artifacts?.length || 0) > 0
  ).length;

  const stories_with_evidence = plannedStories.filter((s) => {
    const arts = storyMap[s.id]?.artifacts || [];
    return arts.some((a) => a.type === "evidence")     // explicit evidence/ dir
        || arts.some((a) => a.is_test === true)         // test file with story tag
        || (evidenceMap[s.id]?.length || 0) > 0;        // commit, PR, or filename
  }).length;

  // Consistency: penalise stories where STATUS declares >= 20% progress but no artifacts
  const declared = discovery.planned?.declared_status || {};
  let penalties = 0;
  let checks = 0;

  for (const s of plannedStories) {
    const key = `STORY:${s.id}`;
    const decl = declared[key];
    if (!decl) continue;

    const hasArtifacts = (storyMap[s.id]?.artifacts?.length || 0) > 0;
    checks += 1;

    const percent = parsePercent(decl);
    if (percent !== null && percent >= 20 && !hasArtifacts) penalties += 1;
  }

  // VP-A1: checks===0 means no STATUS.md entries -> no consistency data -> score 0, not 1.
  // Previous value of 1 caused MTI floor of 30 on completely untagged repos.
  const consistency_score = checks === 0 ? 0 : Math.max(0, 1 - penalties / checks);

  const gaps = [];

  for (const s of plannedStories) {
    const hasArtifacts = (storyMap[s.id]?.artifacts?.length || 0) > 0;
    if (!hasArtifacts) {
      gaps.push({ type: "missing_implementation", story_id: s.id, title: s.title });
      continue;
    }
    const hasEvidence =
      (storyMap[s.id]?.artifacts || []).some((a) => a.type === "evidence")
      || (storyMap[s.id]?.artifacts || []).some((a) => a.is_test === true)
      || (evidenceMap[s.id]?.length || 0) > 0;
    if (!hasEvidence && acceptance.some((c) => c.story_id === s.id)) {
      gaps.push({ type: "missing_evidence", story_id: s.id, title: s.title });
    }
  }

  // Orphan artifacts: tagged story IDs not in PLAN
  const plannedIds = new Set(plannedStories.map((s) => s.id));
  const actualTaggedIds = unique(Object.keys(storyMap));
  const orphans = actualTaggedIds.filter((id) => !plannedIds.has(id));

  for (const oid of orphans) {
    gaps.push({ type: "orphan_story_tag", story_id: oid, title: null });
  }

  // VP-A4: per-feature MTI breakdown
  const features = buildFeatureBreakdown(
    plannedStories, storyMap, discovery.planned?.features || [], declared, evidenceMap
  );

  const reconciliation = {
    meta: {
      schema: "eva.reconciliation.v2",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      discovery_path: inPath
    },
    coverage: {
      stories_total,
      stories_with_artifacts,
      stories_with_evidence,
      consistency_score
    },
    features,
    gaps
  };

  writeJson(outPath, reconciliation);
  console.log(`[PASS] reconciliation written: ${outPath}`);
  console.log(`[INFO] Gaps: ${gaps.length}`);
}

const STATUS_PERCENT = {
  done: 100, complete: 100, completed: 100,
  "in progress": 50, "in-progress": 50, active: 50,
  blocked: 10,
  "not started": 0, planned: 0
};

function parsePercent(s) {
  const str = String(s ?? "").trim();
  // Numeric percentage e.g. "80%"
  const m = /(\d+)\s*%/.exec(str);
  if (m) {
    const n = Number(m[1]);
    return Number.isNaN(n) ? null : n;
  }
  // Text status e.g. "Done", "In Progress"
  const key = str.toLowerCase();
  if (key in STATUS_PERCENT) return STATUS_PERCENT[key];
  return null;
}

// VP-A4: compute per-feature MTI breakdown
function buildFeatureBreakdown(stories, storyMap, features, declared, evidenceMap = {}) {
  const featureMap = {};
  for (const f of features) {
    featureMap[f.id] = {
      id: f.id, title: f.title,
      story_count: 0, stories_with_artifacts: 0, stories_with_evidence: 0,
      consistency_score: 0, mti: 0, gap_count: 0
    };
  }
  for (const s of stories) {
    const fid = s.feature_id || "unknown";
    if (!featureMap[fid]) {
      featureMap[fid] = {
        id: fid, title: fid,
        story_count: 0, stories_with_artifacts: 0, stories_with_evidence: 0,
        consistency_score: 0, mti: 0, gap_count: 0
      };
    }
    const feat = featureMap[fid];
    feat.story_count += 1;
    const arts = storyMap[s.id]?.artifacts || [];
    if (arts.length > 0) feat.stories_with_artifacts += 1; else feat.gap_count += 1;
    if (
      arts.some((a) => a.type === "evidence")
      || arts.some((a) => a.is_test === true)
      || (evidenceMap[s.id]?.length || 0) > 0
    ) feat.stories_with_evidence += 1;
  }
  for (const feat of Object.values(featureMap)) {
    const fStories = stories.filter((s) => (s.feature_id || "unknown") === feat.id);
    let fChecks = 0, fPenalties = 0;
    for (const s of fStories) {
      const decl = declared[`STORY:${s.id}`];
      if (!decl) continue;
      fChecks += 1;
      const pct = parsePercent(decl);
      const hasArts = (storyMap[s.id]?.artifacts?.length || 0) > 0;
      if (pct !== null && pct >= 20 && !hasArts) fPenalties += 1;
    }
    const cons = fChecks === 0 ? 0 : Math.max(0, 1 - fPenalties / fChecks);
    feat.consistency_score = Math.round(cons * 100) / 100;
    feat.mti = feat.story_count === 0 ? 0
      : Math.round((
          feat.stories_with_artifacts / feat.story_count * 0.5
        + feat.stories_with_evidence / feat.story_count * 0.2
        + cons * 0.3
        ) * 100);
  }
  return Object.values(featureMap).sort(
    (a, b) => b.gap_count - a.gap_count || a.id.localeCompare(b.id)
  );
}

module.exports = { reconcile };
