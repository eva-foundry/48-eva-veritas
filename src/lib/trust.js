// EVA-STORY: EO-03-001
// EVA-STORY: EO-03-002
// EVA-FEATURE: EO-03
"use strict";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Weights: coverage 0.35 | evidence 0.20 | consistency 0.25 | complexity_coverage 0.10 | field_population 0.10
// When no enrichment data is available, complexity_coverage defaults to 0 and field_population falls back.
// If field_population unavailable (no data model API), 3-component fallback formula applies.
// VP-A2: Ungoverned projects (0 stories) get score: 0 (not null) so before/after
// comparisons are meaningful and the floor bug is visible in test output.
//
// Enhancement 3 (v2.7 - March 2, 2026): Added field_population component to enforce
// WBS metadata quality (sprint, assignee, ado_id population).
function computeTrustScore(recon, enrichment = null, fieldPopulation = null) {
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

  // 5th component: field_population (Enhancement 3 - v2.7)
  // = average of (sprint, assignee, ado_id) population rates across all WBS stories
  // Requires data model API access; falls back to 0 when unavailable.
  const fieldPopulationScore = fieldPopulation ? clamp(fieldPopulation, 0, 1) : 0;

  const hasComplexity = complexityCoverage > 0;
  const hasFieldPopulation = fieldPopulationScore > 0;

  let score;
  let formula;
  
  if (hasComplexity && hasFieldPopulation) {
    // 5-component formula (weights sum to 1.00)
    score = (
      coverage            * 0.35 +
      evidenceCompleteness * 0.20 +
      consistencyScore    * 0.25 +
      complexityCoverage  * 0.10 +
      fieldPopulationScore * 0.10
    ) * 100;
    formula = '5-component';
  } else if (hasComplexity || hasFieldPopulation) {
    // 4-component formula (one of complexity or field_population available)
    if (hasComplexity) {
      score = (
        coverage            * 0.40 +
        evidenceCompleteness * 0.20 +
        consistencyScore    * 0.25 +
        complexityCoverage  * 0.15
      ) * 100;
      formula = '4-component-complexity';
    } else {
      score = (
        coverage            * 0.40 +
        evidenceCompleteness * 0.20 +
        consistencyScore    * 0.30 +
        fieldPopulationScore * 0.10
      ) * 100;
      formula = '4-component-field-population';
    }
  } else {
    // 3-component formula -- backwards compatible
    score = (
      coverage            * 0.50 +
      evidenceCompleteness * 0.20 +
      consistencyScore    * 0.30
    ) * 100;
    formula = '3-component-fallback';
  }

  return {
    score: Math.round(score),
    components: {
      coverage:             round2(coverage),
      evidenceCompleteness: round2(evidenceCompleteness),
      consistencyScore:     round2(consistencyScore),
      complexityCoverage:   round2(complexityCoverage),
      fieldPopulationScore: round2(fieldPopulationScore),
      formula,
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
