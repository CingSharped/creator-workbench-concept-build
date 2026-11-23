import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AiExecutionMode,
  AiGenerationProvenance,
  AiLearningContextProvenance,
  ClipMetadataPackageDraft,
  CollaboratorProfile,
  GeneratedClipMetadataCandidatesResult,
  MetadataScoreSnapshot,
  MetadataVariantAngle,
  MetadataVariantKind,
  MetadataVariantRecord,
  MetadataVariantSource,
  SpeakerContextSummary,
  TranscriptRecord,
  TranscriptSegmentRecord
} from "../../shared/contracts";
import { stripExistingProfileBlocks } from "../../shared/creatorProfileLinks";
import { parseJsonResponse } from "../../shared/jsonResponse";
import { CREATOR_SPEAKER_ID, CREATOR_SPEAKER_LABEL } from "../../shared/speakerProfiles";
import { isStrictAiModeEnabled, resolveAiProfileForTask } from "./aiProfileService";
import { buildAiProfileLearningContext } from "./aiProfileLearningService";
import { AI_LEARNING_LIMITS, selectMetadataFeedbackForProfile, selectMetadataPackagesForProfile } from "./aiLearningScope";
import { getClipMetadataByClipId, listClipMetadataPackages } from "./clipMetadataRepository";
import { getClipById } from "./clipRepository";
import { getCollaboratorProfiles } from "./creatorProfileLinks";
import { listMetadataFeedback } from "./metadataFeedbackRepository";
import {
  scoreYouTubeMetadataPackage,
  type MetadataScoringContext
} from "./metadataScoringService";
import {
  listMetadataVariantsByClipId,
  replaceMetadataVariantsForClip,
  updateMetadataVariantScores
} from "./metadataVariantRepository";
import { generateAiText } from "./aiExecutionService";
import { listScheduledPosts } from "./scheduledPostRepository";
import { getTranscriptByClipId } from "./transcriptRepository";
import { listYouTubePerformanceSnapshots } from "./youtubePerformanceSnapshotRepository";
import { buildSpeakerContextSummary, classifySpeakerAssignment, isTrustedSpeakerAssignment } from "../../shared/speakerContext";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "up",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "with",
  "you",
  "your"
]);

const OLLAMA_METADATA_MODEL_PREFERENCE = [
  "gemma3:12b",
  "qwen3:14b",
  "qwen3:8b",
  "gemma3:4b",
  "llama3.1:8b",
  "llama3.1:8b-instruct-q8_0"
];
const MAX_PROMPT_TRANSCRIPT_CHARS = 12000;

const TITLE_ANGLES: MetadataVariantAngle[] = ["specific_fail", "panic_tension", "social_chaos"];
const DESCRIPTION_ANGLES: MetadataVariantAngle[] = ["context_forward", "search_forward"];
const HASHTAG_ANGLES: MetadataVariantAngle[] = ["default", "alt"];
const PLATFORM_TAG_ANGLES: MetadataVariantAngle[] = ["default"];
const DEFAULT_VARIANT_KIND_ORDER: MetadataVariantKind[] = [
  "title",
  "description",
  "public_hashtags",
  "platform_tags"
];
const GENERIC_TAG_TERMS = new Set([
  "gaming",
  "games",
  "gameplay",
  "funny",
  "shorts",
  "clip",
  "clips",
  "video",
  "viral"
]);
const TONE_TAG_RULES: Array<{
  publicTag: string;
  platformTags: string[];
  patterns: RegExp[];
}> = [
  {
    publicTag: "gamingfail",
    platformTags: ["gaming fail", "fail"],
    patterns: [/\bfail(?:ed|ure)?\b/, /\bbroke\b/, /\bpanic(?:ked)?\b/, /\blost\b/, /\bdied\b/, /\bfell\b/]
  },
  {
    publicTag: "funny",
    platformTags: ["funny moments", "comedy gaming"],
    patterns: [/\bfunny\b/, /\blaugh(?:ed|ing)?\b/, /\babsurd\b/, /\bchaos\b/, /\bbroke my\b/]
  },
  {
    publicTag: "scary",
    platformTags: ["scary moments", "horror gaming"],
    patterns: [/\bscary\b/, /\bhorror\b/, /\bmonster\b/, /\bcreepy\b/, /\bhorrific\b/, /\bchase\b/]
  },
  {
    publicTag: "clutch",
    platformTags: ["clutch moment", "close call"],
    patterns: [/\bclutch\b/, /\bbarely\b/, /\bjust in time\b/, /\bmade it\b/, /\bsaved\b/]
  },
  {
    publicTag: "stealth",
    platformTags: ["stealth gameplay", "stealth"],
    patterns: [/\bstealth(?:y)?\b/, /\bsneak(?:y|ing)?\b/, /\bhid(?:e|ing)\b/, /\bquiet\b/]
  }
];
const LANE_TAG_RULES: Array<{
  publicTag: string | null;
  platformTags: string[];
  patterns: RegExp[];
}> = [
  {
    publicTag: "coop",
    platformTags: ["co op", "multiplayer"],
    patterns: [/\bco[\s-]?op\b/, /\bfriends\b/, /\bteammate\b/, /\bmultiplayer\b/, /\bwe\b/, /\bour\b/]
  },
  {
    publicTag: "partygames",
    platformTags: ["party games", "co op chaos"],
    patterns: [/\bcrew\b/, /\bparty\b/, /\bchaos\b/, /\bvoice\b/]
  },
  {
    publicTag: "horrorgaming",
    platformTags: ["horror gaming"],
    patterns: [/\bhorror\b/, /\bmonster\b/, /\bscary\b/, /\bcreepy\b/, /\bnightmare\b/]
  },
  {
    publicTag: "soulsborne",
    platformTags: ["soulsborne"],
    patterns: [/\bsouls\b/, /\belden ring\b/, /\bdark souls\b/, /\bsekiro\b/, /\bbloodborne\b/]
  },
  {
    publicTag: "shooter",
    platformTags: ["fps", "shooter gameplay"],
    patterns: [/\bhalo\b/, /\bweapon\b/, /\bgun\b/, /\battachment\b/, /\bloadout\b/, /\bfps\b/]
  }
];

interface GenerateClipMetadataCandidatesOptions {
  kinds?: MetadataVariantKind[];
  append?: boolean;
  seriesKey?: string;
  gameTitle?: string;
  existingPackage?: ClipMetadataPackageDraft | null;
}

interface OllamaVariantShape {
  angle?: string;
  kind?: unknown;
  type?: unknown;
  field?: unknown;
  content?: unknown;
  title?: unknown;
  description?: unknown;
  text?: unknown;
  tags?: unknown;
  hashtags?: unknown;
  publicHashtags?: unknown;
  platformTags?: unknown;
  value?: unknown;
}

interface OllamaCandidateResponse {
  titleVariants?: OllamaVariantShape[];
  descriptionVariants?: OllamaVariantShape[];
  publicHashtagSets?: OllamaVariantShape[];
  platformTagSets?: OllamaVariantShape[];
}

interface LearningExample {
  clipId: string;
  title: string;
  description: string;
  publicHashtags: string[];
  platformTags: string[];
  seriesKey: string;
  gameTitle: string;
  performanceScore: number | null;
}

interface LearningContext {
  approvedExamples: LearningExample[];
  highPerformingExamples: LearningExample[];
  rejectedExamples: LearningExample[];
  approvedExampleCount: number;
  highPerformingExampleCount: number;
}

type CollaboratorPresenceSource = "selected" | "transcript" | "selected_and_transcript";

interface CollaboratorPresenceSummary {
  id: string;
  displayName: string;
  spokenSegmentCount: number;
  presenceSource: CollaboratorPresenceSource;
}

interface ClipMetadataContext {
  clipName: string;
  transcriptText: string;
  transcriptPromptText: string;
  clipDurationSeconds: number | null;
  seriesKey: string;
  gameTitle: string;
  creatorSpokenSegmentCount: number;
  collaborators: CollaboratorPresenceSummary[];
  speakerContext: SpeakerContextSummary;
  speakerContextEnabled: boolean;
  learningContext: LearningContext;
  existingPackage: ClipMetadataPackageDraft;
  aiProfileId: string | null;
  aiProfileName: string | null;
  aiProfilePrompt: string;
  aiProfileLearningPrompt: string | null;
  learningProvenance: AiLearningContextProvenance | null;
  preferredModel: string | null;
}

