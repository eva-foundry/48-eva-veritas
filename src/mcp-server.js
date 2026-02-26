// EVA-STORY: EO-07-001
// EVA-STORY: EO-07-002
// EVA-STORY: EO-07-003
// EVA-STORY: EO-07-004
// EVA-STORY: EO-07-005
// EVA-STORY: EO-07-006
// EVA-FEATURE: EO-07
"use strict";

/**
 * eva-veritas MCP Server
 *
 * Exposes all eva-veritas capabilities as MCP-compatible HTTP tools.
 * Any agent in the EVA ecosystem (or external) can invoke veritas
 * without running the CLI directly.
 *
 * Endpoints:
 *   GET  /health           -- liveness check
 *   GET  /tools            -- full tool manifest (MCP-compatible JSON)
 *   POST /tools/{name}     -- invoke a named tool with JSON body
 *
 * Default port: 8030  (override with MCP_PORT env var or --port CLI flag)
 *
 * Tools:
 *   audit_repo            -- full discover+reconcile+trust pipeline
 *   get_trust_score       -- MTI score for a repo (runs pipeline if stale)
 *   get_coverage          -- story coverage statistics
 *   generate_ado_items    -- structured ADO work items (Epic/Feature/Story/Task)
 *   scan_portfolio        -- portfolio-wide MTI table
 *   model_audit           -- cross-reference data model entities vs filesystem
 *   dependency_audit      -- proactive forward-looking gate check (READY/PARTIAL/BLOCKED per feature)
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const { discover } = require("./discover");
const { reconcile } = require("./reconcile");
const { computeTrust } = require("./compute-trust");
const { readJsonIfExists } = require("./lib/fs-utils");
const { toCsvRows } = require("./lib/ado-csv");
const { modelAudit } = require("./model-audit");
const { dependencyAudit } = require("./dependency-audit");

// ── Tool Manifest ───────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "audit_repo",
    description:
      "Run the full veritas audit pipeline (discover + reconcile + trust) on a repo. " +
      "Returns gaps, coverage statistics, trust/MTI score, and recommended actions.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Absolute path to the project repository."
        }
      },
      required: ["repo_path"]
    }
  },
  {
    name: "get_trust_score",
    description:
      "Return the trust/MTI score and component breakdown for a repo. " +
      "Automatically re-runs the pipeline if .eva/trust.json is absent or older than 24 hours.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Absolute path to the project repository."
        }
      },
      required: ["repo_path"]
    }
  },
  {
    name: "get_coverage",
    description:
      "Return story coverage statistics for a repo: stories total, with artifacts, " +
      "with evidence receipts, and the consistency score.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Absolute path to the project repository."
        }
      },
      required: ["repo_path"]
    }
  },
  {
    name: "generate_ado_items",
    description:
      "Return structured ADO work items (Epic / Feature / User Story / Task) " +
      "for a repo, optionally filtered to gap stories only.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Absolute path to the project repository."
        },
        include_gaps: {
          type: "boolean",
          description:
            "When true, only return stories that have gap tags (sprint seeding). " +
            "Default: false (returns all stories)."
        }
      },
      required: ["repo_path"]
    }
  },
  {
    name: "scan_portfolio",
    description:
      "Run audit_repo for each numbered project folder under a portfolio root. " +
      "Returns per-project trust scores, gap counts, and a portfolio-wide MTI average.",
    inputSchema: {
      type: "object",
      properties: {
        portfolio_root: {
          type: "string",
          description:
            "Absolute path to the folder containing numbered project folders " +
            "(e.g. C:\\AICOE\\eva-foundation)."
        },
        project_filter: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of project prefixes to include, e.g. [\"33\", \"44\"]. " +
            "Omit to scan all numbered folders."
        }
      },
      required: ["portfolio_root"]
    }
  },
  {
    name: "model_audit",
    description:
      "Cross-reference declared data model entities (screens, endpoints, services, containers) " +
      "against the repo filesystem, and write .eva/model-fidelity.json. " +
      "Returns the fidelity score and list of drifted entities.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Absolute path to the repo to audit."
        },
        data_model_url: {
          type: "string",
          description: "Base URL of the EVA data model API. Default: EVA_DATA_MODEL_URL env var, then ACA endpoint."
        },
        warn_only: {
          type: "boolean",
          description: "Return result without setting exit code 1 on drift (default: false)."
        }
      },
      required: ["repo_path"]
    }
  },
  {
    name: "dependency_audit",
    description:
      "Proactive forward-looking dependency gate checker. " +
      "Reads the project PLAN.md, queries the live EVA data model API, and returns " +
      "a READY/PARTIAL/BLOCKED verdict for every active feature with the specific " +
      "unmet gates that are blocking it. Writes .eva/dependency-audit.json. " +
      "Use this at session start to surface blockers before implementing anything.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Absolute path to the project repository to audit."
        },
        data_model_url: {
          type: "string",
          description: "Base URL of the EVA data model API. Default: ACA production endpoint."
        },
        json_output: {
          type: "boolean",
          description: "Return machine-readable JSON (default: false)."
        }
      },
      required: ["repo_path"]
    }
  }
];

// ── Pipeline Helpers ────────────────────────────────────────────────────────────

/**
 * Run the full three-step pipeline for a repo.
 * Writes artefacts to <repoPath>/.eva/ (normal veritas behaviour).
 */
