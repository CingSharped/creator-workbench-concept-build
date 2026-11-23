import { randomUUID } from "node:crypto";
import type {
  AiProfile,
  AiProfileAssignments,
  AiProfileKnowledgeEntry,
  AiProfileLearningMode,
  AiProfileLearningSettings,
  AiProfileTask
} from "../../shared/contracts";
import { clearAppSetting, getAppSetting, setAppSetting } from "./settingsRepository";

const AI_PROFILES_SETTING_KEY = "ai.profiles";
const AI_PROFILE_ASSIGNMENTS_SETTING_KEY = "ai.profile_assignments";
const AI_STRICT_MODE_SETTING_KEY = "ai.strict_mode_enabled";
const DEFAULT_AI_PROFILE_TIMESTAMP = "2026-07-29T00:00:00.000Z";
const DEFAULT_AI_PROFILE_PROMPT_VERSION = 3;
const YOUTUBE_METADATA_TASK: AiProfileTask = "youtube_metadata";
const YOUTUBE_THUMBNAIL_TASK: AiProfileTask = "youtube_thumbnail";
const PERFORMANCE_COACH_TASK: AiProfileTask = "performance_coach";
const CLIP_DISCOVERY_TASK: AiProfileTask = "clip_discovery";
const DEFAULT_AI_PROFILE_LEARNING_SETTINGS: AiProfileLearningSettings = {
  mode: "adaptive_prompt",
  maxKnowledgeEntries: 12,
  includeApprovedExamples: true,
  includeHighPerformingExamples: true,
  includeRejectedExamples: true
};
const DEFAULT_SPEAKER_CONTEXT_SETTINGS = {
  enabled: true,
  warnWhenStreamerUnidentified: true
};

const LEGACY_DEFAULT_AI_PROFILE_PROMPTS: Record<string, string> = {
  "ai-profile-youtube-metadata-balanced":
    "Prioritize grounded gaming YouTube Shorts packaging. Keep titles concrete, hooks early, and descriptions creator-authentic. Favor clarity over hype.",
  "ai-profile-youtube-metadata-punchy":
    "Push for stronger hooks and sharper title packaging while staying truthful to the transcript. Favor fast tension, payoff clarity, and memorable social-chaos wording.",
  "ai-profile-youtube-metadata-structured":
    "Favor structured, search-aware YouTube metadata. Keep output consistent, explainable, and easy to review. Prefer disciplined tags and descriptions over flashy phrasing.",
  "ai-profile-performance-coach":
    "Stay grounded in the creator's own channel evidence. Separate observations from interpretations, respect sample size, and recommend one concrete review-first experiment at a time.",
  "ai-profile-clip-discovery-assistant":
    "Find grounded, self-contained gaming moments from the supplied transcript. Prefer a clear hook, escalating tension or surprise, and a satisfying payoff. Return only reviewable candidate ranges; never claim visual evidence that was not supplied.",
  "ai-profile-youtube-thumbnail-analyst":
    "Review supplied thumbnail frames as visual evidence. Prioritize a clear focal subject, readable composition, action or emotion supported by the image, strong contrast, and a layout that remains legible at small sizes. Never invent people, events, game details, or text that is not visibly supported."
};

