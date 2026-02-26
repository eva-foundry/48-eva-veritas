# swarm-roster.md -- eva-veritas Agent Swarm Operating Manual

**Version**: 1.0.0
**Date**: 2026-02-24
**Applies to**: All batches B1-B6 (4-week build horizon)
**Reference plan**: `docs/path-to-market.md`

Five agents run in parallel from Day 1. Each agent owns exactly its files.
No agent touches another agent's files without posting a Handoff Contract first.

---

## Agent Roster

| ID | Name | Feature Groups | Primary language | First deliverable |
|---|---|---|---|---|
| A1 | Scoring Engine | A (VP-A1 through VP-A6) | JavaScript | B1: floor fix (Day 1) |
| A2 | DevOps & DX | E + F (VP-E1 through VP-F5) | YAML + JavaScript | B1: pre-commit + npm (Day 1) |
| A3 | Evidence Layer | B (VP-B1 through VP-B4) | JavaScript | B3: evidence.js (Day 4) |
| A4 | Intelligence | C + D (VP-C1 through VP-D5) | JavaScript | B4: code-parser (Week 2) |
| A5 | QA | Tests + self-audit | JavaScript | B1: trust.test.js (Day 1) |

---

## A1 -- Scoring Engine

**Mission**: Keep MTI honest. Every number the user sees comes out of A1 code.
Owns the full compute chain: reconcile -> trust -> report.

### Owned files (A1 may read AND write)

```
src/reconcile.js
src/compute-trust.js
src/lib/trust.js
src/report.js
```

### Files A1 creates

```
src/lib/badge.js          (VP-E4, co-owned with A2 -- see Coordination)
.eva/trust-history.json   (runtime artifact, not source -- no conflict)
```

### Forbidden zones for A1

| File | Owner | Why off-limits |
|---|---|---|
| `src/discover.js` | A3 | Evidence wiring lives here |
| `src/audit.js` | A2 | Exit codes, threshold flag |
| `src/cli.js` | ALL | See Shared File Protocol below |
| `src/lib/evidence.js` | A3 | A3 creates, A1 reads via interface only |
| `src/lib/code-parser.js` | A4 | Different domain |
| `src/model-audit.js` | A4 | Different domain |
| `tests/**` | A5 | A5 owns all tests |

### A1 Batch Deliverables

| Batch | Features | Exact change |
|---|---|---|
| B1 | VP-A1 | `reconcile.js` line 68: `? 1 :` -> `? 0 :` |
| B1 | VP-A2 | `trust.js`: `score: null` -> `score: 0, ungoverned: true` for 0 stories |
| B2 | VP-A4 | `reconcile.js`: new `features[]` array in output JSON |
| B2 | VP-A5 | `report.js`: promote feature table from printImprovementHints() to main body |
| B2 | VP-A6 | `compute-trust.js` + `report.js`: trust-history.json ring buffer, ASCII sparkline |
| B2 | VP-E4 | `src/lib/badge.js` (new): SVG + Shields.io JSON generation |
| B3 | VP-A3 | `reconcile.js`: expand evidence count to union of 4 sources (reads A3 output) |

### A1 Interface contract (what A1 reads from other agents)

A1 reads these fields but does NOT write them:
- `discovery.json` -> `.actual.artifacts[]` (written by A3 via discover.js)
- `discovery.json` -> `.actual.commit_evidence_map` (written by A3 via evidence.js in B3)

A1 must not hardcode paths. Always read from `opts.repo + "/.eva/discovery.json"`.

---

## A2 -- DevOps & Developer Experience

**Mission**: Make veritas impossible to skip. CI gate, pre-commit hook, npm publish,
badge, init wizard, watch mode. Everything that puts veritas in the critical path.

### Owned files (A2 may read AND write)

```
src/audit.js
src/init.js               (new, B4)
src/watch.js              (new, B6)
src/lib/config.js         (new, B4)
src/lib/html-report.js    (new, B6)
package.json
.github/workflows/veritas-gate.yml    (new, B2)
.pre-commit-hooks.yaml                (new, B1)
```