async function runPipeline(repoPath) {
  const opts = { repo: repoPath };
  await discover(opts);
  await reconcile(opts);
  await computeTrust(opts);
}

/** Read a JSON artefact from <repoPath>/.eva/<filename>. */
function readEva(repoPath, filename) {
  return readJsonIfExists(path.join(repoPath, ".eva", filename));
}

/** Return true if trust.json does not exist or is older than 24 hours. */
function isTrustStale(repoPath) {
  const trustPath = path.join(repoPath, ".eva", "trust.json");
  if (!fs.existsSync(trustPath)) return true;
  const age = Date.now() - fs.statSync(trustPath).mtimeMs;
  return age > 24 * 60 * 60 * 1000; // 24 h
}

// ── HTTP Helpers ────────────────────────────────────────────────────────────────

function jsonResp(res, statusCode, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (_) {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ── Tool Handlers ───────────────────────────────────────────────────────────────

async function handleAuditRepo(input) {
  if (!input.repo_path) throw new Error("Missing required field: repo_path");
  const repoPath = path.resolve(input.repo_path);

  await runPipeline(repoPath);

  const recon = readEva(repoPath, "reconciliation.json");
  const trust = readEva(repoPath, "trust.json");

  // Exclude housekeeping gap types from the returned list
  const gaps = (recon?.gaps || []).filter(
    (g) => g.type !== "orphan_story_tag"
  );

  return {
    repo_path: repoPath,
    trust_score: trust?.score ?? null,
    coverage: recon?.coverage || {},
    gaps,
    actions: trust?.actions || []
  };
}

async function handleGetTrustScore(input) {
  if (!input.repo_path) throw new Error("Missing required field: repo_path");
  const repoPath = path.resolve(input.repo_path);

  if (isTrustStale(repoPath)) {
    await runPipeline(repoPath);
  }

  const trust = readEva(repoPath, "trust.json");
  if (!trust) {
    throw new Error(
      `Pipeline ran but trust.json not found at ${repoPath}/.eva/trust.json`
    );
  }

  return {
    repo_path: repoPath,
    score: trust.score,
    components: trust.components || {},
    actions: trust.actions || []
  };
}

async function handleGetCoverage(input) {
  if (!input.repo_path) throw new Error("Missing required field: repo_path");
  const repoPath = path.resolve(input.repo_path);

  const reconPath = path.join(repoPath, ".eva", "reconciliation.json");
  if (!fs.existsSync(reconPath)) {
    await runPipeline(repoPath);
  }

  const recon = readEva(repoPath, "reconciliation.json");
  if (!recon) {
    throw new Error(
      `reconciliation.json not found at ${repoPath}/.eva/ even after running pipeline`
    );
  }

  return {
    repo_path: repoPath,
    stories_total: recon.coverage?.stories_total ?? 0,
    stories_with_artifacts: recon.coverage?.stories_with_artifacts ?? 0,
    stories_with_evidence: recon.coverage?.stories_with_evidence ?? 0,
    consistency_score: recon.coverage?.consistency_score ?? 0
  };
}

async function handleGenerateAdoItems(input) {
  if (!input.repo_path) throw new Error("Missing required field: repo_path");
  const repoPath = path.resolve(input.repo_path);
  const gapsOnly = input.include_gaps === true;

  const reconPath = path.join(repoPath, ".eva", "reconciliation.json");
  if (!fs.existsSync(reconPath)) {
    await runPipeline(repoPath);
  }

  const discovery = readEva(repoPath, "discovery.json");
  const recon = readEva(repoPath, "reconciliation.json");

  if (!discovery) {
    throw new Error(`discovery.json not found at ${repoPath}/.eva/`);
  }

  const planned = {
    project: discovery.project,
    epic: discovery.planned?.epic,
    features: discovery.planned?.features || [],
    stories: discovery.planned?.stories || [],
    tasks: discovery.planned?.tasks || [],
    acceptance: discovery.planned?.acceptance || []
  };

  // toCsvRows returns [[header...], [row...], ...]
  const rows = toCsvRows(planned, recon, gapsOnly);
  if (rows.length === 0) return { repo_path: repoPath, gaps_only: gapsOnly, item_count: 0, items: [] };

  const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const items = rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    return obj;
  });

  return {
    repo_path: repoPath,
    gaps_only: gapsOnly,
    item_count: items.length,
    items
  };
}

