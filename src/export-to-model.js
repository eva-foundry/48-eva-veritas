// EVA-STORY: EO-11-001
// EVA-FEATURE: EO-11
"use strict";

/**
 * export-to-model.js
 * 
 * Orchestrator for transforming Veritas discovery/reconciliation data
 * into EVA Data Model layer records (WBS, Evidence, Decisions, Risks).
 * 
 * Usage:
 *   eva export-to-model --repo ./37-data-model [--layers wbs,evidence,decisions,risks]
 */

const path = require("path");
const { readJsonIfExists, writeJson, ensureDir } = require("./lib/fs-utils");
const { extractWbs } = require("./lib/wbs-extractor");
const { extractEvidence } = require("./lib/evidence-extractor");
const { extractDecisions } = require("./lib/decisions-extractor");
const { extractRisks } = require("./lib/risks-extractor");

async function exportToModel(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const projectId = path.basename(repoPath);
  
  const discoveryPath = path.resolve(path.join(repoPath, ".eva", "discovery.json"));
  const reconPath = path.resolve(path.join(repoPath, ".eva", "reconciliation.json"));
  const outPath = path.resolve(
    opts.out || path.join(repoPath, ".eva", "model-export.json")
  );

  const layersOption = opts.layers || "wbs,evidence,decisions,risks";
  const selectedLayers = new Set(layersOption.split(",").map(l => l.trim().toLowerCase()));
  const dryRun = opts.dryRun || false;

  console.log(`[INFO] export-to-model: ${projectId}`);
  console.log(`[INFO] Layers: ${Array.from(selectedLayers).join(", ")}`);
  if (dryRun) {
    console.log("[INFO] DRY-RUN MODE: No files will be written");
  }

  // Load discovery and reconciliation
  const discovery = readJsonIfExists(discoveryPath);
  if (!discovery) {
    throw new Error(
      `discovery.json not found at ${discoveryPath}. Run: eva audit --repo ${repoPath}`
    );
  }

  const reconciliation = readJsonIfExists(reconPath);
  if (!reconciliation) {
    console.log("[WARN] reconciliation.json not found - proceeding with limited data");
  }

  // Initialize output structure
  const output = {
    meta: {
      schema: "eva.export-to-model.v1",
      generated_at: new Date().toISOString(),
      project_id: projectId,
      source_files: [],
      discovery_path: discoveryPath,
      reconciliation_path: reconPath || null,
      layers_selected: Array.from(selectedLayers)
    },
    wbs: [],
    evidence: [],
    decisions: [],
    risks: [],
    summary: {
      wbs_count: 0,
      evidence_count: 0,
      decisions_count: 0,
      risks_count: 0,
      mti_score: reconciliation?.metrics?.mti || null
    }
  };

  // Track source files
  const sourceFiles = [];
  const statusPath = path.join(repoPath, "STATUS.md");
  const planPath = path.join(repoPath, "PLAN.md");
  const fs = require("fs");
  if (fs.existsSync(statusPath)) sourceFiles.push("STATUS.md");
  if (fs.existsSync(planPath)) sourceFiles.push("PLAN.md");
  output.meta.source_files = sourceFiles;

  console.log("[INFO] Extracting layers...");

  // Extract WBS
  if (selectedLayers.has("wbs")) {
    console.log("[INFO]   → Layer 26 (WBS)");
    output.wbs = extractWbs(discovery, reconciliation, projectId);
    output.summary.wbs_count = output.wbs.length;
    console.log(`[PASS]   ✓ ${output.wbs.length} WBS records extracted`);
  }

  // Extract Evidence
  if (selectedLayers.has("evidence")) {
    console.log("[INFO]   → Layer 31 (Evidence)");
    output.evidence = extractEvidence(discovery, reconciliation, projectId);
    output.summary.evidence_count = output.evidence.length;
    console.log(`[PASS]   ✓ ${output.evidence.length} evidence records extracted`);
  }

  // Extract Decisions
  if (selectedLayers.has("decisions")) {
    console.log("[INFO]   → Layer 30 (Decisions)");
    output.decisions = extractDecisions(discovery, reconciliation, projectId, repoPath);
    output.summary.decisions_count = output.decisions.length;
    console.log(`[PASS]   ✓ ${output.decisions.length} decision records extracted`);
  }

  // Extract Risks
  if (selectedLayers.has("risks")) {
    console.log("[INFO]   → Layer 29 (Risks)");
    output.risks = extractRisks(discovery, reconciliation, projectId, repoPath);
    output.summary.risks_count = output.risks.length;
    console.log(`[PASS]   ✓ ${output.risks.length} risk records extracted`);
  }

  // Write output
  if (!dryRun) {
    ensureDir(path.dirname(outPath));
    writeJson(outPath, output);
    console.log(`[PASS] Export complete: ${outPath}`);
    console.log(`[INFO] Summary: ${output.summary.wbs_count} WBS, ${output.summary.evidence_count} evidence, ${output.summary.decisions_count} decisions, ${output.summary.risks_count} risks`);
  } else {
    console.log("[DRY-RUN] Would write to:", outPath);
    console.log("[DRY-RUN] Summary:");
    console.log(`  - WBS records: ${output.summary.wbs_count}`);
    console.log(`  - Evidence records: ${output.summary.evidence_count}`);
    console.log(`  - Decision records: ${output.summary.decisions_count}`);
    console.log(`  - Risk records: ${output.summary.risks_count}`);
    console.log(`  - MTI score: ${output.summary.mti_score}`);
  }

  // Create audit evidence
  if (!dryRun) {
    const evidencePath = path.join(repoPath, ".eva", "export-to-model-evidence.json");
    const evidence = {
      schema: "eva.export-to-model.evidence.v1",
      timestamp: new Date().toISOString(),
      project_id: projectId,
      actor: "agent:veritas",
      action: "export-to-model",
      layers_exported: Array.from(selectedLayers),
      record_counts: output.summary,
      output_path: outPath,
      discovery_path: discoveryPath,
      reconciliation_path: reconPath
    };
    writeJson(evidencePath, evidence);
    console.log(`[PASS] Evidence record: ${evidencePath}`);
  }

  return output;
}

module.exports = { exportToModel };
