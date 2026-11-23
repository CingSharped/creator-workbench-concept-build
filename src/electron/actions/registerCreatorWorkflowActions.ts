import { randomUUID } from "node:crypto";
import { registerRemainingActions } from "./registerRemainingActions";
import type {
  ClipMetadataPackageDraft,
  ClipMetadataPackageRecord,
  NextAvailablePostingSlotResult,
  PerformanceDashboardFilters,
  PublishExecutionMode,
  PublishPlatform,
  StackedVerticalLayoutSettings,
  TranscriptAssetRef,
  TranscriptAutoAssignScope,
  TranscriptSegmentRecord,
  VerticalLayoutPreferences,
  YouTubeMetadataDraft,
  YouTubeMetadataPatch
} from "../../shared/contracts";
import { applyYouTubeSchedule, previewPostingSlot, removeScheduledPost } from "../services/scheduledPostRepository";
import { YOUTUBE_VIDEO_TITLE_MAX_LENGTH } from "../../shared/platformLimits";
import { registerAppActionHandler, requireActionNumber, requireActionObject, requireActionString } from "./appActionExecutor";
import { importClipPaths } from "../services/clipImportService";
import { getClipMetadataByClipId, upsertClipMetadata } from "../services/clipMetadataRepository";
import { getClipById, listClips, updateClipStatus } from "../services/clipRepository";
import { createJob, updateJobProgress, updateJobStatus } from "../services/jobRepository";
import { generateClipMetadataCandidatesForClip, evaluateClipMetadataPackageForClip } from "../services/metadataGenerationService";
import { createLongFormSource } from "../services/longFormSourceRepository";
import { generateLongFormClipProposals, approveLongFormClipProposal, rejectLongFormClipProposal, cancelLongFormClipProposals, reopenLongFormClipProposal } from "../services/longFormClipProposalService";
import { inspectMediaFile } from "../services/mediaInspector";
import {
  generatePerformanceCoach,
  importYouTubeHistoricalPerformance,
  refreshPerformanceDashboard
} from "../services/performanceDashboardService";
import { exportTrimmedClip } from "../services/clipTrimService";
import {
  createScheduledPost,
  createScheduledPostAtNextSlot,
  getScheduledPostById,
  listScheduledPosts,
  updateScheduledPost
} from "../services/scheduledPostRepository";
import { getPostingScheduleSettings, savePostingScheduleSettings } from "../services/postingScheduleService";
import { createMetadataFeedback } from "../services/metadataFeedbackRepository";
import { removeClipFromWorkspaceIndex } from "../services/workspaceCleanup";
import { deleteClipAppData } from "../services/clipDataRemovalService";
import {
  cleanupOrphanedData,
  clearClipLibraryIndex,
  clearLongFormIndex,
  scanDataHealth
} from "../services/dataManagementService";
import { getTranscriptByClipId, saveTranscriptEdits, saveTranscriptEditsForAsset } from "../services/transcriptRepository";
import { autoAssignTranscriptSpeakers } from "../services/voiceProfileService";
import { cancelLongFormTranscription, discardLongFormPartialTranscript, saveLongFormPartialTranscript, transcribeClip, transcribeLongFormSource } from "../services/transcriptionService";
import { saveVerticalLayoutPreferences } from "../services/verticalLayoutPreferences";
import { generateThumbnailCandidatesForVideo } from "../services/thumbnailGenerationService";
import { generateYouTubeMetadataDraft } from "../services/youtubeMetadataGenerationService";
import {
  getYouTubeConnectionStatus,
  fetchManagedYouTubeVideo,
  listManagedYouTubeVideos,
  publishClipToYouTube,
  readYouTubeSchedule,
  refreshYouTubeScheduledPostStatuses,
  updateYouTubeVideoMetadata,
  uploadYouTubeThumbnail,
  uploadYouTubeCaptions
} from "../services/youtubeService";
import {
  listCachedYouTubeVideos,
  listThumbnailCandidates,
  markThumbnailCandidateApplied,
  replaceCachedYouTubeVideos,
  upsertYouTubeMetadataDraft
} from "../services/youtubeVideoRepository";

let registered = false;

