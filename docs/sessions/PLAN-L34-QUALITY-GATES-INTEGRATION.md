# PLAN: L34 Quality Gates Integration (Fractal DPDCA)

**Status**: 📋 PLAN Phase (Pre-Implementation)  
**Date**: 2026-03-09  
**Context**: Session 42 paperless governance complete; L34 is next layer to integrate  
**Pattern**: Nested DPDCA at Session → Component → Operation levels

---

## Session-Level DPDCA Context

### DISCOVER (from Session 42 completion)
**Current State**:
- ✅ API-first governance mode operational (data model = primary source)
- ✅ MTI computed via adaptive 3/4/5-component formula (src/lib/trust.js)
- ✅ Audit write-back writes MTI to L34 (project_work layer) — one-way only
- ❌ **Gap**: Quality gate thresholds not yet queried from L34
- ❌ **Gap**: Gate-driven MTI weighting not implemented
- ❌ **Gap**: Gate evaluation not recorded in verification_records

**Data Model Readiness**:
- ✅ `getQualityGates()` already implemented in data-model-client.js
- ✅ L34 schema known (accepts query by project_id)
- ✅ writeVerificationRecord() ready to capture gate evaluation
- ✅ L45 (verification_records) ready to store gate results

### PLAN Objective
**One unified goal with 3 component outcomes**:

**Goal**: Make MTI threshold **data-driven and dynamic** per project, sourced from L34 quality_gates.

**Expected Deltas**:
1. ✅ audit.js: query L34 gates before computing MTI (5 lines)
2. ✅ compute-trust.js: incorporate gate threshold into weighting (10-15 lines)
3. ✅ audit.js: write gate evaluation to L45 (3 lines)
4. ✅ discover.js: display detected quality gates in discovery.json meta (2 lines)
5. ✅ docs: UPDATE trust.js comments to explain gate weighting (5 lines)

**Total Expected Code**: ~25-30 lines of implementation + 10 lines of docs

---

## Component-Level DPDCA (3 Components)

### **COMPONENT 1: Quality Gates Query & Discovery**

#### DISCOVER (current capability)
```javascript
// data-model-client.js already provides:
getQualityGates(projectId, apiBase)
```
Returns: `{ ok: true, data: [...gate records] }`

Shape of returned records (typical):
```json
{
  "id": "gate-001",
  "project_id": "48-eva-veritas",
  "gate_name": "MTI Threshold",
  "threshold": 70,
  "gate_metric": "mti_score",
  "status": "active",
  "applies_to": ["main", "develop"],
  "updated_at": "2026-03-01T..."
}
```

#### PLAN (what needs to happen)
1. **Discover Phase**: Call getQualityGates() after discovery (existing API call happens in discover.js)
2. **Parse Phase**: Extract first active MTI gate OR use default 70 if no gate exists
3. **Store Phase**: Add `quality_gates` field to discovery.json for visibility
4. **Use Phase**: Pass detected threshold to audit pipeline

#### DO (Implementation Strategy)
**File**: `src/discover.js` (around line 140, after actual discovery)
```javascript
// After scanRepo() completes, before returning discovery object
const qualityGatesResult = await getQualityGates(projectId, apiBase);
let detectedGates = [];
let mtiThreshold = 70; // fallback

if (qualityGatesResult.ok && qualityGatesResult.data.length > 0) {
  const mtiGates = qualityGatesResult.data.filter(g => g.gate_metric === 'mti_score' && g.status === 'active');
  if (mtiGates.length > 0) {
    mtiThreshold = mtiGates[0].threshold;
    detectedGates = mtiGates.map(g => ({ id: g.id, threshold: g.threshold, applies_to: g.applies_to }));
  }
}

discovery.quality_gates = {
  detected_count: detectedGates.length,
  gates: detectedGates,
  effective_mti_threshold: mtiThreshold,
  source: "data-model-api",
  query_timestamp: new Date().toISOString()
};
```

#### CHECK (Validation Points)
- [ ] getQualityGates() returns gates without error
- [ ] discovery.json contains `quality_gates` section
- [ ] `effective_mti_threshold` correctly extracted (or defaults to 70)
- [ ] gates array matches returned L34 records

#### ACT (Artifact Updates)
- Add gate query to discover.js
- Update discovery.json schema in docs
- Document gate detection in README/ACCEPTANCE

---

### **COMPONENT 2: Gate-Driven MTI Weighting**

#### DISCOVER (Current Formula)
`src/lib/trust.js` has adaptive formula:
```
3-component: Coverage*0.50 + Evidence*0.20 + Consistency*0.30
5-component: Coverage*0.35 + Evidence*0.20 + Consistency*0.25 + Complexity*0.10 + FieldPopulation*0.10
```

**Current Behavior**: Formula is static (same for all projects), threshold is hardcoded in CLI.

#### PLAN (Desired Behavior)
**Gate-Driven Adjustments** (per-project, fetched from L34):

