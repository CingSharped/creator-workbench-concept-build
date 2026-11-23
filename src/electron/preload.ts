import { contextBridge, ipcRenderer } from "electron";
import type {
  AiProfile,
  AiProfileAssignments,
  AppInfo,
  ClipMetadataPackageDraft,
  ClipMetadataPackageRecord,
  ClipRecord,
  ClipAppDataRemovalResult,
  CollaboratorProfile,
  CreatorProfileLinks,
  CreatorAppApi,
  GeneratedClipMetadataCandidatesResult,
  JobRecord,
  OperationUpdate,
  MetadataFeedbackDecision,
  MetadataFeedbackRecord,
  MetadataScoreSnapshot,
  PerformanceDashboardFilters,
  PerformanceDashboardResult,
  PerformanceCoachFocus,
  PerformanceCoachResult,
  PerformanceVideoDetail,
  PerformanceHistoryImportResult,
  MetadataVariantKind,
  MetadataVariantRecord,
  PublishPlatform,
  ScheduledPostRecord,
  ScheduledPostStatusRefreshResult,
  StackedVerticalLayoutSettings,
  VerticalLayoutPreferences,
  ToolSettingKey,
  TranscriptAssetRef,
  TranscriptAutoAssignScope,
  TranscriptRecord,
  TranscriptSegmentRecord,
  TranscriptionBackendPreference,
  YouTubeConnectionStatus,
  YouTubePerformanceSnapshotRecord,
  YouTubePlaylistRecord,
  PostingScheduleSettings,
  NextAvailablePostingSlotResult,
  WorkspaceIndexStatus,
  WorkspaceAutomationSettingKey,
  WorkspaceFolderSettingKey
  ,LongFormSourceRecord,
  LongFormClipProposalRecord,
  LongFormClipApprovalResult,
  ClipProposalGenerationResult,
  TranscriptionProgress,
  VoiceProfileRecordingInput,
  DataHealthScanResult,
  DataManagementOperationResult,
  DataManagementSummary
  ,YouTubeBulkEditInput
  ,YouTubeBulkEditResult
  ,YouTubeManagedVideoRecord
  ,YouTubeMetadataDraft
  ,YouTubeMetadataPatch
  ,ThumbnailCandidateRecord
  ,ThumbnailGenerationInput
  ,ThumbnailGenerationResult
} from "../shared/contracts";
import type {
  LocalAiSetupAsset,
  LocalAiSetupAssetId,
  LocalAiSetupProgress,
  LocalAiSetupRecommendation
} from "../shared/localAiSetup";
import { APP_ACTION_DEFINITIONS, type AppActionId } from "../shared/appActions";
import { unwrapWorkflowOutcome, type WorkflowOutcome } from "../shared/workflowOutcome";

async function executeCreatorAction<T>(actionId: AppActionId, input: unknown, confirmed = true): Promise<T> {
  const outcome = await ipcRenderer.invoke("app:action", actionId, input, { confirmed, returnOutcome: true }) as WorkflowOutcome<T>;
  return unwrapWorkflowOutcome(outcome);
}

