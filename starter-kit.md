```text
eva-orchestrator/
  package.json
  README.md
  src/
    cli.js
    discover.js
    reconcile.js
    generate-ado.js
    compute-trust.js
    report.js
    lib/
      parse-docs.js
      scan-repo.js
      map-artifacts.js
      trust.js
      ado-csv.js
      fs-utils.js
      md-utils.js
```

Below is a **Copilot-ready, working Node starter kit** that implements:

* **Top-down discovery**: README / PLAN / STATUS / ACCEPTANCE + docs/
* **Bottom-up discovery**: scan repo tree, classify artifacts, detect story tags
* **Reconciliation**: planned vs actual coverage + gaps
* **ADO CSV generation**
* **MTI-like trust scoring**
* **Human-readable report**

---

## 1) `package.json`

```json
{
  "name": "eva-orchestrator",
  "version": "0.1.0",
  "private": true,
  "description": "EVA Project Orchestrator (planned vs actual discovery, reconciliation, ADO export, trust scoring)",
  "license": "UNLICENSED",
  "type": "commonjs",
  "main": "src/cli.js",
  "bin": {
    "eva": "src/cli.js"
  },
  "scripts": {
    "eva": "node src/cli.js",
    "discover": "node src/cli.js discover",
    "reconcile": "node src/cli.js reconcile",
    "ado": "node src/cli.js generate-ado",
    "trust": "node src/cli.js compute-trust",
    "report": "node src/cli.js report"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "fast-glob": "^3.3.2",
    "js-yaml": "^4.1.0"
  }
}
```

Install:

```bash
npm i
```

---

## 2) `src/cli.js`

```js
#!/usr/bin/env node
const { Command } = require("commander");

const { discover } = require("./discover");
const { reconcile } = require("./reconcile");
const { generateAdo } = require("./generate-ado");
const { computeTrust } = require("./compute-trust");
const { report } = require("./report");

const program = new Command();

program
  .name("eva")
  .description("EVA Project Orchestrator (planned vs actual)")
  .version("0.1.0");

program
  .command("discover")
  .description("Top-down + bottom-up discovery for a repo")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-o, --out <path>", "Output JSON path (default: .eva/discovery.json)")
  .action(async (opts) => {
    await discover(opts);
  });

program
  .command("reconcile")
  .description("Reconcile planned vs actual using discovery.json")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-i, --in <path>", "Input discovery.json (default: .eva/discovery.json)")
  .option("-o, --out <path>", "Output reconciliation.json (default: .eva/reconciliation.json)")
  .action(async (opts) => {
    await reconcile(opts);
  });

program
  .command("generate-ado")
  .description("Generate Azure DevOps CSV from planned model (and optionally reconciliation)")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-d, --discovery <path>", "discovery.json path (default: .eva/discovery.json)")
  .option("-c, --recon <path>", "reconciliation.json path (default: .eva/reconciliation.json)")
  .option("-o, --out <path>", "Output CSV path (default: .eva/ado.csv)")
  .action(async (opts) => {
    await generateAdo(opts);
  });

program
  .command("compute-trust")
  .description("Compute trust score (MTI-like) from reconciliation")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-c, --recon <path>", "reconciliation.json path (default: .eva/reconciliation.json)")
  .option("-o, --out <path>", "Output trust.json (default: .eva/trust.json)")
  .action(async (opts) => {
    await computeTrust(opts);
  });

program
  .command("report")
  .description("Print a human-readable report (planned vs actual)")
  .option("-r, --repo <path>", "Repo path", process.cwd())
  .option("-d, --discovery <path>", "discovery.json path (default: .eva/discovery.json)")
  .option("-c, --recon <path>", "reconciliation.json path (default: .eva/reconciliation.json)")
  .option("-t, --trust <path>", "trust.json path (default: .eva/trust.json)")
  .action(async (opts) => {
    await report(opts);
  });

program.parseAsync(process.argv);
```

---

## 3) `src/lib/fs-utils.js`

```js
const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function rel(repoPath, absPath) {
  return path.relative(repoPath, absPath).replace(/\\/g, "/");
}

module.exports = {
  ensureDir,
  readTextIfExists,
  writeJson,
  readJsonIfExists,
  rel
};
```

---

## 4) `src/lib/md-utils.js`

Simple markdown parsing (headings + checklists + story tags):

