# STATUS.md -- eva-veritas

**Last Updated**: 2026-03-05 20:45 ET (session 28)
**Current Phase**: L34 quality-gates integration planning (from 37-data-model)
**Active Tasks**: 
  - Integrate quality_gates layer (L34) into MTI scoring
  - Reference mti_threshold from /model/quality_gates/{project_id}
  - Update compute-trust.js to query new L34 layer

**Phase Completions**:
- Phase 1: Core CLI -- COMPLETE (MTI: 100, all 39 stories with evidence)
- Phase 2: MCP Server + EVA Integrations -- COMPLETE
- Phase 3: generate-plan Command -- COMPLETE
- Phase 4: Orphan tag cleanup + Model Fidelity Audit -- COMPLETE (2026-02-24 19:44)
- Phase 5: Full Portfolio Bootstrap + WBS Import + Endpoint Linkage -- COMPLETE (2026-02-25 08:20 ET)
- Phase 6: DPDCA + All 4 Missing Wires CLOSED -- COMPLETE (2026-02-25 10:38 ET)
- Phase 7: WBS-ADO Field Sync (sprint_id, story_points, owner) -- COMPLETE (2026-02-25 10:58 ET)

---

## Session 28 Update (2026-03-05 20:45 ET) -- L34 Quality-Gates Integration Planning

### What Happened
- **37-data-model PR #12**: Session 28 Phase 1 completed
  - L33: agent-policies (agent safety constraints)
  - L34: quality-gates (MTI thresholds linked to EVA-Veritas scoring)
  - L35: github-rules (branch protection enforcement)
- **Evidence Polymorphism**: 3 test records seeded with tech_stack discrimination
  - ACA-S11-L33-agent-policies-D
  - ACA-S11-L34-quality-gates-P
  - ACA-S11-L35-github-rules-Do

### What's Next for Veritas

**Integration Task**: Update MTI scoring to consume L34:

```javascript
// In compute-trust.js, add:
const baseUrl = process.env.DATA_MODEL_URL || "https://msub-eva-data-model...";
const qgResponse = await fetch(`${baseUrl}/model/quality_gates/${projectId}`);
if (qgResponse.ok) {
  const gates = await qgResponse.json();
  const { mti_threshold = 75 } = gates.data[0];
  // Use mti_threshold in deployment gate logic
}
```

**Benefit**: Quality thresholds become declarative (queryable from API) instead of hardcoded.

---

## Session 7 Update (2026-02-25 10:58 ET) -- WBS-ADO Field Sync

| Action | Detail | Result |
|---|---|---|
| ADO field discovery | 1869 linked WBS items: all in Sprint-Backlog, sp=null, dates=null, 16 sprints w/ 0 dates | [INFO] |
| wbs-ado-sync.ps1 written | Syncs status, sprint_id, story_points, owner from ADO -> WBS model | [DONE] |
| Dry-run | updated=1869  unchanged=0  failed=0  mode=DRY-RUN | [PASS] |
| Live run | updated=1869  unchanged=0  failed=0  spot=5/5  mode=LIVE | [PASS] |
| ACA commit | violations=0  exported=3929  errors=0 | [PASS] |
| Sprint calendar | 16 ADO sprints upserted to model/sprints/ layer (all with null dates) | [INFO] |

### WBS Fields Now Populated

All 1869 ADO-linked WBS records now carry:
- `sprint_id` = "Sprint-Backlog" (accurately reflects ADO IterationPath)
- `story_points` = null (ADO has 0 items with StoryPoints set)
- `owner` = null (ADO has 0 items with AssignedTo set)
- `status` = "planned" (unchanged -- ADO State=New maps to planned)

### Evidence

```
.evidence/20260225-dpdca/
  wbs-ado-sync.ps1                         -- repeatable sync script
  wbs-ado-sync-dryrun.txt                  -- dry-run output
  wbs-ado-sync-live.txt                    -- live run output
  wbs-ado-sync-20260225-105605.json        -- evidence JSON
```

### Next Steps

- Assign story points to ADO items -> re-run wbs-ado-sync.ps1 to propagate
- Set sprint dates in ADO -> sprint calendar layer will populate on next sync
- 39-ado-dashboard Sprint 2 (EVA Home page, F39-01-002) ready to start

---


