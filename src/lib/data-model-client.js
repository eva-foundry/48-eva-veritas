// EVA-STORY: EO-12-001
// EVA-FEATURE: EO-12
"use strict";

/**
 * data-model-client.js
 *
 * Unified client for querying/writing to the EVA Data Model cloud API.
 * Veritas uses this as the source-of-truth for governance data instead
 * of parsing local PLAN.md / STATUS.md / ACCEPTANCE.md files.
 *
 * Ontology Domain 7 (Project & PM): projects, wbs, sprints, stories, tasks, milestones
 * Ontology Domain 9 (Observability): evidence, verification_records
 * Ontology Domain 6 (Governance): quality_gates, risks, decisions
 */

const DEFAULT_API_BASE =
  process.env.EVA_API_BASE ||
  "https://msub-eva-data-model.victoriousgrass-30debbd3.canadacentral.azurecontainerapps.io";

// Cloud HTTPS endpoint timeout: 30s (critical for data safety, ensures completion before abort)
const TIMEOUT_MS = 30000;

const { GovernanceApiError } = require("./governance-error");

/**
 * Fetch with timeout and error handling
 */
async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Actor": "agent:veritas",
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, status: response.status, error: text, data: null };
    }
    const data = await response.json();
    return { ok: true, status: response.status, data, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: err.message, data: null };
  }
}

/**
 * Fail-closed wrapper for API calls (governance policy)
 * Throws GovernanceApiError if result is not ok
 */
async function apiFetchFailClosed(url, operation, options = {}) {
  const result = await apiFetch(url, options);
  if (!result.ok) {
    throw new GovernanceApiError(
      `API call failed: ${result.error}`,
      {
        operation,
        endpoint: url,
        timeout: TIMEOUT_MS,
        httpStatus: result.status,
        originalError: result.error,
        policy: "fail_closed"
      }
    );
  }
  return result;
}

// ── Query helpers ────────────────────────────────────────────────────────────

/**
 * Check API health - returns true if reachable
 */
async function isApiReachable(apiBase = DEFAULT_API_BASE) {
  const result = await apiFetch(`${apiBase}/health`);
  return result.ok;
}

/**
 * Get project metadata from L25 projects layer
 */
async function getProject(projectId, apiBase = DEFAULT_API_BASE) {
  return apiFetch(`${apiBase}/model/projects/${projectId}`);
}

/**
 * Get WBS records for a project (features, stories, tasks from L26)
 * Returns flat array of WBS records which contain level, status, percent_complete, etc.
 */
async function getProjectWbs(projectId, apiBase = DEFAULT_API_BASE) {
  const result = await apiFetch(
    `${apiBase}/model/wbs/?project_id=${encodeURIComponent(projectId)}&limit=500`
  );
  if (result.ok && result.data) {
    // API returns { data: [...], metadata: {...} }
    return { ok: true, data: result.data.data || result.data, error: null };
  }
  return result;
}

/**
 * Get sprints for a project (L27)
 */
async function getProjectSprints(projectId, apiBase = DEFAULT_API_BASE) {
  const result = await apiFetch(
    `${apiBase}/model/sprints/?project_id=${encodeURIComponent(projectId)}&limit=100`
  );
  if (result.ok && result.data) {
    return { ok: true, data: result.data.data || result.data, error: null };
  }
  return result;
}

/**
 * Get evidence records for a project (L31)
 */
async function getProjectEvidence(projectId, apiBase = DEFAULT_API_BASE) {
  // Evidence uses project prefix in story_id, not a project_id field
  const result = await apiFetch(
    `${apiBase}/model/evidence/?story_id.contains=${encodeURIComponent(projectId)}&limit=500`
  );
  if (result.ok && result.data) {
    return { ok: true, data: result.data.data || result.data, error: null };
  }
  return result;
}

/**
 * Get risks for a project (L29)
 */
async function getProjectRisks(projectId, apiBase = DEFAULT_API_BASE) {
  const result = await apiFetch(
    `${apiBase}/model/risks/?project_id=${encodeURIComponent(projectId)}&limit=100`
  );
  if (result.ok && result.data) {
    return { ok: true, data: result.data.data || result.data, error: null };
  }
  return result;
}

/**
 * Get decisions for a project (L30)
 */
async function getProjectDecisions(projectId, apiBase = DEFAULT_API_BASE) {
  const result = await apiFetch(
    `${apiBase}/model/decisions/?project_id=${encodeURIComponent(projectId)}&limit=100`
  );
  if (result.ok && result.data) {
    return { ok: true, data: result.data.data || result.data, error: null };
  }
  return result;
}

/**
 * Get quality gates configuration (L36)
 */
async function getQualityGates(projectId, apiBase = DEFAULT_API_BASE) {
  const result = await apiFetch(
    `${apiBase}/model/quality_gates/?project_id=${encodeURIComponent(projectId)}&limit=20`
  );
  if (result.ok && result.data) {
    return { ok: true, data: result.data.data || result.data, error: null };
  }
  return result;
}

// ── Write helpers ────────────────────────────────────────────────────────────

/**
 * Write (PUT) a record to a layer
 */
async function putRecord(layer, id, record, apiBase = DEFAULT_API_BASE) {
  return apiFetch(`${apiBase}/model/${layer}/${id}`, {
    method: "PUT",
    body: JSON.stringify(record),
  });
}

/**
 * Write MTI trust score to the project_work layer (L34)
 * This is the key new write: audit results go INTO the data model
 */