export function registerCreatorWorkflowActions(): void {
  if (registered) {
    return;
  }

  registerRemainingActions();

  registerAppActionHandler("clips.import", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.import");
    const filePaths = input.filePaths;
    if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.some((filePath) => typeof filePath !== "string" || !filePath.trim())) {
      throw new Error("Action clips.import requires at least one file path.");
    }

    const source = input.source === "clip_library_sync" ? "clip_library_sync" : "manual_import";
    await importClipPaths(filePaths.map((filePath) => String(filePath).trim()), { source });
    return listClips();
  });

  registerAppActionHandler("long_form.import", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.import");
    const sourcePath = requireActionString(input, "sourcePath", "long_form.import");
    return createLongFormSource(await inspectMediaFile(sourcePath));
  });

  registerAppActionHandler("clips.transcribe", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.transcribe");
    return transcribeClip(requireActionString(input, "clipId", "clips.transcribe"));
  });

  registerAppActionHandler("long_form.transcribe", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.transcribe");
    return transcribeLongFormSource(requireActionString(input, "sourceId", "long_form.transcribe"));
  });

  registerAppActionHandler("long_form.cancel_transcription", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.cancel_transcription");
    return cancelLongFormTranscription(requireActionString(input, "sourceId", "long_form.cancel_transcription"));
  });

  registerAppActionHandler("long_form.save_partial_transcript", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.save_partial_transcript");
    return saveLongFormPartialTranscript(requireActionString(input, "sourceId", "long_form.save_partial_transcript"));
  });

  registerAppActionHandler("long_form.discard_partial_transcript", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.discard_partial_transcript");
    await discardLongFormPartialTranscript(requireActionString(input, "sourceId", "long_form.discard_partial_transcript"));
  });

  registerAppActionHandler("long_form.generate_proposals", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.generate_proposals");
    return generateLongFormClipProposals(requireActionString(input, "sourceId", "long_form.generate_proposals"));
  });

  registerAppActionHandler("long_form.approve_proposal", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.approve_proposal");
    return approveLongFormClipProposal(
      requireActionString(input, "sourceId", "long_form.approve_proposal"),
      requireActionString(input, "proposalId", "long_form.approve_proposal"),
      requireActionNumber(input, "startMs", "long_form.approve_proposal"),
      requireActionNumber(input, "endMs", "long_form.approve_proposal"),
      readStackedVerticalLayout(input.layout, "long_form.approve_proposal"),
      typeof input.fileName === "string" ? input.fileName : undefined
    );
  });

  registerAppActionHandler("long_form.reject_proposal", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.reject_proposal");
    const reason = typeof input.reason === "string" ? input.reason : undefined;
    return rejectLongFormClipProposal(
      requireActionString(input, "sourceId", "long_form.reject_proposal"),
      requireActionString(input, "proposalId", "long_form.reject_proposal"),
      reason
    );
  });

  registerAppActionHandler("long_form.reopen_proposal", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.reopen_proposal");
    return reopenLongFormClipProposal(
      requireActionString(input, "sourceId", "long_form.reopen_proposal"),
      requireActionString(input, "proposalId", "long_form.reopen_proposal")
    );
  });

  registerAppActionHandler("long_form.cancel_proposals", async (rawInput) => {
    const input = requireActionObject(rawInput, "long_form.cancel_proposals");
    return cancelLongFormClipProposals(requireActionString(input, "sourceId", "long_form.cancel_proposals"));
  });

  registerAppActionHandler("clips.generate_metadata", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.generate_metadata");
    const options = input.options && typeof input.options === "object" && !Array.isArray(input.options)
      ? input.options as Parameters<typeof generateClipMetadataCandidatesForClip>[1]
      : undefined;
    return generateClipMetadataCandidatesForClip(
      requireActionString(input, "clipId", "clips.generate_metadata"),
      options
    );
  });

  registerAppActionHandler("clips.save_metadata", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.save_metadata");
    const clipId = requireActionString(input, "clipId", "clips.save_metadata");
    const clip = getClipById(clipId);
    if (!clip) {
      throw new Error("The selected clip no longer exists.");
    }

    const payload = normalizeMetadataPackagePayload(input.payload);
    if (!payload.title) {
      throw new Error("A title is required before the clip can enter the publishing workflow.");
    }
    if (payload.title.length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH) {
      throw new Error(`YouTube titles must be ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters or fewer.`);
    }

    const scoreSnapshot = payload.latestScoreSnapshot ?? evaluateClipMetadataPackageForClip(clipId, payload);
    const metadata = upsertClipMetadata(clipId, { ...payload, latestScoreSnapshot: scoreSnapshot });
    updateClipStatus(clipId, "metadata_ready");
    return metadata;
  });

  registerAppActionHandler("transcripts.update", async (rawInput) => {
    const input = requireActionObject(rawInput, "transcripts.update");
    const payload = input.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Action transcripts.update requires a transcript payload.");
    }

    const transcriptPayload = payload as {
      textContent?: unknown;
      srtContent?: unknown;
      segments?: unknown;
      asset?: unknown;
    };
    if (typeof transcriptPayload.textContent !== "string" || typeof transcriptPayload.srtContent !== "string") {
      throw new Error("Action transcripts.update requires textContent and srtContent.");
    }

    const legacyClipId = requireActionString(input, "clipId", "transcripts.update");
    const asset = parseTranscriptAssetRef(transcriptPayload.asset);
    const segments = Array.isArray(transcriptPayload.segments)
      ? transcriptPayload.segments as TranscriptSegmentRecord[]
      : undefined;

    return asset
      ? saveTranscriptEditsForAsset(
          asset.assetType,
          asset.assetId,
          transcriptPayload.textContent,
          transcriptPayload.srtContent,
          segments
        )
      : saveTranscriptEdits(
          legacyClipId,
          transcriptPayload.textContent,
          transcriptPayload.srtContent,
          segments
        );
  });

  registerAppActionHandler("transcripts.auto_assign_speakers", async (rawInput) => {
    const input = requireActionObject(rawInput, "transcripts.auto_assign_speakers");
    const scope = input.scope === undefined ? undefined : input.scope;
    if (scope !== undefined && scope !== "all" && scope !== "needs_review") {
      throw new Error("Action transcripts.auto_assign_speakers received an invalid scope.");
    }

    return autoAssignTranscriptSpeakers(
      requireActionString(input, "clipId", "transcripts.auto_assign_speakers"),
      scope as TranscriptAutoAssignScope | undefined
    );
  });

  registerAppActionHandler("clips.export_trimmed", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.export_trimmed");
    return exportTrimmedClip({
      clipId: requireActionString(input, "clipId", "clips.export_trimmed"),
      startMs: requireActionNumber(input, "startMs", "clips.export_trimmed"),
      endMs: requireActionNumber(input, "endMs", "clips.export_trimmed"),
      outputPath: requireActionString(input, "outputPath", "clips.export_trimmed")
    });
  });

  registerAppActionHandler("scheduled_posts.create", async (rawInput) => {
    const input = requireActionObject(rawInput, "scheduled_posts.create");
    const clipId = requireActionString(input, "clipId", "scheduled_posts.create");
    const clip = getClipById(clipId);
    if (!clip) {
      throw new Error("The selected clip no longer exists.");
    }

    const metadata = getClipMetadataByClipId(clipId);
    if (!metadata) {
      throw new Error("Save a metadata package before creating a scheduled post.");
    }
    if (metadata.title.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH) {
      throw new Error(`Shorten the title to ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters or fewer before scheduling.`);
    }

    const platform = requireActionString(input, "platform", "scheduled_posts.create");
    if (platform !== "youtube" && platform !== "tiktok") {
      throw new Error("Action scheduled_posts.create received an unsupported platform.");
    }

    const publishAt = requireActionString(input, "publishAt", "scheduled_posts.create");
    const publishDate = new Date(publishAt);
    if (Number.isNaN(publishDate.getTime())) {
      throw new Error("The selected publish time is invalid.");
    }

    const youtubePlaylistIds = Array.isArray(input.youtubePlaylistIds)
      ? input.youtubePlaylistIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const youtubeConnection = platform === "youtube" ? getYouTubeConnectionStatus() : null;
    if (platform === "youtube" && !youtubeConnection?.connected) {
      throw new Error("Connect your YouTube account in Settings before scheduling uploads there.");
    }

    const post = createScheduledPost({
      workspaceId: clip.workspaceId,
      clipId,
      platform: platform as PublishPlatform,
      accountLabel: platform === "youtube" ? youtubeConnection?.channelTitle ?? "Connected YouTube channel" : "Primary account",
      channelId: youtubeConnection?.channelId ?? null,
      publishAt: publishDate.toISOString(),
      executionMode: getDefaultExecutionMode(platform as PublishPlatform),
      title: metadata.title,
      description: metadata.description,
      platformTags: metadata.platformTags,
      youtubePlaylistIds
    });

    updateClipStatus(clipId, "scheduled");
    if (platform !== "youtube") {
      return post;
    }

    return publishScheduledYouTubePost(post, clip, metadata, youtubePlaylistIds);
  });

  registerAppActionHandler("scheduled_posts.get_next_slot", async (): Promise<NextAvailablePostingSlotResult> => {
    const youtubeConnection = getYouTubeConnectionStatus();
    if (!youtubeConnection?.connected) {
      return {
        publishAt: null,
        slotId: null,
        reason: "youtube_disconnected",
        localLabel: null
      };
    }

    return previewPostingSlot(getPostingScheduleSettings(), youtubeConnection.channelId, youtubeConnection.channelTitle);
  });

  registerAppActionHandler("scheduled_posts.create_next_slot", async (rawInput) => {
    const input = requireActionObject(rawInput, "scheduled_posts.create_next_slot");
    const clipId = requireActionString(input, "clipId", "scheduled_posts.create_next_slot");
    const clip = getClipById(clipId);
    if (!clip) {
      throw new Error("The selected clip no longer exists.");
    }

    const metadata = getClipMetadataByClipId(clipId);
    if (!metadata) {
      throw new Error("Save a metadata package before publishing at the next slot.");
    }
    if (metadata.title.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH) {
      throw new Error(`Shorten the title to ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters or fewer before publishing.`);
    }

    const youtubeConnection = getYouTubeConnectionStatus();
    if (!youtubeConnection?.connected) {
      throw new Error("Connect your YouTube account in Settings before publishing at the next slot.");
    }

    const youtubePlaylistIds = Array.isArray(input.youtubePlaylistIds)
      ? input.youtubePlaylistIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const reservation = createScheduledPostAtNextSlot({
      workspaceId: clip.workspaceId,
      clipId,
      platform: "youtube",
      accountLabel: youtubeConnection.channelTitle ?? "Connected YouTube channel",
      channelId: youtubeConnection.channelId ?? null,
      publishAt: "",
      executionMode: getDefaultExecutionMode("youtube"),
      title: metadata.title,
      description: metadata.description,
      platformTags: metadata.platformTags,
      youtubePlaylistIds,
      schedule: getPostingScheduleSettings()
    });

    if (!reservation.post) {
      throw new Error(getNextSlotErrorMessage(reservation.resolution));
    }

    updateClipStatus(clipId, "scheduled");
    return publishScheduledYouTubePost(reservation.post, clip, metadata, youtubePlaylistIds);
  });

  registerAppActionHandler("settings.get_posting_schedule", async () => getPostingScheduleSettings());

  registerAppActionHandler("settings.save_posting_schedule", async (rawInput) => {
    const input = requireActionObject(rawInput, "settings.save_posting_schedule");
    return savePostingScheduleSettings(input.settings);
  });

  registerAppActionHandler("scheduled_posts.retry_captions", async (rawInput) => {
    const input = requireActionObject(rawInput, "scheduled_posts.retry_captions");
    const postId = requireActionString(input, "postId", "scheduled_posts.retry_captions");
    const post = getScheduledPostById(postId);
    if (!post || post.platform !== "youtube") {
      throw new Error("The selected post is not an eligible YouTube post.");
    }

    const videoId = post.remotePostId?.trim();
    if (!videoId) {
      throw new Error("This YouTube post has no uploaded video ID yet.");
    }

    const captionResult = await uploadYouTubeCaptions({
      videoId,
      transcript: getTranscriptByClipId(post.clipId),
      existingCaptionRemoteId: post.captionRemoteId
    });
    return updateScheduledPost(post.id, {
      captionStatus: captionResult.status,
      captionRemoteId: captionResult.remoteCaptionId,
      captionLanguage: captionResult.language,
      captionName: captionResult.name,
      captionErrorMessage: captionResult.errorMessage,
      captionUpdatedAt: new Date().toISOString()
    }) ?? post;
  });

  registerAppActionHandler("scheduled_posts.reconcile", async (rawInput) => {
    const input = requireActionObject(rawInput, "scheduled_posts.reconcile");
    const postId = requireActionString(input, "postId", "scheduled_posts.reconcile");
    const post = getScheduledPostById(postId);
    if (!post || post.platform !== "youtube") {
      throw new Error("The selected post is not an eligible YouTube post.");
    }

    const checkedAt = new Date().toISOString();
    if (!post.remotePostId?.trim()) {
      const reason = "No remote video ID is available. Check YouTube manually before deciding whether a retry is safe.";
      return updateScheduledPost(post.id, {
        status: "reconciliation_required",
        remoteOutcome: "unknown",
        lastRemoteCheckAt: checkedAt,
        reconciliationReason: reason,
        errorMessage: reason
      }) ?? post;
    }

    try {
      const result = await refreshYouTubeScheduledPostStatuses([post]);
      const remoteUpdate = result.updates.find((update) => update.postId === post.id);
      if (remoteUpdate) {
        return updateScheduledPost(post.id, {
          status: remoteUpdate.status,
          remoteOutcome: "confirmed",
          lastRemoteCheckAt: checkedAt,
          reconciliationReason: null,
          errorMessage: null
        }) ?? post;
      }

      if (result.checkedCount > 0) {
        return updateScheduledPost(post.id, {
          remoteOutcome: "confirmed",
          lastRemoteCheckAt: checkedAt,
          reconciliationReason: null,
          errorMessage: null
        }) ?? post;
      }

      const reason = "YouTube did not return this video. Check YouTube manually before deciding whether a retry is safe.";
      return updateScheduledPost(post.id, {
        status: "reconciliation_required",
        remoteOutcome: "unknown",
        lastRemoteCheckAt: checkedAt,
        reconciliationReason: reason,
        errorMessage: reason
      }) ?? post;
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube status could not be checked.";
      return updateScheduledPost(post.id, {
        status: "reconciliation_required",
        remoteOutcome: "unknown",
        lastRemoteCheckAt: checkedAt,
        reconciliationReason: `YouTube status could not be checked. Check manually before retrying. ${message}`,
        errorMessage: message
      }) ?? post;
    }
  });

  registerAppActionHandler("scheduled_posts.remove", async rawInput => {
    const input = requireActionObject(rawInput, "scheduled_posts.remove");
    removeScheduledPost(requireActionString(input, "postId", "scheduled_posts.remove"));
  });

  registerAppActionHandler("scheduled_posts.refresh_statuses", async () => {
    const { channelId, channelTitle } = getYouTubeConnectionStatus();
    if (!channelId) throw new Error("Connect YouTube to refresh the schedule.");
    const originals = listScheduledPosts().filter(post => post.platform === "youtube" &&
      (post.channelId ? post.channelId === channelId : post.accountLabel === channelTitle));
    const videos = await readYouTubeSchedule(channelId);
    if (getYouTubeConnectionStatus().channelId !== channelId) throw new Error("YouTube account changed. Refresh again.");
    const updatedCount = applyYouTubeSchedule(channelId, originals, videos);
    return { checkedCount: videos.size, skippedCount: 0, unavailableCount: 0, updatedCount, posts: listScheduledPosts() };
  });

  registerAppActionHandler("performance.refresh_dashboard", async (rawInput) => {
    const input = requireActionObject(rawInput, "performance.refresh_dashboard");
    return refreshPerformanceDashboard(input.filters as Partial<PerformanceDashboardFilters> | undefined);
  });

  registerAppActionHandler("performance.generate_coach", async (rawInput) => {
    const input = requireActionObject(rawInput, "performance.generate_coach");
    const focus = input.focus;
    if (focus !== undefined && focus !== "overview" && focus !== "video" && focus !== "packaging" && focus !== "retention") {
      throw new Error("Action performance.generate_coach received an unsupported focus.");
    }
    return generatePerformanceCoach({
      filters: input.filters as Partial<PerformanceDashboardFilters> | undefined,
      videoId: typeof input.videoId === "string" ? input.videoId : undefined,
      focus: focus as "overview" | "video" | "packaging" | "retention" | undefined
    });
  });

  registerAppActionHandler("performance.import_youtube_history", async (rawInput) => {
    const input = requireActionObject(rawInput, "performance.import_youtube_history");
    return importYouTubeHistoricalPerformance({
      publishedAfter: typeof input.publishedAfter === "string" ? input.publishedAfter : undefined,
      maxVideos: typeof input.maxVideos === "number" ? input.maxVideos : undefined
    });
  });

  registerAppActionHandler("youtube_videos.refresh", async (rawInput) => {
    const input = requireActionObject(rawInput, "youtube_videos.refresh");
    const videos = await listManagedYouTubeVideos({
      publishedAfter: typeof input.publishedAfter === "string" ? input.publishedAfter : "2020-01-01",
      maxResults: typeof input.maxResults === "number" ? input.maxResults : undefined
    });
    const posts = listScheduledPosts();
    const enriched = videos.map((video) => {
      const post = posts.find((candidate) => candidate.platform === "youtube" && candidate.remotePostId === video.videoId);
      return {
        ...video,
        linkedClipId: post?.clipId ?? null,
        linkedScheduledPostId: post?.id ?? null
      };
    });
    replaceCachedYouTubeVideos(enriched);
    return enriched;
  });

  registerAppActionHandler("youtube_videos.save_draft", async (rawInput) => {
    const input = requireActionObject(rawInput, "youtube_videos.save_draft");
    const videoId = requireActionString(input, "videoId", "youtube_videos.save_draft");
    const draft = input.draft;
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
      throw new Error("Action youtube_videos.save_draft requires a metadata draft.");
    }
    const candidate = draft as Record<string, unknown>;
    const normalized: Omit<YouTubeMetadataDraft, "updatedAt"> = {
      videoId,
      title: readMetadataText(candidate.title, "title"),
      description: readMetadataText(candidate.description, "description"),
      tags: readMetadataTags(candidate.tags),
      categoryId: readMetadataText(candidate.categoryId, "categoryId"),
      baseRemoteRevision: typeof candidate.baseRemoteRevision === "string" ? candidate.baseRemoteRevision : null
    };
    validateYouTubeMetadata(normalized);
    return upsertYouTubeMetadataDraft(normalized);
  });

  registerAppActionHandler("youtube_videos.generate_metadata", async (rawInput) => {
    const input = requireActionObject(rawInput, "youtube_videos.generate_metadata");
    const videoId = requireActionString(input, "videoId", "youtube_videos.generate_metadata");
    const video = await fetchManagedYouTubeVideo(videoId);
    if (!video) {
      throw new Error("The selected YouTube video is no longer available to this account.");
    }
    return generateYouTubeMetadataDraft(video);
  });

  registerAppActionHandler("youtube_videos.update_metadata", async (rawInput) => {
    const input = requireActionObject(rawInput, "youtube_videos.update_metadata");
    const videoId = requireActionString(input, "videoId", "youtube_videos.update_metadata");
    const patch = readYouTubeMetadataPatch(input.patch);
    const current = await fetchManagedYouTubeVideo(videoId);
    if (!current) {
      throw new Error("The selected YouTube video is no longer available to this account.");
    }
    if (typeof input.baseRemoteRevision === "string" && input.baseRemoteRevision !== current.remoteRevision) {
      throw new Error("This YouTube video changed since it was loaded. Refresh it before applying your edits.");
    }
    validateYouTubeMetadata({
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      tags: patch.tags ?? current.tags,
      categoryId: patch.categoryId ?? current.categoryId
    });
    const updated = await updateYouTubeVideoMetadata({ videoId, current, patch });
    replaceCachedYouTubeVideos(upsertCachedVideo(updated));
    return updated;
  });

  registerAppActionHandler("youtube_videos.bulk_update_metadata", async (rawInput) => {
    const input = requireActionObject(rawInput, "youtube_videos.bulk_update_metadata");
    const videoIds = Array.isArray(input.videoIds)
      ? input.videoIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
    const fields = readBulkMetadataFields(input.fields);
    if (videoIds.length === 0) {
      throw new Error("Select at least one YouTube video before starting a bulk edit.");
    }
    if (!fields.title && !fields.description && !fields.tags && !fields.categoryId) {
      throw new Error("Choose at least one metadata field before starting a bulk edit.");
    }

    const baseRemoteRevisions = input.baseRemoteRevisions && typeof input.baseRemoteRevisions === "object"
      ? input.baseRemoteRevisions as Record<string, unknown>
      : {};
    const result = {
      operationId: randomUUID(),
      completed: [] as string[],
      failed: [] as Array<{ videoId: string; errorMessage: string }>,
      conflicts: [] as Array<{ videoId: string; errorMessage: string }>,
      skipped: [] as Array<{ videoId: string; reason: string }>
    };
    for (const videoId of [...new Set(videoIds)]) {
      try {
        const current = await fetchManagedYouTubeVideo(videoId);
        if (!current) {
          result.skipped.push({ videoId, reason: "Video is no longer available to this account." });
          continue;
        }
        const expectedRevision = baseRemoteRevisions[videoId];
        if (typeof expectedRevision === "string" && expectedRevision !== current.remoteRevision) {
          result.conflicts.push({ videoId, errorMessage: "The video changed after the bulk preview was created." });
          continue;
        }
        const patch: YouTubeMetadataPatch = {
          title: fields.title,
          description: fields.description,
          categoryId: fields.categoryId,
          tags: fields.tags
            ? applyBulkTagMode(current.tags, fields.tags, fields.tagMode)
            : undefined
        };
        validateYouTubeMetadata({
          title: patch.title ?? current.title,
          description: patch.description ?? current.description,
          tags: patch.tags ?? current.tags,
          categoryId: patch.categoryId ?? current.categoryId
        });
        const updated = await updateYouTubeVideoMetadata({ videoId, current, patch });
        replaceCachedYouTubeVideos(upsertCachedVideo(updated));
        result.completed.push(videoId);
      } catch (error) {
        result.failed.push({
          videoId,
          errorMessage: error instanceof Error ? error.message : "YouTube rejected this metadata update."
        });
      }
    }
    return result;
  });

  registerAppActionHandler("thumbnails.generate_candidates", async (rawInput) => {
    const input = requireActionObject(rawInput, "thumbnails.generate_candidates");
    const videoId = requireActionString(input, "videoId", "thumbnails.generate_candidates");
    const sourceClipId = typeof input.sourceClipId === "string" ? input.sourceClipId : null;
    const candidateCount = typeof input.candidateCount === "number" ? Math.min(Math.max(Math.floor(input.candidateCount), 1), 3) : 3;
    return generateThumbnailCandidatesForVideo(videoId, sourceClipId, candidateCount);
  });

  registerAppActionHandler("thumbnails.save_candidate", async (rawInput) => {
    const input = requireActionObject(rawInput, "thumbnails.save_candidate");
    const videoId = requireActionString(input, "videoId", "thumbnails.save_candidate");
    const candidateId = requireActionString(input, "candidateId", "thumbnails.save_candidate");
    const candidate = listThumbnailCandidates(videoId).find((item) => item.id === candidateId);
    if (!candidate) {
      throw new Error("The selected thumbnail candidate is no longer available.");
    }
    return candidate;
  });

  registerAppActionHandler("thumbnails.apply_to_youtube", async (rawInput) => {
    const input = requireActionObject(rawInput, "thumbnails.apply_to_youtube");
    const videoId = requireActionString(input, "videoId", "thumbnails.apply_to_youtube");
    const candidateId = requireActionString(input, "candidateId", "thumbnails.apply_to_youtube");
    const candidate = listThumbnailCandidates(videoId).find((item) => item.id === candidateId);
    if (!candidate) {
      throw new Error("The selected thumbnail candidate is no longer available.");
    }
    const current = await fetchManagedYouTubeVideo(videoId);
    if (!current) {
      throw new Error("The selected YouTube video is no longer available to this account.");
    }
    const updated = await uploadYouTubeThumbnail({ videoId, filePath: candidate.localPath });
    markThumbnailCandidateApplied(candidateId);
    replaceCachedYouTubeVideos(upsertCachedVideo({ ...updated, linkedClipId: current.linkedClipId, linkedScheduledPostId: current.linkedScheduledPostId }));
    return updated;
  });

  registerAppActionHandler("metadata.record_feedback", async (rawInput) => {
    const input = requireActionObject(rawInput, "metadata.record_feedback");
    const clipId = requireActionString(input, "clipId", "metadata.record_feedback");
    const variantId = requireActionString(input, "variantId", "metadata.record_feedback");
    const decision = requireActionString(input, "decision", "metadata.record_feedback");
    if (decision !== "approved" && decision !== "edited" && decision !== "rejected") {
      throw new Error("Action metadata.record_feedback received an unsupported decision.");
    }
    return createMetadataFeedback(clipId, variantId, decision);
  });

  registerAppActionHandler("clips.remove_from_workspace", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.remove_from_workspace");
    removeClipFromWorkspaceIndex(requireActionString(input, "clipId", "clips.remove_from_workspace"));
    return listClips();
  });

  registerAppActionHandler("clips.delete_app_data", async (rawInput) => {
    const input = requireActionObject(rawInput, "clips.delete_app_data");
    return deleteClipAppData(requireActionString(input, "clipId", "clips.delete_app_data"));
  });

  registerAppActionHandler("data_management.scan", async () => scanDataHealth());

  registerAppActionHandler("data_management.clear_clip_library", async () => clearClipLibraryIndex());

  registerAppActionHandler("data_management.clear_long_form", async () => clearLongFormIndex());

  registerAppActionHandler("data_management.cleanup_orphans", async (rawInput) => {
    const input = requireActionObject(rawInput, "data_management.cleanup_orphans");
    const issueIds = input.issueIds;
    if (!Array.isArray(issueIds) || issueIds.some((issueId) => typeof issueId !== "string")) {
      throw new Error("Choose valid orphan records before cleanup.");
    }
    return cleanupOrphanedData(issueIds);
  });

  registerAppActionHandler("ui.save_vertical_layout_preferences", async (rawInput) => {
    const input = requireActionObject(rawInput, "ui.save_vertical_layout_preferences");
    const preferences = requireActionObject(input.preferences, "ui.save_vertical_layout_preferences") as unknown as VerticalLayoutPreferences;
    return saveVerticalLayoutPreferences(preferences);
  });

  registered = true;
}