| Action | Detail | Result |
|---|---|---|
| PLAN preflight | ACA=ok store=cosmos, CP8020=ok store=memory, PAT=84 chars from evachatkv | [PASS] |
| dpdca-run.ps1 written | Full PLAN-DO-CHECK-ACT script in .evidence/20260225-dpdca/ | [DONE] |
| DO: WIQL query | 2725 ADO items retrieved (PBI+Feature+Epic) in 14 batches from eva-poc | [DONE] |
| DO: ado_id writeback | 1880 WBS records updated with integer ADO ado_id via PUT to ACA | [PASS] |
| DO: stats | matched=1880, already_set=0, not_found=91, skipped(no-prefix)=754, failed=0 | [INFO] |
| CHECK: spot-check | 5/5 random WBS records verified: ado_id matches ADO integer | [PASS] |
| CHECK: FK coverage | 1880/2725 ADO items linked = 69% (754 non-WBS items + 91 WBS-ID not in model) | [INFO] |
| ACT: CP evidence | Run run-dpdca-20260225102518 + artifact artifact-e5fc8224 posted to CP8020 | [PASS] |
| ACT: evidence round-trip | GET /evidence/DPDCA-20260225-ado-id-writeback: run=running artifacts=1 | [PASS] |
| ACT: ACA commit | violations=0, exported=3929, errors=0 | [PASS] |
| Missing wire #1 CLOSED | WBS records now carry ado_id (integer FK to ADO) | [PASS] |
| Missing wire #2 CLOSED | ADO state sync: 1869 WBS records verified -- all ADO "New" -> "planned" (already matching) | [PASS] |
| Missing wire #3 CLOSED | CP8020 seeded: 6 sprint runs + 6 artifacts (wbs-import, ado-seed, endpoint-link, writeback, state-sync, test-ids) | [PASS] |
| Missing wire #4 CLOSED | requirements.test_ids populated via satisfied_by->endpoint.wbs_id chain (EPIC-001=7, AC-001=1) | [PASS] |
| Final ACA commit | violations=0, exported=3929, errors=0 | [PASS] |

### All 4 Missing Wires CLOSED

### Evidence Pack

```
.evidence/20260225-dpdca/
  dpdca-run.ps1              -- wire #1: ADO-ID writeback (repeatable)
  wire2-ado-state-sync.ps1   -- wire #2: ADO state -> WBS status sync
  wire3-cp-sprint-seed.ps1   -- wire #3: CP8020 sprint run seeding
  wire4-test-ids-link.ps1    -- wire #4: requirements test_ids via endpoint chain
  evidence.json              -- wire #1 evidence pack
  wire2-evidence.json        -- wire #2: updated=0 (all matching), spot=1/1
  wire3-evidence.json        -- wire #3: runs_posted=6, cp_runs=9, artifacts=9
  wire4-evidence.json        -- wire #4: updated=2, test_ids_total=8, spot=2/2
  dpdca.log / wire2-4 logs   -- timestamped execution logs
Wire evidence IDs:
  DPDCA-20260225-ado-id-writeback (wire #1)
  SPRINT-20260225-state-sync      (wire #2)
  SPRINT-20260225-wbs-import      (wire #3/seed)
  SPRINT-20260225-test-ids-link   (wire #4)
```

---

## Session 5 Update (2026-02-25 08:20 ET)