```js
function extractHeadings(md) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const headings = [];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) headings.push({ level: m[1].length, text: m[2].trim() });
  }
  return headings;
}

function extractChecklist(md) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    const m = /^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$/.exec(line);
    if (m) items.push({ checked: m[1].toLowerCase() === "x", text: m[2].trim() });
  }
  return items;
}

function extractStoryTags(text) {
  if (!text) return [];
  // Supports:
  // EVA-STORY: ABC-123
  // EVA_STORY=ABC-123
  // [EVA-STORY ABC-123]
  const tags = new Set();
  const patterns = [
    /EVA[-_ ]STORY\s*[:=]\s*([A-Z]+-\d+)/g,
    /\[EVA[-_ ]STORY\s+([A-Z]+-\d+)\]/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) tags.add(m[1]);
  }
  return [...tags];
}

module.exports = {
  extractHeadings,
  extractChecklist,
  extractStoryTags
};
```

---

## 5) `src/lib/parse-docs.js`

This builds the **planned model** from README / PLAN / STATUS / ACCEPTANCE (plus optional `project.yaml`).

```js
const path = require("path");
const yaml = require("js-yaml");
const { readTextIfExists } = require("./fs-utils");
const { extractHeadings, extractChecklist } = require("./md-utils");

function parseProjectYaml(repoPath) {
  const ymlPath = path.join(repoPath, "project.yaml");
  const yml = readTextIfExists(ymlPath);
  if (!yml) return null;
  try {
    return yaml.load(yml);
  } catch (e) {
    return { _error: `Failed parsing project.yaml: ${e.message}` };
  }
}

function parseEpicFromReadme(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "README.md")) || "";
  const headings = extractHeadings(md);
  const title = headings.find((h) => h.level === 1)?.text || path.basename(repoPath);
  return {
    title,
    source: "README.md"
  };
}

/**
 * PLAN.md convention (lightweight, easy for humans):
 *
 * ## Feature: <FEATURE TITLE> [ID=ABC-1]
 * ### Story: <STORY TITLE> [ID=ABC-2]
 *
 * If you omit IDs, orchestrator auto-assigns stable IDs based on ordering.
 */
function parsePlan(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "PLAN.md"));
  if (!md) return { features: [], stories: [], _note: "PLAN.md not found" };

  const headings = extractHeadings(md);

  let featureIndex = 0;
  let storyIndex = 0;

  const features = [];
  const stories = [];

  let currentFeature = null;

  for (const h of headings) {
    const isFeature = h.level === 2 && /^Feature\s*:\s*/i.test(h.text);
    const isStory = h.level === 3 && /^Story\s*:\s*/i.test(h.text);

    if (isFeature) {
      featureIndex += 1;
      const title = h.text.replace(/^Feature\s*:\s*/i, "").trim();
      const id = extractInlineId(title) || `F-${String(featureIndex).padStart(2, "0")}`;
      const cleanTitle = stripInlineId(title);

      currentFeature = { id, title: cleanTitle, source: "PLAN.md" };
      features.push(currentFeature);
    }

    if (isStory) {
      storyIndex += 1;
      const title = h.text.replace(/^Story\s*:\s*/i, "").trim();
      const id = extractInlineId(title) || `S-${String(storyIndex).padStart(3, "0")}`;
      const cleanTitle = stripInlineId(title);

      const story = {
        id,
        title: cleanTitle,
        feature_id: currentFeature?.id || null,
        source: "PLAN.md"
      };
      stories.push(story);
    }
  }

  return { features, stories };
}

function parseAcceptance(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "ACCEPTANCE.md"));
  if (!md) return { criteria: [], _note: "ACCEPTANCE.md not found" };

  // Convention:
  // ## Story: <TITLE> [ID=ABC-123]
  // - [ ] criterion...
  const headings = extractHeadings(md);
  const lines = md.split(/\r?\n/);

  const criteria = [];
  let currentStoryId = null;

  // naive, stable: detect story heading and capture checklist items until next story heading
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{2,4})\s+Story\s*:\s*(.+?)\s*$/.exec(line);
    if (h) {
      const title = h[2].trim();
      currentStoryId = extractInlineId(title) || null;
      continue;
    }

    const item = /^\s*-\s*\[( |x|X)\]\s+(.+?)\s*$/.exec(line);
    if (item) {
      criteria.push({
        story_id: currentStoryId,
        checked: item[1].toLowerCase() === "x",
        text: item[2].trim(),
        source: "ACCEPTANCE.md"
      });
    }
  }

  return { criteria };
}

function parseStatus(repoPath) {
  const md = readTextIfExists(path.join(repoPath, "STATUS.md"));
  if (!md) return { declared: {}, _note: "STATUS.md not found" };

  // Convention:
  // FEATURE <ID>: <percent>
  // STORY <ID>: <percent>
  const declared = {};
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*(FEATURE|STORY)\s+([A-Z0-9-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) declared[`${m[1]}:${m[2]}`] = m[3];
  }
  return { declared, source: "STATUS.md" };
}

function extractInlineId(title) {
  // [ID=ABC-123] or (ID=ABC-123)
  const m = /[\[(]ID\s*=\s*([A-Z0-9-]+)[\])]/.exec(title);
  return m ? m[1] : null;
}

function stripInlineId(title) {
  return title.replace(/\s*[\[(]ID\s*=\s*[A-Z0-9-]+[\])]\s*/g, "").trim();
}

module.exports = {
  parseProjectYaml,
  parseEpicFromReadme,
  parsePlan,
  parseAcceptance,
  parseStatus
};
```

