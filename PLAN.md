# Project Plan

<!-- veritas-normalized 2026-02-25 prefix=F48 source=PLAN.md -->

## Feature: Discovery Engine [ID=EO-01]

### Story: Parse planned model from governance docs [ID=EO-01-001]

### Story: Scan repo for actual artifacts [ID=EO-01-002]

### Story: Map artifacts to stories via EVA-STORY tags [ID=EO-01-003]

### Story: Support .tsx and .jsx files as taggable code artifacts [ID=EO-01-004]

## Feature: Reconciliation Engine [ID=EO-02]

### Story: Compute coverage metrics [ID=EO-02-001]

### Story: Detect gaps [ID=EO-02-002]

### Story: Compute consistency score [ID=EO-02-003]

## Feature: Trust Scoring (MTI) [ID=EO-03]

### Story: Implement MTI formula [ID=EO-03-001]

### Story: Map score to allowed actions [ID=EO-03-002]

## Feature: ADO Export [ID=EO-04]

### Story: Generate Epic/Feature/Story hierarchy CSV [ID=EO-04-001]

### Story: Annotate stories with gap tags [ID=EO-04-002]

## Feature: CLI Interface [ID=EO-05]

### Story: Implement discover command [ID=EO-05-001]

### Story: Implement reconcile command [ID=EO-05-002]

### Story: Implement compute-trust command [ID=EO-05-003]

### Story: Implement generate-ado command [ID=EO-05-004]

### Story: Implement report command [ID=EO-05-005]

### Story: Implement audit command [ID=EO-05-007]

### Story: Implement scan-portfolio command [ID=EO-05-006]

### Story: Implement init command[IMPL] [ID=EO-05-008]

## Feature: Reporting [ID=EO-06]

### Story: Human-readable console report [ID=EO-06-001]

### Story: Evidence-ready .eva/ folder output [ID=EO-06-002]

## Feature: MCP Server [ID=EO-07]

### Story: Implement MCP server entrypoint[IMPL] [ID=EO-07-001]

### Story: Implement audit_repo MCP tool[IMPL] [ID=EO-07-002]

### Story: Implement get_trust_score MCP tool[IMPL] [ID=EO-07-003]

### Story: Implement get_coverage MCP tool[IMPL] [ID=EO-07-004]

### Story: Implement generate_ado_items MCP tool[IMPL] [ID=EO-07-005]

### Story: Implement scan_portfolio MCP tool[IMPL] [ID=EO-07-006]

## Feature: 37-data-model Integration [ID=EO-08]

### Story: Add /model/admin/audit-repo endpoint to 37-data-model [ID=EO-08-001]

### Story: Document model integrity check pattern [ID=EO-08-002]

## Feature: 38-ado-poc Integration [ID=EO-09]

### Story: Add gap-to-PBI pipeline command [ID=EO-09-001]

### Story: Document 38-ado-poc integration pattern [ID=EO-09-002]

### Story: Import OpenAPI spec as plan source[IMPL] [ID=EO-09-003]

### Story: Parse ADO export CSV as plan source[IMPL] [ID=EO-09-004]

## Feature: 29-foundry Hosting [ID=EO-10]

### Story: Add eva-veritas MCP server to 29-foundry mcp-servers/ [ID=EO-10-001]

### Story: Add eva-veritas skill to 29-foundry copilot-skills/ [ID=EO-10-002]

## Feature: generate-plan Command [ID=EO-11]

### Story: Implement infer-plan.js heuristic parser [ID=EO-11-001]

### Story: Implement generate-plan CLI command [ID=EO-11-002]

### Story: Update discover.js to prefer veritas-plan.json [ID=EO-11-003]

### Story: Document generate-plan in README.md [ID=EO-11-004]

## Feature: Model Fidelity Audit [ID=EO-12]

### Story: Implement model-audit command[IMPL] [ID=EO-12-001]

## Feature: Portfolio Bootstrap + WBS Pipeline [ID=EO-13]

### Story: Strip UTF-8 BOM from cli.js src files for Node v24 compatibility [ID=EO-13-001]

### Story: Normalize all PLAN.md files to veritas-native prefix format [ID=EO-13-002]

### Story: Inject EVA-STORY tags into source files across all projects [ID=EO-13-003]

### Story: Run PDCA sweep loop on all 49 portfolio projects [ID=EO-13-004]

### Story: Create manifest.yml for pure-docs projects with no source files [ID=EO-13-005]

### Story: Create stub PLAN.md for empty projects [ID=EO-13-006]

### Story: Import full WBS hierarchy -- program, streams, projects, features, stories [ID=EO-13-007]

### Story: Link all endpoints and screens to WBS story IDs [ID=EO-13-008]

### Story: Write full-bootstrap.ps1 master replay script [ID=EO-13-009]

### Story: ADO sprint seeding from WBS features and stories [ID=EO-13-010]

## Feature: CHAT API [ID=F48-CHAT]

### Story: GET /v1/chat/history [ID=F48-CHAT-001]

### Story: POST /v1/chat/message [ID=F48-CHAT-002]

### Story: DELETE /v1/chat/{id} [ID=F48-CHAT-003]

## Feature: USERS API [ID=F48-USERS]

### Story: GET /users [ID=F48-USERS-001]

### Story: POST /users [ID=F48-USERS-002]

### Story: DELETE /users/:id [ID=F48-USERS-003]

## Feature: CONVERSATION API [ID=F48-CONVERSATION]

### Story: GET /v1/conversations [ID=F48-CONVERSATION-001]

## Feature: OTHER API [ID=F48-OTHER]

### Story: GET /v1/other [ID=F48-OTHER-001]

## Feature: PING API [ID=F48-PING]

### Story: GET /v1/ping [ID=F48-PING-001]

## Feature: PATH API [ID=F48-PATH]

### Story: GET /path [ID=F48-PATH-001]

### Story: POST /path [ID=F48-PATH-002]

### Story: GET /path [ID=F48-PATH-003]

### Story: GET /path [ID=F48-PATH-004]
