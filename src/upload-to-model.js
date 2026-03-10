// EVA-STORY: EO-11-002
// EVA-FEATURE: EO-11
"use strict";

/**
 * upload-to-model.js
 * 
 * Phase 2: Upload extracted governance records to EVA Data Model cloud API
 * 
 * Transforms `.eva/model-export.json` into cloud-ready batch operations with:
 * - Conflict resolution (skip if newer exists, update if older)
 * - Batching (50 records/batch for reliability)
 * - Retry logic (3 attempts with exponential backoff)
 * - Audit trail (PUT log with timestamps)
 * 
 * Usage:
 *   eva upload-to-model --repo ./07-foundation-layer [--dry-run] [--layers wbs,evidence]
 */

const path = require("path");
const { readJsonIfExists, writeJson, ensureDir } = require("./lib/fs-utils");

const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(url, options, retryCount = 0) {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      if (response.status === 409) {
        // Conflict - record already exists, capture response
        return { status: 409, data: await response.json().catch(() => null) };
      }
      if (response.status === 404) {
        return { status: 404, data: null };
      }
      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
        console.log(`[RETRY] ${url} after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        return fetchWithRetry(url, options, retryCount + 1);
      }
      throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "Unknown error")}`);
    }
    
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    if (retryCount < MAX_RETRIES && error.message.includes("Connection")) {
      const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
      console.log(`[RETRY] Connection error after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Check if record exists in cloud API and compare timestamps
 */
async function checkExistingRecord(apiBase, layer, recordId) {
  const url = `${apiBase}/model/${layer}/${recordId}`;
  
  try {
    const result = await fetchWithRetry(url, { method: "GET" });
    
    if (result.status === 404) {
      return { exists: false };
    }
    
    if (result.data) {
      return { 
        exists: true, 
        timestamp: result.data.updated_at || result.data.created_at,
        record: result.data
      };
    }
    
    return { exists: false };
  } catch (error) {
    console.log(`[WARN] Failed to check ${layer}/${recordId}: ${error.message}`);
    return { exists: false }; // Assume new if check fails
  }
}

/**
 * Determine conflict resolution strategy
 * - "insert": New record → POST
 * - "update": Older record exists → PUT
 * - "skip": Newer record exists → skip
 * - "error": Conflict without clear resolution
 */
async function resolveConflict(apiBase, layer, newRecord) {
  const existing = await checkExistingRecord(apiBase, layer, newRecord.id);
  
  if (!existing.exists) {
    return { strategy: "insert", reason: "Record not found in API" };
  }
  
  const existingTime = new Date(existing.timestamp).getTime();
  const newTime = new Date(newRecord.updated_at || newRecord.created_at).getTime();
  
  if (newTime > existingTime) {
    return { 
      strategy: "update", 
      reason: `New record newer (${new Date(newTime).toISOString()} > ${existing.timestamp})`
    };
  } else if (newTime === existingTime) {
    return { 
      strategy: "skip", 
      reason: "Same timestamp - no update needed"
    };
  } else {
    return { 
      strategy: "skip", 
      reason: `Existing record newer (${existing.timestamp} > ${new Date(newTime).toISOString()})`
    };
  }
}

/**
 * Upload batch of records with conflict resolution
 */
async function uploadBatch(apiBase, layer, batch, dryRun = false) {
  const results = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: []
  };
  
  for (const record of batch) {
    try {
      const conflict = await resolveConflict(apiBase, layer, record);
      const operation = `${layer}/${record.id}`;
      
      let opResult = {
        operation,
        strategy: conflict.strategy,
        reason: conflict.reason
      };
      
      if (dryRun) {
        console.log(`[DRY-RUN] ${conflict.strategy.toUpperCase()} ${operation}`);
        results.details.push({ ...opResult, status: "dry_run" });
      } else {
        if (conflict.strategy === "insert") {
          const url = `${apiBase}/model/${layer}`;
          const putResult = await fetchWithRetry(url, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "X-Actor": "copilot-agent"
            },
            body: JSON.stringify(record)
          });
          
          if (putResult.status >= 200 && putResult.status < 300) {
            results.inserted += 1;
            opResult.status = "inserted";
            console.log(`[INSERT] ${operation}`);
          } else {
            results.failed += 1;
            opResult.status = "failed";
            opResult.error = putResult.status;
            console.log(`[FAIL] ${operation} - HTTP ${putResult.status}`);
          }
        } else if (conflict.strategy === "update") {
          const url = `${apiBase}/model/${layer}/${record.id}`;
          const putResult = await fetchWithRetry(url, {
            method: "PUT",
            headers: { 
              "Content-Type": "application/json",
              "X-Actor": "copilot-agent"
            },
            body: JSON.stringify(record)
          });
          
          if (putResult.status >= 200 && putResult.status < 300) {
            results.updated += 1;
            opResult.status = "updated";
            console.log(`[UPDATE] ${operation}`);
          } else {
            results.failed += 1;
            opResult.status = "failed";
            opResult.error = putResult.status;
            console.log(`[FAIL] ${operation} - HTTP ${putResult.status}`);
          }
        } else {
          results.skipped += 1;
          opResult.status = "skipped";
          console.log(`[SKIP] ${operation} - ${conflict.reason}`);
        }
      }
      
      results.details.push(opResult);
    } catch (error) {
      results.failed += 1;
      console.log(`[ERROR] ${layer}/${record.id}: ${error.message}`);
      results.details.push({
        operation: `${layer}/${record.id}`,
        status: "error",
        error: error.message
      });
    }
  }
  
  return results;
}

/**
 * Main upload orchestrator
 */
async function uploadToModel(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const projectId = path.basename(repoPath);
  const modelExportPath = path.resolve(opts.in || path.join(repoPath, ".eva", "model-export.json"));
  const resultsPath = path.resolve(opts.out || path.join(repoPath, ".eva", "upload-results.json"));
  
  const selectedLayers = new Set((opts.layers || "wbs,evidence,decisions,risks")
    .split(",")
    .map(l => l.trim().toLowerCase())
  );
  
  const dryRun = opts.dryRun || false;
  const apiBase = opts.apiBase || process.env.EVA_API_BASE || 
    "https://msub-eva-data-model.victoriousgrass-30debbd3.canadacentral.azurecontainerapps.io";

  console.log(`[INFO] upload-to-model: ${projectId}`);
  console.log(`[INFO] API Base: ${apiBase}`);
  console.log(`[INFO] Layers: ${Array.from(selectedLayers).join(", ")}`);
  if (dryRun) {
    console.log("[INFO] DRY-RUN MODE: No records will be uploaded");
  }

  // Load model export
  const modelExport = readJsonIfExists(modelExportPath);
  if (!modelExport) {
    throw new Error(`model-export.json not found at ${modelExportPath}. Run: eva export-to-model --repo ${repoPath}`);
  }

  // Initialize results
  const uploadResults = {
    meta: {
      schema: "eva.upload-to-model.v1",
      timestamp: new Date().toISOString(),
      project_id: projectId,
      api_base: apiBase,
      dry_run: dryRun,
      layers_uploaded: Array.from(selectedLayers),
      source_export: modelExportPath
    },
    summary: {
      total_records: 0,
      total_inserted: 0,
      total_updated: 0,
      total_skipped: 0,
      total_failed: 0
    },
    layers: {}
  };

  console.log("[INFO] Starting upload process...\n");

  // Upload each layer
  for (const layer of selectedLayers) {
    const records = modelExport[layer] || [];
    
    if (records.length === 0) {
      console.log(`[SKIP] Layer ${layer} - no records to upload`);
      uploadResults.layers[layer] = {
        total: 0,
        batches: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        batch_results: []
      };
      continue;
    }

    console.log(`[START] Layer 26 (WBS) - ${records.length} records`);
    const layerResults = {
      total: records.length,
      batches: Math.ceil(records.length / BATCH_SIZE),
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      batch_results: []
    };

    // Process in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(records.length / BATCH_SIZE);

      console.log(`\n[BATCH] ${layer} - Batch ${batchNum}/${totalBatches} (${batch.length} records)`);

      const batchResult = await uploadBatch(apiBase, layer, batch, dryRun);

      // Accumulate batch results
      layerResults.inserted += batchResult.inserted;
      layerResults.updated += batchResult.updated;
      layerResults.skipped += batchResult.skipped;
      layerResults.failed += batchResult.failed;
      layerResults.batch_results.push({
        batch: batchNum,
        ...batchResult
      });

      // Respect API rate limits
      if (i + BATCH_SIZE < records.length && !dryRun) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    uploadResults.layers[layer] = layerResults;
    uploadResults.summary.total_records += records.length;
    uploadResults.summary.total_inserted += layerResults.inserted;
    uploadResults.summary.total_updated += layerResults.updated;
    uploadResults.summary.total_skipped += layerResults.skipped;
    uploadResults.summary.total_failed += layerResults.failed;

    console.log(`[DONE] ${layer}`);
    console.log(`       Inserted: ${layerResults.inserted}, Updated: ${layerResults.updated}, Skipped: ${layerResults.skipped}, Failed: ${layerResults.failed}`);
  }

  // Write results
  console.log(`\n[INFO] Writing results to ${resultsPath}`);
  ensureDir(path.dirname(resultsPath));
  writeJson(resultsPath, uploadResults, 2);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("UPLOAD SUMMARY");
  console.log("=".repeat(60));
  console.log(`Project: ${projectId}`);
  console.log(`Total Records: ${uploadResults.summary.total_records}`);
  console.log(`  Inserted: ${uploadResults.summary.total_inserted}`);
  console.log(`  Updated: ${uploadResults.summary.total_updated}`);
  console.log(`  Skipped: ${uploadResults.summary.total_skipped}`);
  console.log(`  Failed: ${uploadResults.summary.total_failed}`);
  console.log(`Status: ${uploadResults.summary.total_failed === 0 ? "✅ SUCCESS" : "⚠️ WITH FAILURES"}`);
  console.log("=".repeat(60));

  return uploadResults;
}

module.exports = { uploadToModel };