async function publishScheduledYouTubePost(
  post: import("../../shared/contracts").ScheduledPostRecord,
  clip: import("../../shared/contracts").ClipRecord,
  metadata: ClipMetadataPackageRecord,
  youtubePlaylistIds: string[]
): Promise<import("../../shared/contracts").ScheduledPostRecord> {
  const uploadJob = createJob({ workspaceId: clip.workspaceId, clipId: clip.id, jobType: "youtube_upload", assetType: "clip", assetId: clip.id });
  updateScheduledPost(post.id, {
    operationId: uploadJob.id,
    status: "posting",
    remoteOutcome: "pending",
    reconciliationReason: null,
    errorMessage: null
  });
  updateJobStatus(uploadJob.id, "running");
  updateJobProgress(uploadJob.id, {
    phase: "uploading",
    message: "Uploading the saved metadata package and video to YouTube.",
    cancellable: false
  });

  try {
    const remoteResult = await publishClipToYouTube({
      clip,
      metadata,
      publishAt: post.publishAt,
      playlistIds: youtubePlaylistIds,
      transcriptLanguage: getTranscriptByClipId(clip.id)?.language
    });
    updateScheduledPost(post.id, {
      status: remoteResult.status,
      remoteOutcome: "confirmed",
      lastRemoteCheckAt: new Date().toISOString(),
      reconciliationReason: null,
      remotePostId: remoteResult.videoId,
      publishedUrl: remoteResult.videoUrl,
      errorMessage: null
    });

    let captionResult;
    try {
      captionResult = await uploadYouTubeCaptions({
        videoId: remoteResult.videoId,
        transcript: getTranscriptByClipId(clip.id),
        existingCaptionRemoteId: post.captionRemoteId
      });
    } catch (captionError) {
      captionResult = {
        status: "failed" as const,
        remoteCaptionId: null,
        language: null,
        name: "Creator Workbench transcript",
        errorMessage: captionError instanceof Error
          ? `The video uploaded, but captions could not be added: ${captionError.message}`
          : "The video uploaded, but captions could not be added."
      };
    }
    updateJobStatus(uploadJob.id, "completed");
    updateJobProgress(uploadJob.id, {
      phase: "complete",
      percent: 100,
      elapsedMs: Date.now() - new Date(uploadJob.createdAt).getTime(),
      message: "YouTube upload completed."
    });
    try {
      return updateScheduledPost(post.id, {
        captionStatus: captionResult.status,
        captionRemoteId: captionResult.remoteCaptionId,
        captionLanguage: captionResult.language,
        captionName: captionResult.name,
        captionErrorMessage: captionResult.errorMessage,
        captionUpdatedAt: new Date().toISOString()
      }) ?? getScheduledPostById(post.id) ?? post;
    } catch {
      return getScheduledPostById(post.id) ?? post;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload the clip to YouTube.";
    updateScheduledPost(post.id, {
      status: "reconciliation_required",
      remoteOutcome: "unknown",
      lastRemoteCheckAt: null,
      reconciliationReason: `The YouTube upload outcome is uncertain. Check YouTube before retrying to avoid a duplicate upload. ${message}`,
      errorMessage: message,
      captionStatus: "not_applicable",
      captionErrorMessage: null,
      captionUpdatedAt: new Date().toISOString()
    });
    updateJobStatus(uploadJob.id, "failed", message);
    updateJobProgress(uploadJob.id, { phase: "failed", message: "YouTube upload failed. Review the error before retrying." });
    throw new Error(message);
  }
}

function getNextSlotErrorMessage(resolution: NextAvailablePostingSlotResult): string {
  if (resolution.reason === "not_configured") {
    return "Configure an enabled recurring posting time in Settings before using the next-slot action.";
  }
  if (resolution.reason === "no_free_slot") {
    return "All recurring posting slots are occupied for the next 90 days. Choose a manual publish time or free a slot.";
  }
  if (resolution.reason === "youtube_disconnected") {
    return "Connect your YouTube account in Settings before using the next-slot action.";
  }
  return "No available recurring posting slot was found.";
}

function parseTranscriptAssetRef(value: unknown): TranscriptAssetRef | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Action transcripts.update received an invalid transcript asset reference.");
  }

  const candidate = value as { assetType?: unknown; assetId?: unknown };
  if (
    (candidate.assetType !== "clip" && candidate.assetType !== "long_form_source") ||
    typeof candidate.assetId !== "string" ||
    candidate.assetId.trim().length === 0
  ) {
    throw new Error("Action transcripts.update received an invalid transcript asset reference.");
  }

  return {
    assetType: candidate.assetType,
    assetId: candidate.assetId.trim()
  };
}

