// EVA-STORY: EO-13-001
// EVA-STORY: EO-13-002
// EVA-STORY: EO-13-003
// EVA-FEATURE: EO-13
"use strict";

/**
 * dependency-audit.js
 *
 * Proactive dependency gate checker for EVA projects.
 *
 * Unlike audit_repo (which looks backward -- did this story get covered?),
 * dependency_audit looks FORWARD: given the active stories in a project's
 * PLAN.md, what upstream API/data/infra dependencies are unmet right now?
 *
 * Algorithm:
 *   1. Read PLAN.md -- extract active feature IDs and their dependency
 *      annotations (lines matching "Dependency:", "dependency:", or
 *      "Blocked until:" patterns).
 *   2. Query the live data model API for known gate conditions:
 *      - endpoint existence (status=implemented vs. stub)
 *      - field completeness (transaction_function_type, story_ids,
 *        data_function_type, etc.)
 *      - layer availability (L27-L30 DPDCA layers)
 *      - ACA image freshness (fp/estimate, graph/edge-types reachability)
 *   3. For each active feature, emit a readiness verdict: READY / BLOCKED /
 *      PARTIAL with a list of unmet gates.
 *   4. Write .eva/dependency-audit.json and print a table.
 *
 * Usage (CLI):
 *   eva dependency-audit --repo <path> [--data-model <url>] [--json]
 *
 * Usage (MCP):
 *   POST /tools/dependency_audit  { "repo_path": "...", "data_model_url": "..." }
 */

const fs   = require("fs");
const path = require("path");
const { ensureDir, writeJson } = require("./lib/fs-utils");

const ACA_URL = "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io";

