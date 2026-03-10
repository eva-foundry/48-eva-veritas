# ACCEPTANCE.md -- eva-veritas

Definition of Done for all user stories. Phase 1 criteria are verified. Phase 2 criteria are pending.

---

## Story: Parse planned model from governance docs [ID=EO-01-001]

- [ ] README.md h1 is extracted as epic title
- [ ] PLAN.md `## Feature:` headings are parsed into features with IDs
- [ ] PLAN.md `### Story:` headings are parsed into stories with IDs
- [ ] ACCEPTANCE.md checklist items are mapped to their story IDs
- [ ] STATUS.md `STORY|FEATURE <ID>: <value>` lines populate declared_status
- [ ] project.yaml is loaded if present
- [ ] Missing files are tolerated (no crash, _note is set)

## Story: Scan repo for actual artifacts [ID=EO-01-002]

- [ ] All files in repo are enumerated (excluding node_modules, .git, .eva, dist, build)
- [ ] Each artifact has: path, type (code/test/infra/doc/evidence/config/data/other)
- [ ] Binary files are not read as text

## Story: Map artifacts to stories via EVA-STORY tags [ID=EO-01-003]

- [ ] `EVA-STORY: <ID>` pattern in file headers is detected
- [ ] `[EVA-STORY <ID>]` pattern is also detected
- [ ] story_artifact_map in discovery.json maps story_id -> artifacts[]
- [ ] Files with no tag produce no entry (no noise)

---

## Story: Compute coverage metrics [ID=EO-02-001]

- [ ] stories_total == count of stories in PLAN.md
- [ ] stories_with_artifacts counts only stories with >= 1 tagged artifact
- [ ] stories_with_evidence counts only stories with >= 1 evidence-type artifact
- [ ] Output written to reconciliation.json coverage block

## Story: Detect gaps [ID=EO-02-002]

- [ ] Missing implementation: story with no artifacts -> gap type `missing_implementation`
- [ ] Missing evidence: story with artifacts but no evidence-type file -> gap type `missing_evidence`
- [ ] Orphan tag: artifact tagged to story ID not in PLAN.md -> gap type `orphan_story_tag`

## Story: Compute consistency score [ID=EO-02-003]

- [ ] Score is 1.0 when STATUS declares no progress or all declared stories have artifacts
- [ ] Score decreases proportionally when declared progress >= 20% but no artifacts exist
- [ ] Score is 0..1 float, never negative

---

## Story: Implement MTI formula [ID=EO-03-001]

- [ ] MTI computation follows `src/lib/trust.js` canonical logic (adaptive 3/4/5-component model)
- [ ] 3-component fallback remains: `(coverage * 0.5) + (evidence_completeness * 0.2) + (consistency * 0.3) * 100`
- [ ] Score is 0-100 integer
- [ ] Component breakdown is included in trust.json

## Story: Map score to allowed actions [ID=EO-03-002]

- [ ] Score >= 90 -> actions include "deploy"
- [ ] Score 70-89 -> actions include "merge-with-approval"
- [ ] Score 50-69 -> actions include "review-required"
- [ ] Score < 50 -> actions include "block"

---

## Story: Generate Epic/Feature/Story hierarchy CSV [ID=EO-04-001]

- [ ] CSV has header row: Work Item Type, Title, Parent, Description, Acceptance Criteria, Tags
- [ ] One Epic row (project title)
- [ ] One Feature row per PLAN.md feature
- [ ] One User Story row per PLAN.md story
- [ ] Parent column correctly references feature title
- [ ] Acceptance criteria from ACCEPTANCE.md is embedded in the story row

## Story: Annotate stories with gap tags [ID=EO-04-002]

- [ ] If reconciliation.json is present, stories with gaps get `gap:<type>` tag
- [ ] If reconciliation.json is absent, stories are generated without gap tags

---

## Story: Implement discover command [ID=EO-05-001]

- [ ] `eva discover --repo X` writes `.eva/discovery.json` in repo X
- [ ] `--out` flag overrides output path
- [ ] Console confirms output path on success

## Story: Implement reconcile command [ID=EO-05-002]

