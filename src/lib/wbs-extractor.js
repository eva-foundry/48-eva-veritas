// EVA-STORY: EO-11-004
// EVA-FEATURE: EO-11
"use strict";

/**
 * wbs-extractor.js
 * 
 * Transforms Veritas discovery/reconciliation data into Layer 26 (WBS) records.
 * Maps features → epics/features, stories → user_stories with acceptance criteria.
 */

function deriveStatus(reconciliation, storyId) {
  if (!reconciliation) return "planned";
  
  const storyMetrics = reconciliation.stories || [];
  const sm = storyMetrics.find(s => s.id === storyId);
  
  if (!sm) return "planned";
  if (sm.has_artifacts && sm.has_evidence) return "completed";
  if (sm.has_artifacts) return "in_progress";
  return "planned";
}

function sumMetrics(stories, reconciliation) {
  let pointsTotal = 0;
  let pointsDone = 0;
  let storiesTotal = stories.length;
  let storiesDone = 0;

  for (const story of stories) {
    const points = story.points || 3; // Default 3 points per story
    pointsTotal += points;
    
    const status = deriveStatus(reconciliation, story.id);
    if (status === "completed") {
      pointsDone += points;
      storiesDone += 1;
    }
  }

  return {
    pointsTotal,
    pointsDone,
    storiesTotal,
    storiesDone,
    percentComplete: storiesTotal > 0 ? Math.round((storiesDone / storiesTotal) * 100) : 0
  };
}

function extractWbs(discovery, reconciliation, projectId) {
  const wbsRecords = [];
  let epicSeq = 1;
  let featureSeq = 1;
  let storySeq = 1;

  const features = discovery.planned?.features || [];
  const stories = discovery.planned?.stories || [];
  const acceptance = discovery.planned?.acceptance || [];

  // Create project root if needed
  const rootId = `WBS-${projectId.replace(/[^a-zA-Z0-9]/g, '')}`;
  wbsRecords.push({
    id: rootId,
    project_id: projectId,
    parent_wbs_id: null,
    label: `Project: ${projectId}`,
    level: "epic",
    status: "in_progress",
    percent_complete: 0,
    points_total: 0,
    points_done: 0,
    stories_total: 0,
    stories_done: 0
  });

  // Group stories by feature
  const storyMap = {};
  for (const story of stories) {
    const fid = story.feature_id || "_orphan";
    if (!storyMap[fid]) storyMap[fid] = [];
    storyMap[fid].push(story);
  }

  // Process features
  for (const feature of features) {
    const featureId = `WBS-F${String(featureSeq).padStart(2, '0')}`;
    const featureStories = storyMap[feature.id] || [];
    const metrics = sumMetrics(featureStories, reconciliation);

    wbsRecords.push({
      id: featureId,
      project_id: projectId,
      parent_wbs_id: rootId,
      label: feature.title || feature.id,
      level: "feature",
      status: metrics.storiesDone === metrics.storiesTotal && metrics.storiesTotal > 0 
        ? "completed" 
        : metrics.storiesDone > 0 
          ? "in_progress" 
          : "planned",
      percent_complete: metrics.percentComplete,
      points_total: metrics.pointsTotal,
      points_done: metrics.pointsDone,
      stories_total: metrics.storiesTotal,
      stories_done: metrics.storiesDone
    });

    // Process stories for this feature
    for (const story of featureStories) {
      const storyId = `WBS-S${String(storySeq).padStart(3, '0')}`;
      const storyStatus = deriveStatus(reconciliation, story.id);
      const points = story.points || 3;
      
      // Find acceptance criteria
      const ac = acceptance.filter(a => a.story_id === story.id)
        .map(a => a.text)
        .join("\n");

      wbsRecords.push({
        id: storyId,
        project_id: projectId,
        parent_wbs_id: featureId,
        label: story.title || story.id,
        level: "user_story",
        status: storyStatus,
        percent_complete: storyStatus === "completed" ? 100 : storyStatus === "in_progress" ? 50 : 0,
        points_total: points,
        points_done: storyStatus === "completed" ? points : 0,
        acceptance_criteria: ac || null,
        original_story_id: story.id // Keep reference to original Veritas ID
      });

      storySeq++;
    }

    featureSeq++;
  }

  // Handle orphan stories (no feature parent)
  const orphanStories = storyMap["_orphan"] || [];
  if (orphanStories.length > 0) {
    const orphanFeatureId = `WBS-F${String(featureSeq).padStart(2, '0')}`;
    const metrics = sumMetrics(orphanStories, reconciliation);

    wbsRecords.push({
      id: orphanFeatureId,
      project_id: projectId,
      parent_wbs_id: rootId,
      label: "Orphan Stories (Ungrouped)",
      level: "feature",
      status: metrics.storiesDone > 0 ? "in_progress" : "planned",
      percent_complete: metrics.percentComplete,
      points_total: metrics.pointsTotal,
      points_done: metrics.pointsDone,
      stories_total: metrics.storiesTotal,
      stories_done: metrics.storiesDone
    });

    for (const story of orphanStories) {
      const storyId = `WBS-S${String(storySeq).padStart(3, '0')}`;
      const storyStatus = deriveStatus(reconciliation, story.id);
      const points = story.points || 3;

      wbsRecords.push({
        id: storyId,
        project_id: projectId,
        parent_wbs_id: orphanFeatureId,
        label: story.title || story.id,
        level: "user_story",
        status: storyStatus,
        percent_complete: storyStatus === "completed" ? 100 : 0,
        points_total: points,
        points_done: storyStatus === "completed" ? points : 0,
        original_story_id: story.id
      });

      storySeq++;
    }
  }

  // Update project root totals
  const allStories = stories;
  const rootMetrics = sumMetrics(allStories, reconciliation);
  wbsRecords[0].points_total = rootMetrics.pointsTotal;
  wbsRecords[0].points_done = rootMetrics.pointsDone;
  wbsRecords[0].stories_total = rootMetrics.storiesTotal;
  wbsRecords[0].stories_done = rootMetrics.storiesDone;
  wbsRecords[0].percent_complete = rootMetrics.percentComplete;
  wbsRecords[0].status = rootMetrics.percentComplete === 100 
    ? "completed" 
    : rootMetrics.percentComplete > 0 
      ? "in_progress" 
      : "planned";

  // Add timestamps to all records (required for cloud API)
  const now = new Date().toISOString();
  for (const record of wbsRecords) {
    record.created_at = record.created_at || now;
    record.updated_at = record.updated_at || now;
  }

  return wbsRecords;
}

module.exports = { extractWbs };
