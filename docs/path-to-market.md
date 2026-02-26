# path-to-market.md -- eva-veritas Full Product Plan

**Version**: 2.0.0
**Date**: 2026-02-24
**Horizon**: 4 weeks (2026-02-24 to 2026-03-24)
**Phases**: Discover -> Design -> Build -> Test -> Evidence
**Goal**: Ship the most capable zero-config requirements traceability CLI on GitHub.
No competitor has all of: zero-setup, MCP server, live data-model cross-reference,
portfolio-wide scoring, AI-native, ADO-integrated, and commit evidence mining.

---

## PHASE 0: DISCOVER -- What We Have and What We Need

### 0.1 What veritas can do today (confirmed from source)

From reading every source file before writing this plan:

| Command | What it actually does | Key source file |
|---|---|---|
| `eva generate-plan` | Reads docs/ > PLAN.md > README.md, outputs `.eva/veritas-plan.json` | `generate-plan.js`, `lib/infer-plan.js` |
| `eva generate-plan --sync-model` | After plan generation, PUTs plan summary to 37-data-model API | `generate-plan.js` (lines 30-80) |
| `eva discover` | Reads veritas-plan.json, scans ALL repo files, maps story tags to artifacts | `discover.js`, `lib/scan-repo.js` |
| `eva reconcile` | Planned vs actual: coverage + consistency, produces gap list | `reconcile.js` |
| `eva compute-trust` | Reads reconciliation, computes MTI = Cov*0.5 + Ev*0.2 + Con*0.3 | `lib/trust.js` |
| `eva generate-ado` | Reads plan + reconciliation, outputs ADO-import CSV | `generate-ado.js` |
| `eva report` | Console: coverage, gaps, implemented, hints, feature breakdown | `report.js` |
| `eva audit` | Runs all 5 steps in sequence, exits 1 if MTI < threshold | `audit.js` |
| `eva scan-portfolio` | Runs audit on multiple repos, produces portfolio summary | `scan-portfolio.js` |
| `eva mcp-server` | HTTP MCP server on port 8030, exposes 5 tools to AI agents | `mcp-server.js` |

### 0.2 Confirmed bugs (from reading source)

**BUG-01 -- MTI floor of 30 (reconcile.js line 68)**

When a repo has no STATUS.md declared_status entries, checks=0 -> consistency_score=1.0.
Score = 0*0.5 + 0*0.2 + 1.0*0.3 = 30 even on a completely untagged production app.
This makes EVA-JP-v1.2 "before" (MTI=30) identical to an empty repo.

Fix: `checks === 0 ? 1 :` -> `checks === 0 ? 0 :` in reconcile.js line 68.
Also: trust.js returns `score: null` for 0 stories. Change to `score: 0` -- null hides the problem.

**BUG-02 -- Evidence component structurally 0**

Evidence currently counts only files in an `evidence/` directory (type === "evidence").
No real repo follows this convention. Evidence is 0 for every project veritas audits today.
Fix: expand evidence sources to: evidence/ files + test files with story tags + commit messages.

**BUG-03 -- generate-plan too shallow for real codebases**

For EVA-JP-v1.2 (596 files, full production app), generate-plan extracted 16 features and 8
stories from README.md headings. A 596-file app has hundreds of implementable concerns.
Fix: add code structure parser as Priority 5 enrichment when plan < 20 stories and artifacts > 100.

**BUG-04 -- No CI gate**

Without a GitHub Action that exits 1 on MTI < threshold, the score is advisory only.
It can never block a merge. doorstop ships a pre-commit hook on day 1. veritas has nothing.

**BUG-05 -- Not discoverable on GitHub**

`package.json` has `"private": true`. Zero GitHub topics on the repo.
Anyone searching github.com/topics/requirements-traceability will not find veritas.

### 0.3 Capability gap vs market

| Capability | doorstop (587 stars) | BMW LOBSTER (38 stars) | BASIL (47 stars) | veritas TODAY |
|---|---|---|---|---|
| Per-feature score breakdown | yes | yes | gap count only | hints only |
| Test result linkage | yes | yes (gtest/pytest) | full infra | none |
| Commit evidence mining | no | no | no | none |
| CI gate | pre-commit hook | CI examples | GitHub Actions | none |
| Code structure as plan source | no | no | no | none |
| Data model cross-reference | no | no | no | partial (--sync-model) |
| MCP server | no | no | no | YES (unique) |
| Portfolio scoring | no | no | no | YES (unique) |
| ADO integration | no | no | no | YES (unique) |
| npm install -g | no | no | no | blocked by "private": true |
| GitHub topics | 7 topics | 2 topics | 12 topics | ZERO |

