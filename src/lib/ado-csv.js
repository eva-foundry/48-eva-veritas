// EVA-STORY: EO-04-001
// EVA-STORY: EO-04-002
// EVA-FEATURE: EO-04
"use strict";

function csvEscape(s) {
  const v = String(s ?? "");
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsvRows(planned, recon, gapsOnly = false, evidenceMap = {}) {
  const rows = [];
  const epicTitle = planned?.epic?.title || planned?.project?.name || "EVA Project";

  rows.push([
    "Work Item Type",
    "Title",
    "Parent",
    "Description",
    "Acceptance Criteria",
    "Tags",
    "Evidence Sources"
  ]);

  rows.push(["Epic", epicTitle, "", planned?.epic?.description || "", "", "eva", ""]);

  const featureById = new Map((planned.features || []).map((f) => [f.id, f]));

  for (const f of planned.features || []) {
    rows.push(["Feature", `${f.id} ${f.title}`, epicTitle, "", "", "eva;feature", ""]);
  }

  // Build gap map from reconciliation (optional)
  const storyStatusMap = new Map();
  for (const g of recon?.gaps || []) {
    if (g.story_id) storyStatusMap.set(g.story_id, g.type);
  }

  // When gapsOnly: only include stories that have a gap tag
  const allStories = planned.stories || [];
  const storiesFiltered = gapsOnly
    ? allStories.filter((s) => storyStatusMap.has(s.id))
    : allStories;

  // Build story title map for use as Task parent
  const storyTitleById = new Map();

  for (const s of storiesFiltered) {
    const parentFeature = featureById.get(s.feature_id);
    const parentTitle = parentFeature
      ? `${parentFeature.id} ${parentFeature.title}`
      : epicTitle;

    const acceptance = (planned.acceptance || [])
      .filter((c) => c.story_id === s.id)
      .map((c) => `- ${c.text}`)
      .join("\n");

    const gapTag = storyStatusMap.has(s.id) ? `gap:${storyStatusMap.get(s.id)}` : "";
    const tags = ["eva", "story", gapTag].filter(Boolean).join(";");
    const storyTitle = `${s.id} ${s.title}`;
    storyTitleById.set(s.id, storyTitle);

    const evidenceSources = (evidenceMap[s.id] || []).map((e) => e.sha).join("; ");
    rows.push([
      "User Story",
      storyTitle,
      parentTitle,
      s.description || "",
      acceptance,
      tags,
      evidenceSources
    ]);
  }

  // Output Tasks (not scored by MTI, but needed for ADO sprint planning)
  const allTasks = planned.tasks || [];
  const tasksToOutput = gapsOnly
    ? allTasks.filter((t) => storyStatusMap.has(t.story_id))
    : allTasks;

  for (const t of tasksToOutput) {
    const parentTitle = storyTitleById.get(t.story_id) || epicTitle;
    const doneTag = t.done ? "done" : "";
    const tags = ["eva", "task", doneTag].filter(Boolean).join(";");
    rows.push([
      "Task",
      `${t.id} ${t.title}`,
      parentTitle,
      "",
      "",
      tags,
      ""
    ]);
  }

  return rows;
}

function rowsToCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

module.exports = {
  toCsvRows,
  rowsToCsv
};