---

## 6) `src/lib/scan-repo.js`

Classifies **actual artifacts** and collects story tags from files.

```js
const path = require("path");
const fg = require("fast-glob");
const { readTextIfExists, rel } = require("./fs-utils");
const { extractStoryTags } = require("./md-utils");

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.eva/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.turbo/**"
];

function classify(fileRel) {
  const lower = fileRel.toLowerCase();

  if (lower.startsWith("docs/")) return "doc";
  if (lower.startsWith("infra/") || lower.includes("terraform") || lower.endsWith(".bicep")) return "infra";
  if (lower.startsWith("tests/") || lower.includes(".spec.") || lower.includes(".test.")) return "test";
  if (lower.startsWith("evidence/")) return "evidence";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "config";
  if (lower.endsWith(".md")) return "doc";
  if (lower.endsWith(".json")) return "data";
  if (lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".py") || lower.endsWith(".ps1")) return "code";

  return "other";
}

async function scanRepo(repoPath) {
  const entries = await fg(["**/*"], {
    cwd: repoPath,
    dot: true,
    onlyFiles: true,
    ignore: DEFAULT_IGNORES
  });

  const artifacts = [];
  for (const f of entries) {
    const type = classify(f);
    const abs = path.join(repoPath, f);

    // Only read text for likely-text files (avoid binaries)
    const isTextLike =
      /\.(md|txt|js|ts|py|ps1|json|yml|yaml|html|css|scss|tf|bicep)$/i.test(f);

    const content = isTextLike ? readTextIfExists(abs) : null;
    const storyTags = isTextLike ? extractStoryTags(content) : [];

    artifacts.push({
      path: f.replace(/\\/g, "/"),
      type,
      story_tags: storyTags
    });
  }

  return { artifacts };
}

module.exports = {
  scanRepo
};
```

---

## 7) `src/lib/map-artifacts.js`

Maps artifacts to stories by story tag (EVA-STORY).

```js
function mapArtifactsToStories(actualArtifacts) {
  const map = {}; // storyId -> { artifacts: [] }

  for (const a of actualArtifacts) {
    for (const sid of a.story_tags || []) {
      if (!map[sid]) map[sid] = { artifacts: [] };
      map[sid].artifacts.push(a);
    }
  }

  return map;
}

module.exports = { mapArtifactsToStories };
```

---

## 8) `src/lib/trust.js`

MTI-like trust scoring.

```js
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function computeTrustScore(recon) {
  const totalStories = recon?.coverage?.stories_total ?? 0;
  if (totalStories === 0) return { score: 0, components: {} };

  const withArtifacts = recon.coverage.stories_with_artifacts ?? 0;
  const withEvidence = recon.coverage.stories_with_evidence ?? 0;
  const consistency = recon.coverage.consistency_score ?? 0;

  const coverage = withArtifacts / totalStories;          // 0..1
  const evidenceCompleteness = withEvidence / totalStories; // 0..1
  const consistencyScore = clamp(consistency, 0, 1);      // 0..1

  const score =
    (coverage * 0.4 + evidenceCompleteness * 0.4 + consistencyScore * 0.2) * 100;

  return {
    score: Math.round(score),
    components: {
      coverage: round2(coverage),
      evidenceCompleteness: round2(evidenceCompleteness),
      consistencyScore: round2(consistencyScore)
    }
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function trustToActions(score) {
  if (score >= 90) return ["deploy", "merge", "release"];
  if (score >= 70) return ["test", "review", "merge-with-approval"];
  if (score >= 50) return ["review-required", "no-deploy"];
  return ["block", "investigate"];
}

module.exports = {
  computeTrustScore,
  trustToActions
};
```

