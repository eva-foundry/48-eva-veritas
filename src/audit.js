// EVA-STORY: EO-05-001
// EVA-STORY: EO-05-002
// EVA-STORY: EO-05-003
// EVA-STORY: EO-05-004
// EVA-STORY: EO-05-005
// EVA-STORY: EO-05-007
// EVA-STORY: EO-12-001
// EVA-FEATURE: EO-05
// EVA-FEATURE: EO-12
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
const { writeTrustScore, writeVerificationRecord, isApiReachable, getQualityGates, GovernanceApiError } = require("./lib/data-model-client");
const { isDegradedModeAllowed } = require("./lib/governance-error");

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

  // ── COMPONENT 2: Gate-Driven MTI Weighting (L34 integration) ──
  const repoPathForGates = path.resolve(opts.repo || process.cwd());
  const projectIdForGates = path.basename(repoPathForGates);
  let activeGate = null;
  let trustOpts = { ...opts };
  
  if (opts.source !== "disk") {
    try {
      const gatesRes = await getQualityGates(projectIdForGates, opts.apiBase);
      if (gatesRes.ok && gatesRes.data && gatesRes.data.length > 0) {
        activeGate = gatesRes.data.find(g => g.status === "active" && g.gate_metric === "mti_score");
        if (activeGate) {
          if (activeGate.custom_weights) {
            trustOpts.gateWeights = activeGate.custom_weights;
            console.log(`[GATE] Applying custom weights from L34: ${JSON.stringify(activeGate.custom_weights)}`);
          }
          if (activeGate.minimum_allowed_mti) {
            trustOpts.scoreFloor = activeGate.minimum_allowed_mti;
          }
          if (activeGate.maximum_allowed_mti) {
            trustOpts.scoreCeiling = activeGate.maximum_allowed_mti;
          }
        }
      }
    } catch (e) {
      console.log(`[WARN] Quality gates query failed (non-fatal): ${e.message}`);
    }
  }
  
  await computeTrust(trustOpts);
  await report(opts);

  // ── Write audit results back to data model (FAIL-CLOSED) ──
  // Governance API-only policy: write-back must succeed or audit FAILS
  const repoPathForSync = path.resolve(opts.repo || process.cwd());
  const projectIdForSync = path.basename(repoPathForSync);
  
  try {
    const trustDataForSync = JSON.parse(
      fs.readFileSync(path.join(repoPathForSync, ".eva", "trust.json"), "utf8")
    );
    
    // Check API reachability first  
    const apiReachable = await isApiReachable(opts.apiBase);
    if (!apiReachable) {
      throw new GovernanceApiError(
        `Data model API unreachable — cannot persist audit results`,
        {
          operation: "audit_write_back",
          endpoint: opts.apiBase,
          policy: "fail_closed"
        }
      );
    }
    
    // Write MTI score + verification record in parallel
    const [trustRes, verifyRes] = await Promise.all([
      writeTrustScore(projectIdForSync, trustDataForSync, opts.apiBase),
      writeVerificationRecord(projectIdForSync, trustDataForSync, opts.apiBase),
    ]);
    
    if (!trustRes.ok) {
      throw new GovernanceApiError(
        `Failed to write MTI score to L34: ${trustRes.error}`,
        {
          operation: "audit_write_trust_score",
          endpoint: `${opts.apiBase}/model/project_work/${projectIdForSync}`,
          httpStatus: trustRes.status,
          policy: "fail_closed"
        }
      );
    }
    if (!verifyRes.ok) {
      throw new GovernanceApiError(
        `Failed to write verification record to L45: ${verifyRes.error}`,
        {
          operation: "audit_write_verification",
          endpoint: `${opts.apiBase}/model/verification_records/`,
          httpStatus: verifyRes.status,
          policy: "fail_closed"
        }
      );
    }
    
    console.log(`[SYNC] MTI score written to data model: project_work/${projectIdForSync}`);
    console.log(`[SYNC] Verification record written to data model`);

    // ── COMPONENT 3: Gate Evaluation Verification Recording (L34→L45, FAIL-CLOSED) ──
    if (activeGate && trustDataForSync.score !== undefined) {
      const gateResult = {
        gate_id: activeGate.id,
        gate_name: activeGate.gate_name || "MTI Threshold",
        threshold: activeGate.threshold,
        effective_score: trustDataForSync.score,
        evaluation: trustDataForSync.score >= activeGate.threshold ? "PASS" : 
                    trustDataForSync.score >= (activeGate.threshold - 5) ? "WARN" : "FAIL",
        weights_applied: trustOpts.gateWeights ? "custom" : "default",
        bounds_applied: {
          floor: trustOpts.scoreFloor || null,
          ceiling: trustOpts.scoreCeiling || null
        },
        metadata: {
          gate_source: "L34-quality_gates",
          verification_timestamp: new Date().toISOString()
        }
      };
      
      try {
        const gateVerifyRes = await writeVerificationRecord(
          projectIdForSync,
          { ...trustDataForSync, gate_evaluation: gateResult },
          opts.apiBase
        );
        if (!gateVerifyRes.ok) {
          throw new GovernanceApiError(
            `Failed to record gate evaluation: ${gateVerifyRes.error}`,
            {
              operation: "audit_gate_evaluation",
              endpoint: `${opts.apiBase}/model/verification_records/`,
              httpStatus: gateVerifyRes.status,
              policy: "fail_closed"
            }
          );
        }
        console.log(`[GATE] Evaluation recorded to L45: ${gateResult.evaluation}`);
      } catch (e) {
        throw new GovernanceApiError(
          `Gate evaluation failed: ${e.message}`,
          {
            operation: "audit_gate_evaluation",
            originalError: e.message,
            policy: "fail_closed"
          }
        );
      }
    }
  } catch (err) {
    if (err instanceof GovernanceApiError) {
      console.error(`[FATAL] ${err.message}`);
      throw err;
    }
    throw new GovernanceApiError(
      `Audit write-back failed: ${err.message}`,
      {
        operation: "audit_write_back",
        originalError: err.message,
        policy: "fail_closed"
      }
    );
  }

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
