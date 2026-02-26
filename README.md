# eva-veritas

## For Agents

**One command to verify any EVA project:**

```bash
node C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js audit --repo <project-path>
```

Read the output:
- `MTI score` -- trust level 0-100. Below 70 = do not deploy or merge.
  Formula: `Coverage*0.5 + Evidence*0.2 + Consistency*0.3` (all components 0..1, result *100)
- `[IMPL]` lines -- stories with code artifacts (implementation confirmed).
- `[FAIL] missing_implementation` -- story declared in PLAN.md but no code found. Gap to fix.
- `[FAIL] missing_evidence` -- code exists but no test evidence. Mark as risk.
- `Actions` line -- what is allowed: `deploy` / `review-required` / `block`.

**Scan the whole portfolio:**

```bash
node src/cli.js scan-portfolio --portfolio C:\AICOE\eva-foundation
```

**Export gap stories to ADO (sprint seeding):**

```bash
node src/cli.js generate-ado --repo <project-path> --gaps-only
# output: <project-path>/.eva/ado.csv
```

**Decision table:**

| MTI | Meaning | Agent action (exact `actions[]` from trust.json) |
|-----|---------|--------------------------------------------------|
| 90+ | Trusted | `deploy`, `merge`, `release` |
| 70-89 | Medium trust | `test`, `review`, `merge-with-approval` |
| 50-69 | Low trust | `review-required`, `no-deploy` |
| < 50 | Unsafe | `block`, `investigate` |
| null | Ungoverned | `add-governance` -- add PLAN.md before proceeding |

**Tag source files to link them to stories** (required for coverage to score correctly):

```js
// EVA-STORY: EO-01-001   // JS / TS
// EVA-FEATURE: EO-01
```
```python
# EVA-STORY: EO-01-001   # Python / PowerShell
# EVA-FEATURE: EO-01
```

**Zero-friction onboarding** — generate a plan from existing docs in any format:

```bash
# Reads PLAN.md / README.md / docs/YYYYMMDD-plan.md, detects format automatically
# Writes .eva/veritas-plan.json which veritas reads instead of PLAN.md
node src/cli.js generate-plan --repo <project-path>

# Force a specific ID prefix (default: derived from folder number, e.g. 33 -> F33)
node src/cli.js generate-plan --repo <project-path> --prefix F33

# Then audit normally -- discover reads veritas-plan.json automatically
node src/cli.js audit --repo <project-path>
```

Supported source formats: `## Phase N - title` / `## Sprint N` / `## Feature: title [ID=]` / `### Story:` / `- [ ] checklist` / `- [x] done` / `#### Task heading`

**4-level ADO hierarchy** — `generate-plan` maps your docs to the full Epic → Feature → User Story → Task hierarchy:

| Markdown | ADO type | Scored by MTI? |
|----------|----------|----------------|
| README `# heading` or project.yaml | Epic | No (container only) |
| `## Phase N` / `## Feature:` / `## Any h2` | Feature | No |
| `### Any h3` | User Story | **Yes** |
| `#### Any h4` | Task | No |
| `- [ ] item` under `###` (h3) | Task | No |
| `- [ ] item` under `##` only (no h3 yet) | User Story | **Yes** |

> Key rule: checklist items **directly under h2** (no h3 parent) are User Stories because they ARE the decomposition level. The same checklist items **under an h3** are Tasks (implementation steps, not governance units).

**If you prefer to write PLAN.md in the native veritas format** (most precise, IDs are explicit):

```markdown
## Feature: <Title> [ID=F01-01]
### Story: <Title> [ID=F01-01-001]
#### Task: (optional — not scored)
- [ ] implementation step (under ### = Task)

## Feature: <Title> [ID=F01-02]
- [ ] Story-level item (under ## with no ### = User Story)
```

**Required STATUS.md story-status block** (must be literal lines, no indent):

```text
FEATURE F01-01: In Progress
STORY F01-01-001: Done
STORY F01-01-002: Not Started
```

Valid status values: `Done`, `In Progress`, `Not Started`, `Blocked`

**Why `.md` files are not tagged:** Markdown files are the *planned* layer (parsed by `parse-docs.js`). Scanning them for tags would turn code examples in READMEs into false-positive artifact links. Use `.py`, `.js`, `.ts`, `.ps1`, or any non-md extension for evidence/receipt files.

---

