// EVA-STORY: EO-03-001
// EVA-STORY: EO-03-002
// EVA-FEATURE: EO-03
"use strict";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Weights: coverage 0.40 | evidence 0.20 | consistency 0.25 | complexity_coverage 0.15
// When no enrichment data is available, complexity_coverage defaults to 0 and
// the remaining three weights revert to their original ratios (0.50/0.20/0.30).
// VP-A2: Ungoverned projects (0 stories) get score: 0 (not null) so before/after
// comparisons are meaningful and the floor bug is visible in test output.
function computeTrustScore(recon, enrichment = null) {
  const totalStories = recon?.coverage?.stories_total ?? 0;
  if (totalStories === 0) {
    return { score: 0, components: {}, ungoverned: true };
  }

  const withArtifacts = recon.coverage.stories_with_artifacts ?? 0;
  const withEvidence  = recon.coverage.stories_with_evidence  ?? 0;
  const consistency   = recon.coverage.consistency_score      ?? 0;

  const coverage            = withArtifacts / totalStories; // 0..1
  const evidenceCompleteness = withEvidence / totalStories; // 0..1
  const consistencyScore    = clamp(consistency, 0, 1);     // 0..1

  // 4th component: complexity_coverage
  // = high-complexity stories that also have artifacts / max(1, total high-complexity stories)
  // Requires enrichment data (from enrich.js); falls back to 0 when unavailable.
  let complexityCoverage = 0;
  if (enrichment && Array.isArray(enrichment.annotations) && enrichment.annotations.length > 0) {
    const highComplexityIds = new Set(
      enrichment.annotations
        .filter((a) => a.complexity === 'High')
        .map((a) => a.story_id)
    );
    if (highComplexityIds.size > 0) {
      // stories_with_artifacts set from recon (if available)
      const coveredIds = new Set(
        Object.entries(recon.coverage.story_artifact_map || {})
          .filter(([, arts]) => arts && arts.length > 0)
          .map(([id]) => id)
      );
      const highWithArtifacts = [...highComplexityIds].filter((id) => coveredIds.has(id)).length;
      complexityCoverage = highWithArtifacts / highComplexityIds.size;
    }
  }

  const hasComplexity = complexityCoverage > 0;

  let score;
  if (hasComplexity) {
    // 4-component formula (weights sum to 1.00)
    score = (
      coverage            * 0.40 +
      evidenceCompleteness * 0.20 +
      consistencyScore    * 0.25 +
      complexityCoverage  * 0.15
    ) * 100;
  } else {
    // 3-component formula -- backwards compatible
    score = (
      coverage            * 0.50 +
      evidenceCompleteness * 0.20 +
      consistencyScore    * 0.30
    ) * 100;
  }

  return {
    score: Math.round(score),
    components: {
      coverage:             round2(coverage),
      evidenceCompleteness: round2(evidenceCompleteness),
      consistencyScore:     round2(consistencyScore),
      complexityCoverage:   round2(complexityCoverage),
      formula: hasComplexity ? '4-component' : '3-component-fallback',
    },
    ungoverned: false,
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function trustToActions(score) {
  if (score === null) return ["add-governance"];
  if (score >= 90) return ["deploy", "merge", "release"];
  if (score >= 70) return ["test", "review", "merge-with-approval"];
  if (score >= 50) return ["review-required", "no-deploy"];
  return ["block", "investigate"];
}

module.exports = {
  computeTrustScore,
  trustToActions
};