---

## 9) `src/lib/ado-csv.js`

Generates a simple ADO import CSV (Epic/Feature/User Story).

```js
function csvEscape(s) {
  const v = String(s ?? "");
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsvRows(planned, recon) {
  const rows = [];
  const epicTitle = planned?.epic?.title || planned?.project?.name || "EVA Project";

  rows.push([
    "Work Item Type",
    "Title",
    "Parent",
    "Description",
    "Acceptance Criteria",
    "Tags"
  ]);

  rows.push(["Epic", epicTitle, "", planned?.epic?.description || "", "", "eva"]);

  const featureById = new Map((planned.features || []).map((f) => [f.id, f]));
  const stories = planned.stories || [];

  for (const f of planned.features || []) {
    rows.push(["Feature", `${f.id} ${f.title}`, epicTitle, "", "", "eva;feature"]);
  }

  // Optional: annotate with reconciliation status
  const storyStatusMap = new Map();
  for (const g of recon?.gaps || []) {
    if (g.story_id) storyStatusMap.set(g.story_id, g.type);
  }

  for (const s of stories) {
    const parentFeature = featureById.get(s.feature_id);
    const parentTitle = parentFeature ? `${parentFeature.id} ${parentFeature.title}` : epicTitle;

    const acceptance = (planned.acceptance || [])
      .filter((c) => c.story_id === s.id)
      .map((c) => `- ${c.text}`)
      .join("\n");

    const gapTag = storyStatusMap.has(s.id) ? `gap:${storyStatusMap.get(s.id)}` : "";
    const tags = ["eva", "story", gapTag].filter(Boolean).join(";");

    rows.push([
      "User Story",
      `${s.id} ${s.title}`,
      parentTitle,
      s.description || "",
      acceptance,
      tags
    ]);
  }

  return rows;
}

function rowsToCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

module.exports = {
  toCsvRows,
  rowsToCsv
};
```

---

## 10) `src/discover.js`

```js
const path = require("path");
const { ensureDir, writeJson } = require("./lib/fs-utils");
const {
  parseProjectYaml,
  parseEpicFromReadme,
  parsePlan,
  parseAcceptance,
  parseStatus
} = require("./lib/parse-docs");
const { scanRepo } = require("./lib/scan-repo");
const { mapArtifactsToStories } = require("./lib/map-artifacts");

async function discover(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "discovery.json"));
  ensureDir(path.dirname(outPath));

  const projectYaml = parseProjectYaml(repoPath);
  const epic = parseEpicFromReadme(repoPath);

  const plan = parsePlan(repoPath);
  const acceptance = parseAcceptance(repoPath);
  const status = parseStatus(repoPath);

  const actual = await scanRepo(repoPath);
  const storyArtifactMap = mapArtifactsToStories(actual.artifacts);

  const discovery = {
    meta: {
      schema: "eva.discovery.v1",
      generated_at: new Date().toISOString(),
      repo: repoPath
    },
    project: projectYaml?.project || projectYaml || null,
    planned: {
      epic,
      features: plan.features,
      stories: plan.stories,
      acceptance: acceptance.criteria,
      declared_status: status.declared
    },
    actual: {
      artifacts: actual.artifacts,
      story_artifact_map: storyArtifactMap
    }
  };

  writeJson(outPath, discovery);
  console.log(`✅ discovery written: ${outPath}`);
}

module.exports = { discover };
```

---

## 11) `src/reconcile.js`

