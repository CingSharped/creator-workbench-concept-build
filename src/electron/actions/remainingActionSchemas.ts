import { z } from "zod";
import { LOCAL_AI_SETUP_ASSETS, type LocalAiSetupAssetId } from "../../shared/localAiSetup";

const text = z.string().trim().min(1);
const milliseconds = z.number().finite().nonnegative();
const toolKey = z.enum(["ffmpeg", "ffprobe", "whisper", "whisperModel"]);
const folderKey = z.enum(["clipLibrary", "longFormSourceLibrary", "srtOutput"]);
const assetId = z.custom<LocalAiSetupAssetId>(value =>
  typeof value === "string" && LOCAL_AI_SETUP_ASSETS.some(asset => asset.id === value));
const runtimeId = assetId.refine((id): id is Extract<LocalAiSetupAssetId, `runtime_${string}`> => id.startsWith("runtime_"));
const modelId = assetId.refine((id): id is Extract<LocalAiSetupAssetId, `model_${string}`> => id.startsWith("model_"));
const profileLinks = z.object({
  youtube: z.string().nullable(), tiktok: z.string().nullable(), twitch: z.string().nullable(),
  kick: z.string().nullable(), instagram: z.string().nullable(), x: z.string().nullable(),
  discord: z.string().nullable(), website: z.string().nullable()
});
const timedSegment = z.object({
  id: text, startMs: milliseconds, endMs: milliseconds, text: z.string(),
  speakerId: z.string().nullable(), speakerConfidence: z.number().finite().nullable(),
  speakerAssignmentSource: z.enum(["manual", "auto_high_confidence", "auto_low_confidence"]).nullable(),
  speakerReviewReason: z.string().nullable(), speakerAlternateSpeakerId: z.string().nullable(),
  speakerAlternateConfidence: z.number().finite().nullable()
}).refine(value => value.endMs > value.startMs, { path: ["endMs"], message: "End must follow start." });
const voiceSample = z.object({
  id: text, clipId: z.string().nullable(), segmentId: z.string().nullable(),
  source: z.enum(["clip_segment", "microphone"]).optional(),
  transcriptPreview: z.string(), startMs: milliseconds.nullable(), endMs: milliseconds.nullable(),
  signature: z.array(z.number().finite()), createdAt: z.string()
});
const collaborator = z.object({
  id: text, displayName: z.string(), profileLinks,
  speakerColorHex: z.string().nullable(), voiceSamples: z.array(voiceSample)
});
const aiProfile = z.object({
  id: text, name: z.string(), task: z.enum(["youtube_metadata", "youtube_thumbnail", "performance_coach", "clip_discovery"]),
  description: z.string(), preferredModel: z.string().nullable(), systemPrompt: z.string(),
  promptVersion: z.number().int().positive().optional(),
  speakerContextSettings: z.object({ enabled: z.boolean(), warnWhenStreamerUnidentified: z.boolean() }).optional(),
  learningSettings: z.object({
    mode: z.enum(["off", "retrieval", "adaptive_prompt"]), maxKnowledgeEntries: z.number().int().nonnegative(),
    includeApprovedExamples: z.boolean(), includeHighPerformingExamples: z.boolean(), includeRejectedExamples: z.boolean()
  }),
  knowledgeEntries: z.array(z.object({ id: text, title: z.string(), content: z.string(), tags: z.array(z.string()), enabled: z.boolean(), createdAt: z.string(), updatedAt: z.string() })),
  enabled: z.boolean(), builtIn: z.boolean(), createdAt: z.string(), updatedAt: z.string()
});
const assignments = z.object({
  youtubeMetadataProfileId: z.string().nullable(), youtubeThumbnailProfileId: z.string().nullable(),
  performanceCoachProfileId: z.string().nullable().optional(), clipDiscoveryProfileId: z.string().nullable()
});
const focus = z.number().finite().min(0).max(1);
const scale = z.number().finite().min(0.25).max(1);
const layout = z.object({ topFocusX: focus, topFocusY: focus, topScale: scale, bottomFocusX: focus, bottomFocusY: focus, bottomScale: scale });

