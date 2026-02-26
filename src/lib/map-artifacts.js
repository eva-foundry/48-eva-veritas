// EVA-STORY: EO-01-003
// EVA-FEATURE: EO-01
"use strict";

function mapArtifactsToStories(actualArtifacts) {
  const map = {};

  for (const a of actualArtifacts) {
    for (const sid of a.story_tags || []) {
      if (!map[sid]) map[sid] = { artifacts: [] };
      map[sid].artifacts.push(a);
    }
  }

  return map;
}

module.exports = { mapArtifactsToStories };