```js
const path = require("path");
const { readJsonIfExists, writeJson, ensureDir } = require("./lib/fs-utils");

function unique(arr) {
  return [...new Set(arr)];
}

async function reconcile(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const inPath = path.resolve(opts.in || path.join(repoPath, ".eva", "discovery.json"));
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "reconciliation.json"));
  ensureDir(path.dirname(outPath));

  const discovery = readJsonIfExists(inPath);
  if (!discovery) {
    throw new Error(`discovery.json not found at ${inPath}. Run: eva discover`);
  }

  const plannedStories = discovery.planned?.stories || [];
  const acceptance = discovery.planned?.acceptance || [];
  const storyMap = discovery.actual?.story_artifact_map || {};

  const stories_total = plannedStories.length;

  const stories_with_artifacts = plannedStories.filter((s) => storyMap[s.id]?.artifacts?.length > 0).length;

  // Evidence heuristic: any artifact in evidence/ tagged to story OR any evidence/ file tagged.
  // In v1 we treat "evidence present" if any mapped artifact has type === evidence.
  const stories_with_evidence = plannedStories.filter((s) => {
    const arts = storyMap[s.id]?.artifacts || [];
    return arts.some((a) => a.type === "evidence");
  }).length;

  // Consistency heuristic: if STATUS claims progress but there are no artifacts, penalty
  const declared = discovery.planned?.declared_status || {};
  let penalties = 0;
  let checks = 0;

  for (const s of plannedStories) {
    const key = `STORY:${s.id}`;
    const decl = declared[key];
    if (!decl) continue;

    const hasArtifacts = (storyMap[s.id]?.artifacts?.length || 0) > 0;
    checks += 1;

    // If declared looks like "50%" and no artifacts => penalty
    const percent = parsePercent(decl);
    if (percent !== null && percent >= 20 && !hasArtifacts) penalties += 1;
  }

  const consistency_score = checks === 0 ? 1 : Math.max(0, 1 - penalties / checks);

  const gaps = [];

  for (const s of plannedStories) {
    const hasArtifacts = (storyMap[s.id]?.artifacts?.length || 0) > 0;
    if (!hasArtifacts) {
      gaps.push({ type: "missing_implementation", story_id: s.id, title: s.title });
      continue;
    }
    const hasEvidence = (storyMap[s.id]?.artifacts || []).some((a) => a.type === "evidence");
    if (!hasEvidence && acceptance.some((c) => c.story_id === s.id)) {
      gaps.push({ type: "missing_evidence", story_id: s.id, title: s.title });
    }
  }

  // Orphan artifacts: tagged stories that don't exist in PLAN
  const plannedIds = new Set(plannedStories.map((s) => s.id));
  const actualTaggedIds = unique(Object.keys(storyMap));
  const orphans = actualTaggedIds.filter((id) => !plannedIds.has(id));

  for (const oid of orphans) {
    gaps.push({ type: "orphan_story_tag", story_id: oid, title: null });
  }

  const reconciliation = {
    meta: {
      schema: "eva.reconciliation.v1",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      discovery_path: inPath
    },
    coverage: {
      stories_total,
      stories_with_artifacts,
      stories_with_evidence,
      consistency_score
    },
    gaps
  };

  writeJson(outPath, reconciliation);
  console.log(`✅ reconciliation written: ${outPath}`);
}

function parsePercent(s) {
  const m = /(\d+)\s*%/.exec(String(s));
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return null;
  return n;
}

module.exports = { reconcile };
```

---

## 12) `src/generate-ado.js`

```js
const fs = require("fs");
const path = require("path");
const { readJsonIfExists, ensureDir } = require("./lib/fs-utils");
const { toCsvRows, rowsToCsv } = require("./lib/ado-csv");

async function generateAdo(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const discoveryPath = path.resolve(opts.discovery || path.join(repoPath, ".eva", "discovery.json"));
  const reconPath = path.resolve(opts.recon || path.join(repoPath, ".eva", "reconciliation.json"));
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "ado.csv"));
  ensureDir(path.dirname(outPath));

  const discovery = readJsonIfExists(discoveryPath);
  if (!discovery) throw new Error(`discovery.json not found at ${discoveryPath}`);

  const recon = readJsonIfExists(reconPath) || null;

  const planned = {
    project: discovery.project,
    epic: discovery.planned.epic,
    features: discovery.planned.features,
    stories: discovery.planned.stories,
    acceptance: discovery.planned.acceptance
  };

  const rows = toCsvRows(planned, recon);
  const csv = rowsToCsv(rows);
  fs.writeFileSync(outPath, csv, "utf8");
  console.log(`✅ ADO CSV written: ${outPath}`);
}

module.exports = { generateAdo };
```

---

## 13) `src/compute-trust.js`

```js
const path = require("path");
const { readJsonIfExists, writeJson, ensureDir } = require("./lib/fs-utils");
const { computeTrustScore, trustToActions } = require("./lib/trust");

async function computeTrust(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const reconPath = path.resolve(opts.recon || path.join(repoPath, ".eva", "reconciliation.json"));
  const outPath = path.resolve(opts.out || path.join(repoPath, ".eva", "trust.json"));
  ensureDir(path.dirname(outPath));

  const recon = readJsonIfExists(reconPath);
  if (!recon) throw new Error(`reconciliation.json not found at ${reconPath}. Run: eva reconcile`);

  const { score, components } = computeTrustScore(recon);
  const actions = trustToActions(score);

  const trust = {
    meta: {
      schema: "eva.trust.v1",
      generated_at: new Date().toISOString(),
      repo: repoPath,
      reconciliation_path: reconPath
    },
    score,
    components,
    actions
  };

  writeJson(outPath, trust);
  console.log(`✅ trust written: ${outPath}`);
}

module.exports = { computeTrust };
```

