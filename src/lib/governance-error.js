/**
 * governance-error.js
 * 
 * Structured error utilities for API-only governance mode (fail-closed policy).
 * Used by discover.js, audit.js, and all governance-critical MCP tools.
 * 
 * Each error includes: correlation_id, operation, endpoint, timeout, retries, policy=fail_closed
 */

"use strict";

const crypto = require("crypto");

/**
 * Governance API Error - used when data model API is unreachable or fails
 */
class GovernanceApiError extends Error {
  constructor(message, {
    operation = "unknown",
    endpoint = "unknown",
    timeout = null,
    retries = 0,
    httpStatus = null,
    originalError = null,
    policy = "fail_closed"
  } = {}) {
    const correlationId = crypto.randomBytes(8).toString("hex");
    const fullMessage = `[GOVERNANCE FAIL-CLOSED] ${message} (op=${operation}, endpoint=${endpoint}, correlation_id=${correlationId}, policy=${policy})`;
    super(fullMessage);
    this.name = "GovernanceApiError";
    this.correlationId = correlationId;
    this.operation = operation;
    this.endpoint = endpoint;
    this.timeout = timeout;
    this.retries = retries;
    this.httpStatus = httpStatus;
    this.policy = policy;
    this.originalError = originalError;
  }

  /**
   * Returns full error payload for logging/reporting
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      operation: this.operation,
      endpoint: this.endpoint,
      timeout: this.timeout,
      retries: this.retries,
      httpStatus: this.httpStatus,
      policy: this.policy,
      correlationId: this.correlationId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Degraded Mode Warning - printed when --allow-degraded is used
 */
function printDegradedModeWarning() {
  const warn = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                   ⚠️  DEGRADED MODE ACTIVE - NOT GOVERNANCE COMPLIANT         ║
║                                                                              ║
║ WARNING: Running with --allow-degraded flag. Local file fallback is enabled ║
║ but this mode is NOT governance compliant and should ONLY be used for       ║
║ local development troubleshooting.                                          ║
║                                                                              ║
║ DO NOT USE IN CI/PROD. Governance requires API-only data sourcing.          ║
║                                                                              ║
║ To run in compliant mode: remove --allow-degraded flag                      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
  console.error(warn);
}

/**
 * Check if degraded mode is allowed (dev/troubleshooting only)
 */
function isDegradedModeAllowed(opts) {
  // --allow-degraded must be explicitly set
  if (!opts.allowDegraded) return false;
  
  // CI environment blocks degraded mode
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    throw new GovernanceApiError(
      "Degraded mode not allowed in CI/prod environment",
      {
        operation: "degraded_mode_check",
        endpoint: "environment",
        policy: "fail_closed"
      }
    );
  }
  
  // Print warning
  printDegradedModeWarning();
  return true;
}

module.exports = {
  GovernanceApiError,
  isDegradedModeAllowed,
  printDegradedModeWarning
};