export async function generateClipMetadataCandidatesForClip(
  clipId: string,
  options: GenerateClipMetadataCandidatesOptions = {}
): Promise<GeneratedClipMetadataCandidatesResult> {
  // Keep YouTube metadata generation review-first: titles, descriptions, and tags stay grouped
  // under one worker task, and the user still chooses from multiple candidate variants.
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  const transcript = getTranscriptByClipId(clipId);
  const existingMetadata = getClipMetadataByClipId(clipId);
  const aiProfile = resolveAiProfileForTask("youtube_metadata");
  const requestedKinds = normalizeRequestedKinds(options.kinds);
  const learningContext = buildLearningContext(
    clipId,
    normalizeContextValue(options.seriesKey ?? options.existingPackage?.seriesKey ?? existingMetadata?.seriesKey ?? ""),
    aiProfile
  );
  const context = buildClipMetadataContext({
    clipDisplayName: clip.displayName,
    clipDurationMs: clip.durationMs,
    transcript,
    options,
    existingMetadata,
    learningContext,
    aiProfile
  });
  const generationId = randomUUID();
  const strictAiModeEnabled = isStrictAiModeEnabled();

  const ollamaResult = await tryGenerateWithOllama({
    generationId,
    requestedKinds,
    context
  });

  const missingRequiredVariantKeys = collectMissingRequiredVariantKeys(requestedKinds, ollamaResult.variants);
  if (strictAiModeEnabled && (ollamaResult.variants.length === 0 || missingRequiredVariantKeys.length > 0)) {
    throw new Error(buildStrictAiMetadataFailureMessage(ollamaResult.note, requestedKinds, missingRequiredVariantKeys));
  }

  const fallbackVariants = buildHeuristicVariants({
    generationId,
    requestedKinds,
    context
  });

  const generatedVariants = mergeGeneratedAndFallbackVariants({
    requestedKinds,
    ollamaVariants: ollamaResult.variants,
    fallbackVariants
  });

  const executionMode = resolveMetadataExecutionMode(generatedVariants);
  const learningExampleClipIds = [
    ...learningContext.approvedExamples,
    ...learningContext.highPerformingExamples,
    ...learningContext.rejectedExamples
  ].reduce<string[]>((clipIds, example) => {
    if (!clipIds.includes(example.clipId)) {
      clipIds.push(example.clipId);
    }
    return clipIds;
  }, []);
  const provenance: AiGenerationProvenance = {
    task: "youtube_metadata",
    profileId: context.aiProfileId,
    model: ollamaResult.model,
    executionMode,
    inputRecordIds: [clipId, transcript?.id].filter((value): value is string => Boolean(value)),
    learningExampleClipIds,
    learningContext: context.learningProvenance,
    speakerContext: context.speakerContext
  };

  replaceMetadataVariantsForClip(
    clipId,
    generatedVariants.map((variant) => ({
      generationId,
      platform: "youtube",
      kind: variant.kind,
      angle: variant.angle,
      content: variant.content,
      source: variant.source,
      scoreSnapshot: null,
      provenance
    })),
    { append: options.append === true }
  );

  const persistedVariants = listMetadataVariantsByClipId(clipId);
  const recommendedPackage = buildRecommendedMetadataPackage({
    existingPackage: context.existingPackage,
    variants: persistedVariants,
    clipId,
    learningContext
  });
  const scoredVariants = scoreVariantsAgainstRecommendedPackage({
    recommendedPackage,
    variants: persistedVariants,
    clipId,
    learningContext
  });

  updateMetadataVariantScores(
    scoredVariants.map((variant) => ({
      id: variant.id,
      scoreSnapshot: variant.scoreSnapshot
    }))
  );

  return {
    generationId,
    recommendedPackage,
    variants: listMetadataVariantsByClipId(clipId),
    model: ollamaResult.model,
    profileId: context.aiProfileId,
    profileName: context.aiProfileName,
    executionMode,
    issueSummary: buildGenerationIssueSummary(ollamaResult.note, generatedVariants),
    note: buildGenerationNote(ollamaResult.note, generatedVariants),
    source: generatedVariants.every((variant) => variant.source === "ollama") ? "ollama" : "heuristic",
    speakerContext: context.speakerContext
  };
}

export function evaluateClipMetadataPackageForClip(
  clipId: string,
  payload: ClipMetadataPackageDraft
): MetadataScoreSnapshot {
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  const transcript = getTranscriptByClipId(clipId);
  const aiProfile = resolveAiProfileForTask("youtube_metadata");
  const learningContext = buildLearningContext(clipId, normalizeContextValue(payload.seriesKey), aiProfile);
  return scoreYouTubeMetadataPackage(
    buildMetadataScoringContext({
      clipId,
      clip,
      transcriptText: buildCanonicalTranscriptText(transcript),
      srtContent: transcript?.srtContent ?? "",
      transcriptSegments: transcript?.segments ?? [],
      metadataPackage: normalizePackageDraft(payload),
      learningContext
    })
  );
}

function buildClipMetadataContext(input: {
  clipDisplayName: string;
  clipDurationMs: number | null;
  transcript: TranscriptRecord | null;
  options: GenerateClipMetadataCandidatesOptions;
  existingMetadata: ClipMetadataPackageDraft | null;
  learningContext: LearningContext;
  aiProfile: ReturnType<typeof resolveAiProfileForTask>;
}): ClipMetadataContext {
  const clipName = cleanClipName(input.clipDisplayName);
  const transcriptText = buildCanonicalTranscriptText(input.transcript);
  const basePackage = createBaseMetadataPackage({
    clipName,
    transcriptText,
    clipDurationMs: input.clipDurationMs,
    existingPackage: input.options.existingPackage ?? input.existingMetadata,
    seriesKey: input.options.seriesKey ?? input.options.existingPackage?.seriesKey ?? input.existingMetadata?.seriesKey ?? "",
    gameTitle: input.options.gameTitle ?? input.options.existingPackage?.gameTitle ?? input.existingMetadata?.gameTitle ?? ""
  });
  const transcriptMetadataContext = buildTranscriptMetadataContext(
    input.transcript,
    basePackage.collaboratorProfileIds
  );
  const profileLearning = buildAiProfileLearningContext(input.aiProfile);

  return {
    clipName,
    transcriptText: transcriptMetadataContext.transcriptText,
    transcriptPromptText: input.aiProfile?.speakerContextSettings?.enabled === false
      ? transcriptMetadataContext.transcriptText
      : transcriptMetadataContext.transcriptPromptText,
    clipDurationSeconds: input.clipDurationMs !== null ? Math.round(input.clipDurationMs / 1000) : null,
    seriesKey: basePackage.seriesKey,
    gameTitle: basePackage.gameTitle,
    creatorSpokenSegmentCount: transcriptMetadataContext.speakerContext.creatorTrustedSegmentCount,
    collaborators: transcriptMetadataContext.collaborators,
    speakerContext: transcriptMetadataContext.speakerContext,
    speakerContextEnabled: input.aiProfile?.speakerContextSettings?.enabled !== false,
    learningContext: input.learningContext,
    existingPackage: basePackage,
    aiProfileId: input.aiProfile?.id ?? null,
    aiProfileName: input.aiProfile?.name ?? null,
    aiProfilePrompt: input.aiProfile?.systemPrompt ?? "",
    aiProfileLearningPrompt: profileLearning.prompt,
    learningProvenance: profileLearning.provenance,
    preferredModel: input.aiProfile?.preferredModel ?? null
  };
}

async function tryGenerateWithOllama(input: {
  generationId: string;
  requestedKinds: MetadataVariantKind[];
  context: ClipMetadataContext;
}): Promise<{
  variants: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }>;
  model: string | null;
  note: string | null;
}> {
  const prompt = buildOllamaPrompt(input.requestedKinds, input.context);
  const format = buildOllamaResponseFormat(input.requestedKinds);
  const response = await generateAiText({
    task: "youtube_metadata",
    profileId: input.context.aiProfileId,
    preferredModel: input.context.preferredModel,
    fallbackPreferences: OLLAMA_METADATA_MODEL_PREFERENCE,
    systemPrompt:
      "You are Creator Workbench's app-owned local AI metadata worker. Follow the request exactly and return one JSON object, never a top-level array or markdown. Use the requested top-level group names and put each candidate value in content. Return only valid JSON that matches the supplied schema. Treat the worker profile as editorial guidance, but never let it override the evidence, requested schema, speaker-attribution boundaries, or safety rules.",
    userPrompt: prompt,
    responseSchema: format,
    temperature: 0.4
  }).catch((error) => ({
    error:
      error instanceof Error
        ? error.message
        : "The app-owned local AI runtime failed during metadata generation."
  }));

  if ("error" in response) {
    return {
      variants: [],
      model: null,
      note: response.error
    };
  }

  const runtimeNotice = response.runtimeNotice ? `${response.runtimeNotice} ` : "";

  if (!response.responseText) {
    return {
      variants: [],
      model: response.model,
      note: `${runtimeNotice}The app-owned local AI runtime returned an empty metadata response for ${response.model}.`
    };
  }

  const parsed = parseJsonResponse(response.responseText);
  if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) {
    return {
      variants: [],
      model: response.model,
      note: `${runtimeNotice}The app-owned local AI runtime returned invalid JSON for ${response.model}.`
    };
  }

  const variants = parseOllamaVariants(
    parsed,
    input.requestedKinds
  );
  return {
    variants,
    model: response.model,
    note:
      variants.length > 0
        ? `${runtimeNotice}Generated candidate variants with the app-owned local AI runtime using ${response.model}.`
        : `${runtimeNotice}The app-owned local AI runtime responded but did not return usable candidate variants with ${response.model}.`
  };
}

