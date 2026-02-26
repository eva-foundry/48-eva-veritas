# EVA Evidence Convention

**Version:** 1.0  
**Last Updated:** February 24, 2026  
**Governs:** How EVA-STORY and EVA-FEATURE tags are written in source files, and what counts as evidence.

---

## 1. Why This Exists

`eva-veritas` derives MTI from three signals:

| Signal | Weight | Source |
|--------|--------|--------|
| Coverage | 0.5 | Source files tagged with EVA-STORY |
| Evidence | 0.2 | Files in `evidence/` or classified as type `evidence` |
| Consistency | 0.3 | PLAN.md "Done" stories that have artifacts |

Without a shared tagging convention, coverage and evidence scores are meaningless.  
This document is the single source of truth for all three conventions.

---

## 2. Implementation Tags (Coverage)

### 2.1 Placement

Tags go in **source files only** (`.js`, `.ts`, `.py`, `.ps1`, `.cs`, `.java`).  
Do **not** place tags in `.md` files — those are the "planned" layer.

```js
// EVA-STORY: EO-05-007
// EVA-FEATURE: EO-05
```

```python
# EVA-STORY: EO-05-007
# EVA-FEATURE: EO-05
```

### 2.2 Syntax Rules

| Rule | Correct | Wrong |
|------|---------|-------|
| Prefix | `EVA-STORY:` (colon, then ID) | `EVA-STORY =` / `@EVA-STORY` |
| ID format | `AA-BB-NNN` (feature group, feature, story number) | `RT-01`, `ABC-123` (test placeholders) |
| One tag per declaration | One `// EVA-STORY: EO-05-007` per line | Multiple IDs on one line |
| File location | Top of file, after shebang/strict | Inline in function bodies |
| Case | Uppercase ID | Lowercase |

### 2.3 What Gets Tagged

- **Feature file** (the main module delivering a feature): tag all story IDs the file implements  
- **Utility/shared library**: tag the story that introduced it  
- **Test file**: tag the story it tests (same ID)  
- **Config/infra file**: tag the story it enables  

---

## 3. Evidence Files (Evidence Score)

The `evidence/` directory at the repo root holds proof that stories were delivered.

### 3.1 What Counts as Evidence

| File type | Example | Description |
|-----------|---------|-------------|
| CI test result | `evidence/test-run-EO-05-007-20260224.txt` | Captured stdout of a passing test run |
| Screenshot/recording | `evidence/EO-05-007-audit-screenshot.png` | Visual proof of feature working |
| Signed-off checklist | `evidence/EO-05-007-acceptance.md` | Completed ACCEPTANCE.md criteria |
| Log export | `evidence/EO-05-007-ci-log.json` | CI/CD pipeline log attached to a story |

### 3.2 Evidence File Naming Convention

```
evidence/<STORY-ID>-<description>.<ext>
```

Examples:
```
evidence/EO-05-007-audit-self-test.txt
evidence/EO-05-006-portfolio-scan.txt
evidence/EO-09-001-gaps-only-output.md
```

### 3.3 Linking Evidence to Stories

Name the file with the story ID **at the start**. `eva-veritas` classifies any file under `evidence/` as type `evidence` and associates it to the story ID in its filename prefix.

---

## 4. PLAN.md Heading Conventions

### 4.1 Standard Format (preferred)

```markdown
## Feature: <Title> [ID=EO-05]

### Story: <Title> [ID=EO-05-007]
```

### 4.2 Loose Format (supported fallback)

Any heading at level 2 or 3 containing an inline `[ID=XX-YY]` or `[ID=XX-YY-NNN]` tag is also parsed:

```markdown
## EO-05: Combined Commands [ID=EO-05]

### EO-05-007 Audit command [ID=EO-05-007]
```

### 4.3 Avoid These Patterns

- Headings with no `[ID=...]` tag — they produce zero planned stories
- Story IDs that don't match `\w+-\d+-\d+` (e.g. `ABC-123`, `RT-01-001`) — they become orphans

---

## 5. Orphan Tags

An **orphan** is an EVA-STORY tag in a source file that references an ID not declared in PLAN.md.

Orphans appear as `[FAIL] orphan_implementation :: <ID>` in every audit and pollute the gap report.

**How to fix an orphan:**
1. The story exists in PLAN.md but is spelled differently → fix the typo
2. The story was removed from PLAN.md → remove the tag from the source file
3. The story is new and PLAN.md is stale → add the story to PLAN.md

---

## 6. MTI Interpretation

| MTI Range | Verdict | Meaning |
|-----------|---------|---------|
| `null` | `ungoverned` | No stories in PLAN.md — add governance |
| 0–44 | `block` | Critical gaps — do not deploy |
| 45–59 | `review-required` | Significant gaps — review before deploy |
| 60–74 | `review-required` | Phase 1 complete; Phase 2 gaps remain |
| 75–89 | `conditional-deploy` | Minor gaps — document and proceed |
| 90–100 | `deploy` | Evidence complete — approved to ship |

A fresh project with zero evidence files has a theoretical max of ~65 (coverage×0.5 + consistency×0.3).  
To break 75, you must add evidence files. To hit 90+, evidence must cover > 90% of stories.

---

## 7. Quick Reference

```bash
# Tag a JS file correctly
# EVA-STORY: EO-05-007
# EVA-FEATURE: EO-05

# Add evidence
cp test-output.txt evidence/EO-05-007-test-run.txt

# Run audit to see score update
node C:\AICOE\eva-foundation\48-eva-veritas\src\cli.js audit --repo .
```
