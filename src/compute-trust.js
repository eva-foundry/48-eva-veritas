// EVA-STORY: EO-03-001
// EVA-STORY: EO-03-002
// EVA-STORY: EO-05-003
// EVA-FEATURE: EO-03
"use strict";

const fs = require("fs");
const path = require("path");
const { readJsonIfExists, writeJson, ensureDir } = require("./lib/fs-utils");
const { computeTrustScore, trustToActions } = require("./lib/trust");
const { computeFieldPopulationScore } = require("./lib/wbs-quality-gates");

// Staleness threshold: if reconciliation.json is older than this, warn.
const STALE_MS = 24 * 60 * 60 * 1000;

async function computeTrust(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const reconPath = path.resolve(opts.recon || path.join(repoPath, ".eva", "reconciliation.json"));
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "trust.json"));
  const prevPath = path.join(path.dirname(outPath), "trust.prev.json");
  ensureDir(path.dirname(outPath));

  const recon = readJsonIfExists(reconPath);
  if (!recon) throw new Error(`reconciliation.json not found at ${reconPath}. Run: eva reconcile`);

  // Load enrichment data if available (produced by enrich.js -- non-blocking)
  const enrichPath = path.join(repoPath, ".eva", "enrichment.json");
  const enrichment = readJsonIfExists(enrichPath) || null;
  if (enrichment) {
    console.log(`[INFO] Enrichment loaded: ${enrichment.annotated_count || 0} stories annotated`);
  }

  // Extract gate options (from COMPONENT 2: Gate-Driven Weighting)
  const gateOptions = opts.gateWeights ? {
    customWeights: opts.gateWeights,
    scoreFloor: opts.scoreFloor,
    scoreCeiling: opts.scoreCeiling
  } : null;

  // Enhancement 3 (v2.7 - March 2, 2026): Fetch field population score from data model
  // This is the 5th component of MTI calculation
  let fieldPopulationScore = null;
  try {
    const projectId = path.basename(repoPath); // e.g., "37-data-model", "51-ACA"
    const dataModelUrl = process.env.EVA_DATA_MODEL_URL || "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io";
    fieldPopulationScore = await computeFieldPopulationScore({
      dataModelUrl,
      project: projectId
    });
    if (fieldPopulationScore > 0) {
      console.log(`[INFO] Field population score: ${Math.round(fieldPopulationScore * 100)}% (sprint, assignee, ado_id)`);
    }
  } catch (e) {
    console.log(`[WARN] Field population score unavailable (non-fatal): ${e.message}`);
  }

  // --- Staleness guard ---
  let stale = false;
  try {
    const reconMtime = fs.statSync(reconPath).mtimeMs;
    if (Date.now() - reconMtime > STALE_MS) {
      stale = true;
      console.log(`[WARN] reconciliation data is stale (> 24 h) -- rerun: eva reconcile --repo ${repoPath}`);
    }
  } catch (_) { /* stat failed -- ignore */ }

  // --- Preserve previous trust score for trend display ---
  if (fs.existsSync(outPath)) {
    try { fs.copyFileSync(outPath, prevPath); } catch (_) { /* non-fatal */ }
  }

  const { score, components } = computeTrustScore(recon, enrichment, fieldPopulationScore, gateOptions);
  const actions = trustToActions(score);

  // VP-A6: trust-history ring buffer (last 10 runs) + sparkline
  const histPath = path.join(path.dirname(outPath), "trust-history.json");
  const MAX_HISTORY = 10;
  let history = readJsonIfExists(histPath) || { runs: [] };
  if (!Array.isArray(history.runs)) history.runs = [];
  history.runs.push({ generated_at: new Date().toISOString(), score });
  if (history.runs.length > MAX_HISTORY) history.runs = history.runs.slice(-MAX_HISTORY);
  writeJson(histPath, history);

  const sparkline = history.runs.map((r) => (r.score === null ? "?" : String(r.score))).join(" -> ");
  const prevHistScore = history.runs.length >= 2 ? history.runs[history.runs.length - 2].score : null;
  const sparkline_delta = (() => {
    if (prevHistScore === null || typeof prevHistScore !== "number" || score === null) return "first run";
    const diff = score - prevHistScore;
    return diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : "no change";
  })();

  const trust = {
    meta: {
      schema: "eva.trust.v2",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      reconciliation_path: reconPath
    },
    score,
    stale,
    sparkline,
    sparkline_delta,
    components,
    actions
  };

  writeJson(outPath, trust);
  console.log(`[PASS] trust written: ${outPath} (score: ${score}${stale ? " [STALE]" : ""})`);
}

module.exports = { computeTrust };
