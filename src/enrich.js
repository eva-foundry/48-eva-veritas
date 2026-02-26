/**
 * enrich.js -- Veritas post-reconcile enrichment step
 *
 * Reads .eva/reconciliation.json (produced by reconcile.js), then queries the
 * EVA Data Model API to annotate each story with:
 *   - endpoint_count    : number of endpoints whose story_ids include this story
 *   - container_count   : number of containers read/written by those endpoints
 *   - fp_weight         : rough IFPUG weight derived from endpoint/container counts
 *   - complexity        : "Low" | "Med" | "High"  (derived from fp_weight)
 *
 * Writes .eva/enrichment.json when done.
 *
 * Usage (internal -- called by audit.js after reconcile):
 *   const { enrich } = require('./enrich');
 *   const enrichmentData = await enrich(repoPath, options);
 *
 * Environment:
 *   EVA_DATA_MODEL_URL -- override the data model base URL (optional)
 *                         default: https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DEFAULT_BASE_URL =
  'https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io';

/**
 * Derive FP complexity bucket from combined endpoint + container counts.
 * This is an approximation; use fp.py for the authoritative IFPUG estimate.
 * @param {number} epCount
 * @param {number} ctrCount
 * @returns {{ fp_weight: number, complexity: string }}
 */
function deriveFpWeight(epCount, ctrCount) {
  const score = epCount + ctrCount * 2;
  if (score >= 12) return { fp_weight: score, complexity: 'High' };
  if (score >= 5)  return { fp_weight: score, complexity: 'Med'  };
  return             { fp_weight: score, complexity: 'Low'  };
}

/**
 * Fetch JSON from the data model API.
 * Uses the built-in https module so no extra dependencies are needed.
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Main enrichment pipeline.
 *
 * @param {string} repoPath   Absolute path to the project root.
 * @param {{ baseUrl?: string, warn?: boolean }} [options]
 * @returns {Promise<EnrichmentResult>}
 *
 * @typedef {{ story_id: string, endpoint_count: number, container_count: number, fp_weight: number, complexity: string }} StoryAnnotation
 * @typedef {{ annotations: StoryAnnotation[], total_stories: number, annotated_count: number, unannotated_count: number, model_reachable: boolean, error?: string }} EnrichmentResult
 */
async function enrich(repoPath, options = {}) {
  const evaDir   = path.join(repoPath, '.eva');
  const reconPath = path.join(evaDir, 'reconciliation.json');
  const outPath   = path.join(evaDir, 'enrichment.json');

  /** @type {EnrichmentResult} */
  const result = {
    annotations: [],
    total_stories: 0,
    annotated_count: 0,
    unannotated_count: 0,
    model_reachable: false,
  };

  // -- Read reconciliation output ------------------------------------------
  if (!fs.existsSync(reconPath)) {
    result.error = `reconciliation.json not found at ${reconPath} -- run reconcile first`;
    return result;
  }

  let reconciliation;
  try {
    reconciliation = JSON.parse(fs.readFileSync(reconPath, 'utf8'));
  } catch (e) {
    result.error = `Failed to parse reconciliation.json: ${e.message}`;
    return result;
  }

  const stories = (reconciliation.stories || []).map(
    (s) => (typeof s === 'string' ? { id: s } : s)
  );
  result.total_stories = stories.length;

  if (stories.length === 0) {
    result.error = 'No stories found in reconciliation.json';
    return result;
  }

  // -- Query the data model ------------------------------------------------
  const baseUrl = options.baseUrl || process.env.EVA_DATA_MODEL_URL || DEFAULT_BASE_URL;

  let allEndpoints = [];
  try {
    const eps = await fetchJson(`${baseUrl}/model/endpoints/`);
    allEndpoints  = Array.isArray(eps) ? eps : [];
    result.model_reachable = true;
  } catch (e) {
    result.error  = `Data model unreachable (${baseUrl}): ${e.message}`;
    result.model_reachable = false;
    // Produce unenriched annotations so the pipeline can still complete
    for (const s of stories) {
      result.annotations.push({
        story_id: s.id,
        endpoint_count: 0,
        container_count: 0,
        fp_weight: 0,
        complexity: 'Low',
      });
    }
    result.unannotated_count = stories.length;
    writeResult(outPath, result);
    return result;
  }

  // Build an index: story_id -> endpoints that reference it
  /** @type {Map<string, Set<string>>} */
  const storyToEndpoints   = new Map();
  /** @type {Map<string, Set<string>>} */
  const storyToContainers  = new Map();

  for (const ep of allEndpoints) {
    const storyIds = ep.story_ids || [];
    const reads    = ep.cosmos_reads  || [];
    const writes   = ep.cosmos_writes || [];
    const allCtrs  = Array.from(new Set([...reads, ...writes]));

    for (const sid of storyIds) {
      if (!storyToEndpoints.has(sid))  storyToEndpoints.set(sid,  new Set());
      if (!storyToContainers.has(sid)) storyToContainers.set(sid, new Set());
      storyToEndpoints.get(sid).add(ep.id);
      for (const c of allCtrs) storyToContainers.get(sid).add(c);
    }
  }

  // -- Annotate each story -------------------------------------------------
  for (const s of stories) {
    const sid       = s.id;
    const epSet     = storyToEndpoints.get(sid)  || new Set();
    const ctrSet    = storyToContainers.get(sid) || new Set();
    const epCount   = epSet.size;
    const ctrCount  = ctrSet.size;
    const { fp_weight, complexity } = deriveFpWeight(epCount, ctrCount);

    result.annotations.push({
      story_id: sid,
      endpoint_count:  epCount,
      container_count: ctrCount,
      endpoints:       Array.from(epSet),
      containers:      Array.from(ctrSet),
      fp_weight,
      complexity,
    });

    if (epCount > 0) {
      result.annotated_count++;
    } else {
      result.unannotated_count++;
    }
  }

  writeResult(outPath, result);
  return result;
}

/**
 * Write enrichment JSON to disk.
 * @param {string} outPath
 * @param {any} result
 */
function writeResult(outPath, result) {
  try {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (e) {
    // Non-fatal -- result is still returned to the caller
    console.warn(`[enrich] Could not write ${outPath}: ${e.message}`);
  }
}

module.exports = { enrich };
