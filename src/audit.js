// EVA-STORY: EO-05-001
// EVA-STORY: EO-05-002
// EVA-STORY: EO-05-003
// EVA-STORY: EO-05-004
// EVA-STORY: EO-05-005
// EVA-STORY: EO-05-007
// EVA-FEATURE: EO-05
"use strict";

const path = require("path");
const fs = require("fs");

const { discover } = require("./discover");
const { reconcile } = require("./reconcile");
const { enrich } = require("./enrich");
const { computeTrust } = require("./compute-trust");
const { report } = require("./report");
const { loadConfig } = require("./lib/config");
const { checkWbsQualityGates } = require("./lib/wbs-quality-gates");

/**
 * Combined audit: discover + reconcile + compute-trust + report in one shot.
 * Eliminates the 4-command pipeline and guarantees artifact freshness.
 *
 * Options:
 *   opts.threshold  {number}  MTI score required to pass (default: 70)
 *   opts.warnOnly   {boolean} Print warning but exit 0 even when below threshold
 *   opts.skipQualityGates {boolean} Skip WBS field population quality gates (default: false)
 */
async function audit(opts) {
  await discover(opts);
  await reconcile(opts);
  
  // enrich: annotate stories with endpoint/container counts (non-fatal)
  try {
    const repoPath = path.resolve(opts.repo || process.cwd());
    await enrich(repoPath, { baseUrl: process.env.EVA_DATA_MODEL_URL });
  } catch (e) { console.log(`[WARN] enrich step failed (non-fatal): ${e.message}`); }
  
  // Enhancement 3: WBS field population quality gates (v2.7 - March 2, 2026)
  // Check sprint, assignee, ado_id for done stories before computing trust
  if (!opts.skipQualityGates) {
    try {
      const repoPath = path.resolve(opts.repo || process.cwd());
      const projectId = path.basename(repoPath); // e.g., "37-data-model", "51-ACA"
      
      console.log(`[INFO] Running WBS quality gates for project: ${projectId}`);
      const gateResult = await checkWbsQualityGates({
        dataModelUrl: process.env.EVA_DATA_MODEL_URL,
        project: projectId,
        threshold: 0.90 // 90% field population required
      });
      
      if (!gateResult.pass) {
        console.log(`[FAIL] WBS Quality Gate Violations (${gateResult.violations.length} done stories):`);
        gateResult.violations.slice(0, 10).forEach(v => {
          console.log(`  - ${v.story_id}: missing ${v.missing_fields.join(", ")}`);
        });
        if (gateResult.violations.length > 10) {
          console.log(`  ... and ${gateResult.violations.length - 10} more`);
        }
        console.log(`[INFO] Field population rates: sprint=${Math.round(gateResult.metrics.sprint_rate * 100)}%, assignee=${Math.round(gateResult.metrics.assignee_rate * 100)}%, ado_id=${Math.round(gateResult.metrics.ado_id_rate * 100)}%`);
        
        // Write quality gate violations to trust.json (will be included in report)
        const trustPath = path.join(repoPath, ".eva", "trust.json");
        const trust = require("./lib/fs-utils").readJsonIfExists(trustPath) || {};
        trust.quality_gates = {
          pass: false,
          violations: gateResult.violations,
          metrics: gateResult.metrics
        };
        require("./lib/fs-utils").writeJson(trustPath, trust);
      } else {
        console.log(`[PASS] WBS quality gates: all ${gateResult.metrics.done} done stories have required fields`);
      }
    } catch (e) {
      console.log(`[WARN] WBS quality gate check failed (non-fatal): ${e.message}`);
    }
  }
  
  await computeTrust(opts);
  await report(opts);

  // VP-E3: exit code semantics
  // CLI flag takes precedence; .evarc.json provides project-level default; hard default = 70
  const repoPath = path.resolve(opts.repo || process.cwd());
  const config   = loadConfig(repoPath);
  const threshold = opts.threshold !== undefined ? Number(opts.threshold) : (config.threshold ?? 70);
  const warnOnly  = opts.warnOnly === true;

  const trustPath = path.join(path.resolve(opts.repo || process.cwd()), ".eva", "trust.json");
  let score = null;
  try {
    const raw = JSON.parse(fs.readFileSync(trustPath, "utf8"));
    score = raw.score ?? null;
  } catch (_) {
    // trust.json absent -- treat as 0
    score = 0;
  }

  // VP-E4: write badge (non-fatal -- badge failure must never break CI)
  try {
    const { writeBadge } = require("./lib/badge");
    writeBadge(path.resolve(opts.repo || process.cwd()), score);
  } catch (_) { /* badge is non-fatal */ }

  if (score !== null && score < threshold) {
    if (warnOnly) {
      console.warn(`[WARN] MTI ${score} is below threshold ${threshold} (--warn-only set, continuing)`);
    } else {
      console.error(`[FAIL] MTI ${score} is below threshold ${threshold}. Raise score or use --warn-only.`);
      process.exit(1);
    }
  }
}

module.exports = { audit };
