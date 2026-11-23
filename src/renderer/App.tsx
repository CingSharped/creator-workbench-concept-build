import { useEffect, useState } from "react";
import type {
  AiExecutionMode,
  AiProfile,
  AiProfileAssignments,
  AiProfileLearningMode,
  AiProfileTask,
  AiProfileTaskDefinition,
  AppInfo,
  LongFormClipApprovalResult,
  ClipMetadataPackageRecord,
  ClipRecord,
  CollaboratorProfile,
  CreatorProfileLinks,
  GeneratedClipMetadataCandidatesResult,
  LongFormClipProposalRecord,
  LocalAiModelRecord,
  MetadataVariantKind,
  MetadataVariantRecord,
  PerformanceCoachAction,
  StackedVerticalLayoutSettings,
  ToolRuntimeStatus,
  ToolSettingKey,
  TranscriptAssetRef,
  TranscriptionBackendPreference,
  TranscriptRecord,
  TranscriptSegmentRecord,
  YouTubeConnectionStatus,
  YouTubePerformanceSnapshotRecord,
  WorkspaceIndexStatus,
  WorkspaceAutomationSettingKey,
  WorkspaceFolderSettingKey
  ,WorkflowSelection,
  DataHealthScanResult,
  DataManagementSummary
} from "../shared/contracts";
import { YOUTUBE_VIDEO_TITLE_MAX_LENGTH } from "../shared/platformLimits";
import PerformanceDashboardView from "./PerformanceDashboardView";
import { usePerformanceWorkflow } from "./performance/usePerformanceWorkflow";
import ReviewClipView from "./ReviewClipView";
import LongFormProposalPanel from "./LongFormProposalPanel";
import { useMakeWorkflow } from "./make/useMakeWorkflow";
import { useSettingsSetupWorkflow } from "./settings/useSettingsSetupWorkflow";
import { useAiProfileSettings } from "./settings/useAiProfileSettings";
import { useEditWorkflow } from "./edit/useEditWorkflow";
import { formatMetadataVariantAngle, isLowConfidenceSegment, filterTranscriptSegments } from "./edit/editWorkflowHelpers";
import TimestampedTranscriptPanel from "./TimestampedTranscriptPanel";
import VideoPlayer from "./VideoPlayer";
import InfoTip from "./InfoTip";
import AppShell, { type WorkbenchView } from "./AppShell";
import PageHeader from "./PageHeader";
import QueuedPostsPanel from "./QueuedPostsPanel";
import SchedulePostComposer from "./SchedulePostComposer";
import { usePublishingWorkflow } from "./publishing/usePublishingWorkflow";
import { useYouTubePlaylists } from "./publishing/useYouTubePlaylists";
import PostingScheduleSettingsPanel from "./PostingScheduleSettingsPanel";
import YouTubePlaylistPicker from "./YouTubePlaylistPicker";
import DataManagementPanel from "./DataManagementPanel";
import ConfirmActionDialog from "./ConfirmActionDialog";
import ClipLibraryStatusPill from "./ClipLibraryStatusPill";
import SetupCard from "./SetupCard";
import LocalAiSetupPanel from "./LocalAiSetupPanel";
import { SpeakerContextBadge, SpeakerContextWarning } from "./SpeakerContext";
import VoiceSampleList from "./VoiceSampleList";
import VoiceSampleRecorder from "./VoiceSampleRecorder";
import { Card, Panel, PanelHeader } from "./WorkbenchPrimitives";
import { deriveReviewSelection, reconcileWorkflowSelection } from "../shared/workflowSelection";
import { deriveCreatorSetupState } from "../shared/setupState";
import {
  CLIP_LIBRARY_FILTERS,
  countClipLibraryByFilter,
  filterClipLibrary,
  isClipLibraryFilter,
  type ClipLibraryFilter
} from "../shared/clipLibraryPresentation";
import {
  AdvancedDetails,
  ScrollableSettingsList,
  SettingRow,
  SettingsCard,
  SettingsSection,
  StatusBadge
} from "./SettingsPrimitives";
import {
  CREATOR_PROFILE_LINK_FIELDS,
  EMPTY_CREATOR_PROFILE_LINKS,
  hasAnyCreatorProfileLinks,
  normalizeCollaboratorProfiles,
  normalizeCreatorProfileLinks
} from "../shared/creatorProfileLinks";
import {
  CREATOR_SPEAKER_COLOR,
  CREATOR_SPEAKER_ID,
  CREATOR_SPEAKER_LABEL,
  FALLBACK_SPEAKER_COLOR,
  getDefaultSpeakerColor,
  normalizeSpeakerColorHex
} from "../shared/speakerProfiles";
import { buildSpeakerContextSummary } from "../shared/speakerContext";
import {
  formatBytes,
  formatDuration,
  formatMetricNumber,
  formatMetricPercentage,
  formatMetricSeconds,
  formatPlaybackTime,
  formatShortTimestamp,
  formatTimestamp,
  getLatestYouTubeScheduledPost,
  sortPerformanceSnapshots
} from "../shared/workflowPresentation";


const CLIP_LIBRARY_FILTER_STORAGE_KEY = "creator-workbench.clip-library.filter";
const YOUTUBE_REQUIRED_APIS = ["YouTube Data API v3", "YouTube Analytics API"];
const YOUTUBE_REQUESTED_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

function getMetadataReadinessLabel(score: number): string {
  if (score >= 80) {
    return "Strong";
  }

  if (score >= 60) {
    return "Good";
  }

  if (score >= 40) {
    return "Needs work";
  }

  return "Review";
}






function readStoredClipLibraryFilter(): ClipLibraryFilter {
  try {
    const stored = window.localStorage.getItem(CLIP_LIBRARY_FILTER_STORAGE_KEY);
    return isClipLibraryFilter(stored) ? stored : "all";
  } catch {
    return "all";
  }
}

function getMissingTranscriptionRequirements(appInfo: AppInfo | null): string[] {
  if (!appInfo) {
    return [];
  }

  return [
    !appInfo.ffmpeg.available ? "FFmpeg" : null,
    !appInfo.whisper.available ? "whisper.cpp" : null,
    !appInfo.whisperModel.available ? "Whisper model" : null
  ].filter(Boolean) as string[];
}



function formatAiExecutionModeLabel(mode: AiExecutionMode): string {
  switch (mode) {
    case "ai":
      return "AI used";
    case "mixed_fallback":
      return "Fallback used after AI issue";
    case "fallback":
      return "Fallback only";
  }
}

function getAiExecutionBannerClass(mode: AiExecutionMode): string {
  return mode === "ai" ? "success-banner" : "warning-banner";
}

function buildMetadataRunSummary(result: GeneratedClipMetadataCandidatesResult): string {
  return [
    `Status: ${formatAiExecutionModeLabel(result.executionMode)}`,
    result.profileName ? `Profile: ${result.profileName}` : null,
    result.model ? `Model: ${result.model}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

function formatAiProfileTaskLabel(task: AiProfileTask): string {
  switch (task) {
    case "youtube_metadata":
      return "YouTube metadata";
    case "youtube_thumbnail":
      return "YouTube thumbnail analysis";
    case "performance_coach":
      return "Performance coach";
    case "clip_discovery":
      return "Clip discovery";
  }
}

function getAiProfileTaskDefinition(
  taskDefinitions: AiProfileTaskDefinition[],
  task: AiProfileTask
): AiProfileTaskDefinition | null {
  return taskDefinitions.find((definition) => definition.id === task) ?? null;
}

function getAiProfileAssignmentValue(assignments: AiProfileAssignments, task: AiProfileTask): string {
  switch (task) {
    case "youtube_metadata":
      return assignments.youtubeMetadataProfileId ?? "";
    case "youtube_thumbnail":
      return assignments.youtubeThumbnailProfileId ?? "";
    case "performance_coach":
      return assignments.performanceCoachProfileId ?? "";
    case "clip_discovery":
      return assignments.clipDiscoveryProfileId ?? "";
  }
}

function resolveAiProfilePreferredModelSelectValue(
  profile: AiProfile,
  availableModels: LocalAiModelRecord[]
): string {
  if (!profile.preferredModel) {
    return "";
  }

  return availableModels.some((model) => model.id === profile.preferredModel)
    ? profile.preferredModel
    : `legacy:${profile.preferredModel}`;
}

function formatAiModelOptionLabel(model: LocalAiModelRecord): string {
  const compatibilityLabel = model.compatibilityLabel ?? model.label;
  const sizeLabel = model.sizeBytes !== null ? formatBytes(model.sizeBytes) : "Size unavailable";
  return `${compatibilityLabel} | ${sizeLabel}`;
}





function formatMetadataVariantKind(kind: MetadataVariantKind): string {
  switch (kind) {
    case "title":
      return "Title Variants";
    case "description":
      return "Description Variants";
    case "public_hashtags":
      return "Public Hashtag Sets";
    case "platform_tags":
      return "Platform Tag Set";
  }
}

function formatMetadataVariantContent(content: MetadataVariantRecord["content"]): string {
  return Array.isArray(content) ? content.join(", ") : content;
}

function buildMetadataContextOptions(values: string[], currentValue: string): string[] {
  return [...new Set([...values, currentValue].map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}


function createEmptyCollaboratorProfile(): CollaboratorProfile {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `collaborator-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  return {
    id,
    displayName: "",
    profileLinks: { ...EMPTY_CREATOR_PROFILE_LINKS },
    speakerColorHex: getDefaultSpeakerColor(1),
    voiceSamples: []
  };
}

function getSpeakerColor(
  speakerId: string | null,
  collaboratorProfilesById: Map<string, CollaboratorProfile>
): string {
  if (!speakerId) {
    return FALLBACK_SPEAKER_COLOR;
  }

  if (speakerId === CREATOR_SPEAKER_ID) {
    return CREATOR_SPEAKER_COLOR;
  }

  return collaboratorProfilesById.get(speakerId)?.speakerColorHex ?? FALLBACK_SPEAKER_COLOR;
}

function getSpeakerName(
  speakerId: string | null,
  collaboratorProfilesById: Map<string, CollaboratorProfile>
): string {
  if (!speakerId) {
    return "Unassigned";
  }

  if (speakerId === CREATOR_SPEAKER_ID) {
    return CREATOR_SPEAKER_LABEL;
  }

  return collaboratorProfilesById.get(speakerId)?.displayName || "Unknown speaker";
}

function formatSpeakerConfidence(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "No score";
  }

  return `${Math.round(value * 100)}%`;
}


function getSpeakerAssignmentLabel(segment: TranscriptSegmentRecord): string {
  if (segment.speakerAssignmentSource === "manual") {
    return "Manual";
  }

  if (segment.speakerAssignmentSource === "auto_high_confidence") {
    return `Auto ${formatSpeakerConfidence(segment.speakerConfidence)}`;
  }

  if (segment.speakerAssignmentSource === "auto_low_confidence") {
    return `Needs Review ${formatSpeakerConfidence(segment.speakerConfidence)}`;
  }

  if (segment.speakerId) {
    return "Assigned";
  }

  return "Unassigned";
}

function getSpeakerAssignmentBadgeClassName(segment: TranscriptSegmentRecord): string {
  if (segment.speakerAssignmentSource === "manual") {
    return "speaker-badge manual";
  }

  if (segment.speakerAssignmentSource === "auto_high_confidence") {
    return "speaker-badge auto-high";
  }

  if (segment.speakerAssignmentSource === "auto_low_confidence") {
    return "speaker-badge auto-low";
  }

  if (segment.speakerId) {
    return "speaker-badge assigned";
  }

  return "speaker-badge unassigned";
}

function getSpeakerReviewDetails(
  segment: TranscriptSegmentRecord,
  collaboratorProfilesById: Map<string, CollaboratorProfile>
): { reason: string | null; alternate: string | null } {
  const reason = segment.speakerReviewReason?.trim() || null;
  const alternate =
    segment.speakerAlternateSpeakerId
      ? `Closest alternative: ${getSpeakerName(
          segment.speakerAlternateSpeakerId,
          collaboratorProfilesById
        )}${
          segment.speakerAlternateConfidence !== null
            ? ` (${formatSpeakerConfidence(segment.speakerAlternateConfidence)})`
            : ""
        }`
      : null;

  return { reason, alternate };
}