async function writeTrustScore(projectId, trustData, apiBase = DEFAULT_API_BASE) {
  const sessionDate = new Date().toISOString().slice(0, 10);
  const recordId = `${projectId}-mti-${sessionDate}`;

  const record = {
    id: recordId,
    project_id: projectId,
    current_phase: "A", // Act phase - recording results
    session_summary: {
      date: sessionDate,
      focus: "MTI Audit",
      outcome: `MTI=${trustData.score} (${trustData.components?.formula || "3-component"})`,
    },
    metrics: {
      mti_score: trustData.score,
      mti_components: trustData.components || {},
      coverage_stories: trustData.components?.coverage || 0,
      evidence_completeness: trustData.components?.evidenceCompleteness || 0,
      consistency_score: trustData.components?.consistencyScore || 0,
      actions_allowed: trustData.actions || [],
    },
    updated_at: new Date().toISOString(),
  };

  return putRecord("project_work", recordId, record, apiBase);
}

/**
 * Write verification record from audit results (new - uses verification_records layer)
 */
async function writeVerificationRecord(projectId, auditResult, apiBase = DEFAULT_API_BASE) {
  const timestamp = new Date().toISOString();
  const recordId = `${projectId}-veritas-${timestamp.slice(0, 19).replace(/[T:]/g, "-")}`;

  const record = {
    id: recordId,
    project_id: projectId,
    verification_type: "mti_audit",
    timestamp,
    agent: "veritas",
    result: auditResult.score >= 70 ? "PASS" : auditResult.score >= 50 ? "WARN" : "FAIL",
    score: auditResult.score,
    details: {
      components: auditResult.components || {},
      gap_count: auditResult.gaps?.length || 0,
      stories_total: auditResult.coverage?.stories_total || 0,
      stories_covered: auditResult.coverage?.stories_with_artifacts || 0,
    },
    updated_at: timestamp,
  };

  return putRecord("verification_records", recordId, record, apiBase);
}

// ── Governance data extraction (API-first alternative to parse-docs.js) ──────

/**
 * Extract plan (features + stories) from WBS records instead of PLAN.md
 * This is the key switch: governance comes from API, not disk files.
 */
function wbsToPlan(wbsRecords) {
  const features = [];
  const stories = [];

  for (const wbs of wbsRecords) {
    if (!wbs.level) continue;

    if (wbs.level === "deliverable" && wbs.methodology === "agile") {
      // WBS deliverable with agile methodology = feature
      features.push({
        id: wbs.id,
        title: wbs.label || wbs.deliverable || wbs.id,
        source: "data-model-api",
        status: wbs.status || "planned",
        percent_complete: wbs.percent_complete || 0,
      });
    } else if (wbs.level === "deliverable") {
      // Non-agile deliverables still tracked as features
      features.push({
        id: wbs.id,
        title: wbs.label || wbs.deliverable || wbs.id,
        source: "data-model-api",
        status: wbs.status || "planned",
        percent_complete: wbs.percent_complete || 0,
      });
    }
  }

  // Also check for stories in the stories layer (if WBS doesn't contain them)
  for (const wbs of wbsRecords) {
    if (wbs.stories_total > 0) {
      // This WBS node has stories info
    }
  }

  return { features, stories, _source: "data-model-api" };
}

/**
 * Extract status from WBS records instead of STATUS.md
 */
function wbsToStatus(wbsRecords) {
  const declared = {};
  for (const wbs of wbsRecords) {
    if (wbs.status) {
      const prefix = wbs.level === "deliverable" ? "FEATURE" : "STORY";
      declared[`${prefix}:${wbs.id}`] = wbs.status;
    }
  }
  return { declared, source: "data-model-api" };
}

/**
 * Extract acceptance criteria from project governance metadata
 */
function projectToAcceptance(projectData) {
  if (!projectData?.acceptance_criteria) {
    return { criteria: [], _note: "No acceptance_criteria in project record" };
  }
  return {
    criteria: projectData.acceptance_criteria.map((ac) => ({
      story_id: ac.gate || null,
      checked: ac.status === "PASS",
      text: ac.criteria,
      source: "data-model-api",
    })),
  };
}

// ── Full governance fetch (one call replaces 4 file reads) ─────────────────

/**
 * Fetch complete governance context from API
 * Replaces: parsePlan() + parseStatus() + parseAcceptance() + parseEpicFromReadme()
 */
async function fetchGovernanceFromApi(projectId, apiBase = DEFAULT_API_BASE) {
  const [projectRes, wbsRes, evidenceRes] = await Promise.all([
    getProject(projectId, apiBase),
    getProjectWbs(projectId, apiBase),
    getProjectEvidence(projectId, apiBase),
  ]);

  const result = {
    api_reachable: true,
    project: projectRes.ok ? projectRes.data : null,
    wbs: wbsRes.ok ? wbsRes.data : [],
    evidence: evidenceRes.ok ? evidenceRes.data : [],
    plan: null,
    status: null,
    acceptance: null,
    epic: null,
  };

  // Derive plan, status, acceptance from API data
  if (result.wbs.length > 0) {
    result.plan = wbsToPlan(result.wbs);
    result.status = wbsToStatus(result.wbs);
  }

  if (result.project) {
    result.acceptance = projectToAcceptance(result.project);
    result.epic = {
      title: result.project.name || result.project.id || projectId,
      source: "data-model-api",
    };
  }

  return result;
}

module.exports = {
  DEFAULT_API_BASE,
  GovernanceApiError,
  isApiReachable,
  apiFetchFailClosed,
  getProject,
  getProjectWbs,
  getProjectSprints,
  getProjectEvidence,
  getProjectRisks,
  getProjectDecisions,
  getQualityGates,
  putRecord,
  writeTrustScore,
  writeVerificationRecord,
  wbsToPlan,
  wbsToStatus,
  projectToAcceptance,
  fetchGovernanceFromApi,
};
