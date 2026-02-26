// EVA-STORY: EO-04-001
// EVA-STORY: EO-04-002
// EVA-STORY: EO-05-004
// EVA-STORY: EO-09-001
// EVA-FEATURE: EO-04
"use strict";

const fs = require("fs");
const path = require("path");
const { readJsonIfExists, ensureDir } = require("./lib/fs-utils");
const { toCsvRows, rowsToCsv } = require("./lib/ado-csv");

async function generateAdo(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const discoveryPath = path.resolve(opts.discovery || path.join(repoPath, ".eva", "discovery.json"));
  const reconPath = path.resolve(opts.recon || path.join(repoPath, ".eva", "reconciliation.json"));
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "ado.csv"));
  ensureDir(path.dirname(outPath));

  const discovery = readJsonIfExists(discoveryPath);
  if (!discovery) throw new Error(`discovery.json not found at ${discoveryPath}. Run: eva discover`);

  const recon = readJsonIfExists(reconPath) || null;

  const planned = {
    project: discovery.project,
    epic: discovery.planned.epic,
    features: discovery.planned.features,
    stories: discovery.planned.stories,
    acceptance: discovery.planned.acceptance
  };

  const gapsOnly = opts.gapsOnly || false;
  const evidenceMap = discovery.actual?.commit_evidence_map || {};
  const rows = toCsvRows(planned, recon, gapsOnly, evidenceMap);
  const csv = rowsToCsv(rows);
  fs.writeFileSync(outPath, csv, "utf8");
  const qualifier = gapsOnly ? " (gaps-only)" : "";
  console.log(`[PASS] ADO CSV written: ${outPath}${qualifier}`);
}

module.exports = { generateAdo };