---

## 14) `src/report.js`

```js
const path = require("path");
const { readJsonIfExists } = require("./lib/fs-utils");

async function report(opts) {
  const repoPath = path.resolve(opts.repo || process.cwd());
  const discoveryPath = path.resolve(opts.discovery || path.join(repoPath, ".eva", "discovery.json"));
  const reconPath = path.resolve(opts.recon || path.join(repoPath, ".eva", "reconciliation.json"));
  const trustPath = path.resolve(opts.trust || path.join(repoPath, ".eva", "trust.json"));

  const discovery = readJsonIfExists(discoveryPath);
  const recon = readJsonIfExists(reconPath);
  const trust = readJsonIfExists(trustPath);

  if (!discovery) throw new Error(`discovery.json not found at ${discoveryPath}`);

  const epic = discovery.planned?.epic?.title || "EVA Project";
  const features = discovery.planned?.features?.length || 0;
  const stories = discovery.planned?.stories?.length || 0;

  console.log("");
  console.log("=======================================");
  console.log(`EVA Orchestrator Report: ${epic}`);
  console.log("=======================================");
  console.log(`Repo: ${repoPath}`);
  console.log(`Planned: ${features} features, ${stories} stories`);

  if (recon) {
    const c = recon.coverage || {};
    console.log("");
    console.log("Coverage");
    console.log("---------------------------------------");
    console.log(`Stories total:          ${c.stories_total}`);
    console.log(`Stories with artifacts: ${c.stories_with_artifacts}`);
    console.log(`Stories with evidence:  ${c.stories_with_evidence}`);
    console.log(`Consistency score:      ${(c.consistency_score ?? 0).toFixed(2)}`);

    console.log("");
    console.log("Gaps");
    console.log("---------------------------------------");
    if (!recon.gaps || recon.gaps.length === 0) {
      console.log("None ✅");
    } else {
      for (const g of recon.gaps) {
        console.log(`- ${g.type} :: ${g.story_id}${g.title ? " — " + g.title : ""}`);
      }
    }
  } else {
    console.log("");
    console.log("Reconciliation: (missing) run: eva reconcile");
  }

  if (trust) {
    console.log("");
    console.log("Trust");
    console.log("---------------------------------------");
    console.log(`Score:   ${trust.score}`);
    console.log(`Actions: ${Array.isArray(trust.actions) ? trust.actions.join(", ") : ""}`);
    console.log(`Components: ${JSON.stringify(trust.components)}`);
  } else {
    console.log("");
    console.log("Trust: (missing) run: eva compute-trust");
  }

  console.log("");
}

module.exports = { report };
```

---

# 15) Conventions you should enforce in EVA repos (critical)

## A) In code/artifacts: tag files to stories

At the top of source files, scripts, test files, evidence files:

```js
// EVA-STORY: JP-123
// EVA-FEATURE: JP-10
```

Or:

```text
[EVA-STORY JP-123]
```

This is how **bottom-up discovery becomes precise**.

## B) In PLAN.md: define Features + Stories (lightweight)

Example:

```md
## Feature: Discovery Engine [ID=RT-01]
### Story: Scan APIs and endpoints [ID=RT-01-001]
### Story: Detect model capabilities [ID=RT-01-002]
```

## C) In ACCEPTANCE.md: checklist, ideally per story

```md
## Story: Scan APIs and endpoints [ID=RT-01-001]
- [ ] All endpoints inventoried
- [ ] Evidence stored in evidence/endpoints.json
```

## D) In STATUS.md: optional declared progress (used for consistency scoring)

```md
STORY RT-01-001: 60%
FEATURE RT-01: 40%
```

---

# 16) How to run it in a repo

From inside a project repo:

```bash
npm i -g /path/to/eva-orchestrator  # or run via node directly
eva discover
eva reconcile
eva compute-trust
eva generate-ado
eva report
```

Outputs:

```text
.eva/
  discovery.json
  reconciliation.json
  trust.json
  ado.csv
```