### 0.4 The untapped crown jewel: data model cross-reference

`generate-plan --sync-model` already PUTs plan summaries to 37-data-model (port 8010).
But the direction has NEVER been reversed. The data model declares:
- Every screen (with `repo_path`, `repo_line`, `api_calls[]`)
- Every endpoint (with `status`, `service`, `cosmos_reads[]`, `cosmos_writes[]`)
- Every service (with `is_active`, `status`)
- Every container (with `partition_key`, `fields[]`)

No tool in the world does what veritas could do next: cross-reference declared architectural
entities in a live API against the actual files that implement them, producing a
"model fidelity" score alongside MTI.

Examples:
- Screen declared as `status: designed` but `.tsx` file does not exist -> gap
- Endpoint declared as `status: implemented` but no router file references it -> drift
- Container declared with 8 fields but model file has 5 -> schema drift
- Service declared `is_active: true` but no code -> orphan

This is not requirements traceability. This is architectural truth verification.
doorstop cannot do this. LOBSTER cannot do this. BASIL cannot do this.
It requires a live API, a structured data model, and a filesystem scanner.
veritas already has all three components. This is the feature that puts veritas in a category of one.

---

## PHASE 1: DESIGN -- Full Feature Specification

### Feature Group A: Scoring Engine

**A1 -- Fix MTI floor**
Files: `src/reconcile.js` line 68, `src/lib/trust.js`
- `checks === 0 ? 1 :` -> `checks === 0 ? 0 :`
- `trust.js`: `score: null` for 0 stories -> `score: 0, ungoverned: true`
After fix behavioral contract:
  - Empty repo, no plan:                           MTI = 0
  - Repo with plan, 0 tags, no STATUS.md:          MTI = 0
  - 50% coverage, 0 evidence, 0 consistency:       MTI = 25
  - 100% coverage, 100% evidence, 0 consistency:   MTI = 70
  - All three at 100%:                             MTI = 100

**A2 -- Expand Evidence sources**
Files: `src/reconcile.js`, `src/lib/trust.js`
A story has evidence if ANY are true:
  - Tagged artifact is type="evidence" (evidence/ dir -- current behavior)
  - Tagged artifact is type="test" (added by B3 scan-repo fix)
  - Story ID appears in any commit message (added by B3 commit mining)
  - Story ID appears in any PR title (added by B3 PR mining)
`stories_with_evidence` union of all four sources.

**A3 -- Per-feature MTI in reconciliation.json**
File: `src/reconcile.js` -- new `features[]` array in output:
```
{
  "id": "EO-05",
  "title": "CLI Commands",
  "story_count": 5,
  "stories_with_artifacts": 4,
  "stories_with_evidence": 2,
  "consistency_score": 1.0,
  "mti": 72,
  "gap_count": 1
}
```

**A4 -- Per-feature breakdown in report (primary output, not just hints)**
File: `src/report.js` -- promote feature table from Improvement Hints to main body:
```
Feature Breakdown
---------------------------------------
[72] EO-05  CLI Commands          4/5 stories  2/5 evidence  1 gap
[88] EO-06  Report Engine         3/3 stories  3/3 evidence  0 gaps
[30] EO-08  Commit Mining         0/4 stories  0/4 evidence  4 gaps  [NOT STARTED]
```

**A5 -- MTI trend sparkline**
Store run history in `.eva/trust-history.json` (ring buffer, last 10 entries).
Report shows: `MTI Trend: 30 -> 30 -> 42 -> 65 -> 72  [+7 since last run]`

---

### Feature Group B: Evidence Layer

**B1 -- Test file cross-referencing**
File: `src/lib/scan-repo.js`
scan-repo already classifies .spec. and .test. files as type="test" and already calls
extractStoryTags on them. Two additions:
  1. filename-based implicit evidence: if filename contains story ID pattern
     (e.g. `test_EO-05-001_chat.py`), treat as evidence without needing a comment tag.
  2. Add `"is_test": true` boolean on test artifacts so reconcile.js can count separately.

