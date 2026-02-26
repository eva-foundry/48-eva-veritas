// EVA-STORY: EO-07-001
// EVA-STORY: EO-07-002
// EVA-STORY: EO-07-003
// EVA-STORY: EO-07-004
// EVA-STORY: EO-07-005
// EVA-STORY: EO-07-006
// EVA-FEATURE: EO-07

/**
 * Evidence receipt: EO-07 MCP Server
 *
 * Implemented: src/mcp-server.js
 *
 * Deliverables:
 *   EO-07-001  src/mcp-server.js  -- HTTP server, GET /tools, POST /tools/{name}, GET /health
 *   EO-07-002  handleAuditRepo    -- runs discover+reconcile+trust, returns gaps/coverage/score
 *   EO-07-003  handleGetTrustScore -- reads/refreshes trust.json, returns score+components
 *   EO-07-004  handleGetCoverage  -- returns stories_total/with_artifacts/with_evidence/consistency
 *   EO-07-005  handleGenerateAdoItems -- wraps toCsvRows, returns structured JSON work items
 *   EO-07-006  handleScanPortfolio -- iterates numbered projects, returns portfolio_mti
 *
 * CLI integration:
 *   eva mcp-server --port 8030
 *   node src/mcp-server.js --port 8030
 *
 * Verified: GET /health, GET /tools, POST /tools/audit_repo
 */
console.log("[EVIDENCE] EO-07 MCP Server -- all 6 tools implemented");
