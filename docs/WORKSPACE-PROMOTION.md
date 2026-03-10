# EVA Veritas MCP Tools - Workspace-Level Promotion

**Date**: 2026-03-09 (Session 42)  
**Status**: ✅ COMPLETE  
**Scope**: Workspace-wide availability for all 57 EVA Foundry projects

---

## What Was Promoted

Four core MCP tools from Project 48 are now **workspace-level primitives**:

| Tool | Purpose | Primary Consumer |
|------|---------|------------------|
| **audit_repo** | Full MTI audit with gap analysis | `@scrum-master` sprint advance gates |
| **get_trust_score** | Quick MTI score for single repo | Progress reports, velocity dashboards |
| **dependency_audit** | Cross-project dependency check | Epic readiness, milestone planning |
| **scan_portfolio** | Multi-repo MTI scan with ranking | Workspace health reports, portfolio dashboards |

**Not Promoted** (remain project-scoped):
- `get_coverage` - Project 48 internal diagnostic
- `generate_ado_items` - Project 48 internal pipeline
- `model_audit` - Project 37 Data Model specific

---

## Integration Points

### Workspace Copilot Instructions
**File**: `C:\AICOE\.github\copilot-instructions.md`
- Added new section: "Workspace-Level MCP Tools (Project 48: EVA Veritas)"
- Documents all 4 promoted tools with use cases
- Includes adaptive MTI formula reference
- Links to GitHub Actions integration guide

### Scrum Master Skill
**File**: `C:\AICOE\.github\copilot-skills\scrum-master.skill.md`
- Added MCP integration note in PURPOSE section
- All scrum sub-skills (sprint-advance, progress-report, gap-report, sprint-report) can now leverage tools
- Direct reference to workspace copilot-instructions for tool details

### Veritas Expert Skill
**File**: `C:\AICOE\.github\copilot-skills\veritas-expert.skill.md`
- Added "MCP TOOLS AVAILABLE" section
- Documents all 4 workspace-level tools
- Updated MTI formula to reference canonical adaptive model
- Notes CLI equivalents available via `eva <command>`

### Project 48 Instructions
**File**: `48-eva-veritas/.github/copilot-instructions.md`
- Added "Workspace-Level Status" subsection in PART 2
- Documents promotion status and cross-references workspace instructions
- Listed 4 promoted tools and their workspace skill consumers

---

## Usage Examples

### Sprint Advance Gate (Scrum Master)
```bash
# Before closing sprint, verify MTI threshold
eva audit --repo . --threshold 70
# Or via MCP (if server running on port 8030):
# POST http://localhost:8030/tools/audit_repo
# { "repo_path": "/path/to/project" }
```

### Progress Report (Scrum Master)
```bash
# Quick MTI snapshot for dashboard
eva trust-score --repo .
# Or via MCP:
# POST http://localhost:8030/tools/get_trust_score
# { "repo_path": "/path/to/project" }
```

### Epic Readiness Check (Scrum Master)
```bash
# Validate cross-project dependencies before milestone
eva dependency-audit --repo . --check-external
# Or via MCP:
# POST http://localhost:8030/tools/dependency_audit
# { "repo_path": "/path/to/project" }
```

### Workspace Health Report (Workflow Forensics)
```bash
# Scan all 57 projects for MTI ranking
eva scan-portfolio --root C:\AICOE\eva-foundry --min-mti 60
# Or via MCP:
# POST http://localhost:8030/tools/scan_portfolio
# { "portfolio_root": "C:\\AICOE\\eva-foundry" }
```

---

## Verification

Run these checks to verify workspace integration:

```powershell
# 1. Verify workspace instructions have MCP section
Select-String -Path "C:\AICOE\.github\copilot-instructions.md" -Pattern "Workspace-Level MCP Tools"

# 2. Verify scrum-master references MCP integration
Select-String -Path "C:\AICOE\.github\copilot-skills\scrum-master.skill.md" -Pattern "MCP Integration"

# 3. Verify veritas-expert has tool inventory
Select-String -Path "C:\AICOE\.github\copilot-skills\veritas-expert.skill.md" -Pattern "MCP TOOLS AVAILABLE"

# 4. Verify Project 48 notes promotion
Select-String -Path "C:\AICOE\eva-foundry\48-eva-veritas\.github\copilot-instructions.md" -Pattern "PROMOTION"

# All 4 should return matches ✅
```

---

## Benefits

### For Scrum Master Skill
- ✅ **Sprint advance gates** now have deterministic MTI enforcement via `audit_repo`
- ✅ **Progress reports** include real-time MTI scores via `get_trust_score`
- ✅ **Epic planning** can validate cross-project readiness via `dependency_audit`
- ✅ **Velocity dashboards** show portfolio-wide health via `scan_portfolio`

### For All Workspace Skills
- ✅ **Standardized quality gates** across all 57 projects
- ✅ **Evidence-based decision making** (not vibes)
- ✅ **Automated traceability** for compliance/audits
- ✅ **Cross-project visibility** for dependency management

### For EVA Foundry Governance
- ✅ **Single source of truth** for MTI scoring methodology
- ✅ **Consistent enforcement** of quality thresholds
- ✅ **Automated gap analysis** for all projects
- ✅ **GitHub Actions ready** for CI/CD integration

---

## Next Steps

1. **Document in Session 42**: Update `48-eva-veritas/STATUS.md` with promotion completion
2. **Update workspace memory**: Add promotion note to workspace-level memory files
3. **Test integration**: Run scrum-master with `@scrum-master progress report` to verify MCP access
4. **CI/CD rollout**: Add veritas gates to other EVA projects using patterns from `docs/GITHUB-ACTIONS.md`

---

## References

- **Workspace Instructions**: `C:\AICOE\.github\copilot-instructions.md` § "Workspace-Level MCP Tools"
- **Scrum Master Skill**: `C:\AICOE\.github\copilot-skills\scrum-master.skill.md`
- **Veritas Expert Skill**: `C:\AICOE\.github\copilot-skills\veritas-expert.skill.md`
- **Project 48 README**: `48-eva-veritas/README.md` § "MCP Server (Phase 2)"
- **GitHub Actions Guide**: `48-eva-veritas/docs/GITHUB-ACTIONS.md`
- **MTI Implementation**: `48-eva-veritas/src/lib/trust.js` (canonical adaptive formula)

---

*This promotion follows the EVA principle: "Build once, govern everywhere."*
