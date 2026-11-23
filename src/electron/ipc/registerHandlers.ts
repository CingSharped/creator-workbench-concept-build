import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { captureWorkflowOutcome } from "../../shared/workflowOutcome";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions } from "electron";
import type {
  AiProfile,
  AiProfileAssignments,
  AppInfo,
  ClipMetadataPackageDraft,
  CollaboratorProfile,
  CreatorProfileLinks,
  MetadataFeedbackDecision,
  MetadataVariantKind,
  PerformanceDashboardFilters,
  PublishExecutionMode,
  PublishPlatform,
  StackedVerticalLayoutSettings,
  TranscriptAutoAssignScope,
  TranscriptSegmentRecord,
  ToolSettingKey,
  TranscriptionBackendPreference,
  WorkspaceAutomationSettingKey,
  WorkspaceFolderSettingKey
  ,TranscriptionProgress,
  VoiceProfileRecordingInput
} from "../../shared/contracts";
import type { AppActionId } from "../../shared/appActions";
import { listAiProfileTaskDefinitions } from "../../shared/aiProfileTasks";
import { getAiProfileAssignments, getAiProfiles, isStrictAiModeEnabled } from "../services/aiProfileService";
import { getClipMetadataByClipId } from "../services/clipMetadataRepository";
import { getClipById, listClips } from "../services/clipRepository";
import { isSupportedVideoFilePath, VIDEO_FILE_EXTENSIONS } from "../services/clipImportService";

import { getDatabaseContext } from "../services/database";
import { listJobs, subscribeJobUpdates } from "../services/jobRepository";
import { getCollaboratorProfiles, getCreatorProfileLinks, getCreatorVoiceSamples } from "../services/creatorProfileLinks";
import { evaluateClipMetadataPackageForClip } from "../services/metadataGenerationService";
import { getMediaRuntimeStatus } from "../services/mediaInspector";

import { getLongFormSourceById, listLongFormSources } from "../services/longFormSourceRepository";
import { listClipProposalsBySourceId } from "../services/clipProposalRepository";
import { listMetadataVariantsByClipId } from "../services/metadataVariantRepository";
import { getLocalAiRuntimeStatus } from "../services/localAiRuntimeService";
import { getLocalAiSetupCatalog, subscribeLocalAiSetupProgress } from "../services/localAiSetupService";
import { getPerformanceDashboard, getPerformanceVideoDetail } from "../services/performanceDashboardService";

import { listScheduledPosts } from "../services/scheduledPostRepository";

import { getTranscriptByClipId, getTranscriptByLongFormSourceId } from "../services/transcriptRepository";
import { getVerticalLayoutPreferences } from "../services/verticalLayoutPreferences";
import { getTranscriptionRuntimeSelection, subscribeTranscriptionProgress } from "../services/transcriptionService";

import { getYouTubeConnectionStatus, listYouTubeVideoCategories, listYouTubePlaylists } from "../services/youtubeService";
import { getYouTubeMetadataDraft, listCachedYouTubeVideos, listThumbnailCandidates } from "../services/youtubeVideoRepository";
import { listYouTubePerformanceSnapshotsByClipId } from "../services/youtubePerformanceSnapshotRepository";

import {
  getDataManagementSummary
} from "../services/dataManagementService";
import { getWorkspaceIndexStatus } from "../services/workspaceIndexStatus";
import { getCreatorSetupEnvironment } from "../services/setupEnvironmentService";
import { getWorkspaceAutomationSetting, getWorkspaceFolderSetting } from "../services/workspacePreferences";
import { getDefaultWorkspace } from "../services/workspaceRepository";
import { executeAppAction } from "../actions/appActionExecutor";
import { registerCreatorWorkflowActions } from "../actions/registerCreatorWorkflowActions";
import { getAiActivitySnapshot, subscribeAiActivity } from "../services/aiActivityService";

let registered = false;

const EXECUTABLE_FILTERS = process.platform === "win32" ? ["exe"] : ["*"];