### Files A2 creates

```
src/init.js
src/watch.js
src/lib/config.js
src/lib/html-report.js
.github/workflows/veritas-gate.yml
.pre-commit-hooks.yaml
```

### Forbidden zones for A2

| File | Owner | Why off-limits |
|---|---|---|
| `src/reconcile.js` | A1 | Scoring logic only |
| `src/lib/trust.js` | A1 | Formula only |
| `src/report.js` | A1 | Console output only |
| `src/discover.js` | A3 | Evidence pipeline |
| `src/lib/evidence.js` | A3 | A3's new file |
| `src/model-audit.js` | A4 | Data model command |
| `src/generate-plan.js` | A4 | Plan intelligence |
| `tests/**` | A5 | QA only |
| `src/cli.js` | ALL | See Shared File Protocol |

### A2 Batch Deliverables

| Batch | Features | Exact change |
|---|---|---|
| B1 | VP-E2 | `.pre-commit-hooks.yaml` (new): 8-line pre-commit integration |
| B1 | VP-E3 | `audit.js`: confirm process.exit(1), add `--threshold <n>` (default 70), `--warn-only` |
| B1 | VP-F1 | `package.json`: remove `"private": true`, add `files[]`, `engines`, `keywords`, `repository`, bump to 0.2.0 |
| B1 | VP-F2 | GitHub topics (manual, 5 min, no file change): requirements-traceability, traceability, requirements-management, specification-coverage, audit, governance, mcp, azure-devops, cli |
| B2 | VP-E1 | `.github/workflows/veritas-gate.yml` (new): push+PR trigger, node 20, npm ci, `eva audit --threshold 70`, upload .eva/ artifact |
| B2 | VP-E4 | Wire `src/lib/badge.js` (A1 creates) into `audit.js` post-audit call |
| B4 | VP-F3 | `src/init.js` (new): interactive wizard, 5-step onboarding |
| B4 | VP-F5 | `src/lib/config.js` (new): `.evarc.json` reader with defaults |
| B4 | Wire config | `audit.js`: read threshold from `.evarc` when `--threshold` not set |
| B6 | VP-F4 | `src/watch.js` (new): fs.watch loop, re-run audit on change |
| B6 | VP-G1 | `src/lib/html-report.js` (new): self-contained HTML, inline CSS |
| B6 | VP-G2 | Wire `--format json` into `audit.js` output |
| B6 | VP-G3 | Trend chart in `html-report.js` (Chart.js CDN, fallback to ASCII for offline) |

### A2 Interface contract

A2's `audit.js` calls into A1's report and A4's model-audit as optional enrichment steps.
Call pattern: if `modelFidelityJson` exists at `.eva/model-fidelity.json`, include in audit summary.
A2 does NOT import A4 modules directly. Read the JSON artifact, never the module.

---

## A3 -- Evidence Layer

**Mission**: Make the Evidence component of MTI non-zero without developer effort.
Mine commits, PR titles, and test filenames. Developers benefit from veritas passively.

### Owned files (A3 may read AND write)

```
src/discover.js
src/lib/scan-repo.js
src/lib/evidence.js       (new, B3)
src/generate-ado.js
```

### Files A3 creates

```
src/lib/evidence.js
```

### Forbidden zones for A3

| File | Owner | Why off-limits |
|---|---|---|
| `src/reconcile.js` | A1 | Scoring only |
| `src/lib/trust.js` | A1 | Formula only |
| `src/report.js` | A1 | Console output |
| `src/audit.js` | A2 | DevOps |
| `src/generate-plan.js` | A4 | A4 owns plan enrichment |
| `src/lib/code-parser.js` | A4 | A4 creates |
| `src/model-audit.js` | A4 | A4 owns |
| `tests/**` | A5 | QA only |
| `src/cli.js` | ALL | See Shared File Protocol |

### A3 Batch Deliverables

