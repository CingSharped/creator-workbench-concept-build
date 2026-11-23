import type { AiProfile, AiProfileAssignments, AiProfileKnowledgeEntry, AiProfileTask } from "../../shared/contracts";

export function createEmptyAiProfileAssignments(): AiProfileAssignments {
  return {
    youtubeMetadataProfileId: null,
    youtubeThumbnailProfileId: null,
    performanceCoachProfileId: null,
    clipDiscoveryProfileId: null
  };
}

export function createCustomAiProfile(task: AiProfileTask = "youtube_metadata"): AiProfile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name:
      task === "youtube_thumbnail"
          ? "Custom YouTube Thumbnail Worker"
        : task === "performance_coach"
          ? "Custom Performance Coach"
        : task === "clip_discovery"
          ? "Custom Clip Discovery Worker"
          : "Custom YouTube Metadata Worker",
    task,
    description:
      task === "youtube_thumbnail"
          ? "Custom worker for local YouTube thumbnail analysis and composition guidance."
        : task === "performance_coach"
          ? "Custom worker for evidence-grounded channel performance coaching."
        : task === "clip_discovery"
          ? "Custom worker for transcript-led long-form clip discovery."
          : "Custom worker for specialized YouTube metadata generation.",
    preferredModel: "",
    systemPrompt: "",
    learningSettings: {
      mode: "adaptive_prompt",
      maxKnowledgeEntries: 12,
      includeApprovedExamples: true,
      includeHighPerformingExamples: true,
      includeRejectedExamples: true
    },
    knowledgeEntries: [],
    speakerContextSettings:
      task === "youtube_metadata"
        ? { enabled: true, warnWhenStreamerUnidentified: true }
        : undefined,
    enabled: true,
    builtIn: false,
    createdAt: now,
    updatedAt: now
  };
}

export function createAiProfileKnowledgeEntry(): AiProfileKnowledgeEntry {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New task knowledge",
    content: "",
    tags: [],
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

export function findBestAiProfileIdForTask(profiles: AiProfile[], task: AiProfileTask, preferredId: string | null): string | null {
  const taskProfiles = profiles.filter((profile) => profile.task === task);
  const enabledProfiles = taskProfiles.filter((profile) => profile.enabled);

  if (preferredId) {
    const preferredProfile = enabledProfiles.find((profile) => profile.id === preferredId);
    if (preferredProfile) {
      return preferredProfile.id;
    }
  }

  return enabledProfiles[0]?.id ?? taskProfiles[0]?.id ?? null;
}

export function normalizeAiProfileAssignmentsForProfiles(
  assignments: AiProfileAssignments,
  profiles: AiProfile[]
): AiProfileAssignments {
  return {
    youtubeMetadataProfileId: findBestAiProfileIdForTask(
      profiles,
      "youtube_metadata",
      assignments.youtubeMetadataProfileId
    ),
    youtubeThumbnailProfileId: findBestAiProfileIdForTask(
      profiles,
      "youtube_thumbnail",
      assignments.youtubeThumbnailProfileId
    ),
    performanceCoachProfileId: findBestAiProfileIdForTask(
      profiles,
      "performance_coach",
      assignments.performanceCoachProfileId ?? null
    ),
    clipDiscoveryProfileId: findBestAiProfileIdForTask(
      profiles,
      "clip_discovery",
      assignments.clipDiscoveryProfileId
    )
  };
}
