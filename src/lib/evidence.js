"use strict";

/**
 * evidence.js — mines external evidence sources (git commits, GitHub PRs, implicit filenames).
 *
 * Return shape (all functions return the same map):
 *   { [storyId]: [ { sha, snippet, source } ] }
 *
 * source values: "commit" | "pr" | "filename"
 */

const { spawnSync } = require("child_process");
const https = require("https");

// Matches EVA story IDs like EO-05-001, F33-01-001, LP-12-099
const STORY_ID_RE = /\b([A-Z]{2,6}-\d{2,3}-\d{3})\b/g;

// ─────────────────────────────────────────────────────────────────────────────
// Commit mining
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan git log --oneline for story ID references.
 * @param {string}   repoPath   Absolute path to the git repository root.
 * @param {string[]} knownIds   Array of story IDs to match against.
 * @returns {{ [storyId: string]: Array<{sha:string, snippet:string, source:string}> }}
 */
function mineCommits(repoPath, knownIds) {
  const map = {};
  const known = new Set(knownIds);

  let stdout;
  try {
    const r = spawnSync(
      "git",
      ["log", "--oneline", "--all", "--no-merges", "--max-count=2000"],
      { cwd: repoPath, encoding: "utf8", timeout: 10_000 }
    );
    // status !== 0 → not a git repo, or no commits → graceful empty
    if (r.status !== 0 || !r.stdout) return map;
    stdout = r.stdout;
  } catch (_) {
    return map;
  }

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const sha = line.slice(0, 7);
    const message = line.slice(8);

    STORY_ID_RE.lastIndex = 0;
    let m;
    while ((m = STORY_ID_RE.exec(message)) !== null) {
      const id = m[1];
      if (!known.has(id)) continue;
      if (!map[id]) map[id] = [];
      if (!map[id].some((e) => e.sha === sha)) {
        map[id].push({ sha, snippet: message.slice(0, 80), source: "commit" });
      }
    }
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub PR mining (async, gated on GITHUB_TOKEN + github.com remote)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan closed GitHub PRs for story ID references.
 * Returns {} silently if GITHUB_TOKEN is unset or remote is not github.com.
 */
async function minePRs(repoPath, knownIds) {
  const map = {};
  const token = process.env.GITHUB_TOKEN;
  if (!token) return map;

  // Resolve owner/repo from git remote
  let owner, repo;
  try {
    const r = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
      encoding: "utf8",
      timeout: 5_000,
    });
    const url = (r.stdout || "").trim();
    const match = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
    if (!match) return map;
    owner = match[1];
    repo = match[2];
  } catch (_) {
    return map;
  }

  const known = new Set(knownIds);

  // Paginate up to 3 pages = 300 closed PRs
  for (let page = 1; page <= 3; page++) {
    let prs;
    try {
      prs = await _githubGet(
        `/repos/${owner}/${repo}/pulls?state=closed&per_page=100&page=${page}`,
        token
      );
    } catch (_) {
      break;
    }
    if (!Array.isArray(prs) || prs.length === 0) break;

    for (const pr of prs) {
      const text = `${pr.title || ""} ${pr.body || ""}`;
      STORY_ID_RE.lastIndex = 0;
      let m;
      while ((m = STORY_ID_RE.exec(text)) !== null) {
        const id = m[1];
        if (!known.has(id)) continue;
        if (!map[id]) map[id] = [];
        const ref = `PR#${pr.number}`;
        if (!map[id].some((e) => e.sha === ref)) {
          map[id].push({
            sha: ref,
            snippet: (pr.title || "").slice(0, 80),
            source: "pr",
          });
        }
      }
    }

    if (prs.length < 100) break;
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge multiple evidence maps into one, concatenating entry arrays.
 * @param {...Object} maps
 */
function mergeEvidenceMaps(...maps) {
  const merged = {};
  for (const m of maps) {
    for (const [id, entries] of Object.entries(m || {})) {
      if (!merged[id]) merged[id] = [];
      merged[id].push(...entries);
    }
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function _githubGet(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path,
      method: "GET",
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "eva-veritas",
        Accept: "application/vnd.github.v3+json",
      },
    };
    const req = https.request(opts, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () =>
      req.destroy(new Error("GitHub API timeout"))
    );
    req.end();
  });
}

module.exports = { mineCommits, minePRs, mergeEvidenceMaps };
