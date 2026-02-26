// EVA-STORY: EO-12-001
// EVA-FEATURE: EO-12
"use strict";

/**
 * model-audit.js
 *
 * Cross-reference declared data model entities against what actually exists
 * in the repo.  Checks:
 *   - Screen  repo_path         -> file exists on disk
 *   - Endpoint status=implemented -> router file references the path
 *   - Service is_active=true    -> docker-compose / Dockerfile reference
 *   - Container fields[]        -> schema file covers >= 50% of declared fields
 *
 * Writes .eva/model-fidelity.json and prints a summary.
 * Exits with code 1 if drift detected (unless --warn-only).
 *
 * Usage:
 *   eva model-audit --repo <path> [--data-model <url>] [--warn-only]
 */

const fs = require("fs");
const path = require("path");
const { ensureDir, writeJson } = require("./lib/fs-utils");
const { loadConfig } = require("./lib/config");

// ── Constants ─────────────────────────────────────────────────────────────────

// ── ACA default ──────────────────────────────────────────────────────────────

/** 24x7 Cosmos-backed ACA endpoint -- the authoritative default. */
const ACA_DATA_MODEL_URL = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".eva", "dist", "build",
  "__pycache__", ".venv", ".next", "coverage"
]);

const REPO_EXTS = /\.(py|js|ts|jsx|tsx|go|rs|cs|java|yaml|yml|tf|json|sh|dockerfile)$/i;

// ── Filesystem helpers ────────────────────────────────────────────────────────

/**
 * Walk repo recursively and return concatenated content of source files.
 * Stops early once `needle` is found (fast path).
 */
function grepRepoForString(repoPath, needle) {
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return false; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (walk(full)) return true;
      } else if (REPO_EXTS.test(e.name)) {
        try {
          if (fs.readFileSync(full, "utf8").includes(needle)) return true;
        } catch (_) { /* skip unreadable */ }
      }
    }
    return false;
  }
  return walk(repoPath);
}

/**
 * Build a single large string from all schema-like files in the repo.
 * Used for container field coverage check.
 */
function collectRepoText(repoPath) {
  let text = "";
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (REPO_EXTS.test(e.name)) {
        try { text += fs.readFileSync(full, "utf8") + "\n"; }
        catch (_) { /* skip */ }
      }
    }
  }
  walk(repoPath);
  return text;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiGet(fetchFn, url) {
  const resp = await fetchFn(url);
  if (!resp.ok) throw new Error(`GET ${url} -> HTTP ${resp.status}`);
  return resp.json();
}

// ── Entity checkers ───────────────────────────────────────────────────────────

function checkScreens(screens, repoPath) {
  const drifted = [];
  for (const s of screens) {
    const id = s.obj_id || s.id || "(unknown)";
    if (s.repo_path) {
      const abs = path.join(repoPath, s.repo_path);
      if (!fs.existsSync(abs)) {
        drifted.push({
          entity: id,
          type: "screen",
          declared_status: "repo_path_declared",
          actual_status: "not_found",
          gap: `Screen file not on disk: ${s.repo_path}`
        });
      }
    }
  }
  return drifted;
}

function checkEndpoints(endpoints, repoPath) {
  const drifted = [];
  for (const ep of endpoints) {
    if (ep.status !== "implemented") continue;
    const id = ep.id || ep.obj_id || ep.path || "(unknown)";
    // The path segment to search for (strip method prefix if present: "GET /v1/foo" -> "/v1/foo")
    const raw = ep.path || (typeof id === "string" && id.includes(" ") ? id.split(" ").slice(1).join(" ") : id);
    if (raw && !grepRepoForString(repoPath, raw)) {
      drifted.push({
        entity: id,
        type: "endpoint",
        declared_status: "implemented",
        actual_status: "not_found",
        gap: `No router file references path: ${raw}`
      });
    }
  }
  return drifted;
}

function checkServices(services, repoPath) {
  const drifted = [];
  const dockerFiles = [
    path.join(repoPath, "docker-compose.yml"),
    path.join(repoPath, "docker-compose.yaml"),
    path.join(repoPath, "Dockerfile"),
    path.join(repoPath, "docker-compose.override.yml")
  ];
  // Read once
  let dockerText = "";
  for (const f of dockerFiles) {
    try { dockerText += fs.readFileSync(f, "utf8") + "\n"; }
    catch (_) { /* file absent */ }
  }

  for (const svc of services) {
    if (!svc.is_active) continue;
    const id = svc.obj_id || svc.id || "(unknown)";
    const name = svc.name || id;
    if (!dockerText.includes(name)) {
      drifted.push({
        entity: id,
        type: "service",
        declared_status: "is_active:true",
        actual_status: "not_found",
        gap: `No docker-compose or Dockerfile references service name: ${name}`
      });
    }
  }
  return drifted;
}

function checkContainers(containers, repoPath) {
  const driftedEntries = [];
  const driftedIds = [];

  // Collect repo text once for all containers
  const repoText = containers.length > 0 ? collectRepoText(repoPath) : "";

  for (const c of containers) {
    const id = c.obj_id || c.id || "(unknown)";
    const fields = Array.isArray(c.fields) ? c.fields : [];
    if (fields.length === 0) continue; // nothing to verify

    const found = fields.filter((f) => repoText.includes(String(f))).length;
    const ratio = found / fields.length;

    if (ratio < 0.5) {
      driftedEntries.push({
        entity: id,
        type: "container",
        declared_status: `${fields.length} declared fields`,
        actual_status: `${Math.round(ratio * 100)}% found (${found}/${fields.length})`,
        gap: `Schema coverage < 50% -- only ${found}/${fields.length} field names found in repo`
      });
      driftedIds.push(id);
    }
  }

  return { driftedEntries, driftedIds };
}

