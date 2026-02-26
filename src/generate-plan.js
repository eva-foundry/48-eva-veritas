// EVA-STORY: EO-11-002
// EVA-FEATURE: EO-11
"use strict";

/**
 * generate-plan.js
 *
 * Reads a project's existing documentation in any format and writes
 * .eva/veritas-plan.json — a structured decomposition that veritas
 * can read without any changes to PLAN.md.
 *
 * Supported sources (auto-detected, best wins):
 *   - docs/YYYYMMDD-plan.md  (latest dated plan)
 *   - PLAN.md                (any format: veritas native, Phase/Sprint, free-form)
 *   - README.md              (fallback)
 *
 * Output schema: eva.veritas-plan.v1
 *
 * Usage:
 *   eva generate-plan --repo <path> [--prefix F33] [--out custom/path.json] [--sync-model]
 */

const path = require("path");
const fs = require("fs");
const { inferPlan, derivePrefix } = require("./lib/infer-plan");
const { ensureDir, writeJson } = require("./lib/fs-utils");
const { parseCodeStructure } = require("./lib/code-parser");
const { parseOpenApi } = require("./lib/openapi-parser");
const { importAdoCsv } = require("./lib/ado-import");
const fg = require("fast-glob");

const ENRICH_IGNORE = [
  "**/node_modules/**", "**/.git/**", "**/.eva/**",
  "**/dist/**", "**/build/**", "**/.venv/**", "**/__pycache__/**"
];

// ── Optional data model sync ──────────────────────────────────────────────────