1. **Threshold**: Each project specifies its own MTI threshold (e.g., 70, 75, 80)
2. **Weighting Adjustment**: If project has gate with special weight modifiers:
   - E.g., gate specifies: `"weights": { "coverage": 0.6, "evidence": 0.25, "consistency": 0.15 }`
   - Use gate-specified weights instead of static 3/5-component
3. **Ceiling/Floor**: Gate can specify min/max score bounds
   - E.g., "minimum_allowed_mti": 50 (don't go below even if calc is lower)
   - E.g., "maximum_allowed_mti": 95 (cap at this even if calc is higher)

#### DO (Implementation Strategy)

**File**: `src/audit.js` (around line 80-90, before calling computeTrust)

```javascript
// Before: await computeTrust(opts);

// NEW: Fetch quality gates and apply weighting overrides
const { getQualityGates } = require('./lib/data-model-client');
const repoPath = path.resolve(opts.repo || process.cwd());
const projectId = path.basename(repoPath);

let trustOpts = { ...opts };
let activeGate = null;

try {
  const gatesRes = await getQualityGates(projectId, opts.apiBase);
  if (gatesRes.ok && gatesRes.data.length > 0) {
    activeGate = gatesRes.data.find(g => g.status === 'active' && g.gate_metric === 'mti_score');
    
    if (activeGate) {
      // Apply gate-specified weights if available
      if (activeGate.custom_weights) {
        trustOpts.weights = activeGate.custom_weights;
        console.log(`[GATE] Applying custom weights from L34: ${JSON.stringify(activeGate.custom_weights)}`);
      }
      // Apply bounds if specified
      if (activeGate.minimum_allowed_mti) {
        trustOpts.scoreFloor = activeGate.minimum_allowed_mti;
      }
      if (activeGate.maximum_allowed_mti) {
        trustOpts.scoreCeiling = activeGate.maximum_allowed_mti;
      }
    }
  }
} catch (e) {
  console.log(`[WARN] Failed to fetch quality gates: ${e.message} (using defaults)`);
}

// Then call with gate-aware options:
await computeTrust(trustOpts);
```

**File**: `src/lib/trust.js` (modify computeTrust function)

```javascript
// Existing: function computeTrust(opts)
// Modify to use opts.weights, opts.scoreFloor, opts.scoreCeiling if provided

function computeTrust(opts) {
  // ... existing discovery, reconciliation load ...
  
  // NEW: Apply custom weights if provided (from L34 gate)
  const weights = opts.weights || { coverage: 0.5, evidence: 0.2, consistency: 0.3 };
  
  // ... existing score calculation using weights ...
  let score = (coverage * weights.coverage) + 
              (evCompleteness * weights.evidence) + 
              (consistency * weights.consistency);
  
  // NEW: Apply bounds
  if (opts.scoreFloor && score < opts.scoreFloor) {
    score = opts.scoreFloor;
    console.log(`[GATE] Score raised to floor: ${opts.scoreFloor}`);
  }
  if (opts.scoreCeiling && score > opts.scoreCeiling) {
    score = opts.scoreCeiling;
    console.log(`[GATE] Score capped to ceiling: ${opts.scoreCeiling}`);
  }
  
  // ... rest of function ...
}
```

#### CHECK (Validation Points)
- [ ] getQualityGates() called before computeTrust()
- [ ] Active gate detected and parsed correctly
- [ ] Custom weights applied if present in gate record
- [ ] Score floor/ceiling enforced in final MTI
- [ ] Logs clearly show gate-driven adjustments
- [ ] Default behavior unchanged if no gate exists

#### ACT (Artifact Updates)
- Update trust.js comments: explain gate weighting logic
- Update ACCEPTANCE.md: document gate weighting feature
- Update README: show example of per-project thresholds

---

### **COMPONENT 3: Gate Evaluation Verification Recording**

#### DISCOVER (Current State)
- ✅ `writeVerificationRecord()` exists in data-model-client.js
- ✅ Writes to L45 (verification_records layer)
- ❌ **Gap**: Not capturing gate evaluation result (pass/fail/warn)
- ❌ **Gap**: No gate_id linkage in verification record

#### PLAN (Desired Behavior)
After MTI is computed and compared to threshold, record gate result:
- **PASS**: MTI >= threshold
- **WARN**: MTI between (threshold - 5) and threshold
- **FAIL**: MTI < (threshold - 5)

Store in L45 along with:
- gate_id (references L34 record)
- threshold used
- effective_score
- adjustment reason (if gate applied custom weights)

#### DO (Implementation Strategy)

**File**: `src/audit.js` (around line 115-125, after writing trust score)

```javascript
// After: await writeTrustScore()
// NEW: Write gate evaluation record

if (activeGate && trustData.score !== undefined) {
  const gateResult = {
    gate_id: activeGate.id,
    gate_name: activeGate.gate_name,
    threshold: activeGate.threshold,
    effective_score: trustData.score,
    evaluation: trustData.score >= activeGate.threshold ? 'PASS' : 
                trustData.score >= (activeGate.threshold - 5) ? 'WARN' : 'FAIL',
    weights_applied: opts.weights ? 'custom' : 'default',
    bounds_applied: {
      floor: opts.scoreFloor || null,
      ceiling: opts.scoreCeiling || null
    },
    metadata: {
      gate_source: 'L34-quality_gates',
      verification_timestamp: new Date().toISOString()
    }
  };

  try {
    const gateVerifyRes = await writeVerificationRecord(
      projectId, 
      { 
        ...trustData,
        gate_evaluation: gateResult 
      }
    );
    if (gateVerifyRes.ok) {
      console.log(`[GATE] Evaluation recorded: ${gateResult.evaluation}`);
    }
  } catch (e) {
    console.log(`[WARN] Failed to record gate evaluation: ${e.message}`);
  }
}
```

#### CHECK (Validation Points)
- [ ] Gate evaluation calculated correctly (PASS/WARN/FAIL)
- [ ] writeVerificationRecord() receives gate_evaluation object
- [ ] L45 record includes gate_id, evaluation result, weights used
- [ ] Evaluation persists to cloud API without errors
- [ ] Fallback works if gate not present (skip gate recording, only MTI recorded)

#### ACT (Artifact Updates)
- Document gate evaluation record schema in verification_records docs
- Add example L45 records showing gate evaluations
- Update STATUS.md with Component 3 completion

---

## Operation-Level DPDCA (Per-Component Breakdown)

### **Component 1 Operations**
| Op ID | Description | File | Approx Lines | Status |
|-------|-------------|------|--------------|--------|
| 1.1 | Import getQualityGates in discover.js | discover.js | 1 | READY |
| 1.2 | Add query call after scanRepo() | discover.js | 8 | READY |
| 1.3 | Parse gates, extract threshold | discover.js | 6 | READY |
| 1.4 | Add quality_gates to discovery.json | discover.js | 3 | READY |
| **Total** | | | **18 lines** | |

### **Component 2 Operations**
| Op ID | Description | File | Approx Lines | Status |
|-------|-------------|------|--------------|--------|
| 2.1 | Import getQualityGates in audit.js | audit.js | 1 | READY |
| 2.2 | Query gates before computeTrust() | audit.js | 12 | READY |
| 2.3 | Modify computeTrust signature for opts.weights | trust.js | 8 | READY |
| 2.4 | Apply floor/ceiling in trust calc | trust.js | 6 | READY |
| 2.5 | Update README with gate weighting explanation | README.md | 8 | READY |
| **Total** | | | **35 lines** | |

### **Component 3 Operations**
| Op ID | Description | File | Approx Lines | Status |
|-------|-------------|------|--------------|--------|
| 3.1 | Calculate gate evaluation (PASS/WARN/FAIL) | audit.js | 5 | READY |
| 3.2 | Construct gate_evaluation record | audit.js | 10 | READY |
| 3.3 | Pass to writeVerificationRecord() | audit.js | 3 | READY |
| 3.4 | Document verification_records schema | docs/ | 15 | READY |
| **Total** | | | **33 lines** | |

---

## Summary: PLAN Phase

### What This Achieves
✅ **Per-Project Governance**: Each project's MTI gate configurable in data model (not hardcoded)  
✅ **Adaptive Thresholds**: Projects can specify 50 (permissive) to 90 (strict)  
✅ **Formula Flexibility**: Org-wide formula stays 3/5-component, but gate can override weights  
✅ **Audit Trail**: Gate evaluation persists for compliance/reporting  
✅ **API-First Governance**: Quality thresholds become queryable, auditable, dynamic  

### Breakdown Summary
- **Components**: 3 (query, weighting, verification)
- **Operations**: 12 (spread across 5 files)
- **Implementation Lines**: ~65-70 lines of code
- **Documentation Lines**: ~30 lines
- **Verification Steps**: 15+ checkpoints

### Next Phase Entry
Ready for **DO Phase**: Implement operations 1.1 → 1.4 → 2.1 → 2.5 → 3.1 → verify
(Sequential per component, with checkpoint after each component)

---

## Success Criteria
- [ ] Component 1: discover.js queries L34, quality_gates in discovery.json
- [ ] Component 2: computeTrust() accepts gate-specified weights, applies bounds
- [ ] Component 3: audit.js records gate evaluation to L45 verification_records
- [ ] All 3 components integrated without breaking existing CLI/MCP behavior
- [ ] Fallback: If no L34 gates exist, system behaves exactly as Session 42 (threshold = 70)
- [ ] Verification: New tests confirm gate weighting applies correctly

---

**PLAN Status**: ✅ COMPLETE — Ready for DO Phase

Next: **exec `DO` phase per-component with fractal visibility**