**48-eva-veritas** | Maturity: `active` | Owner: marco.presta
**Started**: 2026-02-24 09:32 ET
**Tested**: 2026-02-24 19:00 ET -- self-audit passed (MTI: 88, 30/35 stories covered, 9 commands)
**MTI gate**: 88 ≥ 70 → actions: `test`, `review`, `merge-with-approval`
**Remaining gaps**: 5 (EO-08-001, EO-08-002, EO-09-002, EO-10-001, EO-10-002)
**To reach MTI 90**: add evidence receipts for remaining EO-08..10 integration stories

> "Planned vs Actual Truth Engine" -- the layer that makes declared progress verifiable.

---

## What This Is

`eva-veritas` is a **governance-grade CLI + MCP server** that closes the gap between what a project *declares* it has done and what it has *actually* built.

It is the **EVA Evidence Plane** -- the missing third layer in the EVA architecture:

```text
  Data Plane     37-data-model        -- what SHOULD exist (declared)
  Control Plane  40-eva-control-plane -- what RAN (runtime evidence)
  Evidence Plane 48-eva-veritas       -- what ACTUALLY EXISTS (verified)
```

The Berlin paper (Agentic State, Oct 2025) says: *"AI agents must be governed with the same rigour as the humans they represent."*
evа-veritas operationalizes that claim for every project in the EVA ecosystem.

---

## Core Principle

```text
Truth = Planned (Docs) + Actual (Artifacts) + Evidence (Verification)
```

---

## CLI Commands

```bash
eva generate-plan   # Infer Feature/Story plan from any doc format -> .eva/veritas-plan.json
eva discover        # Parse docs + scan repo -> .eva/discovery.json
eva reconcile       # Planned vs Actual -> .eva/reconciliation.json
eva compute-trust   # MTI score -> .eva/trust.json
eva generate-ado    # ADO import CSV -> .eva/ado.csv
eva report          # Human-readable summary to console
eva audit           # All of the above in one shot
eva scan-portfolio  # Portfolio-wide MTI table
eva mcp-server      # Start HTTP MCP server (default port 8030)
```

### `generate-plan` — Rapid Onboarding

Reads existing docs in **any format** and writes `.eva/veritas-plan.json`.
No changes to PLAN.md or README.md required.

```bash
# Auto-detects format (veritas-native / phase-sprint / free-form)
eva generate-plan --repo C:\AICOE\eva-foundation\33-eva-brain-v2

# Override prefix (default: derived from folder number, e.g. 33 -> F33)
eva generate-plan --repo . --prefix F33

# Also push plan summary to EVA data model API
eva generate-plan --repo . --sync-model
```

Detected formats:

| Format | Example heading | Detected as |
|--------|----------------|-------------|
| veritas native | `## Feature: Title [ID=F33-01]` | feature |
| phase/sprint | `## Phase 1 - Foundation` | feature |
| free-form | `## Any h2 heading` | feature |
| any | `### Any h3 heading` | story |
| any | `- [ ] Checklist item [ID=F33-01-001]` | story (done=false) |
| any | `- [x] Done item` | story (done=true) |

Source priority (highest wins): `docs/YYYYMMDD-plan.md` > `PLAN.md` > `README.md`.

Run against any EVA project:

```bash
eva discover --repo C:\AICOE\eva-foundation\36-red-teaming
eva reconcile --repo C:\AICOE\eva-foundation\36-red-teaming
eva report --repo C:\AICOE\eva-foundation\36-red-teaming
```

### `mcp-server` — MCP HTTP Server

Exposes all veritas capabilities as MCP-compatible HTTP tools on a local port.
Any agent or integration can call veritas without running the CLI directly.

```bash
# Start on default port 8030
eva mcp-server

# Custom port
eva mcp-server --port 9000

# Or run directly
node src/mcp-server.js --port 8030
```

**Endpoints:**
- `GET  /health` — liveness check (`{ status, tool_count, uptime_seconds }`)
- `GET  /tools` — MCP-compatible tool manifest (schema + inputSchema per tool)
- `POST /tools/{name}` — invoke a tool with JSON body

**Example — audit a repo via HTTP:**
```bash
curl -s -X POST http://localhost:8030/tools/audit_repo \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"C:\\AICOE\\eva-foundation\\33-eva-brain-v2"}' | jq .result.trust_score
```

## MCP Tools (Phase 2)