const DEFAULT_AI_PROFILES: AiProfile[] = [
  {
    id: "ai-profile-youtube-metadata-balanced",
    name: "YouTube Metadata Balanced",
    task: YOUTUBE_METADATA_TASK,
    description: "Balanced gaming Shorts packaging with grounded hooks, clear context, and creator-authentic phrasing.",
    preferredModel: "gemma3:12b",
    systemPrompt: `Act as an evidence-first YouTube Shorts packaging editor for gaming clips.
Treat the clip name, transcript, known game or series fields, and existing draft as the current clip evidence. Saved examples are style references only and never supply facts about the current clip. Never invent a game, character, outcome, quote, or event. If the evidence is thin, use cautious wording instead of filling gaps.
Make the moment understandable before the viewer presses play: name the specific situation, surface the turn or payoff, and keep the creator's voice natural. Generate meaningfully different candidates rather than synonyms. Titles should be concise, mobile-readable, specific, and curiosity-driven without empty hype, forced slang, reaction-only wording, or keyword stuffing. Descriptions should add context instead of repeating the title. Tags and hashtags should be short, relevant, and limited to terms supported by the evidence.
Use the requested angle as a real editorial difference: specific_fail names the concrete mistake or failure; panic_tension escalates the immediate danger; social_chaos foregrounds the interaction or chaos. Favor truthful curiosity over manufactured clickbait.
Treat the uploader as the creator or streamer. Use first-person wording only when trusted speaker context identifies the creator's speech, and never force "I" into every title. Treat collaborators as appearing with the creator, and keep unconfirmed speech neutral rather than inventing an identity.`,
    promptVersion: DEFAULT_AI_PROFILE_PROMPT_VERSION,
    speakerContextSettings: { ...DEFAULT_SPEAKER_CONTEXT_SETTINGS },
    learningSettings: { ...DEFAULT_AI_PROFILE_LEARNING_SETTINGS },
    knowledgeEntries: [],
    enabled: true,
    builtIn: true,
    createdAt: DEFAULT_AI_PROFILE_TIMESTAMP,
    updatedAt: DEFAULT_AI_PROFILE_TIMESTAMP
  },
  {
    id: "ai-profile-youtube-metadata-punchy",
    name: "YouTube Metadata Punchy",
    task: YOUTUBE_METADATA_TASK,
    description: "Sharper title and hook bias for social-chaos, panic, and high-energy gaming moments.",
    preferredModel: "qwen3:14b",
    systemPrompt: `Be a sharp but honest Shorts hook editor for gaming moments.
Find the most emotionally legible beat and package it with tension, contrast, and a clear payoff. Treat saved examples as style references only; never copy their events, entities, outcomes, or tags unless the current clip evidence supports them. Punch should come from a precise situation or interaction, never from exaggerating what the transcript says. Do not use generic bait such as "you won't believe this", vague reaction titles, fake stakes, invented outcomes, or random slang.
Produce candidates that are materially different: one can lead with the concrete fail, one with the escalating panic, and one with the social or creator-versus-collaborator chaos. Keep titles concise and readable on a phone, make the viewer's unanswered question obvious, and preserve the creator's authentic voice. Only use game, series, character, quote, or outcome details that are supplied as evidence.
Treat the uploader as the creator or streamer. Use first-person wording only for trusted creator speech; never attribute unknown lines to the streamer, and treat collaborators as participants rather than the owner of the channel.`,
    promptVersion: DEFAULT_AI_PROFILE_PROMPT_VERSION,
    speakerContextSettings: { ...DEFAULT_SPEAKER_CONTEXT_SETTINGS },
    learningSettings: { ...DEFAULT_AI_PROFILE_LEARNING_SETTINGS },
    knowledgeEntries: [],
    enabled: true,
    builtIn: true,
    createdAt: DEFAULT_AI_PROFILE_TIMESTAMP,
    updatedAt: DEFAULT_AI_PROFILE_TIMESTAMP
  },
  {
    id: "ai-profile-youtube-metadata-structured",
    name: "YouTube Metadata Structured",
    task: YOUTUBE_METADATA_TASK,
    description: "More structured and search-aware packaging for consistent tags, descriptions, and metadata hygiene.",
    preferredModel: "mistral-small:24b",
    systemPrompt: `Be an evidence-first metadata strategist for gaming YouTube Shorts.
Before writing, identify the concrete event, the relevant game or series context, the viewer question, and the strongest payoff supported by the transcript. Treat saved examples as style references only; never copy their events, entities, outcomes, or tags unless the current clip evidence supports them. Use natural search language only when it is supported; never stuff keywords or pad tags. Keep titles concise, specific, and distinct from one another. Make descriptions add useful context in the opening lines, and keep hashtags and platform tags tightly relevant.
Make every requested angle visibly different and easy for a creator to review. Explain the moment through concrete language rather than generic hype. Do not invent gameplay, people, quotes, results, trends, or searchable terms. When the source does not establish a detail, omit it.
Treat the uploader as the creator or streamer. Use trusted speaker labels to support natural creator perspective, but keep wording neutral when the creator is not confirmed and never infer identity from an unlabelled line.`,
    promptVersion: DEFAULT_AI_PROFILE_PROMPT_VERSION,
    speakerContextSettings: { ...DEFAULT_SPEAKER_CONTEXT_SETTINGS },
    learningSettings: { ...DEFAULT_AI_PROFILE_LEARNING_SETTINGS },
    knowledgeEntries: [],
    enabled: true,
    builtIn: true,
    createdAt: DEFAULT_AI_PROFILE_TIMESTAMP,
    updatedAt: DEFAULT_AI_PROFILE_TIMESTAMP
  },
  {
    id: "ai-profile-youtube-thumbnail-analyst",
    name: "YouTube Thumbnail Analyst",
    task: YOUTUBE_THUMBNAIL_TASK,
    description: "Reviews supplied video frames and guides strong, readable local thumbnail treatments.",
    preferredModel: "Qwen2.5-VL-7B-Instruct-Q4_K_M-ggml-org-official.gguf",
    systemPrompt: `You are a review-first YouTube thumbnail analyst for gaming videos.
Review only the supplied image frames and video context. Score subject clarity, action or emotion, composition, contrast, creator relevance, and small-size readability. Recommend the strongest frame and a concise local treatment brief describing focal subject, crop, colour direction, and optional short text placement. Never invent people, events, gameplay details, or text that the images do not support. Do not claim to generate an image; the application will render deterministic local candidates from your analysis.`,
    promptVersion: DEFAULT_AI_PROFILE_PROMPT_VERSION,
    learningSettings: { ...DEFAULT_AI_PROFILE_LEARNING_SETTINGS },
    knowledgeEntries: [],
    enabled: true,
    builtIn: true,
    createdAt: DEFAULT_AI_PROFILE_TIMESTAMP,
    updatedAt: DEFAULT_AI_PROFILE_TIMESTAMP
  },
  {
    id: "ai-profile-performance-coach",
    name: "Performance Coach",
    task: PERFORMANCE_COACH_TASK,
    description: "Evidence-grounded coaching for channel performance, content lanes, and next experiments.",
    preferredModel: "qwen3:14b",
    systemPrompt: `Act as an evidence-grounded performance coach for a creator's YouTube channel.
Use only the supplied channel profile, period summaries, time series, video metrics, content lanes, audience breakdowns, retention evidence, and local metadata. Start with the creator's own baseline. Separate direct observations from interpretations and recommendations. Never invent CTR, impressions, audience demographics, causes, or missing metrics.
Return concise, specific insights that name the evidence, explain the practical implication, and end with one review-first action or experiment. Respect sample size: if fewer than three comparable videos support a conclusion, lower confidence and say what data is missing. Do not automatically apply metadata, thumbnail, or publishing changes.`,
    promptVersion: DEFAULT_AI_PROFILE_PROMPT_VERSION,
    learningSettings: { ...DEFAULT_AI_PROFILE_LEARNING_SETTINGS },
    knowledgeEntries: [],
    enabled: true,
    builtIn: true,
    createdAt: DEFAULT_AI_PROFILE_TIMESTAMP,
    updatedAt: DEFAULT_AI_PROFILE_TIMESTAMP
  },
  {
    id: "ai-profile-clip-discovery-assistant",
    name: "Clip Discovery Assistant",
    task: CLIP_DISCOVERY_TASK,
    description: "Finds transcript-led gaming moments with a clear hook and payoff for review-first short creation.",
    preferredModel: "qwen3:14b",
    systemPrompt: `You are a review-first clip scout for long-form gaming content.
Select moments that can work as a short without requiring the viewer to know the rest of the stream. A strong candidate has a recognizable setup, a turn or escalation, and a payoff in the supplied timestamped transcript. Prefer surprising outcomes, genuine creator or collaborator interactions, funny misunderstandings, clutch decisions, failures, and escalating tension.
Reject filler, dead air, repetitive commentary, setup without payoff, incomplete jokes, candidates that overlap materially, and claims that depend on unseen visuals or audio. Prefer the tightest range that preserves the setup and payoff while meeting the duration rules. Write a specific hook, a reason that names the evidence and viewer value, and a confidence score calibrated to how clearly the transcript supports the moment. Return no candidate when no moment meets the bar.`,
    promptVersion: DEFAULT_AI_PROFILE_PROMPT_VERSION,
    learningSettings: { ...DEFAULT_AI_PROFILE_LEARNING_SETTINGS },
    knowledgeEntries: [],
    enabled: true,
    builtIn: true,
    createdAt: DEFAULT_AI_PROFILE_TIMESTAMP,
    updatedAt: DEFAULT_AI_PROFILE_TIMESTAMP
  }
];

