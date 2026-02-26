// EVA-STORY: EO-05-006
// EVA-FEATURE: EO-05
"use strict";

const fs = require("fs");
const path = require("path");
const { discover } = require("./discover");
const { reconcile } = require("./reconcile");
const { computeTrust } = require("./compute-trust");
const { readJsonIfExists } = require("./lib/fs-utils");

/**
 * Scan all numbered EVA project folders under a portfolio root.
 * Outputs a portfolio-wide MTI table to console.
 */
async function scanPortfolio(opts) {
  const portfolioRoot = path.resolve(opts.portfolio || process.cwd());
  const filterIds = opts.filter
    ? opts.filter.split(",").map((s) => s.trim())
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
    ? projectDirs.filter((d) => filterIds.some((id) => d.startsWith(id + "-") || d.startsWith(id)))
    : projectDirs;

  if (filtered.length === 0) {
    console.log("[WARN] No numbered project folders found under: " + portfolioRoot);
    return;
  }

  console.log("");
  console.log("===========================================");
  console.log(`EVA Portfolio Scan: ${portfolioRoot}`);
  console.log(`Projects: ${filtered.length}`);
  console.log("===========================================");

  const results = [];

  for (const dir of filtered) {
    const repoPath = path.join(portfolioRoot, dir);
    const repoOpts = { repo: repoPath };

    let stories = 0;
    let coverage = 0;
    let score = null;
    let actions = ["add-governance"];
    let gapCount = 0;
    let status = "ok";
    let modelFidelity = null;

    try {
      await discover(repoOpts);
      await reconcile(repoOpts);
      await computeTrust(repoOpts);

      const trust = readJsonIfExists(path.join(repoPath, ".eva", "trust.json"));
      const recon = readJsonIfExists(path.join(repoPath, ".eva", "reconciliation.json"));

      if (trust) {
        score = trust.score;
        actions = trust.actions || [];
      }
      if (recon) {
        stories = recon.coverage?.stories_total ?? 0;
        coverage = recon.coverage?.stories_with_artifacts ?? 0;
        gapCount = (recon.gaps || []).filter(
          (g) => g.type !== "orphan_story_tag"
        ).length;
      }
      if (opts.model) {
        const fid = readJsonIfExists(path.join(repoPath, ".eva", "model-fidelity.json"));
        if (fid && !fid.error && typeof fid.model_fidelity_score === "number") {
          modelFidelity = fid.model_fidelity_score;
        }
      }
    } catch (err) {
      status = `error: ${err.message.split("\n")[0]}`;
    }

    const coverageDisplay = stories > 0 ? `${coverage}/${stories}` : "0/0";
    const scoreDisplay = score === null ? "null" : String(score);
    const actionDisplay = actions.join(",");

    results.push({ dir, stories, coverageDisplay, scoreDisplay, actionDisplay, gapCount, status, modelFidelity });
  }

  // Print table
  console.log("");
  const showModel = opts.model === true;
  console.log(
    padR("Project", 32) +
    padL("Stories", 9) +
    padL("Coverage", 10) +
    padL("MTI", 7) +
    padL("Gaps", 6) +
    (showModel ? padL("MODEL-FID", 11) : "") +
    "  Actions"
  );
  console.log("-".repeat(showModel ? 91 : 80));

  let totalScore = 0;
  let scoredCount = 0;

  for (const r of results) {
    if (r.status !== "ok") {
      console.log(padR(r.dir, 32) + "  [ERROR] " + r.status);
      continue;
    }
    if (r.scoreDisplay !== "null") {
      totalScore += Number(r.scoreDisplay);
      scoredCount += 1;
    }
    const fidDisplay = showModel
      ? padL(r.modelFidelity !== null ? r.modelFidelity + "%" : "-", 11)
      : "";
    console.log(
      padR(r.dir, 32) +
      padL(r.stories === 0 ? "-" : String(r.stories), 9) +
      padL(r.coverageDisplay, 10) +
      padL(r.scoreDisplay, 7) +
      padL(String(r.gapCount), 6) +
      fidDisplay +
      "  " + r.actionDisplay
    );
  }

  const portfolioMti = scoredCount > 0 ? Math.round(totalScore / scoredCount) : null;
  const ungoverned = results.filter((r) => r.scoreDisplay === "null" && r.status === "ok");
  console.log("-".repeat(80));
  console.log(
    padR(`Portfolio MTI (${scoredCount} governed projects)`, 42) +
    padL(portfolioMti === null ? "null" : String(portfolioMti), 7)
  );
  console.log("");

  if (ungoverned.length > 0) {
    console.log(`[HINT] ${ungoverned.length} project(s) scored null -- no Feature/Story headings found in PLAN.md.`);
    console.log("       To govern a project, add PLAN.md with this format:");
    console.log("");
    console.log("  ## Feature: <Title> [ID=XX-01]");
    console.log("  ### Story: <Title> [ID=XX-01-001]");
    console.log("");
    console.log("       Then add a STATUS.md story-status block:");
    console.log("");
    console.log("  FEATURE XX-01: In Progress");
    console.log("  STORY XX-01-001: Done");
    console.log("");
    console.log("       Tag source files to link artifacts:");
    console.log("");
      console.log("  # EVA-STORY: <STORY-ID>   (Python/PS1)");
      console.log("  // EVA-STORY: <STORY-ID>  (JS/TS)");
    console.log("");
    console.log("       Ungoverned projects: " + ungoverned.map((r) => r.dir).join(", "));
    console.log("");
  }
}

function padR(s, n) {
  return String(s).substring(0, n).padEnd(n);
}
function padL(s, n) {
  return String(s).padStart(n);
}

module.exports = { scanPortfolio };
