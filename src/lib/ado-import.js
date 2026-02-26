// EVA-STORY: EO-09-004
// EVA-FEATURE: EO-09
"use strict";

/**
 * ado-import.js — parse an Azure DevOps work-item export CSV and return
 * a veritas plan { features, stories, tasks }.
 *
 * ADO export column order (our ado.csv + standard ADO export):
 *   Work Item Type, Title, Parent, Description, Acceptance Criteria, Tags, Evidence Sources
 *
 * Work Item Type mapping:
 *   Epic        → (ignored — we read epic title from the row as context)
 *   Feature     → features[]
 *   User Story  → stories[]
 *   Task        → tasks[]
 *
 * The Parent column is used to wire stories to features and tasks to stories.
 */

const fs = require("fs");

// ─────────────────────────────────────────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal RFC 4180-compliant CSV parser.
 * Returns an array of string arrays.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let i = 0;
  let field = "";
  let inQuote = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuote = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
      if (ch === "\r") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // lone \r
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
    i++;
  }
  if (field.trim() !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID derivation from title
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a veritas-style ID from the beginning of a title string.
 * ADO titles written by veritas start with "EO-05-001 My title" or "F33-01 Feature".
 * Supports alphanumeric prefixes like EO, F33, LP12.
 * Returns { id, cleanTitle } — id may be null if no prefix detected.
 */
function extractId(rawTitle) {
  // 3-part: EO-05-001 or F33-01-001
  // 2-part: EO-05 or F33-01
  const m = /^(([A-Z][A-Z0-9]{1,5}-\d{2,4}[-_]\d{3})|([A-Z][A-Z0-9]{1,5}-\d{2,4}))\s+(.+)$/.exec(
    rawTitle.trim()
  );
  if (m) return { id: m[1], cleanTitle: m[m.length - 1].trim() };
  return { id: null, cleanTitle: rawTitle.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an ADO export CSV file and return a veritas plan structure.
 *
 * @param {string} csvPath  Absolute path to the ADO CSV file.
 * @returns {{ features: object[], stories: object[], tasks: object[], source: string }}
 */
function importAdoCsv(csvPath) {
  const content = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(content);
  if (rows.length < 2) return { features: [], stories: [], tasks: [], source: csvPath };

  // Build column index from header row
  const header = rows[0].map((h) => h.trim());
  const col = (name) => {
    const idx = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    return idx >= 0 ? idx : null;
  };

  const typeCol  = col("Work Item Type") ?? 0;
  const titleCol = col("Title") ?? 1;
  const parentCol = col("Parent") ?? 2;
  const descCol  = col("Description");
  const acCol    = col("Acceptance Criteria");
  const tagsCol  = col("Tags");

  const features = [];
  const stories = [];
  const tasks = [];

  // Lookup by title (trimmed) so we can wire parent references
  const featureByTitle = new Map();
  const storyByTitle   = new Map();

  // Assign sequential IDs when the title has none
  let featureSeq = 0;
  let storySeq   = 0;
  let taskSeq    = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const type   = (row[typeCol] || "").trim();
    const rawTitle = (row[titleCol] || "").trim();
    if (!rawTitle) continue;

    const parentTitle = parentCol !== null ? (row[parentCol] || "").trim() : "";
    const description = descCol !== null ? (row[descCol] || "").trim() : "";
    const acceptance  = acCol   !== null ? (row[acCol]   || "").trim() : "";
    const tags        = tagsCol !== null ? (row[tagsCol] || "").trim() : "";

    const { id: extractedId, cleanTitle } = extractId(rawTitle);

    if (type === "Feature") {
      const fid = extractedId || `ADO-F-${String(++featureSeq).padStart(3, "0")}`;
      const feat = { id: fid, title: cleanTitle, source: "ado-import" };
      features.push(feat);
      featureByTitle.set(rawTitle, feat);
    } else if (type === "User Story") {
      // Locate parent feature
      const parentFeat = featureByTitle.get(parentTitle);
      const fid = parentFeat?.id || null;
      const sid = extractedId || `ADO-S-${String(++storySeq).padStart(3, "0")}`;

      // Parse acceptance criteria as array of lines
      const acLines = acceptance
        ? acceptance.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean)
        : [];

      const story = {
        id: sid,
        title: cleanTitle,
        feature_id: fid,
        description,
        acceptance_criteria: acLines,
        done: /\bdone\b/i.test(tags),
        source: "ado-import",
      };
      stories.push(story);
      storyByTitle.set(rawTitle, story);
    } else if (type === "Task") {
      const parentStory = storyByTitle.get(parentTitle);
      const tid = extractedId || `ADO-T-${String(++taskSeq).padStart(3, "0")}`;
      tasks.push({
        id: tid,
        title: cleanTitle,
        story_id: parentStory?.id || null,
        feature_id: parentStory?.feature_id || null,
        done: /\bdone\b/i.test(tags),
        source: "ado-import",
      });
    }
    // Epic rows are silently skipped — title used only as parent reference context
  }

  return { features, stories, tasks, source: csvPath };
}

module.exports = { importAdoCsv, parseCsv };
