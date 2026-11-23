import type { AppActionId, AppActionDefinition } from "./appActions";
import type {
  LocalAiSetupAsset,
  LocalAiSetupAssetId,
  LocalAiSetupProgress,
  LocalAiSetupRecommendation
} from "./localAiSetup";

export type ClipStatus =
  | "imported"
  | "transcribed"
  | "metadata_ready"
  | "scheduled"
  | "posted"
  | "failed";

export type PublishExecutionMode = "native_schedule" | "app_side_schedule" | "draft_handoff";
export type PublishPlatform = "youtube" | "tiktok";
export type ScheduledPostStatus = "scheduled" | "posting" | "posted" | "failed" | "reconciliation_required";
export type ScheduledPostRemoteOutcome = "not_started" | "pending" | "confirmed" | "unknown" | "failed";
export type PostingScheduleDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PostingScheduleRecurrence = "weekly";
export type NextAvailablePostingSlotReason =
  | "available"
  | "not_configured"
  | "no_free_slot"
  | "youtube_disconnected";

export interface RecurringPostingSlot {
  id: string;
  enabled: boolean;
  recurrence: PostingScheduleRecurrence;
  daysOfWeek: PostingScheduleDay[];
  localTime: string;
}

export interface PostingScheduleSettings {
  version: 1;
  slots: RecurringPostingSlot[];
  updatedAt: string | null;
}

export interface NextAvailablePostingSlotResult {
  publishAt: string | null;
  slotId: string | null;
  reason: NextAvailablePostingSlotReason;
  localLabel: string | null;
}
export type YouTubeCaptionStatus =
  | "not_applicable"
  | "pending"
  | "uploaded"
  | "unavailable"
  | "failed"
  | "reconnect_required";
export type ToolRuntimeSource = "env" | "setting" | "bundled" | "workspace" | "path" | "missing";
export type ToolSettingKey = "ffmpeg" | "ffprobe" | "whisper" | "whisperModel";
export type WorkspaceFolderSettingKey = "clipLibrary" | "longFormSourceLibrary" | "srtOutput";
export type WorkspaceAutomationSettingKey = "watchClipLibrary" | "autoTranscribeOnImport";
export type YouTubePrivacyStatus = "public" | "private" | "unlisted";
export type SpeakerAssignmentSource = "manual" | "auto_high_confidence" | "auto_low_confidence";
export type VoiceSampleSource = "clip_segment" | "microphone";
export type TranscriptAutoAssignScope = "all" | "needs_review" | "unassigned";
export type MetadataVariantPlatform = "youtube";
export type MetadataVariantKind = "title" | "description" | "public_hashtags" | "platform_tags";
export type MetadataVariantAngle =
  | "specific_fail"
  | "panic_tension"
  | "social_chaos"
  | "context_forward"
  | "search_forward"
  | "default"
  | "alt";
export type MetadataVariantSource = "ollama" | "heuristic";
export type AiExecutionMode = "ai" | "mixed_fallback" | "fallback";
export type MetadataFeedbackDecision = "approved" | "edited" | "rejected";
export type PerformancePlatform = "youtube" | "tiktok";
export type PerformanceRange = "7d" | "28d" | "90d" | "365d" | "since_2025";
export type PerformanceFormat = "all" | "shorts" | "long_form";
export type PerformanceMetric = "engaged_views" | "views" | "average_view_percentage" | "likes" | "comments";
export type PerformanceInsightType = "win" | "opportunity" | "warning" | "experiment";
export type PerformanceInsightConfidence = "high" | "medium" | "low";
export type PerformanceCoachFocus = "overview" | "video" | "packaging" | "retention";
export type PerformanceClassificationSource = "metadata" | "inferred" | "unknown";
export type LocalAiRuntimeHealth = "ready" | "needs_runtime" | "needs_model" | "error";
export type LocalAiRuntimeGpuMode = "auto" | "cpu_only" | "max_offload";
export type TranscriptionBackend = "cuda" | "cpu" | "missing";
export type TranscriptionBackendPreference = "auto" | "cuda" | "cpu";
export type OperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type OperationEtaBasis = "measured" | "approximate" | "unavailable";
export type IndexState = "active" | "archived";
export type TranscriptAssetType = "clip" | "long_form_source";
export type JobOwnerType = "clip" | "long_form_source" | "workspace";

export interface TranscriptAssetRef {
  assetType: TranscriptAssetType;
  assetId: string;
}
export type DataHealthCategory =
  | "invalid_record"
  | "broken_reference"
  | "historical_unlinked"
  | "missing_source_file"
  | "duplicate_source_path"
  | "completed_job_without_owner";

export interface SourceFingerprint {
  normalizedPath: string;
  fileSizeBytes: number;
  durationMs: number | null;
  modifiedAtMs: number | null;
}

export interface WorkflowSelection {
  assetType: "clip" | "long_form_source";
  assetId: string | null;
  proposalId: string | null;
  stage: "import" | "transcript" | "package" | "schedule" | "performance";
}

export interface OperationUpdate {
  id: string;
  resourceType: string;
  resourceId: string | null;
  operationType: string;
  status: OperationStatus;
  phase: string | null;
  percent: number | null;
  elapsedMs: number;
  etaMs: number | null;
  etaBasis: OperationEtaBasis;
  message: string | null;
  errorMessage: string | null;
  cancellable: boolean;
  updatedAt: string;
}

