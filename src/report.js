// EVA-STORY: EO-06-001
// EVA-STORY: EO-05-005
// EVA-FEATURE: EO-06
"use strict";

const path = require("path");
const { readJsonIfExists } = require("./lib/fs-utils");

async function report(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const discoveryPath = path.resolve(opts.discovery || path.join(repoPath, ".eva", "discovery.json"));
  const reconPath = path.resolve(opts.recon || path.join(repoPath, ".eva", "reconciliation.json"));
  const trustPath = path.resolve(opts.trust || path.join(repoPath, ".eva", "trust.json"));

  const prevPath = path.join(path.dirname(trustPath), "trust.prev.json");

  const discovery = readJsonIfExists(discoveryPath);
  const recon = readJsonIfExists(reconPath);
  const trust = readJsonIfExists(trustPath);
  const trustPrev = readJsonIfExists(prevPath);

  if (!discovery) {
    console.log(`[WARN] discovery.json not found at ${discoveryPath}`);
    console.log(`       Run: eva discover --repo ${repoPath}`);
    return;
  }

  const epic = discovery.planned?.epic?.title || "EVA Project";
  const features = discovery.planned?.features?.length || 0;
  const stories = discovery.planned?.stories?.length || 0;

  console.log("");
  console.log("=======================================");
  console.log(`EVA Veritas Report: ${epic}`);
  console.log("=======================================");
  console.log(`Repo:    ${repoPath}`);
  console.log(`Planned: ${features} features, ${stories} stories`);

  if (recon) {
    const c = recon.coverage || {};
    console.log("");
    console.log("Coverage");
    console.log("---------------------------------------");
    console.log(`Stories total:          ${c.stories_total}`);
    console.log(`Stories with artifacts: ${c.stories_with_artifacts}`);
    console.log(`Stories with evidence:  ${c.stories_with_evidence}`);
    console.log(`Consistency score:      ${(c.consistency_score ?? 0).toFixed(2)}`);

    console.log("");
    console.log("Gaps");
    console.log("---------------------------------------");
    if (!recon.gaps || recon.gaps.length === 0) {
      console.log("[PASS] No gaps detected");
    } else {
      for (const g of recon.gaps) {
        console.log(`[FAIL] ${g.type} :: ${g.story_id}${g.title ? " -- " + g.title : ""}`);
      }
    }

    // VP-A5: Feature breakdown as primary output (not buried in hints)
    if (Array.isArray(recon.features) && recon.features.length > 0) {
      console.log("");
      console.log("Feature Breakdown");
      console.log("---------------------------------------");
      for (const f of recon.features) {
        const mtiStr = String(f.mti).padStart(3);
        const gapTag = f.gap_count >= f.story_count && f.story_count > 0 ? "  [NOT STARTED]" : "";
        console.log(
          `[${mtiStr}] ${f.id.padEnd(10)} ${(f.title || "").substring(0, 30).padEnd(30)}` +
          `  ${f.stories_with_artifacts}/${f.story_count} artifacts` +
          `  ${f.stories_with_evidence}/${f.story_count} evidence` +
          `  ${f.gap_count} gap${f.gap_count !== 1 ? "s" : ""}${gapTag}`
        );
      }
    }

    // Implemented section
    const artMap = discovery.actual?.story_artifact_map || {};
    const implemented = (discovery.planned?.stories || []).filter(
      (s) => (artMap[s.id]?.artifacts?.length || 0) > 0
    );
    if (implemented.length > 0) {
      console.log("");
      console.log("Implemented");
      console.log("---------------------------------------");
      for (const s of implemented) {
        const artCount = artMap[s.id]?.artifacts?.length || 0;
        const hasEvidence = (artMap[s.id]?.artifacts || []).some((a) => a.type === "evidence");
        const badge = hasEvidence ? "[EVIDENCE]" : "[IMPL]";
        console.log(`${badge} ${s.id} -- ${s.title} (${artCount} artifact${artCount !== 1 ? "s" : ""})`);
      }
    }
  } else {
    console.log("");
    console.log(`[WARN] Reconciliation missing -- run: eva reconcile --repo ${repoPath}`);
  }

  if (trust) {
    console.log("");
    console.log("Trust (MTI)");
    console.log("---------------------------------------");
    if (trust.ungoverned || trust.score === null) {
      console.log(`Score:   null (ungoverned -- no stories found in PLAN.md)`);
      console.log(`Actions: add-governance`);
      console.log("");
      console.log("[HINT] eva-veritas could not find any Feature/Story headings.");
      console.log("       Add a PLAN.md with this exact format:");
      console.log("");
      console.log("  ## Feature: <Title> [ID=XX-01]");
      console.log("  ### Story: <Title> [ID=XX-01-001]");
      console.log("  ### Story: <Title> [ID=XX-01-002]");
      console.log("");
      console.log("       Add a STATUS.md story-status block for declared progress:");
      console.log("");
      console.log("  FEATURE XX-01: In Progress");
      console.log("  STORY XX-01-001: Done");
      console.log("  STORY XX-01-002: Not Started");
      console.log("");
      console.log("       Tag non-md source files to link artifacts to stories:");
      console.log("");
      console.log("  # EVA-STORY: <STORY-ID>   (Python/PS1)");
      console.log("  // EVA-STORY: <STORY-ID>  (JS/TS)");;
      console.log("");
      console.log(`       See: node src/cli.js --help  or  README.md > For Agents`);
    } else {
      // VP-A6: sparkline from trust.json (written by compute-trust), fallback to prev delta
      let delta = "";
      if (trust.sparkline_delta) {
        delta = ` (${trust.sparkline_delta})`;
      } else if (trustPrev !== null && trustPrev.score !== null && typeof trustPrev.score === "number") {
        const diff = (trust.score - trustPrev.score).toFixed(1);
        delta = diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : " (no change)";
      } else {
        delta = " (first run)";
      }
      const staleFlag = trust.stale ? " [STALE -- rerun: eva reconcile]" : "";
      console.log(`Score:   ${trust.score}${delta}${staleFlag}`);
      if (trust.sparkline && trust.sparkline.includes("->")) {
        console.log(`Trend:   ${trust.sparkline}`);
      }
      console.log(`Actions: ${Array.isArray(trust.actions) ? trust.actions.join(", ") : ""}`);
      console.log(`Components: coverage=${trust.components?.coverage} evidence=${trust.components?.evidenceCompleteness} consistency=${trust.components?.consistencyScore}`);
      console.log(`Weights:    coverage=0.5 evidence=0.2 consistency=0.3`);

      if (recon) printImprovementHints(recon, discovery, trust);
    }
  } else {
    console.log("");
    console.log(`[WARN] Trust missing -- run: eva compute-trust --repo ${repoPath}`);
  }

  // B5-02: Model Fidelity block (informational -- not weighted into MTI)
  const fidelityPath = path.join(repoPath, ".eva", "model-fidelity.json");
  const fidelity = readJsonIfExists(fidelityPath);
  if (fidelity && !fidelity.error) {
    console.log("");
    console.log("Model Fidelity (informational)");
    console.log("---------------------------------------");
    const total = fidelity.declared_total || 0;
    const verified = fidelity.verified_total || 0;
    const score = fidelity.model_fidelity_score ?? null;
    console.log(`Score:   ${score !== null ? score + "%" : "n/a"}  (${verified}/${total} declared entities verified)`);
    const drifted = Array.isArray(fidelity.drifted) ? fidelity.drifted : [];
    if (drifted.length > 0) {
      console.log(`[ACT] ${drifted.length} declared entit${drifted.length === 1 ? "y has" : "ies have"} no matching implementation`);
      console.log("Drifted:");
      for (const d of drifted.slice(0, 8)) {
        console.log(`  [${d.type}] ${d.entity} -- declared: ${d.declared_status} -- actual: ${d.actual_status}`);
      }
      if (drifted.length > 8) console.log(`  ... and ${drifted.length - 8} more`);
    } else {
      console.log("[PASS] All declared entities verified");
    }
    const impacts = Array.isArray(fidelity.impacts) ? fidelity.impacts : [];
    for (const { container, impact } of impacts) {
      const epCount = Array.isArray(impact.endpoints) ? impact.endpoints.length : 0;
      const scCount = Array.isArray(impact.screens) ? impact.screens.length : 0;
      console.log(`[ACT] Container '${container}' schema drift impacts: ${epCount} endpoint(s), ${scCount} screen(s)`);
    }
    const age = fidelity.generated_at ? ` (generated ${fidelity.generated_at.slice(0, 10)})` : "";
    console.log(`[INFO] Rerun: eva model-audit --repo .${age}`);
  } else if (fidelity && fidelity.error) {
    console.log("");
    console.log("[INFO] Model Fidelity: not available -- " + fidelity.error);
  }

  console.log("");
}