| Batch | Features | Exact change |
|---|---|---|
| B3 | VP-B1 | `scan-repo.js`: add filename-pattern implicit evidence (story ID in filename = evidence without tag), `"is_test": true` boolean on test artifacts |
| B3 | VP-B2 | `evidence.js` (new): `mineCommits(repoPath, knownStoryIds)` -- git log parsing, returns `{[storyId]: [{sha, snippet, source: "commit"}]}` |
| B3 | VP-B3 | `evidence.js` (append): `minePRs(repoPath, knownStoryIds)` -- GitHub API, gated on GITHUB_TOKEN, source: "pr" |
| B3 | Wire | `discover.js`: after scanRepo, call evidence.js, merge into `actual.commit_evidence_map` |
| B4 | VP-B4 | `generate-ado.js`: new "Evidence Sources" column from `commit_evidence_map` |

### A3 Interface contract (output shape, read by A1 in B3)

`discovery.json` additions A3 is responsible for:
```json
{
  "actual": {
    "artifacts": [
      {
        "path": "tests/test_EO-05-001_chat.py",
        "type": "test",
        "is_test": true,
        "story_tags": ["EO-05-001"],
        "implicit_evidence_for": ["EO-05-001"]
      }
    ],
    "commit_evidence_map": {
      "EO-05-001": [
        { "sha": "a3b2c1d", "snippet": "fix EO-05-001 threshold calc", "source": "commit" }
      ]
    }
  }
}
```

A1 reads `commit_evidence_map` in reconcile.js to compute `stories_with_evidence`.
A1 must treat the field as optional: `evidence_map = discovery.actual.commit_evidence_map || {}`.

---

## A4 -- Intelligence

**Mission**: Ensure every EVA project has a meaningful plan even before developers
tag anything. Code structure + OpenAPI + ADO + data model cross-reference.

### Owned files (A4 may read AND write)

```
src/generate-plan.js
src/model-audit.js            (new, B5)
src/lib/code-parser.js        (new, B4)
src/lib/openapi-parser.js     (new, B4)
src/scan-portfolio.js
```

### Files A4 creates

```
src/model-audit.js
src/lib/code-parser.js
src/lib/openapi-parser.js
```

### Forbidden zones for A4

| File | Owner | Why off-limits |
|---|---|---|
| `src/reconcile.js` | A1 | Scoring only |
| `src/lib/trust.js` | A1 | Formula only |
| `src/report.js` | A1 | Console output |
| `src/audit.js` | A2 | DevOps |
| `src/discover.js` | A3 | Evidence pipeline |
| `src/lib/evidence.js` | A3 | A3 owns |
| `src/lib/scan-repo.js` | A3 | A3 owns |
| `tests/**` | A5 | QA only |
| `src/cli.js` | ALL | See Shared File Protocol |

### A4 Batch Deliverables

| Batch | Features | Exact change |
|---|---|---|
| B4 | VP-C1 | `code-parser.js` (new): FastAPI, Flask, Express, Next.js routes, React Router, Terraform, Shell extraction -- returns `{stories[], source: "code-structure"}` |
| B4 | VP-C1 | `generate-plan.js`: call code-parser when stories < 20 AND artifacts > 100, merge CS- stories into plan |
| B4 | VP-C2 | `openapi-parser.js` (new): detect openapi.json/yaml, parse paths as stories, group by first segment |
| B4 | VP-C2 | `generate-plan.js`: add openapi-parser as priority-3 enrichment source |
| B4 | VP-C3 | `generate-plan.js`: `--ado-export <csv>` flag, parse ADO Epic/Feature/Story hierarchy |
| B4 | VP-C4 | `generate-plan.js`: `--issues` flag, GitHub API, label: "story" OR "feature" |
| B5 | VP-D1 | `model-audit.js` (new): 150 lines, queries port 8010, cross-references all entity types, writes `.eva/model-fidelity.json` |
| B5 | VP-D2 | `model-audit.js`: expose `getModelFidelityReport(repoPath)` -- A2 calls this from audit.js side-load |
| B5 | VP-D3 | `scan-portfolio.js`: `--model` flag, query `/model/projects/` for project list vs filesystem glob |
| B5 | VP-D4 | `generate-plan.js`: enhance `--sync-model`, PUT each feature+story as work_item to data model |
| B5 | VP-D5 | `model-audit.js`: after drift detection, GET `/model/impact/?container={id}` for affected entities |
| B5 | VP-MCP | `mcp-server.js`: expose `model_audit` as 6th MCP tool (SHARED FILE -- post Handoff Contract) |