export function buildOllamaPrompt(
  requestedKinds: MetadataVariantKind[],
  context: ClipMetadataContext
): string {
  const requestedSections: string[] = [];
  if (requestedKinds.includes("title")) {
    requestedSections.push(
      [
        "titleVariants:",
        '- exactly 3 objects with angles "specific_fail", "panic_tension", and "social_chaos"',
        "- content must be a single title string per object",
        "- titles should feel like YouTube Shorts packaging for gaming clips",
        "- avoid vague reaction-only titles"
      ].join("\n")
    );
  }
  if (requestedKinds.includes("description")) {
    requestedSections.push(
      [
        "descriptionVariants:",
        '- exactly 2 objects with angles "context_forward" and "search_forward"',
        "- content must be a short YouTube-first description string with 2 to 5 lines",
        "- descriptions should support the title, clarify context, and stay creator-authentic"
      ].join("\n")
    );
  }
  if (requestedKinds.includes("public_hashtags")) {
    requestedSections.push(
      [
        "publicHashtagSets:",
        '- exactly 2 objects with angles "default" and "alt"',
        "- content must be an array of 2 to 4 short public hashtags without the # symbol",
        "- prefer one identity tag, one tone or outcome tag, and one lane or format tag",
        "- include game or series context when it helps"
      ].join("\n")
    );
  }
  if (requestedKinds.includes("platform_tags")) {
    requestedSections.push(
      [
        "platformTagSets:",
        '- exactly 1 object with angle "default"',
        "- content must be an array of 6 to 10 platform tags without # symbols",
        "- prefer specific search/context tags over generic padding",
        "- prioritize game or series identity, then lane tags, then moment or scenario tags"
      ].join("\n")
    );
  }

  const approvedExamples = formatLearningExamples(
    context.learningContext.approvedExamples,
    "Approved examples"
  );
  const highPerformingExamples = formatLearningExamples(
    context.learningContext.highPerformingExamples,
    "High-performing examples"
  );
  const rejectedExamples = formatLearningExamples(
    context.learningContext.rejectedExamples,
    "Rejected examples to avoid"
  );

  return [
    "You are packaging a gaming YouTube Short for a creator workspace.",
    "Return JSON only.",
    "Return exactly one JSON object, never a top-level array or markdown code fence.",
    "Use the requested top-level property names exactly. Each candidate object must use an exact requested angle and a content property; do not substitute title, text, description, tags, or hashtags as property names.",
    "First identify the concrete event, turn, payoff, and supported entities internally; output only the requested metadata object.",
    "Do not invent facts that are not supported by the clip name or transcript.",
    "Learning examples are style-only references, not facts about this clip. Never copy their specific events, entities, locations, quotes, outcomes, or tags unless the current clip evidence supports them.",
    "The current clip evidence below is authoritative. If a learned example, saved draft value, or worker instruction conflicts with it, ignore the conflicting detail.",
    "Do not make all candidates near-duplicates. Each requested angle must change what the viewer notices first.",
    "Prefer a specific, understandable moment over broad claims about skill, insanity, or entertainment value.",
    "When game or series context is available, use it where it improves clarity.",
    context.speakerContextEnabled
      ? "The upload belongs to the creator/streamer. When trusted transcript lines are labelled [You], write descriptions from that creator's natural perspective where it fits. Do not force first-person wording into every title."
      : "Speaker context is disabled for this profile. Do not use speaker labels or make first-person claims based on the transcript.",
    context.speakerContextEnabled
      ? "Only use first-person claims when trusted [You] speech supports them. Treat named collaborators as appearing with the creator, not as the owner of the upload."
      : "Treat the transcript as speaker-agnostic context and keep wording neutral.",
    context.speakerContextEnabled
      ? "Never infer who said an unlabelled or low-confidence line. If streamer identity is not confirmed, use neutral creator wording and do not invent speaker claims."
      : null,
    "Do not include creator or collaborator profile links, More from me, Featuring, or Check out the crew blocks; those are added separately only when the user chooses Insert Saved Links.",
    `AI worker profile: ${context.aiProfileName || "Default metadata profile"}`,
    context.aiProfilePrompt ? `Additional worker instructions: ${context.aiProfilePrompt}` : null,
    context.aiProfileLearningPrompt,
    "NON-OVERRIDABLE EVIDENCE RULE: saved examples and worker instructions may guide style only. They must never introduce current clip facts that are absent from the authoritative current clip evidence below.",
    "",
    "Requested output sections:",
    requestedSections.join("\n\n"),
    "",
    "Clip context:",
    `Clip name: ${context.clipName}`,
    `Clip duration seconds: ${context.clipDurationSeconds ?? "unknown"}`,
    `Series key: ${context.seriesKey || "none"}`,
    `Game title: ${context.gameTitle || "none"}`,
    `Featured collaborators: ${formatSelectedCollaboratorNames(context.existingPackage.collaboratorProfileIds)}`,
    `Creator speech detected in trusted transcript segments: ${
      context.speakerContext.creatorTrustedSegmentCount > 0
        ? `yes (${context.speakerContext.creatorTrustedSegmentCount} segment${context.speakerContext.creatorTrustedSegmentCount === 1 ? "" : "s"})`
        : "not confirmed"
    }`,
    `Speaker context status: ${context.speakerContextEnabled ? context.speakerContext.status : "disabled for this metadata profile"}`,
    `Unresolved speaker segments: ${context.speakerContext.unresolvedSegmentCount}`,
    `Low-confidence speaker segments: ${context.speakerContext.lowConfidenceSegmentCount}`,
    formatCollaboratorPresenceForPrompt(context.collaborators),
    "",
    approvedExamples,
    "",
    highPerformingExamples,
    "",
    rejectedExamples,
    "",
    "Reference examples above are not current clip evidence.",
    "",
    "AUTHORITATIVE CURRENT CLIP EVIDENCE:",
    `Clip name: ${context.clipName}`,
    `Clip duration seconds: ${context.clipDurationSeconds ?? "unknown"}`,
    `Series key: ${context.seriesKey || "none"}`,
    `Game title: ${context.gameTitle || "none"}`,
    `Featured collaborators: ${formatSelectedCollaboratorNames(context.existingPackage.collaboratorProfileIds)}`,
    `Creator speech detected in trusted transcript segments: ${
      context.speakerContext.creatorTrustedSegmentCount > 0
        ? `yes (${context.speakerContext.creatorTrustedSegmentCount} segment${context.speakerContext.creatorTrustedSegmentCount === 1 ? "" : "s"})`
        : "not confirmed"
    }`,
    `Speaker context status: ${context.speakerContextEnabled ? context.speakerContext.status : "disabled for this metadata profile"}`,
    `Unresolved speaker segments: ${context.speakerContext.unresolvedSegmentCount}`,
    `Low-confidence speaker segments: ${context.speakerContext.lowConfidenceSegmentCount}`,
    formatCollaboratorPresenceForPrompt(context.collaborators),
    "",
    "Current selected package draft (continuity hint only; do not introduce unsupported facts from it):",
    `Title: ${context.existingPackage.title || "none"}`,
    `Description: ${context.existingPackage.description || "none"}`,
    `Public hashtags: ${context.existingPackage.publicHashtags.join(", ") || "none"}`,
    `Platform tags: ${context.existingPackage.platformTags.join(", ") || "none"}`,
    "",
    "Transcript:",
    truncateTranscriptForPrompt(context.transcriptPromptText || context.transcriptText) || "No transcript is available yet.",
    "",
    "FINAL GROUNDING CHECK: remove any detail that is not supported by the current clip name, current metadata fields, or transcript. Do not copy a learned example's facts just because it performed well."
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function buildOllamaResponseFormat(requestedKinds: MetadataVariantKind[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (requestedKinds.includes("title")) {
    properties.titleVariants = buildOllamaVariantArraySchema(TITLE_ANGLES, "string");
    required.push("titleVariants");
  }

  if (requestedKinds.includes("description")) {
    properties.descriptionVariants = buildOllamaVariantArraySchema(DESCRIPTION_ANGLES, "string");
    required.push("descriptionVariants");
  }

  if (requestedKinds.includes("public_hashtags")) {
    properties.publicHashtagSets = buildOllamaVariantArraySchema(HASHTAG_ANGLES, "array");
    required.push("publicHashtagSets");
  }

  if (requestedKinds.includes("platform_tags")) {
    properties.platformTagSets = buildOllamaVariantArraySchema(PLATFORM_TAG_ANGLES, "array");
    required.push("platformTagSets");
  }

  return {
    type: "object",
    properties,
    required
  };
}

function buildOllamaVariantArraySchema(
  expectedAngles: MetadataVariantAngle[],
  contentType: "string" | "array"
): Record<string, unknown> {
  return {
    type: "array",
    minItems: expectedAngles.length,
    maxItems: expectedAngles.length,
    items: {
      type: "object",
      properties: {
        angle: {
          type: "string",
          enum: expectedAngles
        },
        content:
          contentType === "string"
            ? {
                type: "string"
              }
            : {
                type: "array",
                items: {
                  type: "string"
                }
              }
      },
      required: ["angle", "content"]
    }
  };
}

export function parseOllamaVariants(
  parsed: unknown,
  requestedKinds: MetadataVariantKind[]
): Array<{
  kind: MetadataVariantKind;
  angle: MetadataVariantAngle;
  content: string | string[];
  source: MetadataVariantSource;
}> {
  const variants: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }> = [];

  const normalizedResponse = normalizeOllamaCandidateResponse(parsed, requestedKinds);

  if (requestedKinds.includes("title")) {
    variants.push(
      ...normalizeOllamaInlineVariants(normalizedResponse.titleVariants, "title", TITLE_ANGLES, 90)
    );
  }
  if (requestedKinds.includes("description")) {
    variants.push(
      ...normalizeOllamaInlineVariants(
        normalizedResponse.descriptionVariants,
        "description",
        DESCRIPTION_ANGLES,
        520
      )
    );
  }
  if (requestedKinds.includes("public_hashtags")) {
    variants.push(
      ...normalizeOllamaListVariants(
        normalizedResponse.publicHashtagSets,
        "public_hashtags",
        HASHTAG_ANGLES,
        "public_hashtags"
      )
    );
  }
  if (requestedKinds.includes("platform_tags")) {
    variants.push(
      ...normalizeOllamaListVariants(
        normalizedResponse.platformTagSets,
        "platform_tags",
        PLATFORM_TAG_ANGLES,
        "platform_tags"
      )
    );
  }

  return variants;
}

function normalizeOllamaCandidateResponse(
  parsed: unknown,
  requestedKinds: MetadataVariantKind[]
): OllamaCandidateResponse {
  const normalized: OllamaCandidateResponse = {};
  const assignSingleKind = (candidates: OllamaVariantShape[]): void => {
    if (requestedKinds.length !== 1) {
      return;
    }

    switch (requestedKinds[0]) {
      case "title":
        normalized.titleVariants = candidates;
        break;
      case "description":
        normalized.descriptionVariants = candidates;
        break;
      case "public_hashtags":
        normalized.publicHashtagSets = candidates;
        break;
      case "platform_tags":
        normalized.platformTagSets = candidates;
        break;
    }
  };

  if (Array.isArray(parsed)) {
    const candidates = parsed.filter(isRecord).map((candidate) => candidate as OllamaVariantShape);
    assignSingleKind(candidates);
    for (const candidate of candidates) {
      assignCandidateByShape(normalized, candidate);
    }
    return normalized;
  }

  if (!isRecord(parsed)) {
    return normalized;
  }

  normalized.titleVariants = readVariantArray(parsed, ["titleVariants", "titles", "titleCandidates"]);
  normalized.descriptionVariants = readVariantArray(parsed, ["descriptionVariants", "descriptions", "descriptionCandidates"]);
  normalized.publicHashtagSets = readVariantArray(parsed, ["publicHashtagSets", "publicHashtags", "hashtags"]);
  normalized.platformTagSets = readVariantArray(parsed, ["platformTagSets", "platformTags", "tags"]);

  const genericCandidates = readVariantArray(parsed, ["variants", "candidates", "suggestions"]);
  if (genericCandidates.length > 0) {
    assignSingleKind(genericCandidates);
    for (const candidate of genericCandidates) {
      assignCandidateByShape(normalized, candidate);
    }
  }

  if (requestedKinds.includes("title") && !normalized.titleVariants?.length && parsed.title !== undefined) {
    normalized.titleVariants = [{ content: parsed.title }];
  }
  if (requestedKinds.includes("description") && !normalized.descriptionVariants?.length && parsed.description !== undefined) {
    normalized.descriptionVariants = [{ content: parsed.description }];
  }
  if (requestedKinds.includes("public_hashtags") && !normalized.publicHashtagSets?.length && parsed.hashtags !== undefined) {
    normalized.publicHashtagSets = [{ content: parsed.hashtags }];
  }
  if (requestedKinds.includes("platform_tags") && !normalized.platformTagSets?.length && parsed.tags !== undefined) {
    normalized.platformTagSets = [{ content: parsed.tags }];
  }

  return normalized;
}

function assignCandidateByShape(response: OllamaCandidateResponse, candidate: OllamaVariantShape): void {
  const kind = String(candidate.kind ?? candidate.type ?? candidate.field ?? "").toLowerCase();
  if (kind.includes("title")) {
    response.titleVariants = [...(response.titleVariants ?? []), candidate];
  } else if (kind.includes("description")) {
    response.descriptionVariants = [...(response.descriptionVariants ?? []), candidate];
  } else if (kind.includes("public") || kind.includes("hashtag")) {
    response.publicHashtagSets = [...(response.publicHashtagSets ?? []), candidate];
  } else if (kind.includes("platform") || kind === "tag" || kind.includes("tags")) {
    response.platformTagSets = [...(response.platformTagSets ?? []), candidate];
  }
}

function readVariantArray(source: Record<string, unknown>, keys: string[]): OllamaVariantShape[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord).map((candidate) => candidate as OllamaVariantShape);
    }
    if (isRecord(value)) {
      return [value as OllamaVariantShape];
    }
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVariantContent(candidate: OllamaVariantShape, kind: MetadataVariantKind): unknown {
  if (candidate.content !== undefined) {
    return candidate.content;
  }

  if (kind === "title") {
    return candidate.title ?? candidate.text ?? candidate.value;
  }
  if (kind === "description") {
    return candidate.description ?? candidate.text ?? candidate.value;
  }
  if (kind === "public_hashtags") {
    return candidate.publicHashtags ?? candidate.hashtags ?? candidate.tags ?? candidate.value;
  }

  return candidate.platformTags ?? candidate.tags ?? candidate.hashtags ?? candidate.value;
}

function normalizeOllamaInlineVariants(
  rawVariants: OllamaVariantShape[] | undefined,
  kind: Extract<MetadataVariantKind, "title" | "description">,
  expectedAngles: MetadataVariantAngle[],
  maxLength: number
): Array<{
  kind: MetadataVariantKind;
  angle: MetadataVariantAngle;
  content: string;
  source: MetadataVariantSource;
}> {
  const remainingCandidates = [...(rawVariants ?? [])];

  return expectedAngles
    .map((angle) => {
      const exactIndex = remainingCandidates.findIndex(
        (candidate) => candidate.angle?.trim().toLowerCase() === angle
      );
      const candidate = remainingCandidates.splice(exactIndex >= 0 ? exactIndex : 0, 1)[0];
      const rawContent = readVariantContent(candidate ?? {}, kind);
      const contentValue = Array.isArray(rawContent) ? rawContent.join(" ") : rawContent;
      const content =
        typeof contentValue === "string"
          ? kind === "description"
            ? stripExistingProfileBlocks(normalizeDescriptionContent(contentValue))
            : normalizeInlineContent(contentValue, maxLength)
          : "";
      if (!content) {
        return null;
      }

      return {
        kind,
        angle,
        content,
        source: "ollama" as const
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function normalizeOllamaListVariants(
  rawVariants: OllamaVariantShape[] | undefined,
  kind: Extract<MetadataVariantKind, "public_hashtags" | "platform_tags">,
  expectedAngles: MetadataVariantAngle[],
  listType: "public_hashtags" | "platform_tags"
): Array<{
  kind: MetadataVariantKind;
  angle: MetadataVariantAngle;
  content: string[];
  source: MetadataVariantSource;
}> {
  const remainingCandidates = [...(rawVariants ?? [])];

  return expectedAngles
    .map((angle) => {
      const exactIndex = remainingCandidates.findIndex(
        (candidate) => candidate.angle?.trim().toLowerCase() === angle
      );
      const candidate = remainingCandidates.splice(exactIndex >= 0 ? exactIndex : 0, 1)[0];
      const rawContent = readVariantContent(candidate ?? {}, listType);
      const contentValues = Array.isArray(rawContent)
        ? rawContent
        : typeof rawContent === "string"
          ? rawContent.split(/[\n,|]/)
          : [];
      const content = normalizeTagLikeList(contentValues, listType);
      if (content.length === 0) {
        return null;
      }

      return {
        kind,
        angle,
        content,
        source: "ollama" as const
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function buildHeuristicVariants(input: {
  generationId: string;
  requestedKinds: MetadataVariantKind[];
  context: ClipMetadataContext;
}): Array<{
  kind: MetadataVariantKind;
  angle: MetadataVariantAngle;
  content: string | string[];
  source: MetadataVariantSource;
}> {
  const summary = buildSummary(input.context.transcriptText, input.context.clipName);
  const keywords = extractTopKeywords(
    [
      input.context.clipName,
      input.context.gameTitle,
      input.context.seriesKey,
      input.context.transcriptText,
    ].join(" ")
  );
  const scenario = selectScenarioPhrase(summary, keywords);
  const contextPrefix = buildContextPrefix(input.context.gameTitle, input.context.seriesKey);

  const variants: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }> = [];

  if (input.requestedKinds.includes("title")) {
    variants.push(
      {
        kind: "title",
        angle: "specific_fail",
        content: truncateAtWordBoundary(
          `${contextPrefix}${toTitleCase(scenario)} ruined the run`,
          78
        ),
        source: "heuristic"
      },
      {
        kind: "title",
        angle: "panic_tension",
        content: truncateAtWordBoundary(
          `${contextPrefix}The panic started when ${scenario}`,
          78
        ),
        source: "heuristic"
      },
      {
        kind: "title",
        angle: "social_chaos",
        content: truncateAtWordBoundary(
          `${contextPrefix}${toTitleCase(scenario)} turned into co-op chaos`,
          78
        ),
        source: "heuristic"
      }
    );
  }

  if (input.requestedKinds.includes("description")) {
    const clipContextLine = buildClipContextLine({
      gameTitle: input.context.gameTitle,
      seriesKey: input.context.seriesKey,
      scenario,
      summary
    });
    const collaboratorContextLine = buildCollaboratorDescriptionLine(input.context.collaborators);

    variants.push(
      {
        kind: "description",
        angle: "context_forward",
        content: [
          `${input.context.clipName}`,
          collaboratorContextLine,
          clipContextLine,
          truncateAtWordBoundary(summary, 220)
        ]
          .filter(Boolean)
          .join("\n\n"),
        source: "heuristic"
      },
      {
        kind: "description",
        angle: "search_forward",
        content: [
          truncateAtWordBoundary(
            [
              input.context.gameTitle,
              input.context.seriesKey,
              toTitleCase(scenario)
            ]
              .filter(Boolean)
              .join(" | "),
            120
          ),
          collaboratorContextLine,
          truncateAtWordBoundary(summary, 220),
          buildSearchDescriptionTail(input.context.gameTitle, input.context.seriesKey, keywords)
        ]
          .filter(Boolean)
          .join("\n\n"),
        source: "heuristic"
      }
    );

  }

  if (input.requestedKinds.includes("public_hashtags")) {
    variants.push(
      {
        kind: "public_hashtags",
        angle: "default",
        content: buildPublicHashtags({
          clipName: input.context.clipName,
          gameTitle: input.context.gameTitle,
          seriesKey: input.context.seriesKey,
          keywords,
          transcriptText: input.context.transcriptText,
          summary,
          includeAlt: false
        }),
        source: "heuristic"
      },
      {
        kind: "public_hashtags",
        angle: "alt",
        content: buildPublicHashtags({
          clipName: input.context.clipName,
          gameTitle: input.context.gameTitle,
          seriesKey: input.context.seriesKey,
          keywords,
          transcriptText: input.context.transcriptText,
          summary,
          includeAlt: true
        }),
        source: "heuristic"
      }
    );
  }

  if (input.requestedKinds.includes("platform_tags")) {
    variants.push({
      kind: "platform_tags",
      angle: "default",
      content: buildPlatformTags({
        clipName: input.context.clipName,
        gameTitle: input.context.gameTitle,
        seriesKey: input.context.seriesKey,
        keywords,
        transcriptText: input.context.transcriptText,
        summary
      }),
      source: "heuristic"
    });
  }

  return variants;
}

function mergeGeneratedAndFallbackVariants(input: {
  requestedKinds: MetadataVariantKind[];
  ollamaVariants: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }>;
  fallbackVariants: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }>;
}): Array<{
  kind: MetadataVariantKind;
  angle: MetadataVariantAngle;
  content: string | string[];
  source: MetadataVariantSource;
}> {
  const fallbackByKey = new Map(
    input.fallbackVariants.map((variant) => [getVariantKey(variant.kind, variant.angle), variant])
  );
  const merged: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }> = [];

  const requiredKeys = collectRequiredVariantKeys(input.requestedKinds);
  const ollamaByKey = new Map(
    input.ollamaVariants.map((variant) => [getVariantKey(variant.kind, variant.angle), variant])
  );

  for (const key of requiredKeys) {
    const ollamaVariant = ollamaByKey.get(key);
    if (ollamaVariant) {
      merged.push(ollamaVariant);
      continue;
    }

    const fallbackVariant = fallbackByKey.get(key);
    if (fallbackVariant) {
      merged.push(fallbackVariant);
    }
  }

  return merged;
}

function collectRequiredVariantKeys(requestedKinds: MetadataVariantKind[]): string[] {
  const keys: string[] = [];
  for (const kind of requestedKinds) {
    const angles = getExpectedAnglesForKind(kind);
    for (const angle of angles) {
      keys.push(getVariantKey(kind, angle));
    }
  }

  return keys;
}

function collectMissingRequiredVariantKeys(
  requestedKinds: MetadataVariantKind[],
  ollamaVariants: Array<{
    kind: MetadataVariantKind;
    angle: MetadataVariantAngle;
    content: string | string[];
    source: MetadataVariantSource;
  }>
): string[] {
  const returnedKeys = new Set(ollamaVariants.map((variant) => getVariantKey(variant.kind, variant.angle)));
  return collectRequiredVariantKeys(requestedKinds).filter((key) => !returnedKeys.has(key));
}

function buildRecommendedMetadataPackage(input: {
  existingPackage: ClipMetadataPackageDraft;
  variants: MetadataVariantRecord[];
  clipId: string;
  learningContext: LearningContext;
}): ClipMetadataPackageDraft {
  let currentPackage = normalizePackageDraft(input.existingPackage);

  for (const kind of DEFAULT_VARIANT_KIND_ORDER) {
    const candidates = input.variants.filter((variant) => variant.kind === kind);
    if (candidates.length === 0) {
      continue;
    }

    let bestPackage = currentPackage;
    let bestScore = evaluatePackageForSelection(input.clipId, currentPackage, input.learningContext);

    for (const variant of candidates) {
      const nextPackage = applyVariantToPackage(currentPackage, variant);
      const nextScore = evaluatePackageForSelection(input.clipId, nextPackage, input.learningContext);
      if (nextScore.total > bestScore.total) {
        bestPackage = {
          ...nextPackage,
          latestScoreSnapshot: nextScore
        };
        bestScore = nextScore;
      }
    }

    currentPackage = {
      ...bestPackage,
      latestScoreSnapshot: bestScore
    };
  }

  const finalScore = evaluatePackageForSelection(input.clipId, currentPackage, input.learningContext);
  return {
    ...currentPackage,
    latestScoreSnapshot: finalScore
  };
}

function scoreVariantsAgainstRecommendedPackage(input: {
  recommendedPackage: ClipMetadataPackageDraft;
  variants: MetadataVariantRecord[];
  clipId: string;
  learningContext: LearningContext;
}): MetadataVariantRecord[] {
  return input.variants.map((variant) => {
    const packageForVariant = applyVariantToPackage(input.recommendedPackage, variant);
    return {
      ...variant,
      scoreSnapshot: evaluatePackageForSelection(
        input.clipId,
        packageForVariant,
        input.learningContext
      )
    };
  });
}

function buildLearningContext(
  clipId: string,
  seriesKey: string,
  aiProfile: ReturnType<typeof resolveAiProfileForTask>
): LearningContext {
  const normalizedSeriesKey = normalizeContextValue(seriesKey);
  const packages = selectMetadataPackagesForProfile(
    listClipMetadataPackages().filter((metadata) => metadata.clipId !== clipId), aiProfile
  );
  const feedback = selectMetadataFeedbackForProfile(listMetadataFeedback(), aiProfile);
  const latestSnapshots = getLatestPerformanceByClipId();
  const learningSettings = aiProfile?.learningSettings;
  const learningEnabled = Boolean(aiProfile && learningSettings?.mode !== "off");
  const approvedClipIds = new Set(
    feedback.filter((record) => record.decision === "approved").map((record) => record.clipId)
  );
  const rejectedClipIds = new Set(
    feedback.filter((record) => record.decision === "rejected").map((record) => record.clipId)
  );

  const approvedExamples = learningEnabled && learningSettings?.includeApprovedExamples
    ? selectLearningExamples({
    packages,
    predicate: (metadata) => approvedClipIds.has(metadata.clipId),
    normalizedSeriesKey,
    sortByPerformance: false,
    latestSnapshots
      })
    : [];
  const highPerformingExamples = learningEnabled && learningSettings?.includeHighPerformingExamples
    ? selectLearningExamples({
    packages,
    predicate: (metadata) => latestSnapshots.has(metadata.clipId),
    normalizedSeriesKey,
    sortByPerformance: true,
    latestSnapshots
      })
    : [];
  const rejectedExamples = learningEnabled && learningSettings?.includeRejectedExamples
    ? selectLearningExamples({
        packages,
        predicate: (metadata) => rejectedClipIds.has(metadata.clipId),
        normalizedSeriesKey,
        sortByPerformance: false,
        latestSnapshots
      })
    : [];

  return {
    approvedExamples,
    highPerformingExamples,
    rejectedExamples,
    approvedExampleCount: approvedExamples.length,
    highPerformingExampleCount: highPerformingExamples.length
  };
}

function selectLearningExamples(input: {
  packages: ReturnType<typeof listClipMetadataPackages>;
  predicate: (metadata: ReturnType<typeof listClipMetadataPackages>[number]) => boolean;
  normalizedSeriesKey: string;
  sortByPerformance: boolean;
  latestSnapshots: Map<string, number>;
}): LearningExample[] {
  const matchingSeries = input.packages.filter(
    (metadata) =>
      input.predicate(metadata) &&
      input.normalizedSeriesKey.length > 0 &&
      normalizeContextValue(metadata.seriesKey) === input.normalizedSeriesKey
  );
  const channelWideFallback = input.packages.filter((metadata) => input.predicate(metadata));

  const ordered = dedupeByClipId([
    ...sortLearningCandidates(matchingSeries, input.sortByPerformance, input.latestSnapshots),
    ...sortLearningCandidates(channelWideFallback, input.sortByPerformance, input.latestSnapshots)
  ]);

  return ordered.slice(0, AI_LEARNING_LIMITS.examplesPerCategory).map((metadata) => ({
    clipId: metadata.clipId,
    title: metadata.title.slice(0, 120),
    description: stripExistingProfileBlocks(metadata.description).slice(0, AI_LEARNING_LIMITS.exampleDescriptionCharacters),
    publicHashtags: metadata.publicHashtags.slice(0, 8).map(tag => tag.slice(0, 40)),
    platformTags: metadata.platformTags.slice(0, 8).map(tag => tag.slice(0, 40)),
    seriesKey: metadata.seriesKey.slice(0, 80),
    gameTitle: metadata.gameTitle.slice(0, 80),
    performanceScore: input.latestSnapshots.get(metadata.clipId) ?? null
  }));
}

function sortLearningCandidates(
  candidates: ReturnType<typeof listClipMetadataPackages>,
  sortByPerformance: boolean,
  latestSnapshots: Map<string, number>
): ReturnType<typeof listClipMetadataPackages> {
  return [...candidates].sort((left, right) => {
    if (sortByPerformance) {
      const rightScore = latestSnapshots.get(right.clipId) ?? -1;
      const leftScore = latestSnapshots.get(left.clipId) ?? -1;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function dedupeByClipId(
  candidates: ReturnType<typeof listClipMetadataPackages>
): ReturnType<typeof listClipMetadataPackages> {
  const seen = new Set<string>();
  const deduped: ReturnType<typeof listClipMetadataPackages> = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.clipId)) {
      continue;
    }

    seen.add(candidate.clipId);
    deduped.push(candidate);
  }

  return deduped;
}

function getLatestPerformanceByClipId(): Map<string, number> {
  const scheduledPostsById = new Map(listScheduledPosts().map((post) => [post.id, post]));
  const latestSnapshotByClipId = new Map<
    string,
    ReturnType<typeof listYouTubePerformanceSnapshots>[number]
  >();

  for (const snapshot of listYouTubePerformanceSnapshots()) {
    const existing = latestSnapshotByClipId.get(snapshot.clipId);
    if (!existing || snapshot.fetchedAt > existing.fetchedAt) {
      latestSnapshotByClipId.set(snapshot.clipId, snapshot);
    }
  }

  const scores = new Map<string, number>();
  for (const [clipId, snapshot] of latestSnapshotByClipId.entries()) {
    const scheduledPost = scheduledPostsById.get(snapshot.scheduledPostId);
    scores.set(clipId, computePerformanceScore(snapshot, scheduledPost?.publishAt ?? null));
  }

  return scores;
}

function computePerformanceScore(
  snapshot: ReturnType<typeof listYouTubePerformanceSnapshots>[number],
  publishAt: string | null
): number {
  if (snapshot.engagedViews !== null) {
    return snapshot.engagedViews;
  }

  const ageDays = publishAt
    ? Math.max(1, Math.ceil((Date.now() - Date.parse(publishAt)) / 86_400_000))
    : 1;

  return (
    ((snapshot.views ?? 0) + (snapshot.likes ?? 0) * 8 + (snapshot.comments ?? 0) * 12) / ageDays
  );
}

function createBaseMetadataPackage(input: {
  clipName: string;
  transcriptText: string;
  clipDurationMs: number | null;
  existingPackage: ClipMetadataPackageDraft | null;
  seriesKey: string;
  gameTitle: string;
}): ClipMetadataPackageDraft {
  if (input.existingPackage) {
    return normalizePackageDraft({
      ...input.existingPackage,
      description: stripExistingProfileBlocks(input.existingPackage.description),
      seriesKey: normalizeContextValue(input.seriesKey || input.existingPackage.seriesKey),
      gameTitle: normalizeContextValue(input.gameTitle || input.existingPackage.gameTitle)
    });
  }

  const summary = buildSummary(input.transcriptText, input.clipName);
  const keywords = extractTopKeywords(
    [input.clipName, input.gameTitle, input.seriesKey, input.transcriptText].join(" ")
  );
  const title = truncateAtWordBoundary(
    [buildContextPrefix(input.gameTitle, input.seriesKey), toTitleCase(selectScenarioPhrase(summary, keywords))]
      .join("")
      .trim(),
    72
  );

  return normalizePackageDraft({
    title: title || input.clipName,
    description: buildDefaultDescription(summary, input.gameTitle, input.seriesKey),
    publicHashtags: buildPublicHashtags({
      clipName: input.clipName,
      gameTitle: input.gameTitle,
      seriesKey: input.seriesKey,
      keywords,
      transcriptText: input.transcriptText,
      summary,
      includeAlt: false
    }),
    platformTags: buildPlatformTags({
      clipName: input.clipName,
      gameTitle: input.gameTitle,
      seriesKey: input.seriesKey,
      keywords,
      transcriptText: input.transcriptText,
      summary
    }),
    seriesKey: normalizeContextValue(input.seriesKey),
    gameTitle: normalizeContextValue(input.gameTitle),
    collaboratorProfileIds: [],
    selectedVariantIds: {
      title: null,
      description: null,
      publicHashtags: null,
      platformTags: null
    },
    latestScoreSnapshot: null
  });
}

function applyVariantToPackage(
  basePackage: ClipMetadataPackageDraft,
  variant: Pick<MetadataVariantRecord, "id" | "kind" | "content">
): ClipMetadataPackageDraft {
  const nextPackage = normalizePackageDraft(basePackage);
  switch (variant.kind) {
    case "title":
      return {
        ...nextPackage,
        title: typeof variant.content === "string" ? normalizeInlineContent(variant.content, 90) : nextPackage.title,
        selectedVariantIds: {
          ...nextPackage.selectedVariantIds,
          title: variant.id
        }
      };
    case "description":
      return {
        ...nextPackage,
        description:
          typeof variant.content === "string" ? normalizeDescriptionContent(variant.content) : nextPackage.description,
        selectedVariantIds: {
          ...nextPackage.selectedVariantIds,
          description: variant.id
        }
      };
    case "public_hashtags":
      return {
        ...nextPackage,
        publicHashtags: Array.isArray(variant.content)
          ? normalizeTagLikeList(variant.content, "public_hashtags")
          : nextPackage.publicHashtags,
        selectedVariantIds: {
          ...nextPackage.selectedVariantIds,
          publicHashtags: variant.id
        }
      };
    case "platform_tags":
      return {
        ...nextPackage,
        platformTags: Array.isArray(variant.content)
          ? normalizeTagLikeList(variant.content, "platform_tags")
          : nextPackage.platformTags,
        selectedVariantIds: {
          ...nextPackage.selectedVariantIds,
          platformTags: variant.id
        }
      };
  }
}

function evaluatePackageForSelection(
  clipId: string,
  metadataPackage: ClipMetadataPackageDraft,
  learningContext: LearningContext
): MetadataScoreSnapshot {
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  const transcript = getTranscriptByClipId(clipId);
  return scoreYouTubeMetadataPackage(
    buildMetadataScoringContext({
      clipId,
      clip,
      transcriptText: buildCanonicalTranscriptText(transcript),
      srtContent: transcript?.srtContent ?? "",
      transcriptSegments: transcript?.segments ?? [],
      metadataPackage,
      learningContext
    })
  );
}

function buildMetadataScoringContext(input: {
  clipId: string;
  clip: NonNullable<ReturnType<typeof getClipById>>;
  transcriptText: string;
  srtContent: string;
  transcriptSegments: TranscriptSegmentRecord[];
  metadataPackage: ClipMetadataPackageDraft;
  learningContext: LearningContext;
}): MetadataScoringContext {
  return {
    clip: input.clip,
    transcript: input.transcriptText || input.srtContent
          ? {
            id: `transcript:${input.clipId}`,
            assetType: "clip",
            assetId: input.clipId,
            clipId: input.clipId,
            modelPath: "local",
            language: null,
            textContent: input.transcriptText,
            srtContent: input.srtContent,
            segments: input.transcriptSegments,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString()
          }
      : null,
    metadataPackage: normalizePackageDraft(input.metadataPackage),
    approvedExampleCount: input.learningContext.approvedExampleCount,
    highPerformingExampleCount: input.learningContext.highPerformingExampleCount
  };
}

function buildGenerationNote(
  ollamaNote: string | null,
  variants: Array<{ source: MetadataVariantSource }>
): string | null {
  const hasOllama = variants.some((variant) => variant.source === "ollama");
  const hasFallback = variants.some((variant) => variant.source === "heuristic");

  if (hasOllama && hasFallback) {
    return `${ollamaNote ?? "The local AI runtime returned a partial result."} Missing groups were filled with local fallback variants only because the AI response was incomplete.`;
  }

  if (hasOllama) {
    return ollamaNote ?? "Generated candidate variants with the app-owned local AI runtime.";
  }

  return (
    ollamaNote ??
    "The app-owned local AI runtime was unavailable, so the app generated low-confidence local fallback variants from the clip name and transcript."
  );
}

function buildGenerationIssueSummary(
  ollamaNote: string | null,
  variants: Array<{ source: MetadataVariantSource }>
): string | null {
  const executionMode = resolveMetadataExecutionMode(variants);
  if (executionMode === "ai") {
    return null;
  }

  if (executionMode === "mixed_fallback") {
    return `${ollamaNote ?? "The local AI runtime returned a partial result."} Missing groups were filled with local fallback variants.`;
  }

  return (
    ollamaNote ??
    "The app-owned local AI runtime was unavailable, so the app generated low-confidence local fallback variants from the clip name and transcript."
  );
}

function resolveMetadataExecutionMode(
  variants: Array<{ source: MetadataVariantSource }>
): AiExecutionMode {
  const hasOllama = variants.some((variant) => variant.source === "ollama");
  const hasFallback = variants.some((variant) => variant.source === "heuristic");

  if (hasOllama && hasFallback) {
    return "mixed_fallback";
  }

  return hasOllama ? "ai" : "fallback";
}

function buildStrictAiMetadataFailureMessage(
  ollamaNote: string | null,
  requestedKinds: MetadataVariantKind[],
  missingRequiredVariantKeys: string[]
): string {
  const requestedKindsLabel = requestedKinds.join(", ");
  if (missingRequiredVariantKeys.length > 0) {
    return `Strict AI mode blocked fallback metadata generation. The local AI runtime did not return a complete ${requestedKindsLabel} result. Missing groups: ${missingRequiredVariantKeys.join(", ")}.${ollamaNote ? ` ${ollamaNote}` : ""}`;
  }

  return `Strict AI mode blocked fallback metadata generation. ${ollamaNote ?? "The local AI runtime did not return usable metadata output."}`;
}

function getExpectedAnglesForKind(kind: MetadataVariantKind): MetadataVariantAngle[] {
  switch (kind) {
    case "title":
      return TITLE_ANGLES;
    case "description":
      return DESCRIPTION_ANGLES;
    case "public_hashtags":
      return HASHTAG_ANGLES;
    case "platform_tags":
      return PLATFORM_TAG_ANGLES;
  }
}

function normalizeRequestedKinds(kinds: MetadataVariantKind[] | undefined): MetadataVariantKind[] {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    return [...DEFAULT_VARIANT_KIND_ORDER];
  }

  const requestedKinds = kinds.filter((kind): kind is MetadataVariantKind =>
    DEFAULT_VARIANT_KIND_ORDER.includes(kind)
  );
  return requestedKinds.length > 0 ? [...new Set(requestedKinds)] : [...DEFAULT_VARIANT_KIND_ORDER];
}

function formatLearningExamples(examples: LearningExample[], title: string): string {
  if (examples.length === 0) {
    return `${title}: none yet`;
  }

  return [
    `${title}:`,
    ...examples.map((example, index) =>
      [
        `${index + 1}. Title: ${example.title}`,
        example.gameTitle ? `Game: ${example.gameTitle}` : null,
        example.seriesKey ? `Series: ${example.seriesKey}` : null,
        example.performanceScore !== null ? `Performance score: ${Math.round(example.performanceScore)}` : null,
        `Description opener: ${truncateAtWordBoundary(example.description.replace(/\s+/g, " ").trim(), 140)}`,
        example.publicHashtags.length > 0 ? `Public hashtags: ${example.publicHashtags.join(", ")}` : null,
        example.platformTags.length > 0 ? `Platform tags: ${example.platformTags.join(", ")}` : null
      ]
        .filter(Boolean)
        .join(" | ")
    )
  ].join("\n");
}

function buildClipContextLine(input: {
  gameTitle: string;
  seriesKey: string;
  scenario: string;
  summary: string;
}): string {
  const contextBits = [input.gameTitle, input.seriesKey].filter(Boolean);
  if (contextBits.length === 0) {
    return truncateAtWordBoundary(input.summary, 180);
  }

  return truncateAtWordBoundary(
    `${contextBits.join(" | ")} clip focused on ${input.scenario}.`,
    180
  );
}

function buildSearchDescriptionTail(
  gameTitle: string,
  seriesKey: string,
  keywords: string[]
): string {
  const parts = [gameTitle, seriesKey, ...keywords.slice(0, 4)].filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  return truncateAtWordBoundary(`Search context: ${parts.join(", ")}`, 180);
}

function buildDefaultDescription(summary: string, gameTitle: string, seriesKey: string): string {
  const contextLine = [gameTitle, seriesKey].filter(Boolean).join(" | ");
  return [contextLine, truncateAtWordBoundary(summary, 220)].filter(Boolean).join("\n\n");
}

function buildPublicHashtags(input: {
  clipName: string;
  gameTitle: string;
  seriesKey: string;
  keywords: string[];
  transcriptText: string;
  summary: string;
  includeAlt: boolean;
}): string[] {
  const tagSignalContext = buildTagSignalContext(input);
  const identityTags = buildPublicIdentityHashtags(input.gameTitle, input.seriesKey);
  const toneTags = detectRuleBasedPublicTags(tagSignalContext, TONE_TAG_RULES);
  const laneTags = detectRuleBasedPublicTags(tagSignalContext, LANE_TAG_RULES);
  const scenarioTags = buildScenarioHashtagTags(input.keywords, input.gameTitle, input.seriesKey);
  const primary = input.includeAlt
    ? [
        identityTags[1] ?? identityTags[0],
        toneTags[1] ?? toneTags[0],
        laneTags[1] ?? laneTags[0],
        scenarioTags[0]
      ].filter(Boolean)
    : [
        identityTags[0],
        toneTags[0],
        laneTags[0],
        "shorts"
      ].filter(Boolean);

  return normalizeTagLikeList(primary, "public_hashtags").slice(0, 4);
}

function buildPlatformTags(input: {
  clipName: string;
  gameTitle: string;
  seriesKey: string;
  keywords: string[];
  transcriptText: string;
  summary: string;
}): string[] {
  const tagSignalContext = buildTagSignalContext(input);
  const identityTags = buildPlatformIdentityTags(input.gameTitle, input.seriesKey);
  const toneTags = detectRuleBasedPlatformTags(tagSignalContext, TONE_TAG_RULES);
  const laneTags = detectRuleBasedPlatformTags(tagSignalContext, LANE_TAG_RULES);
  const scenarioTags = buildScenarioPlatformTags({
    clipName: input.clipName,
    gameTitle: input.gameTitle,
    seriesKey: input.seriesKey,
    keywords: input.keywords
  });
  const fallbackTags = input.keywords.filter((keyword) => !isGenericTagTerm(keyword)).slice(0, 2);

  return normalizeTagLikeList(
    [
      ...identityTags,
      ...laneTags,
      ...toneTags,
      ...scenarioTags,
      ...fallbackTags
    ],
    "platform_tags"
  ).slice(0, 10);
}

function buildTagSignalContext(input: {
  clipName: string;
  gameTitle: string;
  seriesKey: string;
  transcriptText: string;
  summary: string;
}): string {
  return [
    input.clipName,
    input.gameTitle,
    input.seriesKey,
    input.summary,
    input.transcriptText
  ]
    .join(" ")
    .toLowerCase();
}

function buildPublicIdentityHashtags(gameTitle: string, seriesKey: string): string[] {
  return [...new Set([
    ...buildIdentityTokens(gameTitle, "public_hashtags"),
    ...buildIdentityTokens(seriesKey, "public_hashtags")
  ])];
}

function buildPlatformIdentityTags(gameTitle: string, seriesKey: string): string[] {
  return [...new Set([
    ...buildIdentityTokens(gameTitle, "platform_tags"),
    ...buildIdentityTokens(seriesKey, "platform_tags")
  ])];
}

function buildIdentityTokens(
  value: string,
  kind: "public_hashtags" | "platform_tags"
): string[] {
  const normalizedValue = normalizeContextValue(value);
  if (!normalizedValue) {
    return [];
  }

  const compactToken = toCompactTagToken(normalizedValue);
  const aliasTokens = buildIdentityAliasTokens(normalizedValue);
  const orderedTokens =
    kind === "public_hashtags"
      ? [compactToken, ...aliasTokens]
      : [normalizedValue.toLowerCase(), compactToken, ...aliasTokens];

  return orderedTokens.filter(Boolean);
}

function buildIdentityAliasTokens(value: string): string[] {
  const normalized = value.toLowerCase();
  const aliases = new Set<string>();

  if (normalized.includes("dark souls 3")) {
    aliases.add("darksouls3");
    aliases.add("ds3");
  } else if (normalized.includes("dark souls")) {
    aliases.add("darksouls");
  }

  if (normalized.includes("elden ring")) {
    aliases.add("eldenring");
  }

  if (normalized.includes("it takes two")) {
    aliases.add("ittakestwo");
  }

  if (normalized.includes("a way out")) {
    aliases.add("awayout");
  }

  if (normalized.includes("halo")) {
    aliases.add("halopc");
  }

  const words = normalizeWords(normalized);
  const initialism = words.map((word) => word[0] ?? "").join("");
  if (initialism.length >= 3 && initialism.length <= 4 && /\d/.test(normalized)) {
    aliases.add(initialism);
  }

  return [...aliases];
}

function detectRuleBasedPublicTags(
  context: string,
  rules: Array<{ publicTag: string | null; platformTags: string[]; patterns: RegExp[] }>
): string[] {
  return rules
    .filter((rule) => rule.publicTag && rule.patterns.some((pattern) => pattern.test(context)))
    .map((rule) => rule.publicTag as string);
}

function detectRuleBasedPlatformTags(
  context: string,
  rules: Array<{ publicTag: string | null; platformTags: string[]; patterns: RegExp[] }>
): string[] {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(context)))
    .flatMap((rule) => rule.platformTags);
}

function buildScenarioHashtagTags(
  keywords: string[],
  gameTitle: string,
  seriesKey: string
): string[] {
  return keywords
    .filter((keyword) => isUsableScenarioKeyword(keyword, gameTitle, seriesKey))
    .slice(0, 2)
    .map((keyword) => toCompactTagToken(keyword));
}

function buildScenarioPlatformTags(input: {
  clipName: string;
  gameTitle: string;
  seriesKey: string;
  keywords: string[];
}): string[] {
  const scenarioKeywords = input.keywords.filter((keyword) =>
    isUsableScenarioKeyword(keyword, input.gameTitle, input.seriesKey)
  );

  const phraseCandidates = buildSignalPhrasesFromClipName(input.clipName, input.gameTitle, input.seriesKey);
  return [...phraseCandidates, ...scenarioKeywords].slice(0, 3);
}

function buildSignalPhrasesFromClipName(
  clipName: string,
  gameTitle: string,
  seriesKey: string
): string[] {
  const words = normalizeWords(clipName).filter((word) =>
    isUsableScenarioKeyword(word, gameTitle, seriesKey)
  );
  const phrases: string[] = [];

  for (let index = 0; index < words.length - 1; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]}`;
    if (phrase.length >= 8 && phrase.length <= 24 && !phrases.includes(phrase)) {
      phrases.push(phrase);
    }
  }

  return phrases.slice(0, 2);
}

function isUsableScenarioKeyword(keyword: string, gameTitle: string, seriesKey: string): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword || normalizedKeyword.length < 4 || isGenericTagTerm(normalizedKeyword)) {
    return false;
  }

  const identityTokens = new Set([
    ...normalizeWords(gameTitle),
    ...normalizeWords(seriesKey),
    toCompactTagToken(gameTitle),
    toCompactTagToken(seriesKey)
  ]);

  return !identityTokens.has(normalizedKeyword);
}

function isGenericTagTerm(value: string): boolean {
  return GENERIC_TAG_TERMS.has(value.trim().toLowerCase());
}

function toCompactTagToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildContextPrefix(gameTitle: string, seriesKey: string): string {
  const contextBits = [gameTitle, seriesKey].filter(Boolean);
  return contextBits.length > 0 ? `${contextBits.join(" | ")}: ` : "";
}

function selectScenarioPhrase(summary: string, keywords: string[]): string {
  const phrase = keywords.find((keyword) => keyword.length >= 4);
  if (phrase) {
    return phrase;
  }

  const summaryWords = normalizeWords(summary);
  return summaryWords[0] ?? "the moment";
}

function selectMetadataModel(availableModels: string[], preferredModel: string | null = null): string | null {
  if (preferredModel) {
    const matchedPreferredModel = availableModels.find(
      (model) => model.toLowerCase() === preferredModel.toLowerCase()
    );
    if (matchedPreferredModel) {
      return matchedPreferredModel;
    }
  }

  const normalized = new Set(availableModels.map((model) => model.toLowerCase()));
  const preferred = OLLAMA_METADATA_MODEL_PREFERENCE.find((model) => normalized.has(model.toLowerCase()));
  if (preferred) {
    return availableModels.find((model) => model.toLowerCase() === preferred.toLowerCase()) ?? preferred;
  }

  return availableModels[0] ?? null;
}

function cleanClipName(displayName: string): string {
  const rawName = path.parse(displayName).name;
  return toTitleCase(rawName.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim());
}

function buildSummary(transcriptText: string, fallbackName: string): string {
  const sentences = transcriptText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return `Short clip focused on ${fallbackName}.`;
  }

  return truncateAtWordBoundary(sentences.slice(0, 2).join(" "), 220);
}

function extractTopKeywords(text: string): string[] {
  const counts = new Map<string, number>();

  for (const word of normalizeWords(text)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([word]) => word)
    .slice(0, 10);
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function buildCanonicalTranscriptText(transcript: TranscriptRecord | null): string {
  if (!transcript) {
    return "";
  }

  const segmentText = transcript.segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  if (segmentText) {
    return segmentText.replace(/\s+/g, " ").trim();
  }

  return transcript.textContent.replace(/\s+/g, " ").trim();
}

function buildTranscriptMetadataContext(
  transcript: TranscriptRecord | null,
  selectedCollaboratorProfileIds: string[]
): {
  transcriptText: string;
  transcriptPromptText: string;
  creatorSpokenSegmentCount: number;
  collaborators: CollaboratorPresenceSummary[];
  speakerContext: SpeakerContextSummary;
} {
  const selectedCollaborators = getSelectedCollaborators(selectedCollaboratorProfileIds);
  const collaboratorProfiles = getCollaboratorProfiles();
  const collaboratorProfilesById = new Map(
    collaboratorProfiles.map((profile) => [profile.id, profile])
  );
  const transcriptText = buildCanonicalTranscriptText(transcript);
  const speakerContext = buildSpeakerContextSummary(transcript, collaboratorProfiles);
  const trustedTranscriptCollaboratorCounts = new Map<string, number>();
  const promptTranscriptLines: string[] = [];
  let creatorSpokenSegmentCount = 0;

  for (const segment of transcript?.segments ?? []) {
    const normalizedText = segment.text.trim();
    if (!normalizedText) {
      continue;
    }

    const promptSpeakerLabel = resolvePromptSpeakerLabel(segment, collaboratorProfilesById, collaboratorProfiles);
    promptTranscriptLines.push(
      `${promptSpeakerLabel ? `[${promptSpeakerLabel}]` : "[Unidentified speaker]"} ${normalizedText}`
    );

    if (classifySpeakerAssignment(segment, collaboratorProfiles) !== "resolved") {
      continue;
    }

    if (segment.speakerId === CREATOR_SPEAKER_ID) {
      creatorSpokenSegmentCount += 1;
      continue;
    }

    if (segment.speakerId && collaboratorProfilesById.has(segment.speakerId)) {
      trustedTranscriptCollaboratorCounts.set(
        segment.speakerId,
        (trustedTranscriptCollaboratorCounts.get(segment.speakerId) ?? 0) + 1
      );
    }
  }

  const collaboratorPresenceById = new Map<string, CollaboratorPresenceSummary>();
  for (const collaborator of selectedCollaborators) {
    const spokenSegmentCount = trustedTranscriptCollaboratorCounts.get(collaborator.id) ?? 0;
    collaboratorPresenceById.set(collaborator.id, {
      id: collaborator.id,
      displayName: collaborator.displayName || "Unnamed collaborator",
      spokenSegmentCount,
      presenceSource: spokenSegmentCount > 0 ? "selected_and_transcript" : "selected"
    });
  }

  for (const [collaboratorId, spokenSegmentCount] of trustedTranscriptCollaboratorCounts) {
    if (collaboratorPresenceById.has(collaboratorId)) {
      continue;
    }

    const collaborator = collaboratorProfilesById.get(collaboratorId);
    if (!collaborator) {
      continue;
    }

    collaboratorPresenceById.set(collaboratorId, {
      id: collaborator.id,
      displayName: collaborator.displayName || "Unnamed collaborator",
      spokenSegmentCount,
      presenceSource: "transcript"
    });
  }

  return {
    transcriptText,
    transcriptPromptText:
      promptTranscriptLines.length > 0 ? promptTranscriptLines.join("\n") : transcriptText,
    creatorSpokenSegmentCount: speakerContext.creatorTrustedSegmentCount,
    collaborators: [...collaboratorPresenceById.values()].sort((left, right) => {
      if (right.spokenSegmentCount !== left.spokenSegmentCount) {
        return right.spokenSegmentCount - left.spokenSegmentCount;
      }

      return left.displayName.localeCompare(right.displayName);
    }),
    speakerContext
  };
}

function truncateTranscriptForPrompt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_PROMPT_TRANSCRIPT_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_PROMPT_TRANSCRIPT_CHARS).trim()}...`;
}

function normalizePackageDraft(payload: ClipMetadataPackageDraft): ClipMetadataPackageDraft {
  return {
    title: normalizeInlineContent(payload.title, 90),
    description: normalizeDescriptionContent(payload.description),
    publicHashtags: normalizeTagLikeList(payload.publicHashtags, "public_hashtags"),
    platformTags: normalizeTagLikeList(payload.platformTags, "platform_tags"),
    seriesKey: normalizeContextValue(payload.seriesKey),
    gameTitle: normalizeContextValue(payload.gameTitle),
    collaboratorProfileIds: Array.isArray(payload.collaboratorProfileIds)
      ? payload.collaboratorProfileIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
    selectedVariantIds: {
      title: payload.selectedVariantIds.title ?? null,
      description: payload.selectedVariantIds.description ?? null,
      publicHashtags: payload.selectedVariantIds.publicHashtags ?? null,
      platformTags: payload.selectedVariantIds.platformTags ?? null
    },
    latestScoreSnapshot: payload.latestScoreSnapshot ?? null
  };
}

function normalizeInlineContent(value: string, maxLength: number): string {
  return truncateAtWordBoundary(value.replace(/\s+/g, " ").trim(), maxLength);
}

function normalizeDescriptionContent(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function getSelectedCollaborators(collaboratorProfileIds: string[]): CollaboratorProfile[] {
  const selectedIds = new Set(
    collaboratorProfileIds.map((id) => String(id).trim()).filter(Boolean)
  );
  if (selectedIds.size === 0) {
    return [];
  }

  return getCollaboratorProfiles().filter((profile) => selectedIds.has(profile.id));
}

function formatSelectedCollaboratorNames(collaboratorProfileIds: string[]): string {
  const selectedCollaborators = getSelectedCollaborators(collaboratorProfileIds);
  if (selectedCollaborators.length === 0) {
    return "none";
  }

  return selectedCollaborators
    .map((profile) => profile.displayName || "Unnamed collaborator")
    .join(", ");
}

function formatCollaboratorPresenceForPrompt(
  collaborators: CollaboratorPresenceSummary[]
): string {
  if (collaborators.length === 0) {
    return "Collaborator presence: none confirmed";
  }

  return [
    "Collaborator presence:",
    ...collaborators.map((collaborator) => {
      const sourceLabel =
        collaborator.presenceSource === "selected_and_transcript"
          ? "selected and confirmed in the trusted transcript"
          : collaborator.presenceSource === "selected"
            ? "selected in the package editor"
            : "detected in the trusted transcript";
      const spokenSegmentSuffix =
        collaborator.spokenSegmentCount > 0
          ? ` | trusted speech segments: ${collaborator.spokenSegmentCount}`
          : "";
      return `- ${collaborator.displayName}: ${sourceLabel}${spokenSegmentSuffix}`;
    })
  ].join("\n");
}

function buildCollaboratorDescriptionLine(
  collaborators: CollaboratorPresenceSummary[]
): string {
  if (collaborators.length === 0) {
    return "";
  }

  const names = collaborators
    .map((collaborator) => collaborator.displayName.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return "";
  }

  return `Co-op clip with ${formatNameList(names)}.`;
}

function resolvePromptSpeakerLabel(
  segment: TranscriptSegmentRecord,
  collaboratorProfilesById: Map<string, CollaboratorProfile>,
  collaborators: CollaboratorProfile[]
): string | null {
  if (!isTrustedSpeakerAssignment(segment, collaborators) || !segment.speakerId) {
    return null;
  }

  if (segment.speakerId === CREATOR_SPEAKER_ID) {
    return CREATOR_SPEAKER_LABEL;
  }

  const collaborator = collaboratorProfilesById.get(segment.speakerId);
  return collaborator?.displayName?.trim() || null;
}

function formatNameList(values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function normalizeTagLikeList(
  values: unknown[],
  kind: "public_hashtags" | "platform_tags"
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of values) {
    const rawValue = String(candidate)
      .trim()
      .toLowerCase()
      .replace(/^#+/g, "");
    const nextValue =
      kind === "public_hashtags"
        ? rawValue.replace(/[^a-z0-9]/g, "")
        : rawValue.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
    if (!nextValue || seen.has(nextValue)) {
      continue;
    }

    if (kind === "public_hashtags" && nextValue.length > 28) {
      continue;
    }

    seen.add(nextValue);
    normalized.push(nextValue);
  }

  return normalized;
}

function normalizeContextValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getVariantKey(kind: MetadataVariantKind, angle: MetadataVariantAngle): string {
  return `${kind}:${angle}`;
}

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const trimmed = value.slice(0, maxLength);
  const lastSpace = trimmed.lastIndexOf(" ");
  return (lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed).trim();
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
