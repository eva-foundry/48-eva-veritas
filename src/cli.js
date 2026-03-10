#!/usr/bin/env node
// EVA-FEATURE: F48-CHAT
// EVA-STORY: F48-CHAT-001
// EVA-STORY: F48-CHAT-002
// EVA-STORY: F48-CHAT-003
// EVA-STORY: F48-CONVERSATION-001
// EVA-STORY: F48-OTHER-001
// EVA-STORY: F48-PATH-001
// EVA-STORY: F48-PATH-002
// EVA-STORY: F48-PATH-003
// EVA-STORY: F48-PATH-004
// EVA-STORY: F48-PING-001
// EVA-STORY: F48-USERS-001
// EVA-STORY: F48-USERS-002
// EVA-STORY: F48-USERS-003
// EVA-STORY: EO-05-001
// EVA-STORY: EO-05-002
// EVA-STORY: EO-05-003
// EVA-STORY: EO-05-004
// EVA-STORY: EO-05-005
// EVA-FEATURE: EO-05
"use strict";

const { Command } = require("commander");

const { discover } = require("./discover");
const { reconcile } = require("./reconcile");
const { generateAdo } = require("./generate-ado");
const { generatePlan } = require("./generate-plan");
const { computeTrust } = require("./compute-trust");
const { report } = require("./report");
const { audit } = require("./audit");
const { scanPortfolio } = require("./scan-portfolio");
const { startServer } = require("./mcp-server");
const { init } = require("./init");
const { modelAudit } = require("./model-audit");
const { dependencyAudit } = require("./dependency-audit");
const { exportToModel } = require("./export-to-model");
const { uploadToModel } = require("./upload-to-model");

const program = new Command();

program
  .name("eva")
  .description("eva-veritas -- Evidence Plane. Planned vs Actual Truth Engine.")
  .version("0.1.0");

program
  .command("discover")
  .description("Top-down + bottom-up discovery for a repo")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-o, --out <path>", "Output JSON path (default: .eva/discovery.json)")
  .option("-s, --source <mode>", "Governance source: api (default), disk, or auto", "auto")
  .option("--api-base <url>", "Data model API URL (default: cloud API)")
  .action(async (opts) => {
    await discover(opts);
  });

program
  .command("reconcile")
  .description("Reconcile planned vs actual using discovery.json")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-i, --in <path>", "Input discovery.json (default: .eva/discovery.json)")
  .option("-o, --out <path>", "Output reconciliation.json (default: .eva/reconciliation.json)")
  .action(async (opts) => {
    await reconcile(opts);
  });

program
  .command("generate-ado")
  .description("Generate Azure DevOps CSV from planned model")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-d, --discovery <path>", "discovery.json path (default: .eva/discovery.json)")
  .option("-c, --recon <path>", "reconciliation.json path (default: .eva/reconciliation.json)")
  .option("-o, --out <path>", "Output CSV path (default: .eva/ado.csv)")
  .option("--gaps-only", "Only include stories with gap tags (for sprint seeding)")
  .action(async (opts) => {
    await generateAdo(opts);
  });

program
  .command("compute-trust")
  .description("Compute trust score (MTI) from reconciliation")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-c, --recon <path>", "reconciliation.json path (default: .eva/reconciliation.json)")
  .option("-o, --out <path>", "Output trust.json (default: .eva/trust.json)")
  .action(async (opts) => {
    await computeTrust(opts);
  });

program
  .command("audit")
  .description("Combined: discover + reconcile + compute-trust + report in one shot")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-o, --out <path>", "Output dir (default: .eva/)")
  .option("-t, --threshold <number>", "Minimum MTI score to pass (default: 70)", "70")
  .option("-s, --source <mode>", "Governance source: api (default), disk, or auto", "auto")
  .option("--api-base <url>", "Data model API URL (default: cloud API)")
  .option("--warn-only", "Print warning instead of exiting 1 when below threshold")
  .option("--no-sync", "Skip writing MTI results back to data model")
  .action(async (opts) => {
    opts.threshold = parseInt(opts.threshold, 10);
    await audit(opts);
  });

program
  .command("generate-plan")
  .description(
    "Infer Feature/Story decomposition from existing docs (any format) and write .eva/veritas-plan.json"
  )
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-p, --prefix <id>", "Project ID prefix (e.g. F33). Default: derived from folder name")
  .option("-o, --out <path>", "Output JSON path (default: .eva/veritas-plan.json)")
  .option("--sync-model", "Push plan summary to EVA data model API after writing")
  .option("--ado-import <csv>", "Import plan from an ADO work-item export CSV (replaces doc inference)")
  .option("--enrich", "Force code-structure enrichment even when plan already has >= 20 stories")
  .action(async (opts) => {
    await generatePlan(opts);
  });

