// EVA-STORY: EO-11-007
// EVA-FEATURE: EO-11
"use strict";

/**
 * risks-extractor.js
 * 
 * Extracts risks and blockers from STATUS.md.
 * Parses risk sections and converts to Layer 29 (Risks) records.
 */

const fs = require("fs");
const path = require("path");

function categorizeRisk(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes("security") || lower.includes("vulnerability") || lower.includes("exposure")) {
    return "security";
  }
  if (lower.includes("schedule") || lower.includes("deadline") || lower.includes("delay") || lower.includes("sprint")) {
    return "schedule";
  }
  if (lower.includes("resource") || lower.includes("cost") || lower.includes("budget")) {
    return "resource";
  }
  if (lower.includes("technical") || lower.includes("architecture") || lower.includes("code") || lower.includes("debt")) {
    return "technical";
  }
  
  return "technical"; // Default
}

function inferProbability(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes("high probability") || lower.includes("likely") || lower.includes("frequent")) {
    return "High";
  }
  if (lower.includes("low probability") || lower.includes("unlikely") || lower.includes("rare")) {
    return "Low";
  }
  
  return "Medium"; // Default
}

function inferImpact(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes("critical") || lower.includes("high impact") || lower.includes("severe")) {
    return "High";
  }
  if (lower.includes("low impact") || lower.includes("minor") || lower.includes("trivial")) {
    return "Low";
  }
  
  return "Medium"; // Default
}

function calculateRiskScore(probability, impact) {
  const scores = { "Low": 1, "Medium": 3, "High": 9 };
  return scores[probability] * scores[impact];
}

function parseRisks(text) {
  const risks = [];
  
  // Pattern 1: "## Risks" or "## Current Blockers" sections
  const sectionRegex = /^##\s+(Current\s+)?(Risks?|Blockers?|Issues?|Open\s+Blockers?)\s*$/gmi;
  const sections = [];
  
  let match;
  let lastIndex = 0;
  while ((match = sectionRegex.exec(text)) !== null) {
    if (lastIndex > 0) {
      sections.push({ text: text.substring(lastIndex, match.index), type: "risk" });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex > 0) {
    sections.push({ text: text.substring(lastIndex), type: "risk" });
  }

  // Parse each risk section
  for (const section of sections) {
    // Pattern A: Markdown table format
    // | # | Blocker | Resolution |
    // |---|---------|------------|
    // | ID | Description | Mitigation |
    const tableLineRegex = /^\s*\|\s*([A-Z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm;
    let tableMatch;
    let skipFirstRow = false;
    
    while ((tableMatch = tableLineRegex.exec(section.text)) !== null) {
      const id = tableMatch[1].trim();
      const desc = tableMatch[2].trim();
      const resolution = tableMatch[3].trim();
      
      // Skip separator rows (contains only dashes)
      if (id.replace(/[-\s|]/g, '').length === 0) continue;
      if (desc.replace(/[-\s|]/g, '').length === 0) continue;
      
      // Skip header rows (contains header words)
      if (desc.toLowerCase().includes("blocker") && desc.toLowerCase().includes("resolution")) {
        continue; // header row
      }
      
      // Skip if looks like a header
      if (id === "#" || id.toLowerCase() === "id") continue;
      
      // Valid risk row
      risks.push({
        title: desc,
        description: desc,
        status: resolution.toLowerCase().includes("resolved") || resolution.toLowerCase().includes("closed") 
          ? "mitigated" 
          : "open",
        mitigation: resolution.length > 10 ? resolution : null,
        risk_id: id
      });
    }
    
    // Pattern B: List items
    const listPattern = /^[-*]\s+(?:\[([xX ])\]\s+)?(.+?)(?:\n|$)/gm;
    let listMatch;
    
    while ((listMatch = listPattern.exec(section.text)) !== null) {
      const isDone = listMatch[1] && (listMatch[1].toLowerCase() === 'x');
      const title = listMatch[2].trim();
      
      // Skip if already captured in table
      if (risks.some(r => r.title.includes(title) || title.includes(r.title))) continue;
      
      // Extract description (following lines)
      const start = listMatch.index + listMatch[0].length;
      const end = Math.min(section.text.length, start + 300);
      let description = section.text.substring(start, end).trim();
      
      // Stop at next list item
      const nextItemMatch = description.match(/^[-*]\s+/m);
      if (nextItemMatch) {
        description = description.substring(0, nextItemMatch.index).trim();
      }

      // Look for mitigation in description
      let mitigation = null;
      const mitigationMatch = description.match(/(?:mitigation|resolution|fix):\s*([^\n]+)/i);
      if (mitigationMatch) {
        mitigation = mitigationMatch[1].trim();
      }

      risks.push({
        title: title,
        description: description.length > 50 ? description : title,
        status: isDone ? "mitigated" : "open",
        mitigation: mitigation,
        risk_id: null
      });
    }

    // Pattern C: Paragraph-style risks
    const paraPattern = /(?:^|\n)(?:Risk|Blocker|Issue):\s*([^\n]+)/gi;
    let paraMatch;
    
    while ((paraMatch = paraPattern.exec(section.text)) !== null) {
      const title = paraMatch[1].trim();
      
      // Avoid duplicates
      if (risks.some(r => r.title === title)) continue;

      risks.push({
        title: title,
        description: title,
        status: "open",
        mitigation: null,
        risk_id: null
      });
    }
  }

  return risks;
}

function extractRisks(discovery, reconciliation, projectId, repoPath) {
  const riskRecords = [];
  let seq = 1;

  // Read STATUS.md
  const statusPath = path.join(repoPath, "STATUS.md");
  let statusText = "";

  if (fs.existsSync(statusPath)) {
    statusText = fs.readFileSync(statusPath, "utf8");
  } else {
    console.log("[INFO] No STATUS.md found - skipping risk extraction");
    return riskRecords;
  }

  // Parse risks
  const risks = parseRisks(statusText);

  // Find related WBS IDs
  const stories = discovery.planned?.stories || [];
  const features = discovery.planned?.features || [];
  const allIds = [...stories.map(s => s.id), ...features.map(f => f.id)];

  for (const risk of risks) {
    const category = categorizeRisk(risk.title + " " + risk.description);
    const probability = inferProbability(risk.description);
    const impact = inferImpact(risk.description);
    const riskScore = calculateRiskScore(probability, impact);

    // Find WBS IDs mentioned in risk text
    const relatedIds = [];
    const searchText = `${risk.title} ${risk.description}`;
    
    for (const id of allIds) {
      if (searchText.includes(id)) {
        relatedIds.push(id);
      }
    }

    riskRecords.push({
      id: `${projectId}-R${String(seq).padStart(3, '0')}`,
      project_id: projectId,
      title: risk.title,
      description: risk.description,
      category: category,
      probability: probability,
      impact: impact,
      risk_score: riskScore,
      status: risk.status,
      mitigation: risk.mitigation,
      mitigation_owner: null,
      due_date: null,
      sprint_id: null,
      wbs_ids: relatedIds,
      notes: "Extracted from STATUS.md by Veritas export-to-model"
    });

    seq++;
  }

  // Add standard API timestamps
  const now = new Date().toISOString();
  for (const record of riskRecords) {
    record.created_at = record.created_at || now;
    record.updated_at = record.updated_at || now;
  }

  return riskRecords;
}

module.exports = { extractRisks };