function executeLegacyAction<T>(
  event: Electron.IpcMainInvokeEvent,
  actionId: AppActionId,
  input: unknown
): Promise<T> {
  return executeAppAction<T>(actionId, input, {
    source: "ui",
    confirmed: true,
    sender: event.sender
  });
}

export function registerIpcHandlers(): void {
  if (registered) {
    return;
  }

  registerCreatorWorkflowActions();
  ipcMain.handle("ai:activity:list", () => getAiActivitySnapshot());
  ipcMain.handle("ai:activity:cancel", async (event, id: unknown) => {
    return executeLegacyAction(event, "ai.cancel_activity", { id });
  });
  subscribeAiActivity((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("ai:activity:update", snapshot);
    }
  });
  ipcMain.handle(
    "app:action",
    async (event, actionId: string, input: unknown, options?: { confirmed?: boolean; returnOutcome?: boolean }) => {
      const execute = () => executeAppAction(actionId, input, {
        source: "ui",
        confirmed: options?.confirmed === true,
        sender: event.sender
      });
      // Legacy invocations keep their value/rejection contract during migration.
      return options?.returnOutcome === true ? captureWorkflowOutcome(execute) : execute();
    }
  );

  ipcMain.handle("app:get-info", async () => buildAppInfo());

  ipcMain.handle("ui:get-vertical-layout-preferences", async () => getVerticalLayoutPreferences());
  ipcMain.handle("ui:save-vertical-layout-preferences", async (event, preferences: StackedVerticalLayoutSettings & { mode: "single" | "stacked" }) =>
    executeLegacyAction(event, "ui.save_vertical_layout_preferences", { preferences })
  );

  subscribeTranscriptionProgress((progress: TranscriptionProgress) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send("transcription:progress", progress);
    });
  });

  subscribeJobUpdates((operation) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send("operation:update", operation);
    });
  });

  subscribeLocalAiSetupProgress((progress) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send("local-ai:setup-progress", progress);
    });
  });

  ipcMain.handle("workspace:get-index-status", async () => {
    return getWorkspaceIndexStatus();
  });

  ipcMain.handle("clips:list", async () => {
    return listClips();
  });

  ipcMain.handle("clips:get-metadata", async (_event, clipId: string) => {
    return getClipMetadataByClipId(clipId);
  });

  ipcMain.handle("clips:list-metadata-variants", async (_event, clipId: string) => {
    return listMetadataVariantsByClipId(clipId);
  });

  ipcMain.handle(
    "clips:generate-metadata-candidates",
    async (
      event,
      clipId: string,
      options?: {
        kinds?: MetadataVariantKind[];
        append?: boolean;
        seriesKey?: string;
        gameTitle?: string;
        existingPackage?: ClipMetadataPackageDraft | null;
      }
    ) => {
      return executeLegacyAction(event, "clips.generate_metadata", { clipId, options });
    }
  );

  ipcMain.handle(
    "clips:evaluate-metadata-package",
    async (_event, clipId: string, payload: ClipMetadataPackageDraft) => {
      return evaluateClipMetadataPackageForClip(clipId, normalizeMetadataPackagePayload(payload));
    }
  );

  ipcMain.handle(
    "clips:save-metadata",
    async (event, clipId: string, payload: ClipMetadataPackageDraft) => {
      return executeLegacyAction(event, "clips.save_metadata", { clipId, payload });
    }
  );

  ipcMain.handle(
    "clips:record-metadata-feedback",
    async (event, clipId: string, variantId: string, decision: MetadataFeedbackDecision) => {
      return executeLegacyAction(event, "metadata.record_feedback", { clipId, variantId, decision });
    }
  );

  ipcMain.handle("performance:get-dashboard", async (_event, filters?: Partial<PerformanceDashboardFilters>) => {
    return getPerformanceDashboard(filters);
  });

  ipcMain.handle("performance:get-video-detail", async (_event, videoId: string) => {
    return getPerformanceVideoDetail(videoId);
  });

  ipcMain.handle("performance:refresh-dashboard", async (event, filters?: Partial<PerformanceDashboardFilters>) => {
    return executeLegacyAction(event, "performance.refresh_dashboard", { filters });
  });

  ipcMain.handle(
    "performance:import-youtube-history",
    async (
      event,
      input?: {
        publishedAfter?: string;
        maxVideos?: number;
      }
    ) => {
      return executeLegacyAction(event, "performance.import_youtube_history", input ?? {});
    }
  );

  ipcMain.handle(
    "performance:generate-coach",
    async (event, input?: { filters?: Partial<PerformanceDashboardFilters>; videoId?: string; focus?: string }) => {
      return executeLegacyAction(event, "performance.generate_coach", input ?? {});
    }
  );

  ipcMain.handle("clips:import", async (event) => {
    const configuredClipLibraryFolder = getWorkspaceFolderSetting("clipLibrary");
    const filePaths = configuredClipLibraryFolder
      ? await collectSupportedVideoFiles(configuredClipLibraryFolder)
      : await selectClipImportPaths(event.sender);

    if (filePaths.length === 0) {
      if (configuredClipLibraryFolder) {
        throw new Error(
          `No supported video files were found in ${configuredClipLibraryFolder}. Add clips there or clear the folder setting to use manual import.`
        );
      }

      return listClips();
    }

    return executeLegacyAction(event, "clips.import", {
      filePaths,
      source: configuredClipLibraryFolder ? "clip_library_sync" : "manual_import"
    });
  });

  ipcMain.handle("long-form:sources:list", async () => listLongFormSources());

  ipcMain.handle("long-form:sources:import", async (event) => {
    const sourcePath = await selectLongFormSourcePath(event.sender);
    if (!sourcePath) {
      return null;
    }

    return executeLegacyAction(event, "long_form.import", { sourcePath });
  });

  ipcMain.handle("long-form:transcript", async (_event, sourceId: string) => {
    if (!getLongFormSourceById(sourceId)) {
      throw new Error("The selected long-form source no longer exists.");
    }
    return getTranscriptByLongFormSourceId(sourceId);
  });

  ipcMain.handle("long-form:transcribe", async (event, sourceId: string) =>
    executeLegacyAction(event, "long_form.transcribe", { sourceId })
  );
  ipcMain.handle("long-form:transcription-cancel", async (event, sourceId: string) => executeLegacyAction(event, "long_form.cancel_transcription", { sourceId }));
  ipcMain.handle("long-form:partial-save", async (event, sourceId: string) => executeLegacyAction(event, "long_form.save_partial_transcript", { sourceId }));
  ipcMain.handle("long-form:partial-discard", async (event, sourceId: string) => {
    await executeLegacyAction(event, "long_form.discard_partial_transcript", { sourceId });
  });
  ipcMain.handle("long-form:proposals:list", async (_event, sourceId: string) => listClipProposalsBySourceId(sourceId));
  ipcMain.handle("long-form:proposals:generate", async (event, sourceId: string) =>
    executeLegacyAction(event, "long_form.generate_proposals", { sourceId })
  );
  ipcMain.handle("long-form:proposals:cancel", async (event, sourceId: string) => executeLegacyAction(event, "long_form.cancel_proposals", { sourceId }));
  ipcMain.handle(
    "long-form:proposals:approve",
    async (event, sourceId: string, proposalId: string, payload: { startMs: number; endMs: number; fileName?: string }) =>
      executeLegacyAction(event, "long_form.approve_proposal", { sourceId, proposalId, ...payload })
  );
  ipcMain.handle(
    "long-form:proposals:reject",
    async (event, sourceId: string, proposalId: string, reason?: string) =>
      executeLegacyAction(event, "long_form.reject_proposal", { sourceId, proposalId, reason })
  );
  ipcMain.handle(
    "long-form:proposals:reopen",
    async (event, sourceId: string, proposalId: string) => executeLegacyAction(event, "long_form.reopen_proposal", { sourceId, proposalId })
  );

  ipcMain.handle(
    "long-form:export-trimmed",
    async (event, sourceId: string, payload: { startMs: number; endMs: number }) => {
      const source = getLongFormSourceById(sourceId);
      if (!source) {
        throw new Error("The selected long-form source no longer exists.");
      }

      const defaultFileName = `${path.parse(source.displayName).name}-trimmed.mp4`;
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showSaveDialog(window, {
            title: "Export Trimmed Long-form Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          })
        : await dialog.showSaveDialog({
            title: "Export Trimmed Long-form Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          });

      if (result.canceled || !result.filePath) {
        return null;
      }

      return executeLegacyAction(event, "long_form.export_trimmed", { sourceId, ...payload, outputPath: result.filePath });
    }
  );

  ipcMain.handle(
    "long-form:export-stacked-vertical",
    async (
      event,
      sourceId: string,
      payload: { startMs: number; endMs: number; layout: StackedVerticalLayoutSettings }
    ) => {
      const source = getLongFormSourceById(sourceId);
      if (!source) {
        throw new Error("The selected long-form source no longer exists.");
      }

      const defaultFileName = `${path.parse(source.displayName).name}-stacked-vertical.mp4`;
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showSaveDialog(window, {
            title: "Export Stacked Vertical Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          })
        : await dialog.showSaveDialog({
            title: "Export Stacked Vertical Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          });

      if (result.canceled || !result.filePath) {
        return null;
      }

      return executeLegacyAction(event, "long_form.export_stacked_vertical", { sourceId, ...payload, outputPath: result.filePath });
    }
  );

  ipcMain.handle("clips:remove-from-workspace", async (event, clipId: string) => {
    return executeLegacyAction(event, "clips.remove_from_workspace", { clipId });
  });

  ipcMain.handle("clips:delete-app-data", async (event, clipId: string) => {
    return executeLegacyAction(event, "clips.delete_app_data", { clipId });
  });

  ipcMain.handle("clips:clear-workspace-indexes", async (event) => {
    return executeLegacyAction(event, "clips.clear_workspace_indexes", {});
  });

  ipcMain.handle("data-management:summary", async () => getDataManagementSummary());
  ipcMain.handle("data-management:scan", async (event) => executeLegacyAction(event, "data_management.scan", {}));
  ipcMain.handle("data-management:clear-clip-library", async (event) =>
    executeLegacyAction(event, "data_management.clear_clip_library", {})
  );
  ipcMain.handle("data-management:clear-long-form", async (event) =>
    executeLegacyAction(event, "data_management.clear_long_form", {})
  );
  ipcMain.handle("data-management:cleanup-orphans", async (event, issueIds: string[]) => {
    return executeLegacyAction(event, "data_management.cleanup_orphans", { issueIds });
  });

  ipcMain.handle("scheduled-posts:list", async () => {
    return listScheduledPosts();
  });

  ipcMain.handle("scheduled-posts:refresh-statuses", async (event) =>
    executeLegacyAction(event, "scheduled_posts.refresh_statuses", {})
  );

  ipcMain.handle(
    "scheduled-posts:create",
    async (event, clipId: string, payload: {
      platform: PublishPlatform;
      accountLabel: string;
      publishAt: string;
      youtubePlaylistIds?: string[];
    }) => {
      return executeLegacyAction(event, "scheduled_posts.create", { clipId, ...payload });
    }
  );

  ipcMain.handle("clips:transcribe", async (event, clipId: string) => {
    return executeLegacyAction(event, "clips.transcribe", { clipId });
  });

  ipcMain.handle("transcripts:get", async (_event, clipId: string) => {
    return getTranscriptByClipId(clipId);
  });

  ipcMain.handle(
    "transcripts:update",
    async (event, clipId: string, payload: { textContent: string; srtContent: string; segments?: TranscriptSegmentRecord[] }) => {
      return executeLegacyAction(event, "transcripts.update", { clipId, payload });
    }
  );

  ipcMain.handle(
    "transcripts:auto-assign-speakers",
    async (event, clipId: string, scope?: TranscriptAutoAssignScope) => {
      return executeLegacyAction(event, "transcripts.auto_assign_speakers", { clipId, scope });
    }
  );

  ipcMain.handle("transcripts:export-srt", async (event, clipId: string) => {
    const transcript = getTranscriptByClipId(clipId);
    if (!transcript) {
      throw new Error("No transcript exists for the selected clip yet.");
    }

    const clip = getClipById(clipId);
    if (!clip) {
      throw new Error("The selected clip no longer exists.");
    }

    const defaultFileName = replaceFileExtension(clip.displayName, ".srt");
    const configuredSrtOutputFolder = getWorkspaceFolderSetting("srtOutput");
    const defaultPath = configuredSrtOutputFolder
      ? path.join(configuredSrtOutputFolder, defaultFileName)
      : defaultFileName;

    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showSaveDialog(window, {
          title: "Export SRT",
          defaultPath,
          filters: [{ name: "SubRip Subtitle", extensions: ["srt"] }]
        })
      : await dialog.showSaveDialog({
          title: "Export SRT",
          defaultPath,
          filters: [{ name: "SubRip Subtitle", extensions: ["srt"] }]
        });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return executeLegacyAction(event, "transcripts.export_srt", { clipId, outputPath: result.filePath });
  });

  ipcMain.handle(
    "clips:export-trimmed",
    async (
      event,
      clipId: string,
      payload: { startMs: number; endMs: number }
    ) => {
      const clip = getClipById(clipId);
      if (!clip) {
        throw new Error("The selected clip no longer exists.");
      }

      const defaultFileName = `${path.parse(clip.displayName).name}-trimmed.mp4`;
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showSaveDialog(window, {
            title: "Export Trimmed Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          })
        : await dialog.showSaveDialog({
            title: "Export Trimmed Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          });

      if (result.canceled || !result.filePath) {
        return null;
      }

      return executeLegacyAction(event, "clips.export_trimmed", { clipId, ...payload, outputPath: result.filePath });
    }
  );

  ipcMain.handle(
    "clips:export-stacked-vertical",
    async (
      event,
      clipId: string,
      payload: { startMs: number; endMs: number; layout: StackedVerticalLayoutSettings }
    ) => {
      const clip = getClipById(clipId);
      if (!clip) {
        throw new Error("The selected clip no longer exists.");
      }

      const defaultFileName = `${path.parse(clip.displayName).name}-stacked-vertical.mp4`;
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showSaveDialog(window, {
            title: "Export Stacked Vertical Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          })
        : await dialog.showSaveDialog({
            title: "Export Stacked Vertical Clip",
            defaultPath: defaultFileName,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
          });

      if (result.canceled || !result.filePath) {
        return null;
      }

      return executeLegacyAction(event, "clips.export_stacked_vertical", { clipId, ...payload, outputPath: result.filePath });
    }
  );

  ipcMain.handle("youtube:get-connection-status", async () => {
    return getYouTubeConnectionStatus();
  });

  ipcMain.handle("youtube:save-credentials", async (event, payload: { clientId: string; clientSecret: string }) => {
    return executeLegacyAction(event, "youtube.save_credentials", { payload });
  });

  ipcMain.handle("youtube:clear-credentials", async (event) => {
    return executeLegacyAction(event, "youtube.clear_credentials", {});
  });

  ipcMain.handle("youtube:connect", async (event) => {
    return executeLegacyAction(event, "youtube.connect", {});
  });

  ipcMain.handle("youtube:disconnect", async (event) => {
    return executeLegacyAction(event, "youtube.disconnect", {});
  });

  ipcMain.handle("youtube:list-playlists", async () => {
    return listYouTubePlaylists();
  });

  ipcMain.handle("youtube-videos:list-cache", async () => {
    return listCachedYouTubeVideos();
  });

  ipcMain.handle("youtube-videos:list-categories", async () => {
    return listYouTubeVideoCategories("US");
  });

  ipcMain.handle("youtube-videos:get-draft", async (_event, videoId: string) => {
    return getYouTubeMetadataDraft(videoId);
  });

  ipcMain.handle("youtube-videos:list-thumbnail-candidates", async (_event, videoId: string) => {
    return listThumbnailCandidates(videoId);
  });

  ipcMain.handle("youtube-performance:list", async (_event, clipId: string) => {
    return listYouTubePerformanceSnapshotsByClipId(clipId);
  });

  ipcMain.handle("youtube-performance:refresh", async (event, scheduledPostId: string) => {
    return executeLegacyAction(event, "performance.refresh_post", { scheduledPostId });
  });

  ipcMain.handle("tools:configure-path", async (event, tool: ToolSettingKey) => {
    const selectedPath = await selectToolPath(event.sender, tool);
    if (!selectedPath) {
      return buildAppInfo();
    }

    await executeLegacyAction(event, "settings.set_tool_path", { tool, selectedPath });
    return buildAppInfo();
  });

  ipcMain.handle("tools:clear-path", async (event, tool: ToolSettingKey) => {
    await executeLegacyAction(event, "settings.clear_tool_path", { tool });
    return buildAppInfo();
  });

  ipcMain.handle("transcription:set-backend", async (event, preference: TranscriptionBackendPreference) => {
    await executeLegacyAction(event, "settings.set_transcription_backend", { preference });
    return buildAppInfo();
  });

  ipcMain.handle("folders:configure", async (event, folder: WorkspaceFolderSettingKey) => {
    const selectedPath = await selectWorkspaceFolderPath(event.sender, folder);
    if (!selectedPath) {
      return buildAppInfo();
    }

    await executeLegacyAction(event, "settings.set_folder", { folder, selectedPath });
    return buildAppInfo();
  });

  ipcMain.handle("folders:clear", async (event, folder: WorkspaceFolderSettingKey) => {
    await executeLegacyAction(event, "settings.clear_folder", { folder });
    return buildAppInfo();
  });

  ipcMain.handle("automation:set", async (event, setting: WorkspaceAutomationSettingKey, enabled: boolean) => {
    await executeLegacyAction(event, "settings.set_automation", { setting, enabled });
    return buildAppInfo();
  });

  ipcMain.handle("creator-profile-links:save", async (event, payload: CreatorProfileLinks) => {
    await executeLegacyAction(event, "profiles.save_creator_links", { payload });
    return buildAppInfo();
  });

  ipcMain.handle("creator-voice-samples:capture", async (event, clipId: string, segment: TranscriptSegmentRecord) => {
    await executeLegacyAction(event, "profiles.capture_creator_sample", { clipId, segment });
    return buildAppInfo();
  });

  ipcMain.handle("voice-profile-samples:record", async (event, input: VoiceProfileRecordingInput) => {
    await executeLegacyAction(event, "profiles.record_voice_sample", { input });
    return buildAppInfo();
  });

  ipcMain.handle("creator-voice-samples:remove", async (event, sampleId: string) => {
    await executeLegacyAction(event, "profiles.remove_creator_sample", { sampleId });
    return buildAppInfo();
  });

  ipcMain.handle("collaborator-profiles:save", async (event, payload: CollaboratorProfile[]) => {
    await executeLegacyAction(event, "profiles.save_collaborators", { payload });
    return buildAppInfo();
  });

  ipcMain.handle("ai-profiles:save", async (event, payload: { profiles: AiProfile[]; assignments: AiProfileAssignments }) => {
    await executeLegacyAction(event, "profiles.save_ai", { payload });
    return buildAppInfo();
  });

  ipcMain.handle("ai:set-strict-mode", async (event, enabled: boolean) => {
    await executeLegacyAction(event, "settings.set_strict_ai", { enabled });
    return buildAppInfo();
  });

  ipcMain.handle("ai:refresh-local-runtime", async () => {
    return buildAppInfo();
  });

  ipcMain.handle("ai:get-setup-catalog", () => getLocalAiSetupCatalog());

  ipcMain.handle("ai:download-setup-asset", async (event, assetId) => {
    await executeLegacyAction(event, "ai.download_setup_asset", { assetId: assetId });
    return buildAppInfo();
  });

  ipcMain.handle("ai:install-recommended-setup", async (event, recommendation) => {
    await executeLegacyAction(event, "ai.install_recommended_setup", { recommendation });
    return buildAppInfo();
  });

  ipcMain.handle("ai:cancel-setup-download", async (event, operationId: string) => {
    return executeLegacyAction(event, "ai.cancel_setup_download", { operationId });
  });

  ipcMain.handle("ai:import-local-runtime-executable", async (event) => {
    const selectedPath = await selectLocalAiRuntimeExecutablePath(event.sender);
    if (!selectedPath) {
      return buildAppInfo();
    }

    await executeLegacyAction(event, "ai.import_runtime", { selectedPath });
    return buildAppInfo();
  });

  ipcMain.handle("ai:clear-local-runtime-executable", async (event) => {
    await executeLegacyAction(event, "ai.clear_runtime", {});
    return buildAppInfo();
  });

  ipcMain.handle("ai:import-local-model", async (event) => {
    const selectedPath = await selectLocalAiModelPath(event.sender);
    if (!selectedPath) {
      return buildAppInfo();
    }

    await executeLegacyAction(event, "ai.import_model", { selectedPath });
    return buildAppInfo();
  });

  ipcMain.handle("collaborator-voice-samples:capture", async (event, collaboratorProfileId: string, clipId: string, segment: TranscriptSegmentRecord) => {
    await executeLegacyAction(event, "profiles.capture_collaborator_sample", { collaboratorProfileId, clipId, segment });
    return buildAppInfo();
  });

  ipcMain.handle("collaborator-voice-samples:remove", async (event, collaboratorProfileId: string, sampleId: string) => {
    await executeLegacyAction(event, "profiles.remove_collaborator_sample", { collaboratorProfileId, sampleId });
    return buildAppInfo();
  });

  ipcMain.handle("jobs:list", async () => listJobs());

  registered = true;
}

async function buildAppInfo(): Promise<AppInfo> {
  const workspace = getDefaultWorkspace();
  const dbContext = getDatabaseContext();
  const [mediaRuntime, transcriptionRuntime, setupEnvironment] = await Promise.all([
    getMediaRuntimeStatus(),
    getTranscriptionRuntimeSelection(),
    getCreatorSetupEnvironment(app.getPath("userData"))
  ]);

  return {
    appVersion: "0.1.0",
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    databasePath: dbContext.databasePath,
    workspaceName: workspace.name,
    clipLibraryFolder: getWorkspaceFolderSetting("clipLibrary"),
    longFormSourceLibraryFolder: getWorkspaceFolderSetting("longFormSourceLibrary"),
    srtOutputFolder: getWorkspaceFolderSetting("srtOutput"),
    watchClipLibraryEnabled: getWorkspaceAutomationSetting("watchClipLibrary"),
    autoTranscribeOnImportEnabled: getWorkspaceAutomationSetting("autoTranscribeOnImport"),
    ffmpeg: mediaRuntime.ffmpeg,
    ffprobe: mediaRuntime.ffprobe,
    whisper: transcriptionRuntime.runtime,
    whisperModel: transcriptionRuntime.model,
    transcriptionRuntime,
    creatorProfileLinks: getCreatorProfileLinks(),
    creatorVoiceSamples: getCreatorVoiceSamples(),
    collaboratorProfiles: getCollaboratorProfiles(),
    aiProfiles: getAiProfiles(),
    aiProfileAssignments: getAiProfileAssignments(),
    aiProfileTasks: listAiProfileTaskDefinitions(),
    strictAiModeEnabled: isStrictAiModeEnabled(),
    localAiRuntime: await getLocalAiRuntimeStatus(),
    setupEnvironment
  };
}

async function selectToolPath(sender: Electron.WebContents, tool: ToolSettingKey): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender);
  const dialogOptions = getToolDialogOptions(tool);
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

async function selectClipImportPaths(sender: Electron.WebContents): Promise<string[]> {
  const window = BrowserWindow.fromWebContents(sender);
  const configuredClipLibraryFolder = getWorkspaceFolderSetting("clipLibrary");
  const options: OpenDialogOptions = {
    title: "Import Clips",
    defaultPath: configuredClipLibraryFolder ?? undefined,
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Video Files",
        extensions: [...VIDEO_FILE_EXTENSIONS].map((extension) => extension.slice(1))
      }
    ]
  };

  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  return result.filePaths;
}

async function selectLongFormSourcePath(sender: Electron.WebContents): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender);
  const currentPath = getWorkspaceFolderSetting("longFormSourceLibrary");
  const options: OpenDialogOptions = {
    title: "Import Long-form Source",
    defaultPath: currentPath ?? undefined,
    properties: ["openFile"],
    filters: [{ name: "Video Files", extensions: [...VIDEO_FILE_EXTENSIONS].map((extension) => extension.slice(1)) }]
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] ?? null;
}

async function selectWorkspaceFolderPath(
  sender: Electron.WebContents,
  folder: WorkspaceFolderSettingKey
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender);
  const currentPath = getWorkspaceFolderSetting(folder);
  const dialogOptions: OpenDialogOptions = {
    title: getWorkspaceFolderDialogTitle(folder),
    defaultPath: currentPath ?? undefined,
    properties: ["openDirectory", "createDirectory"]
  };
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

async function selectLocalAiRuntimeExecutablePath(sender: Electron.WebContents): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender);
  const dialogOptions: OpenDialogOptions = {
    title: "Import llama.cpp Runtime",
    properties: ["openFile"],
    filters: [
      { name: "Windows Executables", extensions: ["exe"] },
      { name: "All Files", extensions: ["*"] }
    ]
  };
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

async function selectLocalAiModelPath(sender: Electron.WebContents): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(sender);
  const dialogOptions: OpenDialogOptions = {
    title: "Import GGUF Model",
    properties: ["openFile"],
    filters: [
      { name: "GGUF Models", extensions: ["gguf"] },
      { name: "All Files", extensions: ["*"] }
    ]
  };
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

function getToolDialogOptions(tool: ToolSettingKey): OpenDialogOptions {
  if (tool === "whisperModel") {
    return {
      title: "Select Whisper Model",
      properties: ["openFile"],
      filters: [
        { name: "Whisper Models", extensions: ["bin"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
  }

  return {
    title: `Select ${tool} executable`,
    properties: ["openFile"],
    filters: [
      { name: "Executables", extensions: EXECUTABLE_FILTERS },
      { name: "All Files", extensions: ["*"] }
    ]
  };
}

function replaceFileExtension(fileName: string, nextExtension: string): string {
  return `${path.parse(fileName).name}${nextExtension}`;
}

function getWorkspaceFolderDialogTitle(folder: WorkspaceFolderSettingKey): string {
  switch (folder) {
    case "clipLibrary":
      return "Select Clip Library Folder";
    case "longFormSourceLibrary":
      return "Select Long-form Source Library Folder";
    case "srtOutput":
      return "Select Default SRT Output Folder";
  }
}

async function collectSupportedVideoFiles(rootPath: string): Promise<string[]> {
  const rootStats = await stat(rootPath).catch(() => null);
  if (!rootStats || !rootStats.isDirectory()) {
    throw new Error(
      `The configured clip library folder is unavailable: ${rootPath}. Update or clear it before importing.`
    );
  }

  const entries = await readdir(rootPath, { encoding: "utf8", withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && isSupportedVideoFilePath(entry.name))
    .map((entry) => path.join(rootPath, entry.name));

  return matches.sort((left, right) => left.localeCompare(right));
}

function getDefaultExecutionMode(platform: PublishPlatform): PublishExecutionMode {
  switch (platform) {
    case "youtube":
      return "native_schedule";
    case "tiktok":
      return "draft_handoff";
  }
}

function normalizeMetadataPackagePayload(payload: ClipMetadataPackageDraft): ClipMetadataPackageDraft {
  return {
    title: payload.title.trim(),
    description: payload.description.trim(),
    publicHashtags: payload.publicHashtags.map((tag) => String(tag).trim()).filter(Boolean),
    platformTags: payload.platformTags.map((tag) => String(tag).trim()).filter(Boolean),
    seriesKey: payload.seriesKey.trim(),
    gameTitle: payload.gameTitle.trim(),
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