export const remainingActionSchemas = {
  "settings.set_tool_path": z.object({ tool: toolKey, selectedPath: text }),
  "settings.clear_tool_path": z.object({ tool: toolKey }),
  "settings.set_transcription_backend": z.object({ preference: z.enum(["auto", "cuda", "cpu"]) }),
  "settings.set_folder": z.object({ folder: folderKey, selectedPath: text }),
  "settings.clear_folder": z.object({ folder: folderKey }),
  "settings.set_automation": z.object({ setting: z.enum(["watchClipLibrary", "autoTranscribeOnImport"]), enabled: z.boolean() }),
  "profiles.save_creator_links": z.object({ payload: profileLinks }),
  "profiles.capture_creator_sample": z.object({ clipId: text, segment: timedSegment }),
  "profiles.record_voice_sample": z.object({ input: z.object({ profileId: text, audioData: z.instanceof(ArrayBuffer).refine(value => value.byteLength > 0 && value.byteLength <= 20 * 1024 * 1024), mimeType: z.string().regex(/^audio\//i), transcriptPreview: z.string() }) }),
  "profiles.remove_creator_sample": z.object({ sampleId: text }),
  "profiles.save_collaborators": z.object({ payload: z.array(collaborator) }),
  "profiles.save_ai": z.object({ payload: z.object({ profiles: z.array(aiProfile), assignments }) }),
  "settings.set_strict_ai": z.object({ enabled: z.boolean() }),
  "ai.download_setup_asset": z.object({ assetId: assetId }),
  "ai.install_recommended_setup": z.object({ recommendation: z.object({ runtimeId, modelId, reason: z.string(), memoryDetail: z.string() }) }),
  "ai.cancel_setup_download": z.object({ operationId: text }),
  "ai.import_runtime": z.object({ selectedPath: text }),
  "ai.clear_runtime": z.object({}),
  "ai.import_model": z.object({ selectedPath: text }),
  "profiles.capture_collaborator_sample": z.object({ collaboratorProfileId: text, clipId: text, segment: timedSegment }),
  "profiles.remove_collaborator_sample": z.object({ collaboratorProfileId: text, sampleId: text }),
  "youtube.save_credentials": z.object({ payload: z.object({ clientId: z.string(), clientSecret: z.string() }) }),
  "youtube.clear_credentials": z.object({}),
  "youtube.connect": z.object({}),
  "youtube.disconnect": z.object({}),
  "performance.refresh_post": z.object({ scheduledPostId: text }),
  "clips.clear_workspace_indexes": z.object({}),
  "clips.export_stacked_vertical": z.object({ clipId: text, outputPath: text, startMs: milliseconds, endMs: milliseconds, layout }).refine(value => value.endMs > value.startMs, { path: ["endMs"], message: "End must follow start." }),
  "long_form.export_trimmed": z.object({ sourceId: text, outputPath: text, startMs: milliseconds, endMs: milliseconds }).refine(value => value.endMs > value.startMs, { path: ["endMs"], message: "End must follow start." }),
  "long_form.export_stacked_vertical": z.object({ sourceId: text, outputPath: text, startMs: milliseconds, endMs: milliseconds, layout }).refine(value => value.endMs > value.startMs, { path: ["endMs"], message: "End must follow start." }),
  "transcripts.export_srt": z.object({ clipId: text, outputPath: text.refine(value => /\.srt$/i.test(value)) }),
  "ai.cancel_activity": z.object({ id: text }),
};
export type RemainingActionId = keyof typeof remainingActionSchemas;
/** Validation messages identify fields, never credentials, recordings or prompt contents. */
export function parseRemainingAction<K extends RemainingActionId>(actionId: K, value: unknown): z.output<(typeof remainingActionSchemas)[K]> {
  const result = remainingActionSchemas[actionId].safeParse(value);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => issue.path.join(".") || "input"))];
    throw new Error("Invalid input for action " + actionId + ": " + fields.join(", ") + ".");
  }
  return result.data as z.output<(typeof remainingActionSchemas)[K]>;
}
