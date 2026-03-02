// EVA-STORY: F37-FK-003
// Enhancement 3: Veritas Quality Gates for WBS Field Population
// Enforces data model field population before marking stories done
"use strict";

// Node.js 18+ has built-in fetch; for older versions, fall back to https module
let fetchImpl;
try {
  fetchImpl = fetch; // Try built-in fetch (Node 18+)
} catch {
  // Fallback for Node < 18: use https module
  const https = require("https");
  fetchImpl = (url) => {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              ok: true,
              status: res.statusCode,
              json: async () => JSON.parse(data)
            });
          } else {
            resolve({
              ok: false,
              status: res.statusCode,
              json: async () => ({})
            });
          }
        });
      }).on("error", reject);
    });
  };
}

/**
 * Check WBS field population quality for stories marked "done".
 * 
 * Quality Gates:
 * - sprint: must be populated for done stories
 * - assignee: must be populated for done stories
 * - ado_id: must be populated for done stories (ADO linkage required)
 * 
 * @param {Object} opts - Options
 * @param {string} opts.dataModelUrl - Data model API base URL
 * @param {string} opts.project - Project ID (e.g., "37-data-model", "51-ACA")
 * @param {number} opts.threshold - Minimum field population rate (0-1, default: 0.90)
 * @returns {Promise<Object>} - { pass: boolean, violations: Array, metrics: Object }
 */
async function checkWbsQualityGates(opts = {}) {
  const dataModelUrl = opts.dataModelUrl || "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io";
  const project = opts.project;
  const threshold = opts.threshold || 0.90; // 90% default

  if (!project) {
    throw new Error("checkWbsQualityGates: project parameter required");
  }

  // Fetch all WBS stories for this project from data model
  let stories = [];
  try {
    const response = await fetchImpl(`${dataModelUrl}/model/wbs/`);
    if (!response.ok) {
      throw new Error(`Data model API returned ${response.status}`);
    }
    const allStories = await response.json();
    // Filter by project (WBS id format: PROJECT-NN-NNN or F##-NN-NNN)
    stories = allStories.filter(s => {
      // Extract project prefix from story ID
      const parts = s.id.split("-");
      if (parts.length >= 2) {
        const prefix = parts[0]; // "F37", "ACA", etc.
        return project.includes(prefix) || prefix.includes(project.split("-")[0]);
      }
      return false;
    });
  } catch (err) {
    console.error(`[ERROR] Failed to fetch WBS from data model: ${err.message}`);
    return {
      pass: false,
      violations: [],
      metrics: {},
      error: err.message
    };
  }

  if (stories.length === 0) {
    console.log(`[WARN] No WBS stories found for project: ${project}`);
    return {
      pass: true,
      violations: [],
      metrics: { total: 0, done: 0 },
      message: "No stories to validate"
    };
  }

  // Filter to "done" stories only
  const doneStories = stories.filter(s => s.status === "done" || s.done === true);

  if (doneStories.length === 0) {
    return {
      pass: true,
      violations: [],
      metrics: {
        total: stories.length,
        done: 0,
        sprint_populated: 0,
        assignee_populated: 0,
        ado_id_populated: 0
      },
      message: "No done stories to validate"
    };
  }

  // Check field population for done stories
  const violations = [];
  let sprintCount = 0;
  let assigneeCount = 0;
  let adoIdCount = 0;

  for (const story of doneStories) {
    const missing = [];
    
    if (!story.sprint || story.sprint === "") {
      missing.push("sprint");
    } else {
      sprintCount++;
    }
    
    if (!story.assignee || story.assignee === "") {
      missing.push("assignee");
    } else {
      assigneeCount++;
    }
    
    if (!story.ado_id || story.ado_id === "") {
      missing.push("ado_id");
    } else {
      adoIdCount++;
    }

    if (missing.length > 0) {
      violations.push({
        story_id: story.id,
        title: story.label || story.title || "(no title)",
        missing_fields: missing,
        message: `Story ${story.id} cannot be marked done: ${missing.join(", ")} required`
      });
    }
  }

  const sprintRate = sprintCount / doneStories.length;
  const assigneeRate = assigneeCount / doneStories.length;
  const adoIdRate = adoIdCount / doneStories.length;
  
  // Overall field population score (average of three rates)
  const fieldPopulationScore = (sprintRate + assigneeRate + adoIdRate) / 3;

  const pass = violations.length === 0 && fieldPopulationScore >= threshold;

  return {
    pass,
    violations,
    metrics: {
      total: stories.length,
      done: doneStories.length,
      sprint_populated: sprintCount,
      sprint_rate: round2(sprintRate),
      assignee_populated: assigneeCount,
      assignee_rate: round2(assigneeRate),
      ado_id_populated: adoIdCount,
      ado_id_rate: round2(adoIdRate),
      field_population_score: round2(fieldPopulationScore),
      threshold: round2(threshold)
    },
    message: pass 
      ? `All ${doneStories.length} done stories have required fields populated`
      : `${violations.length} done stories missing required fields (threshold: ${Math.round(threshold * 100)}%)`
  };
}

/**
 * Compute field population score for ALL stories (not just done).
 * Used to extend MTI calculation with 5th component.
 * 
 * @param {Object} opts - Options
 * @param {string} opts.dataModelUrl - Data model API base URL
 * @param {string} opts.project - Project ID
 * @returns {Promise<number>} - Field population score (0-1)
 */
async function computeFieldPopulationScore(opts = {}) {
  const dataModelUrl = opts.dataModelUrl || "https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io";
  const project = opts.project;

  if (!project) {
    return 0;
  }

  try {
    const response = await fetchImpl(`${dataModelUrl}/model/wbs/`);
    if (!response.ok) {
      return 0;
    }
    const allStories = await response.json();
    const stories = allStories.filter(s => {
      const parts = s.id.split("-");
      if (parts.length >= 2) {
        const prefix = parts[0];
        return project.includes(prefix) || prefix.includes(project.split("-")[0]);
      }
      return false;
    });

    if (stories.length === 0) {
      return 0;
    }

    let sprintCount = 0;
    let assigneeCount = 0;
    let adoIdCount = 0;

    for (const story of stories) {
      if (story.sprint && story.sprint !== "") sprintCount++;
      if (story.assignee && story.assignee !== "") assigneeCount++;
      if (story.ado_id && story.ado_id !== "") adoIdCount++;
    }

    const sprintRate = sprintCount / stories.length;
    const assigneeRate = assigneeCount / stories.length;
    const adoIdRate = adoIdCount / stories.length;

    // Average of three rates
    return (sprintRate + assigneeRate + adoIdRate) / 3;
  } catch (err) {
    console.error(`[ERROR] computeFieldPopulationScore: ${err.message}`);
    return 0;
  }
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

module.exports = {
  checkWbsQualityGates,
  computeFieldPopulationScore
};
