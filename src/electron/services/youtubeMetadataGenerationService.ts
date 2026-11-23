import type { YouTubeManagedVideoRecord, YouTubeMetadataDraft } from "../../shared/contracts";
import { parseJsonResponse } from "../../shared/jsonResponse";
import { YOUTUBE_VIDEO_TITLE_MAX_LENGTH } from "../../shared/platformLimits";
import { resolveAiProfileForTask } from "./aiProfileService";
import { generateAiText } from "./aiExecutionService";

export async function generateYouTubeMetadataDraft(video: YouTubeManagedVideoRecord): Promise<YouTubeMetadataDraft> {
  const profile = resolveAiProfileForTask("youtube_metadata");
  if (!profile) {
    throw new Error("No enabled YouTube metadata AI profile is configured.");
  }

  const response = await generateAiText({
    task: "youtube_metadata",
    profileId: profile.id,
    preferredModel: profile.preferredModel,
    fallbackPreferences: ["qwen3:14b", "gemma3:12b", "mistral-small:24b"],
    systemPrompt: [
      profile.systemPrompt,
      "You are improving metadata for an already-owned YouTube video.",
      "Use only the supplied evidence. Do not invent events, people, games, or claims.",
      "Return one JSON object and no markdown."
    ].join("\n\n"),
    userPrompt: JSON.stringify({
      currentTitle: video.title,
      currentDescription: video.description,
      currentTags: video.tags,
      categoryId: video.categoryId,
      instruction: "Return improved title, description, and tags while preserving grounded creator voice."
    }),
    responseSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: YOUTUBE_VIDEO_TITLE_MAX_LENGTH },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      },
      required: ["title", "description", "tags"]
    },
    disableThinking: true,
    temperature: 0.35
  });

  const parsed = parseJsonResponse(response.responseText) as { title?: unknown; description?: unknown; tags?: unknown };
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  const tags = Array.isArray(parsed.tags)
    ? [...new Set(parsed.tags.map(String).map((tag) => tag.trim()).filter(Boolean))]
    : [];
  if (!title || title.length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH || Buffer.byteLength(description, "utf8") > 5000) {
    throw new Error("The local AI returned metadata outside YouTube's supported limits.");
  }

  return {
    videoId: video.videoId,
    title,
    description,
    tags,
    categoryId: video.categoryId,
    baseRemoteRevision: video.remoteRevision,
    updatedAt: new Date().toISOString()
  };
}