function readStackedVerticalLayout(value: unknown, actionId: "long_form.approve_proposal"): StackedVerticalLayoutSettings {
  if (value === undefined) {
    return {
      topFocusX: 0.5,
      topFocusY: 0.5,
      topScale: 1,
      bottomFocusX: 0.5,
      bottomFocusY: 0.5,
      bottomScale: 1
    };
  }

  const layout = requireActionObject(value, actionId);
  return {
    topFocusX: requireActionNumber(layout, "topFocusX", actionId),
    topFocusY: requireActionNumber(layout, "topFocusY", actionId),
    topScale: requireActionNumber(layout, "topScale", actionId),
    bottomFocusX: requireActionNumber(layout, "bottomFocusX", actionId),
    bottomFocusY: requireActionNumber(layout, "bottomFocusY", actionId),
    bottomScale: requireActionNumber(layout, "bottomScale", actionId)
  };
}

function normalizeMetadataPackagePayload(value: unknown): ClipMetadataPackageDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Action clips.save_metadata requires a metadata package payload.");
  }

  const payload = value as Partial<ClipMetadataPackageDraft>;
  return {
    title: typeof payload.title === "string" ? payload.title.trim() : "",
    description: typeof payload.description === "string" ? payload.description.trim() : "",
    publicHashtags: Array.isArray(payload.publicHashtags) ? payload.publicHashtags.map(String).map((tag) => tag.trim()).filter(Boolean) : [],
    platformTags: Array.isArray(payload.platformTags) ? payload.platformTags.map(String).map((tag) => tag.trim()).filter(Boolean) : [],
    seriesKey: typeof payload.seriesKey === "string" ? payload.seriesKey.trim() : "",
    gameTitle: typeof payload.gameTitle === "string" ? payload.gameTitle.trim() : "",
    collaboratorProfileIds: Array.isArray(payload.collaboratorProfileIds) ? payload.collaboratorProfileIds.map(String).map((id) => id.trim()).filter(Boolean) : [],
    selectedVariantIds: {
      title: payload.selectedVariantIds?.title ?? null,
      description: payload.selectedVariantIds?.description ?? null,
      publicHashtags: payload.selectedVariantIds?.publicHashtags ?? null,
      platformTags: payload.selectedVariantIds?.platformTags ?? null
    },
    latestScoreSnapshot: payload.latestScoreSnapshot ?? null
  };
}

