// EVA-STORY: EO-01-001
// EVA-FEATURE: EO-01
"use strict";

const path = require("path");
const yaml = require("js-yaml");
const { readTextIfExists } = require("./fs-utils");
const { extractHeadings } = require("./md-utils");

function parseProjectYaml(repoPath) {
  const ymlPath = path.join(repoPath, "project.yaml");
  const yml = readTextIfExists(ymlPath);
  if (!yml) return null;
  try {
    return yaml.load(yml);
  } catch (e) {
    return { _error: `Failed parsing project.yaml: ${e.message}` };
  }
}

function parseEpicFromReadme(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "README.md")) || "";
  const headings = extractHeadings(md);
  const title = headings.find((h) => h.level === 1)?.text || path.basename(repoPath);
  return {
    title,
    source: "README.md"
  };
}

/**
 * PLAN.md convention:
 *   ## Feature: <TITLE> [ID=EO-01]
 *   ### Story: <STORY TITLE> [ID=EO-01-001]
 */
function parsePlan(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "PLAN.md"));
  if (!md) return { features: [], stories: [], _note: "PLAN.md not found" };

  const headings = extractHeadings(md);

  let featureIndex = 0;
  let storyIndex = 0;

  const features = [];
  const stories = [];

  let currentFeature = null;

  for (const h of headings) {
    const isFeature = h.level === 2 && /^Feature\s*:\s*/i.test(h.text);
    const isStory = h.level === 3 && /^Story\s*:\s*/i.test(h.text);
    // Loose fallback: heading with [ID=...] that doesn't use "Feature:"/"Story:" prefix
    const looseId = extractInlineId(h.text);
    const isFeatureLoose = !isFeature && h.level === 2 && looseId !== null;
    const isStoryLoose = !isStory && h.level === 3 && looseId !== null;

    if (isFeature || isFeatureLoose) {
      // Override isFeature scope for title stripping below
      if (isFeatureLoose && !isFeature) {
        featureIndex += 1;
        const id = looseId || `F-${String(featureIndex).padStart(2, "0")}`;
        const cleanTitle = stripInlineId(h.text);
        currentFeature = { id, title: cleanTitle, source: "PLAN.md" };
        features.push(currentFeature);
        continue;
      }
    }
    if (isStory || isStoryLoose) {
      if (isStoryLoose && !isStory) {
        storyIndex += 1;
        const id = looseId || `S-${String(storyIndex).padStart(3, "0")}`;
        const cleanTitle = stripInlineId(h.text);
        stories.push({ id, title: cleanTitle, feature_id: currentFeature?.id || null, source: "PLAN.md" });
        continue;
      }
    }

    if (isFeature) {
      featureIndex += 1;
      const title = h.text.replace(/^Feature\s*:\s*/i, "").trim();
      const id = extractInlineId(title) || `F-${String(featureIndex).padStart(2, "0")}`;
      const cleanTitle = stripInlineId(title);

      currentFeature = { id, title: cleanTitle, source: "PLAN.md" };
      features.push(currentFeature);
    }

    if (isStory) {
      storyIndex += 1;
      const title = h.text.replace(/^Story\s*:\s*/i, "").trim();
      const id = extractInlineId(title) || `S-${String(storyIndex).padStart(3, "0")}`;
      const cleanTitle = stripInlineId(title);

      const story = {
        id,
        title: cleanTitle,
        feature_id: currentFeature?.id || null,
        source: "PLAN.md"
      };
      stories.push(story);
    }
  }

  return { features, stories };
}

function parseAcceptance(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "ACCEPTANCE.md"));
  if (!md) return { criteria: [], _note: "ACCEPTANCE.md not found" };

  const lines = md.split(/\r?\n/);
  const criteria = [];
  let currentStoryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{2,4})\s+Story\s*:\s*(.+?)\s*$/.exec(line);
    if (h) {
      const title = h[2].trim();
      currentStoryId = extractInlineId(title) || null;
      continue;
    }

    const item = /^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$/.exec(line);
    if (item) {
      criteria.push({
        story_id: currentStoryId,
        checked: item[1].toLowerCase() === "x",
        text: item[2].trim(),
        source: "ACCEPTANCE.md"
      });
    }
  }

  return { criteria };
}

function parseStatus(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "STATUS.md"));
  if (!md) return { declared: {}, _note: "STATUS.md not found" };

  const declared = {};
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*(FEATURE|STORY)\s+([A-Z0-9-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) declared[`${m[1]}:${m[2]}`] = m[3];
  }
  return { declared, source: "STATUS.md" };
}

function extractInlineId(title) {
  const m = /[\[(]ID\s*=\s*([A-Z0-9-]+)[\])]/.exec(title);
  return m ? m[1] : null;
}

function stripInlineId(title) {
  return title.replace(/\s*[\[(]ID\s*=\s*[A-Z0-9-]+[\])]\s*/g, "").trim();
}

module.exports = {
  parseProjectYaml,
  parseEpicFromReadme,
  parsePlan,
  parseAcceptance,
  parseStatus
};