/**
 * Print actionable improvement hints:
 *  1. MTI projection -- how many more artifact-linked stories to reach 50 / 70 / 90
 *  2. Feature breakdown sorted by gap count (highest leverage first)
 *  3. Per-gap-type instructions
 */
function printImprovementHints(recon, discovery, trust) {
  const c = recon.coverage || {};
  const T = c.stories_total || 0;
  const A = c.stories_with_artifacts || 0;
  const E = c.stories_with_evidence || 0;
  const C = c.consistency_score ?? 1;

  if (T === 0) return;

  const actionableGaps = (recon.gaps || []).filter(
    (g) => g.type === "missing_implementation" || g.type === "missing_evidence"
  );
  if (actionableGaps.length === 0) return;

  console.log("");
  console.log("Improvement Hints");
  console.log("---------------------------------------");

  // --- MTI projection ---
  // formula: score = (A/T*0.5 + E/T*0.2 + C*0.3) * 100
  // solve for A_new given target: A_new = ceil((target/100 - E/T*0.2 - C*0.3) / 0.5 * T)
  const thresholds = [
    { label: "50 (review-required)", value: 50 },
    { label: "70 (merge-with-approval)", value: 70 },
    { label: "90 (deploy)", value: 90 }
  ].filter((th) => (trust.score || 0) < th.value);

  if (thresholds.length > 0) {
    const lines = thresholds.map((th) => {
      const base = E / T * 0.2 + C * 0.3;
      const needed = Math.ceil((th.value / 100 - base) / 0.5 * T);
      const more = Math.max(0, needed - A);
      return more === 0
        ? `reach ${th.label}: already covered by evidence/consistency alone`
        : `reach MTI ${th.label}: tag ${more} more stor${more === 1 ? "y" : "ies"} with # EVA-STORY`;
    });
    const first = lines.shift();
    console.log(`[ACT] To ${first}`);
    for (const l of lines) console.log(`      To ${l}`);
  }

  // --- Feature breakdown (missing_implementation gaps only, sorted by count) ---
  const missingImpl = actionableGaps.filter((g) => g.type === "missing_implementation");
  if (missingImpl.length > 0) {
    // Build feature_id lookup from planned stories
    const storyFeatureMap = {};
    for (const s of (discovery?.planned?.stories || [])) {
      storyFeatureMap[s.id] = s.feature_id || "unknown";
    }
    const featureTitleMap = {};
    for (const f of (discovery?.planned?.features || [])) {
      featureTitleMap[f.id] = f.title;
    }

    const byFeature = {};
    for (const g of missingImpl) {
      const fid = storyFeatureMap[g.story_id] || "unknown";
      if (!byFeature[fid]) byFeature[fid] = [];
      byFeature[fid].push(g);
    }
    const sorted = Object.entries(byFeature).sort((a, b) => b[1].length - a[1].length);

    console.log("");
    console.log(`[ACT] ${missingImpl.length} unimplemented stories by feature (highest priority first):`);
    for (const [fid, gaps] of sorted) {
      const ftitle = featureTitleMap[fid] || fid;
      console.log(`      ${fid} ${ftitle} (${gaps.length} gap${gaps.length === 1 ? "" : "s"})`);
      for (const g of gaps) {
        console.log(`        - ${g.story_id} -- ${g.title || "(no title)"}`);
      }
    }
  }

  // --- missing_evidence stories ---
  const missingEv = actionableGaps.filter((g) => g.type === "missing_evidence");
  if (missingEv.length > 0) {
    console.log("");
    console.log(`[ACT] ${missingEv.length} stories have code but no evidence file:`);
    for (const g of missingEv) {
      console.log(`      - ${g.story_id} -- ${g.title || "(no title)"}`);
    }
  }

  // --- Per-type instructions ---
  console.log("");
  console.log("[ACT] How to close each gap type:");
  if (missingImpl.length > 0) {
    console.log("      missing_implementation  -- Add a tagged source file:");
    console.log("        Option A: tag an existing file  -->  add  # EVA-STORY: <ID>  at the top");
    console.log("        Option B: create a receipt       -->  evidence/<feature-id>.py  with  # EVA-STORY: <ID>");
  }
  if (missingEv.length > 0) {
    console.log("      missing_evidence  -- Prove the story was tested:");
    console.log("        Option A: add criteria to ACCEPTANCE.md under  ### Story: <title> [ID=<ID>]");
    console.log("        Option B: create evidence/<id>-test-result.py  with  # EVA-STORY: <ID>  (type=evidence)");
  }
}

module.exports = { report };