const DEFAULT_AI_PROFILE_ASSIGNMENTS: AiProfileAssignments = {
  youtubeMetadataProfileId:
    DEFAULT_AI_PROFILES.find((profile) => profile.task === YOUTUBE_METADATA_TASK)?.id ?? null,
  youtubeThumbnailProfileId:
    DEFAULT_AI_PROFILES.find((profile) => profile.task === YOUTUBE_THUMBNAIL_TASK)?.id ?? null,
  performanceCoachProfileId:
    DEFAULT_AI_PROFILES.find((profile) => profile.task === PERFORMANCE_COACH_TASK)?.id ?? null,
  clipDiscoveryProfileId:
    DEFAULT_AI_PROFILES.find((profile) => profile.task === CLIP_DISCOVERY_TASK)?.id ?? null
};

export function getAiProfiles(): AiProfile[] {
  const raw = getAppSetting(AI_PROFILES_SETTING_KEY);
  if (!raw) {
    return DEFAULT_AI_PROFILES.map(cloneAiProfile);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AiProfile>[];
    return mergeAiProfilesWithBuiltIns(normalizeAiProfiles(parsed));
  } catch {
    return DEFAULT_AI_PROFILES.map(cloneAiProfile);
  }
}

export function getAiProfileAssignments(): AiProfileAssignments {
  return normalizeAiProfileAssignments(readRawAiProfileAssignments(), getAiProfiles());
}