program
  .command("scan-portfolio")
  .description("Audit all numbered EVA projects under a root folder, print portfolio MTI table")
  .option("-p, --portfolio <path>", "Portfolio root path (default: cwd)", process.cwd())
  .option("--filter <ids>", "Comma-separated project ID prefixes to include (e.g. 29,33,31)")
  .option("--model", "Add MODEL-FID column: read model-fidelity.json per project")
  .action(async (opts) => {
    await scanPortfolio(opts);
  });

program
  .command("mcp-server")
  .description("Start the eva-veritas MCP HTTP server (default port: 8030)")
  .option("-p, --port <number>", "Port to listen on", "8030")
  .action((opts) => {
    startServer(parseInt(opts.port, 10));
  });

program
  .command("report")
  .description("Print a human-readable report (planned vs actual)")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-d, --discovery <path>", "discovery.json path (default: .eva/discovery.json)")
  .option("-c, --recon <path>", "reconciliation.json path (default: .eva/reconciliation.json)")
  .option("-t, --trust <path>", "trust.json path (default: .eva/trust.json)")
  .action(async (opts) => {
    await report(opts);
  });

program
  .command("init")
  .description("Interactive onboarding wizard: detect structure, generate plan, run first audit")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-y, --yes", "Non-interactive: accept all defaults without prompting")
  .option("-p, --prefix <id>", "Project ID prefix (e.g. F33). Default: derived from folder name")
  .option("-t, --threshold <number>", "Minimum MTI to report (default: from .evarc or 70)")
  .action(async (opts) => {
    if (opts.threshold !== undefined) opts.threshold = parseInt(opts.threshold, 10);
    await init(opts);
  });

program
  .command("model-audit")
  .description("Cross-reference declared data model entities against repo filesystem")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("--data-model <url>", "Data model API URL (default: from .evarc or http://localhost:8010)")
  .option("--warn-only", "Print warning instead of exiting 1 when drift detected")
  .action(async (opts) => {
    await modelAudit(opts);
  });

program
  .command("dependency-audit")
  .description("Proactive forward-looking gate check -- READY/PARTIAL/BLOCKED verdict per active feature in PLAN.md")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("--data-model <url>", "Data model API URL (default: ACA production endpoint)")
  .option("--json", "Output machine-readable JSON")
  .action(async (opts) => {
    await dependencyAudit({
      repo: opts.repo,
      data_model_url: opts.dataModel,
      json: opts.json === true
    });
  });

program
  .command("export-to-model")
  .description("Transform Veritas discovery/reconciliation into EVA Data Model layer records (WBS, Evidence, Decisions, Risks)")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-o, --out <path>", "Output JSON path (default: .eva/model-export.json)")
  .option("--layers <list>", "Comma-separated layer list: wbs,evidence,decisions,risks (default: all)")
  .option("--dry-run", "Preview extraction without writing files")
  .action(async (opts) => {
    await exportToModel(opts);
  });

program
  .command("upload-to-model")
  .description("Upload extracted model records to EVA Data Model cloud API with conflict resolution")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-i, --in <path>", "Input model-export.json (default: .eva/model-export.json)")
  .option("-o, --out <path>", "Output results.json (default: .eva/upload-results.json)")
  .option("--layers <list>", "Comma-separated layer list: wbs,evidence,decisions,risks (default: all)")
  .option("--api-base <url>", "API base URL (default: cloud API)")
  .option("--dry-run", "Simulate upload without sending any requests")
  .action(async (opts) => {
    await uploadToModel(opts);
  });

program
  .command("sync")
  .description("Full paperless DPDCA: discover (API-first) + reconcile + trust + write results back to data model")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("--api-base <url>", "Data model API URL (default: cloud API)")
  .option("-t, --threshold <number>", "Minimum MTI score to pass (default: 70)", "70")
  .option("--export-layers <list>", "Also export WBS/evidence/decisions/risks to API", "wbs,evidence")
  .option("--dry-run", "Preview sync without writing to API")
  .action(async (opts) => {
    opts.threshold = parseInt(opts.threshold, 10);
    opts.source = "auto"; // sync always tries API first
    console.log("[INFO] Paperless DPDCA sync: API-first discover + audit + write-back");
    await audit(opts);
    // Also export and upload governance records
    if (!opts.dryRun) {
      try {
        await exportToModel({ repo: opts.repo, layers: opts.exportLayers });
        await uploadToModel({ repo: opts.repo, layers: opts.exportLayers, apiBase: opts.apiBase });
        console.log("[PASS] Full paperless DPDCA sync complete");
      } catch (e) {
        console.log(`[WARN] Export/upload step failed (non-fatal): ${e.message}`);
      }
    }
  });

program.parseAsync(process.argv);