**B2 -- Commit evidence mining**
New file: `src/lib/evidence.js`
Called from `discover.js` after scanRepo, adds `actual.commit_evidence_map` to discovery.json.
```
Algorithm:
  1. git log --oneline --all --no-merges -> array of lines
  2. For each line, regex: /([A-Z]{2,6}-\d{2}-\d{3})/g
  3. Only match against known story IDs from plan (prevents false positives on IDs like "EO-5")
  4. Build: { story_id -> [{ sha, message_snippet, source: "commit" }] }
  5. Graceful degradation: not a git repo -> [WARN] and continue
```

**B3 -- PR evidence mining**
Same file `src/lib/evidence.js`, second exported function.
Triggered when: GITHUB_TOKEN env var present AND git remote is github.com.
Fetch GET /repos/{owner}/{repo}/pulls?state=closed&per_page=100.
Scan PR titles + bodies for story ID pattern against known IDs.
Add to commit_evidence_map with source: "pr".

**B4 -- Evidence Sources column in generate-ado.js**
File: `src/generate-ado.js`
New CSV column: "Evidence Sources" -> comma-separated list of commit SHAs or PR numbers.
PBIs arrive in ADO pre-populated with evidence links.

---

### Feature Group C: Plan Intelligence

**C1 -- Code structure parser**
New file: `src/lib/code-parser.js`
Called from `generate-plan.js` when plan.stories.length < 20 AND actual.artifacts.length > 100.

Extraction targets:
| Source | File pattern | Extracts | Story ID prefix |
|---|---|---|---|
| FastAPI | `**/*.py` | `@router.{method}('/{path}')` | `CS-{DOMAIN}` |
| Flask | `**/*.py` | `@app.route('/{path}')` | `CS-{DOMAIN}` |
| Express | `**/*.{js,ts}` | `router.{method}('/{path}')` | `CS-{DOMAIN}` |
| Next.js Routes | `app/**/route.ts` | `export async function {METHOD}` | `CS-API` |
| React Pages | `src/pages/**/*.tsx` | filename as page component | `CS-UI` |
| React Router | `**/App.tsx` | `<Route path="..."` | `CS-UI` |
| Terraform | `**/*.tf` | `resource "azurerm_{type}"` | `CS-INFRA` |
| Shell | `**/*.sh` | `function {name}()` | `CS-OPS` |

Output: features with source: "code-structure", IDs in CS- namespace.
CS- stories count toward Coverage, displayed with [code] badge vs [plan] for markdown stories.
Trigger is additive only -- never removes existing plan stories.

**C2 -- OpenAPI/Swagger import**
New file: `src/lib/openapi-parser.js`
If openapi.json / swagger.json / openapi.yaml exists in repo root or docs/:
Parse all paths entries as stories. Group by first path segment as feature.
Source: "openapi" -- stronger than regex route extraction, OpenAPI is authoritative.

**C3 -- ADO backlog import**
File: `src/generate-plan.js` -- new input source (--ado-export <csv-path> flag).
Parse ADO CSV Epic/Feature/Story/Task hierarchy as plan source.
Enables round-trip: veritas generates ADO CSV -> team works in ADO -> veritas re-ingests.

**C4 -- GitHub Issues as plan source**
File: `src/generate-plan.js` -- new --issues flag (requires GITHUB_TOKEN).
Fetch open/closed issues labeled "story" or "feature". Build plan from them.
Source: "github-issues".

---

### Feature Group D: Data Model Cross-Reference (THE UNIQUE FEATURE)

**D1 -- `eva model-audit` command**
New file: `src/model-audit.js`, wired into `src/cli.js`.

Queries 37-data-model API and cross-references against actual repo files:

| Entity | Data model field | Check |
|---|---|---|
| Screen | `repo_path` | File exists at that path |
| Screen | `api_calls[]` | Each endpoint ID referenced in screen source file |
| Endpoint | `status: implemented` | A router file in repo references the path |
| Endpoint | `status: stub` | File exists but no real handler pattern |
| Service | `is_active: true` | Process config or Dockerfile references service |
| Container | `fields[]` | Schema file references at least half the declared fields |

Output: `.eva/model-fidelity.json`:
```
{
  "schema": "eva.model-fidelity.v1",
  "model_fidelity_score": 74,
  "declared_total": 47,
  "verified_total": 35,
  "drifted": [
    {
      "entity": "GET /v1/eva-da/chat",
      "type": "endpoint",
      "declared_status": "implemented",
      "actual_status": "not_found",
      "gap": "No router file references this path"
    }
  ]
}
```

