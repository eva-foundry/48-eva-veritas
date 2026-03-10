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
const { fetchGovernanceFromApi, isApiReachable } = require("./lib/data-model-client");

async function discover(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "discovery.json"));
  ensureDir(path.dirname(outPath));

  console.log(`[INFO] Discovering: ${repoPath}`);

  // ── Data source resolution: API-first with filesystem fallback ──
  const projectId = path.basename(repoPath);
  const apiBase = opts.apiBase || process.env.EVA_API_BASE || undefined;
  const useApi = opts.source !== "disk"; // default: try API first

  let plan, acceptance, status, epic, projectYaml, governanceSource;

  if (useApi) {
    const apiReachable = await isApiReachable(apiBase);
    if (apiReachable) {
      console.log(`[INFO] API-first mode: querying data model for ${projectId}`);
      const gov = await fetchGovernanceFromApi(projectId, apiBase);

      if (gov.plan && gov.plan.features.length > 0) {
        plan = gov.plan;
        status = gov.status || { declared: {}, source: "data-model-api" };
        acceptance = gov.acceptance || { criteria: [] };
        epic = gov.epic || { title: projectId, source: "data-model-api" };
        projectYaml = null;
        governanceSource = "data-model-api";
        console.log(`[INFO] Governance from API: ${plan.features.length} features from ${gov.wbs.length} WBS records`);
      } else {
        console.log(`[INFO] API returned empty WBS for ${projectId} — falling back to disk`);
        governanceSource = "disk-fallback";
      }
    } else {
      console.log(`[INFO] API unreachable — falling back to disk`);
      governanceSource = "disk-fallback";
    }
  } else {
    governanceSource = "disk";
  }

  // ── Filesystem fallback (original behavior) ──
  if (!governanceSource || governanceSource.includes("disk")) {
    projectYaml = parseProjectYaml(repoPath);
    epic = parseEpicFromReadme(repoPath);

  // Prefer .eva/veritas-plan.json (agent-generated) over raw PLAN.md parsing
  const veritasPlanPath = path.join(repoPath, ".eva", "veritas-plan.json");
  if (fs.existsSync(veritasPlanPath)) {
    try {
      const vp = JSON.parse(fs.readFileSync(veritasPlanPath, "utf8"));
      // Flatten nested features[].stories[] into flat features[] + stories[]
      const features = (vp.features || []).map((f) => ({
        id: f.id,
        title: f.title,
        source: "veritas-plan.json",
      }));
      const stories = (vp.features || []).flatMap((f) =>
        (f.stories || []).map((s) => ({
          id: s.id,
          title: s.title,
          feature_id: f.id,
          done: s.done,
          source: "veritas-plan.json",
        }))
      ).concat(
        (vp._orphan_stories || []).map((s) => ({ ...s, source: "veritas-plan.json" }))
      );
      // Extract tasks (not scored, but used for ADO CSV)
      const planTasks = (vp.features || []).flatMap((f) =>
        (f.stories || []).flatMap((s) =>
          (s.tasks || []).map((t) => ({
            id: t.id,
            title: t.title,
            story_id: s.id,
            feature_id: f.id,
            done: t.done,
            source: "veritas-plan.json",
          }))
        )
      ).concat(
        (vp._orphan_tasks || []).map((t) => ({ ...t, source: "veritas-plan.json" }))
      );
      plan = { features, stories, tasks: planTasks, _source: "veritas-plan.json", _format: vp.format_detected };
      console.log(`[INFO] Using veritas-plan.json (format: ${vp.format_detected || "unknown"}, ${stories.length} stories, ${planTasks.length} tasks)`);
    } catch (e) {
      console.log(`[WARN] veritas-plan.json parse error: ${e.message} — falling back to PLAN.md`);
      plan = parsePlan(repoPath);
    }
  } else {
    plan = parsePlan(repoPath);
  }

    acceptance = parseAcceptance(repoPath);
    status = parseStatus(repoPath);
    governanceSource = governanceSource || "disk";
  } // end filesystem fallback block

  console.log(`[INFO] Governance source: ${governanceSource}`);
  console.log(`[INFO] Planned: ${plan.features.length} features, ${plan.stories.length} stories`);

  const actual = await scanRepo(repoPath);

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

  const discovery = {
    meta: {
      schema: "eva.discovery.v3",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      governance_source: governanceSource
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