### A4 Interface contract

`model-audit.js` MUST export a named function for A2 to call:
```javascript
// src/model-audit.js
async function runModelAudit(opts) { ... }   // CLI entry point
async function getModelFidelityReport(repoPath) { ... }  // A2 side-load

module.exports = { runModelAudit, getModelFidelityReport };
```

A2's `audit.js` calls `getModelFidelityReport` as an optional enrichment step.
If the data model API is unreachable, the function must return `null` (never throw).

---

## A5 -- QA

**Mission**: Prove every feature works. Own the test suite. Block any merge that
reduces MTI on veritas itself. Be the last line of defense.

### Owned files (A5 may read AND write)

```
tests/                      (entire directory -- A5 creates and controls it)
package.json                (SHARED -- only the "test" key; see Shared File Protocol)
```

### Files A5 creates (by batch)

```
tests/trust.test.js         (B1)
tests/reconcile.test.js     (B2)
tests/evidence.test.js      (B3)
tests/code-parser.test.js   (B4)
tests/model-audit.test.js   (B5)
tests/cli-regression.test.js (B6)
tests/fixtures/             (directory, all test repos and stubs)
tests/fixtures/empty-repo/
tests/fixtures/minimal-plan-repo/
tests/fixtures/tagged-repo/
tests/fixtures/openapi-repo/
tests/fixtures/mock-data-model-server.js
```

### Forbidden zones for A5

| File | Owner | Why off-limits |
|---|---|---|
| `src/reconcile.js` | A1 | A5 TESTS it, never writes it |
| `src/lib/trust.js` | A1 | Same |
| `src/lib/evidence.js` | A3 | Same |
| `src/lib/code-parser.js` | A4 | Same |
| `src/model-audit.js` | A4 | Same |
| `src/audit.js` | A2 | Same |
| `src/cli.js` | ALL | See Shared File Protocol |

### A5 Batch Deliverables

| Batch | Test file | Key assertions |
|---|---|---|
| B1 | `tests/trust.test.js` | empty -> MTI=0; 0-story plan -> score=0 not null; 50/0/0 -> MTI=25; 0 tags + no STATUS.md -> MTI=0 (was 30) |
| B2 | `tests/reconcile.test.js` | features[] exists in output; sparkline has >= 1 entry after 2 runs |
| B3 | `tests/evidence.test.js` | git fixture with tagged commit -> evidenceMap populated; no-git-repo -> no throw; test filename with story ID -> implicit evidence |
| B4 | `tests/code-parser.test.js` | FastAPI 3 routes -> 3 CS- stories; Terraform 5 azurerm_ -> 5 CS-INFRA; 200 artifacts + 5 stories -> enrichment triggers; 200 artifacts + 25 stories -> enrichment skips |
| B5 | `tests/model-audit.test.js` | (uses `tests/fixtures/mock-data-model-server.js`) screen with valid repo_path -> verified; missing file -> gap; endpoint implemented + no router ref -> drift; API unreachable -> null, no throw |
| B6 | `tests/cli-regression.test.js` | All 12 CLI commands run on minimal fixture without throw; `eva audit --repo .` on veritas self -> MTI >= 90; MTI never decreases run-over-run (ring buffer check) |

### A5 Package.json responsibility

A5 adds the test script. A2 owns the rest of package.json.
Coordination: A5 posts Handoff Contract to A2: "add test script."
A2 makes the edit. A5 confirms the script runs.

