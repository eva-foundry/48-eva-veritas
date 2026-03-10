# Copilot Instructions -- eva-veritas (48-eva-veritas)

**Version**: 1.3.0
**Project**: eva-veritas -- EVA Evidence Plane
**Maturity**: active
**Phase 1**: COMPLETE 2026-02-24 09:32 ET (CLI, self-tested, POC proved)
**Phase 2**: COMPLETE 2026-02-24 (MCP server + 29-foundry / 37-data-model / 38-ado-poc integrations; MTI=100)
**Phase 3**: COMPLETE 2026-03-09 (Data Model API integration -- paperless governance)

---

## PART 1 (Universal) -- Read workspace instructions first

See `C:\AICOE\.github\copilot-instructions.md` for workspace-wide rules.

---

## PART 2 -- Project-Specific Context

### Workspace-Level Status

**PROMOTION**: Core MCP tools from this project are now **workspace-level primitives**:
- `audit_repo`, `get_trust_score`, `sync_repo`, `export_to_model`, `dependency_audit`, `scan_portfolio`
- Available to all workspace skills including `@scrum-master`
- Reference: Workspace copilot-instructions.md § "Workspace-Level MCP Tools"
- Usage: Sprint evidence gates, progress reports, portfolio dashboards, paperless governance

### Project Lock

This file is the copilot-instructions for **48-eva-veritas** (eva-veritas).

The workspace-level bootstrap rule "Step 1 -- Identify the active project from the currently open file path"
applies **only at the initial load of this file** (first read at session start).
Once this file has been loaded, the active project is locked to **48-eva-veritas** for the entire session.
Do NOT re-evaluate project identity from editorContext or terminal CWD on each subsequent request.
Work state and sprint context are read from `STATUS.md` and `PLAN.md` at bootstrap -- not from this file.

---

### What this project does

`eva-veritas` is the **Evidence Plane** of the EVA architecture -- a **Node.js CLI + MCP server** that computes the gap between *declared* project progress (docs) and *actual* project progress (artifacts in the filesystem).

It answers: **Is the declared progress real?**

`eva-veritas` is the operational verifier used by EVA governance. The MTI model has evolved in code,
and governance ownership is aligned with `47-eva-mti` (superseding legacy `49-eva-dtl` references).

Phase 1 (CLI) is complete and self-tested. Phase 2 adds an MCP server so any agent in the EVA ecosystem can invoke audit tools.

It outputs:

- `discovery.json` -- planned model + actual artifacts
- `reconciliation.json` -- gaps, coverage, consistency score
- `trust.json` -- Machine Trust Index (MTI) score 0-100
- `ado.csv` -- Azure DevOps import-ready work items

### Stack

- Node.js 20+ (CommonJS, `require`)
- commander v12, fast-glob v3, js-yaml v4
- No TypeScript, no build step -- run directly with `node`

### Key file conventions

All source files carry EVA-STORY and EVA-FEATURE header tags:

```js
// EVA-STORY: EO-05-001
// EVA-FEATURE: EO-05
```

### PLAN.md convention

Features use `## Feature: <Title> [ID=EO-XX]`, stories use `### Story: <Title> [ID=EO-XX-XXX]`.

### STATUS.md convention

```text
STORY EO-01-001: 60%
FEATURE EO-01: 40%
```

### ACCEPTANCE.md convention

```markdown
## Story: <Title> [ID=EO-XX-XXX]
- [ ] criterion text
```

### Running the CLI

```bash
cd C:\AICOE\eva-foundry\48-eva-veritas
node src/cli.js discover --repo .
node src/cli.js reconcile --repo .
node src/cli.js compute-trust --repo .
node src/cli.js report --repo .
```

### Running the MCP server (Phase 2)

```bash
node src/cli.js mcp-server       # default port 8030
node src/cli.js mcp-server --port 4000
# direct entrypoint is also supported:
node src/mcp-server.js --port 8030
```

### GitHub Actions usage

- Default gate path: run CLI directly (`node src/cli.js audit --repo . --threshold 70`) in workflow jobs.
- MCP-in-CI path: start `mcp-server` and invoke `/tools/{name}` for cross-repo orchestration jobs.
- Reference guide: `docs/GITHUB-ACTIONS.md`.

### MCP tool names (Phase 2 + Phase 3)

`audit_repo`, `get_trust_score`, `get_coverage`, `generate_ado_items`, `scan_portfolio`, `model_audit`, `dependency_audit`, `sync_repo`, `export_to_model`

### Paperless sync command (Phase 3)

```bash
# Full paperless DPDCA: API-first discover + audit + write-back to data model
node src/cli.js sync --repo .
# With governance export to cloud API:
node src/cli.js sync --repo . --export-layers wbs,evidence,decisions,risks
```

### Testing against another EVA project

```bash
node src/cli.js discover --repo C:\AICOE\eva-foundry\36-red-teaming
node src/cli.js report --repo C:\AICOE\eva-foundry\36-red-teaming
```

### Key modules

| Module | Responsibility |
|--------|---------------|
| `src/lib/data-model-client.js` | API client for EVA Data Model (query + write-back, API-first governance) |
| `src/lib/parse-docs.js` | Top-down: reads README/PLAN/STATUS/ACCEPTANCE (disk fallback) |
| `src/lib/scan-repo.js` | Bottom-up: globs all files, classifies artifact types |
| `src/lib/map-artifacts.js` | Links artifacts to stories via EVA-STORY tags |
| `src/lib/trust.js` | MTI engine with adaptive 3/4/5 component formulas (coverage/evidence/consistency + enrichment signals when available) |
| `src/lib/ado-csv.js` | Generates ADO import CSV |
| `src/export-to-model.js` | Extracts WBS/evidence/decisions/risks for data model upload |
| `src/upload-to-model.js` | Uploads extracted records to cloud API with conflict resolution |

---

## PART 3 -- Quality Gates

- All JS files must have EVA-STORY and EVA-FEATURE header tags
- No emoji in JSON/CSV/console report output (use [PASS]/[FAIL] patterns)
- All `writeJson` calls use 2-space indent
- All output files include `meta.schema`, `meta.generated_at`, `meta.repo`
- `eva report` must not crash when input files are missing -- print graceful fallback
- No bare `import` -- use CommonJS `require` throughout
