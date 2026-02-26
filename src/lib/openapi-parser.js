// EVA-STORY: EO-09-003
// EVA-FEATURE: EO-09
"use strict";

/**
 * openapi-parser.js — imports an OpenAPI 2/3 or Swagger spec as veritas stories.
 *
 * Probes for: openapi.json, swagger.json, openapi.yaml, swagger.yaml
 * in repo root and docs/. First match wins.
 *
 * Output: flat { features: [], stories: [] } using 3-part story IDs.
 * Story IDs: {prefix}-{DOMAIN}-{seq}
 * Feature IDs: {prefix}-{DOMAIN}
 *
 * Source tag: "openapi" — treated as stronger signal than code-structure.
 */

const fs = require("fs");
const path = require("path");

// Probing locations for OpenAPI specs
const PROBE_NAMES = [
  "openapi.json",
  "swagger.json",
  "openapi.yaml",
  "openapi.yml",
  "swagger.yaml",
  "swagger.yml",
];
const PROBE_DIRS = ["", "docs", "api"];

/**
 * Find the first OpenAPI spec file in the repo. Returns null if none found.
 */
function findSpec(repoPath) {
  for (const dir of PROBE_DIRS) {
    for (const name of PROBE_NAMES) {
      const candidate = path.join(repoPath, dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Minimal YAML parser (key: value only, no nesting). Used to handle simple
 * openapi.yaml without adding a YAML dependency.
 * For real-world specs, prefer JSON variants or provide openapi.json.
 */
function parseYamlPaths(content) {
  // We only need the top-level "paths" keys.
  // Extract section between "paths:" and the next top-level key.
  const m = /^paths:\n((?:  [^\n]*\n)*)/m.exec(content);
  if (!m) return {};
  const paths = {};
  const pathKeyRe = /^  (\/[^\s:]+):/gm;
  let pk;
  while ((pk = pathKeyRe.exec(m[1])) !== null) {
    paths[pk[1]] = {};
  }
  return paths;
}

/**
 * Extract domain token from a route path (same logic as code-parser).
 * /v1/chat/messages → "CHAT"
 */
function routeToDomain(routePath) {
  const skip = new Set(["v1", "v2", "v3", "api", "rest", ""]);
  const segments = (routePath || "/").replace(/^\//, "").split("/");
  for (const seg of segments) {
    const clean = seg.replace(/[{}]/g, "").replace(/[^\w]/g, "").toUpperCase();
    if (clean && !skip.has(clean.toLowerCase()) && !/^\d+$/.test(clean)) {
      return clean.slice(0, 12);
    }
  }
  return "API";
}

/**
 * Parse OpenAPI/Swagger spec and return EVA features + stories.
 *
 * @param {string} repoPath  Absolute repo path.
 * @param {string} [prefix]  Story ID prefix (default: "OA").
 * @returns {{ features: object[], stories: object[], specPath: string|null }}
 */
function parseOpenApi(repoPath, prefix = "OA") {
  prefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "OA";

  const specPath = findSpec(repoPath);
  if (!specPath) return { features: [], stories: [], specPath: null };

  let spec;
  try {
    const content = fs.readFileSync(specPath, "utf8");
    if (specPath.endsWith(".json")) {
      spec = JSON.parse(content);
    } else {
      // Lightweight YAML: extract paths keys only
      spec = { paths: parseYamlPaths(content) };
    }
  } catch (e) {
    console.log(`[WARN] openapi-parser: could not parse ${specPath}: ${e.message}`);
    return { features: [], stories: [], specPath: null };
  }

  const rawPaths = spec.paths || {};
  const featureMap = new Map();
  const stories = [];
  const counters = new Map();

  for (const [routePath, pathItem] of Object.entries(rawPaths)) {
    const domain = routeToDomain(routePath);
    const fid = `${prefix}-${domain}`;
    if (!featureMap.has(fid)) {
      featureMap.set(fid, {
        id: fid,
        title: domain === "API" ? "API Endpoints"
          : domain.charAt(0) + domain.slice(1).toLowerCase() + " API",
        source: "openapi",
      });
    }

    const methods = typeof pathItem === "object" && pathItem !== null
      ? Object.keys(pathItem).filter((k) =>
          ["get", "post", "put", "delete", "patch", "head", "options"].includes(k.toLowerCase())
        )
      : ["any"];

    // If no HTTP methods found (e.g. YAML parse didn't go deep), still add one story
    const effectiveMethods = methods.length > 0 ? methods : ["any"];

    for (const method of effectiveMethods) {
      const seq = (counters.get(fid) || 0) + 1;
      counters.set(fid, seq);
      const sid = `${fid}-${String(seq).padStart(3, "0")}`;

      // Derive human title from operationId or method + path
      const op = typeof pathItem[method] === "object" ? pathItem[method] : {};
      const title = op.summary || op.operationId
        ? (op.summary || op.operationId).slice(0, 80)
        : `${method.toUpperCase()} ${routePath}`.slice(0, 80);

      stories.push({
        id: sid,
        title,
        feature_id: fid,
        done: false,
        source: "openapi",
      });
    }
  }

  return {
    features: Array.from(featureMap.values()),
    stories,
    specPath,
  };
}

module.exports = { parseOpenApi, findSpec };