Test script to add:
```json
"scripts": {
  "test": "node --test tests/**/*.test.js"
}
```

### A5 Mock Data Model Server

`tests/fixtures/mock-data-model-server.js` -- no external deps, Node http module only.
Serves a fixed corpus from `tests/fixtures/mock-model.json`.
Model-audit tests start the mock before each test, kill after.

---

## Shared File Protocol

Three files are touched by multiple agents. No agent may write these without a
Handoff Contract posted as a comment block at the top of the file.

### `src/cli.js` -- ALL agents

cli.js wires new commands. Only one agent writes it per batch window.
**Merge order by batch:**

| Batch | Who writes cli.js | What gets added |
|---|---|---|
| B1 | A2 | No new commands in B1 |
| B2 | A2 | No new commands in B2 |
| B4 | A4 | `eva init` (requires A4's `src/init.js` to exist first) |
| B5 | A4 | `eva model-audit` (requires A4's `src/model-audit.js` to exist first) |
| B6 | A2 | `eva watch` (requires A2's `src/watch.js` to exist first) |

Rule: The agent adding the command must also update cli.js `version("0.x.0")` to match package.json.

### `package.json` -- A2 primary, A5 test script key only

A2 owns package.json. A5's only permitted change: add `"test"` key to `"scripts"`.
Timing: A5 adds test script in B1 after A2 completes the npm prep edit.
Mechanism: A5 will use the test script key that A2 leaves blank as `"test": "echo no tests yet"`.

### `src/mcp-server.js` -- A4 in B5 only

mcp-server.js already exists and was written in v0.1.0. A4 adds the 6th tool `model_audit`.
Precondition: A4's `src/model-audit.js` must exist and export `getModelFidelityReport`.
A4 posts handoff contract before touching mcp-server.js: lists exact lines to add.

---

## Coordination Protocol

### Handoff Contract format

When an agent is about to write a shared file OR consume another agent's output,
it posts a Handoff Contract. Format:

```
HANDOFF CONTRACT
From: A{n} -- {Name}
To: A{m} -- {Name}
File: src/xxx.js
Batch: B{k}
Precondition: A3's evidence.js must be merged and export mineCommits()
Interface consumed: discovery.actual.commit_evidence_map (see A3 contract above)
Action: A1 reads the map in reconcile.js -- no write to A3 files
```

### Integration points by batch

**B3 (Day 4-5) -- Critical integration: A3 -> A1**

A3 delivers `evidence.js` and wires into `discover.js`.
A1 then updates `reconcile.js` to union evidence sources.
Order matters: A3 merges first. A1 reads discovery.json output shape, then edits reconcile.js.
There is NO shared source file -- the contract is the JSON schema above.

**B4 (Week 2) -- A4 code-parser enriches generate-plan which A3 discover reads**

A4 adds code-parser to generate-plan.js. New stories get CS- prefixes.
A3's scan-repo.js does NOT need to change -- it already scans all file types.
The integration is through the `.eva/veritas-plan.json` artifact on disk.

**B5 (Week 3) -- A4 model-audit -> A2 audit.js side-load**

A4 delivers `model-audit.js` with `getModelFidelityReport()` exported.
A2 then edits `audit.js` to optionally call it and append model fidelity to audit output.
A2 writes: `const { getModelFidelityReport } = require('./model-audit')`.
A4 MUST ensure `getModelFidelityReport` returns null on API timeout (30s max).

**B5 (Week 3) -- A4 model-audit -> A5 regression tests**

A5 can only write `tests/model-audit.test.js` after A4 delivers `model-audit.js`.
A5 starts the mock server from `tests/fixtures/mock-data-model-server.js`.
The mock must be ready by end of B4 so A5 can test in parallel with B5 build.

**B6 (Week 4) -- A5 self-audit gate**

Before npm publish (A2 B6-06), A5 runs `eva audit --repo .` on veritas.
Self-MTI must be >= 90. If not, B6 ships without npm publish until gap is closed.
A5 owns the go/no-go decision for npm publish.

### Collision prevention rules

1. **Never both edit the same file in the same batch window.**
2. **Always deliver the artifact before posting the contract.** Post contract = "I'm done, you can read it."
3. **JSON schema changes require a contract.** If A3 adds a field to discovery.json, post the schema diff before A1 batch starts reading it.
4. **Read-only is always safe.** Any agent may read any file. Writing is what requires ownership.
5. **tests/** is A5-only. No other agent writes test files. If A1 identifies a bug, A1 posts a "test request" to A5 in the task log. A5 writes the test.

---

## Day 1 Parallel Kickoff Sequence

All five agents start simultaneously on Batch 1 tasks. There are zero dependencies
between B1 work items. Each agent can begin immediately.

```
TIME    A1 Scoring              A2 DevOps               A3 Evidence         A4 Intelligence         A5 QA
00:00   Read reconcile.js       Read audit.js           Read discover.js    Read generate-plan.js   Read trust.js
00:15   Fix line 68             Add --threshold flag     Understand scan-    Study infer-plan.js     Write empty
        (? 1 : -> ? 0 :)        Confirm exit(1)         repo.js classify    Plan C1 code parsing    trust.test.js
00:30   Fix trust.js            Edit package.json        Read git evidence   Plan D1 model-audit     scaffold
        score null -> 0         Remove private:true      approach            API queries             fixtures/
01:00   Run reconcile.js        Create .pre-commit-      Research git log    Write code-parser       Write
        on EVA-JP-v1.2          hooks.yaml               --oneline format    design notes            B1 test cases
        Confirm MTI = 0                                                      (study /model/screens/) (MTI floor)
02:00   [B1 DONE]               [B1 DONE]               [B3 research]       [B4 design]             [B1 tests pass]
        Post: MTI=0 confirmed   Post: npm pack works     Post: git log       Post: parser targets    Post: 10 tests
                                pre-commit installs      format confirmed    confirmed               green
```

**End of Day 1 mandatory artifacts:**
- `src/reconcile.js`: floor fix committed ([A1])
- `src/lib/trust.js`: null -> 0 committed ([A1])
- `package.json`: npm-ready ([A2])
- `.pre-commit-hooks.yaml`: exists and validates ([A2])
- `src/audit.js`: `--threshold` works, exit code 1 confirmed ([A2])
- `tests/trust.test.js`: 10 tests, all green ([A5])

**End of Day 1 self-MTI target: 32**
Test command: `node --test tests/trust.test.js`
Verification: `node src/cli.js audit --repo . --threshold 30`

---

## Conflict Resolution

If two agents disagree on ownership: **the path-to-market.md feature registry is the tie-breaker.**
The agent listed in the "Batch" column for that feature ID has write authority.

If a batch is delayed: downstream agents continue on non-blocked work.
A5 always has regression tests to harden for existing features.
A4 always has design docs to write for upcoming features.

If the data model API (port 8010) is unreachable: A4's model-audit work halts.
All other agents continue. A4 falls back to B4 overflow tasks.

---

## Self-MTI Verification (run after each batch)

```powershell
# From C:\AICOE\eva-foundation\48-eva-veritas
node src/cli.js audit --repo . --warn-only
```

| Batch done | Expected MTI | Fail condition |
|---|---|---|
| B1 | >= 32 | MTI still 30 means floor fix did not land |
| B2 | >= 42 | MTI < 35 means per-feature reporting broke something |
| B3 | >= 55 | Evidence still 0 means commit mining is not wiring in |
| B4 | >= 68 | MTI < 60 means code-parser stories not being reconciled |
| B5 | >= 80 | Requires at least 20 EVA-STORY tags in new source files |
| B6 | >= 90 | npm publish is BLOCKED until this passes ([A5] go/no-go) |

---

*Five agents. One product. Zero coordination drama.*
*Own your files. Respect the contracts. Ship your batch.*
