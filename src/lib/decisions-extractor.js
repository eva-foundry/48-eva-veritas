// EVA-STORY: EO-11-006
// EVA-FEATURE: EO-11
"use strict";

/**
 * decisions-extractor.js
 * 
 * Extracts architecture decisions (ADRs) from:
 * 1. Standalone ADR files (docs/architecture-decisions/, ADRs/, etc.)
 * 2. STATUS.md and PLAN.md decision sections
 * Parses decision sections and converts to Layer 30 (Decisions) records.
 */

const fs = require("fs");
const path = require("path");

/**
 * Recursively find ADR files in common locations
 */
function findADRFiles(repoPath) {
  const adrFiles = [];
  const commonPaths = [
    "docs/architecture-decisions",
    "docs/ADRs",
    "docs/adr",
    "ADRs",
    "adr",
    "architecture/decisions",
    "docs/decisions"
  ];

  // Check common locations first
  for (const subPath of commonPaths) {
    const fullPath = path.join(repoPath, subPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const files = fs.readdirSync(fullPath);
      for (const file of files) {
        if (file.match(/^ADR-\d+.*\.md$/i) || file.includes("decision")) {
          adrFiles.push(path.join(fullPath, file));
        }
      }
    }
  }

  return adrFiles;
}

/**
 * Recursively find all STATUS*.md and PLAN*.md files
 */
function findGovernanceFiles(repoPath, excludeDirs = ['.git', 'node_modules', '.eva']) {
  const governanceFiles = [];
  
  function scanDir(dir, depth = 0) {
    if (depth > 5) return; // Limit recursion depth
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip excluded directories
          if (excludeDirs.includes(entry.name)) continue;
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Match STATUS*.md or PLAN*.md (case-insensitive)
          if (entry.name.match(/^(STATUS|PLAN).*\.md$/i)) {
            const relativePath = path.relative(repoPath, fullPath);
            const isRoot = !relativePath.includes(path.sep);
            governanceFiles.push({
              path: fullPath,
              relativePath: relativePath,
              name: entry.name,
              isRoot: isRoot,
              priority: isRoot ? 1 : 2 // Root files have higher priority
            });
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }
  
  scanDir(repoPath);
  
  // Sort by priority (root first) then by path
  governanceFiles.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.relativePath.localeCompare(b.relativePath);
  });
  
  return governanceFiles;
}

/**
 * Parse a standalone ADR file (standard template format)
 */
function parseADRFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);
  
  // Extract ADR number from filename: ADR-005-Title.md -> "005"
  const adrMatch = fileName.match(/ADR-(\d+)/i);
  const adrNum = adrMatch ? adrMatch[1] : null;
  
  // Extract title from first heading or filename
  const titleMatch = content.match(/^#\s+(.+)$/m);
  let title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.md$/i, "");
  
  // Remove "ADR-NNN: " prefix if present in title
  title = title.replace(/^ADR-\d+:\s*/i, "");
  
  // Extract status
  const statusMatch = content.match(/\*\*Status\*\*:\s*(\w+)/i);
  const status = statusMatch ? statusMatch[1].toLowerCase() : "accepted";
  
  // Extract date
  const dateMatch = content.match(/\*\*Date\*\*:\s*([^\n]+)/i);
  const date = dateMatch ? dateMatch[1].trim() : null;
  
  // Extract deciders
  const decidersMatch = content.match(/\*\*Deciders?\*\*:\s*([^\n]+)/i);
  const deciders = decidersMatch 
    ? decidersMatch[1].split(/[,;]/).map(d => d.trim()).filter(d => d)
    : [];
  
  // Extract sections: ## Context, ## Decision, ## Consequences
  const contextMatch = content.match(/##\s+Context\s*\n([\s\S]*?)(?=\n##|$)/i);
  const context = contextMatch ? contextMatch[1].trim() : null;
  
  const decisionMatch = content.match(/##\s+Decision\s*\n([\s\S]*?)(?=\n##|$)/i);
  const decision = decisionMatch ? decisionMatch[1].trim() : null;
  
  const consequencesMatch = content.match(/##\s+Consequences\s*\n([\s\S]*?)(?=\n##|$)/i);
  const consequences = consequencesMatch ? consequencesMatch[1].trim() : null;
  
  // Extract alternatives considered
  const alternativesMatch = content.match(/##\s+Alternatives\s+Considered\s*\n([\s\S]*?)(?=##|\n\n##|$)/i);
  const alternatives = alternativesMatch 
    ? alternativesMatch[1].trim().split(/\n[-*]/).filter(a => a.trim())
    : [];
  
  return {
    adr_num: adrNum,
    title: title,
    status: status,
    date: date,
    deciders: deciders,
    context: context,
    decision: decision,
    consequences: consequences,
    alternatives_considered: alternatives,
    source_file: path.relative(process.cwd(), filePath).replace(/\\/g, "/")
  };
}

/**
 * Parse inline decisions from STATUS.md or PLAN.md
 */
function parseDecisions(text) {
  const decisions = [];
  
  // Pattern 1: "## Decisions" or "## Architecture Decisions" sections
  const sectionRegex = /^##\s+(Architecture\s+)?Decisions?\s*$/gmi;
  const sections = [];
  
  let match;
  let lastIndex = 0;
  while ((match = sectionRegex.exec(text)) !== null) {
    if (lastIndex > 0) {
      sections.push(text.substring(lastIndex, match.index));
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex > 0) {
    sections.push(text.substring(lastIndex));
  }

  // Parse each decision section
  for (const section of sections) {
    // Look for ADR-style patterns: "ADR-NNN: Title" or "Decision: X"
    const adrPattern = /(?:^|\n)(?:ADR-(\d+):|Decision):\s*([^\n]+)/gi;
    let adrMatch;
    
    while ((adrMatch = adrPattern.exec(section)) !== null) {
      const adrNum = adrMatch[1] || null;
      const title = adrMatch[2].trim();
      
      // Extract context (lines before decision)
      const startPos = Math.max(0, adrMatch.index - 300);
      const context = section.substring(startPos, adrMatch.index).trim();
      
      // Extract decision body (lines after)
      const bodyStart = adrMatch.index + adrMatch[0].length;
      const bodyEnd = Math.min(section.length, bodyStart + 500);
      const body = section.substring(bodyStart, bodyEnd).trim();

      decisions.push({
        adr_num: adrNum,
        title: title,
        context: context.length > 50 ? context : null,
        decision: body.length > 20 ? body : title,
        date: null // Will be inferred from file metadata
      });
    }
  }

  // Pattern 2: Bullet list decisions
  const bulletPattern = /^[-*]\s+\[?(?:Decision|ADR)\]?:?\s*([^\n]+)/gmi;
  let bulletMatch;
  while ((bulletMatch = bulletPattern.exec(text)) !== null) {
    const title = bulletMatch[1].trim();
    
    // Avoid duplicates from section parsing
    if (decisions.some(d => d.title === title)) continue;

    decisions.push({
      adr_num: null,
      title: title,
      context: null,
      decision: title,
      date: null
    });
  }

  return decisions;
}

function extractDecisions(discovery, reconciliation, projectId, repoPath) {
  const decisionRecords = [];
  let seq = 1;

  // 1. Find and parse standalone ADR files
  const adrFiles = findADRFiles(repoPath);
  const fileBasedDecisions = [];
  
  for (const adrFile of adrFiles) {
    try {
      const adr = parseADRFile(adrFile);
      fileBasedDecisions.push(adr);
    } catch (err) {
      console.warn(`[WARN] Failed to parse ADR file ${adrFile}: ${err.message}`);
    }
  }

  // 2. Find and parse all STATUS*.md and PLAN*.md files (recursive)
  const governanceFiles = findGovernanceFiles(repoPath);
  
  if (governanceFiles.length > 0) {
    const fileList = governanceFiles.map(f => f.relativePath).join(', ');
    console.info(`[INFO] Found ${governanceFiles.length} governance file(s): ${fileList}`);
  }
  
  const inlineDecisions = [];
  
  for (const govFile of governanceFiles) {
    try {
      const content = fs.readFileSync(govFile.path, "utf8");
      const decisions = parseDecisions(content);
      
      // Tag each decision with its source file
      for (const decision of decisions) {
        inlineDecisions.push({
          ...decision,
          source_file: govFile.relativePath,
          priority: govFile.priority
        });
      }
    } catch (err) {
      console.warn(`[WARN] Failed to parse ${govFile.relativePath}: ${err.message}`);
    }
  }

  // 3. Combine all decisions
  const allDecisions = [
    ...fileBasedDecisions,
    ...inlineDecisions
  ];

  // Deduplicate by title (prioritize: ADR files > root governance > subdirectory governance)
  const seen = new Map(); // title -> decision with highest priority
  for (const decision of allDecisions) {
    const key = decision.title.trim().toLowerCase();
    
    if (!seen.has(key)) {
      seen.set(key, decision);
    } else {
      const existing = seen.get(key);
      // ADR files (have adr_num) always win
      if (decision.adr_num && !existing.adr_num) {
        seen.set(key, decision);
      }
      // If both inline, prefer higher priority (root files)
      else if (!decision.adr_num && !existing.adr_num) {
        const decisionPriority = decision.priority || 3;
        const existingPriority = existing.priority || 3;
        if (decisionPriority < existingPriority) {
          seen.set(key, decision);
        }
      }
    }
  }
  
  const uniqueDecisions = Array.from(seen.values());

  // Find related WBS IDs by searching for story/feature tags in decision text
  const stories = discovery.planned?.stories || [];
  const features = discovery.planned?.features || [];
  const allIds = [...stories.map(s => s.id), ...features.map(f => f.id)];

  for (const decision of uniqueDecisions) {
    const relatedIds = [];
    const searchText = `${decision.title} ${decision.context || ""} ${decision.decision || ""}`;
    
    for (const id of allIds) {
      if (searchText.includes(id)) {
        relatedIds.push(id);
      }
    }

    const adrId = decision.adr_num 
      ? `${projectId}-ADR-${String(decision.adr_num).padStart(3, '0')}`
      : `${projectId}-DEC-${String(seq).padStart(3, '0')}`;

    decisionRecords.push({
      id: adrId,
      project_id: projectId,
      title: decision.title,
      date: decision.date || new Date().toISOString().split('T')[0],
      status: decision.status || "accepted",
      context: decision.context,
      decision: decision.decision,
      consequences: decision.consequences || null,
      alternatives_considered: decision.alternatives_considered || [],
      superseded_by: null,
      deciders: decision.deciders || [],
      tags: ["governance", "veritas-export"],
      related_wbs_ids: relatedIds,
      evidence_path: decision.source_file || null,
      notes: decision.source_file 
        ? `Extracted from ${decision.source_file} by Veritas export-to-model`
        : "Extracted from project governance docs by Veritas export-to-model"
    });

    seq++;
  }

  // Add standard API timestamps
  const now = new Date().toISOString();
  for (const record of decisionRecords) {
    record.created_at = record.created_at || now;
    record.updated_at = record.updated_at || now;
  }

  return decisionRecords;
}

module.exports = { extractDecisions };
