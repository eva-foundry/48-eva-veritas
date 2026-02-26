// EVA-STORY: EO-11-001
// EVA-FEATURE: EO-11
"use strict";

/**
 * infer-plan.js
 *
 * Heuristic doc-to-plan extractor.
 * Reads README.md, PLAN.md (any heading format), and docs/YYYYMMDD-plan.md.
 * Produces a { features, stories } decomposition without requiring any reformat.
 *
 * Supported source formats:
 *   - veritas native:   ## Feature: <title> [ID=XX-01] / ### Story: <title> [ID=XX-01-001]
 *   - phase/sprint:     ## Phase N - <title>  /  ### <step>  /  - [ ] <task>
 *   - free-form:        ## <any heading>  as feature,  ### <any heading> as story
 */

const fs = require("fs");
const path = require("path");
const { readTextIfExists } = require("./fs-utils");

// ── ID helpers ────────────────────────────────────────────────────────────────

const ID_RE = /[\[(]ID\s*=\s*([A-Z0-9-]+)[\])]/i;

function extractInlineId(text) {
  const m = ID_RE.exec(text);
  return m ? m[1].toUpperCase() : null;
}

function stripInlineId(text) {
  return text.replace(/\s*[\[(]ID\s*=\s*[A-Z0-9-]+[\])]\s*/gi, "").trim();
}

// ── Prefix derivation ─────────────────────────────────────────────────────────

/**
 * Derive project-specific prefix from folder name.
 *   "29-foundry"       → "F29"
 *   "33-eva-brain-v2"  → "F33"
 *   "48-eva-veritas"   → "F48"
 *   "my-project"       → "MP"  (initials fallback)
 */
function derivePrefix(repoPath) {
  const base = path.basename(path.resolve(repoPath));
  const numMatch = /^(\d+)[-_]/.exec(base);
  if (numMatch) return `F${numMatch[1]}`;
  // initials fallback
  const initials = base
    .split(/[-_]/)
    .map((w) => w[0]?.toUpperCase())
    .filter(Boolean)
    .join("");
  return initials || "F";
}

// ── Core markdown parser ──────────────────────────────────────────────────────

/**
 * Walk markdown lines and extract a 4-level hierarchy.
 *
 * ADO hierarchy:
 *   ## heading  → Feature
 *   ### heading → User Story         (scored by MTI)
 *   #### heading → Task              (NOT scored — implementation detail)
 *   - [ ] under h3 → Task           (NOT scored)
 *   - [ ] under h2 only (no h3) → User Story  (they ARE the decomp level)
 *
 * Preserves any [ID=XX-NN-NNN] annotations, auto-generates IDs for the rest.
 */
function inferFromMarkdown(md, prefix) {
  const lines = md.split(/\r?\n/);
  const features = [];
  const stories = [];
  const tasks = [];

  let currentFeature = null;
  let currentStory = null;
  let featureIdx = 0;
  let localStoryIdx = 0;
  let localTaskIdx = 0;

  function mkFeatureId() {
    featureIdx++;
    return `${prefix}-${String(featureIdx).padStart(2, "0")}`;
  }

  function mkStoryId() {
    localStoryIdx++;
    const fid = currentFeature?.id || `${prefix}-00`;
    return `${fid}-${String(localStoryIdx).padStart(3, "0")}`;
  }

  function mkTaskId() {
    localTaskIdx++;
    const parent = currentStory?.id || currentFeature?.id || `${prefix}-00`;
    return `${parent}-T${String(localTaskIdx).padStart(2, "0")}`;
  }

  for (const line of lines) {
    // ── ## heading → Feature ──────────────────────────────────────────────
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const raw = h2[1].trim();
      const inlineId = extractInlineId(raw);
      const id = inlineId || mkFeatureId();
      const title = stripInlineId(raw)
        .replace(/^(Feature|Phase|Sprint|Epic)\s*[:–-]\s*/i, "")
        .trim();
      localStoryIdx = 0;
      localTaskIdx = 0;
      currentStory = null;
      currentFeature = { id, title: title || raw, source_heading: `## ${raw}` };
      features.push(currentFeature);
      continue;
    }

    // ── ### heading → User Story ──────────────────────────────────────────
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      const raw = h3[1].trim();
      const inlineId = extractInlineId(raw);
      const id = inlineId || mkStoryId();
      const title = stripInlineId(raw)
        .replace(/^(Story|Step|Task)\s*[:–-]\s*/i, "")
        .trim();
      localTaskIdx = 0;
      currentStory = {
        id,
        title: title || raw,
        feature_id: currentFeature?.id || null,
        source: "heading",
      };
      stories.push(currentStory);
      continue;
    }

    // ── #### heading → Task ───────────────────────────────────────────────
    const h4 = /^####\s+(.+)$/.exec(line);
    if (h4) {
      const raw = h4[1].trim();
      const inlineId = extractInlineId(raw);
      const id = inlineId || mkTaskId();
      const title = stripInlineId(raw).trim();
      tasks.push({
        id,
        title: title || raw,
        story_id: currentStory?.id || null,
        feature_id: currentFeature?.id || null,
        source: "heading",
      });
      continue;
    }

    // ── checklist item → Task (if under h3) or Story (if directly under h2) ─
    const check = /^\s*-\s*\[( |x|X)\]\s+(.+)$/.exec(line);
    if (check) {
      const raw = check[2].trim();
      const done = check[1].toLowerCase() === "x";
      const inlineId = extractInlineId(raw);
      const title = stripInlineId(raw);

      if (currentStory) {
        // Under an h3 → Task
        const id = inlineId || mkTaskId();
        tasks.push({
          id,
          title,
          story_id: currentStory.id,
          feature_id: currentFeature?.id || null,
          done,
          source: "checklist",
        });
      } else {
        // Directly under h2 (no h3 yet) → User Story
        const id = inlineId || mkStoryId();
        currentStory = null; // checklist stories don't own sub-tasks
        stories.push({
          id,
          title,
          feature_id: currentFeature?.id || null,
          done,
          source: "checklist",
        });
      }
    }
  }

  return { features, stories, tasks };
}