- [ ] `eva reconcile --repo X` reads discovery.json, writes reconciliation.json
- [ ] Error if discovery.json is missing

## Story: Implement compute-trust command [ID=EO-05-003]

- [ ] Reads reconciliation.json, writes trust.json
- [ ] Error if reconciliation.json is missing

## Story: Implement generate-ado command [ID=EO-05-004]

- [ ] Reads discovery.json (required) and reconciliation.json (optional)
- [ ] Writes ado.csv

## Story: Implement report command [ID=EO-05-005]

- [ ] Prints report to console without crashing if any input file is missing
- [ ] Missing inputs produce "(missing) run: eva <command>" suggestions

---

## Story: Human-readable console report [ID=EO-06-001]

- [ ] Report shows: epic title, feature count, story count
- [ ] Coverage table: stories_total, with_artifacts, with_evidence, consistency_score
- [ ] Gaps listed with type and story_id
- [ ] Trust score and allowed actions printed
- [ ] Report is fully ASCII (no emoji in machine output)

## Story: Evidence-ready .eva/ folder output [ID=EO-06-002]

- [x] All JSON outputs include `meta.schema`, `meta.generated_at`, `meta.repo`
- [x] Output directory (.eva/) is created if it does not exist
- [x] Files are UTF-8 with 2-space JSON indent

---

# Phase 2 Acceptance Criteria

## Story: Implement MCP server entrypoint [ID=EO-07-001]

- [ ] `eva mcp-server [--port <n>]` starts an HTTP server (default port 8030)
- [ ] `GET /tools` returns JSON tool manifest (name, description, inputSchema per tool)
- [ ] `POST /tools/{name}` invokes tool and returns `{ result }` or `{ error }`
- [ ] Server logs each invocation with [INFO] timestamp to stdout
- [ ] Graceful shutdown on SIGINT

## Story: Implement audit_repo MCP tool [ID=EO-07-002]

- [ ] Accepts `{ repo_path }` input
- [ ] Returns `{ gaps[], coverage{}, trust_score, actions[] }` in a single call
- [ ] Does not write any files to disk in MCP mode
- [ ] Returns structured error if repo_path does not exist

## Story: Implement get_trust_score MCP tool [ID=EO-07-003]

- [ ] Accepts `{ repo_path }` input
- [ ] Returns `{ score, components{}, actions[] }`
- [ ] Score is 0-100 integer

## Story: Implement get_coverage MCP tool [ID=EO-07-004]

- [ ] Returns `{ stories_total, stories_with_artifacts, stories_with_evidence, consistency_score }`
- [ ] All values are numeric (not null)

## Story: Implement generate_ado_items MCP tool [ID=EO-07-005]

- [ ] Returns array of `{ work_item_type, title, parent, description, acceptance_criteria, tags }`
- [ ] Gap annotation present when `include_gaps: true`

## Story: Implement scan_portfolio MCP tool [ID=EO-07-006]

- [ ] Accepts `{ portfolio_root, project_filter? }` input
- [ ] Returns `{ projects: [{ id, name, trust_score, gap_count }], portfolio_mti }`
- [ ] Tolerates projects with no PLAN.md (returns trust_score: 0, note: "no-plan")

## Story: Add /model/admin/audit-repo endpoint to 37-data-model [ID=EO-08-001]

- [ ] Endpoint registered in model as `POST /model/admin/audit-repo`
- [ ] Calls eva-veritas MCP `audit_repo` tool with project path derived from project_id
- [ ] Returns HTTP 200 with audit response body
- [ ] Returns HTTP 422 if project_id not found in registry

## Story: Add gap-to-PBI pipeline command [ID=EO-09-001]

- [ ] `eva generate-ado --gaps-only` flag filters output to gap stories only
- [ ] Resulting CSV is importable to ADO without modification
- [ ] Tag column includes `gap:<type>` for each affected story

## Story: Add eva-veritas MCP server to 29-foundry [ID=EO-10-001]

- [ ] `29-foundry/mcp-servers/eva-veritas/index.js` starts the MCP server
- [ ] Entry registered in `29-foundry/skill-catalog.json` with all exported tool names (currently 7)
- [ ] README in that folder explains how to start + test the server