// --------------------------------------------------------------------------
// HTTP helper -- no axios, no node-fetch: raw https
// --------------------------------------------------------------------------
function apiGet(baseUrl, route) {
  return new Promise((resolve, reject) => {
    const u = new URL(route, baseUrl);
    const mod = u.protocol === "https:" ? require("https") : require("http");
    const req = mod.get(u.href, { timeout: 12000 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        } else {
          reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { statusCode: res.statusCode }));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function apiPost(baseUrl, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(route, baseUrl);
    const payload = JSON.stringify(body || {});
    const mod = u.protocol === "https:" ? require("https") : require("http");
    const opts = {
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: "POST",
      timeout: 15000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers }
    };
    const req = mod.request(opts, (res) => {
      let b = "";
      res.on("data", (c) => { b += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(b)); } catch { resolve(b); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(payload);
    req.end();
  });
}

// --------------------------------------------------------------------------
// PLAN.md parser -- extract active features and dependency lines
// --------------------------------------------------------------------------
function parsePlan(repoPath) {
  const planPath = path.join(repoPath, "PLAN.md");
  if (!fs.existsSync(planPath)) return { features: [], raw_deps: [] };

  const text = fs.readFileSync(planPath, "utf8");
  const lines = text.split("\n");

  const features = [];
  let currentFeature = null;

  for (const line of lines) {
    // Match feature headers: ## Feature: ... [ID=F??-...]  optionally [DONE]
    const fmatch = line.match(/##\s+Feature:\s+(.+?)\s+\[ID=([A-Z0-9_-]+)\]/i);
    if (fmatch) {
      const done = /\[DONE\]/i.test(line);
      if (!done) {
        currentFeature = {
          id: fmatch[2],
          label: fmatch[1].trim(),
          done: false,
          raw_deps: [],
          blockers: [],
          verdict: "UNKNOWN"
        };
        features.push(currentFeature);
      } else {
        currentFeature = null; // skip DONE features
      }
      continue;
    }
    // Capture dependency/blocker lines within an active feature
    if (currentFeature) {
      if (/\*\*Dependency:\*\*|\*\*Blocked\*\*|Dependency:|Blocked until:|API blocker|Data blocker|\[.*BLOCKED\]/i.test(line)) {
        const clean = line.replace(/^[->\s*]+/, "").replace(/\*\*/g, "").trim();
        if (clean) currentFeature.raw_deps.push(clean);
      }
    }
  }

  return { features };
}

// --------------------------------------------------------------------------
// Known gate definitions
// Each gate is: { id, label, check(api_data) -> {pass, warn, detail, fix} }
// api_data is pre-fetched and passed in to avoid N requests per gate
// --------------------------------------------------------------------------
function buildGates(data) {
  const {
    health, commit, endpoints, containers,
    sprints, fp_estimate_ok, graph_ok,
    l28_ok, l29_ok, l30_ok
  } = data;

  return [
    {
      id: "G-ACA",
      label: "ACA reachable + Cosmos-backed",
      features: ["ALL"],
      eval: () => {
        if (!health) return { status: "FAIL", detail: "No response from ACA health endpoint", fix: "Check ACA container status" };
        if (health.store !== "cosmos") return { status: "WARN", detail: `store=${health.store}`, fix: "Check COSMOS_URL/KEY" };
        return { status: "PASS", detail: `v=${health.version} store=cosmos` };
      }
    },
    {
      id: "G-VIOLATIONS",
      label: "validate-model violations=0",
      features: ["ALL"],
      eval: () => {
        if (!commit) return { status: "WARN", detail: "Could not call admin/commit" };
        if (commit.violation_count > 0) return { status: "FAIL", detail: `violations=${commit.violation_count}`, fix: "Fix cross-reference violations in model JSON" };
        return { status: "PASS", detail: `violations=0 exported=${commit.exported_total}` };
      }
    },
    {
      id: "G-FP-ENDPOINT",
      label: "fp/estimate endpoint on ACA",
      features: ["F31-DM-FP1", "F37-10"],
      eval: () => {
        if (!fp_estimate_ok) return { status: "FAIL", detail: "GET /model/fp/estimate -> 404 -- ACA image predates DPDCA sprint", fix: "Redeploy 37-data-model to ACA from current main branch" };
        return { status: "PASS", detail: "fp/estimate reachable" };
      }
    },
    {
      id: "G-TFT",
      label: "Endpoints stamped (transaction_function_type)",
      features: ["F31-DM-FP1", "F31-DM-VERITAS1", "F37-10"],
      eval: () => {
        if (!endpoints) return { status: "WARN", detail: "Could not query endpoints" };
        const impl  = endpoints.filter(e => e.status === "implemented");
        const tft   = impl.filter(e => e.transaction_function_type && e.transaction_function_type !== "");
        if (impl.length === 0) return { status: "WARN", detail: "0 implemented endpoints found" };
        if (tft.length === 0) return { status: "FAIL", detail: `0/${impl.length} stamped -- FP calc returns estimates only`, fix: "F37-10-001: PUT EI/EO/EQ on each implemented endpoint" };
        if (tft.length < impl.length) return { status: "WARN", detail: `${tft.length}/${impl.length} stamped`, fix: `F37-10-001: stamp remaining ${impl.length - tft.length} endpoints` };
        return { status: "PASS", detail: `${tft.length}/${impl.length} stamped` };
      }
    },
    {
      id: "G-STORYIDS",
      label: "Endpoints have story_ids (MTI 4th component)",
      features: ["F31-DM-VERITAS1", "F37-10"],
      eval: () => {
        if (!endpoints) return { status: "WARN", detail: "Could not query endpoints" };
        const impl = endpoints.filter(e => e.status === "implemented");
        const sid  = impl.filter(e => Array.isArray(e.story_ids) && e.story_ids.length > 0);
        if (sid.length === 0) return { status: "FAIL", detail: `0/${impl.length} have story_ids -- complexity_coverage=0; veritas uses 3-component formula`, fix: "F37-10-001: stamp story_ids alongside transaction_function_type" };
        if (sid.length < impl.length) return { status: "WARN", detail: `${sid.length}/${impl.length} have story_ids`, fix: `stamp remaining ${impl.length - sid.length}` };
        return { status: "PASS", detail: `${sid.length}/${impl.length} have story_ids` };
      }
    },
    {
      id: "G-DFT",
      label: "Containers stamped (data_function_type)",
      features: ["F31-DM-FP1", "F37-10"],
      eval: () => {
        if (!containers) return { status: "WARN", detail: "Could not query containers" };
        const dft = containers.filter(c => c.data_function_type && c.data_function_type !== "");
        if (dft.length === 0) return { status: "FAIL", detail: `0/${containers.length} stamped -- no ILF/EIF data in FP estimate`, fix: "F37-10-002: PUT ILF or EIF on each container" };
        if (dft.length < containers.length) return { status: "WARN", detail: `${dft.length}/${containers.length} stamped`, fix: `F37-10-002: stamp remaining ${containers.length - dft.length}` };
        return { status: "PASS", detail: `${dft.length}/${containers.length} stamped` };
      }
    },
    {
      id: "G-SPRINTS",
      label: "L27 sprints seeded (>=8 records)",
      features: ["F31-DM-PMLIVE1", "F31-PM3", "F37-10"],
      eval: () => {
        if (sprints === null) return { status: "FAIL", detail: "L27 layer not on ACA -- DPDCA sprint not deployed", fix: "Redeploy 37-data-model ACA from main branch" };
        const sc = Array.isArray(sprints) ? sprints.length : 0;
        if (sc === 0) return { status: "FAIL", detail: "0 sprint records -- 39-ado-dashboard velocity blocked; F31-DM-PMLIVE1 blocked", fix: "F37-10-003: seed model/sprints.json" };
        if (sc < 8)  return { status: "WARN", detail: `${sc} records -- Sprint-Backlog + Sprint 1-7 expected`, fix: "F37-10-003: seed remaining sprints" };
        return { status: "PASS", detail: `${sc} sprint records` };
      }
    },
    {
      id: "G-L28L30",
      label: "L28-L30 reachable (milestones/risks/decisions)",
      features: ["F31-DM-PMLIVE1"],
      eval: () => {
        const missing = [];
        if (!l28_ok) missing.push("milestones(L28)");
        if (!l29_ok) missing.push("risks(L29)");
        if (!l30_ok) missing.push("decisions(L30)");
        if (missing.length > 0) return { status: "FAIL", detail: `Not reachable: ${missing.join(", ")} -- DPDCA sprint not deployed`, fix: "Redeploy 37-data-model ACA from main branch" };
        return { status: "PASS", detail: "L28 milestones + L29 risks + L30 decisions reachable" };
      }
    },
    {
      id: "G-GRAPH",
      label: "Graph endpoint on ACA (F31-DM-GRAPH1 gate)",
      features: ["F31-DM-GRAPH1", "F31-DM-GRAPH2", "F31-DM-EXP1"],
      eval: () => {
        if (!graph_ok) return { status: "FAIL", detail: "GET /model/graph/edge-types -> error -- ACA image may be stale", fix: "Redeploy 37-data-model ACA from main branch" };
        return { status: "PASS", detail: "graph/edge-types reachable" };
      }
    }
  ];
}

// --------------------------------------------------------------------------
// Main dependency audit function
// --------------------------------------------------------------------------
async function dependencyAudit(opts) {
  const repoPath   = path.resolve(opts.repo || opts.repo_path || process.cwd());
  const baseUrl    = opts.data_model_url || opts.dataModelUrl || process.env.EVA_DATA_MODEL_URL || ACA_URL;
  const jsonOutput = opts.json === true;

  // ── Step 1: Parse PLAN.md ──────────────────────────────────────────────
  const { features } = parsePlan(repoPath);
  const activeFeatureIds = new Set(features.map(f => f.id));

  // ── Step 2: Fetch all API data in parallel ─────────────────────────────
  const [
    health, commit, endpoints, containers,
    sprints_res, fp_res, graph_res, l28_res, l29_res, l30_res
  ] = await Promise.allSettled([
    apiGet(baseUrl, "/health"),
    apiPost(baseUrl, "/model/admin/commit", {}, { Authorization: "Bearer dev-admin" }),
    apiGet(baseUrl, "/model/endpoints/"),
    apiGet(baseUrl, "/model/containers/"),
    apiGet(baseUrl, "/model/sprints/"),
    apiGet(baseUrl, "/model/fp/estimate"),
    apiGet(baseUrl, "/model/graph/edge-types"),
    apiGet(baseUrl, "/model/milestones/"),
    apiGet(baseUrl, "/model/risks/"),
    apiGet(baseUrl, "/model/decisions/")
  ]);

  const data = {
    health:         health.status === "fulfilled"    ? health.value       : null,
    commit:         commit.status === "fulfilled"    ? commit.value       : null,
    endpoints:      endpoints.status === "fulfilled" ? endpoints.value    : null,
    containers:     containers.status === "fulfilled"? containers.value   : null,
    sprints:        sprints_res.status === "fulfilled" ? sprints_res.value : null,
    fp_estimate_ok: fp_res.status === "fulfilled",
    graph_ok:       graph_res.status === "fulfilled",
    l28_ok:         l28_res.status === "fulfilled",
    l29_ok:         l29_res.status === "fulfilled",
    l30_ok:         l30_res.status === "fulfilled"
  };

  // ── Step 3: Evaluate all gates ─────────────────────────────────────────
  const gates = buildGates(data);
  const results = gates.map(g => {
    const r = g.eval();
    return { id: g.id, label: g.label, features: g.features, ...r };
  });

  // ── Step 4: Map gates to active features ──────────────────────────────
  const featureResults = features.map(f => {
    const relevant = results.filter(g =>
      g.features.includes("ALL") || g.features.includes(f.id) ||
      f.raw_deps.some(dep => g.label.toLowerCase().includes(dep.toLowerCase().slice(0, 15)))
    );
    const failing = relevant.filter(g => g.status === "FAIL");
    const warning = relevant.filter(g => g.status === "WARN");
    let verdict = "READY";
    if (failing.length > 0) verdict = "BLOCKED";
    else if (warning.length > 0) verdict = "PARTIAL";
    return {
      ...f,
      verdict,
      blocking_gates: failing.map(g => `${g.id} ${g.label}`),
      warning_gates:  warning.map(g => `${g.id} ${g.label}`),
      relevant_gates: relevant.length
    };
  });

  // ── Step 5: Compute summary ────────────────────────────────────────────
  const summary = {
    active_features:  features.length,
    ready:            featureResults.filter(f => f.verdict === "READY").length,
    partial:          featureResults.filter(f => f.verdict === "PARTIAL").length,
    blocked:          featureResults.filter(f => f.verdict === "BLOCKED").length,
    failing_gates:    results.filter(g => g.status === "FAIL").length,
    warning_gates:    results.filter(g => g.status === "WARN").length
  };

  // ── Step 6: Write .eva/dependency-audit.json ───────────────────────────
  const evaDirPath = path.join(repoPath, ".eva");
  try {
    ensureDir(evaDirPath);
    writeJson(path.join(evaDirPath, "dependency-audit.json"), {
      meta: { generated_at: new Date().toISOString(), repo: repoPath, base_url: baseUrl },
      summary,
      features: featureResults,
      gates: results
    });
  } catch (e) {
    console.error(`[WARN] Could not write dependency-audit.json: ${e.message}`);
  }

  // ── Step 7: Output ─────────────────────────────────────────────────────
  if (!jsonOutput) {
    console.log("");
    console.log("=== EVA Dependency Audit ===");
    console.log(`Repo: ${repoPath}`);
    console.log(`API:  ${baseUrl}`);
    console.log("");
    console.log("-- Gate Status --");
    for (const g of results) {
      const icon = g.status === "PASS" ? "[PASS]" : g.status === "WARN" ? "[WARN]" : "[FAIL]";
      console.log(`  ${icon} ${g.id}  ${g.label}`);
      if (g.status !== "PASS" && g.detail) console.log(`         ${g.detail}`);
      if (g.fix)                           console.log(`         FIX: ${g.fix}`);
    }
    console.log("");
    console.log("-- Feature Readiness --");
    for (const f of featureResults) {
      const icon = f.verdict === "READY" ? "[READY]  " : f.verdict === "PARTIAL" ? "[PARTIAL]" : "[BLOCKED]";
      console.log(`  ${icon}  ${f.id}  ${f.label}`);
      if (f.blocking_gates.length > 0) {
        for (const bg of f.blocking_gates) console.log(`              BLOCKED BY: ${bg}`);
      }
    }
    console.log("");
    console.log(`Summary: ${summary.active_features} active features -- ` +
      `${summary.ready} READY / ${summary.partial} PARTIAL / ${summary.blocked} BLOCKED | ` +
      `${summary.failing_gates} failing gates`);
    console.log("");
  }

  return { summary, features: featureResults, gates: results };
}

module.exports = { dependencyAudit };