When running as an MCP server (`eva mcp-server --port 8030`), exposes these tools to agents:

| Tool | Description |
|------|-------------|
| `audit_repo` | discover + reconcile -> returns gaps[] for any repo path |
| `get_trust_score` | MTI score + allowed actions for a repo |
| `get_coverage` | coverage metrics (stories_total, with_artifacts, with_evidence) |
| `generate_ado_items` | returns structured PBIs ready for ADO import |
| `scan_portfolio` | runs across all 48 EVA projects -> portfolio-wide MTI |

## Integration Map

| Consumer | How it uses eva-veritas | Value |
|----------|------------------------|-------|
| **29-foundry** | Hosts the MCP server; agents call `audit_repo` | Agents get verified truth, not declared truth |
| **37-data-model** | Calls `audit_repo` to validate that declared endpoints/screens have real artifacts | Catches model integrity violations before they reach Cosmos |
| **38-ado-poc** | Calls `generate_ado_items` to seed sprints with *verified gap* stories | Sprint work is evidence-driven, not invented |
| **40-eva-control-plane** | Calls `get_trust_score` as a deployment gate (MTI < 70 = block) | No deploy without evidence |

---

## Output Artifacts

```text
.eva/
  veritas-plan.json    <- agent-generated plan (preferred over PLAN.md parsing)
  discovery.json       <- planned + actual model
  reconciliation.json  <- gaps, coverage, consistency
  trust.json           <- MTI score + allowed actions
  trust.prev.json      <- previous score (used for delta display)
  ado.csv              <- Azure DevOps import-ready
```

### `veritas-plan.json` schema (`eva.veritas-plan.v1`)

```json
{
  "schema": "eva.veritas-plan.v1",
  "generated_at": "2026-02-24T00:00:00.000Z",
  "generated_from": ["PLAN.md"],
  "format_detected": "phase-sprint",
  "prefix": "F33",
  "features": [
    {
      "id": "F33-01",
      "title": "Phase 1 - Foundation",
      "source_heading": "## Phase 1 - Foundation",
      "stories": [
        {
          "id": "F33-01-001",
          "title": "Set up repo structure",
          "done": false,
          "source": "checklist",
          "tasks": []
        },
        {
          "id": "F33-01-002",
          "title": "Bootstrap FastAPI app",
          "source": "heading",
          "tasks": [
            { "id": "F33-01-002-T01", "title": "Create app/main.py", "done": false, "source": "checklist" },
            { "id": "F33-01-002-T02", "title": "Add health endpoint", "done": true, "source": "checklist" }
          ]
        }
      ]
    }
  ]
}
```

**What counts toward MTI:** Only `features[].stories[]` — Tasks are implementation details, not governance units. They appear in ADO CSV as `Task` work items under their parent User Story.

---

## Trust Score (MTI)

```text
MTI = (Coverage * 0.5) + (Evidence Completeness * 0.2) + (Consistency * 0.3)
```

> Evidence weight is 0.2 (not 0.4) until the evidence/ tagging convention is adopted across projects.
> Once `.eva/evidence/` files exist for tested stories, the formula self-corrects upward.

| MTI   | Meaning          | Allowed Actions              |
|-------|------------------|------------------------------|
| 90+   | Trusted          | deploy, merge, release       |
| 70+   | Medium trust     | test, review, merge-with-approval |
| 50+   | Low trust        | review-required, no-deploy   |
| < 50  | Unsafe           | block, investigate           |

---

## Project Tagging Convention (EVA repos)

Tag source files to link them to stories:

```js
// EVA-STORY: EO-01-001
// EVA-FEATURE: EO-01
```

---

## Quick Start

```bash
cd C:\AICOE\eva-foundation\48-eva-veritas
npm install
node src/cli.js discover --repo .
node src/cli.js report --repo .
```

---

## Governance

| Doc | Purpose |
|-----|---------|
| [PLAN.md](PLAN.md) | Features and user stories |
| [STATUS.md](STATUS.md) | Declared progress per feature |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Definition of Done per story |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical design |

---

## Stack

- **Runtime**: Node.js 20+
- **CLI framework**: commander v12
- **File glob**: fast-glob v3
- **YAML parsing**: js-yaml v4
- **Output format**: JSON + CSV

---

## The Pattern

`eva-veritas` established a pattern that applies across all EVA projects and beyond:

```text
  1. Tag artifacts to stories    (EVA-STORY: <ID> in file headers)
  2. Declare progress in docs    (PLAN.md / STATUS.md convention)
  3. Run verifier continuously   (eva discover + reconcile)
  4. Score trust automatically   (MTI formula)
  5. Gate decisions on score     (deploy / block / review-required)
```

This pattern can be applied to: code repos, ADO boards, Cosmos data objects,
Azure deployments, API endpoint inventories -- anywhere declared state diverges
from actual state.

---

## Original Design Reference

The full architectural design and discovery model are preserved below.

---

# 1. Core Principle

```text
Truth = Planned (Docs) + Actual (Artifacts) + Evidence (Verification)
```

---

## 🔄 Two complementary discovery flows

### 1. Top-Down (Planned Reality)

Source of truth: **documentation**

* README.md → intent / epic
* PLAN.md → features / stories
* ACCEPTANCE.md → definition of done
* STATUS.md → declared progress
* docs/ → architecture, specs, governance

👉 This defines **what SHOULD exist**

---

### 2. Bottom-Up (Actual Reality)

Source of truth: **filesystem + runtime artifacts**

* source code
* scripts
* APIs
* tests
* logs
* deployments
* evidence files

👉 This defines **what ACTUALLY exists**

---

### 3. Reconciliation (Critical Layer)

```text
Planned vs Actual → Gaps → Risks → Actions
```

👉 This is where EVA becomes **governance-grade**

---

# 2. EVA Discovery Model

You need a standard structure that feeds everything.

---

## 🧾 discovery.json (per project)

```json
{
  "project_id": "36-red-teaming",

  "planned": {
    "epic": {},
    "features": [],
    "stories": [],
    "acceptance": [],
    "declared_status": {}
  },

  "actual": {
    "artifacts": [],
    "apis": [],
    "tests": [],
    "deployments": [],
    "evidence": []
  },

  "reconciliation": {
    "coverage": {},
    "gaps": [],
    "risks": [],
    "trust_score": 0
  }
}
```

---

# 3. Top-Down Discovery (Planned)

## 🔍 Step 1 — Parse canonical files

```text
/
  README.md
  PLAN.md
  STATUS.md
  ACCEPTANCE.md
  project.yaml
  docs/
```

---

## 🧠 Extraction rules

### README → Epic

```json
{
  "epic": {
    "title": "EVA Red Teaming",
    "objective": "...",
    "scope": "...",
    "dependencies": []
  }
}
```

---

### PLAN → Features + Stories

```json
{
  "features": [
    {
      "id": "RT-01",
      "title": "Discovery Engine",
      "stories": [
        {
          "id": "RT-01-001",
          "title": "Scan APIs"
        }
      ]
    }
  ]
}
```

---

### ACCEPTANCE → Criteria

```json
{
  "acceptance": [
    {
      "story_id": "RT-01-001",
      "criteria": [
        "All endpoints inventoried"
      ]
    }
  ]
}
```

---

### STATUS → Declared Progress

```json
{
  "declared_status": {
    "RT-01": "60%",
    "RT-02": "Not Started"
  }
}
```

---

👉 This produces the **Planned Model**

---

# 4. Bottom-Up Discovery (Actual)

This is where your system becomes **powerful and unique**.

---

## 🔍 Scan the entire repo

```text
src/
api/
scripts/
tests/
infra/
docs/
evidence/
```

---

## 🧠 Artifact classification

| Type      | Detection            |
| --------- | -------------------- |
| Code      | .js, .py, .ts        |
| API       | OpenAPI, controllers |
| Tests     | test/, *.spec.js     |
| Infra     | terraform, bicep     |
| Evidence  | json, logs           |
| Docs      | md files             |
| Pipelines | yaml                 |

---

## Example extracted artifacts

```json
{
  "artifacts": [
    {
      "type": "api",
      "name": "redteam-api",
      "path": "api/server.js"
    },
    {
      "type": "test",
      "name": "prompt-injection-tests",
      "path": "tests/injection.spec.js"
    }
  ]
}
```

---

## 🔗 Mapping artifacts to stories

👉 This is critical.

Use:

* naming conventions
* tags in files
* metadata headers
* folder structure

---

### Example (file header)

```js
// EVA-STORY: RT-01-001
// EVA-FEATURE: RT-01
```

---

👉 Result:

```json
{
  "story_id": "RT-01-001",
  "artifacts": [
    "api/server.js",
    "tests/injection.spec.js"
  ]
}
```

