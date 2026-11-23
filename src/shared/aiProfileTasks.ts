import type { AiProfileTask, AiProfileTaskDefinition } from "./contracts";

const AI_PROFILE_TASKS: Record<AiProfileTask, AiProfileTaskDefinition> = {
  youtube_metadata: {
    id: "youtube_metadata",
    label: "YouTube metadata",
    description:
      "Used by the Workspace metadata generation flow for titles, descriptions, public hashtags, and platform tags as one grouped YouTube metadata task so the same worker can keep voice and packaging consistent across all fields.",
    assignmentLabel: "YouTube metadata profile",
    wiredFeature: "Workspace metadata generation"
  },
  youtube_thumbnail: {
    id: "youtube_thumbnail",
    label: "YouTube thumbnail analysis",
    description:
      "Reviews available thumbnail frames and guides local candidate composition for the YouTube channel library.",
    assignmentLabel: "YouTube thumbnail profile",
    wiredFeature: "YouTube Thumbnail Studio"
  },
  performance_coach: {
    id: "performance_coach",
    label: "Performance coach",
    description:
      "Analyzes the creator's own channel evidence, content lanes, and selected video diagnostics to produce grounded improvement actions.",
    assignmentLabel: "Performance coach profile",
    wiredFeature: "Personal channel performance coaching"
  },
  clip_discovery: {
    id: "clip_discovery",
    label: "Clip discovery",
    description:
      "Ranks transcript-led moments from long-form sources for review, trimming, and export into the existing clip workflow.",
    assignmentLabel: "Clip discovery profile",
    wiredFeature: "Long-form clip proposals"
  }
};

export function getAiProfileTaskDefinition(task: AiProfileTask): AiProfileTaskDefinition {
  return AI_PROFILE_TASKS[task];
}

export function listAiProfileTaskDefinitions(): AiProfileTaskDefinition[] {
  return Object.values(AI_PROFILE_TASKS);
}