export function isStrictAiModeEnabled(): boolean {
  return getAppSetting(AI_STRICT_MODE_SETTING_KEY) === "true";
}

export function setAiStrictModeEnabled(enabled: boolean): void {
  setAppSetting(AI_STRICT_MODE_SETTING_KEY, enabled ? "true" : "false");
}

export function saveAiProfilesConfiguration(payload: {
  profiles: AiProfile[];
  assignments: AiProfileAssignments;
}): {
  profiles: AiProfile[];
  assignments: AiProfileAssignments;
} {
  const mergedProfiles = mergeAiProfilesWithBuiltIns(normalizeAiProfiles(payload.profiles));
  const normalizedAssignments = normalizeAiProfileAssignments(payload.assignments, mergedProfiles);

  setAppSetting(AI_PROFILES_SETTING_KEY, JSON.stringify(mergedProfiles));
  if (normalizedAssignments.youtubeMetadataProfileId) {
    setAppSetting(AI_PROFILE_ASSIGNMENTS_SETTING_KEY, JSON.stringify(normalizedAssignments));
  } else {
    clearAppSetting(AI_PROFILE_ASSIGNMENTS_SETTING_KEY);
  }

  return {
    profiles: mergedProfiles,
    assignments: normalizedAssignments
  };
}

export function resolveAiProfileForTask(task: AiProfileTask): AiProfile | null {
  const profiles = getAiProfiles();
  const assignments = getAiProfileAssignments();
  const assignedProfileId = getAssignedAiProfileIdForTask(task, assignments);

  if (assignedProfileId) {
    const assignedProfile = profiles.find((profile) => profile.id === assignedProfileId);
    if (assignedProfile && assignedProfile.enabled && assignedProfile.task === task) {
      return assignedProfile;
    }
  }

  return (
    profiles.find((profile) => profile.task === task && profile.enabled) ??
    profiles.find((profile) => profile.task === task) ??
    null
  );
}