**D2 -- Model fidelity score in trust report (informational)**
File: `src/lib/trust.js`, `src/report.js`
When .eva/model-fidelity.json exists, show in report:
```
  Model Fidelity = 74% (informational)
  [ACT] 12 declared entities have no matching implementation
```
Not weighted into MTI yet -- informational only until teams calibrate it.

**D3 -- Portfolio model audit**
File: `src/scan-portfolio.js` -- new --model flag.
When set: query GET /model/projects/ to discover project list (not just filesystem glob).
Roll up MTI + model fidelity score per project into portfolio dashboard:
```
PROJECT                  MTI   MODEL-FID  STATUS
48-eva-veritas           88    95%        [PASS]
33-eva-brain-v2          62    74%        [REVIEW]
31-eva-faces             45    61%        [BLOCK]
```

**D4 -- Auto-register stories in data model**
File: `src/generate-plan.js` -- enhance existing --sync-model.
Currently only updates project.notes. Enhance: for each feature and story in plan,
check if work_items layer entry exists. If not, PUT it. Every veritas-generated story
becomes a first-class data model citizen, linkable from screens and endpoints.

**D5 -- Impact analysis for drifted entities**
File: `src/model-audit.js` -- after model-audit, call GET /model/impact/?container={id}
for any drifted entity. Surface in report:
"Container 'eva-conversations' has schema drift. Impacts: 3 endpoints, 2 screens."

---

### Feature Group E: CI/CD Native

**E1 -- GitHub Action**
New file: `.github/workflows/veritas-gate.yml`
Triggers: push to main, pull_request to main.
Steps: checkout (fetch-depth: 0 for full git history), node 20, npm ci,
`eva audit --repo . --threshold 70`.
On failure: upload .eva/ as artifact. On success: post MTI as PR comment.

