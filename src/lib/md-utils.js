// EVA-STORY: EO-01-003
// EVA-FEATURE: EO-01
"use strict";

function extractHeadings(md) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const headings = [];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) headings.push({ level: m[1].length, text: m[2].trim() });
  }
  return headings;
}

function extractChecklist(md) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    const m = /^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$/.exec(line);
    if (m) items.push({ checked: m[1].toLowerCase() === "x", text: m[2].trim() });
  }
  return items;
}

function extractStoryTags(text) {
  if (!text) return [];
  const tags = new Set();
  const patterns = [
    /EVA[-_ ]STORY\s*[:=]\s*([A-Z][\w-]+)/g,
    /\[EVA[-_ ]STORY\s+([A-Z][\w-]+)\]/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) tags.add(m[1]);
  }
  return [...tags];
}

module.exports = {
  extractHeadings,
  extractChecklist,
  extractStoryTags
};
