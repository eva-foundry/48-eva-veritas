// EVA-STORY: EO-01-001
// EVA-STORY: EO-01-002
// EVA-STORY: EO-01-003
// EVA-STORY: EO-11-003
// EVA-STORY: EO-12-001
// EVA-FEATURE: EO-01
// EVA-FEATURE: EO-11
// EVA-FEATURE: EO-12
"use strict";

const fs = require("fs");
const path = require("path");
const { ensureDir, writeJson, readTextIfExists } = require("./lib/fs-utils");
const {
  parseProjectYaml,
  parseEpicFromReadme,
  parsePlan,
  parseAcceptance,
  parseStatus
} = require("./lib/parse-docs");
const { scanRepo } = require("./lib/scan-repo");
const { mapArtifactsToStories } = require("./lib/map-artifacts");
const { mineCommits, minePRs, mergeEvidenceMaps } = require("./lib/evidence");
const { parseCodeStructure, shouldEnrich } = require("./lib/code-parser");
const { fetchGovernanceFromApi, isApiReachable, GovernanceApiError } = require("./lib/data-model-client");
const { isDegradedModeAllowed } = require("./lib/governance-error");

async function discover(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "discovery.json"));
  ensureDir(path.dirname(outPath));

  console.log(`[INFO] Discovering: ${repoPath}`);

  // ── Governance Source: API-ONLY (FAIL-CLOSED) ──
  // Per Project 37 precedent and Session 42 blocker: no disk fallback, API is source of truth
  const projectId = path.basename(repoPath);
  const apiBase = opts.apiBase || process.env.EVA_API_BASE || undefined;

  // Check if degraded mode is explicitly allowed (dev/troubleshooting only)
  const allowDegraded = isDegradedModeAllowed(opts);

  let plan, acceptance, status, epic, projectYaml, governanceSource;

  // ── API-First (Required) ──
  try {
    console.log(`[INFO] Enforcing API-only governance: querying data model for ${projectId}`);
    const apiReachable = await isApiReachable(apiBase);
    if (!apiReachable) {
      throw new GovernanceApiError(
        `Data model API unreachable at ${apiBase}`,
        {
          operation: "discover_api_health_check",
          endpoint: `${apiBase}/health`,
          policy: "fail_closed"
        }
      );
    }

    const gov = await fetchGovernanceFromApi(projectId, apiBase);
    if (!gov.plan || gov.plan.features.length === 0) {
      // API returned but no WBS data — this is a data integrity issue, fail closed
      throw new GovernanceApiError(
        `No WBS records found for project ${projectId} in data model`,
        {
          operation: "discover_fetch_governance",
          endpoint: `${apiBase}/model/wbs/`,
          policy: "fail_closed"
        }
      );
    }

    plan = gov.plan;
    status = gov.status || { declared: {}, source: "data-model-api" };
    acceptance = gov.acceptance || { criteria: [] };
    epic = gov.epic || { title: projectId, source: "data-model-api" };
    projectYaml = null;
    governanceSource = "data-model-api";
    console.log(`[PASS] Governance from API: ${plan.features.length} features from ${gov.wbs.length} WBS records`);

  } catch (err) {
    // API-only mode: any API error is fatal
    if (err instanceof GovernanceApiError) {
      throw err; // Re-throw governance errors as-is
    }
    // Wrap other errors
    throw new GovernanceApiError(
      `Governance discovery failed: ${err.message}`,
      {
        operation: "discover_governance",
        endpoint: apiBase,
        originalError: err.message,
        policy: "fail_closed"
      }
    );
  }

  // ── Scan Artifacts (local, always succeeds) ──
  const actual = await scanRepo(repoPath);

  console.log(`[INFO] Governance source: ${governanceSource} (API-only, fail-closed)`);
  console.log(`[INFO] Planned: ${plan.features.length} features, ${plan.stories.length} stories`);

  // -- Code complexity analysis (wires dead code-parser into the pipeline) ----
  let code_complexity = null;
  if (shouldEnrich(plan.stories.length, actual.artifacts.length)) {
    try {
      // Derive prefix from repo path (e.g., "07-foundation-layer" -> "F07")
      const dirName = path.basename(repoPath);
      const prefixMatch = dirName.match(/^(\d+)-/);
      const prefix = prefixMatch ? `F${prefixMatch[1]}` : "CS";
      
      code_complexity = parseCodeStructure(repoPath, prefix);
      console.log(`[INFO] Code complexity: ${code_complexity.routes} routes, ${code_complexity.functions} functions across ${code_complexity.files_parsed} files`);
    } catch (e) {
      console.log(`[WARN] code-parser failed (non-fatal): ${e.message}`);
    }
  }

  const storyArtifactMap = mapArtifactsToStories(actual.artifacts);

  console.log(`[INFO] Actual: ${actual.artifacts.length} artifacts, ${Object.keys(storyArtifactMap).length} stories tagged`);

  // Evidence mining: git commits, GitHub PRs, implicit filename IDs
  const knownIds = plan.stories.map((s) => s.id);

  // Filename implicit evidence (already annotated by scan-repo.js)
  const filenameEvidenceMap = {};
  for (const art of actual.artifacts) {
    for (const id of art.implicit_evidence_for || []) {
      if (!filenameEvidenceMap[id]) filenameEvidenceMap[id] = [];
      filenameEvidenceMap[id].push({
        sha: art.path,
        snippet: `filename: ${art.path}`,
        source: "filename"
      });
    }
  }

  const commitMap = mineCommits(repoPath, knownIds);
  const prMap     = await minePRs(repoPath, knownIds);
  const commit_evidence_map = mergeEvidenceMaps(commitMap, prMap, filenameEvidenceMap);

  console.log(`[INFO] Evidence: ${Object.keys(commitMap).length} from commits, ${Object.keys(prMap).length} from PRs, ${Object.keys(filenameEvidenceMap).length} from filenames`);

  // ── COMPONENT 1: Quality Gates Discovery (L34 integration - FAIL-CLOSED) ──
  const { getQualityGates } = require("./lib/data-model-client");
  let qualityGates = [];
  let effectiveMtiThreshold = 70; // fallback (used if no gates defined)
  try {
    const gatesRes = await getQualityGates(projectId, apiBase);
    if (!gatesRes.ok) {
      throw new GovernanceApiError(
        `Cannot query quality gates: ${gatesRes.error}`,
        {
          operation: "discover_quality_gates",
          endpoint: `${apiBase}/model/quality_gates/`,
          policy: "fail_closed"
        }
      );
    }
    if (gatesRes.data && gatesRes.data.length > 0) {
      const mtiGates = gatesRes.data.filter(g => g.status === "active" && g.gate_metric === "mti_score");
      if (mtiGates.length > 0) {
        qualityGates = mtiGates.map(g => ({
          id: g.id,
          threshold: g.threshold,
          applies_to: g.applies_to || [],
          custom_weights: g.custom_weights || null,
          minimum_allowed_mti: g.minimum_allowed_mti || null,
          maximum_allowed_mti: g.maximum_allowed_mti || null
        }));
        effectiveMtiThreshold = mtiGates[0].threshold;
        console.log(`[GATE] Detected ${qualityGates.length} active MTI gate(s), threshold=${effectiveMtiThreshold}`);
      }
    }
  } catch (err) {
    if (err instanceof GovernanceApiError) {
      throw err;
    }
    throw new GovernanceApiError(
      `Quality gates query failed: ${err.message}`,
      {
        operation: "discover_quality_gates",
        endpoint: apiBase,
        originalError: err.message,
        policy: "fail_closed"
      }
    );
  }

  const discovery = {
    meta: {
      schema: "eva.discovery.v3",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      governance_source: governanceSource,
      quality_gates: {
        detected_count: qualityGates.length,
        gates: qualityGates,
        effective_mti_threshold: effectiveMtiThreshold
      }
    },
    project: projectYaml?.project || projectYaml || null,
    planned: {
      epic,
      features: plan.features,
      stories: plan.stories,
      tasks: plan.tasks || [],
      acceptance: acceptance.criteria,
      declared_status: status.declared
    },
    actual: {
      artifacts: actual.artifacts,
      story_artifact_map: storyArtifactMap,
      commit_evidence_map,
      code_complexity
    }
  };

  writeJson(outPath, discovery);
  console.log(`[PASS] discovery written: ${outPath}`);
}

module.exports = { discover };