function readMetadataText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`YouTube metadata ${field} must be text.`);
  }
  return value.trim();
}

function readMetadataTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("YouTube metadata tags must be an array.");
  }
  return [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean))];
}

function readYouTubeMetadataPatch(value: unknown): YouTubeMetadataPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YouTube metadata update requires a patch.");
  }
  const patch = value as Record<string, unknown>;
  const result: YouTubeMetadataPatch = {};
  if (patch.title !== undefined) result.title = readMetadataText(patch.title, "title");
  if (patch.description !== undefined) result.description = readMetadataText(patch.description, "description");
  if (patch.categoryId !== undefined) result.categoryId = readMetadataText(patch.categoryId, "categoryId");
  if (patch.tags !== undefined) result.tags = readMetadataTags(patch.tags);
  return result;
}

function readBulkMetadataFields(value: unknown): {
  title?: string;
  description?: string;
  tags?: string[];
  tagMode?: "replace" | "add" | "remove";
  categoryId?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bulk YouTube metadata editing requires selected fields.");
  }
  const fields = value as Record<string, unknown>;
  const result: {
    title?: string;
    description?: string;
    tags?: string[];
    tagMode?: "replace" | "add" | "remove";
    categoryId?: string;
  } = {};
  if (fields.title !== undefined) result.title = readMetadataText(fields.title, "title");
  if (fields.description !== undefined) result.description = readMetadataText(fields.description, "description");
  if (fields.categoryId !== undefined) result.categoryId = readMetadataText(fields.categoryId, "categoryId");
  if (fields.tags !== undefined) result.tags = readMetadataTags(fields.tags);
  if (fields.tagMode !== undefined && fields.tagMode !== "replace" && fields.tagMode !== "add" && fields.tagMode !== "remove") {
    throw new Error("Bulk YouTube metadata received an invalid tag mode.");
  }
  if (fields.tagMode !== undefined) result.tagMode = fields.tagMode;
  return result;
}