async function handleScanPortfolio(input) {
  if (!input.portfolio_root) throw new Error("Missing required field: portfolio_root");
  const portfolioRoot = path.resolve(input.portfolio_root);
  const filterIds = Array.isArray(input.project_filter) && input.project_filter.length > 0
    ? input.project_filter
    : null;

  if (!fs.existsSync(portfolioRoot)) {
    throw new Error(`Portfolio root not found: ${portfolioRoot}`);
  }

  const entries = fs.readdirSync(portfolioRoot, { withFileTypes: true });
  const projectDirs = entries
    .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
    .map((e) => e.name)
    .sort();

  const filtered = filterIds
    ? projectDirs.filter((d) =>
        filterIds.some((id) => d.startsWith(id + "-") || d === id)
      )
    : projectDirs;

  const projects = [];
  let totalScore = 0;
  let scoredCount = 0;

  for (const dir of filtered) {
    const repoPath = path.join(portfolioRoot, dir);
    let score = null;
    let stories_total = 0;
    let gap_count = 0;
    let error = null;

    try {
      await runPipeline(repoPath);
      const trust = readEva(repoPath, "trust.json");
      const recon = readEva(repoPath, "reconciliation.json");
      if (trust) score = trust.score;
      if (recon) {
        stories_total = recon.coverage?.stories_total ?? 0;
        gap_count = (recon.gaps || []).filter(
          (g) => g.type !== "orphan_story_tag"
        ).length;
      }
    } catch (err) {
      error = err.message.split("\n")[0];
    }

    if (score !== null) { totalScore += score; scoredCount++; }
    projects.push({ id: dir, name: dir, trust_score: score, stories_total, gap_count, error });
  }

  const portfolio_mti =
    scoredCount > 0 ? Math.round(totalScore / scoredCount) : null;

  return {
    portfolio_root: portfolioRoot,
    project_count: filtered.length,
    portfolio_mti,
    projects
  };
}

// ── Router ──────────────────────────────────────────────────────────────────────

async function handleModelAudit(input) {
  if (!input.repo_path) throw new Error("Missing required field: repo_path");
  const repoPath = path.resolve(input.repo_path);

  await modelAudit({
    repo: repoPath,
    dataModel: input.data_model_url || undefined,
    warnOnly: input.warn_only === true
  });

  const fidelity = readJsonIfExists(path.join(repoPath, ".eva", "model-fidelity.json"));
  if (!fidelity) throw new Error(`model-fidelity.json not found at ${repoPath}/.eva/`);

  return {
    repo_path: repoPath,
    model_fidelity_score: fidelity.model_fidelity_score ?? null,
    declared_total: fidelity.declared_total ?? 0,
    verified_total: fidelity.verified_total ?? 0,
    drift_count: Array.isArray(fidelity.drifted) ? fidelity.drifted.length : 0,
    drifted: fidelity.drifted || [],
    impacts: fidelity.impacts || [],
    error: fidelity.error || null
  };
}

async function handleDependencyAudit(input) {
  if (!input.repo_path) throw new Error("Missing required field: repo_path");
  const result = await dependencyAudit({
    repo: input.repo_path,
    data_model_url: input.data_model_url || undefined,
    json: input.json_output === true
  });
  return result;
}

const TOOL_MAP = {
  audit_repo: handleAuditRepo,
  get_trust_score: handleGetTrustScore,
  get_coverage: handleGetCoverage,
  generate_ado_items: handleGenerateAdoItems,
  scan_portfolio: handleScanPortfolio,
  model_audit: handleModelAudit,
  dependency_audit: handleDependencyAudit
};