**E2 -- Pre-commit hook**
New file: `.pre-commit-hooks.yaml` (mirrors doorstop's approach).
Teams run `pre-commit install` and get `eva audit --threshold 70` on every commit.

**E3 -- Exit code and threshold semantics**
File: `src/audit.js`
Confirm process.exit(1) when MTI < threshold. Add --warn-only flag for teams
not yet ready to fail hard. Default threshold: 70.

**E4 -- MTI badge generation**
New file: `src/lib/badge.js`
Generates `.eva/badge.svg` and `.eva/badge.json` (Shields.io endpoint format).
Color: red <50, orange 50-69, yellow 70-89, green 90+.
README line: `![MTI](https://img.shields.io/endpoint?url=.../.eva/badge.json)`

---

### Feature Group F: Developer Experience

**F1 -- npm publish prep**
File: `package.json`
Remove `"private": true`. Add `"files": ["src/", "README.md", "LICENSE"]`.
Add `"engines": { "node": ">=18.0.0" }`.
Add keywords: requirements, traceability, audit, governance, mcp, azure-devops.
Add repository, bugs, homepage fields. Bump: 0.1.0 -> 0.2.0.

**F2 -- GitHub repository topics**
Manual, 5 minutes, Day 1.
Add: requirements-traceability, traceability, requirements-management,
specification-coverage, audit, governance, mcp, azure-devops, cli.

**F3 -- `eva init` wizard**
New file: `src/init.js`
Interactive repo onboarding:
  Step 1: Detect project structure (Node / Python / Terraform / mixed)
  Step 2: Choose plan source (generate from README / import ADO / blank PLAN.md)
  Step 3: Run generate-plan
  Step 4: Show how to add first EVA-STORY tag
  Step 5: Run audit and display initial score

**F4 -- `eva watch` command**
New file: `src/watch.js`
Uses fs.watch() to re-run audit on file changes.
Developer sees score update live as they add tags.

**F5 -- `.evarc` config file**
New file: `src/lib/config.js`
Reads `.evarc.json` from repo root:
```
{
  "threshold": 70,
  "prefix": "F33",
  "ignore": ["**/migrations/**"],
  "evidence_sources": ["commits", "tests", "evidence_dir"],
  "data_model_url": "http://localhost:8010"
}
```

---

### Feature Group G: Reporting

**G1 -- HTML report**
New flag: `eva report --format html --out report.html`
New file: `src/lib/html-report.js`
Self-contained HTML, inline CSS. Feature table, gap list, trend chart. No CDN deps.

**G2 -- JSON report for CI**
`eva report --format json` -> `.eva/report.json`
Machine-readable. Used by GitHub Action to post structured PR comments.

**G3 -- Trend chart in HTML**
Part of G1. Chart.js CDN for the HTML version of the sparkline (A5).

---

## PHASE 2: BUILD -- Implementation Queue

All work in `C:\AICOE\eva-foundation\48-eva-veritas\`.

### Batch 1 -- Day 1 (zero dependencies, maximum ROI)

| # | Feature | File(s) | Change size |
|---|---|---|---|
| B1-01 | Fix MTI floor | `src/reconcile.js` line 68 | 1 line |
| B1-02 | trust.js: score=0 not null for ungoverned | `src/lib/trust.js` | 3 lines |
| B1-03 | GitHub topics | GitHub Settings | 0 lines |
| B1-04 | npm publish prep | `package.json` | 8 lines |
| B1-05 | Pre-commit hook file | `.pre-commit-hooks.yaml` | new, 8 lines |
| B1-06 | Exit code + --threshold in audit.js | `src/audit.js` | 5 lines |

After Batch 1: EVA-JP-v1.2 MTI = 0. veritas is publishable. CI can gate on score.

### Batch 2 -- Days 2-3

| # | Feature | File(s) | Change size |
|---|---|---|---|
| B2-01 | Per-feature MTI in reconciliation.json | `src/reconcile.js` | +30 lines |
| B2-02 | Per-feature report (primary output) | `src/report.js` | refactor ~40 lines |
| B2-03 | MTI trend history + sparkline | `src/compute-trust.js`, `src/report.js` | +25 lines |
| B2-04 | GitHub Action | `.github/workflows/veritas-gate.yml` | new, 50 lines |
| B2-05 | Badge generation | `src/lib/badge.js`, `src/audit.js` | new 40 lines + 5 call |

After Batch 2: Feature-level scoring visible. CI gate live. Badge in README.

### Batch 3 -- Days 4-5

| # | Feature | File(s) | Change size |
|---|---|---|---|
| B3-01 | Test file cross-referencing | `src/lib/scan-repo.js` | +10 lines |
| B3-02 | Commit evidence mining | `src/lib/evidence.js` (new) | 60 lines |
| B3-03 | Wire evidence into discover.js | `src/discover.js` | +10 lines |
| B3-04 | Wire evidence into reconcile.js | `src/reconcile.js` | +15 lines |
| B3-05 | PR evidence mining | `src/lib/evidence.js` (append) | +30 lines |

After Batch 3: Evidence no longer structurally 0. Any repo with git history gets credit.

### Batch 4 -- Week 2

| # | Feature | File(s) | Change size |
|---|---|---|---|
| B4-01 | Code structure parser | `src/lib/code-parser.js` (new) | 120 lines |
| B4-02 | Enrich generate-plan | `src/generate-plan.js` | +15 lines |
| B4-03 | OpenAPI import | `src/lib/openapi-parser.js` (new) | 50 lines |
| B4-04 | ADO import in generate-plan | `src/generate-plan.js` | +30 lines |
| B4-05 | `eva init` wizard | `src/init.js` (new) | 80 lines |
| B4-06 | `.evarc` config file | `src/lib/config.js` (new) | 40 lines |
| B4-07 | Evidence Sources in ADO CSV | `src/generate-ado.js` | +20 lines |

After Batch 4: EVA-JP-v1.2 generate-plan produces 40+ stories. Before/after comparison valid.

### Batch 5 -- Week 3

| # | Feature | File(s) | Change size |
|---|---|---|---|
| B5-01 | `eva model-audit` command | `src/model-audit.js` (new), `src/cli.js` | 150 lines |
| B5-02 | Model fidelity in trust report | `src/lib/trust.js`, `src/report.js` | +20 lines |
| B5-03 | Portfolio model scan (--model flag) | `src/scan-portfolio.js` | +30 lines |
| B5-04 | Auto-register stories in data model | `src/generate-plan.js` | +40 lines |
| B5-05 | Impact analysis for drifted entities | `src/model-audit.js` | +30 lines |
| B5-06 | MCP: expose model_audit tool | `src/mcp-server.js` | +20 lines |

After Batch 5: veritas is in a category of one. No competitor can match model-audit without
first building a data model API. EVA has had one for months.

### Batch 6 -- Week 4

| # | Feature | File(s) | Change size |
|---|---|---|---|
| B6-01 | HTML report | `src/lib/html-report.js` (new) | 100 lines |
| B6-02 | JSON report format | `src/report.js` | +20 lines |
| B6-03 | `eva watch` command | `src/watch.js` (new), `src/cli.js` | 40 lines |
| B6-04 | Self-tag all new files with EVA-STORY | All new src/*.js above | Tags added |
| B6-05 | Run self-audit, close all gaps | `.eva/` files | Self-MTI >= 90 |
| B6-06 | npm publish (0.2.0 tag) | `package.json`, git tag | 1 line |
| B6-07 | before-after EVA-JP-v1.2 | `docs/before-after-eva-jp.md` | New doc |

---

## PHASE 3: TEST

No test runner currently installed. Add: `"test": "node --test tests/**/*.test.js"`.
Node 20 built-in test runner -- zero new dependencies.

### Test contracts per batch

**Batch 1 (formula correctness):**
- empty repo -> MTI = 0, ungoverned = true
- plan exists, 0 tags, no STATUS.md -> MTI = 0 (was 30, the test proves the fix)
- 50% coverage, 0 evidence, 0 consistency -> MTI = 25
- 100/100/100 -> MTI = 100

**Batch 3 (evidence mining):**
- git fixture repo with commits referencing story IDs -> assert evidenceMap populated
- test filename containing story ID -> assert implicit evidence
- no git repo -> assert graceful skip, no throw

**Batch 4 (code-parser):**
- FastAPI file with 3 routes -> assert 3 CS- stories
- Terraform with 5 azurerm_* resources -> assert 5 CS-INFRA stories
- 200-file repo, 5 README stories -> assert enrichment triggers
- 200-file repo, 25 README stories -> assert enrichment does NOT trigger

**Batch 5 (model-audit):**
- Mock data model API (Node http stub) returning 3 screens
- screen with valid repo_path -> assert verified
- screen with missing repo_path -> assert gap reported
- endpoint declared implemented, no router reference -> assert drift

**Regression (every batch):**
- `eva audit` on veritas itself: MTI must not decrease
- `eva audit` on EVA-JP-v1.2 fixture: MTI = 0 when 0 tags
- All 10+ CLI commands complete without throw on minimal fixture

### Self-MTI targets

| After | Min tests | Target self-MTI |
|---|---|---|
| Batch 1 | 10 | 32 (floor fixed, consistency now honest) |
| Batch 2 | 20 | 42 |
| Batch 3 | 35 | 55 |
| Batch 4 | 50 | 68 |
| Batch 5 | 65 | 80 |
| Batch 6 | 80 | 90+ |

---

## PHASE 4: EVIDENCE -- veritas Proves Itself

Every new feature must be:
1. Tagged with `// EVA-STORY: <ID>` in its source file
2. Visible in `eva report` as implemented
3. Linked to a commit message bearing the story ID

By end of Week 4, `eva audit --repo .` on veritas must produce:
- MTI >= 90
- 0 missing_implementation gaps
- Evidence for every story (commit history + test files)
- Model fidelity >= 85% (veritas own endpoints registered in data model)

README will show: `![MTI](badge) MTI: 92 | 35 stories | 0 gaps | Evidence: commits + tests`

No competitor can show this. doorstop does not score itself.
LOBSTER does not run LOBSTER on LOBSTER. veritas will eat its own cooking.

---

## PHASE 5: FULL FEATURE REGISTRY

| ID | Feature | Group | Batch | Status |
|---|---|---|---|---|
| VP-A1 | Fix MTI floor | Scoring | B1 | NOT STARTED |
| VP-A2 | trust.js: 0 stories = score 0 not null | Scoring | B1 | NOT STARTED |
| VP-A3 | Expand evidence to union of 4 sources | Scoring | B1+B3 | NOT STARTED |
| VP-A4 | Per-feature MTI in reconciliation.json | Scoring | B2 | NOT STARTED |
| VP-A5 | Per-feature breakdown in report (primary) | Scoring | B2 | NOT STARTED |
| VP-A6 | MTI trend sparkline + trust-history.json | Scoring | B2 | NOT STARTED |
| VP-B1 | Test file cross-referencing (implicit evidence) | Evidence | B3 | NOT STARTED |
| VP-B2 | Commit evidence mining (git log) | Evidence | B3 | NOT STARTED |
| VP-B3 | PR evidence mining (GitHub API) | Evidence | B3 | NOT STARTED |
| VP-B4 | Evidence Sources column in ADO CSV | Evidence | B4 | NOT STARTED |
| VP-C1 | Code structure parser (FastAPI/Express/React/TF/Shell) | Intelligence | B4 | NOT STARTED |
| VP-C2 | OpenAPI/Swagger import as plan source | Intelligence | B4 | NOT STARTED |
| VP-C3 | ADO backlog import as plan source (--ado-export) | Intelligence | B4 | NOT STARTED |
| VP-C4 | GitHub Issues as plan source (--issues) | Intelligence | B4 | NOT STARTED |
| VP-D1 | `eva model-audit` command | Data Model | B5 | NOT STARTED |
| VP-D2 | Model fidelity score in trust report | Data Model | B5 | NOT STARTED |
| VP-D3 | Portfolio model scan (--model, data model registry) | Data Model | B5 | NOT STARTED |
| VP-D4 | Auto-register stories in data model via --sync-model | Data Model | B5 | NOT STARTED |
| VP-D5 | Impact analysis for drifted entities | Data Model | B5 | NOT STARTED |
| VP-E1 | GitHub Action (veritas-gate.yml) | CI/CD | B2 | NOT STARTED |
| VP-E2 | Pre-commit hook (.pre-commit-hooks.yaml) | CI/CD | B1 | NOT STARTED |
| VP-E3 | Exit code semantics (--threshold, --warn-only) | CI/CD | B1 | NOT STARTED |
| VP-E4 | MTI badge generation (.eva/badge.svg + badge.json) | CI/CD | B2 | NOT STARTED |
| VP-F1 | npm publish prep (package.json) | DX | B1 | NOT STARTED |
| VP-F2 | GitHub repository topics (9 topics) | DX | B1 | NOT STARTED |
| VP-F3 | `eva init` wizard | DX | B4 | NOT STARTED |
| VP-F4 | `eva watch` command | DX | B6 | NOT STARTED |
| VP-F5 | `.evarc` config file | DX | B4 | NOT STARTED |
| VP-G1 | HTML report (--format html) | Reporting | B6 | NOT STARTED |
| VP-G2 | JSON report (--format json) | Reporting | B6 | NOT STARTED |
| VP-G3 | Trend chart in HTML report | Reporting | B6 | NOT STARTED |

**Total: 31 features, 6 batches, 4 weeks.**

---

## Timeline and Exit Criteria

| Week | Batches | Delivered | Self-MTI |
|---|---|---|---|
| Week 1 (Feb 24-28) | B1 + B2 + B3 | MTI floor fixed, CI live, commit mining, per-feature report | 55 |
| Week 2 (Mar 2-7) | B4 | Code parser, generate-plan 40+ stories for EVA-JP-v1.2, init wizard | 68 |
| Week 3 (Mar 9-14) | B5 | model-audit, portfolio model scan, data model round-trip | 80 |
| Week 4 (Mar 16-21) | B6 | HTML report, watch mode, npm publish, self-MTI >= 90 | 90+ |

---

## Why veritas is uncopyable after Week 4

**1. Zero-config + AI-native**: `npm install -g eva-veritas && eva audit` in any repo.
No YAML schemas. No web server. No database. MCP server on `eva mcp-server`. Unique.

**2. Data model cross-reference (model-audit)**: Verifies declared architectural entities
against actual code. Requires a live API + filesystem scanner + diff engine. The
37-data-model API took months to build. No competitor can ship this without building
their own data model layer first. EVA has had it for months.

**3. Evidence from zero developer effort**: Commit mining + test file detection gives
partial credit before a single `# EVA-STORY:` tag is written. The only tool where
developers benefit from veritas passively.

**4. Portfolio governance at 46-project scale**: `eva scan-portfolio --model` aggregates
MTI + model fidelity across all data-model-registered projects in one command. Competitors
have never thought about portfolio-level scoring because they have no portfolio registry.
veritas inherits one from 37-data-model for free.

**5. ADO round-trip**: generate plan -> push to ADO -> work in ADO -> re-ingest ADO state
-> MTI reflects actual sprint completion. No tool in this space touches ADO at all.

---

*This is the authoritative product specification for eva-veritas v0.2.0.*
*Update feature status in PHASE 5 registry as each feature ships.*
*Do not create parallel tracking documents -- update this file in place.*