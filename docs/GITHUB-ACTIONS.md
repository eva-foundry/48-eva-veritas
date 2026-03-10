# GITHUB-ACTIONS.md -- eva-veritas CI/CD Integration

## Purpose

This guide documents recommended ways to run eva-veritas in GitHub Actions for pull-request quality gates and portfolio governance checks.

## Current Repository Workflow

Primary workflow: `.github/workflows/veritas-gate.yml`

It currently uses CLI mode:

```yaml
- name: Run veritas audit
  run: node src/cli.js audit --repo . --threshold 70
```

Why this is the default:
- Fewer moving parts (no background server process).
- Clear non-zero exit behavior for branch protection.
- Produces `.eva/` artifacts that are uploaded for review.

## MCP Mode in GitHub Actions

Use MCP mode when your workflow orchestrates multiple repositories or wants a stable tool-contract (`/tools` + JSON schema).

Example:

```bash
node src/mcp-server.js --port 8030 &
SERVER_PID=$!

curl -s -X POST http://localhost:8030/tools/get_trust_score \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"'"$PWD"'"}'

kill $SERVER_PID
```

## Available MCP Tools (Current)

- `audit_repo`
- `get_trust_score`
- `get_coverage`
- `generate_ado_items`
- `scan_portfolio`
- `model_audit`
- `dependency_audit`

## Recommendation

- Use CLI mode for single-repo branch gating.
- Use MCP mode for orchestration jobs across repos/services.
- Keep the MTI threshold explicit in workflow commands (for example, `--threshold 70`).
