import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDatabaseContext } from "./database";
import type { ThumbnailGenerationResult } from "../../shared/contracts";
import { parseJsonResponse } from "../../shared/jsonResponse";
import { buildAiProfileLearningPrompt } from "./aiProfileLearningService";
import { resolveAiProfileForTask } from "./aiProfileService";
import { getClipById } from "./clipRepository";
import { generateAiVision } from "./aiExecutionService";
import { analyzeCandidateMedia } from "./mediaAnalysisService";
import { createThumbnailCandidate } from "./youtubeVideoRepository";
import { fetchManagedYouTubeVideo } from "./youtubeService";

const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 360;

export async function generateThumbnailCandidatesForVideo(
  videoId: string,
  sourceClipId: string | null,
  candidateCount: number
): Promise<ThumbnailGenerationResult> {
  const video = await fetchManagedYouTubeVideo(videoId);
  if (!video) {
    throw new Error("The selected YouTube video is no longer available to this account.");
  }
  const profile = resolveAiProfileForTask("youtube_thumbnail");
  if (!profile) {
    throw new Error("No enabled YouTube thumbnail AI profile is configured.");
  }

  const frames = sourceClipId ? await getLocalClipFrames(sourceClipId) : null;
  const sourceFrameAnalysisAvailable = Boolean(frames?.frames.length);
  const imageDataUrls = frames?.frames.length ? frames.frames : await loadRemoteThumbnail(video.thumbnailUrl);
  if (imageDataUrls.length === 0) {
    throw new Error("No local clip frames or current YouTube thumbnail are available for thumbnail generation.");
  }

  const brief = await buildThumbnailBrief(profile, video.title, video.description, imageDataUrls, frames?.frameTimestampsMs ?? [])
    .catch(() => ({ text: "Use the clearest action frame with a strong focal subject and high contrast.", model: null }));
  const candidateDirectory = path.join(path.dirname(getDatabaseContext().databasePath), "thumbnails", videoId);
  await mkdir(candidateDirectory, { recursive: true });

  const candidates = [];
  const count = Math.min(Math.max(candidateCount, 1), 3);
  for (let index = 0; index < count; index += 1) {
    const frameIndex = frames?.frames.length ? index % frames.frames.length : 0;
    const imageDataUrl = imageDataUrls[frameIndex];
    const imageBuffer = decodeImageDataUrl(imageDataUrl);
    const localPath = path.join(candidateDirectory, `${Date.now()}-${randomUUID()}.png`);
    await writeFile(localPath, imageBuffer);
    const candidate = createThumbnailCandidate({
      videoId,
      sourceClipId,
      localPath,
      mimeType: "image/png",
      widthPx: THUMBNAIL_WIDTH,
      heightPx: THUMBNAIL_HEIGHT,
      sizeBytes: imageBuffer.byteLength,
      brief: `${brief.text} Candidate ${index + 1}.`,
      provenance: {
        task: "youtube_thumbnail",
        profileId: profile.id,
        profileName: profile.name,
        model: brief.model,
        executionMode: brief.model ? "ai" : "fallback",
        sourceVideoId: videoId,
        sourceClipId,
        sourceFrameTimestampsMs: frames?.frameTimestampsMs?.length
          ? [frames.frameTimestampsMs[frameIndex] ?? 0]
          : [],
        generatedAt: new Date().toISOString()
      }
    });
    candidates.push(candidate);
  }

  return {
    videoId,
    candidates,
    sourceFrameAnalysisAvailable,
    note: sourceFrameAnalysisAvailable
      ? "Candidates use locally sampled source frames. Review the image before applying it to YouTube."
      : "Source video frames were unavailable, so candidates use the current YouTube thumbnail only."
  };
}

async function getLocalClipFrames(sourceClipId: string): Promise<{ frames: string[]; frameTimestampsMs: number[] } | null> {
  const clip = getClipById(sourceClipId);
  if (!clip) {
    return null;
  }
  const endMs = Math.max(1, Math.min(clip.durationMs ?? 60_000, 60_000));
  const analysis = await analyzeCandidateMedia({
    sourcePath: clip.sourcePath,
    startMs: 0,
    endMs,
    includeFrames: true
  });
  return analysis.frames.length ? { frames: analysis.frames, frameTimestampsMs: analysis.frameTimestampsMs } : null;
}

async function loadRemoteThumbnail(thumbnailUrl: string | null): Promise<string[]> {
  if (!thumbnailUrl) {
    return [];
  }
  const response = await fetch(thumbnailUrl);
  if (!response.ok) {
    return [];
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return [`data:${contentType};base64,${buffer.toString("base64")}`];
}

async function buildThumbnailBrief(
  profile: import("../../shared/contracts").AiProfile,
  title: string,
  description: string,
  imageDataUrls: string[],
  timestampsMs: number[]
): Promise<{ text: string; model: string | null }> {
  const response = await generateAiVision({
    task: "youtube_thumbnail",
    profileId: profile.id,
    preferredModel: profile.preferredModel,
    fallbackPreferences: ["Qwen2.5-VL-7B-Instruct-Q4_K_M-ggml-org-official.gguf", "qwen2.5-vl:7b"],
    systemPrompt: [
      profile.systemPrompt,
      buildAiProfileLearningPrompt(profile),
      "Review these supplied frames as thumbnail evidence. Return exactly one JSON object. Do not invent people, events, or text that are not visibly supported."
    ].filter(Boolean).join("\n\n"),
    userPrompt: JSON.stringify({
      title,
      description: description.slice(0, 1000),
      frameTimestampsMs: timestampsMs,
      task: "Describe the strongest thumbnail treatment in one short sentence. Do not generate an image or claim that text is visible unless it is visible."
    }),
    imageDataUrls,
    responseSchema: {
      type: "object",
      additionalProperties: false,
      properties: { brief: { type: "string" } },
      required: ["brief"]
    },
    temperature: 0.1,
    timeoutMs: 120_000
  });
  const parsed = parseJsonResponse(response.responseText) as { brief?: unknown };
  const text = typeof parsed.brief === "string" && parsed.brief.trim()
    ? parsed.brief.trim()
    : "Use the clearest action frame with a strong focal subject and high contrast.";
  return { text, model: response.model };
}

function decodeImageDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) {
    throw new Error("The thumbnail frame was returned in an unsupported image format.");
  }
  return Buffer.from(match[1], "base64");
}