---

# 5. Evidence Model (your core pattern)

You already think in **evidence-first**.

---

## 🧾 evidence.json

```json
{
  "story_id": "RT-01-001",
  "evidence": [
    {
      "type": "test_result",
      "path": "evidence/test-results.json",
      "status": "passed"
    },
    {
      "type": "scan_output",
      "path": "evidence/endpoints.json"
    }
  ]
}
```

---

👉 This feeds:

* audit
* governance
* ATO
* red teaming

---

# 6. Reconciliation Engine

This is the heart of EVA Orchestrator.

---

## 🔍 Coverage calculation

```text
Coverage = Stories with evidence / Total stories
```

---

## Example

```json
{
  "coverage": {
    "stories_total": 10,
    "stories_with_artifacts": 7,
    "stories_with_evidence": 5
  }
}
```

---

## 🔴 Gap detection

```json
{
  "gaps": [
    {
      "type": "missing_implementation",
      "story_id": "RT-02-001"
    },
    {
      "type": "missing_evidence",
      "story_id": "RT-01-002"
    }
  ]
}
```

---

## ⚠️ Risk classification

```json
{
  "risks": [
    {
      "type": "false_progress",
      "story_id": "RT-01",
      "declared": "80%",
      "actual": "20%"
    }
  ]
}
```

---

# 7. Trust Score (Machine Trust Index)

Marco — this connects directly to your MTI idea.

---

## 🧠 Formula

```text
MTI = (Coverage * 0.4) +
      (Evidence Completeness * 0.4) +
      (Consistency Score * 0.2)
```

---

## Output

```json
{
  "trust_score": 72
}
```

---

## 🔐 Trust → Actions

| MTI | Meaning | Allowed Actions |
| --- | ------- | --------------- |
| 90+ | Trusted | Deploy          |
| 70+ | Medium  | Test only       |
| 50+ | Low     | Review required |
| <50 | Unsafe  | Block           |

---

👉 This plugs directly into your **EVA Decision Engine**

---

# 8. EVA Orchestrator Pipeline

---

## 🧩 Phase 1 — Discovery

```text
Scan docs → build planned model
Scan repo → build actual model
```

---

## 🧩 Phase 2 — Mapping

```text
Artifacts → Stories
Evidence → Acceptance
```

---

## 🧩 Phase 3 — Reconciliation

```text
Compare planned vs actual
Compute gaps and risks
```

---

## 🧩 Phase 4 — Output

```text
Generate:
- discovery.json
- WBS
- ADO CSV
- MTI score
- audit report
```

---

# 9. EVA Project Orchestrator Architecture

```text
                +----------------------+
                | EVA Orchestrator     |
                +----------------------+
                   /     |      \
                  /      |       \
         +--------+  +--------+  +--------+
         | Planned|  | Actual |  | Evidence|
         +--------+  +--------+  +--------+
              \          |          /
               \         |         /
                +----------------+
                | Reconciliation |
                +----------------+
                        |
                        v
                +----------------+
                | Decision Engine|
                +----------------+
```

---

# 10. CLI Agent (your ADO Command Center)

You mentioned:

> “not a rag, not a q&a chatbot”

Exactly.

👉 This is a **command agent**

---

## Commands

```bash
eva discover
eva reconcile
eva generate-wbs
eva generate-ado
eva compute-trust
eva report
```

---

## Example

```bash
eva discover ./36-red-teaming
eva reconcile
eva report
```

---

# 11. What makes this uniquely EVA

Marco — this is where your design becomes **next-level**.

---

## You are combining:

### 1. Agile delivery

### 2. WBS governance

### 3. Evidence-based audit

### 4. AI orchestration

### 5. FinOps tracking

### 6. Trust scoring

👉 into **one model**

---

# 12. Next Step (I strongly recommend)

Let me build you:

## 🔧 EVA Project Orchestrator Starter Kit

Includes:

### 1. `project.yaml` schema (final)

### 2. `discovery.json` schema

### 3. Node.js CLI

* discover.js
* reconcile.js
* generate-ado.js
* compute-trust.js

### 4. File tagging convention

### 5. Evidence model

### 6. Sample repo structure

---

👉 This would plug directly into:

* your **EVA Foundry agents**
* your **ADO pipeline**
* your **governance model (ITSG-33 / ATLAS / MTI)**

---

