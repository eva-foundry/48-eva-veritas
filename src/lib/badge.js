// EVA-STORY: EO-05-007
// VP-E4: MTI badge generation
// Writes .eva/badge.svg (standalone display) and .eva/badge.json (Shields.io endpoint).
// Called from audit.js after every audit run.
"use strict";

const path = require("path");
const fs = require("fs");
const { ensureDir } = require("./fs-utils");

const COLORS = {
  green:  "#4c1",     // MTI >= 90
  yellow: "#dfb317",  // MTI 70-89
  orange: "#fe7d37",  // MTI 50-69
  red:    "#e05d44"   // MTI < 50  (includes null / ungoverned)
};

function getColor(score) {
  if (score === null || score === undefined) return COLORS.red;
  if (score >= 90) return COLORS.green;
  if (score >= 70) return COLORS.yellow;
  if (score >= 50) return COLORS.orange;
  return COLORS.red;
}

function makeSvg(label, message, color) {
  const lw = label.length * 6 + 10;
  const mw = message.length * 6 + 10;
  const tw = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${tw}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
    <rect width="${tw}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${message}</text>
    <text x="${lw + mw / 2}" y="14">${message}</text>
  </g>
</svg>`;
}

/** Shields.io custom endpoint format -- host at .eva/badge.json and reference via:
 *  https://img.shields.io/endpoint?url=<raw-url-to-badge.json>
 */
function makeShieldsJson(label, message, color) {
  return {
    schemaVersion: 1,
    label,
    message,
    color: color.replace("#", "")
  };
}

/**
 * Write .eva/badge.svg and .eva/badge.json for the given repo and MTI score.
 * Returns { svgPath, jsonPath, score, color }.
 */
function writeBadge(repoPath, score) {
  const evaDir = path.join(repoPath, ".eva");
  ensureDir(evaDir);

  const label   = "MTI";
  const message = (score === null || score === undefined) ? "ungoverned" : String(score);
  const color   = getColor(score);

  const svgPath  = path.join(evaDir, "badge.svg");
  const jsonPath = path.join(evaDir, "badge.json");

  fs.writeFileSync(svgPath,  makeSvg(label, message, color), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(makeShieldsJson(label, message, color), null, 2), "utf8");

  return { svgPath, jsonPath, score, color };
}

module.exports = { writeBadge, getColor };