function applyBulkTagMode(
  currentTags: string[],
  nextTags: string[],
  mode: "replace" | "add" | "remove" | undefined
): string[] {
  if (!mode || mode === "replace") {
    return nextTags;
  }
  if (mode === "add") {
    return [...new Set([...currentTags, ...nextTags])];
  }
  const removals = new Set(nextTags.map((tag) => tag.toLowerCase()));
  return currentTags.filter((tag) => !removals.has(tag.toLowerCase()));
}

function validateYouTubeMetadata(input: {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
}): void {
  if (!input.title.trim()) {
    throw new Error("YouTube titles cannot be empty.");
  }
  if (input.title.length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH) {
    throw new Error(`YouTube titles must be ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters or fewer.`);
  }
  if (Buffer.byteLength(input.description, "utf8") > 5000) {
    throw new Error("YouTube descriptions must be 5,000 bytes or fewer.");
  }
  if (!input.categoryId.trim()) {
    throw new Error("A YouTube category is required when updating metadata.");
  }
  if (input.tags.some((tag) => !tag.trim())) {
    throw new Error("YouTube tags cannot contain empty values.");
  }
}

function upsertCachedVideo(video: import("../../shared/contracts").YouTubeManagedVideoRecord): import("../../shared/contracts").YouTubeManagedVideoRecord[] {
  const current = listCachedYouTubeVideos().filter((candidate) => candidate.videoId !== video.videoId);
  return [...current, video];
}

function getDefaultExecutionMode(platform: PublishPlatform): PublishExecutionMode {
  return platform === "youtube" ? "native_schedule" : "draft_handoff";
}