function cloneAiProfile(profile: AiProfile): AiProfile {
  return {
    ...profile,
    speakerContextSettings: profile.speakerContextSettings
      ? { ...profile.speakerContextSettings }
      : undefined,
    learningSettings: { ...profile.learningSettings },
    knowledgeEntries: profile.knowledgeEntries.map((entry) => ({
      ...entry,
      tags: [...entry.tags]
    }))
  };
}

function normalizeAiProfiles(payload: Partial<AiProfile>[] | null | undefined): AiProfile[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((profile) => (profile as { task?: unknown }).task !== "trend_research")
    .map((profile) => normalizeAiProfile(profile))
    .filter((profile) => profile.name.length > 0);
}

function normalizeAiProfile(profile: Partial<AiProfile>): AiProfile {
  const now = new Date().toISOString();
  const preferredModel =
    typeof profile.preferredModel === "string" && profile.preferredModel.trim().length > 0
      ? profile.preferredModel.trim()
      : null;
  const task = normalizeAiProfileTask(profile.task);

  return {
    id: typeof profile.id === "string" && profile.id.trim().length > 0 ? profile.id.trim() : randomUUID(),
    name: typeof profile.name === "string" ? profile.name.trim() : "",
    task,
    description: typeof profile.description === "string" ? profile.description.trim() : "",
    preferredModel,
    systemPrompt: typeof profile.systemPrompt === "string" ? profile.systemPrompt.trim() : "",
    promptVersion: normalizeAiProfilePromptVersion(profile.promptVersion),
    speakerContextSettings:
      task === YOUTUBE_METADATA_TASK
        ? normalizeSpeakerContextSettings(profile.speakerContextSettings)
        : undefined,
    learningSettings: normalizeAiProfileLearningSettings(profile.learningSettings),
    knowledgeEntries: normalizeAiProfileKnowledgeEntries(profile.knowledgeEntries),
    enabled: profile.enabled !== false,
    builtIn: profile.builtIn === true,
    createdAt: typeof profile.createdAt === "string" ? profile.createdAt : now,
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : now
  };
}

function mergeAiProfilesWithBuiltIns(profiles: AiProfile[]): AiProfile[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const mergedBuiltIns = DEFAULT_AI_PROFILES.map((defaultProfile) => {
    const savedProfile = profilesById.get(defaultProfile.id);
    if (!savedProfile) {
      return cloneAiProfile(defaultProfile);
    }

    profilesById.delete(defaultProfile.id);
    return {
      ...defaultProfile,
      name: savedProfile.name || defaultProfile.name,
      description: savedProfile.description || defaultProfile.description,
      preferredModel: savedProfile.preferredModel ?? defaultProfile.preferredModel,
      systemPrompt:
        shouldRefreshLegacyDefaultPrompt(savedProfile, defaultProfile)
          ? defaultProfile.systemPrompt
          : savedProfile.systemPrompt || defaultProfile.systemPrompt,
      promptVersion:
        shouldRefreshLegacyDefaultPrompt(savedProfile, defaultProfile)
          ? defaultProfile.promptVersion
          : savedProfile.promptVersion ?? defaultProfile.promptVersion,
      speakerContextSettings:
        defaultProfile.task === YOUTUBE_METADATA_TASK
          ? normalizeSpeakerContextSettings(savedProfile.speakerContextSettings ?? defaultProfile.speakerContextSettings)
          : undefined,
      learningSettings: normalizeAiProfileLearningSettings(savedProfile.learningSettings ?? defaultProfile.learningSettings),
      knowledgeEntries: normalizeAiProfileKnowledgeEntries(savedProfile.knowledgeEntries ?? defaultProfile.knowledgeEntries),
      enabled: savedProfile.enabled,
      updatedAt: savedProfile.updatedAt || defaultProfile.updatedAt
    };
  });

  const customProfiles = [...profilesById.values()]
    .map((profile) => ({
      ...profile,
      builtIn: false,
      updatedAt: profile.updatedAt || new Date().toISOString()
    }))
    .filter((profile) => isSupportedAiProfileTask(profile.task))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return [...mergedBuiltIns, ...customProfiles];
}