async function syncToDataModel(repoPath, plan) {
  const projectFolder = path.basename(path.resolve(repoPath));
  const projectId = projectFolder;
  const apiBase = process.env.EVA_DATA_MODEL_URL || "http://localhost:8010";

  // Use native fetch (Node 18+) or gracefully degrade
  const fetchFn = typeof fetch !== "undefined" ? fetch : null;
  if (!fetchFn) {
    console.log("[WARN] fetch not available (Node < 18) — skipping data model sync");
    return;
  }

  try {
    const health = await fetchFn(`${apiBase}/health`).catch(() => null);
    if (!health || !health.ok) {
      console.log(`[WARN] Data model API not reachable at ${apiBase} — skipping sync`);
      return;
    }

    const getResp = await fetchFn(`${apiBase}/model/projects/${projectId}`);
    if (!getResp.ok) {
      console.log(`[WARN] Project "${projectId}" not found in data model — skipping sync`);
      return;
    }

    const project = await getResp.json();

    const totalStories = (plan.features || []).reduce((sum, f) => sum + (f.stories || []).length, 0);
    const planNote = `[veritas-plan] ${plan.features.length} features, ${totalStories} stories. Generated ${plan.generated_at.slice(0, 10)} from: ${plan.generated_from.join(", ")}`;
    const existingNotes = project.notes || "";
    const cleanedNotes = existingNotes.replace(/\[veritas-plan\][^\n]*/g, "").trim();
    project.notes = cleanedNotes ? `${cleanedNotes}\n${planNote}` : planNote;

    const auditCols = ["obj_id", "layer", "modified_by", "modified_at", "created_by", "created_at", "row_version", "source_file"];
    const body = Object.fromEntries(Object.entries(project).filter(([k]) => !auditCols.includes(k)));

    const putResp = await fetchFn(`${apiBase}/model/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Actor": "agent:veritas" },
      body: JSON.stringify(body),
    });

    if (putResp.ok) {
      const updated = await putResp.json();
      console.log(`[PASS] Data model updated: project "${projectId}" row_version=${updated.row_version}`);
    } else {
      const err = await putResp.text();
      console.log(`[WARN] Data model PUT failed (${putResp.status}): ${err.slice(0, 120)}`);
    }

    // B5-04: Register each story as a work item if not already present
    let putCount = 0;
    let skipCount = 0;
    for (const f of plan.features || []) {
      for (const s of f.stories || []) {
        if (!s.id) continue;
        try {
          const checkResp = await fetchFn(`${apiBase}/model/work_items/${encodeURIComponent(s.id)}`);
          if (checkResp.ok) {
            skipCount++;
            continue; // already registered
          }
          const wiBody = JSON.stringify({
            id: s.id,
            title: s.title || s.id,
            feature_id: f.id || null,
            source: "veritas",
            is_active: true
          });
          const wiPut = await fetchFn(`${apiBase}/model/work_items/${encodeURIComponent(s.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Actor": "agent:veritas" },
            body: wiBody
          });
          if (wiPut.ok) putCount++;
        } catch (_) { /* non-fatal -- work_items layer may not exist */ }
      }
    }
    if (putCount > 0 || skipCount > 0) {
      console.log(`[INFO] Work items: ${putCount} registered, ${skipCount} already present`);
    }
  } catch (err) {
    console.log(`[WARN] Data model sync error: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function generatePlan(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const prefix = opts.prefix || derivePrefix(repoPath);
  const outPath = path.resolve(
    opts.out || path.join(repoPath, ".eva", "veritas-plan.json"),
  );

  ensureDir(path.dirname(outPath));

  console.log(`[INFO] generate-plan: ${repoPath}`);
  console.log(`[INFO] Prefix: ${prefix}`);

  // ── ADO Import (alternative to doc inference) ─────────────────────────
  let inferred;
  if (opts.adoImport) {
    const csvPath = path.resolve(opts.adoImport);
    console.log(`[INFO] Importing from ADO CSV: ${csvPath}`);
    const ado = importAdoCsv(csvPath);
    inferred = {
      features: ado.features,
      stories:  ado.stories,
      tasks:    ado.tasks,
      generated_from: [csvPath],
      format_detected: "ado-csv",
    };
    if (ado.features.length === 0) {
      console.log("[WARN] No features found in ADO CSV. Check that the file contains Feature rows.");
    }
  } else {
    // ── Infer from docs ──────────────────────────────────────────────────
    inferred = inferPlan(repoPath, { prefix });

    if (inferred.features.length === 0) {
      console.log("[WARN] No features detected.");
      console.log("[HINT] Make sure PLAN.md or README.md contains ## headings.");
      console.log("[HINT] Phase/Sprint headings are supported: ## Phase 1 - Title");
    }
  } // end else (doc inference)

  // ── Build veritas-plan.json ────────────────────────────────────────────
  // Index tasks by story_id for nesting
  const tasksByStory = new Map();
  const orphanTasks = [];
  for (const t of inferred.tasks) {
    if (t.story_id) {
      if (!tasksByStory.has(t.story_id)) tasksByStory.set(t.story_id, []);
      tasksByStory.get(t.story_id).push(t);
    } else {
      orphanTasks.push(t);
    }
  }

  // Nest stories (+ their tasks) under features
  const featureMap = new Map(inferred.features.map((f) => [f.id, { ...f, stories: [] }]));
  const orphanStories = [];

  for (const s of inferred.stories) {
    const storyWithTasks = { ...s, tasks: tasksByStory.get(s.id) || [] };
    if (s.feature_id && featureMap.has(s.feature_id)) {
      featureMap.get(s.feature_id).stories.push(storyWithTasks);
    } else {
      orphanStories.push(storyWithTasks);
    }
  }

  // ── OpenAPI enrichment (always probe; silent if no spec) ──────────────
  const enrichSources = [];
  const oa = parseOpenApi(repoPath, prefix);
  if (oa.stories.length > 0) {
    for (const f of oa.features) {
      if (!featureMap.has(f.id)) featureMap.set(f.id, { ...f, stories: [] });
    }
    for (const s of oa.stories) {
      const st = { ...s, tasks: [] };
      if (s.feature_id && featureMap.has(s.feature_id)) featureMap.get(s.feature_id).stories.push(st);
      else orphanStories.push(st);
    }
    enrichSources.push(`openapi (${oa.stories.length} stories, ${oa.specPath})`);
  }

  // ── Code-structure enrichment (when plan is thin or forced) ──────────
  const planStoryCount = inferred.stories.length;
  if (opts.enrich === true || planStoryCount < 20) {
    const sourceFiles = await fg(
      ["**/*.{py,js,ts,tsx,jsx,go,rs,cs,java,sh,tf}"],
      { cwd: repoPath, ignore: ENRICH_IGNORE, onlyFiles: true, suppressErrors: true }
    );
    if (opts.enrich === true || sourceFiles.length > 100) {
      const cp = await parseCodeStructure(repoPath, prefix);
      if (cp.stories.length > 0) {
        for (const f of cp.features) {
          if (!featureMap.has(f.id)) featureMap.set(f.id, { ...f, stories: [] });
        }
        for (const s of cp.stories) {
          const st = { ...s, tasks: [] };
          if (s.feature_id && featureMap.has(s.feature_id)) featureMap.get(s.feature_id).stories.push(st);
          else orphanStories.push(st);
        }
        enrichSources.push(`code-structure (${cp.stories.length} stories)`);
      }
    }
  }

  if (enrichSources.length > 0) {
    console.log(`[INFO] Enrichment applied: ${enrichSources.join(", ")}`);
  }

  const plan = {
    schema: "eva.veritas-plan.v1",
    generated_at: new Date().toISOString(),
    generated_from: inferred.generated_from,
    format_detected: inferred.format_detected,
    prefix,
    features: Array.from(featureMap.values()),
  };

  if (orphanStories.length > 0) plan._orphan_stories = orphanStories;
  if (orphanTasks.length > 0) plan._orphan_tasks = orphanTasks;

  writeJson(outPath, plan);

  // ── Summary ────────────────────────────────────────────────────────────
  const totalStories = inferred.stories.length;
  const totalTasks = inferred.tasks.length;
  const orphanStoryCount = orphanStories.length;
  console.log(`[PASS] Written: ${outPath}`);
  console.log(
    `       ${plan.features.length} features, ${totalStories} stories, ${totalTasks} tasks (${orphanStoryCount} story orphans)`,
  );
  console.log(`       Sources: ${inferred.generated_from.join(", ") || "none"}`);
  console.log(`       Format detected: ${inferred.format_detected}`);
  console.log("");

  if (plan.features.length > 0) {
    const colW = Math.max(...plan.features.map((f) => f.id.length), 6);
    console.log(`  ${"+ID".padEnd(colW)}  Stories  Tasks  Title`);
    console.log(`  ${"─".repeat(colW)}  ───────  ─────  ─────────────────────────────`);
    for (const f of plan.features) {
      const tc = f.stories.reduce((sum, s) => sum + (s.tasks || []).length, 0);
      const sc = String(f.stories.length).padStart(7);
      const tcc = String(tc).padStart(5);
      console.log(`  ${f.id.padEnd(colW)}  ${sc}  ${tcc}  ${f.title}`);
    }
    console.log("");
  }

  // ── Data model sync ────────────────────────────────────────────────────
  if (opts.syncModel) {
    await syncToDataModel(repoPath, plan);
  }

  // ── Next steps ─────────────────────────────────────────────────────────
  if (fs.existsSync(path.join(repoPath, ".eva", "veritas-plan.json"))) {
    console.log("[NEXT] eva audit --repo . -- scores the repo using this plan (Stories count toward MTI; Tasks do not)");
    console.log("[NEXT] eva generate-ado --repo . -- creates ADO backlog CSV (Epic/Feature/Story/Task hierarchy)");
    if (!opts.syncModel) {
      console.log("[NEXT] eva generate-plan --repo . --sync-model -- pushes plan summary to data model");
    }
    if (inferred.stories.length > 0) {
      const exampleId = inferred.stories[0].id;
      console.log(`[NEXT] Tag your source files: # EVA-STORY: ${exampleId}`);
    }
  }
}

module.exports = { generatePlan };
