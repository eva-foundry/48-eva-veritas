// EVA-STORY: EO-09-002
// EVA-FEATURE: EO-09
"use strict";

/**
 * code-parser.js — extracts stories from code structure (routes, pages, resources, functions).
 *
 * Additive enrichment: called when plan is thin (< 20 stories) but codebase is large (> 100 files).
 * Never removes existing plan stories. Generates CS- namespace stories from code patterns.
 *
 * Story ID format: {prefix}-{DOMAIN}-{seq}
 *   e.g. CS-CHAT-001, CS-INFRA-001, CS-UI-001, CS-OPS-001
 */

const fs = require("fs");
const path = require("path");
const fg = require("fast-glob");

const IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.eva/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.venv/**",
  "**/__pycache__/**",
];

// Patterns  ──────────────────────────────────────────────────────────────────

// FastAPI/Flask: @router.get('/path') or @app.route('/path') or @app.post('/path')
const PYTHON_ROUTE_RE = /@(?:router|app)\.(?:get|post|put|delete|patch|head|options|route)\(\s*["'](\/[^"']*)/gi;

// Express: router.get('/path') or app.get('/path')
const EXPRESS_ROUTE_RE = /(?:router|app)\s*\.\s*(?:get|post|put|delete|patch|head|options)\s*\(\s*["'](\/[^"']*)/gi;

// Next.js: export async function GET/POST/etc (route handlers)
const NEXTJS_EXPORT_RE = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/gm;

// React Router: <Route path="..." or <Route path='...'
const REACT_ROUTE_RE = /<Route[^>]+path=["']([^"']+)["']/gi;

// Terraform: resource "azurerm_type" "name"
const TF_RESOURCE_RE = /^resource\s+"(azurerm_[^"]+)"\s+"([^"]+)"/gm;

// Shell functions: function foo() or foo ()
const SHELL_FN_RE = /^(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)\s*\{/gm;

// ────────────────────────────────────────────────────────────────────────────

/**
 * Derive a terse domain token from a URL path.
 * /v1/chat/messages → "CHAT"
 * /api/users/{id} → "USERS"
 * / or /health → "API"
 */