// ── Server Factory ──────────────────────────────────────────────────────────────

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /health
    if (req.method === "GET" && pathname === "/health") {
      return jsonResp(res, 200, {
        status: "ok",
        service: "eva-veritas-mcp",
        tool_count: TOOLS.length,
        uptime_seconds: Math.floor(process.uptime())
      });
    }

    // GET /tools  -- MCP-compatible tool manifest
    if (req.method === "GET" && pathname === "/tools") {
      return jsonResp(res, 200, { tools: TOOLS });
    }

    // POST /tools/{name}  -- invoke a tool
    const toolMatch = pathname.match(/^\/tools\/([^/]+)$/);
    if (req.method === "POST" && toolMatch) {
      const toolName = decodeURIComponent(toolMatch[1]);
      const handler = TOOL_MAP[toolName];

      if (!handler) {
        return jsonResp(res, 404, {
          error: `Unknown tool: ${toolName}`,
          available: Object.keys(TOOL_MAP)
        });
      }

      let input;
      try {
        input = await readBody(req);
      } catch (err) {
        return jsonResp(res, 400, { error: err.message });
      }

      try {
        const result = await handler(input);
        return jsonResp(res, 200, { tool: toolName, result });
      } catch (err) {
        return jsonResp(res, 500, {
          tool: toolName,
          error: err.message
        });
      }
    }

    return jsonResp(res, 404, {
      error: `Route not found: ${req.method} ${pathname}`,
      routes: ["GET /health", "GET /tools", "POST /tools/{name}"]
    });
  });
}

function startServer(port) {
  const p = port || parseInt(process.env.MCP_PORT || "8030", 10);
  const server = createServer();
  server.listen(p, () => {
    console.log(`[INFO] eva-veritas MCP server listening on http://localhost:${p}`);
    console.log(`[INFO] Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
    console.log(`[INFO] Manifest: GET  http://localhost:${p}/tools`);
    console.log(`[INFO] Invoke:   POST http://localhost:${p}/tools/{name}`);
  });
  return server;
}

module.exports = { createServer, startServer, startStdio, TOOLS };

// ── stdio MCP transport (VS Code managed lifecycle) ───────────────────────────────
/**
 * MCP JSON-RPC 2.0 over stdin/stdout.
 * VS Code starts/stops this process automatically -- no port, no manual startup.
 * stdout is reserved for JSON-RPC messages; all logs go to stderr.
 */
async function startStdio() {
  // Redirect all console.log to stderr so stdout stays clean for JSON-RPC
  const origLog = console.log;
  console.log = (...a) => process.stderr.write(a.join(" ") + "\n");

  process.stdin.setEncoding("utf8");
  let buffer = "";

  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  function respond(id, result) {
    send({ jsonrpc: "2.0", id, result });
  }

  function respondError(id, code, message) {
    send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete trailing fragment

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let req;
      try { req = JSON.parse(trimmed); } catch (_) { continue; }

      const { id, method, params } = req;

      if (method === "initialize") {
        respond(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "eva-veritas", version: "1.0.0" }
        });
      } else if (method === "notifications/initialized") {
        // notification — no response
      } else if (method === "ping") {
        respond(id, {});
      } else if (method === "tools/list") {
        respond(id, { tools: TOOLS });
      } else if (method === "tools/call") {
        const toolName = params && params.name;
        const handler = toolName && TOOL_MAP[toolName];
        if (!handler) {
          respondError(id, -32602, `Unknown tool: ${toolName}`);
          continue;
        }
        try {
          const result = await handler(params.arguments || {});
          respond(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          });
        } catch (err) {
          respondError(id, -32603, err.message);
        }
      } else {
        respondError(id, -32601, `Method not found: ${method}`);
      }
    }
  });

  process.stdin.on("end", () => process.exit(0));
  process.stderr.write("[INFO] eva-veritas MCP stdio ready\n");
}

// Direct execution: node src/mcp-server.js [--stdio | --port N]
if (require.main === module) {
  if (process.argv.includes("--stdio")) {
    startStdio();
  } else {
    const portArg = process.argv.find((a) => a.startsWith("--port="));
    const portFlag = process.argv.indexOf("--port");
    const port =
      portArg ? parseInt(portArg.split("=")[1], 10)
      : portFlag !== -1 ? parseInt(process.argv[portFlag + 1], 10)
      : undefined;
    startServer(port);
  }
}
