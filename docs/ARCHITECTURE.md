# ARCHITECTURE.md -- eva-veritas

---

## Overview

`eva-veritas` is a **Node.js CLI + MCP server** that forms the **Evidence Plane** of the EVA architecture.

It operates in two modes:

1. **CLI mode**: `eva <command> --repo <path>` -- direct filesystem invocation
2. **MCP server mode**: `eva mcp-serve` -- HTTP server, invoked by agents via MCP protocol

---

## The EVA Evidence Plane

```text
  +-----------------------+      declared state
  |  37-data-model        |  <-- endpoints, screens, services, containers
  |  (port 8010)          |      stored in Cosmos
  +-----------+-----------+
              |  POST /model/admin/audit-repo
              v
  +-----------------------+      verified state
  |  eva-veritas          |  <-- runs discover + reconcile
  |  MCP server (EO-07)   |      computes MTI score
  |  hosted in 29-foundry |      returns gaps[]
  +-----------+-----------+
              |  gap stories
              v
  +-----------------------+      sprint seeding
  |  38-ado-poc           |  <-- receives generate_ado_items
  |  ADO Command Center   |      creates verified PBIs only
  +-----------+-----------+
              |  MTI score
              v
  +-----------------------+      deployment gate
  |  40-control-plane     |  <-- MTI < 70 = block deploy
  |  (port 8020)          |      MTI >= 90 = auto-approve
  +-----------------------+
```

---

## Discovery Model

### Top-Down (Planned Reality)

| Source | Extracted |
|--------|-----------|
| README.md | Epic title, objective |
| PLAN.md | Features (h2) + Stories (h3) with `[ID=X]` tags |
| ACCEPTANCE.md | Checklist criteria per story |
| STATUS.md | Declared progress per feature/story |
| project.yaml | Structured project metadata (optional) |

### Bottom-Up (Actual Reality)

| Source | Extracted |
|--------|-----------|
| All source files | Artifact type classification |
| File headers | `EVA-STORY: <ID>` tags |
| evidence/ folder | Evidence artifacts |
| tests/ folder | Test artifacts |

---

## Pipeline

```
                          eva discover
                         /            \
              parse-docs.js        scan-repo.js
                 |                      |
           planned model           actual artifacts
                 |                      |
                 +----map-artifacts.js--+
                              |
                       discovery.json
                              |
                          eva reconcile
                              |
                       reconciliation.json
                              |
                        eva compute-trust
                              |
                          trust.json
                              |
                    eva generate-ado / report
                              |
                    ado.csv / console report
```

---

## Module Map

```
src/
  cli.js              <- Commander program + command routing       [Phase 1 DONE]
  discover.js         <- Orchestrates top-down + bottom-up         [Phase 1 DONE]
  reconcile.js        <- Planned vs actual comparison              [Phase 1 DONE]
  generate-ado.js     <- ADO CSV generation                        [Phase 1 DONE]
  compute-trust.js    <- MTI score computation                     [Phase 1 DONE]
  report.js           <- Console report                            [Phase 1 DONE]
  mcp-server.js       <- MCP HTTP server (EO-07)                   [Phase 2 TODO]
  lib/
    fs-utils.js       <- ensureDir, readJson, writeJson, rel       [Phase 1 DONE]
    md-utils.js       <- extractHeadings, extractChecklist, tags   [Phase 1 DONE]
    parse-docs.js     <- parseEpicFromReadme, parsePlan, ...       [Phase 1 DONE]
    scan-repo.js      <- scanRepo, classify (via fast-glob)        [Phase 1 DONE]
    map-artifacts.js  <- mapArtifactsToStories                     [Phase 1 DONE]
    trust.js          <- computeTrustScore, trustToActions         [Phase 1 DONE]
    ado-csv.js        <- toCsvRows, rowsToCsv                      [Phase 1 DONE]
```

---

## Output Schemas

### discovery.json

```json
{
  "meta": { "schema": "eva.discovery.v1", "generated_at": "", "repo": "" },
  "project": {},
  "planned": {
    "epic": {},
    "features": [],
    "stories": [],
    "acceptance": [],
    "declared_status": {}
  },
  "actual": {
    "artifacts": [],
    "story_artifact_map": {}
  }
}
```

### reconciliation.json

```json
{
  "meta": { "schema": "eva.reconciliation.v1", "generated_at": "", "repo": "" },
  "coverage": {
    "stories_total": 0,
    "stories_with_artifacts": 0,
    "stories_with_evidence": 0,
    "consistency_score": 1.0
  },
  "gaps": [
    { "type": "missing_implementation|missing_evidence|orphan_story_tag", "story_id": "", "title": "" }
  ]
}
```

### trust.json

```json
{
  "meta": { "schema": "eva.trust.v1", "generated_at": "", "repo": "" },
  "score": 0,
  "components": { "coverage": 0, "evidenceCompleteness": 0, "consistencyScore": 0 },
  "actions": []
}
```

---

## PLAN.md Convention

```markdown
## Feature: Discovery Engine [ID=EO-01]
### Story: Parse governance docs [ID=EO-01-001]
```

## ACCEPTANCE.md Convention

```markdown
## Story: Parse governance docs [ID=EO-01-001]
- [ ] README.md h1 is extracted as epic title
- [x] PLAN.md features are parsed
```

## STATUS.md Convention

```text
FEATURE EO-01: 60%
STORY EO-01-001: Done
```

## File Tagging Convention

```js
// EVA-STORY: EO-01-001
// EVA-FEATURE: EO-01
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| commander | ^12.1.0 | CLI framework |
| fast-glob | ^3.3.2 | File system scanning |
| js-yaml | ^4.1.0 | project.yaml parsing |

---

## EVA Integration Points

| System | Integration | Phase |
|--------|-------------|-------|
| 29-foundry | Hosts MCP server in `mcp-servers/eva-veritas/`; agents call tools | 2 |
| 37-data-model | `POST /model/admin/audit-repo` proxies to MCP `audit_repo` tool | 2 |
| 38-ado-poc | Consumes `generate_ado_items` to seed sprints with gap stories | 2 |
| 40-eva-control-plane | `get_trust_score` result is a deployment gate (MTI < 70 = block) | 2 |

---

## MCP Tool Contracts (Phase 2)

### audit_repo
```json
{ "input": { "repo_path": "string" },
  "output": { "gaps": [], "coverage": {}, "trust_score": 0, "actions": [] } }
```

### get_trust_score
```json
{ "input": { "repo_path": "string" },
  "output": { "score": 0, "components": {}, "actions": [] } }
```

### scan_portfolio
```json
{ "input": { "portfolio_root": "string", "project_filter": [] },
  "output": { "projects": [{ "id": "", "name": "", "trust_score": 0, "gap_count": 0 }], "portfolio_mti": 0 } }
```

### generate_ado_items
```json
{ "input": { "repo_path": "string", "include_gaps": true },
  "output": [{ "work_item_type": "", "title": "", "parent": "", "tags": "" }] }
```
