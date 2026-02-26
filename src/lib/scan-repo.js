// EVA-STORY: EO-01-002
// EVA-STORY: EO-01-003
// EVA-STORY: EO-01-004
// EVA-FEATURE: EO-01
"use strict";

const path = require("path");
const fg = require("fast-glob");
const { readTextIfExists } = require("./fs-utils");
const { extractStoryTags } = require("./md-utils");

// Detect EVA story IDs in filenames (e.g. test_EO-05-001_chat.py).
// Uses lookarounds instead of \b so that _ separators (not word boundaries) work.
const FILENAME_STORY_RE = /(?<![A-Za-z])([A-Z]{2,6}-\d{2,3}-\d{3})(?![A-Za-z0-9])/g;

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  ".eva/**",
  "**/.eva/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.venv/**",
  "**/__pycache__/**"
];

function classify(fileRel) {
  const lower = fileRel.toLowerCase();

  if (lower.startsWith("docs/")) return "doc";
  if (lower.startsWith("evidence/")) return "evidence";
  if (
    lower.startsWith("infra/") ||
    lower.includes("terraform") ||
    lower.endsWith(".bicep") ||
    lower.endsWith(".tf")
  )
    return "infra";
  if (
    lower.startsWith("tests/") ||
    lower.startsWith("test/") ||
    lower.includes(".spec.") ||
    lower.includes(".test.")
  )
    return "test";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "config";
  if (lower.endsWith(".md")) return "doc";
  if (lower.endsWith(".json")) return "data";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".ps1") ||
    lower.endsWith(".cs") ||
    lower.endsWith(".java")
  )
    return "code";

  return "other";
}

async function scanRepo(repoPath) {
  const entries = await fg(["**/*"], {
    cwd: repoPath,
    dot: true,
    onlyFiles: true,
    ignore: DEFAULT_IGNORES
  });

  const artifacts = [];
  for (const f of entries) {
    const type = classify(f);
    const abs = path.join(repoPath, f);

    const isTextLike =
      /\.(md|txt|js|ts|tsx|jsx|py|ps1|json|yml|yaml|html|css|scss|tf|bicep|sh|bat|cs|java)$/i.test(f);
    // Only non-markdown source files carry implementation tags.
    // Markdown files are the "planned" layer parsed separately by parse-docs.js.
    // Scanning .md for tags causes code-example text in README/starter-kit files
    // (e.g. tag examples inside fenced code blocks) to appear as false-positive orphan artifacts.
    const isTaggable = isTextLike && !/\.md$/i.test(f);

    const content = isTextLike ? readTextIfExists(abs) : null;
    const storyTags = isTaggable ? extractStoryTags(content) : [];

    // Implicit evidence: story IDs embedded in the filename itself
    const basename = path.basename(f);
    FILENAME_STORY_RE.lastIndex = 0;
    const filenameIds = [...basename.matchAll(FILENAME_STORY_RE)].map((m) => m[1]);
    const allStoryTags = [...new Set([...storyTags, ...filenameIds])];
    // implicit_evidence_for = IDs found only in filename, not already tagged in content
    const implicitFor = filenameIds.filter((id) => !storyTags.includes(id));

    const artifact = {
      path: f.replace(/\\/g, "/"),
      type,
      story_tags: allStoryTags,
    };
    if (type === "test") artifact.is_test = true;
    if (implicitFor.length > 0) artifact.implicit_evidence_for = implicitFor;
    artifacts.push(artifact);
  }

  return { artifacts };
}

module.exports = {
  scanRepo
};