const api: CreatorAppApi = {
  getAiActivity: () => ipcRenderer.invoke("ai:activity:list"),
  cancelAiActivity: (id) => ipcRenderer.invoke("ai:activity:cancel", id),
  onAiActivity: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: import("../shared/aiActivity").AiActivitySnapshot): void => listener(snapshot);
    ipcRenderer.on("ai:activity:update", handler);
    return () => ipcRenderer.removeListener("ai:activity:update", handler);
  },
  getActionDefinitions: () => APP_ACTION_DEFINITIONS.map((definition) => ({ ...definition, prerequisites: [...definition.prerequisites] })),
  executeAction: <T = unknown>(
    actionId: AppActionId,
    input: unknown,
    options?: { confirmed?: boolean }
  ) => executeCreatorAction<T>(actionId, input, options?.confirmed ?? true),
  executeActionOutcome: <T = unknown>(
    actionId: AppActionId,
    input: unknown,
    options?: { confirmed?: boolean }
  ) => ipcRenderer.invoke("app:action", actionId, input, {
    confirmed: options?.confirmed ?? true, returnOutcome: true
  }) as Promise<WorkflowOutcome<T>>,
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,
  getWorkspaceIndexStatus: () =>
    ipcRenderer.invoke("workspace:get-index-status") as Promise<WorkspaceIndexStatus>,
  listClips: () => ipcRenderer.invoke("clips:list") as Promise<ClipRecord[]>,
  listLongFormSources: () => ipcRenderer.invoke("long-form:sources:list") as Promise<LongFormSourceRecord[]>,
  importLongFormSource: () => ipcRenderer.invoke("long-form:sources:import") as Promise<LongFormSourceRecord | null>,
  getLongFormTranscript: (sourceId: string) => ipcRenderer.invoke("long-form:transcript", sourceId) as Promise<TranscriptRecord | null>,
  transcribeLongFormSource: (sourceId: string) => executeCreatorAction("long_form.transcribe", { sourceId }),
  cancelLongFormTranscription: (sourceId: string) => ipcRenderer.invoke("long-form:transcription-cancel", sourceId) as Promise<boolean>,
  saveLongFormPartialTranscript: (sourceId: string) => ipcRenderer.invoke("long-form:partial-save", sourceId) as Promise<TranscriptRecord>,
  discardLongFormPartialTranscript: (sourceId: string) => ipcRenderer.invoke("long-form:partial-discard", sourceId) as Promise<void>,
  onTranscriptionProgress: (listener: (progress: TranscriptionProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: TranscriptionProgress): void => listener(progress);
    ipcRenderer.on("transcription:progress", handler);
    return () => ipcRenderer.removeListener("transcription:progress", handler);
  },
  listLongFormClipProposals: (sourceId: string) => ipcRenderer.invoke("long-form:proposals:list", sourceId) as Promise<LongFormClipProposalRecord[]>,
  generateLongFormClipProposals: (sourceId: string) => executeCreatorAction("long_form.generate_proposals", { sourceId }),
  cancelLongFormClipProposals: (sourceId: string) => ipcRenderer.invoke("long-form:proposals:cancel", sourceId) as Promise<boolean>,
  approveLongFormClipProposal: (
    sourceId: string,
    proposalId: string,
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings,
    fileName?: string
  ) => executeCreatorAction("long_form.approve_proposal", { sourceId, proposalId, startMs, endMs, layout, fileName }),
  rejectLongFormClipProposal: (sourceId: string, proposalId: string, reason?: string) =>
    executeCreatorAction("long_form.reject_proposal", { sourceId, proposalId, reason }),
  reopenLongFormClipProposal: (sourceId: string, proposalId: string) =>
    ipcRenderer.invoke("long-form:proposals:reopen", sourceId, proposalId) as Promise<LongFormClipProposalRecord>,
  getClipMetadata: (clipId: string) =>
    ipcRenderer.invoke("clips:get-metadata", clipId) as Promise<ClipMetadataPackageRecord | null>,
  listMetadataVariants: (clipId: string) =>
    ipcRenderer.invoke("clips:list-metadata-variants", clipId) as Promise<MetadataVariantRecord[]>,
  generateClipMetadataCandidates: (
    clipId: string,
    options?: {
      kinds?: MetadataVariantKind[];
      append?: boolean;
      seriesKey?: string;
      gameTitle?: string;
      existingPackage?: ClipMetadataPackageDraft | null;
    }
  ) => executeCreatorAction("clips.generate_metadata", { clipId, options }),
  evaluateClipMetadataPackage: (clipId: string, payload: ClipMetadataPackageDraft) =>
    ipcRenderer.invoke("clips:evaluate-metadata-package", clipId, payload) as Promise<MetadataScoreSnapshot>,
  saveClipMetadata: (clipId: string, payload: ClipMetadataPackageDraft) =>
    executeCreatorAction("clips.save_metadata", { clipId, payload }),
  recordMetadataFeedback: (clipId: string, variantId: string, decision: MetadataFeedbackDecision) =>
    ipcRenderer.invoke("clips:record-metadata-feedback", clipId, variantId, decision) as Promise<MetadataFeedbackRecord>,
  getPerformanceDashboard: (filters?: Partial<PerformanceDashboardFilters>) =>
    ipcRenderer.invoke("performance:get-dashboard", filters) as Promise<PerformanceDashboardResult>,
  getPerformanceVideoDetail: (videoId: string) =>
    ipcRenderer.invoke("performance:get-video-detail", videoId) as Promise<PerformanceVideoDetail>,
  listManagedYouTubeVideos: (input?: { publishedAfter?: string; maxResults?: number }) =>
    ipcRenderer.invoke("youtube-videos:list-cache") as Promise<YouTubeManagedVideoRecord[]>,
  listYouTubeVideoCategories: () =>
    ipcRenderer.invoke("youtube-videos:list-categories") as Promise<Array<{ id: string; title: string; assignable: boolean }>>,
  getYouTubeMetadataDraft: (videoId: string) =>
    ipcRenderer.invoke("youtube-videos:get-draft", videoId) as Promise<YouTubeMetadataDraft | null>,
  saveYouTubeMetadataDraft: (draft: YouTubeMetadataDraft) =>
    executeCreatorAction("youtube_videos.save_draft", { videoId: draft.videoId, draft }),
  generateYouTubeMetadataDraft: (videoId: string) =>
    executeCreatorAction<YouTubeMetadataDraft>("youtube_videos.generate_metadata", { videoId }),
  updateYouTubeVideoMetadata: (videoId: string, patch: YouTubeMetadataPatch, baseRemoteRevision?: string | null) =>
    executeCreatorAction<YouTubeManagedVideoRecord>("youtube_videos.update_metadata", { videoId, patch, baseRemoteRevision }),
  bulkUpdateYouTubeVideoMetadata: (input: YouTubeBulkEditInput) =>
    executeCreatorAction<YouTubeBulkEditResult>("youtube_videos.bulk_update_metadata", input),
  generateYouTubeThumbnailCandidates: (input: ThumbnailGenerationInput) =>
    executeCreatorAction<ThumbnailGenerationResult>("thumbnails.generate_candidates", input),
  listYouTubeThumbnailCandidates: (videoId: string) =>
    ipcRenderer.invoke("youtube-videos:list-thumbnail-candidates", videoId) as Promise<ThumbnailCandidateRecord[]>,
  applyYouTubeThumbnail: (videoId: string, candidateId: string) =>
    executeCreatorAction<YouTubeManagedVideoRecord>("thumbnails.apply_to_youtube", { videoId, candidateId }),
  refreshPerformanceDashboard: (filters?: Partial<PerformanceDashboardFilters>) =>
    executeCreatorAction("performance.refresh_dashboard", { filters }),
  importYouTubeHistoricalPerformance: (input?: { publishedAfter?: string; maxVideos?: number }) =>
    ipcRenderer.invoke("performance:import-youtube-history", input) as Promise<PerformanceHistoryImportResult>,
  generatePerformanceCoach: (input?: {
    filters?: Partial<PerformanceDashboardFilters>;
    videoId?: string;
    focus?: PerformanceCoachFocus;
  }) => executeCreatorAction<PerformanceCoachResult>("performance.generate_coach", input ?? {}),
  listYouTubePerformanceSnapshots: (clipId: string) =>
    ipcRenderer.invoke("youtube-performance:list", clipId) as Promise<YouTubePerformanceSnapshotRecord[]>,
  refreshYouTubePerformance: (scheduledPostId: string) =>
    ipcRenderer.invoke("youtube-performance:refresh", scheduledPostId) as Promise<YouTubePerformanceSnapshotRecord>,
  importClips: () => ipcRenderer.invoke("clips:import") as Promise<ClipRecord[]>,
  removeClipFromWorkspace: (clipId: string) =>
    ipcRenderer.invoke("clips:remove-from-workspace", clipId) as Promise<ClipRecord[]>,
  deleteClipAppData: (clipId: string) =>
    ipcRenderer.invoke("clips:delete-app-data", clipId) as Promise<ClipAppDataRemovalResult>,
  clearWorkspaceClipIndexes: () =>
    ipcRenderer.invoke("clips:clear-workspace-indexes") as Promise<ClipRecord[]>,
  getDataManagementSummary: () =>
    ipcRenderer.invoke("data-management:summary") as Promise<DataManagementSummary>,
  scanDataHealth: () => ipcRenderer.invoke("data-management:scan") as Promise<DataHealthScanResult>,
  clearClipLibraryIndex: () =>
    ipcRenderer.invoke("data-management:clear-clip-library") as Promise<DataManagementOperationResult>,
  clearLongFormIndex: () =>
    ipcRenderer.invoke("data-management:clear-long-form") as Promise<DataManagementOperationResult>,
  cleanupOrphanedData: (issueIds: string[]) =>
    ipcRenderer.invoke("data-management:cleanup-orphans", issueIds) as Promise<DataManagementOperationResult>,
  listScheduledPosts: () => ipcRenderer.invoke("scheduled-posts:list") as Promise<ScheduledPostRecord[]>,
  refreshScheduledPostStatuses: () =>
    ipcRenderer.invoke("scheduled-posts:refresh-statuses") as Promise<ScheduledPostStatusRefreshResult>,
  reconcileYouTubeUpload: (postId: string) =>
    executeCreatorAction("scheduled_posts.reconcile", { postId }),
  retryYouTubeCaptions: (postId: string) =>
    executeCreatorAction("scheduled_posts.retry_captions", { postId }),
  getPostingSchedule: () => executeCreatorAction<PostingScheduleSettings>("settings.get_posting_schedule", {}),
  savePostingSchedule: (settings: PostingScheduleSettings) =>
    executeCreatorAction<PostingScheduleSettings>("settings.save_posting_schedule", { settings }),
  getNextAvailablePostingSlot: () =>
    executeCreatorAction<NextAvailablePostingSlotResult>("scheduled_posts.get_next_slot", {}),
  createScheduledPost: (
    clipId: string,
    payload: {
      platform: PublishPlatform;
      accountLabel: string;
      publishAt: string;
      youtubePlaylistIds?: string[];
    }
  ) => executeCreatorAction("scheduled_posts.create", { clipId, ...payload }),
  createScheduledPostAtNextSlot: (clipId: string, youtubePlaylistIds?: string[]) =>
    executeCreatorAction("scheduled_posts.create_next_slot", { clipId, youtubePlaylistIds }),
  transcribeClip: (clipId: string) => executeCreatorAction("clips.transcribe", { clipId }),
  getTranscript: (clipId: string) => ipcRenderer.invoke("transcripts:get", clipId) as Promise<TranscriptRecord | null>,
  getLocalMediaUrl: (filePath: string) => `creator-media://local?path=${encodeURIComponent(filePath)}`,
  updateTranscript: (
    clipId: string,
    textContent: string,
    srtContent: string,
    segments?: TranscriptSegmentRecord[],
    asset?: TranscriptAssetRef
  ) => executeCreatorAction("transcripts.update", { clipId, payload: { textContent, srtContent, segments, asset } }),
  autoAssignTranscriptSpeakers: (clipId: string, scope?: TranscriptAutoAssignScope) =>
    executeCreatorAction("transcripts.auto_assign_speakers", { clipId, scope }),
  exportTranscriptSrt: (clipId: string) => ipcRenderer.invoke("transcripts:export-srt", clipId) as Promise<string | null>,
  exportTrimmedClip: (clipId: string, startMs: number, endMs: number) =>
    ipcRenderer.invoke("clips:export-trimmed", clipId, { startMs, endMs }) as Promise<string | null>,
  exportStackedVerticalClip: (
    clipId: string,
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings
  ) => ipcRenderer.invoke("clips:export-stacked-vertical", clipId, { startMs, endMs, layout }) as Promise<string | null>,
  exportTrimmedLongFormSource: (sourceId: string, startMs: number, endMs: number) =>
    ipcRenderer.invoke("long-form:export-trimmed", sourceId, { startMs, endMs }) as Promise<string | null>,
  exportStackedVerticalLongFormSource: (
    sourceId: string,
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings
  ) => ipcRenderer.invoke("long-form:export-stacked-vertical", sourceId, { startMs, endMs, layout }) as Promise<string | null>,
  getVerticalLayoutPreferences: () =>
    ipcRenderer.invoke("ui:get-vertical-layout-preferences") as Promise<VerticalLayoutPreferences | null>,
  saveVerticalLayoutPreferences: (preferences: VerticalLayoutPreferences) =>
    ipcRenderer.invoke("ui:save-vertical-layout-preferences", preferences) as Promise<VerticalLayoutPreferences>,
  getYouTubeConnectionStatus: () =>
    ipcRenderer.invoke("youtube:get-connection-status") as Promise<YouTubeConnectionStatus>,
  saveYouTubeCredentials: (clientId: string, clientSecret: string) =>
    ipcRenderer.invoke("youtube:save-credentials", { clientId, clientSecret }) as Promise<YouTubeConnectionStatus>,
  clearYouTubeCredentials: () =>
    ipcRenderer.invoke("youtube:clear-credentials") as Promise<YouTubeConnectionStatus>,
  connectYouTube: () => ipcRenderer.invoke("youtube:connect") as Promise<YouTubeConnectionStatus>,
  disconnectYouTube: () => ipcRenderer.invoke("youtube:disconnect") as Promise<YouTubeConnectionStatus>,
  listYouTubePlaylists: () => ipcRenderer.invoke("youtube:list-playlists") as Promise<YouTubePlaylistRecord[]>,
  configureToolPath: (tool: ToolSettingKey) => ipcRenderer.invoke("tools:configure-path", tool) as Promise<AppInfo>,
  clearToolPath: (tool: ToolSettingKey) => ipcRenderer.invoke("tools:clear-path", tool) as Promise<AppInfo>,
  setTranscriptionBackend: (preference: TranscriptionBackendPreference) =>
    ipcRenderer.invoke("transcription:set-backend", preference) as Promise<AppInfo>,
  configureWorkspaceFolder: (folder: WorkspaceFolderSettingKey) =>
    ipcRenderer.invoke("folders:configure", folder) as Promise<AppInfo>,
  clearWorkspaceFolder: (folder: WorkspaceFolderSettingKey) =>
    ipcRenderer.invoke("folders:clear", folder) as Promise<AppInfo>,
  setWorkspaceAutomationSetting: (setting: WorkspaceAutomationSettingKey, enabled: boolean) =>
    ipcRenderer.invoke("automation:set", setting, enabled) as Promise<AppInfo>,
  saveCreatorProfileLinks: (payload: CreatorProfileLinks) =>
    ipcRenderer.invoke("creator-profile-links:save", payload) as Promise<AppInfo>,
  captureCreatorVoiceSample: (clipId: string, segment: TranscriptSegmentRecord) =>
    ipcRenderer.invoke("creator-voice-samples:capture", clipId, segment) as Promise<AppInfo>,
  recordVoiceProfileSample: (input: VoiceProfileRecordingInput) =>
    ipcRenderer.invoke("voice-profile-samples:record", input) as Promise<AppInfo>,
  removeCreatorVoiceSample: (sampleId: string) =>
    ipcRenderer.invoke("creator-voice-samples:remove", sampleId) as Promise<AppInfo>,
  saveCollaboratorProfiles: (payload: CollaboratorProfile[]) =>
    ipcRenderer.invoke("collaborator-profiles:save", payload) as Promise<AppInfo>,
  saveAiProfiles: (payload: { profiles: AiProfile[]; assignments: AiProfileAssignments }) =>
    ipcRenderer.invoke("ai-profiles:save", payload) as Promise<AppInfo>,
  setAiStrictMode: (enabled: boolean) =>
    ipcRenderer.invoke("ai:set-strict-mode", enabled) as Promise<AppInfo>,
  refreshLocalAiRuntime: () =>
    ipcRenderer.invoke("ai:refresh-local-runtime") as Promise<AppInfo>,
  importLocalAiRuntimeExecutable: () =>
    ipcRenderer.invoke("ai:import-local-runtime-executable") as Promise<AppInfo>,
  clearLocalAiRuntimeExecutable: () =>
    ipcRenderer.invoke("ai:clear-local-runtime-executable") as Promise<AppInfo>,
  importLocalAiModel: () =>
    ipcRenderer.invoke("ai:import-local-model") as Promise<AppInfo>,
  getLocalAiSetupCatalog: () => ipcRenderer.invoke("ai:get-setup-catalog") as Promise<LocalAiSetupAsset[]>,
  downloadLocalAiSetupAsset: (assetId: LocalAiSetupAssetId) =>
    ipcRenderer.invoke("ai:download-setup-asset", assetId) as Promise<AppInfo>,
  installRecommendedLocalAiSetup: (recommendation: LocalAiSetupRecommendation) =>
    ipcRenderer.invoke("ai:install-recommended-setup", recommendation) as Promise<AppInfo>,
  cancelLocalAiSetupDownload: (operationId: string) =>
    ipcRenderer.invoke("ai:cancel-setup-download", operationId) as Promise<boolean>,
  onLocalAiSetupProgress: (listener: (progress: LocalAiSetupProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: LocalAiSetupProgress): void => listener(progress);
    ipcRenderer.on("local-ai:setup-progress", handler);
    return () => ipcRenderer.removeListener("local-ai:setup-progress", handler);
  },
  captureCollaboratorVoiceSample: (
    collaboratorProfileId: string,
    clipId: string,
    segment: TranscriptSegmentRecord
  ) =>
    ipcRenderer.invoke(
      "collaborator-voice-samples:capture",
      collaboratorProfileId,
      clipId,
      segment
    ) as Promise<AppInfo>,
  removeCollaboratorVoiceSample: (collaboratorProfileId: string, sampleId: string) =>
    ipcRenderer.invoke("collaborator-voice-samples:remove", collaboratorProfileId, sampleId) as Promise<AppInfo>,
  listJobs: () => ipcRenderer.invoke("jobs:list") as Promise<JobRecord[]>,
  onOperationUpdate: (listener: (operation: OperationUpdate) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, operation: OperationUpdate): void => listener(operation);
    ipcRenderer.on("operation:update", handler);
    return () => ipcRenderer.removeListener("operation:update", handler);
  }
};

contextBridge.exposeInMainWorld("creatorApp", api);
