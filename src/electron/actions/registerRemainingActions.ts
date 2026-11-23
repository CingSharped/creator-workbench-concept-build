import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptSegmentRecord } from "../../shared/contracts";
import { registerAppActionHandler } from "./appActionExecutor";
import { parseRemainingAction } from "./remainingActionSchemas";
import { setAppSetting, clearAppSetting } from "../services/settingsRepository";
import { getToolSettingStorageKey, setWhisperBackendPreference } from "../services/runtimeTools";
import { setWorkspaceFolderSetting, clearWorkspaceFolderSetting, setWorkspaceAutomationSetting } from "../services/workspacePreferences";
import { refreshClipLibraryWatcher } from "../services/clipLibraryWatcher";
import { saveCreatorProfileLinks, saveCollaboratorProfiles, removeCreatorVoiceSample, removeCollaboratorVoiceSample } from "../services/creatorProfileLinks";
import { captureCreatorVoiceSample, captureCollaboratorVoiceSample, recordVoiceProfileSample } from "../services/voiceProfileService";
import { saveAiProfilesConfiguration, setAiStrictModeEnabled } from "../services/aiProfileService";
import { downloadLocalAiSetupAsset, installRecommendedLocalAiSetup, cancelLocalAiSetupDownload } from "../services/localAiSetupService";
import { importLocalAiRuntimeExecutable, clearLocalAiRuntimeExecutable, importLocalAiModelFile } from "../services/localAiRuntimeService";
import { saveYouTubeCredentials, clearYouTubeCredentials, connectYouTube, disconnectYouTube, fetchYouTubePerformanceSnapshot, getYouTubeConnectionStatus } from "../services/youtubeService";
import { upsertYouTubePerformanceSnapshot } from "../services/youtubePerformanceSnapshotRepository";
import { getScheduledPostById } from "../services/scheduledPostRepository";
import { clearWorkspaceClipIndexes } from "../services/workspaceCleanup";
import { getClipById, listClips } from "../services/clipRepository";
import { getLongFormSourceById } from "../services/longFormSourceRepository";
import { getTranscriptByClipId } from "../services/transcriptRepository";
import { exportStackedVerticalClip, exportTrimmedMedia, exportStackedVerticalMedia } from "../services/clipTrimService";
import { cancelAiActivity } from "../services/aiActivityService";