// ── Impact analysis ───────────────────────────────────────────────────────────

async function fetchImpacts(fetchFn, apiBase, containerIds) {
  const impacts = [];
  for (const id of containerIds) {
    try {
      const resp = await fetchFn(
        `${apiBase}/model/impact/?container=${encodeURIComponent(id)}`
      );
      if (resp.ok) {
        const data = await resp.json();
        impacts.push({ container: id, impact: data });
      }
    } catch (_) { /* non-fatal -- impact endpoint may be absent */ }
  }
  return impacts;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function modelAudit(opts = {}) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const cfg = loadConfig(repoPath);
  const apiBase = (opts.dataModel || process.env.EVA_DATA_MODEL_URL ||
    cfg.data_model_url || ACA_DATA_MODEL_URL).replace(/\/$/, "");
  const warnOnly = opts.warnOnly === true;
  const outPath = path.join(repoPath, ".eva", "model-fidelity.json");

  ensureDir(path.join(repoPath, ".eva"));

  const fetchFn = typeof fetch !== "undefined" ? fetch : null;
  if (!fetchFn) {
    console.log("[WARN] fetch not available (Node < 18) -- skipping model audit");
    return;
  }

  // ── API reachability ──────────────────────────────────────────────────────
  let healthy = false;
  try {
    const h = await fetchFn(`${apiBase}/health`).catch(() => null);
    healthy = !!(h && h.ok);
  } catch (_) { /* not reachable */ }

  if (!healthy) {
    const fidelity = {
      schema: "eva.model-fidelity.v1",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      error: `Data model API not reachable at ${apiBase}`
    };
    writeJson(outPath, fidelity);
    console.log(`[WARN] Data model API not reachable at ${apiBase}`);
    console.log(`       model-fidelity.json written with error marker`);
    console.log(`       ACA (24x7): ${ACA_DATA_MODEL_URL}`);
    console.log(`       Local fallback: cd 37-data-model && uvicorn api.server:app --port 8010`);
    return;
  }

  // ── Fetch entities ────────────────────────────────────────────────────────
  console.log(`[INFO] model-audit: ${repoPath}`);
  console.log(`[INFO] API: ${apiBase}`);

  let screens = [], endpoints = [], services = [], containers = [];
  try {
    [screens, endpoints, services, containers] = await Promise.all([
      apiGet(fetchFn, `${apiBase}/model/screens/`),
      apiGet(fetchFn, `${apiBase}/model/endpoints/`),
      apiGet(fetchFn, `${apiBase}/model/services/`),
      apiGet(fetchFn, `${apiBase}/model/containers/`)
    ]);
  } catch (err) {
    console.log(`[WARN] Failed to fetch model entities: ${err.message} -- proceeding with empties`);
  }

  const declaredTotal = screens.length + endpoints.length + services.length + containers.length;
  console.log(`[INFO] Entities fetched: ${screens.length} screens, ${endpoints.length} endpoints, ${services.length} services, ${containers.length} containers`);

  // ── Cross-reference checks ────────────────────────────────────────────────
  const drifted = [
    ...checkScreens(screens, repoPath),
    ...checkEndpoints(endpoints, repoPath),
    ...checkServices(services, repoPath)
  ];

  const { driftedEntries, driftedIds } = checkContainers(containers, repoPath);
  drifted.push(...driftedEntries);

  // ── Impact analysis ────────────────────────────────────────────────────────
  const impacts = driftedIds.length > 0
    ? await fetchImpacts(fetchFn, apiBase, driftedIds)
    : [];

  // ── Score ─────────────────────────────────────────────────────────────────
  const verifiedTotal = declaredTotal - drifted.length;
  const fidelityScore = declaredTotal > 0
    ? Math.round((verifiedTotal / declaredTotal) * 100)
    : 100;

  // ── Write output ──────────────────────────────────────────────────────────
  const fidelity = {
    schema: "eva.model-fidelity.v1",
    generated_at: new Date().toISOString(),
    repo: repoPath,
    model_fidelity_score: fidelityScore,
    declared_total: declaredTotal,
    verified_total: verifiedTotal,
    drifted,
    impacts
  };

  writeJson(outPath, fidelity);

  // ── Console summary ───────────────────────────────────────────────────────
  const statusTag = drifted.length === 0 ? "[PASS]" : (warnOnly ? "[WARN]" : "[FAIL]");
  console.log(`${statusTag} model-fidelity.json written: ${outPath}`);
  console.log(`       Score: ${fidelityScore}%  (${verifiedTotal}/${declaredTotal} entities verified)`);

  if (drifted.length > 0) {
    console.log(`       Drifted entities (${drifted.length}):`);
    const show = drifted.slice(0, 10);
    for (const d of show) {
      console.log(`         [${d.type}] ${d.entity} -- ${d.gap}`);
    }
    if (drifted.length > 10) console.log(`         ... and ${drifted.length - 10} more`);

    if (impacts.length > 0) {
      console.log("       Container impact analysis:");
      for (const { container, impact } of impacts) {
        const epCount = Array.isArray(impact.endpoints) ? impact.endpoints.length : 0;
        const scCount = Array.isArray(impact.screens) ? impact.screens.length : 0;
        console.log(`         Container '${container}' impacts: ${epCount} endpoint(s), ${scCount} screen(s)`);
      }
    }

    if (!warnOnly) {
      process.exitCode = 1;
    }
  }
}

module.exports = { modelAudit, checkScreens, checkEndpoints, checkServices, checkContainers };