function routeToDomain(routePath) {
  const skip = new Set(["v1", "v2", "v3", "api", "rest", "graphql", ""]);
  const segments = (routePath || "/").replace(/^\//, "").split("/");
  for (const seg of segments) {
    const clean = seg.replace(/[{}]/g, "").replace(/[^\w]/g, "").toUpperCase();
    if (clean && !skip.has(clean.toLowerCase()) && !/^\d+$/.test(clean)) {
      return clean.slice(0, 12); // max 12 chars for story ID safety
    }
  }
  return "API";
}

/**
 * Derive domain from a Next.js route file path.
 * app/api/chat/route.ts → "CHAT"
 */
function nextjsFileToDomain(relPath) {
  // Strip "app/" prefix and "route.ts/js" suffix, take first meaningful segment
  const parts = relPath.replace(/\\/g, "/").replace(/^app\//, "").split("/");
  return routeToDomain("/" + parts.slice(0, -1).join("/"));
}

/**
 * Derive domain from React page filename.
 * src/pages/dashboard.tsx → "DASHBOARD"
 */
function pageFileToDomain(relPath) {
  const base = path.basename(relPath, path.extname(relPath));
  return base.replace(/[^\w]/g, "").toUpperCase().slice(0, 12) || "PAGE";
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when code-parser enrichment should be triggered.
 * Trigger: fewer than 20 plan stories AND more than 100 source files.
 */
function shouldEnrich(storyCount, fileCount) {
  return storyCount < 20 && fileCount > 100;
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse code structure and return EVA stories grouped by feature.
 *
 * @param {string} repoPath  Absolute path to the repo.
 * @param {string} [prefix]  Project ID prefix for generated IDs (default: "CS").
 * @returns {{ features: object[], stories: object[] }}
 */
async function parseCodeStructure(repoPath, prefix = "CS") {
  prefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "CS";

  const featureMap = new Map(); // domain → feature object
  const stories = [];
  const counters = new Map(); // domain → integer sequence

  function ensureFeature(domain, titleHint) {
    const fid = `${prefix}-${domain}`;
    if (!featureMap.has(fid)) {
      featureMap.set(fid, {
        id: fid,
        title: titleHint || domainToTitle(domain),
        source: "code-structure",
      });
    }
    return fid;
  }

  function addStory(domain, title, titleHint) {
    const fid = ensureFeature(domain, titleHint);
    const seq = (counters.get(fid) || 0) + 1;
    counters.set(fid, seq);
    const sid = `${fid}-${String(seq).padStart(3, "0")}`;
    stories.push({
      id: sid,
      title: title.slice(0, 80),
      feature_id: fid,
      done: false,
      source: "code-structure",
    });
  }

  // ── Python (FastAPI / Flask) ─────────────────────────────────────────────
  const pyFiles = await fg("**/*.py", { cwd: repoPath, ignore: IGNORE, onlyFiles: true });
  for (const f of pyFiles) {
    const content = safeRead(path.join(repoPath, f));
    if (!content) continue;

    PYTHON_ROUTE_RE.lastIndex = 0;
    let m;
    while ((m = PYTHON_ROUTE_RE.exec(content)) !== null) {
      const domain = routeToDomain(m[1]);
      addStory(domain, `${methodFromRoute(m[0])} ${m[1]}`, `${domain} API`);
    }
  }

  // ── JavaScript / TypeScript (Express) ───────────────────────────────────
  const jsFiles = await fg(["**/*.js", "**/*.ts"], {
    cwd: repoPath, ignore: IGNORE, onlyFiles: true
  });
  for (const f of jsFiles) {
    // Skip Next.js route files (handled separately)
    if (/app\/.*route\.[jt]s$/.test(f)) continue;
    const content = safeRead(path.join(repoPath, f));
    if (!content) continue;

    EXPRESS_ROUTE_RE.lastIndex = 0;
    let m;
    while ((m = EXPRESS_ROUTE_RE.exec(content)) !== null) {
      const domain = routeToDomain(m[1]);
      addStory(domain, `${methodFromRoute(m[0])} ${m[1]}`, `${domain} API`);
    }
  }

  // ── Next.js route handlers ───────────────────────────────────────────────
  const nextFiles = await fg(["app/**/route.ts", "app/**/route.js"], {
    cwd: repoPath, ignore: IGNORE, onlyFiles: true
  });
  for (const f of nextFiles) {
    const content = safeRead(path.join(repoPath, f));
    if (!content) continue;
    const domain = nextjsFileToDomain(f);

    NEXTJS_EXPORT_RE.lastIndex = 0;
    let m;
    while ((m = NEXTJS_EXPORT_RE.exec(content)) !== null) {
      addStory(domain, `${m[1]} ${f.replace("app/", "/")}`, `${domain} API`);
    }
  }

  // ── React Router (App.tsx / App.jsx) ────────────────────────────────────
  const routerFiles = await fg(["**/App.tsx", "**/App.jsx", "**/App.js"], {
    cwd: repoPath, ignore: IGNORE, onlyFiles: true
  });
  for (const f of routerFiles) {
    const content = safeRead(path.join(repoPath, f));
    if (!content) continue;

    REACT_ROUTE_RE.lastIndex = 0;
    let m;
    while ((m = REACT_ROUTE_RE.exec(content)) !== null) {
      if (m[1] === "/" || m[1] === "*") continue; // skip trivial catch-alls
      addStory("UI", `Route ${m[1]}`, "UI Pages");
    }
  }

  // ── React pages (file-based routing) ────────────────────────────────────
  const pageFiles = await fg(["src/pages/**/*.tsx", "src/pages/**/*.jsx", "pages/**/*.tsx"], {
    cwd: repoPath, ignore: IGNORE, onlyFiles: true
  });
  for (const f of pageFiles) {
    const base = path.basename(f, path.extname(f));
    if (base.startsWith("_") || base.startsWith("[")) continue; // skip _app, _document, [slug]
    const domain = pageFileToDomain(f);
    addStory("UI", `${domain} page`, "UI Pages");
  }

  // ── Terraform ────────────────────────────────────────────────────────────
  const tfFiles = await fg("**/*.tf", { cwd: repoPath, ignore: IGNORE, onlyFiles: true });
  for (const f of tfFiles) {
    const content = safeRead(path.join(repoPath, f));
    if (!content) continue;

    TF_RESOURCE_RE.lastIndex = 0;
    let m;
    while ((m = TF_RESOURCE_RE.exec(content)) !== null) {
      addStory("INFRA", `${m[1]} "${m[2]}"`, "Infrastructure Resources");
    }
  }

  // ── Shell scripts ────────────────────────────────────────────────────────
  const shFiles = await fg(["**/*.sh", "**/*.bash"], {
    cwd: repoPath, ignore: IGNORE, onlyFiles: true
  });
  for (const f of shFiles) {
    const content = safeRead(path.join(repoPath, f));
    if (!content) continue;

    SHELL_FN_RE.lastIndex = 0;
    let m;
    while ((m = SHELL_FN_RE.exec(content)) !== null) {
      const fnName = m[1];
      if (SHELL_SKIP.has(fnName)) continue;
      addStory("OPS", `${fnName}()`, "Operations Scripts");
    }
  }

  return {
    features: Array.from(featureMap.values()),
    stories,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const SHELL_SKIP = new Set(["main", "usage", "help", "debug", "log", "error", "warn", "info"]);

function safeRead(absPath) {
  try { return fs.readFileSync(absPath, "utf8"); } catch (_) { return null; }
}

function methodFromRoute(snippet) {
  const m = /\.(get|post|put|delete|patch|head|options|route)/i.exec(snippet);
  if (!m) return "ANY";
  const v = m[1].toLowerCase();
  return v === "route" ? "ANY" : v.toUpperCase();
}

function domainToTitle(domain) {
  if (domain === "UI") return "UI Pages";
  if (domain === "INFRA") return "Infrastructure Resources";
  if (domain === "OPS") return "Operations Scripts";
  if (domain === "API") return "API Endpoints";
  return domain.charAt(0) + domain.slice(1).toLowerCase() + " API";
}

module.exports = { parseCodeStructure, shouldEnrich };
