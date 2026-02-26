// EVA-STORY: EO-05-008
// EVA-STORY: EO-11-004
// EVA-FEATURE: EO-05
// EVA-FEATURE: EO-11
"use strict";

/**
 * init.js — interactive eva onboarding wizard.
 *
 * Detects project structure, guides the user through plan setup,
 * and runs the first audit to display the initial MTI score.
 *
 * Usage:
 *   eva init --repo .
 *   eva init --repo . --yes          # non-interactive (all defaults)
 *   eva init --repo . --prefix F33   # override project ID prefix
 */

const path = require("path");
const fs   = require("fs");
const { generatePlan } = require("./generate-plan");
const { audit }        = require("./audit");
const { loadConfig }   = require("./lib/config");

// ─────────────────────────────────────────────────────────────────────────────
// Project structure detection
// ─────────────────────────────────────────────────────────────────────────────

function detectStructure(repoPath) {
  const has = (f) => fs.existsSync(path.join(repoPath, f));
  const detected = [];

  if (has("package.json"))          detected.push("Node.js");
  if (has("requirements.txt") || has("pyproject.toml") || has("setup.py"))
                                    detected.push("Python");
  if (has("go.mod"))                detected.push("Go");
  if (has("Cargo.toml"))            detected.push("Rust");
  if (has("pom.xml") || has("build.gradle"))
                                    detected.push("JVM");

  // Infrastructure
  const tfFiles = fs.existsSync(repoPath)
    ? fs.readdirSync(repoPath).filter((f) => f.endsWith(".tf"))
    : [];
  if (tfFiles.length > 0)           detected.push("Terraform");
  if (has("docker-compose.yml") || has("docker-compose.yaml"))
                                    detected.push("Docker");

  return detected.length > 0 ? detected : ["unknown"];
}

function detectPlanSource(repoPath) {
  const has = (f) => fs.existsSync(path.join(repoPath, f));

  if (has("PLAN.md"))        return "PLAN.md";
  if (has("docs/PLAN.md"))   return "docs/PLAN.md";
  if (has("README.md"))      return "README.md";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Readline helper
// ─────────────────────────────────────────────────────────────────────────────

async function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────────────────────

async function init(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const yes      = opts.yes === true;
  const config   = loadConfig(repoPath);

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║          eva-veritas Init Wizard             ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\n[INFO] Repo: ${repoPath}\n`);

  // ── Step 1: Detect structure ──────────────────────────────────────────────
  console.log("Step 1/5  Detecting project structure...");
  const techs = detectStructure(repoPath);
  console.log(`          Detected: ${techs.join(", ")}\n`);

  // ── Step 2: Plan source ───────────────────────────────────────────────────
  console.log("Step 2/5  Choosing plan source...");
  const autoSource = detectPlanSource(repoPath);
  let planSource;

  if (yes || !process.stdin.isTTY) {
    planSource = autoSource || "README.md";
    console.log(`          Using: ${planSource} (auto-selected)\n`);
  } else {
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const choices = [];
    if (autoSource) choices.push(autoSource);
    if (!choices.includes("README.md")) choices.push("README.md");
    choices.push("blank PLAN.md (create new)");
    choices.push("ADO CSV import");

    console.log("          Options:");
    choices.forEach((c, i) => console.log(`          [${i + 1}] ${c}`));
    const answer = await prompt(rl, `\n          Choice [1]: `);
    const idx = parseInt(answer, 10) || 1;
    planSource = choices[Math.min(idx - 1, choices.length - 1)];
    rl.close();
    console.log(`          Using: ${planSource}\n`);
  }

  // Handle blank PLAN.md creation
  if (planSource === "blank PLAN.md (create new)") {
    const prefix = opts.prefix || config.prefix || "PROJ";
    const planContent = blankPlan(prefix);
    const planPath = path.join(repoPath, "PLAN.md");
    if (!fs.existsSync(planPath)) {
      fs.writeFileSync(planPath, planContent, "utf8");
      console.log(`          Created: PLAN.md (edit it, then re-run: eva audit)\n`);
    } else {
      console.log(`          PLAN.md already exists. Edit it to add stories.\n`);
    }
    planSource = "PLAN.md";
  }

  // ── Step 3: Generate plan ─────────────────────────────────────────────────
  console.log("Step 3/5  Running eva generate-plan...");
  const prefix = opts.prefix || config.prefix || undefined;
  await generatePlan({ repo: repoPath, prefix, enrich: true });
  console.log("");

  // ── Step 4: Tag hint ──────────────────────────────────────────────────────
  console.log("Step 4/5  How to add your first evidence tag:");
  const planPath = path.join(repoPath, ".eva", "veritas-plan.json");
  let exampleId = "PROJ-01-001";
  if (fs.existsSync(planPath)) {
    try {
      const vp = JSON.parse(fs.readFileSync(planPath, "utf8"));
      const firstStory = (vp.features?.[0]?.stories)?.[0];
      if (firstStory?.id) exampleId = firstStory.id;
    } catch (_) {}
  }
  console.log(`\n          In any source file, add one of:`);
  console.log(`          # EVA-STORY: ${exampleId}            (Python/Shell)`);
  console.log(`          // EVA-STORY: ${exampleId}           (JS/TS/Java/C#)`);
  console.log(`          <!-- EVA-STORY: ${exampleId} -->      (HTML/XML)\n`);

  // ── Step 5: Initial audit ─────────────────────────────────────────────────
  console.log("Step 5/5  Running initial eva audit...\n");
  const threshold = opts.threshold ?? config.threshold ?? 70;
  await audit({ repo: repoPath, threshold, warnOnly: true });

  console.log("\n[PASS] Init complete!");
  console.log("       Next: eva audit --repo .   (score your repo after tagging)");
  console.log("       See:  .eva/trust.json, .eva/discovery.json");

  if (!fs.existsSync(path.join(repoPath, ".evarc.json"))) {
    console.log(`\n[HINT] Create .evarc.json to persist threshold + prefix:`);
    console.log(`       { "threshold": ${threshold}, "prefix": "${exampleId.split("-")[0]}" }`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Blank PLAN.md template
// ─────────────────────────────────────────────────────────────────────────────

function blankPlan(prefix) {
  return `# Plan

<!-- Created by eva init. Edit this file to describe your project features and stories. -->

## Feature 1 -- Core Functionality

As a user, I can do the primary thing.

### ${prefix}-01-001 -- First story

Description of the first story.

### ${prefix}-01-002 -- Second story

Description of the second story.

## Feature 2 -- Secondary Functionality

### ${prefix}-02-001 -- Another story

Description here.
`;
}

module.exports = { init };
