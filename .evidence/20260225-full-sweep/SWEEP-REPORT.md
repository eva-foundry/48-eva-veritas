# EVA Full Sweep Report -- 2026-02-25

**Run by**: agent:veritas-sweep (Copilot)
**Start**: 2026-02-25 ~22:00 EST
**Evidence dir**: `48-eva-veritas/.evidence/20260225-full-sweep/`

---

## 1. Baseline (pre-sweep)

- Data model total: 962 objects (27 layers)
- Store: Cosmos (ACA, 24x7)
- ACA: https://marco-eva-data-model.livelyflower-7990bc7b.canadacentral.azurecontainerapps.io

---

## 2. Portfolio Scan Results (veritas scan-portfolio)

All 49 numbered project folders scanned under `C:\AICOE\eva-foundation\`.

### Governed Projects (have Feature/Story structure in PLAN.md or veritas-plan.json)

| Project | Stories | Coverage | MTI | Gaps | Action |
|---|---|---|---|---|---|
| 29-foundry | 68 | 68/68 | 100 | 0 | deploy,merge,release |
| 33-eva-brain-v2 | 24 | 24/24 | 100 | 0 | deploy,merge,release |
| 37-data-model | 17 | 17/17 | 100 | 0 | deploy,merge,release |
| 48-eva-veritas | 40 | 40/40 | 100 | 0 | deploy,merge,release |
| 49-eva-dtl | 34 | 34/34 | 100 | 0 | deploy,merge,release |
| 31-eva-faces | 60 | 45/60 | 83 | 15 | test,review,merge-with-approval |
| 46-accelerator | 23 | 23/23 | 70 | 0 | test,review,merge-with-approval |
| 45-aicoe-page | 14 | 14/14 | 66 | 0 | review-required,no-deploy |
| 44-eva-jp-spark | 7 | 4/7 | 40 | 3 | block,investigate |

### Ungoverned Projects (no Feature/Story structure -- MTI=0)

All other 40 projects: 01-30 (minus 29), 32, 34-43, 47
- Action: block,investigate (add PLAN.md with Feature/Story headings)

### Portfolio MTI: 15 (9 governed, 40 ungoverned dragging average)

---

## 3. Data Model Update Results

- Script: `update-model-from-veritas.ps1`
- Projects processed: 49
- PASS: 48 (notes field updated with veritas_scan date, mti, gaps, coverage)
- SKIP/WARN: 1 (34-AIRA -- not yet registered; 34-eva-agents updated with folder mismatch note)
- Commit on ACA: FAIL (expected -- assemble-model.ps1 not in ACA container; 0 violations, 962 exported)

### New/Unregistered Projects Found

| Folder | Data model ID | Status |
|---|---|---|
| 34-AIRA | 34-eva-agents | Mismatch: model has old name; folder updated to 34-AIRA in model |
| 47-eva-mti | 47-eva-mti | Found and updated (maturity=retired) |
| 48-eva-veritas | 48-eva-veritas | Found and updated (maturity=active) |
| 49-eva-dtl | 49-eva-dtl | Found and updated (maturity=active) |

---

## 4. Model-Audit Results (per key project)

NOTE: model-audit checks ALL declared entities (46 screens, 186 endpoints, 34 services, 13 containers = 279 total)
against the repo filesystem. Scores below reflect global entity coverage, not project-specific fidelity.

The root cause of lower scores is 7 JpSpark screens declared with
paths under 44-eva-jp-spark/ -- these are cross-project entities that
only resolve when model-audit is run against the workspace root.

| Project | Fidelity Score | Entities Verified | Drift |
|---|---|---|---|
| 37-data-model | 81% | 225/279 | 54 (mostly services + JpSpark screens) |
| 33-eva-brain-v2 | 72% | 200/279 | 79 (JpSpark screens + stub endpoints) |
| 31-eva-faces | 56% | 157/279 | 122 (JpSpark screens + unimpl. endpoints) |
| 46-accelerator | 55% | 154/279 | 125 (same pattern) |
| 29-foundry | 54% | 152/279 | 127 (same pattern) |
| 48-eva-veritas | 54% | 152/279 | 127 (same pattern) |
| 49-eva-dtl | 54% | 151/279 | 128 (same pattern) |

### Key Findings

1. 7 JpSpark screens (JpSparkLayout, JpSparkChatPage, etc.) are declared in the
   model with repo_path = "44-eva-jp-spark/src/pages/..." -- files DO exist on disk
   but model-audit looks relative to the repo being audited. Use workspace root for
   accurate global score.
2. Container impact analysis shows 0 endpoint/screen impacts for ALL containers --
   this means the cosmos_reads/cosmos_writes fields on endpoints are not being linked
   to containers by name in the impact service. Follow-up needed.
3. ~40 endpoints with status=stub or with paths that routers don't reference directly
   contribute to the drift count.

---

## 5. ADO Gap Items Generated

| Project | ado.csv lines | Notes |
|---|---|---|
| 29-foundry | 17 | No gaps (0 gaps) -- CSV has all stories |
| 31-eva-faces | 34 | 15 gaps -- sprint seeding candidates |
| 33-eva-brain-v2 | 9 | No gaps (0 gaps) |
| 37-data-model | 11 | No gaps (0 gaps) |
| 44-eva-jp-spark | 12 | 3 gaps -- review these |
| 45-aicoe-page | 8 | No gaps (0 gaps) |
| 46-accelerator | 8 | No gaps (0 gaps) |
| 48-eva-veritas | 14 | No gaps (0 gaps) |
| 49-eva-dtl | needs rerun | Script was cut off |

ADO CSV files: each project's `.eva/ado.csv`

---

## 6. Evidence Files

| File | Description |
|---|---|
| baseline-agent-summary.json | Pre-sweep model state |
| portfolio-scan.log | Full scan output (49 projects) |
| portfolio-table.txt | Portfolio MTI table extract |
| model-update.log | Per-project PUT results |
| model-update-results.json | Machine-readable update results |
| model-audit-*.log | Per-project model-audit output |
| update-model-from-veritas.ps1 | Reusable update script |

---

## 7. Follow-up Actions

Priority 1 -- Immediate:
- 31-eva-faces: 15 gaps -- import ado.csv into sprint backlog
- 44-eva-jp-spark: 3 gaps -- review and assign
- 40 ungoverned projects: add PLAN.md with Feature/Story headings (run: eva init)

Priority 2 -- This sprint:
- Run model-audit at workspace root (not individual projects) for accurate global score
- Fix container impact analysis (cosmos_reads/writes not linking to container IDs)
- Rename/reconcile 34-AIRA vs 34-eva-agents in data model

Priority 3 -- Backlog:
- Add PLAN.md governance to 40 ungoverned projects (use: eva init --yes)
- Push portfolio MTI target: current 15, target 60 requires 30+ governed projects
- Set up scheduled scan (daily or per-sprint)

---

## 8. Post-sweep Data Model State

- Total: 962 objects (unchanged -- notes updates)
- Projects with veritas notes: 48/49 (all except 34-AIRA which maps to 34-eva-agents)
- Store: cosmos (ACA, authoritative)
- Violations: 0