function shouldRefreshLegacyDefaultPrompt(savedProfile: AiProfile, defaultProfile: AiProfile): boolean {
  return (
    savedProfile.promptVersion !== DEFAULT_AI_PROFILE_PROMPT_VERSION &&
    LEGACY_DEFAULT_AI_PROFILE_PROMPTS[defaultProfile.id] === savedProfile.systemPrompt
  );
}

function normalizeAiProfilePromptVersion(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function normalizeSpeakerContextSettings(
  value: Partial<NonNullable<AiProfile["speakerContextSettings"]>> | null | undefined
): NonNullable<AiProfile["speakerContextSettings"]> {
  return {
    enabled: value?.enabled !== false,
    warnWhenStreamerUnidentified: value?.warnWhenStreamerUnidentified !== false
  };
}

function normalizeAiProfileLearningSettings(
  payload: Partial<AiProfileLearningSettings> | null | undefined
): AiProfileLearningSettings {
  const mode: AiProfileLearningMode =
    payload?.mode === "off" || payload?.mode === "retrieval" || payload?.mode === "adaptive_prompt"
      ? payload.mode
      : DEFAULT_AI_PROFILE_LEARNING_SETTINGS.mode;
  const requestedLimit = Number(payload?.maxKnowledgeEntries);

  return {
    mode,
    maxKnowledgeEntries: Number.isFinite(requestedLimit)
      ? Math.max(0, Math.min(50, Math.round(requestedLimit)))
      : DEFAULT_AI_PROFILE_LEARNING_SETTINGS.maxKnowledgeEntries,
    includeApprovedExamples: payload?.includeApprovedExamples !== false,
    includeHighPerformingExamples: payload?.includeHighPerformingExamples !== false,
    includeRejectedExamples: payload?.includeRejectedExamples !== false
  };
}

function normalizeAiProfileKnowledgeEntries(
  payload: Partial<AiProfileKnowledgeEntry>[] | null | undefined
): AiProfileKnowledgeEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      const now = new Date().toISOString();
      return {
        id: typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id.trim() : randomUUID(),
        title: typeof entry.title === "string" ? entry.title.trim().slice(0, 120) : "",
        content: typeof entry.content === "string" ? entry.content.trim().slice(0, 4_000) : "",
        tags: Array.isArray(entry.tags)
          ? entry.tags.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, 12)
          : [],
        enabled: entry.enabled !== false,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now
      } satisfies AiProfileKnowledgeEntry;
    })
    .filter((entry) => entry.title.length > 0 && entry.content.length > 0)
    .slice(0, 50);
}

function readRawAiProfileAssignments(): Partial<AiProfileAssignments> | null {
  const raw = getAppSetting(AI_PROFILE_ASSIGNMENTS_SETTING_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Partial<AiProfileAssignments>;
  } catch {
    return null;
  }
}

