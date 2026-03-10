# Veritas v2 Vision: Paperless WBS Auto-Discovery

**Date**: 2026-03-09  
**Context**: Session 41 Part 11 - Project 37 MTI Discussion  
**Status**: PROPOSAL - Not Yet Implemented

## Problem Statement

**Current State** (Veritas v1):
- ✅ Discovers WBS from PLAN.md/veritas-plan.json (manual maintenance)
- ✅ Scans repos for artifacts/evidence
- ✅ Reconciles planned vs actual
- ✅ Computes MTI (Minimum Traceability Index) score
- ❌ Writes only to local .eva/*.json files
- ❌ Doesn't save to EVA Data Model
- ❌ No per-story visibility (bulk operations)
- ❌ Projects must manually maintain PLAN.md

**Architectural Gap**: Veritas discovers WBS but doesn't persist to the data model (L48-L51), forcing manual documentation maintenance and preventing true paperless governance.

## Vision: Paperless WBS Auto-Discovery

**Target State** (Veritas v2):
- ✅ Auto-discovers WBS by analyzing repo structure
- ✅ Saves WBS + evidence to EVA Data Model (L48-L51)
- ✅ Queries model as single source of truth
- ✅ Fractal DPDCA: DISCOVER/PLAN/DO/CHECK/ACT per-story with progress output
- ✅ Projects go paperless - PLAN.md becomes optional
- ✅ Real-time traceability via live model queries
- ✅ Cross-project portfolio analytics

## Architecture Changes

### Data Model Integration

**Layers Involved**:
- **L48 (work-packages)**: Epics discovered from README, project.yaml
- **L49 (user-stories)**: Stories discovered from code tags, commits, PRs
- **L50 (tasks)**: Task-level granularity from evidence mining
- **L51 (evidence)**: Artifacts, commits, PRs, test results

**Write Operations**:
```javascript
// After discovery phase
POST /model/user-stories (bulk save discovered stories)
POST /model/evidence (link artifacts to stories)
POST /model/work-packages (save features/epics)
```

**Read Operations**:
```javascript
// Replace local .eva/*.json reads
GET /model/user-stories?repo=37-data-model&status=done
GET /model/evidence?story_id=F37-13-001
GET /model/work-packages?project=37-data-model
```

### Fractal DPDCA Implementation

**Current** (Bulk Operation):
```javascript
// Scans 1000+ files, no progress visibility
const artifacts = await scanRepo(repoPath);
// Returns all or nothing
```

**Target** (Per-Story Visibility):
```javascript
// DISCOVER phase
console.log(`[DISCOVER] Scanning ${storyCount} planned stories...`);
for (const story of stories) {
  console.log(`  [${idx}/${storyCount}] ${story.id}: Searching artifacts...`);
  const artifacts = await discoverStoryArtifacts(story);
  console.log(`    ✅ Found ${artifacts.length} artifacts`);
  
  // PLAN: Decide what evidence is needed
  const requiredEvidence = planEvidenceCollection(story);
  
  // DO: Collect evidence
  const evidence = await collectEvidence(story, artifacts);
  
  // CHECK: Verify completeness
  const gaps = checkEvidence(story, evidence, requiredEvidence);
  
  // ACT: Save to model
  await saveToModel(story, artifacts, evidence);
  console.log(`    ✅ Saved to data model (MTI: ${story.mti})`);
}
```

### Enhanced Discovery Engine

**Code Pattern Detection**:
```javascript
// Beyond simple EVA-STORY tags
- Analyze git commit patterns (co-authorship, story clustering)
- Detect implicit stories from test files (test_xxx.py → infer story)
- Mine PR descriptions for feature narratives
- Analyze code complexity to infer story size
- Detect dependencies between stories via import graphs
```

**Evidence Mining**:
```javascript
// Multi-source evidence collection
- Git commits (author, date, files changed, story tags in messages)
- PR metadata (reviewers, approvals, merge status, story references)
- Test results (coverage, pass/fail, story-tagged test cases)
- Deployment artifacts (Docker tags, pipeline runs, prod timestamps)
- Documentation (README updates, API docs generated)
```

## Benefits

### For Project Teams
- **No manual PLAN.md maintenance** - live from model queries
- **Real-time MTI scores** - updated on every commit
- **Automated gap detection** - CI/CD fails if stories missing evidence
- **Cross-project queries** - "Show all stories blocked on L48 completion"

### For Portfolio Management
- **Live portfolio dashboard** - all projects, all stories, all evidence
- **Velocity analytics** - stories per sprint, cycle time, blocked stories
- **Risk detection** - projects with low MTI, missing evidence patterns
- **Resource allocation** - which features need more investment

### For Compliance/Audit
- **Immutable evidence trail** - all stored in data model with timestamps
- **Traceability reports** - requirements → stories → code → tests → deployment
- **Regulatory compliance** - automated controls for FDA, SOC2, ISO27001
- **Patent filing support** - evidence bundles for invention disclosures

## Implementation Strategy

### Phase 1: Write Path (2-3 sprints)
1. **Story**: Save discovered WBS to L48-L50 after audit
2. **Story**: Save evidence to L51 with story linkages
3. **Story**: Implement fractal DPDCA with per-story progress
4. **Story**: Add retry logic for model writes (resilience)

### Phase 2: Read Path (1-2 sprints)
1. **Story**: Query model for planned stories (replace PLAN.md parsing)
2. **Story**: Query model for evidence (replace .eva/*.json reads)
3. **Story**: Implement caching layer (performance)
4. **Story**: Support hybrid mode (model + local fallback)

### Phase 3: Enhanced Discovery (2-3 sprints)
1. **Story**: Commit pattern analysis (co-authorship, clustering)
2. **Story**: Implicit story detection (test files, PR patterns)
3. **Story**: Dependency graph analysis (import maps)
4. **Story**: Complexity-based story sizing

### Phase 4: Portfolio Analytics (1-2 sprints)
1. **Story**: Cross-project dashboard
2. **Story**: Velocity & cycle time metrics
3. **Story**: Risk & gap analytics
4. **Story**: Regulatory compliance reports

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Model downtime** | Veritas can't read/write | Hybrid mode: fallback to local .eva/ files |
| **Write conflicts** | Multiple repos writing simultaneously | Optimistic locking, retry with backoff |
| **Discovery errors** | False positives/negatives in story detection | Manual override UI, confidence scoring |
| **Performance** | 1000+ files scan takes too long | Incremental scans, caching, parallel processing |

## Success Metrics

- **v1 → v2 Migration**: 10 projects migrated to paperless mode
- **PLAN.md Reduction**: 80% of projects no longer maintain PLAN.md
- **MTI Accuracy**: 95% of stories correctly linked to evidence
- **Query Performance**: <500ms for portfolio dashboard queries
- **Developer Adoption**: 90% of commits include story tags

## Related Work

- **Project 37**: Execution engine (L52-L75) provides self-healing infrastructure
- **Project 48**: Veritas v1 (current) provides foundation
- **Project 49**: MTI framework (methodology)
- **Project 50**: EVA Ops (CI/CD integration points)

## Next Steps

1. **User Review**: Validate vision with stakeholders (Marco)
2. **Spike**: Prototype write path (save 1 story to model)
3. **Planning**: Break into features/stories for Project 48 PLAN.md
4. **Prioritization**: Sequence phases based on business value

---

**Note**: This document captures the strategic direction discussed during Session 41 Part 11 (Project 37 veritas audit failure). The MTI score of 1 on PR #53 revealed that veritas v1 cannot link implementation to plan when EVA-STORY tags are absent. Rather than retrofit tags, the decision was to build veritas v2 to auto-discover everything, enabling paperless governance.