function formatSegmentTime(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) {
    return "--:--.--";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds
    .toString()
    .padStart(2, "0")}`;
}

export default function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [workspaceIndexStatus, setWorkspaceIndexStatus] = useState<WorkspaceIndexStatus | null>(null);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipLibraryFilter, setClipLibraryFilter] = useState<ClipLibraryFilter>(() => readStoredClipLibraryFilter());
  const [clipLibrarySearch, setClipLibrarySearch] = useState("");
  const [selectedClipPlaybackTime, setSelectedClipPlaybackTime] = useState(0);
  const [selectedClipPlaybackDuration, setSelectedClipPlaybackDuration] = useState(0);
  const [transcriptSeekRequest, setTranscriptSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);
  const [longFormProposalActionId, setLongFormProposalActionId] = useState<string | null>(null);
  const [speakerReviewOpenRequest, setSpeakerReviewOpenRequest] = useState(0);
  const [activeView, setActiveView] = useState<WorkbenchView>("review");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [removingClipId, setRemovingClipId] = useState<string | null>(null);
  const [pendingClipDataRemoval, setPendingClipDataRemoval] = useState<ClipRecord | null>(null);
  const [clipDataRemovalMessage, setClipDataRemovalMessage] = useState<string | null>(null);
  const [clearingClipIndexes, setClearingClipIndexes] = useState(false);
  const [dataManagementSummary, setDataManagementSummary] = useState<DataManagementSummary | null>(null);
  const [dataHealthScan, setDataHealthScan] = useState<DataHealthScanResult | null>(null);
  const [dataManagementBusy, setDataManagementBusy] = useState<"scan" | "clip" | "long_form" | "cleanup" | null>(null);
  const [dataManagementMessage, setDataManagementMessage] = useState<string | null>(null);
  const [youtubeConnection, setYouTubeConnection] = useState<YouTubeConnectionStatus | null>(null);
  const [youtubeClientIdInput, setYouTubeClientIdInput] = useState("");
  const [youtubeClientSecretInput, setYouTubeClientSecretInput] = useState("");
  const [creatorProfileLinksInput, setCreatorProfileLinksInput] =
    useState<CreatorProfileLinks>(EMPTY_CREATOR_PROFILE_LINKS);
  const [collaboratorProfilesInput, setCollaboratorProfilesInput] = useState<CollaboratorProfile[]>([]);
  const [editingCreatorProfileLinks, setEditingCreatorProfileLinks] = useState(true);
  const [editingCollaboratorProfiles, setEditingCollaboratorProfiles] = useState(true);
  const [savingCreatorProfileLinks, setSavingCreatorProfileLinks] = useState(false);
  const [savingCollaboratorProfiles, setSavingCollaboratorProfiles] = useState(false);
  const [savingYouTubeCredentials, setSavingYouTubeCredentials] = useState(false);
  const [clearingYouTubeCredentials, setClearingYouTubeCredentials] = useState(false);
  const [connectingYouTube, setConnectingYouTube] = useState(false);
  const [disconnectingYouTube, setDisconnectingYouTube] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishing = usePublishingWorkflow({
    selectedClipId, connection: youtubeConnection, onError: setError, onRefreshWorkspace: refreshWorkspaceData
  });
  const {
    posts: scheduledPosts, creating: creatingScheduledPost, refreshing: refreshingScheduledPostStatuses,
    statusMessage: scheduledPostStatusMessage, reconcilingPostId, retryingPostId: retryingCaptionsPostId,
    platform: schedulePlatform, setPlatform: setSchedulePlatform,
    accountLabel: scheduleAccountLabel, setAccountLabel: setScheduleAccountLabel,
    publishAt: schedulePublishAt, setPublishAt: setSchedulePublishAt,
    postingSchedule, savingSchedule: postingScheduleSaving, postingScheduleMessage, nextSlot: nextPostingSlot,
    savePostingSchedule: handleSavePostingSchedule, refreshStatuses: handleRefreshScheduledPostStatuses,
    removePost, retryCaptions: handleRetryYouTubeCaptions, reconcileUpload: handleReconcileYouTubeUpload
  } = publishing;
  const {
    playlists: youtubePlaylists, selectedIds: selectedYouTubePlaylistIds, selectIds: setSelectedYouTubePlaylistIds,
    loaded: youtubePlaylistsLoaded, loading: loadingYouTubePlaylists,
    message: youtubePlaylistSelectionMessage, refresh: loadYouTubePlaylists
  } = useYouTubePlaylists({ selectedClipId, connection: youtubeConnection, onError: setError });
  const {
    configuringTool, savingTranscriptionBackend, configuringFolder, configuringAutomation,
    savingStrictAiMode, localAiAction, localAiSetupProgress,
    handleSetAiStrictMode, handleRefreshLocalAiRuntime, handleImportLocalAiRuntimeExecutable,
    handleClearLocalAiRuntimeExecutable, handleImportLocalAiModel, handleDownloadLocalAiSetupAsset,
    handleInstallRecommendedLocalAiSetup, handleCancelLocalAiSetupDownload,
    handleConfigureToolPath, handleClearToolPath, handleSetTranscriptionBackend,
    handleConfigureWorkspaceFolder, handleClearWorkspaceFolder, handleSetWorkspaceAutomationSetting
  } = useSettingsSetupWorkflow({ onAppInfo: setAppInfo, onError: setError });
  const {
    savedAiProfiles, savedAiProfileAssignments, aiProfilesInput, aiProfileAssignmentsInput,
    selectedAiProfileId, setSelectedAiProfileId, selectedAiProfile,
    editingAiProfiles, setEditingAiProfiles, savingAiProfiles,
    handleSaveAiProfiles, handleAddAiProfile, handleCancelAiProfileEdits,
    handleRemoveAiProfile, handleUpdateAiProfile, handleUpdateAiProfileLearningSettings,
    handleAddAiProfileKnowledge, handleUpdateAiProfileKnowledge,
    handleRemoveAiProfileKnowledge, handleUpdateAiProfileAssignment
  } = useAiProfileSettings({ appInfo, onAppInfo: setAppInfo, onError: setError });
  const edit = useEditWorkflow({
    selectedClipId, clips, appInfo, onSelectClip: setSelectedClipId,
    onError: setError, onAppInfo: setAppInfo, onRefreshWorkspace: refreshWorkspaceData
  });
  const {
    selectedMetadata,
    setSelectedMetadata,
    metadataVariants,
    setMetadataVariants,
    metadataLoading,
    metadataGenerationMode,
    draftTitle,
    setDraftTitle,
    draftDescription,
    setDraftDescription,
    draftTagsInput,
    setDraftTagsInput,
    draftSeriesKey,
    setDraftSeriesKey,
    draftGameTitle,
    setDraftGameTitle,
    draftCollaboratorProfileIds,
    setDraftCollaboratorProfileIds,
    selectedVariantIds,
    metadataScore,
    evaluatingMetadata,
    savingMetadata,
    recordingMetadataFeedbackId,
    rejectedVariantIds,
    metadataMessage,
    setMetadataMessage,
    lastMetadataGenerationResult,
    selectedTranscript,
    setSelectedTranscript,
    transcriptView,
    setTranscriptView,
    transcriptLoading,
    transcribingClipId,
    exportingClipId,
    editingTranscript,
    setEditingTranscript,
    draftTranscriptText,
    setDraftTranscriptText,
    draftTranscriptSrt,
    setDraftTranscriptSrt,
    draftTranscriptSegments,
    setDraftTranscriptSegments,
    savingTranscript,
    setSavingTranscript,
    autoAssigningSpeakers,
    speakerReviewFilter,
    setSpeakerReviewFilter,
    capturingVoiceSampleKey,
    removingVoiceSampleKey,
    transcriptMessage,
    youtubePerformanceSnapshots,
    setYouTubePerformanceSnapshots,
    handleSaveClipMetadata,
    handleGenerateMetadataCandidates,
    handleSelectMetadataVariant,
    handleRejectMetadataVariant,
    handleToggleCollaboratorProfileSelection,
    handleInsertSavedProfileLinksIntoDescription,
    handleAssignSpeakerToSegment,
    handleCaptureCreatorVoiceSample,
    handleRemoveCreatorVoiceSample,
    handleCaptureCollaboratorVoiceSample,
    handleRemoveCollaboratorVoiceSample,
    handleAutoAssignTranscriptSpeakers,
    handleTranscribeSelectedClip,
    handleExportSelectedTranscript,
    handleCancelTranscriptEdits,
    handleSaveTranscriptEdits,
    selectClip: handleSelectClip
  } = edit;
  const make = useMakeWorkflow({ onError: setError, onSourceImported: () => setActiveView("review") });
  const {
    sources: longFormSources, replaceSources: setLongFormSources,
    selectedSourceId: selectedLongFormSourceId, selectSource: setSelectedLongFormSourceId,
    selectedProposalId: selectedLongFormProposalId, selectProposal: setSelectedLongFormProposalId,
    transcript: selectedLongFormTranscript, saveTranscript: setSelectedLongFormTranscript,
    progress: longFormTranscriptionProgress, recoveringPartial: recoveringLongFormPartial,
    proposals: longFormProposals, result: longFormProposalResult, message: longFormProposalMessage,
    importing: importingLongFormSource, transcribing: transcribingLongFormSource,
    generating: generatingLongFormProposals, cancelling: cancellingLongFormProposals,
    importSource: handleImportLongFormSource, transcribe: handleTranscribeLongFormSource,
    cancelTranscription: handleCancelLongFormTranscription,
    savePartial: handleSaveLongFormPartial, discardPartial: handleDiscardLongFormPartial,
    generateProposals: handleGenerateLongFormProposals, cancelSearch: handleCancelLongFormProposals
  } = make;
  const clipSelectionTicket = edit.metadataSession.capture();
  const sourceSelectionTicket = make.sourceSession.capture();
  const {
    dashboard: performanceDashboard, filters: performanceFilters, loading: performanceLoading,
    refreshing: refreshingPerformanceDashboard, importingHistory: importingPerformanceHistory,
    generatingCoach: generatingPerformanceCoach, coachResult: performanceCoachResult,
    videoDetail: performanceVideoDetail, videoDetailLoading: performanceVideoDetailLoading,
    videoDetailError: performanceVideoDetailError, message: performanceMessage,
    setMessage: setPerformanceMessage, changeFilters: handlePerformanceFilterChange,
    refresh: refreshPerformanceDashboardData, importHistory: handleImportYouTubeHistoricalPerformance,
    openVideo: handleOpenPerformanceVideo, closeVideo: handleClosePerformanceVideoDetail,
    generateCoach: handleGeneratePerformanceCoach
  } = usePerformanceWorkflow({ isActive: activeView === "performance", selectedClipId, onError: setError });




  const {
    selectedClip,
    selectedLongFormSource,
    reviewClip,
    reviewTranscript
  } = deriveReviewSelection(
    clips,
    longFormSources,
    selectedClipId,
    selectedLongFormSourceId,
    selectedTranscript,
    selectedLongFormTranscript
  );
  const selectedLongFormProposal = longFormProposals.find((proposal) => proposal.id === selectedLongFormProposalId) ?? null;
  const isSettingsView = activeView === "settings";
  const isReviewView = activeView === "review";
  const isEditView = activeView === "workspace";
  const isPerformanceView = activeView === "performance";
  const creatorSetupState = appInfo ? deriveCreatorSetupState(appInfo, youtubeConnection) : null;
  const lastSyncSummary = workspaceIndexStatus?.lastSyncSummary ?? null;
  const lastSyncAt = workspaceIndexStatus?.lastSyncAt ?? null;
  const youtubeConnected = youtubeConnection?.connected === true;
  const youtubeBusy =
    savingYouTubeCredentials ||
    clearingYouTubeCredentials ||
    connectingYouTube ||
    disconnectingYouTube ||
    loadingYouTubePlaylists;
  const generatingMetadata = metadataGenerationMode !== null;
  const cleanupBusy =
    loading ||
    importing ||
    generatingMetadata ||
    clearingClipIndexes ||
    savingTranscript ||
    savingMetadata ||
    generatingPerformanceCoach ||
    publishing.busy ||
    transcribingClipId !== null ||
    exportingClipId !== null;
  const latestSelectedYouTubePost = getLatestYouTubeScheduledPost(scheduledPosts, selectedClipId);
  const latestSelectedPerformanceSnapshot = youtubePerformanceSnapshots[0] ?? null;
  const clipLibraryCounts = countClipLibraryByFilter(clips, scheduledPosts);
  const visibleClipLibraryClips = filterClipLibrary(clips, clipLibraryFilter, clipLibrarySearch, scheduledPosts);
  const youtubeRefreshablePostCount = scheduledPosts.filter(
    (post) => post.platform === "youtube" && Boolean(post.remotePostId)
  ).length;
  const savedCreatorProfileLinks = normalizeCreatorProfileLinks(appInfo?.creatorProfileLinks);
  const savedCreatorVoiceSamples = appInfo?.creatorVoiceSamples ?? [];
  const savedCollaboratorProfiles = normalizeCollaboratorProfiles(appInfo?.collaboratorProfiles);
  const savedCollaboratorProfilesKey = JSON.stringify(savedCollaboratorProfiles);
  const aiProfileTasks = appInfo?.aiProfileTasks ?? [];
  const localAiRuntime = appInfo?.localAiRuntime ?? null;
  const availableLocalAiModels = localAiRuntime?.availableModels ?? [];
  const visibleAiProfileTasks =
    aiProfileTasks.length > 0
      ? aiProfileTasks
      : [
          {
            id: "youtube_metadata" as const,
            label: "YouTube metadata",
            description: "Used by the Workspace metadata generation flow.",
            assignmentLabel: "YouTube metadata profile",
            wiredFeature: "Workspace metadata generation"
          },
          {
            id: "youtube_thumbnail" as const,
            label: "YouTube thumbnail analysis",
            description: "Used by the YouTube Thumbnail Studio.",
            assignmentLabel: "YouTube thumbnail profile",
            wiredFeature: "YouTube Thumbnail Studio"
          },
          {
            id: "performance_coach" as const,
            label: "Performance coach",
            description: "Used by the Performance tab personal channel cockpit.",
            assignmentLabel: "Performance coach profile",
            wiredFeature: "Personal channel performance coaching"
          },
          {
            id: "clip_discovery" as const,
            label: "Clip discovery",
            description: "Used by long-form transcript-led clip proposals.",
            assignmentLabel: "Clip discovery profile",
            wiredFeature: "Long-form clip proposals"
          }
        ];
  const creatorProfileLinksConfigured = hasAnyCreatorProfileLinks(savedCreatorProfileLinks);
  const collaboratorProfilesConfigured = savedCollaboratorProfiles.length > 0;
  const hasCollaboratorVoiceSamples = savedCollaboratorProfiles.some(
    (profile) => profile.voiceSamples.length > 0
  );
  const hasAnyVoiceSamples = savedCreatorVoiceSamples.length > 0 || hasCollaboratorVoiceSamples;
  const lowConfidenceSegmentCount = selectedTranscript?.segments.filter((segment) => isLowConfidenceSegment(segment)).length ?? 0;
  const filteredDraftTranscriptSegments = filterTranscriptSegments(draftTranscriptSegments, speakerReviewFilter);
  const filteredTranscriptSegments = filterTranscriptSegments(
    selectedTranscript?.segments ?? [],
    speakerReviewFilter
  );
  const creatorProfileLinksLocked = creatorProfileLinksConfigured && !editingCreatorProfileLinks;
  const collaboratorProfilesLocked = collaboratorProfilesConfigured && !editingCollaboratorProfiles;
  const aiProfilesLocked = !editingAiProfiles;
  const strictAiModeEnabled = appInfo?.strictAiModeEnabled === true;
  const selectedCollaboratorProfiles = savedCollaboratorProfiles.filter((profile) =>
    draftCollaboratorProfileIds.includes(profile.id)
  );
  const activeMetadataAiProfile =
    savedAiProfiles.find((profile) => profile.id === savedAiProfileAssignments.youtubeMetadataProfileId) ?? null;
  const currentMetadataSpeakerContext = buildSpeakerContextSummary(
    selectedTranscript,
    savedCollaboratorProfiles
  );
  const metadataSpeakerContext =
    lastMetadataGenerationResult?.speakerContext?.transcriptId === currentMetadataSpeakerContext.transcriptId &&
    lastMetadataGenerationResult.speakerContext?.transcriptUpdatedAt !== currentMetadataSpeakerContext.transcriptUpdatedAt
      ? { ...currentMetadataSpeakerContext, status: "stale" as const }
      : currentMetadataSpeakerContext;
  const activePerformanceCoachAiProfile =
    savedAiProfiles.find((profile) => profile.id === (savedAiProfileAssignments.performanceCoachProfileId ?? null)) ?? null;
  const collaboratorProfilesById = new Map(savedCollaboratorProfiles.map((profile) => [profile.id, profile]));
  const canInsertSavedProfileBlocks =
    creatorProfileLinksConfigured || selectedCollaboratorProfiles.length > 0;
  const visibleMetadataVariants = metadataVariants.filter(
    (variant) => !rejectedVariantIds.includes(variant.id)
  );
  const titleVariants = visibleMetadataVariants.filter((variant) => variant.kind === "title");
  const descriptionVariants = visibleMetadataVariants.filter((variant) => variant.kind === "description");
  const publicHashtagVariants = visibleMetadataVariants.filter((variant) => variant.kind === "public_hashtags");
  const platformTagVariants = visibleMetadataVariants.filter((variant) => variant.kind === "platform_tags");
  const tagVariants = [...publicHashtagVariants, ...platformTagVariants];
  const selectedClipSchedulePosts = scheduledPosts.filter((post) => post.clipId === selectedClipId);
  const selectedPerformanceByScheduledPostId = new Map(
    youtubePerformanceSnapshots.map((snapshot) => [snapshot.scheduledPostId, snapshot])
  );
  const metadataGameTitleOptions = buildMetadataContextOptions(
    performanceDashboard?.availableGameTitles ?? [],
    draftGameTitle
  );
  const metadataSeriesKeyOptions = buildMetadataContextOptions(
    performanceDashboard?.availableSeriesKeys ?? [],
    draftSeriesKey
  );




  useEffect(() => {
    void loadInitialState();
  }, []);



  useEffect(() => {
    if (activeView !== "workspace" || !selectedLongFormSourceId) {
      return;
    }

    make.clearSelection();
  }, [activeView]);


  useEffect(() => {
    setYouTubeClientIdInput(youtubeConnection?.clientId ?? "");
    setYouTubeClientSecretInput("");
  }, [youtubeConnection?.clientId]);

  useEffect(() => {
    setCreatorProfileLinksInput(savedCreatorProfileLinks);
  }, [
    savedCreatorProfileLinks.youtube,
    savedCreatorProfileLinks.tiktok,
    savedCreatorProfileLinks.twitch,
    savedCreatorProfileLinks.kick,
    savedCreatorProfileLinks.instagram,
    savedCreatorProfileLinks.x,
    savedCreatorProfileLinks.discord,
    savedCreatorProfileLinks.website
  ]);

  useEffect(() => {
    setCollaboratorProfilesInput(savedCollaboratorProfiles);
  }, [savedCollaboratorProfilesKey]);


  useEffect(() => {
    setEditingCreatorProfileLinks(!creatorProfileLinksConfigured);
  }, [creatorProfileLinksConfigured]);

  useEffect(() => {
    setEditingCollaboratorProfiles(!collaboratorProfilesConfigured);
  }, [collaboratorProfilesConfigured]);




  useEffect(() => {
    setSelectedClipPlaybackTime(0);
    setSelectedClipPlaybackDuration(0);
    setTranscriptSeekRequest(null);
  }, [selectedClipId]);

  useEffect(() => {
    if (isPerformanceView) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void syncBackgroundState();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    isPerformanceView,
    selectedClipId,
    selectedLongFormSourceId,
    selectedLongFormProposalId,
    longFormSources,
    longFormProposals,
    editingTranscript,
    savingMetadata,
    generatingMetadata
  ]);







  useEffect(() => {
    if (!isSettingsView || typeof window.creatorApp.getDataManagementSummary !== "function") {
      return;
    }
    void refreshDataManagementSummary();
  }, [isSettingsView]);

  function openSettingsSection(sectionId: string): void {
    setActiveView("settings");
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }


  async function loadInitialState(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [info, connection, nextLongFormSources] = await Promise.all([
        window.creatorApp.getAppInfo(),
        window.creatorApp.getYouTubeConnectionStatus(),
        window.creatorApp.listLongFormSources()
      ]);
      setAppInfo(info);
      setYouTubeConnection(connection);
      setLongFormSources(nextLongFormSources);
      setYouTubeClientIdInput(connection.clientId);
      setYouTubeClientSecretInput("");
      await refreshWorkspaceData();

    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load app state.");
    } finally {
      setLoading(false);
    }
  }


  async function refreshWorkspaceData(preferredSelectedClipId?: string): Promise<void> {
    const acceptPosts = publishing.capturePostsRead();
    const [nextClips, nextWorkspaceIndexStatus, nextScheduledPosts] = await Promise.all([
      window.creatorApp.listClips(),
      window.creatorApp.getWorkspaceIndexStatus(),
      window.creatorApp.listScheduledPosts()
    ]);

    if (!edit.metadataSession.owns(clipSelectionTicket) || !make.sourceSession.owns(sourceSelectionTicket)) return;
    setClips(nextClips);
    setWorkspaceIndexStatus(nextWorkspaceIndexStatus);
    acceptPosts(nextScheduledPosts);
    const nextSelection = reconcileWorkflowSelection(
      {
        selectedClipId: preferredSelectedClipId ?? selectedClipId,
        selectedLongFormSourceId,
        selectedLongFormProposalId
      },
      nextClips,
      longFormSources,
      longFormProposals
    );
    setSelectedClipId(nextSelection.selectedClipId);
    setSelectedLongFormSourceId(nextSelection.selectedLongFormSourceId);
    setSelectedLongFormProposalId(current =>
      current === selectedLongFormProposalId ? nextSelection.selectedLongFormProposalId : current
    );
  }

  async function refreshDataManagementSummary(): Promise<void> {
    try {
      const summary = await window.creatorApp.getDataManagementSummary();
      setDataManagementSummary(summary);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load data management status.");
    }
  }



  async function handleScanDataHealth(): Promise<void> {
    setDataManagementBusy("scan");
    setDataManagementMessage(null);
    setError(null);
    try {
      const scan = await window.creatorApp.scanDataHealth();
      setDataHealthScan(scan);
      await refreshDataManagementSummary();
      setDataManagementMessage(`Scan complete: ${scan.issues.length} record${scan.issues.length === 1 ? "" : "s"} reported. No data was deleted.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to scan data health.");
    } finally {
      setDataManagementBusy(null);
    }
  }

  async function handleClearClipLibraryIndex(): Promise<void> {
    setDataManagementBusy("clip");
    setDataManagementMessage(null);
    setError(null);
    try {
      const result = await window.creatorApp.clearClipLibraryIndex();
      setDataManagementSummary(result.summary);
      setClips(await window.creatorApp.listClips());
      setWorkspaceIndexStatus(await window.creatorApp.getWorkspaceIndexStatus());
      setDataManagementMessage(`${result.affectedCount} clip${result.affectedCount === 1 ? "" : "s"} archived from the active index. Files and history were preserved.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear the Clip Library index.");
    } finally {
      setDataManagementBusy(null);
    }
  }

  async function handleClearLongFormIndex(): Promise<void> {
    setDataManagementBusy("long_form");
    setDataManagementMessage(null);
    setError(null);
    try {
      const result = await window.creatorApp.clearLongFormIndex();
      setDataManagementSummary(result.summary);
      setLongFormSources(await window.creatorApp.listLongFormSources());
      setDataManagementMessage(`${result.affectedCount} long-form source${result.affectedCount === 1 ? "" : "s"} archived from the active index. Original files and history were preserved.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear the Long-form index.");
    } finally {
      setDataManagementBusy(null);
    }
  }

  async function handleCleanupOrphanedData(issueIds: string[]): Promise<void> {
    setDataManagementBusy("cleanup");
    setDataManagementMessage(null);
    setError(null);
    try {
      const result = await window.creatorApp.cleanupOrphanedData(issueIds);
      setDataManagementSummary(result.summary);
      setDataManagementMessage(`${result.affectedCount} orphaned record${result.affectedCount === 1 ? "" : "s"} deleted after backup.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
      if (dataHealthScan) {
        setDataHealthScan(await window.creatorApp.scanDataHealth());
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clean up orphaned data.");
    } finally {
      setDataManagementBusy(null);
    }
  }







  async function syncBackgroundState(): Promise<void> {
    const acceptPosts = publishing.capturePostsRead();
    const requestClipId = selectedClipId;

    try {
      const [
        nextClips,
        nextWorkspaceIndexStatus,
        nextScheduledPosts,
        nextMetadata,
        nextMetadataVariants,
        nextPerformanceSnapshots,
        nextTranscript
      ] = await Promise.all([
        window.creatorApp.listClips(),
        window.creatorApp.getWorkspaceIndexStatus(),
        window.creatorApp.listScheduledPosts(),
        requestClipId && !savingMetadata
          ? window.creatorApp.getClipMetadata(requestClipId)
          : Promise.resolve<ClipMetadataPackageRecord | null>(null),
        requestClipId && !savingMetadata && !generatingMetadata
          ? window.creatorApp.listMetadataVariants(requestClipId)
          : Promise.resolve<MetadataVariantRecord[]>([]),
        requestClipId
          ? window.creatorApp.listYouTubePerformanceSnapshots(requestClipId)
          : Promise.resolve<YouTubePerformanceSnapshotRecord[]>([]),
        requestClipId && !editingTranscript
          ? window.creatorApp.getTranscript(requestClipId)
          : Promise.resolve<TranscriptRecord | null>(null)
      ]);

      if (!edit.metadataSession.owns(clipSelectionTicket) || !make.sourceSession.owns(sourceSelectionTicket)) {
        return;
      }

      setClips(nextClips);
      setWorkspaceIndexStatus(nextWorkspaceIndexStatus);
      acceptPosts(nextScheduledPosts);
      const nextSelection = reconcileWorkflowSelection(
        { selectedClipId, selectedLongFormSourceId, selectedLongFormProposalId },
        nextClips,
        longFormSources,
        longFormProposals
      );
      setSelectedClipId(nextSelection.selectedClipId);
      setSelectedLongFormSourceId(nextSelection.selectedLongFormSourceId);
      setSelectedLongFormProposalId(current =>
        current === selectedLongFormProposalId ? nextSelection.selectedLongFormProposalId : current
      );

      if (requestClipId && !savingMetadata && !edit.metadataSession.hasEdits) {
        setSelectedMetadata(nextMetadata);
        if (!generatingMetadata) {
          setMetadataVariants(nextMetadataVariants);
        }
      }

      if (requestClipId) {
        setYouTubePerformanceSnapshots(sortPerformanceSnapshots(nextPerformanceSnapshots));
      }

      if (requestClipId && !editingTranscript && !edit.transcriptSession.hasEdits) {
        setSelectedTranscript(nextTranscript);
      }
    } catch {
      // Ignore background refresh failures and preserve the current working state.
    }
  }


  async function handlePerformanceCoachAction(action: PerformanceCoachAction): Promise<void> {
    if (!action.clipId) {
      return;
    }
    handleSelectClip(action.clipId);
    setSelectedLongFormSourceId(null);
    setSelectedLongFormProposalId(null);
    setActiveView("workspace");
    setPerformanceMessage("Opened the related clip in Edit. Review any suggested metadata or thumbnail changes before saving.");

    if (action.kind !== "generate_titles" && action.kind !== "generate_tags") {
      return;
    }

    await edit.generateFromCoach(action.clipId, action.kind);
  }



  async function handleImportClips(): Promise<void> {
    const acceptPosts = publishing.capturePostsRead();
    setImporting(true);
    setError(null);

    try {
      const nextClips = await window.creatorApp.importClips();
      setClips(nextClips);
      setSelectedClipId((currentSelectedClipId) => {
        if (currentSelectedClipId && nextClips.some((clip) => clip.id === currentSelectedClipId)) {
          return currentSelectedClipId;
        }

        return nextClips[0]?.id ?? null;
      });
      const [nextWorkspaceIndexStatus, nextScheduledPosts] = await Promise.all([
        window.creatorApp.getWorkspaceIndexStatus(),
        window.creatorApp.listScheduledPosts()
      ]);
      setWorkspaceIndexStatus(nextWorkspaceIndexStatus);
      acceptPosts(nextScheduledPosts);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to import clips.");
    } finally {
      setImporting(false);
    }
  }


  function handleOpenLongFormProposal(proposal: LongFormClipProposalRecord): void {
    setSelectedLongFormSourceId(proposal.sourceId);
    setSelectedLongFormProposalId(proposal.id);
    setActiveView("review");
  }

  function handleSelectWorkflowStage(stage: WorkflowSelection["stage"]): void {
    if (stage === "performance") {
      setActiveView("performance");
      return;
    }
    if (isReviewView) {
      setActiveView("review");
      window.setTimeout(() => {
        const targetId = stage === "import" || stage === "transcript" || stage === "package"
          ? "long-form-proposal-panel"
          : "review-clip-workspace";
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return;
    }
    if (stage === "transcript" && selectedLongFormSourceId) {
      setActiveView("review");
      return;
    }
    setActiveView("workspace");
    window.setTimeout(() => {
      const targetId = stage === "package" ? "publishing-metadata" : stage === "schedule" ? "publish-queue" : "clip-library";
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function handleNextWorkspaceAction(): void {
    if (!selectedClip) {
      void handleImportClips();
      return;
    }
    if (!selectedTranscript) {
      void handleTranscribeSelectedClip();
      return;
    }
    if (!selectedMetadata) {
      setMetadataMessage("Generating title, description, and tag candidates...");
      void handleGenerateMetadataCandidates("all");
      return;
    }
    if (selectedClipSchedulePosts.length === 0) {
      handleSelectWorkflowStage("schedule");
      return;
    }
    handleSelectWorkflowStage("performance");
  }

  function handleGenerateMetadataFromNextAction(): void {
    if (!selectedClip || !selectedTranscript || selectedMetadata) {
      handleNextWorkspaceAction();
      return;
    }

    setMetadataMessage("Generating title, description, and tag candidates...");
    void handleGenerateMetadataCandidates("all");
  }

  function handleClipLibraryFilterChange(filter: ClipLibraryFilter): void {
    setClipLibraryFilter(filter);
    try {
      window.localStorage.setItem(CLIP_LIBRARY_FILTER_STORAGE_KEY, filter);
    } catch {
      // Local UI preference is optional and must not interrupt clip review.
    }
  }

  function clearClipLibraryFilters(): void {
    handleClipLibraryFilterChange("all");
    setClipLibrarySearch("");
  }

  async function handleApproveLongFormProposal(
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings,
    fileName: string
  ): Promise<LongFormClipApprovalResult> {
    if (!selectedLongFormSource || !selectedLongFormProposal) {
      throw new Error("Select a clip proposal before approving it.");
    }

    setLongFormProposalActionId(selectedLongFormProposal.id);
    setError(null);
    try {
      const result = await window.creatorApp.approveLongFormClipProposal(
        selectedLongFormSource.id,
        selectedLongFormProposal.id,
        startMs,
        endMs,
        layout,
        fileName
      );
      make.updateProposal(result.proposal);
      setClips((currentClips) => [result.clip, ...currentClips.filter((clip) => clip.id !== result.clip.id)]);
      setSelectedClipId(result.clip.id);
      return result;
    } catch (error) {
      // Surface the durable receipt after a partial failure so the next click can
      // explicitly finish the original approval, including after navigation.
      const updated = await window.creatorApp.listLongFormClipProposals(selectedLongFormSource.id).catch(() => []);
      const pending = updated.find((item) => item.id === selectedLongFormProposal.id);
      if (pending) make.updateProposal(pending);
      throw error;
    } finally {
      setLongFormProposalActionId(null);
    }
  }

  async function handleRejectLongFormProposal(reason?: string): Promise<LongFormClipProposalRecord> {
    if (!selectedLongFormSource || !selectedLongFormProposal) {
      throw new Error("Select a clip proposal before rejecting it.");
    }

    setLongFormProposalActionId(selectedLongFormProposal.id);
    setError(null);
    try {
      const result = await window.creatorApp.rejectLongFormClipProposal(
        selectedLongFormSource.id,
        selectedLongFormProposal.id,
        reason
      );
      make.updateProposal(result);
      return result;
    } finally {
      setLongFormProposalActionId(null);
    }
  }

  async function handleReopenLongFormProposal(): Promise<LongFormClipProposalRecord> {
    if (!selectedLongFormSource || !selectedLongFormProposal) {
      throw new Error("Select a clip proposal before reopening it.");
    }

    setLongFormProposalActionId(selectedLongFormProposal.id);
    setError(null);
    try {
      const result = await window.creatorApp.reopenLongFormClipProposal(
        selectedLongFormSource.id,
        selectedLongFormProposal.id
      );
      make.updateProposal(result);
      return result;
    } finally {
      setLongFormProposalActionId(null);
    }
  }



  async function handleCreateScheduledPost(useNextPostingSlot = false): Promise<void> {
    await publishing.schedule(edit.captureReviewedMetadata(), selectedYouTubePlaylistIds, useNextPostingSlot);
  }



  async function handleSaveYouTubeCredentials(): Promise<void> {
    setSavingYouTubeCredentials(true);
    setError(null);

    try {
      const connection = await window.creatorApp.saveYouTubeCredentials(
        youtubeClientIdInput,
        youtubeClientSecretInput
      );
      setYouTubeConnection(connection);
      setYouTubeClientSecretInput("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save YouTube credentials.");
    } finally {
      setSavingYouTubeCredentials(false);
    }
  }

  async function handleClearYouTubeCredentials(): Promise<void> {
    setClearingYouTubeCredentials(true);
    setError(null);

    try {
      const connection = await window.creatorApp.clearYouTubeCredentials();
      setYouTubeConnection(connection);
      setYouTubeClientIdInput("");
      setYouTubeClientSecretInput("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear YouTube credentials.");
    } finally {
      setClearingYouTubeCredentials(false);
    }
  }

  async function handleSaveCreatorProfileLinks(): Promise<void> {
    setSavingCreatorProfileLinks(true);
    setError(null);

    try {
      const nextInfo = await window.creatorApp.saveCreatorProfileLinks(creatorProfileLinksInput);
      setAppInfo(nextInfo);
      setEditingCreatorProfileLinks(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save creator profile links.");
    } finally {
      setSavingCreatorProfileLinks(false);
    }
  }

  function handleVoiceSampleProfileSaved(nextInfo: AppInfo): void {
    setAppInfo(nextInfo);
    setCollaboratorProfilesInput((currentProfiles) =>
      currentProfiles.map((profile) => {
        const savedProfile = nextInfo.collaboratorProfiles.find((candidate) => candidate.id === profile.id);
        return savedProfile ? { ...profile, voiceSamples: savedProfile.voiceSamples } : profile;
      })
    );
  }

  async function handleSaveCollaboratorProfiles(): Promise<void> {
    setSavingCollaboratorProfiles(true);
    setError(null);

    try {
      const nextInfo = await window.creatorApp.saveCollaboratorProfiles(collaboratorProfilesInput);
      setAppInfo(nextInfo);
      setEditingCollaboratorProfiles(false);
      setDraftCollaboratorProfileIds((currentIds) =>
        currentIds.filter((id) => nextInfo.collaboratorProfiles.some((profile) => profile.id === id))
      );
      setDraftTranscriptSegments((currentSegments) =>
        currentSegments.map((segment) => ({
          ...segment,
          speakerId:
            segment.speakerId === CREATOR_SPEAKER_ID ||
            (segment.speakerId &&
              nextInfo.collaboratorProfiles.some((profile) => profile.id === segment.speakerId))
              ? segment.speakerId
              : null,
          speakerConfidence:
            segment.speakerId === CREATOR_SPEAKER_ID ||
            (segment.speakerId &&
              nextInfo.collaboratorProfiles.some((profile) => profile.id === segment.speakerId))
              ? segment.speakerConfidence
              : null,
          speakerAssignmentSource:
            segment.speakerId === CREATOR_SPEAKER_ID ||
            (segment.speakerId &&
              nextInfo.collaboratorProfiles.some((profile) => profile.id === segment.speakerId))
              ? segment.speakerAssignmentSource
              : null,
          speakerReviewReason:
            segment.speakerId === CREATOR_SPEAKER_ID ||
            (segment.speakerId &&
              nextInfo.collaboratorProfiles.some((profile) => profile.id === segment.speakerId))
              ? segment.speakerReviewReason
              : null,
          speakerAlternateSpeakerId:
            segment.speakerId === CREATOR_SPEAKER_ID ||
            (segment.speakerId &&
              nextInfo.collaboratorProfiles.some((profile) => profile.id === segment.speakerId))
              ? segment.speakerAlternateSpeakerId
              : null,
          speakerAlternateConfidence:
            segment.speakerId === CREATOR_SPEAKER_ID ||
            (segment.speakerId &&
              nextInfo.collaboratorProfiles.some((profile) => profile.id === segment.speakerId))
              ? segment.speakerAlternateConfidence
              : null
        }))
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save collaborator profiles.");
    } finally {
      setSavingCollaboratorProfiles(false);
    }
  }


  function handleAddCollaboratorProfile(): void {
    setCollaboratorProfilesInput((currentProfiles) => {
      const nextProfile = createEmptyCollaboratorProfile();
      return [
        ...currentProfiles,
        {
          ...nextProfile,
          speakerColorHex: getDefaultSpeakerColor(currentProfiles.length + 1)
        }
      ];
    });
  }


  function handleCancelCreatorProfileLinkEdits(): void {
    setCreatorProfileLinksInput(savedCreatorProfileLinks);
    setEditingCreatorProfileLinks(false);
  }

  function handleCancelCollaboratorProfileEdits(): void {
    setCollaboratorProfilesInput(savedCollaboratorProfiles);
    setEditingCollaboratorProfiles(false);
  }


  function handleRemoveCollaboratorProfile(profileId: string): void {
    setCollaboratorProfilesInput((currentProfiles) =>
      currentProfiles.filter((profile) => profile.id !== profileId)
    );
    setDraftCollaboratorProfileIds((currentIds) => currentIds.filter((id) => id !== profileId));
    setDraftTranscriptSegments((currentSegments) =>
      currentSegments.map((segment) => ({
        ...segment,
        speakerId: segment.speakerId === profileId ? null : segment.speakerId,
        speakerConfidence: segment.speakerId === profileId ? null : segment.speakerConfidence,
        speakerAssignmentSource: segment.speakerId === profileId ? null : segment.speakerAssignmentSource,
        speakerReviewReason: segment.speakerId === profileId ? null : segment.speakerReviewReason,
        speakerAlternateSpeakerId:
          segment.speakerId === profileId ? null : segment.speakerAlternateSpeakerId,
        speakerAlternateConfidence:
          segment.speakerId === profileId ? null : segment.speakerAlternateConfidence
      }))
    );
  }


  function handleUpdateCollaboratorProfileName(profileId: string, displayName: string): void {
    setCollaboratorProfilesInput((currentProfiles) =>
      currentProfiles.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              displayName
            }
          : profile
      )
    );
  }


  function handleUpdateCollaboratorProfileLink(
    profileId: string,
    key: keyof CreatorProfileLinks,
    value: string
  ): void {
    setCollaboratorProfilesInput((currentProfiles) =>
      currentProfiles.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              profileLinks: {
                ...profile.profileLinks,
                [key]: value
              }
            }
          : profile
      )
    );
  }

  function handleUpdateCollaboratorSpeakerColor(profileId: string, value: string): void {
    setCollaboratorProfilesInput((currentProfiles) =>
      currentProfiles.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              speakerColorHex: normalizeSpeakerColorHex(value, profile.speakerColorHex ?? undefined)
            }
          : profile
      )
    );
  }








  async function handleConnectYouTube(): Promise<void> {
    setConnectingYouTube(true);
    setError(null);

    try {
      const connection = await window.creatorApp.connectYouTube();
      setYouTubeConnection(connection);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to connect the YouTube account.");
    } finally {
      setConnectingYouTube(false);
    }
  }

  async function handleDisconnectYouTube(): Promise<void> {
    setDisconnectingYouTube(true);
    setError(null);

    try {
      const connection = await window.creatorApp.disconnectYouTube();
      setYouTubeConnection(connection);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to disconnect the YouTube account.");
    } finally {
      setDisconnectingYouTube(false);
    }
  }

  function requestClipDataRemoval(clipOverride?: ClipRecord): void {
    const clipToRemove = clipOverride ?? selectedClip;
    if (!clipToRemove) {
      return;
    }
    setClipDataRemovalMessage(null);
    setPendingClipDataRemoval(clipToRemove);
  }

  async function handleConfirmClipDataRemoval(): Promise<void> {
    const clipToRemove = pendingClipDataRemoval;
    if (!clipToRemove) {
      return;
    }

    setRemovingClipId(clipToRemove.id);
    setError(null);
    if (clipToRemove.id === selectedClipId) {
      setSelectedTranscript(null);
      setEditingTranscript(false);
    }

    try {
      const result = await window.creatorApp.deleteClipAppData(clipToRemove.id);
      setClipDataRemovalMessage(
        `Removed app data for "${result.displayName}". The source video was preserved. ` +
        `AI-learning history retained: ${result.preserved.metadataPackages} metadata package${result.preserved.metadataPackages === 1 ? "" : "s"}, ` +
        `${result.preserved.metadataFeedback} metadata feedback record${result.preserved.metadataFeedback === 1 ? "" : "s"}, ` +
        `${result.preserved.proposalFeedback} proposal decision record${result.preserved.proposalFeedback === 1 ? "" : "s"}.`
      );
      setPendingClipDataRemoval(null);
      await refreshWorkspaceData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to remove the selected clip's app data.");
    } finally {
      setRemovingClipId(null);
    }
  }

  async function handleClearWorkspaceClipIndexes(): Promise<void> {
    if (typeof window.creatorApp.clearWorkspaceClipIndexes !== "function") {
      setError("This app window is using an older desktop API. Close and reopen the app to load the latest workspace cleanup actions.");
      return;
    }

    const confirmed = window.confirm(
      "Archive every active clip from the Clip Library view?\n\nThis keeps your video files and all saved workflow history. Re-importing a matching file can reactivate its existing record."
    );

    if (!confirmed) {
      return;
    }

    setClearingClipIndexes(true);
    setError(null);
    setSelectedTranscript(null);
    setEditingTranscript(false);

    try {
      await window.creatorApp.clearWorkspaceClipIndexes();
      await refreshWorkspaceData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear indexed clips.");
    } finally {
      setClearingClipIndexes(false);
    }
  }







  function renderMetadataVariantCard(variant: MetadataVariantRecord): JSX.Element {
    const isTagVariant = variant.kind === "public_hashtags" || variant.kind === "platform_tags";
    const isSelected =
      (variant.kind === "title" && selectedVariantIds.title === variant.id) ||
      (variant.kind === "description" && selectedVariantIds.description === variant.id) ||
      (isTagVariant &&
        (selectedVariantIds.publicHashtags === variant.id || selectedVariantIds.platformTags === variant.id));

    return (
      <article
        key={variant.id}
        className={`metadata-variant-card${isSelected ? " selected" : ""}`}
      >
        <button
          type="button"
          className="metadata-variant-select"
          onClick={() => void handleSelectMetadataVariant(variant)}
          disabled={savingMetadata || creatingScheduledPost}
          aria-pressed={isSelected}
          aria-label={`${isSelected ? "Selected" : "Select"} ${formatMetadataVariantAngle(variant.angle)} suggestion`}
        >
          <div className="metadata-variant-header">
            <div className="metadata-variant-title">
              <strong>{formatMetadataVariantAngle(variant.angle)}</strong>
              {variant.scoreSnapshot ? (
                <span className="metadata-variant-score-tip">
                  <InfoTip label="Suggestion score">
                    Clarity {variant.scoreSnapshot.packagingClarity}/20 | Hook {variant.scoreSnapshot.hookStrength}/20 |
                    Context {variant.scoreSnapshot.searchContextClarity}/10
                  </InfoTip>
                </span>
              ) : null}
              {variant.source === "heuristic" ? <p className="detail-meta">Fallback</p> : null}
            </div>
            <span className="metadata-variant-selection-mark" aria-hidden="true">
              {isSelected ? "★" : "☆"}
            </span>
          </div>
          {Array.isArray(variant.content) ? (
            <div className="metadata-tag-list">
              {variant.content.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          ) : (
            <p className="metadata-variant-content">{formatMetadataVariantContent(variant.content)}</p>
          )}
        </button>
        <button
          type="button"
          className="metadata-variant-reject"
          onClick={() => void handleRejectMetadataVariant(variant)}
          disabled={recordingMetadataFeedbackId === variant.id}
          aria-label={`Reject ${formatMetadataVariantAngle(variant.angle)} suggestion`}
          title="Reject suggestion"
        >
          {recordingMetadataFeedbackId === variant.id ? "…" : "×"}
        </button>
      </article>
    );
  }

  function renderPerformanceSummary(snapshot: YouTubePerformanceSnapshotRecord): JSX.Element {
    return (
      <div className="metadata-performance-grid">
        <StatusRow label="Engaged views" value={formatMetricNumber(snapshot.engagedViews)} />
        <StatusRow label="Views" value={formatMetricNumber(snapshot.views)} />
        <StatusRow
          label="Avg view duration"
          value={formatMetricSeconds(snapshot.averageViewDuration)}
        />
        <StatusRow
          label="Avg viewed"
          value={formatMetricPercentage(snapshot.averageViewPercentage)}
        />
        <StatusRow label="Likes" value={formatMetricNumber(snapshot.likes)} />
        <StatusRow label="Comments" value={formatMetricNumber(snapshot.comments)} />
      </div>
    );
  }

  return (
    <AppShell
      activeView={activeView}
      indexedClipCount={workspaceIndexStatus?.indexedClipCount ?? clips.length}
      onViewChange={setActiveView}
    >
      <PageHeader
        context={isSettingsView ? "System setup" : isReviewView ? "Make workflow" : isPerformanceView ? "Performance intelligence" : "Edit workflow"}
        breadcrumb={`CREATOR WORKBENCH / ${isSettingsView ? "SETTINGS" : isReviewView ? "MAKE" : isPerformanceView ? "PERFORMANCE" : "EDIT"}`}
        title={isSettingsView ? "System setup" : isReviewView ? "Make" : isPerformanceView ? "Performance" : "Edit"}
        kicker={isSettingsView ? "Tools, storage, connections" : isReviewView ? "Long-form source to approved clip" : isPerformanceView ? "Owned YouTube channel analysis, kept local-first" : "Transcript, metadata, scheduling"}
        onRefresh={() => void loadInitialState()}
        refreshing={loading}
        info={(
          <InfoTip label="About this workspace">
            {isSettingsView
              ? "Configure folders, local runtimes, AI profiles, and YouTube access here. These controls stay out of the production workflow."
              : isReviewView
                ? "Review the source, correct the trusted transcript, trim non-destructively, and approve clips into the existing library."
                : isPerformanceView
                  ? "Refresh owned YouTube performance manually and use channel evidence to guide review-first improvements."
                  : "Turn imported clips into reviewed, packaged, and scheduled posts."}
          </InfoTip>
        )}
        actions={(
          <>
          {isEditView ? (
            <button className="primary-button" onClick={() => void handleImportClips()} disabled={importing}>
              <span className="button-icon">+</span>{importing ? "Importing..." : appInfo?.clipLibraryFolder ? "Sync library" : "Import clips"}
            </button>
          ) : null}
          </>
        )}
      />

      {isEditView && lastSyncSummary ? (
        <div className="sync-strip"><span className="status-dot" /><strong>{appInfo?.clipLibraryFolder ? "Library synced" : "Import complete"}</strong><span>{lastSyncSummary}</span><time>{lastSyncAt ? formatShortTimestamp(lastSyncAt) : ""}</time></div>
      ) : null}

      <section className="hero-panel legacy-hero-panel">
        <div>
          <p className="eyebrow">Creator Workspace</p>
          <h1>
            {isSettingsView
              ? "Adjust the local app setup without cluttering the clip workspace."
              : isReviewView
                ? "Review the source clip before it enters the existing metadata and publishing workflow."
              : isPerformanceView
                ? "Understand how your owned YouTube videos are landing and turn channel evidence into better packaging."
                : "Import clips, transcribe them locally, and keep the transcript in your workspace."}
          </h1>
          <p className="hero-copy">
            {isSettingsView
              ? "Runtime paths live here so clip work stays focused. Use this page when you need to point the app at local tools or inspect the current data path."
              : isReviewView
                ? "Use the video timeline and trusted transcript together. Corrections are saved locally, and trim exports always create a separate copy."
              : isPerformanceView
                 ? "This dashboard stays focused on your YouTube account: owned video results, Analytics evidence, publishing history, and review-first coaching."
                : "This MVP slice now focuses on real clip work: import existing shorts, point the app at your local transcription stack, and persist transcript plus SRT output for each clip."}
          </p>
        </div>
        <div className="hero-actions">
          <div className="view-switch">
            <button
              type="button"
              className={`view-switch-button${activeView === "workspace" ? " active" : ""}`}
              onClick={() => setActiveView("workspace")}
            >
              Workspace
            </button>
            <button
              type="button"
              className={`view-switch-button${activeView === "review" ? " active" : ""}`}
              onClick={() => setActiveView("review")}
            >
              Make Clips
            </button>
            <button
              type="button"
              className={`view-switch-button${activeView === "performance" ? " active" : ""}`}
              onClick={() => setActiveView("performance")}
            >
              Performance
            </button>
            <button
              type="button"
              className={`view-switch-button${activeView === "settings" ? " active" : ""}`}
              onClick={() => setActiveView("settings")}
            >
              Settings
            </button>
          </div>
          {activeView === "workspace" ? (
            <div className="hero-sync-group">
              <button className="primary-button" onClick={() => void handleImportClips()} disabled={importing}>
                {importing ? "Importing..." : appInfo?.clipLibraryFolder ? "Sync Clip Library" : "Import Clips"}
              </button>
              {lastSyncSummary ? (
                <div className="hero-sync-status">
                  <span className="hero-sync-label">
                    {appInfo?.clipLibraryFolder ? "Last sync" : "Last import"}
                    {lastSyncAt ? ` • ${formatShortTimestamp(lastSyncAt)}` : ""}
                  </span>
                  <span className="hero-sync-summary">{lastSyncSummary}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <button className="secondary-button" onClick={() => void loadInitialState()} disabled={loading}>
            Refresh
          </button>
        </div>
      </section>

      {isReviewView && creatorSetupState && !creatorSetupState.ready ? (
        <SetupCard state={creatorSetupState} onOpenSettings={openSettingsSection} />
      ) : null}

      {error ? <div className="alert error">{error}</div> : null}
      {clipDataRemovalMessage ? <div className="alert success-banner">{clipDataRemovalMessage}</div> : null}
      {isSettingsView ? (
        <>
          <nav className="settings-section-nav" aria-label="Settings sections">
            {[['settings-local-ai', 'Local AI'], ['settings-storage', 'Workspace'], ['settings-publishing', 'Publishing'], ['settings-people', 'People'], ['settings-automation', 'Automation']].map(([id, label]) => (
              <a key={id} href={`#${id}`}>{label}</a>
            ))}
          </nav>
          <div className="settings-page-sections">
          <AdvancedDetails summary="Advanced runtime and tool paths">
          <div className="panel-grid settings-technical-grid">
            <section className="panel settings-section settings-technical-panel" id="settings-runtime">
              <div className="panel-header">
                <h2>Runtime</h2>
                <span className="panel-badge">{loading ? "Loading" : "Ready"}</span>
              </div>
              {appInfo ? (
                <div className="stack-list">
                  <StatusRow label="Workspace" value={appInfo.workspaceName} />
                  <StatusRow label="Data file" value={appInfo.databasePath} />
                  <StatusRow label="Electron" value={appInfo.electronVersion} />
                  <StatusRow label="Node" value={appInfo.nodeVersion} />
                </div>
              ) : (
                <p className="muted">Loading runtime information...</p>
              )}
            </section>

            <section className="panel settings-section settings-technical-panel" id="settings-tooling">
              <div className="panel-header">
                <div>
                  <h2>Tooling</h2>
                  <p className="muted">
                    The app auto-detects workspace-local tools first, then falls back to saved paths, env vars, and PATH.
                  </p>
                </div>
                <span className="panel-badge">Local</span>
              </div>
              {appInfo ? (
                <div className="tool-grid">
                  <ToolCard
                    name="FFmpeg"
                    toolKey="ffmpeg"
                    runtime={appInfo.ffmpeg}
                    configuringTool={configuringTool}
                    onConfigure={handleConfigureToolPath}
                    onClear={handleClearToolPath}
                  />
                  <ToolCard
                    name="FFprobe"
                    toolKey="ffprobe"
                    runtime={appInfo.ffprobe}
                    configuringTool={configuringTool}
                    onConfigure={handleConfigureToolPath}
                    onClear={handleClearToolPath}
                  />
                  <ToolCard
                    name="whisper.cpp"
                    toolKey="whisper"
                    runtime={appInfo.whisper}
                    configuringTool={configuringTool}
                    onConfigure={handleConfigureToolPath}
                    onClear={handleClearToolPath}
                  />
                  <ToolCard
                    name="Whisper model"
                    toolKey="whisperModel"
                    runtime={appInfo.whisperModel}
                    configuringTool={configuringTool}
                    onConfigure={handleConfigureToolPath}
                    onClear={handleClearToolPath}
                  />
                </div>
              ) : (
                <p className="muted">Loading tool status...</p>
              )}
          </section>
          </div>
          </AdvancedDetails>

          <section className="panel settings-section settings-folder-panel" id="settings-storage">
            <div className="panel-header">
              <div>
                <div className="title-with-tip"><h2>Library and storage</h2><InfoTip label="Library storage">These folders control where the app reads clips, writes subtitle files, and keeps original long-form sources. Clearing the index never deletes source video files.</InfoTip></div>
                <p className="muted">Keep production views focused by managing paths and safe cleanup here.</p>
              </div>
              <span className="panel-badge">Local only</span>
            </div>
            {appInfo ? (
              <>
                <div className="workspace-folder-grid settings-folder-grid">
                  <WorkspaceFolderCard
                    name="Clip library folder"
                    description="Imported shorts and approved long-form renders land here."
                    folderKey="clipLibrary"
                    folderPath={appInfo.clipLibraryFolder}
                    configuringFolder={configuringFolder}
                    onConfigure={handleConfigureWorkspaceFolder}
                    onClear={handleClearWorkspaceFolder}
                  />
                  <WorkspaceFolderCard
                    name="SRT output folder"
                    description="Subtitle exports are written here when configured."
                    folderKey="srtOutput"
                    folderPath={appInfo.srtOutputFolder}
                    configuringFolder={configuringFolder}
                    onConfigure={handleConfigureWorkspaceFolder}
                    onClear={handleClearWorkspaceFolder}
                  />
                  <WorkspaceFolderCard
                    name="Long-form source library"
                    description="Original streams stay separate from the short-clip library."
                    folderKey="longFormSourceLibrary"
                    folderPath={appInfo.longFormSourceLibraryFolder}
                    configuringFolder={configuringFolder}
                    onConfigure={handleConfigureWorkspaceFolder}
                    onClear={handleClearWorkspaceFolder}
                  />
                </div>
                <DataManagementPanel
                  summary={dataManagementSummary}
                  scan={dataHealthScan}
                  busy={dataManagementBusy}
                  message={dataManagementMessage}
                  onScan={() => void handleScanDataHealth()}
                  onClearClipLibrary={() => void handleClearClipLibraryIndex()}
                  onClearLongForm={() => void handleClearLongFormIndex()}
                  onCleanup={(issueIds) => void handleCleanupOrphanedData(issueIds)}
                />
              </>
            ) : <p className="muted">Loading storage settings...</p>}
          </section>

          <section className="panel settings-section" id="settings-publishing">
            <div className="panel-header">
              <div>
                <h2>Publishing Connections</h2>
                <p className="muted">
                  Connect the creator workspace to YouTube with your own Google OAuth app so uploads and scheduling stay under your account and quotas.
                </p>
              </div>
              <span className="panel-badge">{youtubeConnected ? "Connected" : "Setup"}</span>
            </div>

            <div className="connection-grid">
              <article className="connection-card">
                <div className="connection-card-header">
                  <div>
                    <h3>YouTube</h3>
                    <p className="muted">
                      Use a Google OAuth desktop app client here. The client secret is optional for desktop credentials, and everything is stored locally on this machine.
                    </p>
                  </div>
                  <span className={youtubeConnected ? "tool-status available" : "tool-status missing"}>
                    {youtubeConnected ? "Connected" : youtubeConnection?.clientIdConfigured ? "Credentials saved" : "Not set"}
                  </span>
                </div>

                <div className="connection-fields">
                  <label className="editor-field">
                    <span>Google OAuth client ID</span>
                    <input
                      className="editor-input"
                      value={youtubeClientIdInput}
                      onChange={(event) => setYouTubeClientIdInput(event.target.value)}
                      placeholder="Paste the Google OAuth desktop app client ID"
                    />
                  </label>

                  <label className="editor-field">
                    <span>Google OAuth client secret (optional)</span>
                    <input
                      type="password"
                      className="editor-input"
                      value={youtubeClientSecretInput}
                      onChange={(event) => setYouTubeClientSecretInput(event.target.value)}
                      placeholder={
                        youtubeConnection?.clientSecretConfigured
                          ? "A secret is already saved locally. Leave blank to keep it."
                          : "Leave blank if your desktop OAuth client does not require one"
                      }
                    />
                  </label>
                </div>

                <AdvancedDetails summary="Google setup details">
                <div className="connection-checklist">
                  <div>
                    <h4>Google Cloud Setup Checklist</h4>
                    <p className="muted">
                      Use this exact setup in Google Cloud Console before clicking Connect YouTube here.
                    </p>
                  </div>

                  <div className="connection-checklist-grid">
                    <article className="connection-checklist-card">
                      <strong>1. Create the right OAuth client</strong>
                      <p className="muted">
                        Create an OAuth client of type <strong>Desktop app</strong>. This app uses a local loopback redirect, so you do not need to add a manual redirect URI for the desktop client.
                      </p>
                    </article>

                    <article className="connection-checklist-card">
                      <strong>2. Enable the required Google APIs</strong>
                      <ul className="connection-checklist-list">
                        {YOUTUBE_REQUIRED_APIS.map((apiName) => (
                          <li key={apiName}>{apiName}</li>
                        ))}
                      </ul>
                    </article>

                    <article className="connection-checklist-card">
                      <strong>3. Add the scopes this app requests</strong>
                      <ul className="connection-checklist-list connection-scope-list">
                        {YOUTUBE_REQUESTED_SCOPES.map((scope) => (
                          <li key={scope}>
                            <code>{scope}</code>
                          </li>
                        ))}
                      </ul>
                    </article>

                    <article className="connection-checklist-card">
                      <strong>4. Consent screen status</strong>
                      <p className="muted">
                        Testing mode is fine while you are setting this up for yourself. If Google shows an unverified app warning, that is expected until the project is verified.
                      </p>
                    </article>
                  </div>
                </div>
                </AdvancedDetails>

                <div className="connection-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleSaveYouTubeCredentials()}
                    disabled={youtubeBusy || youtubeClientIdInput.trim().length === 0}
                  >
                    {savingYouTubeCredentials ? "Saving..." : "Save Credentials"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleConnectYouTube()}
                    disabled={youtubeBusy || !youtubeConnection?.clientIdConfigured}
                  >
                    {connectingYouTube ? "Waiting For Google..." : youtubeConnected ? "Reconnect YouTube" : "Connect YouTube"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void loadYouTubePlaylists()}
                    disabled={youtubeBusy || !youtubeConnected}
                  >
                    {loadingYouTubePlaylists ? "Loading Playlists..." : "Refresh Playlists"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleDisconnectYouTube()}
                    disabled={youtubeBusy || !youtubeConnected}
                  >
                    {disconnectingYouTube ? "Disconnecting..." : "Disconnect"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleClearYouTubeCredentials()}
                    disabled={youtubeBusy || !youtubeConnection?.clientIdConfigured}
                  >
                    {clearingYouTubeCredentials ? "Clearing..." : "Clear Credentials"}
                  </button>
                </div>

                <div className="stack-list">
                  <StatusRow
                    label="Connected channel"
                    value={youtubeConnection?.channelTitle ?? "No YouTube account connected yet"}
                  />
                  <StatusRow
                    label="Connected at"
                    value={
                      youtubeConnection?.connectedAt
                        ? formatTimestamp(youtubeConnection.connectedAt)
                        : "Not connected"
                    }
                  />
                  <StatusRow
                    label="User playlists"
                    value={
                      youtubeConnected
                        ? loadingYouTubePlaylists
                          ? "Loading..."
                          : String(youtubePlaylists.length)
                        : "Connect YouTube first"
                    }
                  />
                  <StatusRow
                    label="Analytics scope"
                    value={
                      youtubeConnected
                        ? youtubeConnection?.analyticsScopeGranted
                          ? "Granted"
                          : "Reconnect required"
                        : "Not connected"
                    }
                  />
                  <StatusRow
                    label="Caption upload scope"
                    value={
                      youtubeConnected
                        ? youtubeConnection?.captionsScopeGranted
                          ? "Granted"
                          : "Reconnect required"
                        : "Not connected"
                    }
                  />
                </div>
                {youtubeConnected && !youtubeConnection?.analyticsScopeGranted ? (
                  <p className="inline-warning">
                    Reconnect YouTube to grant Analytics read access before using performance refresh on uploads.
                  </p>
                ) : null}
                {youtubeConnected && !youtubeConnection?.captionsScopeGranted ? (
                  <p className="inline-warning">
                    Reconnect YouTube to enable automatic upload of complete canonical SRT captions after publishing.
                  </p>
                ) : null}
              </article>

              {postingSchedule ? (
                <PostingScheduleSettingsPanel
                  settings={postingSchedule}
                  busy={postingScheduleSaving}
                  nextSlotLabel={nextPostingSlot?.localLabel ?? null}
                  nextSlotReason={nextPostingSlot?.reason ?? null}
                  onSave={(settings) => void handleSavePostingSchedule(settings)}
                />
              ) : null}
              {postingScheduleMessage ? <p className="muted" role="status">{postingScheduleMessage}</p> : null}

            </div>
          </section>

          <SettingsSection
            id="settings-people"
            title="People"
            info="Manage your creator links, voice samples, and collaborator profiles used by transcript speaker review and descriptions."
            status={<StatusBadge tone={hasAnyVoiceSamples ? "ready" : "muted"}>{hasAnyVoiceSamples ? "Voice samples saved" : "Optional"}</StatusBadge>}
          >
            <div className="connection-grid">
              <article className="connection-card settings-people-anchor">
                <div className="connection-card-header">
                  <div>
                    <div className="title-with-tip">
                      <h3>Creator Profile Links</h3>
                      <InfoTip label="Description behavior">
                        Generated descriptions will append a “More from me:” block automatically when at least one saved link exists. You can also insert or refresh that block manually from the metadata editor.
                      </InfoTip>
                    </div>
                    <p className="muted">
                      Save your public profile URLs once and the app can append them to the bottom of generated YouTube descriptions.
                    </p>
                  </div>
                  <span
                    className={
                      creatorProfileLinksLocked
                        ? "tool-status available"
                        : creatorProfileLinksConfigured
                          ? "tool-status editing"
                          : "tool-status missing"
                    }
                  >
                    {creatorProfileLinksLocked
                      ? "Saved"
                      : creatorProfileLinksConfigured
                        ? "Editing"
                        : "Not set"}
                  </span>
                </div>

                <div className="connection-fields">
                  {CREATOR_PROFILE_LINK_FIELDS.map((field) => (
                    <label key={field.key} className="editor-field">
                      <span>{field.label}</span>
                      <input
                        className={`editor-input${creatorProfileLinksLocked ? " read-only-field" : ""}`}
                        value={creatorProfileLinksInput[field.key] ?? ""}
                        onChange={(event) =>
                          setCreatorProfileLinksInput((currentLinks) => ({
                            ...currentLinks,
                            [field.key]: event.target.value
                          }))
                        }
                        readOnly={creatorProfileLinksLocked}
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}
                </div>

                <div className="connection-actions">
                  {creatorProfileLinksLocked ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditingCreatorProfileLinks(true)}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleSaveCreatorProfileLinks()}
                        disabled={savingCreatorProfileLinks}
                      >
                        {savingCreatorProfileLinks ? "Saving..." : creatorProfileLinksConfigured ? "Save Changes" : "Save Profile Links"}
                      </button>
                      {creatorProfileLinksConfigured ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={handleCancelCreatorProfileLinkEdits}
                          disabled={savingCreatorProfileLinks}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </article>

              <article className="connection-card speaker-identity-card">
                <div className="connection-card-header">
                  <div>
                    <div className="title-with-tip">
                      <h3>Speaker identity</h3>
                      <InfoTip label="About speaker identity">
                        Voice samples improve local transcript speaker matching. They do not train or change the AI model.
                      </InfoTip>
                    </div>
                    <p className="muted">Help the app recognize your voice as `You` during transcript review.</p>
                  </div>
                  <StatusBadge tone={savedCreatorVoiceSamples.length > 0 ? "ready" : "muted"}>
                    {savedCreatorVoiceSamples.length > 0 ? "Ready to match" : "Set up when ready"}
                  </StatusBadge>
                </div>
                <div className="detail-actions speaker-identity-summary">
                  <span className="detail-meta">
                    {savedCreatorVoiceSamples.length} saved sample{savedCreatorVoiceSamples.length === 1 ? "" : "s"}
                  </span>
                  <VoiceSampleRecorder
                    profileId={CREATOR_SPEAKER_ID}
                    profileLabel="you"
                    onSaved={handleVoiceSampleProfileSaved}
                    onError={setError}
                  />
                </div>
                <AdvancedDetails summary={`Manage samples (${savedCreatorVoiceSamples.length})`}>
                  <p className="muted">
                    Add a short microphone sample or save clean assigned transcript segments from the Edit workflow.
                    The original recording is processed locally and is not retained.
                  </p>
                  <VoiceSampleList
                    samples={savedCreatorVoiceSamples}
                    removingSampleId={removingVoiceSampleKey?.startsWith(`${CREATOR_SPEAKER_ID}:`) ? removingVoiceSampleKey.slice(CREATOR_SPEAKER_ID.length + 1) : null}
                    onRemove={(sampleId) => void handleRemoveCreatorVoiceSample(sampleId)}
                  />
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => {
                      setSpeakerReviewOpenRequest((currentRequest) => currentRequest + 1);
                      setActiveView("workspace");
                    }}
                  >
                    Review transcript samples
                  </button>
                </AdvancedDetails>
                <p className="detail-meta">
                  Matching stays review-first: manual labels remain authoritative, and uncertain matches stay visible for review.
                </p>
              </article>

              <article className="connection-card">
                <div className="connection-card-header">
                  <div>
                    <h3>Collaborator Profiles</h3>
                    <p className="muted">
                      Save co-op partner names, profile links, and transcript colors once, then reuse the same
                      collaborator records across metadata, descriptions, and subtitle review.
                    </p>
                  </div>
                  <span
                    className={
                      collaboratorProfilesLocked
                        ? "tool-status available"
                        : collaboratorProfilesConfigured
                          ? "tool-status editing"
                          : "tool-status missing"
                    }
                  >
                    {collaboratorProfilesLocked
                      ? `Saved (${savedCollaboratorProfiles.length})`
                      : collaboratorProfilesConfigured
                        ? "Editing"
                        : "Not set"}
                  </span>
                </div>

                <div className="collaborator-profile-list">
                  {collaboratorProfilesInput.length > 0 ? (
                    collaboratorProfilesInput.map((profile, index) => (
                      <section key={profile.id} className="collaborator-profile-card">
                        <div className="collaborator-profile-header">
                          <div className="speaker-profile-title">
                            <span
                              className="speaker-color-chip"
                              style={{
                                backgroundColor: normalizeSpeakerColorHex(
                                  profile.speakerColorHex,
                                  getDefaultSpeakerColor(index + 1)
                                )
                              }}
                            />
                            <h4>Collaborator {index + 1}</h4>
                          </div>
                          {!collaboratorProfilesLocked ? (
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => handleRemoveCollaboratorProfile(profile.id)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>

                        <label className="editor-field">
                          <span>Display name</span>
                          <input
                            className={`editor-input${collaboratorProfilesLocked ? " read-only-field" : ""}`}
                            value={profile.displayName}
                            onChange={(event) =>
                              handleUpdateCollaboratorProfileName(profile.id, event.target.value)
                            }
                            readOnly={collaboratorProfilesLocked}
                            placeholder="Example: CoopChris"
                          />
                        </label>

                        <label className="editor-field">
                          <span>Transcript color</span>
                          <div className="speaker-color-input-row">
                            <input
                              type="color"
                              className="speaker-color-input"
                              value={normalizeSpeakerColorHex(
                                profile.speakerColorHex,
                                getDefaultSpeakerColor(index + 1)
                              )}
                              onChange={(event) =>
                                handleUpdateCollaboratorSpeakerColor(profile.id, event.target.value)
                              }
                              disabled={collaboratorProfilesLocked}
                            />
                            <input
                              className={`editor-input${collaboratorProfilesLocked ? " read-only-field" : ""}`}
                              value={normalizeSpeakerColorHex(
                                profile.speakerColorHex,
                                getDefaultSpeakerColor(index + 1)
                              )}
                              onChange={(event) =>
                                handleUpdateCollaboratorSpeakerColor(profile.id, event.target.value)
                              }
                              readOnly={collaboratorProfilesLocked}
                              placeholder="#F59E0B"
                            />
                          </div>
                        </label>

                        <div className="connection-fields">
                          {CREATOR_PROFILE_LINK_FIELDS.map((field) => (
                            <label key={`${profile.id}-${field.key}`} className="editor-field">
                              <span>{field.label}</span>
                              <input
                                className={`editor-input${collaboratorProfilesLocked ? " read-only-field" : ""}`}
                                value={profile.profileLinks[field.key] ?? ""}
                                onChange={(event) =>
                                  handleUpdateCollaboratorProfileLink(
                                    profile.id,
                                    field.key,
                                    event.target.value
                                  )
                                }
                                readOnly={collaboratorProfilesLocked}
                                placeholder={field.placeholder}
                              />
                            </label>
                          ))}
                        </div>

                        <div className="info-banner">
                          <div className="detail-actions">
                            <strong>Voice samples</strong>
                            <VoiceSampleRecorder
                              profileId={profile.id}
                              profileLabel={profile.displayName || `collaborator ${index + 1}`}
                              disabled={!savedCollaboratorProfiles.some((savedProfile) => savedProfile.id === profile.id)}
                              onSaved={handleVoiceSampleProfileSaved}
                              onError={setError}
                            />
                          </div>
                          <AdvancedDetails summary={`Show saved samples (${profile.voiceSamples.length})`}>
                            <p className="muted">
                              Add a microphone sample or save clean assigned transcript segments from the transcript editor.
                              Samples stay local and help auto-assign label matching segments.
                            </p>
                            <VoiceSampleList
                              samples={profile.voiceSamples}
                              locked={collaboratorProfilesLocked}
                              removingSampleId={removingVoiceSampleKey?.startsWith(`${profile.id}:`) ? removingVoiceSampleKey.slice(profile.id.length + 1) : null}
                              onRemove={(sampleId) =>
                                void handleRemoveCollaboratorVoiceSample(
                                  profile.id,
                                  sampleId,
                                  profile.displayName || `Collaborator ${index + 1}`
                                )
                              }
                              emptyMessage="No saved voice samples yet. Record one here or save an assigned transcript segment from the clip workspace."
                            />
                          </AdvancedDetails>
                        </div>
                      </section>
                    ))
                  ) : (
                    <p className="muted">
                      No collaborator profiles saved yet. Add one below to start reusing partner names and profile
                      links.
                    </p>
                  )}
                </div>

                {collaboratorProfilesLocked ? (
                  <div className="info-banner success-banner">
                    <strong>Saved locally</strong>
                    <p className="muted">
                      These collaborator profiles are locked for editing right now. Click `Edit` when you want to
                      change them.
                    </p>
                  </div>
                ) : null}

                <div className="info-banner">
                  <strong>Shared profile behavior</strong>
                  <p className="muted">
                    Selected collaborators can be added to the final description with `Insert Saved Links`. The same
                    collaborator profiles also drive transcript speaker colors now, and future voice-reference
                    matching will build on this shared profile system.
                  </p>
                </div>

                <div className="info-banner">
                  <strong>Built-in creator speaker</strong>
                  <p className="muted">
                    Your own voice appears as `You` inside transcript review automatically. Add collaborator profiles
                    here only for recurring co-op partners or guests you want linked and color-coded consistently.
                  </p>
                </div>

                <div className="connection-actions">
                  {collaboratorProfilesLocked ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditingCollaboratorProfiles(true)}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleAddCollaboratorProfile}
                        disabled={savingCollaboratorProfiles}
                      >
                        Add Collaborator
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleSaveCollaboratorProfiles()}
                        disabled={savingCollaboratorProfiles}
                      >
                        {savingCollaboratorProfiles ? "Saving..." : collaboratorProfilesConfigured ? "Save Changes" : "Save Collaborators"}
                      </button>
                      {collaboratorProfilesConfigured ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={handleCancelCollaboratorProfileEdits}
                          disabled={savingCollaboratorProfiles}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            </div>
          </SettingsSection>

          <section className="panel settings-section" id="settings-automation">
            <div className="panel-header">
              <div>
                <h2>Automation</h2>
                <p className="muted">
                  Folder watching is local-only and only runs while the app is open. Auto-transcription applies to newly imported clips.
                </p>
              </div>
              <span className="panel-badge">Optional</span>
            </div>
            {appInfo ? (
              <div className="automation-grid">
                <AutomationCard
                  name="Watch clip library folder"
                  description="Automatically import new supported video files that appear in the selected clip library folder while the app is open."
                  requirement={appInfo.clipLibraryFolder ? `Watching folder: ${appInfo.clipLibraryFolder}` : "Requires a clip library folder to be configured in the workspace view."}
                  enabled={appInfo.watchClipLibraryEnabled}
                  settingKey="watchClipLibrary"
                  configuringAutomation={configuringAutomation}
                  onToggle={handleSetWorkspaceAutomationSetting}
                  disabled={!appInfo.clipLibraryFolder}
                />
                <AutomationCard
                  name="Auto-transcribe on import"
                  description="Queue local transcription for newly imported clips after they are indexed into the workspace."
                  requirement="Requires FFmpeg, whisper.cpp, and a Whisper model to be configured locally."
                  enabled={appInfo.autoTranscribeOnImportEnabled}
                  settingKey="autoTranscribeOnImport"
                  configuringAutomation={configuringAutomation}
                  onToggle={handleSetWorkspaceAutomationSetting}
                />
              </div>
            ) : (
              <p className="muted">Loading automation settings...</p>
            )}
          </section>
          <section className="panel settings-section settings-ai-profile-section settings-ai-primary-section" id="settings-local-ai">
            <div className="panel-header">
              <div>
                <h2>Local AI &amp; Profiles</h2>
                <p className="muted">
                  Set up local runtimes and models, then assign task-specific profiles without leaving the Local AI workspace.
                </p>
              </div>
              <div className="detail-actions">
                <span className="panel-badge">
                  {appInfo?.transcriptionRuntime.statusLabel ?? "Loading"} · {visibleAiProfileTasks.length} tasks
                </span>
                {aiProfilesLocked ? (
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => setEditingAiProfiles(true)}
                  >
                    Edit profiles
                  </button>
                ) : (
                  <StatusBadge tone="editing">Editing profiles</StatusBadge>
                )}
              </div>
            </div>

            {appInfo ? (
              <SettingsCard className="settings-transcription-card">
                <div className="panel-header">
                  <div>
                    <h3>Transcription backend</h3>
                    <span className="settings-compact-helper">Auto prefers CUDA and falls back to CPU when available.</span>
                  </div>
                  <span className={`panel-badge ${appInfo.transcriptionRuntime.activeBackend === "missing" ? "warning-badge" : ""}`}>
                    {appInfo.transcriptionRuntime.statusLabel}
                  </span>
                </div>
                <div className="form-grid compact-form-grid">
                  <label className="field-label">
                    Backend preference
                    <select
                      value={appInfo.transcriptionRuntime.preference}
                      onChange={(event) => void handleSetTranscriptionBackend(event.target.value as TranscriptionBackendPreference)}
                      disabled={savingTranscriptionBackend}
                    >
                      <option value="auto">Auto (CUDA preferred, CPU fallback)</option>
                      <option value="cuda">CUDA only when available</option>
                      <option value="cpu">CPU fallback</option>
                    </select>
                  </label>
                  <div className="stack-list">
                    <SettingRow label="Active backend" value={appInfo.transcriptionRuntime.activeBackend.toUpperCase()} />
                    <SettingRow label="Active model" value={formatRuntimePath(appInfo.transcriptionRuntime.model.resolvedPath)} />
                  </div>
                </div>
                <p className="muted">{appInfo.transcriptionRuntime.statusDetail}</p>
                <AdvancedDetails summary="Backend paths and diagnostics">
                  <p className="detail-meta">
                    CUDA: {formatRuntimePath(appInfo.transcriptionRuntime.cudaRuntime.resolvedPath)} + {formatRuntimePath(appInfo.transcriptionRuntime.cudaModel.resolvedPath)}
                  </p>
                  <p className="detail-meta">
                    CPU fallback: {formatRuntimePath(appInfo.transcriptionRuntime.cpuRuntime.resolvedPath)} + {formatRuntimePath(appInfo.transcriptionRuntime.cpuModel.resolvedPath)}
                  </p>
                </AdvancedDetails>
              </SettingsCard>
            ) : null}

            <div className="info-banner">
              <strong>Cookbook foundation</strong>
              <p className="muted">
                Profiles let us specialize local AI by task, model preference, and prompt behavior. Metadata, thumbnail analysis, performance coaching, and clip discovery each keep their own review-first role.
              </p>
            </div>

            <LocalAiSetupPanel
              runtime={localAiRuntime}
              environment={appInfo?.setupEnvironment ?? null}
              action={localAiAction}
              progress={localAiSetupProgress}
              onRefresh={() => void handleRefreshLocalAiRuntime()}
              onImportRuntime={() => void handleImportLocalAiRuntimeExecutable()}
              onImportModel={() => void handleImportLocalAiModel()}
              onClearRuntime={() => void handleClearLocalAiRuntimeExecutable()}
              onDownloadAsset={(assetId) => void handleDownloadLocalAiSetupAsset(assetId)}
              onInstallRecommended={(recommendation) => void handleInstallRecommendedLocalAiSetup(recommendation)}
              onCancelDownload={() => void handleCancelLocalAiSetupDownload()}
            />

            <div className={`info-banner ${strictAiModeEnabled ? "warning-banner" : ""}`}>
              <strong>Strict AI</strong>
              <p className="muted">
                When enabled, metadata generation and performance coaching refuse deterministic fallback. If the local AI model is missing, times out, errors, or returns unusable output, the action fails instead of quietly generating fallback content.
              </p>
              <div className="detail-actions">
                <span className={strictAiModeEnabled ? "tool-status missing" : "tool-status available"}>
                  {strictAiModeEnabled ? "AI-only mode enabled" : "Fallback allowed"}
                </span>
                <button
                  type="button"
                  className={strictAiModeEnabled ? "danger-button" : "secondary-button"}
                  onClick={() => void handleSetAiStrictMode(!strictAiModeEnabled)}
                  disabled={savingStrictAiMode}
                >
                  {savingStrictAiMode
                    ? "Saving..."
                    : strictAiModeEnabled
                      ? "Disable Strict AI"
                      : "Enable Strict AI"}
                </button>
              </div>
              <p className="detail-meta">
                Current state: {strictAiModeEnabled ? "Strict AI is on. Fallback runs are blocked." : "Strict AI is off. Fallback stays available only when the AI run fails."}
              </p>
            </div>

            <SettingsCard className="settings-task-assignments">
            <div className="connection-fields">
              {visibleAiProfileTasks.map((taskDefinition) => (
                <label key={taskDefinition.id} className="editor-field">
                  <span>{taskDefinition.assignmentLabel}</span>
                  <select
                    className="editor-input"
                    value={getAiProfileAssignmentValue(aiProfileAssignmentsInput, taskDefinition.id)}
                    onChange={(event) =>
                      handleUpdateAiProfileAssignment(taskDefinition.id, event.target.value)
                    }
                    disabled={aiProfilesLocked}
                  >
                    {aiProfilesInput
                      .filter((profile) => profile.task === taskDefinition.id)
                      .map((profile) => (
                        <option key={profile.id} value={profile.id} disabled={!profile.enabled}>
                          {profile.name}
                          {profile.enabled ? "" : " (Disabled)"}
                        </option>
                      ))}
                  </select>
                  <AdvancedDetails summary="Task details">
                    <span className="detail-meta">Wired function: {taskDefinition.wiredFeature}</span>
                  </AdvancedDetails>
                </label>
              ))}
            </div>
            </SettingsCard>

            <div className="settings-profile-manager">
              <ScrollableSettingsList className="settings-profile-list">
                <div className="settings-profile-list-header">
                  <h3>Profiles</h3>
                  <StatusBadge tone={aiProfilesLocked ? "muted" : "editing"}>
                    {aiProfilesLocked ? "Saved" : "Editing"}
                  </StatusBadge>
                </div>
                {aiProfilesInput.map((profile) => {
                  const taskLabel = getAiProfileTaskDefinition(visibleAiProfileTasks, profile.task)?.label ?? formatAiProfileTaskLabel(profile.task);
                  const modelLabel = profile.preferredModel
                    ? availableLocalAiModels.find((model) => model.id === profile.preferredModel)?.label ?? profile.preferredModel
                    : "Auto model";
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`settings-profile-list-item${profile.id === selectedAiProfile?.id ? " selected" : ""}`}
                      onClick={() => setSelectedAiProfileId(profile.id)}
                      aria-pressed={profile.id === selectedAiProfile?.id}
                    >
                      <span className="settings-profile-list-copy">
                        <strong>{profile.name || "Unnamed AI profile"}</strong>
                        <span>{taskLabel} - {modelLabel}</span>
                      </span>
                      <StatusBadge tone={profile.enabled ? "ready" : "muted"}>
                        {profile.enabled ? "On" : "Off"}
                      </StatusBadge>
                    </button>
                  );
                })}
                {aiProfilesInput.length === 0 ? <p className="muted">No AI profiles are available.</p> : null}
              </ScrollableSettingsList>
              <div className="settings-profile-editor">
                <div className="collaborator-profile-list">
              {aiProfilesInput.filter((profile) => profile.id === selectedAiProfile?.id).map((profile) => (
                <section key={profile.id} className="collaborator-profile-card">
                  <div className="collaborator-profile-header">
                    <div className="speaker-profile-title">
                      <h4>{profile.name || "Unnamed AI profile"}</h4>
                    </div>
                    <div className="detail-actions">
                      <span className={profile.enabled ? "tool-status available" : "tool-status missing"}>
                        {profile.enabled ? "Enabled" : "Disabled"}
                      </span>
                      {!profile.builtIn && !aiProfilesLocked ? (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          onClick={() => handleRemoveAiProfile(profile.id)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <label className="editor-field">
                    <span>Profile name</span>
                    <input
                      className={`editor-input${aiProfilesLocked ? " read-only-field" : ""}`}
                      value={profile.name}
                      onChange={(event) => handleUpdateAiProfile(profile.id, { name: event.target.value })}
                      readOnly={aiProfilesLocked}
                      placeholder="YouTube Metadata Balanced"
                    />
                  </label>

                  <label className="editor-field">
                    <span>Description</span>
                    <input
                      className={`editor-input${aiProfilesLocked ? " read-only-field" : ""}`}
                      value={profile.description}
                      onChange={(event) =>
                        handleUpdateAiProfile(profile.id, { description: event.target.value })
                      }
                      readOnly={aiProfilesLocked}
                      placeholder="What this worker is best at"
                    />
                  </label>

                  <div className="connection-fields">
                    <label className="editor-field">
                      <span>Task</span>
                      {profile.builtIn || aiProfilesLocked ? (
                        <input
                          className="editor-input read-only-field"
                          value={
                            getAiProfileTaskDefinition(visibleAiProfileTasks, profile.task)?.label ??
                            formatAiProfileTaskLabel(profile.task)
                          }
                          readOnly
                        />
                      ) : (
                        <select
                          className="editor-input"
                          value={profile.task}
                          onChange={(event) =>
                            handleUpdateAiProfile(profile.id, {
                              task: event.target.value as AiProfileTask
                            })
                          }
                        >
                          {visibleAiProfileTasks.map((taskDefinition) => (
                            <option key={taskDefinition.id} value={taskDefinition.id}>
                              {taskDefinition.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    <label className="editor-field">
                      <span>Preferred model</span>
                      {aiProfilesLocked ? (
                        <input
                          className="editor-input read-only-field"
                          value={
                            profile.preferredModel
                              ? availableLocalAiModels.find((model) => model.id === profile.preferredModel)?.compatibilityLabel ??
                                availableLocalAiModels.find((model) => model.id === profile.preferredModel)?.label ??
                                profile.preferredModel
                              : "Auto-select recommended runtime model"
                          }
                          readOnly
                        />
                      ) : (
                        <select
                          className="editor-input"
                          value={resolveAiProfilePreferredModelSelectValue(profile, availableLocalAiModels)}
                          onChange={(event) =>
                            handleUpdateAiProfile(profile.id, {
                              preferredModel:
                                event.target.value.startsWith("legacy:")
                                  ? profile.preferredModel ?? ""
                                  : event.target.value
                            })
                          }
                        >
                          <option value="">Auto-select recommended runtime model</option>
                          {profile.preferredModel &&
                          !availableLocalAiModels.some((model) => model.id === profile.preferredModel) ? (
                            <option value={`legacy:${profile.preferredModel}`}>
                              Saved model not currently imported: {profile.preferredModel}
                            </option>
                          ) : null}
                          {availableLocalAiModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {formatAiModelOptionLabel(model)}
                            </option>
                          ))}
                        </select>
                      )}
                      <span className="detail-meta">
                        {availableLocalAiModels.length > 0
                          ? "Model choices come from the app-owned GGUF library above."
                          : "No local AI models are imported yet. Use Import GGUF Model above to populate this dropdown."}
                      </span>
                  </label>
                </div>

                  {profile.task === "youtube_metadata" ? (
                    <div className="info-banner speaker-context-profile-setting">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={profile.speakerContextSettings?.enabled !== false}
                          onChange={(event) =>
                            handleUpdateAiProfile(profile.id, {
                              speakerContextSettings: {
                                enabled: event.target.checked,
                                warnWhenStreamerUnidentified:
                                  profile.speakerContextSettings?.warnWhenStreamerUnidentified !== false
                              }
                            })
                          }
                          disabled={aiProfilesLocked}
                        />
                        Use speaker context when available
                        <InfoTip label="About speaker context">
                          Trusted streamer and collaborator labels can shape wording. Unknown speech stays neutral and is never assigned by the metadata worker.
                        </InfoTip>
                      </label>
                    </div>
                  ) : null}

                  <label className="editor-field">
                    <span>Worker instructions</span>
                    <textarea
                      className={`editor-textarea${aiProfilesLocked ? " read-only-field" : ""}`}
                      value={profile.systemPrompt}
                      onChange={(event) =>
                        handleUpdateAiProfile(profile.id, { systemPrompt: event.target.value })
                      }
                      readOnly={aiProfilesLocked}
                      placeholder={
                        profile.task === "youtube_thumbnail"
                            ? "Add instructions this worker should follow when reviewing thumbnail frames."
                          : "Add instructions this worker should follow when packaging YouTube metadata."
                      }
                    />
                  </label>

                  <section className="profile-learning-panel">
                    <div className="collaborator-profile-header">
                      <div className="speaker-profile-title">
                        <h4>Learning and task knowledge</h4>
                      </div>
                      <span className="tool-status available">AI-agnostic</span>
                    </div>
                    <p className="detail-meta">
                      These rules and notes are supplied to whichever compatible model is selected for this profile.
                      They change prompt context, not model files or weights.
                    </p>

                    <div className="connection-fields">
                      <label className="editor-field">
                        <span>Learning mode</span>
                        <select
                          className="editor-input"
                          value={profile.learningSettings.mode}
                          onChange={(event) =>
                            handleUpdateAiProfileLearningSettings(profile.id, {
                              mode: event.target.value as AiProfileLearningMode
                            })
                          }
                          disabled={aiProfilesLocked}
                        >
                          <option value="off">Off</option>
                          <option value="retrieval">Knowledge and selected examples</option>
                          <option value="adaptive_prompt">Adaptive prompt from feedback</option>
                        </select>
                      </label>
                      <label className="editor-field">
                        <span>Maximum task knowledge entries</span>
                        <input
                          className="editor-input"
                          type="number"
                          min="0"
                          max="50"
                          value={profile.learningSettings.maxKnowledgeEntries}
                          onChange={(event) =>
                            handleUpdateAiProfileLearningSettings(profile.id, {
                              maxKnowledgeEntries: Number(event.target.value)
                            })
                          }
                          disabled={aiProfilesLocked}
                        />
                      </label>
                    </div>

                    <div className="detail-actions profile-learning-toggles">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={profile.learningSettings.includeApprovedExamples}
                          onChange={(event) =>
                            handleUpdateAiProfileLearningSettings(profile.id, {
                              includeApprovedExamples: event.target.checked
                            })
                          }
                          disabled={aiProfilesLocked}
                        />
                        Use approved examples
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={profile.learningSettings.includeHighPerformingExamples}
                          onChange={(event) =>
                            handleUpdateAiProfileLearningSettings(profile.id, {
                              includeHighPerformingExamples: event.target.checked
                            })
                          }
                          disabled={aiProfilesLocked}
                        />
                        Use high-performing examples
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={profile.learningSettings.includeRejectedExamples}
                          onChange={(event) =>
                            handleUpdateAiProfileLearningSettings(profile.id, {
                              includeRejectedExamples: event.target.checked
                            })
                          }
                          disabled={aiProfilesLocked}
                        />
                        Use rejected examples as warnings
                      </label>
                    </div>

                    <p className="detail-meta">
                      Adaptive prompt mode currently derives guidance from saved feedback and review decisions. It does not fine-tune models or change model weights.
                    </p>

                    <div className="profile-knowledge-list">
                      <div className="collaborator-profile-header">
                        <div className="speaker-profile-title">
                          <h4>Profile knowledge</h4>
                        </div>
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          onClick={() => handleAddAiProfileKnowledge(profile.id)}
                          disabled={aiProfilesLocked || profile.knowledgeEntries.length >= 50}
                        >
                          Add knowledge
                        </button>
                      </div>
                      {profile.knowledgeEntries.length === 0 ? (
                        <p className="detail-meta">No saved task knowledge yet. Add durable facts, preferences, examples, or rules for this worker.</p>
                      ) : (
                        profile.knowledgeEntries.map((entry) => (
                          <div key={entry.id} className="profile-knowledge-entry">
                            <div className="detail-actions">
                              <input
                                className={`editor-input${aiProfilesLocked ? " read-only-field" : ""}`}
                                value={entry.title}
                                onChange={(event) =>
                                  handleUpdateAiProfileKnowledge(profile.id, entry.id, { title: event.target.value })
                                }
                                readOnly={aiProfilesLocked}
                                placeholder="Knowledge title"
                              />
                              <button
                                type="button"
                                className="secondary-button compact-button"
                                onClick={() => handleRemoveAiProfileKnowledge(profile.id, entry.id)}
                                disabled={aiProfilesLocked}
                              >
                                Remove
                              </button>
                            </div>
                            <textarea
                              className={`editor-textarea${aiProfilesLocked ? " read-only-field" : ""}`}
                              value={entry.content}
                              onChange={(event) =>
                                handleUpdateAiProfileKnowledge(profile.id, entry.id, { content: event.target.value })
                              }
                              readOnly={aiProfilesLocked}
                              placeholder="For example: Keep descriptions concise and mention the game title in the first line."
                            />
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={entry.enabled}
                                onChange={(event) =>
                                  handleUpdateAiProfileKnowledge(profile.id, entry.id, { enabled: event.target.checked })
                                }
                                disabled={aiProfilesLocked}
                              />
                              Include this knowledge
                            </label>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <label className="editor-field">
                    <span>Enabled</span>
                    <input
                      type="checkbox"
                      checked={profile.enabled}
                      onChange={(event) =>
                        handleUpdateAiProfile(profile.id, { enabled: event.target.checked })
                      }
                      disabled={aiProfilesLocked}
                    />
                  </label>

                  <p className="detail-meta">
                    {profile.builtIn
                      ? "Built-in starter profile. You can edit it, but it stays in the profile library."
                      : "Custom profile. Use this for specialized packaging behavior or experiments."}
                  </p>
                </section>
              ))}
                </div>
              </div>
            </div>

            <div className="connection-actions">
              {aiProfilesLocked ? (
                <button type="button" className="secondary-button" onClick={() => setEditingAiProfiles(true)}>
                  Edit
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleAddAiProfile}
                    disabled={savingAiProfiles}
                  >
                    Add Custom Profile
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleSaveAiProfiles()}
                    disabled={savingAiProfiles}
                  >
                    {savingAiProfiles ? "Saving..." : "Save AI Profiles"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleCancelAiProfileEdits}
                    disabled={savingAiProfiles}
                  >
                    Cancel
                  </button>
                </>
              )}
           </div>
          </section>
          </div>
        </>
      ) : isReviewView ? (
        <div className="make-clips-workspace">
          <ReviewClipView
            id="review-clip-workspace"
            selectedClip={reviewClip}
            selectedTranscript={reviewTranscript}
            transcriptAsset={reviewTranscript ? {
              assetType: reviewTranscript.assetType,
              assetId: reviewTranscript.assetId
            } satisfies TranscriptAssetRef : null}
            transcriptLoading={selectedLongFormSource ? transcribingLongFormSource : transcriptLoading}
            onRerunTranscription={selectedLongFormSource
              ? () => void handleTranscribeLongFormSource()
              : selectedClip
                ? () => void handleTranscribeSelectedClip()
                : undefined}
            rerunTranscriptionBusy={selectedLongFormSource ? transcribingLongFormSource : transcribingClipId === selectedClip?.id}
            onEditingChange={setEditingTranscript}
            onSavingChange={setSavingTranscript}
            initialTrimRange={selectedLongFormProposal ? {
              startMs: selectedLongFormProposal.startMs,
              endMs: selectedLongFormProposal.endMs
            } : null}
            rightColumnTopContent={
              <LongFormProposalPanel
                sources={longFormSources}
                selectedSource={selectedLongFormSource}
                transcript={selectedLongFormTranscript}
                proposals={longFormProposals}
                selectedProposalId={selectedLongFormProposalId}
                generationResult={longFormProposalResult}
                importing={importingLongFormSource}
                transcribing={transcribingLongFormSource}
                generating={generatingLongFormProposals}
                cancellingGeneration={cancellingLongFormProposals}
                generationMessage={longFormProposalMessage}
                transcriptionProgress={longFormTranscriptionProgress}
                recoveringPartial={recoveringLongFormPartial}
                onImport={() => void handleImportLongFormSource()}
                onSelectSource={(sourceId) => {
                  setSelectedLongFormSourceId(sourceId || null);
                  setSelectedLongFormProposalId(null);
                }}
                onGenerate={() => void handleGenerateLongFormProposals()}
                onCancelGeneration={() => void handleCancelLongFormProposals()}
                onCancelTranscription={() => void handleCancelLongFormTranscription()}
                onSavePartial={() => void handleSaveLongFormPartial()}
                onDiscardPartial={() => void handleDiscardLongFormPartial()}
                onOpenProposal={handleOpenLongFormProposal}
              />
            }
            proposal={selectedLongFormProposal}
            clipLibraryConfigured={Boolean(appInfo?.clipLibraryFolder)}
            proposalActionBusy={Boolean(longFormProposalActionId)}
            onApproveProposal={selectedLongFormProposal ? handleApproveLongFormProposal : undefined}
            onRejectProposal={selectedLongFormProposal ? handleRejectLongFormProposal : undefined}
            onReopenProposal={selectedLongFormProposal ? handleReopenLongFormProposal : undefined}
            collaboratorProfiles={savedCollaboratorProfiles}
            creatorVoiceSampleCount={savedCreatorVoiceSamples.length}
            onAutoAssignSpeakers={(scope) => void handleAutoAssignTranscriptSpeakers(scope)}
            onSaveCreatorVoiceSample={(segment) => void handleCaptureCreatorVoiceSample(segment)}
            onSaveCollaboratorVoiceSample={(profileId, segment) => void handleCaptureCollaboratorVoiceSample(profileId, segment)}
            onTranscriptSaved={selectedLongFormSource ? setSelectedLongFormTranscript : setSelectedTranscript}
            onExportTrimmedCopy={selectedLongFormSource
              ? (startMs, endMs) => window.creatorApp.exportTrimmedLongFormSource(selectedLongFormSource.id, startMs, endMs)
              : undefined}
            onExportStackedVerticalCopy={selectedLongFormSource
              ? (startMs, endMs, layout) => window.creatorApp.exportStackedVerticalLongFormSource(selectedLongFormSource.id, startMs, endMs, layout)
              : undefined}
            onOpenWorkspace={() => {
              setSelectedLongFormSourceId(null);
              setSelectedLongFormProposalId(null);
              setActiveView("workspace");
            }}
          />
        </div>
      ) : isPerformanceView ? (
        <PerformanceDashboardView
          dashboard={performanceDashboard}
          filters={performanceFilters}
          loading={performanceLoading}
          refreshing={refreshingPerformanceDashboard}
          importingHistory={importingPerformanceHistory}
          message={performanceMessage}
          performanceCoachBusy={generatingPerformanceCoach}
          performanceCoachResult={performanceCoachResult}
          activePerformanceCoachProfileLabel={activePerformanceCoachAiProfile?.name ?? null}
          selectedVideoDetail={performanceVideoDetail}
          selectedVideoDetailLoading={performanceVideoDetailLoading}
          selectedVideoDetailError={performanceVideoDetailError}
          youtubeConnection={youtubeConnection}
          youtubeRefreshablePostCount={youtubeRefreshablePostCount}
          onFilterChange={handlePerformanceFilterChange}
          onRefresh={(textOverrides) => void refreshPerformanceDashboardData(textOverrides)}
          onImportHistory={(publishedAfter) => void handleImportYouTubeHistoricalPerformance(publishedAfter)}
          onGeneratePerformanceCoach={(focus, videoId) => void handleGeneratePerformanceCoach(focus, videoId)}
          onCoachAction={handlePerformanceCoachAction}
          onOpenPerformanceVideo={(videoId) => void handleOpenPerformanceVideo(videoId)}
          onClosePerformanceVideoDetail={handleClosePerformanceVideoDetail}
          onOpenSettings={() => setActiveView("settings")}
          onOpenWorkspace={() => setActiveView("workspace")}
        />
      ) : (
        <div className={`workspace-content${selectedClip ? " has-selected-clip" : ""}`}>
          {selectedClip ? (
            <section className="panel workflow-context-card" id="selected-clip-context">
              <div className="panel-header">
                <h2>Selected clip</h2>
                <span className="status-dot" />
              </div>
              <strong className="workflow-context-title">{selectedClip.displayName}</strong>
              <div className="workflow-check-list">
                <span className={selectedTranscript ? "complete" : "pending"}>{selectedTranscript ? "Ready" : "Next"} Transcript</span>
                <span className={selectedMetadata ? "complete" : "pending"}>{selectedMetadata ? "Ready" : "Next"} Metadata</span>
                <span className={selectedClipSchedulePosts.length > 0 ? "complete" : "pending"}>{selectedClipSchedulePosts.length > 0 ? "Ready" : "Next"} Schedule</span>
              </div>
            </section>
          ) : null}

          <section className="panel" id="clip-library">
            <div className="panel-header">
              <div>
                <div className="title-with-tip"><h2>Clip Library</h2><InfoTip label="Clip library settings">Folder selection, index cleanup, and source storage are managed in Settings. The workspace keeps this view focused on your clips.</InfoTip></div>
                <p className="muted">
                  Select a clip to run transcription and inspect the saved transcript. If a clip library folder
                  is configured, importing will sync supported videos from that folder only.
                </p>
              </div>
              <div className="panel-header-actions">
                <div className="index-inline-stat"><strong>{workspaceIndexStatus?.indexedClipCount ?? clips.length}</strong><span>indexed</span><InfoTip label="Index status">{workspaceIndexStatus?.lastActivitySummary ?? "No indexing activity has been recorded yet."}{workspaceIndexStatus?.lastActivityAt ? ` Last activity: ${formatTimestamp(workspaceIndexStatus.lastActivityAt)}.` : ""}</InfoTip></div>
                <button type="button" className="icon-button panel-settings-button" onClick={() => setActiveView("settings")} aria-label="Open clip library settings" title="Open clip library settings">S</button>
              </div>
            </div>

            {loading ? (
              <p className="muted">Loading clips...</p>
            ) : clips.length === 0 ? (
              <div className="empty-state">
                <h3>No clips imported yet</h3>
                <p>Import a batch of existing clips to start building the local posting backlog.</p>
              </div>
            ) : (
              <>
                <div className="clip-library-filters">
                  <div className="queued-posts-tabs clip-library-tabs" role="tablist" aria-label="Clip library status">
                    {CLIP_LIBRARY_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        className={`queued-posts-tab${clipLibraryFilter === filter.id ? " active" : ""}`}
                        role="tab"
                        aria-selected={clipLibraryFilter === filter.id}
                        aria-controls="clip-library-tabpanel"
                        tabIndex={clipLibraryFilter === filter.id ? 0 : -1}
                        onClick={() => handleClipLibraryFilterChange(filter.id)}
                      >
                        {filter.label}
                        <span className="queued-posts-tab-count">{clipLibraryCounts[filter.id]}</span>
                      </button>
                    ))}
                  </div>
                  <label className="clip-library-search">
                    <span className="sr-only">Search clip library</span>
                    <input
                      type="search"
                      className="editor-input"
                      value={clipLibrarySearch}
                      onChange={(event) => setClipLibrarySearch(event.target.value)}
                      placeholder="Search clip names or file paths"
                      aria-label="Search clip library"
                    />
                  </label>
                </div>
                <div id="clip-library-tabpanel" role="tabpanel" className="clip-library-tabpanel">
                  {visibleClipLibraryClips.length === 0 ? (
                    <div className="empty-state clip-library-filter-empty">
                      <h3>No matching clips</h3>
                      <p>Try a different status or search term.</p>
                      <button type="button" className="secondary-button" onClick={clearClipLibraryFilters}>Clear filters</button>
                    </div>
                  ) : (
                    <div className="clip-table">
                      <div className="clip-table-row clip-table-head">
                        <span>Name</span>
                        <span>Duration</span>
                        <span>Resolution</span>
                        <span>Size</span>
                        <span>Status</span>
                        <span>Inspection</span>
                        <span>Transcript</span>
                      </div>
                      {visibleClipLibraryClips.map((clip) => (
                        <div
                          key={clip.id}
                          className={`clip-table-row clip-table-item${clip.id === selectedClipId ? " selected" : ""}`}
                        >
                          <button
                            type="button"
                            className="clip-table-button"
                            onClick={() => handleSelectClip(clip.id)}
                          >
                            <span className="clip-name">{clip.displayName}</span>
                            <span>{formatDuration(clip.durationMs)}</span>
                            <span>{clip.widthPx && clip.heightPx ? `${clip.widthPx}x${clip.heightPx}` : "Unknown"}</span>
                            <span>{formatBytes(clip.fileSizeBytes)}</span>
                            <ClipLibraryStatusPill clip={clip} scheduledPosts={scheduledPosts} />
                            <span>{clip.inspectionStatus}</span>
                            <span>{clip.status === "transcribed" ? "Saved" : "Pending"}</span>
                          </button>
                          <button
                            type="button"
                            className="clip-remove-button"
                            onClick={() => requestClipDataRemoval(clip)}
                            disabled={cleanupBusy || removingClipId !== null}
                            aria-label={`Delete all app data for ${clip.displayName}`}
                            title="Delete this clip's app data"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="workflow-next-rail" aria-label="Edit workflow status">
            <section className="panel workflow-next-panel">
              <div className="panel-header">
                <div className="title-with-tip">
                  <h2>Next action</h2>
                  <InfoTip label="Next action">This action is derived from the selected clip's real transcript, metadata, and scheduling state.</InfoTip>
                </div>
                <span className="panel-badge">{selectedClip ? "Selected" : "Start here"}</span>
              </div>
              <h3>{!selectedClip ? "Import content" : !selectedTranscript ? "Prepare transcript" : !selectedMetadata ? "Generate metadata" : selectedClipSchedulePosts.length === 0 ? "Schedule your package" : "Review performance"}</h3>
              <p className="muted">{!selectedClip ? "Bring clips into the local workspace." : !selectedTranscript ? "Transcribe locally before editing or packaging this clip." : !selectedMetadata ? "Generate title, description, and tag candidates as one reviewable package." : selectedClipSchedulePosts.length === 0 ? "Save the package before creating a scheduled post." : "Refresh owned performance or review current channel evidence."}</p>
              <button
                type="button"
                className="primary-button full-width-button"
                onClick={
                  !selectedClip
                    ? () => void handleImportClips()
                    : !selectedTranscript
                      ? () => void handleTranscribeSelectedClip()
                      : !selectedMetadata
                        ? handleGenerateMetadataFromNextAction
                        : handleNextWorkspaceAction
                }
                disabled={loading || importing || transcribingClipId !== null || generatingMetadata}
              >
                {generatingMetadata
                  ? "Generating metadata..."
                  : !selectedClip
                    ? "Import clips"
                    : !selectedTranscript
                      ? "Prepare transcript"
                      : !selectedMetadata
                        ? "Generate metadata"
                        : selectedClipSchedulePosts.length === 0
                          ? "Open scheduling"
                          : "Open Performance"}
              </button>
            </section>
            {selectedClip ? (
              <TimestampedTranscriptPanel
                clipId={selectedClip.id}
                selectedTranscript={selectedTranscript}
                transcriptLoading={transcriptLoading}
                currentTimeSeconds={selectedClipPlaybackTime}
                onSeekToSeconds={(seconds) => setTranscriptSeekRequest((current) => ({ seconds, nonce: (current?.nonce ?? 0) + 1 }))}
                onTranscriptSaved={setSelectedTranscript}
                onRerunTranscription={() => void handleTranscribeSelectedClip()}
                rerunTranscriptionBusy={transcribingClipId === selectedClip.id}
                onExportSrt={() => void handleExportSelectedTranscript()}
                exportSrtBusy={exportingClipId === selectedClip.id}
                onEditingChange={setEditingTranscript}
                onSavingChange={setSavingTranscript}
                collaboratorProfiles={savedCollaboratorProfiles}
                creatorVoiceSampleCount={savedCreatorVoiceSamples.length}
                onAutoAssignSpeakers={(scope) => void handleAutoAssignTranscriptSpeakers(scope)}
                onSaveCreatorVoiceSample={(segment) => void handleCaptureCreatorVoiceSample(segment)}
                onSaveCollaboratorVoiceSample={(profileId, segment) => void handleCaptureCollaboratorVoiceSample(profileId, segment)}
                openSpeakerReviewRequest={speakerReviewOpenRequest}
              />
            ) : null}
          </aside>

          <section className={`panel${selectedClip ? " review-video-panel" : ""}`} id="transcript-workspace">
            {!selectedClip ? (
              <>
                <div className="panel-header">
                  <div className="title-with-tip">
                    <h2>Video Player</h2>
                    <InfoTip label="About the video player">
                      Run local transcription through ffmpeg and whisper.cpp, then review or correct the saved transcript before exporting SRT.
                    </InfoTip>
                  </div>
                </div>
                <div className="empty-state">
                  <h3>No clip selected</h3>
                  <p>Choose a clip from the library to configure transcription, inspect the transcript, or export SRT.</p>
                </div>
              </>
            ) : (
              <>
                <div className="panel-header">
                  <div>
                    <h3>{selectedClip.displayName}</h3>
                    <p className="detail-meta">Original source. Playback is read-only; exports create a new file.</p>
                  </div>
                  <span className="panel-badge">
                    {formatPlaybackTime(selectedClipPlaybackTime)} / {formatPlaybackTime(selectedClipPlaybackDuration || (selectedClip.durationMs ?? 0) / 1000)}
                  </span>
                </div>
                <VideoPlayer
                  key={selectedClip.id}
                  displayName={selectedClip.displayName}
                  sourcePath={selectedClip.sourcePath}
                  durationMs={selectedClip.durationMs}
                  widthPx={selectedClip.widthPx}
                  heightPx={selectedClip.heightPx}
                  frameRate={selectedClip.frameRate}
                  defaultPreviewMode="source"
                  onTimeChange={setSelectedClipPlaybackTime}
                  onDurationChange={setSelectedClipPlaybackDuration}
                  seekRequest={transcriptSeekRequest}
                />
                <p className="detail-meta review-source-path">Source: {selectedClip.sourcePath}</p>

                {false ? (
                <section className="detail-card transcript-card">
                  <div className="transcript-card-header">
                    <div>
                      <h3>Transcript</h3>
                      <p className="muted">
                        {selectedTranscript
                          ? `Saved ${formatTimestamp(selectedTranscript!.updatedAt)}`
                          : "No transcript has been generated for this clip yet."}
                      </p>
                    </div>
                    {selectedTranscript ? (
                      editingTranscript ? (
                        <div className="transcript-editor-actions">
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={handleCancelTranscriptEdits}
                            disabled={savingTranscript}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="primary-button compact-button"
                            onClick={() => void handleSaveTranscriptEdits()}
                            disabled={savingTranscript}
                          >
                            {savingTranscript ? "Saving..." : "Save Edits"}
                          </button>
                        </div>
                      ) : (
                        <div className="transcript-toolbar">
                          <div className="view-toggle">
                            <button
                              type="button"
                              className={`toggle-button${transcriptView === "text" ? " active" : ""}`}
                              onClick={() => setTranscriptView("text")}
                            >
                              Text
                            </button>
                            <button
                              type="button"
                              className={`toggle-button${transcriptView === "srt" ? " active" : ""}`}
                              onClick={() => setTranscriptView("srt")}
                            >
                              SRT
                            </button>
                            <button
                              type="button"
                              className={`toggle-button${transcriptView === "speakers" ? " active" : ""}`}
                              onClick={() => setTranscriptView("speakers")}
                            >
                              Speakers
                            </button>
                          </div>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => {
                              setTranscriptView("text");
                              setEditingTranscript(true);
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      )
                    ) : null}
                  </div>

                  {transcriptLoading ? (
                    <p className="muted">Loading transcript...</p>
                  ) : selectedTranscript ? (
                    editingTranscript ? (
                      <>
                        {transcriptMessage ? (
                          <div className="info-banner success-banner">
                            <strong>Transcript update</strong>
                            <p className="muted">{transcriptMessage}</p>
                          </div>
                        ) : null}
                        <p className="detail-meta">
                          Edits are saved locally and will be used for future SRT exports. Speaker colors stay in the
                          workspace review layer for now, while plain SRT export remains compatibility-first.
                        </p>
                        <div className="transcript-toolbar">
                          <div className="view-toggle">
                            <button
                              type="button"
                              className={`toggle-button${transcriptView === "text" ? " active" : ""}`}
                              onClick={() => setTranscriptView("text")}
                            >
                              Text
                            </button>
                            <button
                              type="button"
                              className={`toggle-button${transcriptView === "srt" ? " active" : ""}`}
                              onClick={() => setTranscriptView("srt")}
                            >
                              SRT
                            </button>
                            <button
                              type="button"
                              className={`toggle-button${transcriptView === "speakers" ? " active" : ""}`}
                              onClick={() => setTranscriptView("speakers")}
                            >
                              Speakers
                            </button>
                          </div>
                        </div>
                        {transcriptView !== "speakers" ? (
                          <div className="transcript-editor-grid">
                            <label className="editor-field">
                              <span>Transcript text</span>
                              <textarea
                                className="editor-textarea"
                                value={draftTranscriptText}
                                onChange={(event) => setDraftTranscriptText(event.target.value)}
                              />
                            </label>
                            <label className="editor-field">
                              <span>SRT content</span>
                              <textarea
                                className="editor-textarea editor-textarea-mono"
                                value={draftTranscriptSrt}
                                onChange={(event) => setDraftTranscriptSrt(event.target.value)}
                              />
                            </label>
                          </div>
                        ) : null}
                        <div className="transcript-speaker-editor">
                          <div className="field-header">
                            <div>
                              <h4>Speaker Segments</h4>
                              <p className="muted">
                                Assign each subtitle segment to `You` or one of your saved collaborator profiles. This
                                is the review layer that future voice-reference matching will build on later.
                              </p>
                            </div>
                            <div className="view-toggle">
                              <button
                                type="button"
                                className={`toggle-button${speakerReviewFilter === "all" ? " active" : ""}`}
                                onClick={() => setSpeakerReviewFilter("all")}
                              >
                                All
                              </button>
                              <button
                                type="button"
                                className={`toggle-button${speakerReviewFilter === "needs_review" ? " active" : ""}`}
                                onClick={() => setSpeakerReviewFilter("needs_review")}
                              >
                                Needs Review
                              </button>
                              <button
                                type="button"
                                className={`toggle-button${speakerReviewFilter === "unassigned" ? " active" : ""}`}
                                onClick={() => setSpeakerReviewFilter("unassigned")}
                              >
                                Unassigned
                              </button>
                            </div>
                          </div>
                          {filteredDraftTranscriptSegments.length > 0 ? (
                            <div className="speaker-segment-list">
                              {filteredDraftTranscriptSegments.map((segment) => {
                                const color = getSpeakerColor(segment.speakerId, collaboratorProfilesById);
                                const reviewDetails = getSpeakerReviewDetails(
                                  segment,
                                  collaboratorProfilesById
                                );

                                return (
                                  <article
                                    key={segment.id}
                                    className="speaker-segment-card"
                                    style={{ borderLeftColor: color }}
                                  >
                                    <div className="speaker-segment-header">
                                      <span className="speaker-segment-time">
                                        {formatSegmentTime(segment.startMs)} - {formatSegmentTime(segment.endMs)}
                                      </span>
                                      <div className="speaker-segment-meta">
                                        <span className={getSpeakerAssignmentBadgeClassName(segment)}>
                                          {getSpeakerAssignmentLabel(segment)}
                                        </span>
                                        <div className="speaker-segment-speaker">
                                          <span
                                            className="speaker-color-chip"
                                            style={{ backgroundColor: color }}
                                          />
                                          <select
                                            className="editor-input speaker-select"
                                            value={segment.speakerId ?? ""}
                                            onChange={(event) =>
                                              handleAssignSpeakerToSegment(segment.id, event.target.value)
                                            }
                                          >
                                            <option value="">Unassigned</option>
                                            <option value={CREATOR_SPEAKER_ID}>{CREATOR_SPEAKER_LABEL}</option>
                                            {savedCollaboratorProfiles.map((profile) => (
                                              <option key={profile.id} value={profile.id}>
                                                {profile.displayName || "Unnamed collaborator"}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>
                                    </div>
                                      {segment.speakerId === CREATOR_SPEAKER_ID ? (
                                        <div className="speaker-segment-actions">
                                          <button
                                            type="button"
                                            className="secondary-button compact-button"
                                            onClick={() => void handleCaptureCreatorVoiceSample(segment)}
                                            disabled={
                                              capturingVoiceSampleKey === `${CREATOR_SPEAKER_ID}:${segment.id}`
                                            }
                                          >
                                            {capturingVoiceSampleKey === `${CREATOR_SPEAKER_ID}:${segment.id}`
                                              ? "Saving sample..."
                                              : "Save My Voice Sample"}
                                          </button>
                                          <span className="detail-meta">
                                            Save a few clean lines for yourself so auto-assign can detect `You`.
                                          </span>
                                        </div>
                                      ) : segment.speakerId ? (
                                        <div className="speaker-segment-actions">
                                          <button
                                            type="button"
                                            className="secondary-button compact-button"
                                            onClick={() =>
                                              void handleCaptureCollaboratorVoiceSample(
                                                segment.speakerId!,
                                                segment
                                              )
                                            }
                                            disabled={
                                              capturingVoiceSampleKey === `${segment.speakerId}:${segment.id}`
                                            }
                                          >
                                            {capturingVoiceSampleKey === `${segment.speakerId}:${segment.id}`
                                              ? "Saving sample..."
                                              : "Save Voice Sample"}
                                          </button>
                                          <span className="detail-meta">
                                            Save a few clean lines for repeat collaborators, then use auto-assign from
                                            the Speakers view.
                                          </span>
                                        </div>
                                      ) : (
                                        <p className="detail-meta">
                                          Pick a collaborator above if you want to save this segment as a reusable
                                          voice sample.
                                        </p>
                                      )}
                                      <p className="speaker-segment-text">{segment.text}</p>
                                      {reviewDetails.reason || reviewDetails.alternate ? (
                                        <div className="speaker-review-notes">
                                          {reviewDetails.reason ? (
                                            <p className="speaker-review-note">{reviewDetails.reason}</p>
                                          ) : null}
                                          {reviewDetails.alternate ? (
                                            <p className="speaker-review-note alternate">
                                              {reviewDetails.alternate}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </article>
                                  );
                                })}
                              </div>
                          ) : (
                            <p className="muted">
                              {draftTranscriptSegments.length === 0
                                ? "No subtitle segments were parsed from the current SRT yet. If you edit the SRT content below, segment cards will rebuild automatically."
                                : "No transcript segments match the current review filter."}
                            </p>
                          )}
                        </div>
                        {transcriptView === "speakers" ? (
                          <div className="transcript-editor-grid">
                            <label className="editor-field">
                              <span>Transcript text</span>
                              <textarea
                                className="editor-textarea"
                                value={draftTranscriptText}
                                onChange={(event) => setDraftTranscriptText(event.target.value)}
                              />
                            </label>
                            <label className="editor-field">
                              <span>SRT content</span>
                              <textarea
                                className="editor-textarea editor-textarea-mono"
                                value={draftTranscriptSrt}
                                onChange={(event) => setDraftTranscriptSrt(event.target.value)}
                              />
                            </label>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <p className="detail-meta">Model: {selectedTranscript!.modelPath}</p>
                        {transcriptView === "speakers" ? (
                          <>
                            {transcriptMessage ? (
                              <div className="info-banner success-banner">
                                <strong>Transcript update</strong>
                                <p className="muted">{transcriptMessage}</p>
                              </div>
                            ) : null}
                            <p className="detail-meta">
                              Color-coded speaker review stays in the app and future rendered captions. Plain SRT
                              exports remain unstyled for compatibility.
                            </p>
                            <div className="transcript-inline-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => void handleAutoAssignTranscriptSpeakers()}
                                disabled={autoAssigningSpeakers || !hasAnyVoiceSamples}
                              >
                                {autoAssigningSpeakers ? "Auto-Assigning..." : "Auto-Assign From Voice Samples"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => void handleAutoAssignTranscriptSpeakers("needs_review")}
                                disabled={autoAssigningSpeakers || !hasAnyVoiceSamples || lowConfidenceSegmentCount === 0}
                              >
                                {autoAssigningSpeakers ? "Rechecking..." : "Rerun Needs Review Only"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => {
                                  setSpeakerReviewFilter("needs_review");
                                  setTranscriptView("speakers");
                                  setEditingTranscript(true);
                                }}
                                disabled={lowConfidenceSegmentCount === 0}
                              >
                                Review Low-Confidence Only
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => {
                                  setTranscriptView("speakers");
                                  setEditingTranscript(true);
                                }}
                              >
                                Edit Speaker Assignments
                              </button>
                            </div>
                            <p className="detail-meta">
                              Scoped reruns only touch auto-matched segments in that scope. Manual speaker labels stay untouched.
                            </p>
                            <div className="view-toggle">
                              <button
                                type="button"
                                className={`toggle-button${speakerReviewFilter === "all" ? " active" : ""}`}
                                onClick={() => setSpeakerReviewFilter("all")}
                              >
                                All
                              </button>
                              <button
                                type="button"
                                className={`toggle-button${speakerReviewFilter === "needs_review" ? " active" : ""}`}
                                onClick={() => setSpeakerReviewFilter("needs_review")}
                              >
                                Needs Review
                              </button>
                              <button
                                type="button"
                                className={`toggle-button${speakerReviewFilter === "unassigned" ? " active" : ""}`}
                                onClick={() => setSpeakerReviewFilter("unassigned")}
                              >
                                Unassigned
                              </button>
                            </div>
                            {!hasAnyVoiceSamples ? (
                              <p className="detail-meta">
                                Save at least one creator or collaborator voice sample from transcript edit mode before
                                running auto-assign.
                              </p>
                            ) : null}
                            {filteredTranscriptSegments.length > 0 ? (
                              <div className="speaker-segment-list">
                                {filteredTranscriptSegments.map((segment) => {
                                  const color = getSpeakerColor(segment.speakerId, collaboratorProfilesById);
                                  const reviewDetails = getSpeakerReviewDetails(
                                    segment,
                                    collaboratorProfilesById
                                  );

                                  return (
                                    <article
                                      key={segment.id}
                                      className="speaker-segment-card preview"
                                      style={{ borderLeftColor: color }}
                                    >
                                      <div className="speaker-segment-header">
                                        <span className="speaker-segment-time">
                                          {formatSegmentTime(segment.startMs)} - {formatSegmentTime(segment.endMs)}
                                        </span>
                                        <div className="speaker-segment-meta">
                                          <span className={getSpeakerAssignmentBadgeClassName(segment)}>
                                            {getSpeakerAssignmentLabel(segment)}
                                          </span>
                                          <span className="speaker-segment-speaker-label">
                                            <span
                                              className="speaker-color-chip"
                                              style={{ backgroundColor: color }}
                                            />
                                            {getSpeakerName(segment.speakerId, collaboratorProfilesById)}
                                          </span>
                                        </div>
                                      </div>
                                      <p className="speaker-segment-text">{segment.text}</p>
                                      {reviewDetails.reason || reviewDetails.alternate ? (
                                        <div className="speaker-review-notes">
                                          {reviewDetails.reason ? (
                                            <p className="speaker-review-note">{reviewDetails.reason}</p>
                                          ) : null}
                                          {reviewDetails.alternate ? (
                                            <p className="speaker-review-note alternate">
                                              {reviewDetails.alternate}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </article>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="muted">
                                {selectedTranscript!.segments.length === 0
                                  ? "No subtitle segments are available for this transcript yet."
                                  : "No transcript segments match the current review filter."}
                              </p>
                            )}
                          </>
                        ) : (
                          <pre className="transcript-content">
                            {transcriptView === "text"
                              ? selectedTranscript!.textContent
                              : selectedTranscript!.srtContent}
                          </pre>
                        )}
                      </>
                    )
                  ) : (
                    <div className="empty-state compact">
                      <h3>No transcript yet</h3>
                      <p>
                        Once local dependencies are configured, run transcription here and the transcript plus SRT will be stored with the clip.
                      </p>
                    </div>
                  )}
                </section>
                ) : null}
              </>
            )}
          </section>

          <Panel className="panel" id="publishing-metadata">
            <PanelHeader className="panel-header">
              <div>
                <h2>Publishing Metadata</h2>
              </div>
              {selectedClip ? <span className="panel-badge">{selectedClip.displayName}</span> : null}
            </PanelHeader>

            {!selectedClip ? (
              <div className="empty-state">
                <h3>No clip selected</h3>
                <p>Select a clip from the library to prepare its publish metadata.</p>
              </div>
            ) : metadataLoading ? (
              <p className="muted">Loading clip metadata...</p>
            ) : (
              <div className="metadata-workflow">
                <div className="metadata-speaker-context">
                  <SpeakerContextBadge summary={metadataSpeakerContext} compact />
                  {activeMetadataAiProfile?.speakerContextSettings?.enabled === false ? null : (
                    <SpeakerContextWarning
                      summary={metadataSpeakerContext}
                      onReviewSpeakers={() => {
                        setSpeakerReviewOpenRequest((currentRequest) => currentRequest + 1);
                        document.querySelector(".timestamped-transcript-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  )}
                </div>

                {lastMetadataGenerationResult ? (
                  <div className={`info-banner ${getAiExecutionBannerClass(lastMetadataGenerationResult.executionMode)}`}>
                    <strong>
                      {lastMetadataGenerationResult.executionMode === "ai"
                        ? "AI generation completed successfully"
                        : "Attention needed: fallback content was used"}
                    </strong>
                    <p className="muted">{buildMetadataRunSummary(lastMetadataGenerationResult)}</p>
                    {lastMetadataGenerationResult.issueSummary ? (
                      <p className="detail-meta">Issue: {lastMetadataGenerationResult.issueSummary}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="metadata-context-grid">
                  <label className="editor-field">
                    <span>Game title</span>
                    <input
                      list="metadata-game-titles"
                      className="editor-input"
                      value={draftGameTitle}
                      onChange={(event) => setDraftGameTitle(event.target.value)}
                      placeholder="Example: Marvel Rivals"
                    />
                    <datalist id="metadata-game-titles">
                      {metadataGameTitleOptions.map((value) => <option key={value} value={value} />)}
                    </datalist>
                  </label>
                  <label className="editor-field">
                    <span>Series key</span>
                    <input
                      list="metadata-series-keys"
                      className="editor-input"
                      value={draftSeriesKey}
                      onChange={(event) => setDraftSeriesKey(event.target.value)}
                      placeholder="Example: ranked grind"
                    />
                    <datalist id="metadata-series-keys">
                      {metadataSeriesKeyOptions.map((value) => <option key={value} value={value} />)}
                    </datalist>
                  </label>
                </div>

                <div className="info-banner">
                  <div className="title-with-tip">
                    <strong>Featured collaborators</strong>
                    <InfoTip label="About featured collaborators">
                      Select any saved co-op partners who appear in this clip. Use “Insert Saved Links” in the Final
                      Package section when you want to add the reusable featuring and profile-link blocks.
                      If a collaborator only has a name saved, the description will still include them in the
                      “Featuring:” line.
                    </InfoTip>
                  </div>
                  {collaboratorProfilesConfigured ? (
                    <>
                      <div className="collaborator-selection-list">
                        {savedCollaboratorProfiles.map((profile) => (
                          <label key={profile.id} className="collaborator-selection-item">
                            <input
                              type="checkbox"
                              checked={draftCollaboratorProfileIds.includes(profile.id)}
                              onChange={(event) =>
                                handleToggleCollaboratorProfileSelection(profile.id, event.target.checked)
                              }
                            />
                            <span>{profile.displayName || "Unnamed collaborator"}</span>
                            <span className="detail-meta collaborator-selection-meta">
                              {hasAnyCreatorProfileLinks(profile.profileLinks) ? "Links saved" : "Name only"}
                            </span>
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted">
                      No collaborator profiles are saved yet. Add them in Settings if you want reusable co-op partner
                      blocks.
                    </p>
                  )}
                </div>

                <div className="detail-actions">
                  <span className="detail-meta">
                    {metadataMessage
                      ? metadataMessage
                      : selectedMetadata
                        ? `Saved ${formatTimestamp(selectedMetadata.updatedAt)}`
                        : "No metadata package saved for this clip yet."}
                  </span>
                </div>

                <div className="metadata-candidate-grid">
                  <Card className="detail-card">
                    <div className="metadata-section-header">
                      <div>
                        <h3>
                          Title <InfoTip label="About title suggestions">Different angles for packaging the clip's main hook.</InfoTip>
                        </h3>
                      </div>
                      <span className="metadata-option-count">{titleVariants.length} options</span>
                    </div>
                    {titleVariants.length > 0 ? (
                      <div className="metadata-variant-list">{titleVariants.map(renderMetadataVariantCard)}</div>
                    ) : (
                      <p className="muted">Generate metadata to create title suggestions.</p>
                    )}
                    <button
                      type="button"
                      className="metadata-generate-more-button"
                      onClick={() => void handleGenerateMetadataCandidates("title")}
                      disabled={metadataLoading || generatingMetadata || savingMetadata}
                    >
                      {metadataGenerationMode === "title" ? "Generating..." : "✦ Generate more titles"}
                    </button>
                  </Card>

                  <Card className="detail-card">
                    <div className="metadata-section-header">
                      <div>
                        <h3>
                          Description <InfoTip label="About description suggestions">Context-forward and search-forward descriptions for YouTube.</InfoTip>
                        </h3>
                      </div>
                      <span className="metadata-option-count">{descriptionVariants.length} options</span>
                    </div>
                    {descriptionVariants.length > 0 ? (
                      <div className="metadata-variant-list">{descriptionVariants.map(renderMetadataVariantCard)}</div>
                    ) : (
                      <p className="muted">Generate metadata to create description suggestions.</p>
                    )}
                    <button
                      type="button"
                      className="metadata-generate-more-button"
                      onClick={() => void handleGenerateMetadataCandidates("description")}
                      disabled={metadataLoading || generatingMetadata || savingMetadata}
                    >
                      {metadataGenerationMode === "description" ? "Generating..." : "✦ Generate more descriptions"}
                    </button>
                  </Card>

                  <Card className="detail-card">
                    <div className="metadata-section-header">
                      <div>
                        <h3>
                          Tags <InfoTip label="About tag suggestions">One selected set is formatted for both public hashtags and YouTube tags when saved.</InfoTip>
                        </h3>
                      </div>
                      <span className="metadata-option-count">{tagVariants.length} options</span>
                    </div>
                    {tagVariants.length > 0 ? (
                      <div className="metadata-variant-list">
                        {tagVariants.map(renderMetadataVariantCard)}
                      </div>
                    ) : (
                      <p className="muted">Generate metadata to create tag suggestions.</p>
                    )}
                    <button
                      type="button"
                      className="metadata-generate-more-button"
                      onClick={() => void handleGenerateMetadataCandidates("hashtags")}
                      disabled={metadataLoading || generatingMetadata || savingMetadata}
                    >
                      {metadataGenerationMode === "hashtags" ? "Generating..." : "✦ Generate more tags"}
                    </button>
                  </Card>
                </div>

                <div className="metadata-review-grid">
                  <Card className="detail-card">
                    <h3>Final Package</h3>
                    <div className="metadata-editor-grid">
                      <label className="editor-field metadata-editor-wide">
                        <div className="field-header">
                          <span>Title</span>
                          <span className={`metadata-character-count${draftTitle.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH ? " over-limit" : ""}`}>
                            {draftTitle.trim().length}/{YOUTUBE_VIDEO_TITLE_MAX_LENGTH}
                          </span>
                        </div>
                        <input
                          className="editor-input"
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          placeholder="Give this clip a working YouTube Shorts title"
                          maxLength={YOUTUBE_VIDEO_TITLE_MAX_LENGTH}
                          aria-describedby="metadata-title-limit"
                          aria-invalid={draftTitle.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH}
                        />
                        <span id="metadata-title-limit" className={`metadata-title-limit${draftTitle.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH ? " over-limit" : ""}`}>
                          {draftTitle.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH
                            ? `Shorten by ${draftTitle.trim().length - YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters to publish on YouTube.`
                            : `YouTube allows up to ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters.`}
                        </span>
                      </label>
                      <label className="editor-field metadata-editor-wide">
                        <span>Description</span>
                        <textarea
                          className="editor-textarea"
                          value={draftDescription}
                          onChange={(event) => setDraftDescription(event.target.value)}
                          placeholder="Add the YouTube description you want to ship with this clip"
                        />
                      </label>
                      <label className="editor-field metadata-editor-wide">
                        <span>Tags</span>
                        <input
                          className="editor-input editor-textarea-mono"
                          value={draftTagsInput}
                          onChange={(event) => setDraftTagsInput(event.target.value)}
                          placeholder="comma-separated, example: marvelrivals, rankedgrind, shorts"
                        />
                      </label>
                    </div>
                    <p className="detail-meta">
                      One tag list is used for the saved package. Public-facing hashtags and YouTube tags are formatted automatically when it is saved or published.
                    </p>
                    {selectedCollaboratorProfiles.length > 0 ? (
                      <p className="detail-meta">
                        Collaborators selected for this clip:{" "}
                        {selectedCollaboratorProfiles.map((profile) => profile.displayName || "Unnamed collaborator").join(", ")}
                      </p>
                    ) : null}
                    {schedulePlatform === "youtube" ? (
                      <YouTubePlaylistPicker
                        youtubeConnection={youtubeConnection}
                        youtubePlaylists={youtubePlaylists}
                        selectedPlaylistIds={selectedYouTubePlaylistIds}
                        loading={loadingYouTubePlaylists}
                        loaded={youtubePlaylistsLoaded}
                        selectionMessage={youtubePlaylistSelectionMessage}
                        onSelectionChange={setSelectedYouTubePlaylistIds}
                        onRefresh={() => void loadYouTubePlaylists()}
                      />
                    ) : null}
                    <div className="detail-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleInsertSavedProfileLinksIntoDescription}
                        disabled={!canInsertSavedProfileBlocks}
                      >
                        Insert Saved Links
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleSaveClipMetadata()}
                        disabled={savingMetadata || creatingScheduledPost || draftTitle.trim().length === 0 || draftTitle.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH}
                      >
                        {savingMetadata ? "Saving..." : "Save Package"}
                      </button>
                    </div>
                  </Card>

                  <Card className="detail-card">
                    <h3>YouTube Readiness</h3>
                    <div className="metadata-score-card">
                      {metadataScore ? (
                        <div className="metadata-score-summary">
                          <div
                            className="metadata-score-gauge"
                            role="img"
                            aria-label={`YouTube readiness score ${metadataScore.total} out of 100`}
                            style={{
                              background: `conic-gradient(var(--cw-purple-bright) 0deg ${Math.max(0, Math.min(100, metadataScore.total)) * 3.6}deg, rgba(255, 255, 255, 0.1) ${Math.max(0, Math.min(100, metadataScore.total)) * 3.6}deg 360deg)`
                            }}
                          >
                            <span className="metadata-score-gauge-value">
                              <strong>{metadataScore.total}</strong>
                              <small>/100</small>
                            </span>
                          </div>
                          <div className="metadata-score-summary-copy">
                            <strong>{getMetadataReadinessLabel(metadataScore.total)}</strong>
                            <p className="muted">
                              {evaluatingMetadata
                                ? "Re-scoring the current package..."
                                : "Audience/topic fit, packaging clarity, hook strength, payoff timing, context, and hygiene."}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <strong className="metadata-score-empty">No score yet</strong>
                          <p className="muted">Generate or edit a package to populate the readiness panel.</p>
                        </>
                      )}
                    </div>
                    {metadataScore ? (
                      <>
                        <div className="stack-list metadata-score-list">
                          <StatusRow label="Audience/topic fit" value={`${metadataScore.audienceTopicFit}/20`} />
                          <StatusRow label="Packaging clarity" value={`${metadataScore.packagingClarity}/20`} />
                          <StatusRow label="Hook strength" value={`${metadataScore.hookStrength}/20`} />
                          <StatusRow label="Retention/payoff" value={`${metadataScore.retentionPayoff}/15`} />
                          <StatusRow label="Search/context" value={`${metadataScore.searchContextClarity}/10`} />
                          <StatusRow label="Session connection" value={`${metadataScore.sessionConnection}/10`} />
                          <StatusRow label="Metadata hygiene" value={`${metadataScore.metadataHygiene}/5`} />
                        </div>
                        <div className="metadata-warning-block">
                          <h4>Warnings</h4>
                          {metadataScore.warnings.length > 0 ? (
                            <ul className="metadata-list">
                              {metadataScore.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted">No current warnings for this package.</p>
                          )}
                        </div>
                        <div className="metadata-warning-block">
                          <h4>Targeted fixes</h4>
                          {metadataScore.suggestedFixes.length > 0 ? (
                            <ul className="metadata-list">
                              {metadataScore.suggestedFixes.map((fix) => (
                                <li key={fix}>{fix}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted">No targeted fixes suggested right now.</p>
                          )}
                        </div>
                      </>
                    ) : null}

                    <div className="metadata-performance-panel">
                      <div className="field-header">
                        <div>
                          <h4>Workspace YouTube performance</h4>
                          <p className="muted">
                            Refresh analytics on demand for workspace-managed YouTube uploads.
                          </p>
                        </div>
                        <div className="detail-actions">
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => setActiveView("performance")}
                          >
                            Open Performance
                          </button>
                        </div>
                      </div>
                      {latestSelectedYouTubePost ? (
                        latestSelectedPerformanceSnapshot ? (
                          <>
                            <p className="detail-meta">
                              Refreshed {formatTimestamp(latestSelectedPerformanceSnapshot.fetchedAt)}
                            </p>
                            {renderPerformanceSummary(latestSelectedPerformanceSnapshot)}
                          </>
                        ) : (
                          <p className="muted">
                            This clip has a workspace YouTube upload, but no performance snapshot has been pulled yet.
                          </p>
                        )
                      ) : (
                        <p className="muted">
                          No workspace-managed YouTube upload exists for this clip yet.
                        </p>
                      )}
                    </div>
                  </Card>
                </div>

                {selectedClipSchedulePosts.length > 0 ? (
                  <p className="detail-meta">
                    This clip currently has {selectedClipSchedulePosts.length} scheduled or uploaded workspace post
                    {selectedClipSchedulePosts.length === 1 ? "" : "s"}.
                  </p>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel className="panel" id="publish-queue">
            <PanelHeader className="panel-header">
              <div>
                <h2>Publish Queue</h2>
                <p className="muted">
                  YouTube can now upload directly through your connected channel and hand future posts off to YouTube's native scheduler. TikTok remains an honest local draft-handoff queue until its direct post adapter is ready.
                </p>
              </div>
              <span className="panel-badge">{scheduledPosts.length} queued</span>
            </PanelHeader>

            <div className="publish-grid">
              <SchedulePostComposer
                selectedClip={selectedClip}
                platform={schedulePlatform}
                accountLabel={scheduleAccountLabel}
                publishAt={schedulePublishAt}
                youtubeConnection={youtubeConnection}
                busy={creatingScheduledPost}
                message={publishing.message}
                savingMetadata={savingMetadata}
                nextPostingSlot={nextPostingSlot}
                onPlatformChange={setSchedulePlatform}
                onAccountLabelChange={setScheduleAccountLabel}
                onPublishAtChange={setSchedulePublishAt}
                onOpenSettings={() => setActiveView("settings")}
                onSchedule={() => void handleCreateScheduledPost()}
                onScheduleAtNextSlot={() => void handleCreateScheduledPost(true)}
              />

              <QueuedPostsPanel
                posts={scheduledPosts}
                clips={clips}
                refreshingStatuses={refreshingScheduledPostStatuses}
                refreshMessage={scheduledPostStatusMessage}
                onRefreshStatuses={() => void handleRefreshScheduledPostStatuses()}
                onRemove={removePost}
                onReconcile={(postId) => void handleReconcileYouTubeUpload(postId)}
                reconcilingPostId={reconcilingPostId}
                onRetryCaptions={(postId) => void handleRetryYouTubeCaptions(postId)}
                retryingCaptionsPostId={retryingCaptionsPostId}
                performanceContentByPostId={new Map(
                  scheduledPosts.map((post) => {
                    const performanceSnapshot = selectedPerformanceByScheduledPostId.get(post.id) ?? null;
                    return [
                      post.id,
                      performanceSnapshot ? (
                        <>
                          <p className="queue-card-meta">
                            Performance refreshed {formatTimestamp(performanceSnapshot.fetchedAt)}
                          </p>
                          {renderPerformanceSummary(performanceSnapshot)}
                        </>
                      ) : null
                    ];
                  })
                )}
              />
            </div>
          </Panel>

        </div>
      )}
      {pendingClipDataRemoval ? (
        <ConfirmActionDialog
          title={`Delete app data for ${pendingClipDataRemoval.displayName}?`}
          body="This permanently removes this clip from the app, including its transcript, schedules, performance snapshots, jobs, and proposal linkage. The underlying video file will not be deleted."
          confirmLabel="Delete clip app data"
          destructive
          acknowledgementLabel="I understand that this removes the selected local app records."
          onCancel={() => {
            if (!removingClipId) {
              setPendingClipDataRemoval(null);
            }
          }}
          onConfirm={() => void handleConfirmClipDataRemoval()}
        >
          <p className="muted">
            Metadata packages, metadata feedback, proposal approval/rejection feedback, and saved voice samples are retained for the AI learning loop.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </AppShell>
  );
}

interface StatusRowProps {
  label: string;
  value: string;
}

function StatusRow({ label, value }: StatusRowProps): JSX.Element {
  return (
    <div className="status-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface ToolCardProps {
  name: string;
  toolKey: ToolSettingKey;
  runtime: ToolRuntimeStatus;
  configuringTool: ToolSettingKey | null;
  onConfigure: (tool: ToolSettingKey) => Promise<void>;
  onClear: (tool: ToolSettingKey) => Promise<void>;
}

interface AutomationCardProps {
  name: string;
  description: string;
  requirement: string;
  enabled: boolean;
  settingKey: WorkspaceAutomationSettingKey;
  configuringAutomation: WorkspaceAutomationSettingKey | null;
  onToggle: (setting: WorkspaceAutomationSettingKey, enabled: boolean) => Promise<void>;
  disabled?: boolean;
}

interface WorkspaceFolderCardProps {
  name: string;
  description: string;
  folderKey: WorkspaceFolderSettingKey;
  folderPath: string | null;
  configuringFolder: WorkspaceFolderSettingKey | null;
  onConfigure: (folder: WorkspaceFolderSettingKey) => Promise<void>;
  onClear: (folder: WorkspaceFolderSettingKey) => Promise<void>;
}

function WorkspaceFolderCard({
  name,
  description,
  folderKey,
  folderPath,
  configuringFolder,
  onConfigure,
  onClear
}: WorkspaceFolderCardProps): JSX.Element {
  const isBusy = configuringFolder === folderKey;

  return (
    <div className="workspace-folder-card">
      <div className="workspace-folder-header">
        <div className="title-with-tip">
          <h3>{name}</h3>
          <InfoTip label={`${name} information`}>{description}</InfoTip>
        </div>
        <span className={folderPath ? "tool-status available" : "tool-status missing"}>
          {folderPath ? "Configured" : "Not set"}
        </span>
      </div>
      <div className="workspace-folder-location-row">
        <p className="workspace-folder-path">{folderPath ?? "No folder configured yet"}</p>
        <div className="workspace-folder-actions" aria-label={`${name} actions`}>
        <button
          type="button"
          className="icon-button"
          onClick={() => void onConfigure(folderKey)}
          disabled={isBusy}
          aria-label={folderPath ? `Change ${name}` : `Set ${name}`}
          title={folderPath ? "Change folder" : "Set folder"}
        >
          {isBusy ? "..." : (
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path d="M3.5 6.5h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 2.5 18V8A1.5 1.5 0 0 1 3.5 6.5Z" />
              <path d="M2.5 10h18" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="icon-button icon-button-destructive"
          onClick={() => void onClear(folderKey)}
          disabled={isBusy || !folderPath}
          aria-label={`Clear ${name}`}
          title="Clear folder"
        >
          X
        </button>
        </div>
      </div>
    </div>
  );
}

function AutomationCard({
  name,
  description,
  requirement,
  enabled,
  settingKey,
  configuringAutomation,
  onToggle,
  disabled = false
}: AutomationCardProps): JSX.Element {
  const isBusy = configuringAutomation === settingKey;

  return (
    <div className="automation-card">
      <div className="automation-card-header">
        <div>
          <h3>{name}</h3>
          <p className="muted">{description}</p>
        </div>
        <button
          type="button"
          className={`toggle-switch${enabled ? " enabled" : ""}`}
          onClick={() => void onToggle(settingKey, !enabled)}
          disabled={isBusy || disabled}
          aria-pressed={enabled}
        >
          {isBusy ? "Saving..." : enabled ? "On" : "Off"}
        </button>
      </div>
      <p className="automation-requirement">{requirement}</p>
    </div>
  );
}

function ToolCard({
  name,
  toolKey,
  runtime,
  configuringTool,
  onConfigure,
  onClear
}: ToolCardProps): JSX.Element {
  const isBusy = configuringTool === toolKey;

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <h3>{name}</h3>
        <span className={runtime.available ? "tool-status available" : "tool-status missing"}>
          {runtime.available ? "Available" : "Missing"}
        </span>
      </div>
      <p className="muted">{runtime.resolvedPath ?? "No path configured yet"}</p>
      <p className="tool-source">Source: {formatToolSource(runtime.source)}</p>
      <div className="tool-card-actions">
        <button className="secondary-button compact-button" onClick={() => void onConfigure(toolKey)} disabled={isBusy}>
          {isBusy ? "Choosing..." : runtime.resolvedPath ? "Change Path" : "Set Path"}
        </button>
        <button
          className="secondary-button compact-button"
          onClick={() => void onClear(toolKey)}
          disabled={isBusy || runtime.source !== "setting"}
        >
          Clear Saved Path
        </button>
      </div>
    </div>
  );
}

function formatToolSource(source: ToolRuntimeStatus["source"]): string {
  switch (source) {
    case "env":
      return "Environment variable";
    case "setting":
      return "Saved in workspace";
    case "bundled":
      return "Bundled with app";
    case "workspace":
      return "Workspace-local install";
    case "path":
      return "System PATH";
    default:
      return "Not resolved";
  }
}

function formatRuntimePath(filePath: string | null): string {
  if (!filePath) {
    return "Unavailable";
  }

  return filePath.split(/[\\/]/).pop() ?? filePath;
}