// ── Source selection + merge ──────────────────────────────────────────────────

/**
 * Find the latest YYYYMMDD-plan.md in docs/ directory.
 */
function findLatestDatedPlan(repoPath) {
  const docsDir = path.join(repoPath, "docs");
  if (!fs.existsSync(docsDir)) return null;
  try {
    const files = fs
      .readdirSync(docsDir)
      .filter((f) => /^\d{8}-plan\.md$/i.test(f))
      .sort()
      .reverse();
    return files.length ? path.join(docsDir, files[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Detect the format in a markdown string.
 * Returns: "veritas" | "phase-sprint" | "free-form" | "empty"
 */
function detectFormat(md) {
  if (!md || md.trim().length < 20) return "empty";
  if (/^##\s+Feature\s*:/im.test(md)) return "veritas";
  if (/^##\s+(Phase|Sprint)\s+\d+/im.test(md)) return "phase-sprint";
  if (/^##\s+/m.test(md)) return "free-form";
  return "empty";
}

/**
 * Main entry point.
 *
 * Returns:
 *   { prefix, generated_from[], format_detected, features[], stories[] }
 */
function inferPlan(repoPath, opts = {}) {
  const absPath = path.resolve(repoPath);
  const prefix = opts.prefix || derivePrefix(absPath);

  const sources = [];
  let chosenMd = null;
  let chosenLabel = null;

  // Priority: latest dated plan > PLAN.md > README.md
  const datedPlanPath = findLatestDatedPlan(absPath);
  const datedPlanMd = datedPlanPath ? readTextIfExists(datedPlanPath) : null;
  const planMd = readTextIfExists(path.join(absPath, "PLAN.md"));
  const readmeMd = readTextIfExists(path.join(absPath, "README.md"));

  if (datedPlanMd && detectFormat(datedPlanMd) !== "empty") {
    chosenMd = datedPlanMd;
    chosenLabel = path.relative(absPath, datedPlanPath).replace(/\\/g, "/");
    sources.push(chosenLabel);
  } else if (planMd && detectFormat(planMd) !== "empty") {
    chosenMd = planMd;
    chosenLabel = "PLAN.md";
    sources.push("PLAN.md");
  } else if (readmeMd) {
    chosenMd = readmeMd;
    chosenLabel = "README.md";
    sources.push("README.md");
  }

  if (!chosenMd) {
    return {
      prefix,
      generated_from: [],
      format_detected: "none",
      features: [],
      stories: [],
      _note: "No source documents found",
    };
  }

  const format = detectFormat(chosenMd);
  const inferred = inferFromMarkdown(chosenMd, prefix);

  // If the main source had zero stories AND zero tasks but README has checklist items, supplement
  if (inferred.stories.length === 0 && inferred.tasks.length === 0 && chosenLabel !== "README.md" && readmeMd) {
    const readmeInferred = inferFromMarkdown(readmeMd, prefix);
    if (readmeInferred.stories.length > 0) {
      sources.push("README.md (story fallback)");
      for (const s of readmeInferred.stories) inferred.stories.push(s);
      for (const t of readmeInferred.tasks) inferred.tasks.push(t);
    }
  }

  return {
    prefix,
    generated_from: sources,
    format_detected: format,
    features: inferred.features,
    stories: inferred.stories,
    tasks: inferred.tasks,
  };
}

module.exports = { inferPlan, derivePrefix, detectFormat };