function normalizeAiProfileAssignments(
  payload: Partial<AiProfileAssignments> | null | undefined,
  profiles: AiProfile[]
): AiProfileAssignments {
  const requestedProfileId =
    typeof payload?.youtubeMetadataProfileId === "string" && payload.youtubeMetadataProfileId.trim().length > 0
      ? payload.youtubeMetadataProfileId.trim()
      : null;
  const requestedYouTubeThumbnailProfileId =
    typeof payload?.youtubeThumbnailProfileId === "string" && payload.youtubeThumbnailProfileId.trim().length > 0
      ? payload.youtubeThumbnailProfileId.trim()
      : null;
  const requestedPerformanceCoachProfileId =
    typeof payload?.performanceCoachProfileId === "string" && payload.performanceCoachProfileId.trim().length > 0
      ? payload.performanceCoachProfileId.trim()
      : null;
  const requestedClipDiscoveryProfileId =
    typeof payload?.clipDiscoveryProfileId === "string" && payload.clipDiscoveryProfileId.trim().length > 0
      ? payload.clipDiscoveryProfileId.trim()
      : null;

  return {
    youtubeMetadataProfileId:
      selectAssignableAiProfileId(profiles, YOUTUBE_METADATA_TASK, requestedProfileId) ??
      DEFAULT_AI_PROFILE_ASSIGNMENTS.youtubeMetadataProfileId,
    youtubeThumbnailProfileId:
      selectAssignableAiProfileId(profiles, YOUTUBE_THUMBNAIL_TASK, requestedYouTubeThumbnailProfileId) ??
      DEFAULT_AI_PROFILE_ASSIGNMENTS.youtubeThumbnailProfileId,
    performanceCoachProfileId:
      selectAssignableAiProfileId(profiles, PERFORMANCE_COACH_TASK, requestedPerformanceCoachProfileId) ??
      DEFAULT_AI_PROFILE_ASSIGNMENTS.performanceCoachProfileId ??
      null,
    clipDiscoveryProfileId:
      selectAssignableAiProfileId(profiles, CLIP_DISCOVERY_TASK, requestedClipDiscoveryProfileId) ??
      DEFAULT_AI_PROFILE_ASSIGNMENTS.clipDiscoveryProfileId
  };
}

function getAssignedAiProfileIdForTask(task: AiProfileTask, assignments: AiProfileAssignments): string | null {
  switch (task) {
    case "youtube_metadata":
      return assignments.youtubeMetadataProfileId;
    case "youtube_thumbnail":
      return assignments.youtubeThumbnailProfileId;
    case "performance_coach":
      return assignments.performanceCoachProfileId ?? null;
    case "clip_discovery":
      return assignments.clipDiscoveryProfileId;
  }
}

function normalizeAiProfileTask(task: unknown): AiProfileTask {
  if (task === YOUTUBE_THUMBNAIL_TASK) {
    return YOUTUBE_THUMBNAIL_TASK;
  }
  if (task === CLIP_DISCOVERY_TASK) {
    return CLIP_DISCOVERY_TASK;
  }
  if (task === PERFORMANCE_COACH_TASK) {
    return PERFORMANCE_COACH_TASK;
  }

  return YOUTUBE_METADATA_TASK;
}

function isSupportedAiProfileTask(task: string): task is AiProfileTask {
  return task === YOUTUBE_METADATA_TASK || task === YOUTUBE_THUMBNAIL_TASK || task === PERFORMANCE_COACH_TASK || task === CLIP_DISCOVERY_TASK;
}

function selectAssignableAiProfileId(
  profiles: AiProfile[],
  task: AiProfileTask,
  requestedProfileId: string | null
): string | null {
  const taskProfiles = profiles.filter((profile) => profile.task === task);
  const enabledProfiles = taskProfiles.filter((profile) => profile.enabled);
  const assignedProfile = requestedProfileId
    ? enabledProfiles.find((profile) => profile.id === requestedProfileId)
    : null;

  return assignedProfile?.id ?? enabledProfiles[0]?.id ?? taskProfiles[0]?.id ?? null;
}