export interface ClipRecord {
  id: string;
  workspaceId: string;
  displayName: string;
  sourcePath: string;
  sourceFingerprint?: SourceFingerprint | null;
  fileSizeBytes: number;
  durationMs: number | null;
  frameRate?: number | null;
  widthPx: number | null;
  heightPx: number | null;
  status: ClipStatus;
  inspectionStatus: "basic" | "ffprobe";
  /** Present for clips rendered from an approved long-form proposal. */
  lineage?: ClipLineage | null;
  indexState: IndexState;
  archivedAt: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface ClipLineage {
  sourceType: "long_form_source";
  sourceId: string;
  proposalId: string;
  startMs: number;
  endMs: number;
}

export interface LongFormSourceRecord {
  id: string;
  displayName: string;
  sourcePath: string;
  sourceFingerprint?: SourceFingerprint | null;
  fileSizeBytes: number;
  durationMs: number | null;
  frameRate?: number | null;
  widthPx: number | null;
  heightPx: number | null;
  inspectionStatus: "basic" | "ffprobe";
  indexState: IndexState;
  archivedAt: string | null;
  importedAt: string;
  updatedAt: string;
}

export interface ClipApprovalReceipt {
  id: string;
  stage: "rendering" | "rendered" | "published" | "imported" | "completed";
  outputPath: string;
  stagingPath: string;
  sourcePath: string;
  sourceSize: number;
  sourceModifiedAt: number;
  startMs: number;
  endMs: number;
  layout: StackedVerticalLayoutSettings;
  requestedFileName: string;
  sha256: string | null;
  clipId: string | null;
}

export interface LongFormClipProposalRecord {
  id: string;
  sourceId: string;
  generationId?: string | null;
  provenance?: AiGenerationProvenance | null;
  startMs: number;
  endMs: number;
  hook: string;
  reason: string;
  confidence: number;
  evidenceSegmentIds: string[];
  analysis?: LongFormClipProposalAnalysis | null;
  status: "proposed" | "rejected" | "approved";
  approvedClipId?: string | null;
  approvalReceipt?: ClipApprovalReceipt | null;
  rejectionReason?: string | null;
  decisionAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LongFormClipProposalFeedbackDecision = "approved" | "rejected" | "reopened";

export interface LongFormClipProposalFeedbackRecord {
  id: string;
  sourceId: string;
  proposalId: string;
  generationId: string | null;
  provenance?: AiGenerationProvenance | null;
  decision: LongFormClipProposalFeedbackDecision;
  originalStartMs: number;
  originalEndMs: number;
  selectedStartMs: number;
  selectedEndMs: number;
  hook: string;
  reason: string;
  confidence: number;
  evidenceSegmentIds: string[];
  analysis?: LongFormClipProposalAnalysis | null;
  rejectionReason: string | null;
  approvedClipId: string | null;
  layout: StackedVerticalLayoutSettings | null;
  decidedAt: string;
  createdAt: string;
}

export interface LongFormClipProposalAnalysis {
  audioMeanDb: number | null;
  audioPeakDb: number | null;
  silenceRatio: number | null;
  sceneChangeCount: number | null;
  mediaScore: number | null;
  visualScore: number | null;
  visualSummary: string | null;
  visualModel?: string | null;
  visualEvidence?: LongFormClipVisualEvidence | null;
}

export interface LongFormClipVisualEvidence {
  actionReactionScore: number;
  visualClarityContextScore: number;
  sceneChangeScore: number;
  onScreenImportanceScore: number;
  overallScore: number;
  summary: string;
  evidence: string[];
  limitations: string[];
  frameTimestampsMs: number[];
}

export interface LongFormClipApprovalResult {
  proposal: LongFormClipProposalRecord;
  clip: ClipRecord;
  outputPath: string;
}

export interface StackedVerticalLayoutSettings {
  topFocusX: number;
  topFocusY: number;
  topScale: number;
  bottomFocusX: number;
  bottomFocusY: number;
  bottomScale: number;
}

export interface VerticalLayoutPreferences extends StackedVerticalLayoutSettings {
  mode: "single" | "stacked";
}

export interface ClipProposalGenerationResult {
  sourceId: string;
  proposals: LongFormClipProposalRecord[];
  model: string | null;
  profileId: string | null;
  profileName: string | null;
  executionMode: "ai" | "fallback";
  issueSummary: string | null;
  note: string | null;
}

export interface JobRecord {
  id: string;
  workspaceId: string;
  /** Explicit owner fields; older records continue to expose clipId. */
  assetType?: JobOwnerType;
  assetId?: string | null;
  clipId: string | null;
  jobType: string;
  status: OperationStatus;
  errorMessage: string | null;
  phase?: string | null;
  percent?: number | null;
  elapsedMs?: number;
  etaMs?: number | null;
  etaBasis?: OperationEtaBasis;
  message?: string | null;
  cancellable?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRuntimeStatus {
  available: boolean;
  resolvedPath: string | null;
  source: ToolRuntimeSource;
}

export interface TranscriptionRuntimeStatus {
  preference: TranscriptionBackendPreference;
  activeBackend: TranscriptionBackend;
  statusLabel: string;
  statusDetail: string;
  runtime: ToolRuntimeStatus;
  model: ToolRuntimeStatus;
  cudaRuntime: ToolRuntimeStatus;
  cudaModel: ToolRuntimeStatus;
  cpuRuntime: ToolRuntimeStatus;
  cpuModel: ToolRuntimeStatus;
}

export interface TranscriptSegmentRecord {
  id: string;
  startMs: number | null;
  endMs: number | null;
  text: string;
  speakerId: string | null;
  speakerConfidence: number | null;
  speakerAssignmentSource: SpeakerAssignmentSource | null;
  speakerReviewReason: string | null;
  speakerAlternateSpeakerId: string | null;
  speakerAlternateConfidence: number | null;
}

export interface TranscriptRecord {
  id: string;
  assetType: TranscriptAssetType;
  assetId: string;
  /** Legacy alias retained for existing action and database compatibility. */
  clipId: string;
  modelPath: string;
  language: string | null;
  textContent: string;
  srtContent: string;
  segments: TranscriptSegmentRecord[];
  status?: "complete" | "incomplete";
  createdAt: string;
  updatedAt: string;
}

export type SpeakerContextStatus = "identified" | "partial" | "unavailable" | "stale";

export interface SpeakerContextCollaboratorCount {
  speakerId: string;
  displayName: string;
  trustedSegmentCount: number;
}

export interface SpeakerContextSummary {
  status: SpeakerContextStatus;
  transcriptId: string | null;
  transcriptUpdatedAt: string | null;
  transcriptComplete: boolean;
  creatorTrustedSegmentCount: number;
  collaboratorCounts: SpeakerContextCollaboratorCount[];
  unassignedSegmentCount: number;
  needsReviewSegmentCount: number;
  unresolvedSegmentCount: number;
  lowConfidenceSegmentCount: number;
}

export type TranscriptionProgressPhase = "preparing" | "extracting" | "transcribing" | "saving";
export type TranscriptionProgressStatus = "running" | "completed" | "failed" | "cancelled";

export interface TranscriptionProgress {
  sourceId: string;
  phase: TranscriptionProgressPhase;
  status: TranscriptionProgressStatus;
  percent: number | null;
  elapsedMs: number;
  startedAt: string;
  detail: string;
  errorMessage: string | null;
  recoveryAvailable: boolean;
  recoveryDetail: string | null;
  etaMs: number | null;
  etaRangeMs: { minMs: number; maxMs: number } | null;
  etaBasis: "measured" | "approximate" | "unavailable";
}

export interface MetadataScoreSnapshot {
  total: number;
  audienceTopicFit: number;
  packagingClarity: number;
  hookStrength: number;
  retentionPayoff: number;
  searchContextClarity: number;
  sessionConnection: number;
  metadataHygiene: number;
  warnings: string[];
  suggestedFixes: string[];
}

export interface SelectedMetadataVariantIds {
  title: string | null;
  description: string | null;
  publicHashtags: string | null;
  platformTags: string | null;
}

export interface ClipMetadataPackageDraft {
  title: string;
  description: string;
  publicHashtags: string[];
  platformTags: string[];
  seriesKey: string;
  gameTitle: string;
  collaboratorProfileIds: string[];
  selectedVariantIds: SelectedMetadataVariantIds;
  latestScoreSnapshot: MetadataScoreSnapshot | null;
}

export interface ClipMetadataPackageRecord extends ClipMetadataPackageDraft {
  id: string;
  clipId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetadataVariantRecord {
  id: string;
  generationId: string;
  clipId: string;
  platform: MetadataVariantPlatform;
  kind: MetadataVariantKind;
  angle: MetadataVariantAngle;
  content: string | string[];
  source: MetadataVariantSource;
  scoreSnapshot: MetadataScoreSnapshot | null;
  provenance?: AiGenerationProvenance | null;
  createdAt: string;
}

export interface MetadataFeedbackRecord {
  id: string;
  clipId: string;
  variantId: string;
  decision: MetadataFeedbackDecision;
  provenance?: AiGenerationProvenance | null;
  createdAt: string;
}

export interface YouTubePerformanceSnapshotRecord {
  id: string;
  clipId: string;
  scheduledPostId: string;
  videoId: string;
  channelId?: string | null;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  subscribersGained?: number | null;
  subscribersLost?: number | null;
  viewerPercentage?: number | null;
  fetchedAt: string;
}

export interface GeneratedClipMetadataCandidatesResult {
  generationId: string;
  recommendedPackage: ClipMetadataPackageDraft;
  variants: MetadataVariantRecord[];
  model: string | null;
  profileId: string | null;
  profileName: string | null;
  executionMode: AiExecutionMode;
  issueSummary: string | null;
  note: string | null;
  source: MetadataVariantSource;
  speakerContext?: SpeakerContextSummary;
}

export interface ScheduledPostRecord {
  id: string;
  workspaceId: string;
  clipId: string;
  platform: PublishPlatform;
  accountLabel: string;
  channelId?: string | null;
  publishAt: string;
  executionMode: PublishExecutionMode;
  status: ScheduledPostStatus;
  operationId: string | null;
  remoteOutcome: ScheduledPostRemoteOutcome;
  lastRemoteCheckAt: string | null;
  reconciliationReason: string | null;
  title: string;
  description: string;
  platformTags: string[];
  youtubePlaylistIds: string[];
  remotePostId: string | null;
  publishedUrl: string | null;
  errorMessage: string | null;
  captionStatus: YouTubeCaptionStatus;
  captionRemoteId: string | null;
  captionLanguage: string | null;
  captionName: string | null;
  captionErrorMessage: string | null;
  captionUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledPostStatusRefreshResult {
  posts: ScheduledPostRecord[];
  checkedCount: number;
  updatedCount: number;
  skippedCount: number;
  unavailableCount: number;
}

export interface DataManagementSummary {
  activeClipLibraryCount: number;
  archivedClipLibraryCount: number;
  activeLongFormSourceCount: number;
  archivedLongFormSourceCount: number;
  preservedHistoryCount: number;
  orphanedRecordCount: number;
  lastScanAt: string | null;
  lastCleanupAt: string | null;
  lastOperationAt: string | null;
}

export interface DataHealthIssue {
  id: string;
  category: DataHealthCategory;
  label: string;
  detail: string;
  recordType: string;
  recordId: string;
  safeToDelete: boolean;
  reviewRequired: boolean;
  protectedReason: string | null;
}

export interface DataHealthScanResult {
  scannedAt: string;
  issues: DataHealthIssue[];
  categoryCounts: Record<DataHealthCategory, number>;
  safeIssueIds: string[];
  warnings: string[];
}

export interface DataManagementOperationResult {
  affectedCount: number;
  skippedActiveJobs: number;
  preservedCategories: string[];
  warnings: string[];
  summary: DataManagementSummary;
}

export interface ClipAppDataRemovalResult {
  clipId: string;
  displayName: string;
  removed: {
    clipRecord: number;
    transcriptRecords: number;
    scheduledPosts: number;
    performanceSnapshots: number;
    jobs: number;
    proposalRecords: number;
  };
  preserved: {
    metadataPackages: number;
    metadataVariants: number;
    metadataFeedback: number;
    proposalFeedback: number;
    voiceSamples: number;
  };
  preservedCategories: string[];
  warnings: string[];
}

export interface OwnedPerformanceSnapshotRecord {
  id: string;
  source: "workspace_post" | "channel_import";
  clipId: string | null;
  scheduledPostId: string | null;
  videoId: string;
  channelId?: string | null;
  clipDisplayName: string;
  title: string;
  publishedUrl: string | null;
  channelTitle: string | null;
  gameTitle: string;
  seriesKey: string;
  tags: string[];
  thumbnailUrl: string | null;
  publishAt: string;
  format: Exclude<PerformanceFormat, "all">;
  ageDays: number;
  performanceScore: number;
  classificationSource?: PerformanceClassificationSource;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  subscribersGained?: number | null;
  subscribersLost?: number | null;
  viewerPercentage?: number | null;
  fetchedAt: string | null;
}

export interface ImportedYouTubePerformanceRecord {
  id: string;
  videoId: string;
  channelId?: string | null;
  title: string;
  channelTitle: string;
  publishedAt: string;
  publishedUrl: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  tags: string[];
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  subscribersGained?: number | null;
  subscribersLost?: number | null;
  viewerPercentage?: number | null;
  importedAt: string;
  fetchedAt: string;
}

export interface PerformanceRecommendation {
  id: string;
  title: string;
  summary: string;
}

export interface PerformanceChannelProfile {
  channelId: string;
  title: string;
  description: string | null;
  customUrl: string | null;
  thumbnailUrl: string | null;
  channelUrl: string;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  fetchedAt: string | null;
}

export interface PerformanceMetricSummary {
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  publishedVideoCount: number;
}

export interface PerformancePeriodSummary extends PerformanceMetricSummary {
  startDate: string;
  endDate: string;
  comparison: PerformanceMetricSummary | null;
  changes: Partial<Record<keyof PerformanceMetricSummary, number | null>>;
  sampleSize: number;
}

export interface PerformanceTimelinePoint {
  date: string;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
}

export interface PerformanceLaneBreakdown {
  id: string;
  dimension: "game" | "series" | "format" | "keyword";
  label: string;
  sampleSize: number;
  averageViews: number | null;
  averageEngagedViews: number | null;
  averageViewPercentage: number | null;
  averagePerformanceScore: number;
  recentDirection: "up" | "down" | "flat" | "unknown";
  classificationSource: PerformanceClassificationSource;
  strongestVideoId: string | null;
  strongestVideoTitle: string | null;
}

export interface PerformanceBreakdownEntry {
  label: string;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  shareOfViews: number | null;
}

export interface PerformanceTrafficSourceBreakdown extends PerformanceBreakdownEntry {
  sourceType: string;
}

export interface PerformanceRetentionPoint {
  elapsedVideoTimeRatio: number;
  audienceWatchRatio: number | null;
  relativeRetentionPerformance: number | null;
  startedWatching: number | null;
  stoppedWatching: number | null;
}

export interface PerformanceEvidenceReference {
  id: string;
  source: "video" | "lane" | "period" | "traffic" | "retention";
  label: string;
  metric: string;
  value: string;
  comparisonValue: string | null;
  recordId: string | null;
  videoId: string | null;
}

export interface PerformanceCoachAction {
  kind: "open_clip" | "open_video" | "generate_titles" | "generate_tags" | "review_thumbnail";
  label: string;
  clipId: string | null;
  videoId: string | null;
}

export interface PerformanceCoachInsight {
  id: string;
  type: PerformanceInsightType;
  title: string;
  explanation: string;
  confidence: PerformanceInsightConfidence;
  evidence: PerformanceEvidenceReference[];
  action: PerformanceCoachAction | null;
}

export interface PerformanceCoachResult {
  generationId: string;
  generatedAt: string;
  filters: PerformanceDashboardFilters;
  focus: PerformanceCoachFocus;
  summary: string;
  insights: PerformanceCoachInsight[];
  limitations: string[];
  model: string | null;
  profileId: string | null;
  profileName: string | null;
  executionMode: AiExecutionMode;
  issueSummary: string | null;
  source: "ollama" | "heuristic";
}

export interface PerformanceVideoDetail {
  snapshot: OwnedPerformanceSnapshotRecord;
  channelBaseline: PerformanceMetricSummary;
  trafficSources: PerformanceTrafficSourceBreakdown[];
  devices: PerformanceBreakdownEntry[];
  subscriberStatus: PerformanceBreakdownEntry[];
  retention: PerformanceRetentionPoint[];
  retentionFetchedAt: string | null;
  dataLimitations: string[];
}

export interface PerformanceDashboardFilters {
  range: PerformanceRange;
  format: PerformanceFormat;
  gameTitle: string;
  seriesKey: string;
  metric: PerformanceMetric;
}

export interface PerformanceDashboardResult {
  filters: PerformanceDashboardFilters;
  youtubeConnected: boolean;
  analyticsScopeGranted: boolean;
  ownedLastFetchedAt: string | null;
  historicalImportStartDate: string;
  historicalImportVideoLimit: number;
  historicalImportedVideoCount: number;
  historicalImportLastFetchedAt: string | null;
  requiresOwnedRefresh: boolean;
  availableGameTitles: string[];
  availableSeriesKeys: string[];
  ownedSnapshots: OwnedPerformanceSnapshotRecord[];
  recommendations: PerformanceRecommendation[];
  channelProfile?: PerformanceChannelProfile | null;
  overview?: PerformancePeriodSummary | null;
  timeline?: PerformanceTimelinePoint[];
  laneBreakdowns?: PerformanceLaneBreakdown[];
  trafficSources?: PerformanceTrafficSourceBreakdown[];
  devices?: PerformanceBreakdownEntry[];
  subscriberStatus?: PerformanceBreakdownEntry[];
  freshness?: {
    channel: string | null;
    owned: string | null;
    breakdowns: string | null;
    staleAreas: Array<"channel" | "owned" | "breakdowns">;
  };
}

export interface PerformanceHistoryImportResult {
  importedVideoCount: number;
  newVideoCount: number;
  updatedVideoCount: number;
  publishedAfter: string;
  maxVideos: number;
  cappedByLimit: boolean;
  newestPublishedAt: string | null;
  oldestPublishedAt: string | null;
  fetchedAt: string;
}

export interface YouTubeConnectionStatus {
  clientId: string;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  connected: boolean;
  analyticsScopeGranted: boolean;
  captionsScopeGranted: boolean;
  channelId: string | null;
  channelTitle: string | null;
  connectedAt: string | null;
}

export interface YouTubePlaylistRecord {
  id: string;
  title: string;
  description: string;
  itemCount: number;
}

export interface YouTubeManagedVideoRecord {
  videoId: string;
  channelId: string | null;
  channelTitle: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  publishedAt: string;
  privacyStatus: YouTubePrivacyStatus;
  publishAt: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  linkedClipId: string | null;
  linkedScheduledPostId: string | null;
  fetchedAt: string;
  remoteRevision: string | null;
}

export interface YouTubeMetadataDraft {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  baseRemoteRevision: string | null;
  updatedAt: string;
}

export interface YouTubeMetadataPatch {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
}

export type YouTubeBulkTagMode = "replace" | "add" | "remove";

export interface YouTubeBulkEditInput {
  videoIds: string[];
  fields: {
    title?: string;
    description?: string;
    tags?: string[];
    tagMode?: YouTubeBulkTagMode;
    categoryId?: string;
  };
  baseRemoteRevisions?: Record<string, string | null>;
}

export interface YouTubeBulkEditResult {
  operationId: string;
  completed: string[];
  failed: Array<{ videoId: string; errorMessage: string }>;
  conflicts: Array<{ videoId: string; errorMessage: string }>;
  skipped: Array<{ videoId: string; reason: string }>;
}

export type ThumbnailCandidateStatus = "ready" | "applied" | "failed";

export interface ThumbnailGenerationProvenance {
  task: AiProfileTask;
  profileId: string | null;
  profileName: string | null;
  model: string | null;
  executionMode: AiExecutionMode;
  sourceVideoId: string;
  sourceClipId: string | null;
  sourceFrameTimestampsMs: number[];
  generatedAt: string;
}

export interface ThumbnailCandidateRecord {
  id: string;
  videoId: string;
  sourceClipId: string | null;
  localPath: string;
  mimeType: "image/jpeg" | "image/png";
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
  brief: string;
  status: ThumbnailCandidateStatus;
  provenance: ThumbnailGenerationProvenance;
  createdAt: string;
  appliedAt: string | null;
  errorMessage: string | null;
}

export interface ThumbnailGenerationInput {
  videoId: string;
  sourceClipId?: string | null;
  candidateCount?: number;
}

export interface ThumbnailGenerationResult {
  videoId: string;
  candidates: ThumbnailCandidateRecord[];
  sourceFrameAnalysisAvailable: boolean;
  note: string | null;
}

export interface CreatorProfileLinks {
  youtube: string | null;
  tiktok: string | null;
  twitch: string | null;
  kick: string | null;
  instagram: string | null;
  x: string | null;
  discord: string | null;
  website: string | null;
}

export interface CollaboratorVoiceSample {
  id: string;
  /** Legacy clip ownership is retained for samples captured from transcript segments. */
  clipId: string | null;
  /** Legacy segment ownership is retained for samples captured from transcript segments. */
  segmentId: string | null;
  source?: VoiceSampleSource;
  transcriptPreview: string;
  startMs: number | null;
  endMs: number | null;
  signature: number[];
  createdAt: string;
}

export interface VoiceProfileRecordingInput {
  profileId: string;
  audioData: ArrayBuffer;
  mimeType: string;
  transcriptPreview: string;
}

export interface CollaboratorProfile {
  id: string;
  displayName: string;
  profileLinks: CreatorProfileLinks;
  speakerColorHex: string | null;
  voiceSamples: CollaboratorVoiceSample[];
}

export type AiProfileTask = "youtube_metadata" | "youtube_thumbnail" | "performance_coach" | "clip_discovery";
export type AiProfileLearningMode = "off" | "retrieval" | "adaptive_prompt";

export interface AiLearningContextProvenance {
  version: 1;
  task: AiProfileTask;
  profileId: string;
  knowledgeEntryIds: string[];
  feedbackRecordIds: string[];
}

export interface AiGenerationProvenance {
  task: AiProfileTask;
  profileId: string | null;
  model: string | null;
  executionMode: AiExecutionMode;
  inputRecordIds: string[];
  learningExampleClipIds: string[];
  learningContext?: AiLearningContextProvenance | null;
  speakerContext?: SpeakerContextSummary;
}

export interface AiProfileLearningSettings {
  mode: AiProfileLearningMode;
  maxKnowledgeEntries: number;
  includeApprovedExamples: boolean;
  includeHighPerformingExamples: boolean;
  includeRejectedExamples: boolean;
}

export interface AiProfileKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProfile {
  id: string;
  name: string;
  task: AiProfileTask;
  description: string;
  preferredModel: string | null;
  systemPrompt: string;
  promptVersion?: number;
  speakerContextSettings?: {
    enabled: boolean;
    warnWhenStreamerUnidentified: boolean;
  };
  learningSettings: AiProfileLearningSettings;
  knowledgeEntries: AiProfileKnowledgeEntry[];
  enabled: boolean;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProfileAssignments {
  youtubeMetadataProfileId: string | null;
  youtubeThumbnailProfileId: string | null;
  performanceCoachProfileId?: string | null;
  clipDiscoveryProfileId: string | null;
}

export interface AiProfileTaskDefinition {
  id: AiProfileTask;
  label: string;
  description: string;
  assignmentLabel: string;
  wiredFeature: string;
}

export interface LocalAiModelRecord {
  id: string;
  label: string;
  fileName: string;
  filePath: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  compatibilityLabel: string | null;
  source: "managed";
}

export interface LocalAiRuntimeStatus {
  backend: "llama_cpp";
  health: LocalAiRuntimeHealth;
  statusLabel: string;
  statusDetail: string;
  executablePath: string | null;
  executableSource: ToolRuntimeSource;
  managedRootDirectory: string;
  managedModelsDirectory: string;
  availableModels: LocalAiModelRecord[];
  activeModelId: string | null;
  gpuMode: LocalAiRuntimeGpuMode;
  gpuSummary: string | null;
  lastError: string | null;
}

export interface CreatorSetupEnvironment {
  platform: string;
  architecture: string;
  storageRoot: string;
  freeSpaceBytes: number | null;
  hardware?: CreatorHardwareSummary;
}

export type CreatorGpuVendor = "nvidia" | "amd" | "intel" | "other" | "unknown";
export type CreatorGpuBackend = "cuda" | "vulkan" | "cpu" | "unknown";

export interface CreatorHardwareSummary {
  cpuCores: number | null;
  systemMemoryBytes: number | null;
  gpuName: string | null;
  gpuVendor: CreatorGpuVendor;
  gpuMemoryBytes: number | null;
  gpuBackend: CreatorGpuBackend;
  detectionDetail: string;
}

export interface WorkspaceIndexStatus {
  indexedClipCount: number;
  lastActivityAt: string | null;
  lastActivitySummary: string | null;
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
}

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  databasePath: string;
  workspaceName: string;
  clipLibraryFolder: string | null;
  longFormSourceLibraryFolder: string | null;
  srtOutputFolder: string | null;
  watchClipLibraryEnabled: boolean;
  autoTranscribeOnImportEnabled: boolean;
  ffmpeg: ToolRuntimeStatus;
  ffprobe: ToolRuntimeStatus;
  whisper: ToolRuntimeStatus;
  whisperModel: ToolRuntimeStatus;
  transcriptionRuntime: TranscriptionRuntimeStatus;
  creatorProfileLinks: CreatorProfileLinks;
  creatorVoiceSamples: CollaboratorVoiceSample[];
  collaboratorProfiles: CollaboratorProfile[];
  aiProfiles: AiProfile[];
  aiProfileAssignments: AiProfileAssignments;
  aiProfileTasks: AiProfileTaskDefinition[];
  strictAiModeEnabled: boolean;
  localAiRuntime: LocalAiRuntimeStatus;
  setupEnvironment: CreatorSetupEnvironment;
}

export interface CreatorAppApi {
  getAiActivity(): Promise<import("./aiActivity").AiActivitySnapshot>;
  onAiActivity(listener: (snapshot: import("./aiActivity").AiActivitySnapshot) => void): () => void;
  cancelAiActivity(id: string): Promise<boolean>;
  getActionDefinitions(): AppActionDefinition[];
  executeAction<T = unknown>(
    actionId: AppActionId,
    input: unknown,
    options?: { confirmed?: boolean }
  ): Promise<T>;
  executeActionOutcome<T = unknown>(
    actionId: AppActionId,
    input: unknown,
    options?: { confirmed?: boolean }
  ): Promise<import("./workflowOutcome").WorkflowOutcome<T>>;
  getAppInfo(): Promise<AppInfo>;
  getWorkspaceIndexStatus(): Promise<WorkspaceIndexStatus>;
  listClips(): Promise<ClipRecord[]>;
  listLongFormSources(): Promise<LongFormSourceRecord[]>;
  importLongFormSource(): Promise<LongFormSourceRecord | null>;
  getLongFormTranscript(sourceId: string): Promise<TranscriptRecord | null>;
  transcribeLongFormSource(sourceId: string): Promise<TranscriptRecord>;
  cancelLongFormTranscription(sourceId: string): Promise<boolean>;
  saveLongFormPartialTranscript(sourceId: string): Promise<TranscriptRecord>;
  discardLongFormPartialTranscript(sourceId: string): Promise<void>;
  onTranscriptionProgress(listener: (progress: TranscriptionProgress) => void): () => void;
  listLongFormClipProposals(sourceId: string): Promise<LongFormClipProposalRecord[]>;
  generateLongFormClipProposals(sourceId: string): Promise<ClipProposalGenerationResult>;
  cancelLongFormClipProposals(sourceId: string): Promise<boolean>;
  approveLongFormClipProposal(
    sourceId: string,
    proposalId: string,
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings,
    fileName?: string
  ): Promise<LongFormClipApprovalResult>;
  rejectLongFormClipProposal(sourceId: string, proposalId: string, reason?: string): Promise<LongFormClipProposalRecord>;
  reopenLongFormClipProposal(sourceId: string, proposalId: string): Promise<LongFormClipProposalRecord>;
  exportTrimmedLongFormSource(sourceId: string, startMs: number, endMs: number): Promise<string | null>;
  getClipMetadata(clipId: string): Promise<ClipMetadataPackageRecord | null>;
  listMetadataVariants(clipId: string): Promise<MetadataVariantRecord[]>;
  generateClipMetadataCandidates(
    clipId: string,
    options?: {
      kinds?: MetadataVariantKind[];
      append?: boolean;
      seriesKey?: string;
      gameTitle?: string;
      existingPackage?: ClipMetadataPackageDraft | null;
    }
  ): Promise<GeneratedClipMetadataCandidatesResult>;
  evaluateClipMetadataPackage(
    clipId: string,
    payload: ClipMetadataPackageDraft
  ): Promise<MetadataScoreSnapshot>;
  saveClipMetadata(clipId: string, payload: ClipMetadataPackageDraft): Promise<ClipMetadataPackageRecord>;
  recordMetadataFeedback(
    clipId: string,
    variantId: string,
    decision: MetadataFeedbackDecision
  ): Promise<MetadataFeedbackRecord>;
  getPerformanceDashboard(filters?: Partial<PerformanceDashboardFilters>): Promise<PerformanceDashboardResult>;
  refreshPerformanceDashboard(filters?: Partial<PerformanceDashboardFilters>): Promise<PerformanceDashboardResult>;
  importYouTubeHistoricalPerformance(
    input?: {
      publishedAfter?: string;
      maxVideos?: number;
    }
  ): Promise<PerformanceHistoryImportResult>;
  getPerformanceVideoDetail(videoId: string): Promise<PerformanceVideoDetail>;
  listManagedYouTubeVideos(input?: { publishedAfter?: string; maxResults?: number }): Promise<YouTubeManagedVideoRecord[]>;
  listYouTubeVideoCategories(): Promise<Array<{ id: string; title: string; assignable: boolean }>>;
  getYouTubeMetadataDraft(videoId: string): Promise<YouTubeMetadataDraft | null>;
  saveYouTubeMetadataDraft(draft: YouTubeMetadataDraft): Promise<YouTubeMetadataDraft>;
  generateYouTubeMetadataDraft(videoId: string): Promise<YouTubeMetadataDraft>;
  updateYouTubeVideoMetadata(videoId: string, patch: YouTubeMetadataPatch, baseRemoteRevision?: string | null): Promise<YouTubeManagedVideoRecord>;
  bulkUpdateYouTubeVideoMetadata(input: YouTubeBulkEditInput): Promise<YouTubeBulkEditResult>;
  generateYouTubeThumbnailCandidates(input: ThumbnailGenerationInput): Promise<ThumbnailGenerationResult>;
  listYouTubeThumbnailCandidates(videoId: string): Promise<ThumbnailCandidateRecord[]>;
  applyYouTubeThumbnail(videoId: string, candidateId: string): Promise<YouTubeManagedVideoRecord>;
  generatePerformanceCoach(input?: {
    filters?: Partial<PerformanceDashboardFilters>;
    videoId?: string;
    focus?: PerformanceCoachFocus;
  }): Promise<PerformanceCoachResult>;
  listYouTubePerformanceSnapshots(clipId: string): Promise<YouTubePerformanceSnapshotRecord[]>;
  refreshYouTubePerformance(scheduledPostId: string): Promise<YouTubePerformanceSnapshotRecord>;
  importClips(): Promise<ClipRecord[]>;
  removeClipFromWorkspace(clipId: string): Promise<ClipRecord[]>;
  deleteClipAppData(clipId: string): Promise<ClipAppDataRemovalResult>;
  clearWorkspaceClipIndexes(): Promise<ClipRecord[]>;
  getDataManagementSummary(): Promise<DataManagementSummary>;
  scanDataHealth(): Promise<DataHealthScanResult>;
  clearClipLibraryIndex(): Promise<DataManagementOperationResult>;
  clearLongFormIndex(): Promise<DataManagementOperationResult>;
  cleanupOrphanedData(issueIds: string[]): Promise<DataManagementOperationResult>;
  listScheduledPosts(): Promise<ScheduledPostRecord[]>;
  refreshScheduledPostStatuses(): Promise<ScheduledPostStatusRefreshResult>;
  reconcileYouTubeUpload(postId: string): Promise<ScheduledPostRecord>;
  retryYouTubeCaptions(postId: string): Promise<ScheduledPostRecord>;
  getPostingSchedule(): Promise<PostingScheduleSettings>;
  savePostingSchedule(settings: PostingScheduleSettings): Promise<PostingScheduleSettings>;
  getNextAvailablePostingSlot(): Promise<NextAvailablePostingSlotResult>;
  createScheduledPost(
    clipId: string,
    payload: {
      platform: PublishPlatform;
      accountLabel: string;
      publishAt: string;
      youtubePlaylistIds?: string[];
    }
  ): Promise<ScheduledPostRecord>;
  createScheduledPostAtNextSlot(
    clipId: string,
    youtubePlaylistIds?: string[]
  ): Promise<ScheduledPostRecord>;
  transcribeClip(clipId: string): Promise<TranscriptRecord>;
  getTranscript(clipId: string): Promise<TranscriptRecord | null>;
  getLocalMediaUrl(filePath: string): string;
  updateTranscript(
    clipId: string,
    textContent: string,
    srtContent: string,
    segments?: TranscriptSegmentRecord[],
    asset?: TranscriptAssetRef
  ): Promise<TranscriptRecord>;
  autoAssignTranscriptSpeakers(
    clipId: string,
    scope?: TranscriptAutoAssignScope
  ): Promise<TranscriptRecord>;
  exportTranscriptSrt(clipId: string): Promise<string | null>;
  exportTrimmedClip(
    clipId: string,
    startMs: number,
    endMs: number
  ): Promise<string | null>;
  exportStackedVerticalClip(
    clipId: string,
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings
  ): Promise<string | null>;
  exportStackedVerticalLongFormSource(
    sourceId: string,
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings
  ): Promise<string | null>;
  getVerticalLayoutPreferences(): Promise<VerticalLayoutPreferences | null>;
  saveVerticalLayoutPreferences(preferences: VerticalLayoutPreferences): Promise<VerticalLayoutPreferences>;
  getYouTubeConnectionStatus(): Promise<YouTubeConnectionStatus>;
  saveYouTubeCredentials(clientId: string, clientSecret: string): Promise<YouTubeConnectionStatus>;
  clearYouTubeCredentials(): Promise<YouTubeConnectionStatus>;
  connectYouTube(): Promise<YouTubeConnectionStatus>;
  disconnectYouTube(): Promise<YouTubeConnectionStatus>;
  listYouTubePlaylists(): Promise<YouTubePlaylistRecord[]>;
  configureToolPath(tool: ToolSettingKey): Promise<AppInfo>;
  clearToolPath(tool: ToolSettingKey): Promise<AppInfo>;
  setTranscriptionBackend(preference: TranscriptionBackendPreference): Promise<AppInfo>;
  configureWorkspaceFolder(folder: WorkspaceFolderSettingKey): Promise<AppInfo>;
  clearWorkspaceFolder(folder: WorkspaceFolderSettingKey): Promise<AppInfo>;
  setWorkspaceAutomationSetting(setting: WorkspaceAutomationSettingKey, enabled: boolean): Promise<AppInfo>;
  saveCreatorProfileLinks(payload: CreatorProfileLinks): Promise<AppInfo>;
  saveCollaboratorProfiles(payload: CollaboratorProfile[]): Promise<AppInfo>;
  saveAiProfiles(payload: { profiles: AiProfile[]; assignments: AiProfileAssignments }): Promise<AppInfo>;
  setAiStrictMode(enabled: boolean): Promise<AppInfo>;
  refreshLocalAiRuntime(): Promise<AppInfo>;
  importLocalAiRuntimeExecutable(): Promise<AppInfo>;
  clearLocalAiRuntimeExecutable(): Promise<AppInfo>;
  importLocalAiModel(): Promise<AppInfo>;
  getLocalAiSetupCatalog(): Promise<LocalAiSetupAsset[]>;
  downloadLocalAiSetupAsset(assetId: LocalAiSetupAssetId): Promise<AppInfo>;
  installRecommendedLocalAiSetup(recommendation: LocalAiSetupRecommendation): Promise<AppInfo>;
  cancelLocalAiSetupDownload(operationId: string): Promise<boolean>;
  onLocalAiSetupProgress(listener: (progress: LocalAiSetupProgress) => void): () => void;
  captureCreatorVoiceSample(clipId: string, segment: TranscriptSegmentRecord): Promise<AppInfo>;
  recordVoiceProfileSample(input: VoiceProfileRecordingInput): Promise<AppInfo>;
  removeCreatorVoiceSample(sampleId: string): Promise<AppInfo>;
  captureCollaboratorVoiceSample(
    collaboratorProfileId: string,
    clipId: string,
    segment: TranscriptSegmentRecord
  ): Promise<AppInfo>;
  removeCollaboratorVoiceSample(collaboratorProfileId: string, sampleId: string): Promise<AppInfo>;
  listJobs(): Promise<JobRecord[]>;
  onOperationUpdate(listener: (operation: OperationUpdate) => void): () => void;
}

declare global {
  interface Window {
    creatorApp: CreatorAppApi;
  }
}