| Action | Detail | Result |
|---|---|---|
| BOM fix (cli.js) | Stripped UTF-8 BOM from all src/*.js -- Node v24 was silently failing all sweeps 1-5 | [DONE] |
| normalize-plans.ps1 | 43/49 PLAN.md files normalized to veritas-native prefix=F{NN} format | [DONE] |
| auto-tag.ps1 | 913 EVA-STORY tags injected into source files across 75 files | [DONE] |
| sweep6 (36/49 projects) | First clean sweep post-BOM -- 36 projects coverage=100%, MTI>=50 | [PASS] |
| sweep7 (13 MTI=0 projects) | Created manifest.yml for 6 pure-docs projects; PLAN.md for 7 empty projects | [DONE] |
| sweep7 result | All 13 -> MTI=50, coverage=100% -- every project now governed | [PASS] |
| WBS clean slate | Deleted 13 stale WBS records; cleared wbs_id from all 50 projects | [DONE] |
| wbs-import.ps1 | Full hierarchy: 1 program + 4 streams + 51 projects + 751 features + 2427 stories | [DONE] |
| wbs-import result | 3234 WBS records PUT, violations=0, exported=3929 | [PASS] |
| endpoint-link.ps1 | 186 endpoints + 46 screens linked to WBS story IDs (wbs_id field) | [DONE] |
| endpoint-link result | linked_eps=186, linked_scr=46, 81 WBS stories enriched with coverage lists | [PASS] |
| wbs-to-ado.ps1 | ADO sprint seeding script: reads WBS layer, generates 42 ado-artifacts.json files | [DONE] |
| wbs-to-ado dry-run | artifacts=42, import_success=42, total_pbis_staged=1920, mode=DRY-RUN | [PASS] |
| full-bootstrap.ps1 | Master replay script written -- 8 phases, repeats entire sequence from clean slate | [DONE] |
| Data model total | 3929 objects: wbs=2979, endpoints=186, screens=46, projects=51, stories=2165 | [INFO] |

### Bootstrap Replay Sequence (in order)

These scripts are stored in `.evidence/` and can be replayed from clean slate
via `.evidence/full-bootstrap.ps1`:

```
1. wbs-reset.ps1          -- delete all WBS records, clear project wbs_id/stream
2. normalize-plans.ps1    -- normalize 43 PLAN.md files to veritas-native format
3. auto-tag.ps1           -- inject EVA-STORY tags into source files
4. sweep-all.ps1          -- run PDCA loop on all 49 projects (sweep6 + sweep7 logic)
5. wbs-import.ps1         -- build full WBS hierarchy from veritas-plan.json files
6. endpoint-link.ps1      -- link endpoints + screens to WBS story IDs
7. wbs-to-ado.ps1         -- generate ADO Epics/Features/PBIs from WBS (requires ADO_PAT)
8. admin/commit           -- final integrity check
```

**Evidence location:** `48-eva-veritas/.evidence/full-bootstrap.ps1`
**Script inventory:**
- `.evidence/20260225-sweep3/normalize-plans.ps1`
- `.evidence/20260225-sweep4/auto-tag.ps1` (if present)
- `.evidence/20260225-sweep7/sweep7.ps1`
- `.evidence/20260225-wbs-import/wbs-import.ps1`
- `.evidence/20260225-endpoint-link/endpoint-link.ps1`
- `.evidence/20260225-ado-seed/wbs-to-ado.ps1`

---

## Session 4 Update (2026-02-24 19:44)

| Action | Detail | Result |
|--------|--------|--------|
| Discover: full audit | 4 orphan_story_tags found | [INFO] |
| EO-05-008 added to PLAN.md | `eva init` onboarding wizard | [DONE] |
| EO-09-003 added to PLAN.md | OpenAPI spec importer (openapi-parser.js) | [DONE] |
| EO-09-004 added to PLAN.md | ADO CSV plan importer (ado-import.js) | [DONE] |
| EO-12 + EO-12-001 added | Model Fidelity Audit new feature (model-audit.js) | [DONE] |
| EO-D5-001 typo fixed | src/model-audit.js + tests/model-audit.test.js -> EO-12-001 | [DONE] |
| Evidence files added | EO-05-init-command.txt, EO-09-plan-importers.txt, EO-12-model-audit.txt | [DONE] |
| generate-plan rerun | 12 features, 39 stories (was 11/35) | [PASS] |
| Re-audit | 0 gaps (was 4 orphans), MTI=100, 39/39 stories evidenced | [PASS] |
| Tests | 71 passed, 0 failed (was 71/0) | [PASS] |
| MTI delta | 100 -> 100 (held, plan grew 35->39) | [PASS] |

---

## Session 3 Update (2026-02-24)

| Action | Detail | Result |
|--------|--------|--------|
| EO-07 MCP server tested | 5 tools verified via HTTP | [DONE] |
| EO-07 evidence added | EO-07-mcp-server.txt + .json | [DONE] |
| EO-11 generate-plan tested | 11 feat, 35 stories generated | [DONE] |
| EO-11 evidence added | EO-11-generate-plan.txt | [DONE] |
| EO-08-001 audit-repo endpoint | Added to 37-data-model admin.py + model API | [DONE] |
| EO-08-002 integration doc | 37-data-model/docs/library/08-EVA-VERITAS-INTEGRATION.md | [DONE] |
| EO-09-002 ADO integration doc | 38-ado-poc/VERITAS-INTEGRATION.md | [DONE] |
| EO-10-001 29-foundry MCP | 29-foundry/mcp-servers/eva-veritas/ | [DONE] |
| EO-10-002 29-foundry skill | 29-foundry/copilot-skills/07-eva-veritas.md; catalog 72->73 | [DONE] |
| MTI delta | 88 -> 100 (+12) | [PASS] |
| Gaps reduction | 5 -> 0 (all Phase 2 stories covered) | [PASS] |
| Stories with evidence | 20 -> 35/35 | [PASS] |
| Actions | test,review -> deploy,merge,release | [PASS] |

---

## Session 2 Update (2026-02-24)

| Action | Detail | Result |
|--------|--------|--------|
| Added evidence/ folder | 7 .txt files for Phase 1 stories | [DONE] |
| Re-ran self-audit | node src/cli.js audit --repo . | [DONE] |
| MTI delta | 62 -> 75 (+13) | [PASS] |
| Actions updated | review-required -> test,review,merge-with-approval | [PASS] |
| Gaps reduction | 29 -> 11 (only Phase 2 missing_implementation remain) | [PASS] |
| Stories with evidence | 0 -> 20/20 Phase 1 stories | [PASS] |
| Portfolio scan | 48 projects: 46 ungoverned, 29-foundry=42 (block) | [INFO] |

---

## Phase 1 Feature Status (COMPLETE)

| Feature | ID    | Status      | Notes |
|---------|-------|-------------|-------|
| Discovery Engine     | EO-01 | Done | self-test passes |
| Reconciliation Engine| EO-02 | Done | 20/31 stories covered, 20/20 Phase 1 with evidence |
| Trust Scoring (MTI)  | EO-03 | Done | MTI=100, coverage=1.0, evidence=1.0, consistency=1.0 |
| ADO Export           | EO-04 | Done | ado.csv generated, --gaps-only sprint seeding |
| CLI Interface        | EO-05 | Done | 7 commands (audit + scan-portfolio added), report fixed as subcommand, generate-plan added |
| Reporting            | EO-06 | Done | MTI trend delta, [STALE] flag, Evidence Convention doc |

## Phase 2 Feature Status (COMPLETE)

| Feature | ID    | Status      | Notes |
|---------|-------|-------------|-------|
| MCP Server           | EO-07 | Done | 5 tools, HTTP server on port 8031 |
| 37-data-model integration | EO-08 | Done | audit-repo endpoint + integration doc |
| 38-ado-poc integration    | EO-09 | Done | gap-pipeline CSV + VERITAS-INTEGRATION.md + openapi-parser + ado-import |
| 29-foundry hosting        | EO-10 | Done | MCP server config + skill #07 in catalog |
| generate-plan Command     | EO-11 | Done | infer-plan, CLI command, discover.js |
| Model Fidelity Audit      | EO-12 | Done | model-audit command, model-fidelity.json |

---

## Story Status (STATUS convention for MTI consistency scoring)

FEATURE EO-01: Done
FEATURE EO-02: Done
FEATURE EO-03: Done
FEATURE EO-04: Done
FEATURE EO-05: Done
FEATURE EO-06: Done

# Phase 1 (COMPLETE 2026-02-24)
STORY EO-01-001: Done
STORY EO-01-002: Done
STORY EO-01-003: Done
STORY EO-02-001: Done
STORY EO-02-002: Done
STORY EO-02-003: Done
STORY EO-03-001: Done
STORY EO-03-002: Done
STORY EO-04-001: Done
STORY EO-04-002: Done
STORY EO-05-001: Done
STORY EO-05-002: Done
STORY EO-05-003: Done
STORY EO-05-004: Done
STORY EO-05-005: Done
STORY EO-05-006: Done
STORY EO-05-007: Done
STORY EO-06-001: Done
STORY EO-06-002: Done

FEATURE EO-07: Done
FEATURE EO-08: Done
FEATURE EO-09: Done
FEATURE EO-10: Done
STORY EO-07-001: Done
STORY EO-07-002: Done
STORY EO-07-003: Done
STORY EO-07-004: Done
STORY EO-07-005: Done
STORY EO-07-006: Done
STORY EO-08-001: Done
STORY EO-08-002: Done
STORY EO-09-001: Done
STORY EO-09-002: Done
STORY EO-09-003: Done
STORY EO-09-004: Done
STORY EO-10-001: Done
STORY EO-10-002: Done

# Phase 3 (generate-plan Command -- COMPLETE 2026-02-24)
FEATURE EO-11: Done
STORY EO-11-001: Done
STORY EO-11-002: Done
STORY EO-11-003: Done
STORY EO-11-004: Done

# Phase 4 (Orphan cleanup + Model Fidelity Audit -- COMPLETE 2026-02-24 19:44)
FEATURE EO-12: Done
STORY EO-12-001: Done
STORY EO-01-004: Done

---

## Session Log

| Date       | Who    | Summary |
|------------|--------|-------------|
| 2026-02-24 | copilot | Bug EO-01-004: .tsx/.jsx scanning blind spot fixed in scan-repo.js. classify() + isTextLike regex both missing tsx/jsx -- React projects showed MTI=0 despite correct headers. Discovered during 46-accelerator audit. Fix: added .tsx/.jsx to both clauses. Story EO-01-004 added to PLAN.md. Evidence receipt created. Self-audit MTI held at 100. |
| 2026-02-24 13:02 ET | copilot | Tested + compiled. Bugs fixed: `report` was root program action not subcommand (fixed), .md files scanned for EVA-STORY tags causing false orphans (fixed -- isTaggable skips .md). Enhancements: staleness guard (> 24 h reconciliation warns + stale:true in trust.json), MTI trend delta (trust.prev.json + `Score: 62 (no change)` in report), docs/EVIDENCE-CONVENTION.md created. Self-audit result: MTI=62, 20/31 stories, 0 orphans, 7 commands all pass. |
| 2026-02-24 12:29 ET | copilot | Applied all 10-item technical review. Bugs fixed: .eva scan pollution (+.eva/** ignore), Done?consistency penalty (STATUS_PERCENT map), MTI formula reweight 0.5/0.2/0.3 (was 0.4/0.4/0.2). New: `eva audit` (EO-05-007), `eva scan-portfolio` (EO-05-006), `--gaps-only` ADO flag (EO-09-001), ungoverned MTI=null state, Implemented report section, loose [ID=...] parser. MTI 43->62, coverage 20/31. |
| 2026-02-24 12:29 ET | copilot | Re-test after rename. All 5 CLI commands pass (discover/reconcile/compute-trust/generate-ado/report). Repo path correct in all .eva artifacts. MTI=43, coverage=0.59, consistency=1.0, 17 planned stories with artifacts, 32 gaps (17 missing_evidence Phase 1 expected, 12 missing_impl Phase 2 not-started, 3 orphan tags). [PASS] |
| 2026-02-24 12:29 ET | copilot | Folder renamed: `48-eva-orchestrator` -> `48-eva-veritas`. Updated all references in README.md, PLAN.md, PLAN.md, .github/copilot-instructions.md, .eva/*.json. No code changes. |
| 2026-02-25 09:07 ET | copilot | ADO LIVE SEEDING COMPLETE. 42/42 projects imported (41 live + 1 retry). artifacts_built=42, import_success=42, import_failed=0, total_pbis=1920. One failure fixed: 29-foundry F29-18-008 title was 299 chars (ADO limit 255) -- truncated and retried. ADO IDs span Epic ~400s, Features ~900-1079, PBIs 600-2718. wbs-to-ado.ps1 patched with auto-truncate guard (>255 chars -> truncate to 252+...). PAT retrieved from Key Vault evachatkv. |
| 2026-02-25 08:20 ET | copilot | Session 5: Endpoint linkage complete (186 endpoints + 46 screens -> wbs_id). WBS import: 3,234 records (program+4 streams+51 projects+751 features+2,427 stories). Full-bootstrap.ps1 (8-phase replay) written. STATUS.md + PLAN.md updated (Feature EO-13, 10 stories). |
| 2026-02-24 09:32 ET | copilot | POC PROVED. Renamed to eva-veritas. Phase 1 complete: 15 source files, full CLI pipeline (discover/reconcile/compute-trust/generate-ado/report) self-tested. MTI=60, coverage=1.0, 17/17 stories traced via EVA-STORY tags. Established Evidence Plane pattern. Phase 2 active: MCP server + 29-foundry/37-data-model/38-ado-poc integrations. |


---

## 2026-03-03 -- Re-primed by agent:copilot

<!-- eva-primed-status -->

Data model: GET http://localhost:8010/model/projects/48-eva-veritas
29-foundry agents: C:\AICOE\eva-foundation\29-foundry\agents\
48-eva-veritas: run audit_repo MCP tool