let registered = false;
export function registerRemainingActions(): void {
  if (registered) return;
  registerAppActionHandler("settings.set_tool_path", async rawInput => {
    const input = parseRemainingAction("settings.set_tool_path", rawInput);
    setAppSetting(getToolSettingStorageKey(input.tool), input.selectedPath);
  });

  registerAppActionHandler("settings.clear_tool_path", async rawInput => {
    const input = parseRemainingAction("settings.clear_tool_path", rawInput);
    clearAppSetting(getToolSettingStorageKey(input.tool));
  });

  registerAppActionHandler("settings.set_transcription_backend", async rawInput => {
    const input = parseRemainingAction("settings.set_transcription_backend", rawInput);
    setWhisperBackendPreference(input.preference);
  });

  registerAppActionHandler("settings.set_folder", async rawInput => {
    const input = parseRemainingAction("settings.set_folder", rawInput);
    setWorkspaceFolderSetting(input.folder, input.selectedPath); await refreshClipLibraryWatcher();
  });

  registerAppActionHandler("settings.clear_folder", async rawInput => {
    const input = parseRemainingAction("settings.clear_folder", rawInput);
    clearWorkspaceFolderSetting(input.folder); await refreshClipLibraryWatcher();
  });

  registerAppActionHandler("settings.set_automation", async rawInput => {
    const input = parseRemainingAction("settings.set_automation", rawInput);
    setWorkspaceAutomationSetting(input.setting, input.enabled); await refreshClipLibraryWatcher();
  });

  registerAppActionHandler("profiles.save_creator_links", async rawInput => {
    const input = parseRemainingAction("profiles.save_creator_links", rawInput);
    return saveCreatorProfileLinks(input.payload);
  });

  registerAppActionHandler("profiles.capture_creator_sample", async rawInput => {
    const input = parseRemainingAction("profiles.capture_creator_sample", rawInput);
    return captureCreatorVoiceSample(input.clipId, input.segment as TranscriptSegmentRecord);
  });

  registerAppActionHandler("profiles.record_voice_sample", async rawInput => {
    const input = parseRemainingAction("profiles.record_voice_sample", rawInput);
    return recordVoiceProfileSample(input.input);
  });

  registerAppActionHandler("profiles.remove_creator_sample", async rawInput => {
    const input = parseRemainingAction("profiles.remove_creator_sample", rawInput);
    return removeCreatorVoiceSample(input.sampleId);
  });

  registerAppActionHandler("profiles.save_collaborators", async rawInput => {
    const input = parseRemainingAction("profiles.save_collaborators", rawInput);
    return saveCollaboratorProfiles(input.payload);
  });

  registerAppActionHandler("profiles.save_ai", async rawInput => {
    const input = parseRemainingAction("profiles.save_ai", rawInput);
    return saveAiProfilesConfiguration(input.payload);
  });

  registerAppActionHandler("settings.set_strict_ai", async rawInput => {
    const input = parseRemainingAction("settings.set_strict_ai", rawInput);
    setAiStrictModeEnabled(input.enabled);
  });

  registerAppActionHandler("ai.download_setup_asset", async rawInput => {
    const input = parseRemainingAction("ai.download_setup_asset", rawInput);
    return downloadLocalAiSetupAsset(input.assetId);
  });

  registerAppActionHandler("ai.install_recommended_setup", async rawInput => {
    const input = parseRemainingAction("ai.install_recommended_setup", rawInput);
    return installRecommendedLocalAiSetup(input.recommendation);
  });

  registerAppActionHandler("ai.cancel_setup_download", async rawInput => {
    const input = parseRemainingAction("ai.cancel_setup_download", rawInput);
    return cancelLocalAiSetupDownload(input.operationId);
  });

  registerAppActionHandler("ai.import_runtime", async rawInput => {
    const input = parseRemainingAction("ai.import_runtime", rawInput);
    return importLocalAiRuntimeExecutable(input.selectedPath);
  });

  registerAppActionHandler("ai.clear_runtime", async rawInput => {
    const input = parseRemainingAction("ai.clear_runtime", rawInput);
    return clearLocalAiRuntimeExecutable();
  });

  registerAppActionHandler("ai.import_model", async rawInput => {
    const input = parseRemainingAction("ai.import_model", rawInput);
    return importLocalAiModelFile(input.selectedPath);
  });

  registerAppActionHandler("profiles.capture_collaborator_sample", async rawInput => {
    const input = parseRemainingAction("profiles.capture_collaborator_sample", rawInput);
    return captureCollaboratorVoiceSample(input.collaboratorProfileId, input.clipId, input.segment as TranscriptSegmentRecord);
  });

  registerAppActionHandler("profiles.remove_collaborator_sample", async rawInput => {
    const input = parseRemainingAction("profiles.remove_collaborator_sample", rawInput);
    return removeCollaboratorVoiceSample(input.collaboratorProfileId, input.sampleId);
  });

  registerAppActionHandler("youtube.save_credentials", async rawInput => {
    const input = parseRemainingAction("youtube.save_credentials", rawInput);
    return saveYouTubeCredentials(input.payload.clientId, input.payload.clientSecret);
  });

  registerAppActionHandler("youtube.clear_credentials", async rawInput => {
    const input = parseRemainingAction("youtube.clear_credentials", rawInput);
    return clearYouTubeCredentials();
  });

  registerAppActionHandler("youtube.connect", async rawInput => {
    const input = parseRemainingAction("youtube.connect", rawInput);
    return connectYouTube();
  });

  registerAppActionHandler("youtube.disconnect", async rawInput => {
    const input = parseRemainingAction("youtube.disconnect", rawInput);
    return disconnectYouTube();
  });

  registerAppActionHandler("performance.refresh_post", async rawInput => {
    const input = parseRemainingAction("performance.refresh_post", rawInput);
    const scheduledPost = getScheduledPostById(input.scheduledPostId);
    if (!scheduledPost) {
      throw new Error("The selected scheduled post no longer exists.");
    }

    if (scheduledPost.platform !== "youtube") {
      throw new Error("Only YouTube scheduled posts expose analytics refresh in this milestone.");
    }

    if (!scheduledPost.remotePostId) {
      throw new Error("This YouTube post has not been uploaded yet, so there is no remote video ID to refresh.");
    }

    const performance = await fetchYouTubePerformanceSnapshot(scheduledPost.remotePostId);
    return upsertYouTubePerformanceSnapshot({
      clipId: scheduledPost.clipId,
      scheduledPostId: scheduledPost.id,
      videoId: performance.videoId,
      channelId: scheduledPost.channelId ?? getYouTubeConnectionStatus().channelId,
      views: performance.views,
      engagedViews: performance.engagedViews,
      estimatedMinutesWatched: performance.estimatedMinutesWatched,
      averageViewDuration: performance.averageViewDuration,
      averageViewPercentage: performance.averageViewPercentage,
      likes: performance.likes,
      comments: performance.comments,
      shares: performance.shares,
      subscribersGained: performance.subscribersGained,
      subscribersLost: performance.subscribersLost,
      viewerPercentage: performance.viewerPercentage
    });
  });

  registerAppActionHandler("clips.clear_workspace_indexes", async rawInput => {
    const input = parseRemainingAction("clips.clear_workspace_indexes", rawInput);
    clearWorkspaceClipIndexes(); return listClips();
  });

  registerAppActionHandler("clips.export_stacked_vertical", async rawInput => {
    const input = parseRemainingAction("clips.export_stacked_vertical", rawInput);
    return exportStackedVerticalClip(input);
  });

  registerAppActionHandler("long_form.export_trimmed", async rawInput => {
    const input = parseRemainingAction("long_form.export_trimmed", rawInput);
    const source = getLongFormSourceById(input.sourceId);
    if (!source) throw new Error("The selected long-form source no longer exists.");
    return exportTrimmedMedia({
      ...input, sourcePath: source.sourcePath, durationMs: source.durationMs
    });
  });

  registerAppActionHandler("long_form.export_stacked_vertical", async rawInput => {
    const input = parseRemainingAction("long_form.export_stacked_vertical", rawInput);
    const source = getLongFormSourceById(input.sourceId);
    if (!source) throw new Error("The selected long-form source no longer exists.");
    return exportStackedVerticalMedia({
      ...input, sourcePath: source.sourcePath, durationMs: source.durationMs, widthPx: source.widthPx, heightPx: source.heightPx
    });
  });

  registerAppActionHandler("transcripts.export_srt", async rawInput => {
    const input = parseRemainingAction("transcripts.export_srt", rawInput);
    const transcript = getTranscriptByClipId(input.clipId);
    if (!transcript) throw new Error("No transcript exists for the selected clip yet.");
    if (!getClipById(input.clipId)) throw new Error("The selected clip no longer exists.");
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, transcript.srtContent, "utf8");
    return input.outputPath;
  });

  registerAppActionHandler("ai.cancel_activity", async rawInput => {
    const input = parseRemainingAction("ai.cancel_activity", rawInput);
    return cancelAiActivity(input.id);
  });
  registered = true;
}
