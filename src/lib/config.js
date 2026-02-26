// EVA-STORY: EO-05-006
// EVA-FEATURE: EO-05
"use strict";

/**
 * config.js — reads .evarc.json from repo root and merges with defaults.
 *
 * .evarc.json example:
 * {
 *   "threshold": 80,
 *   "prefix": "F33",
 *   "ignore": ["**\/migrations\/**"],
 *   "evidence_sources": ["commits", "tests", "evidence_dir"],
 *   "data_model_url": "http://localhost:8010"
 * }
 *
 * CLI flags always override .evarc values.
 */

const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  threshold: 70,
  prefix: null,
  ignore: [],
  evidence_sources: ["commits", "tests", "evidence_dir"],
  data_model_url: "http://localhost:8010",
};

/**
 * Load and merge .evarc.json for the given repo.
 * Returns a copy of DEFAULTS merged with any .evarc overrides.
 * Never throws — prints a warning on parse error and returns defaults.
 *
 * @param {string} repoPath  Absolute path to the repo root.
 * @returns {typeof DEFAULTS}
 */
function loadConfig(repoPath) {
  const evarcPath = path.join(repoPath, ".evarc.json");
  if (!fs.existsSync(evarcPath)) return { ...DEFAULTS };

  try {
    const raw = JSON.parse(fs.readFileSync(evarcPath, "utf8"));
    if (typeof raw !== "object" || raw === null) {
      throw new Error("root must be a JSON object");
    }
    return { ...DEFAULTS, ...raw };
  } catch (e) {
    console.log(`[WARN] .evarc.json parse error: ${e.message} — using defaults`);
    return { ...DEFAULTS };
  }
}

module.exports = { loadConfig, DEFAULTS };
