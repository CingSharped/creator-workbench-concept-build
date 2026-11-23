import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type {
  ClipMetadataPackageRecord,
  ClipLineage,
  ClipRecord,
  ImportedYouTubePerformanceRecord,
  LongFormClipProposalFeedbackRecord,
  LongFormClipProposalRecord,
  LongFormSourceRecord,
  JobRecord,
  JobOwnerType,
  MetadataFeedbackRecord,
  MetadataVariantRecord,
  ScheduledPostRecord,
  SourceFingerprint,
  TranscriptRecord,
  ThumbnailCandidateRecord,
  YouTubeManagedVideoRecord,
  YouTubeMetadataDraft,
  YouTubePerformanceSnapshotRecord
} from "../../shared/contracts";
import { buildTranscriptSegmentsFromSrt, normalizeTranscriptSegments } from "../../shared/transcriptSegments";

interface WorkspaceRecordSnapshot {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface SettingRecordSnapshot {
  value: string;
  updatedAt: string;
}

interface LegacyClipMetadataRecord {
  id: string;
  clipId: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface LegacyScheduledPostRecord extends Omit<
  ScheduledPostRecord,
  | "platformTags"
  | "captionStatus"
  | "captionRemoteId"
  | "captionLanguage"
  | "captionName"
  | "captionErrorMessage"
  | "captionUpdatedAt"
  | "operationId"
  | "remoteOutcome"
  | "lastRemoteCheckAt"
  | "reconciliationReason"
> {
  tags?: string[];
  platformTags?: string[];
  captionStatus?: ScheduledPostRecord["captionStatus"];
  captionRemoteId?: string | null;
  captionLanguage?: string | null;
  captionName?: string | null;
  captionErrorMessage?: string | null;
  captionUpdatedAt?: string | null;
  operationId?: string | null;
  remoteOutcome?: ScheduledPostRecord["remoteOutcome"];
  lastRemoteCheckAt?: string | null;
  reconciliationReason?: string | null;
}

type PersistedStoreShape = Partial<CreatorWorkspaceStore> & {
  schemaVersion?: number;
  clipMetadata?: LegacyClipMetadataRecord[];
  scheduledPosts?: LegacyScheduledPostRecord[];
  /** Removed by the public-trend cleanup migration. */
  publicTrendRecords?: unknown;
};

export const CURRENT_DATABASE_SCHEMA_VERSION = 4;

export interface CreatorWorkspaceStore {
  schemaVersion: number;
  workspaces: WorkspaceRecordSnapshot[];
  clips: ClipRecord[];
  appSettings: Record<string, SettingRecordSnapshot>;
  jobs: JobRecord[];
  transcripts: TranscriptRecord[];
  metadataPackages: ClipMetadataPackageRecord[];
  metadataVariants: MetadataVariantRecord[];
  metadataFeedback: MetadataFeedbackRecord[];
  youtubeVideoCache: YouTubeManagedVideoRecord[];
  youtubeMetadataDrafts: YouTubeMetadataDraft[];
  thumbnailCandidates: ThumbnailCandidateRecord[];
  youtubePerformanceSnapshots: YouTubePerformanceSnapshotRecord[];
  importedYouTubePerformanceRecords: ImportedYouTubePerformanceRecord[];
  scheduledPosts: ScheduledPostRecord[];
  longFormSources: LongFormSourceRecord[];
  clipProposals: LongFormClipProposalRecord[];
  clipProposalFeedback: LongFormClipProposalFeedbackRecord[];
}

interface DatabaseContext {
  databasePath: string;
}

let databaseContext: DatabaseContext | null = null;
let databaseWriteInProgress = false;

export function bootstrapLocalDatabase(userDataPath: string): DatabaseContext {
  if (databaseContext) {
    return databaseContext;
  }

  mkdirSync(userDataPath, { recursive: true });

  const databasePath = path.join(userDataPath, "creator-workspace.json");
  if (!existsSync(databasePath)) {
    recoverDatabaseTempFile(databasePath);
    if (!existsSync(databasePath)) {
      persistStore(databasePath, createEmptyStore());
    }
  } else {
    removeDatabaseTempFile(databasePath);
  }

  databaseContext = {
    databasePath
  };

  return databaseContext;
}

export function getDatabaseContext(): DatabaseContext {
  if (!databaseContext) {
    throw new Error("Database has not been initialized yet.");
  }

  return databaseContext;
}

export function readDatabase(): CreatorWorkspaceStore {
  const { databasePath } = getDatabaseContext();

  if (!existsSync(databasePath)) {
    recoverDatabaseTempFile(databasePath);
    if (!existsSync(databasePath)) {
      persistStore(databasePath, createEmptyStore());
    }
  }

  const raw = readDatabaseText(databasePath).trim();
  if (!raw) {
    throw new Error("The existing Creator Workbench database is empty or damaged. Restore a valid backup before continuing; the file has been preserved.");
  }

  const parsed = JSON.parse(raw) as unknown;
  assertPersistedStoreObject(parsed);
  assertPersistedCollectionShapes(parsed);
  assertSupportedDatabaseSchema(parsed.schemaVersion);
  const migration = migratePersistedStore(parsed as PersistedStoreShape);
  assertPersistedCollectionShapes(migration.store);
  const normalized = normalizeStore(migration.store);
  if (migration.changed || storeNeedsMigration(parsed as PersistedStoreShape, normalized)) {
    persistStore(databasePath, normalized);
  }
  return normalized;
}

export function updateDatabase<T>(updater: (store: CreatorWorkspaceStore) => T): T {
  if (databaseWriteInProgress) {
    throw new Error("A Creator Workbench database update is already in progress.");
  }

  const { databasePath } = getDatabaseContext();
  databaseWriteInProgress = true;
  try {
    const store = readDatabase();
    const result = updater(store);
    persistStore(databasePath, store);
    return result;
  } finally {
    databaseWriteInProgress = false;
  }
}

function createEmptyStore(): CreatorWorkspaceStore {
  return {
    schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
    workspaces: [],
    clips: [],
    appSettings: {},
    jobs: [],
    transcripts: [],
    metadataPackages: [],
    metadataVariants: [],
    metadataFeedback: [],
    youtubeVideoCache: [],
    youtubeMetadataDrafts: [],
    thumbnailCandidates: [],
    youtubePerformanceSnapshots: [],
    importedYouTubePerformanceRecords: [],
    scheduledPosts: [],
    longFormSources: [],
    clipProposals: [],
    clipProposalFeedback: []
  };
}

interface PersistedStoreMigrationResult {
  store: PersistedStoreShape;
  changed: boolean;
}

function migratePersistedStore(store: PersistedStoreShape): PersistedStoreMigrationResult {
  const migrated: PersistedStoreShape = {
    ...store,
    schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION
  };
  let changed = store.schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION;

  if (Object.prototype.hasOwnProperty.call(migrated, "publicTrendRecords")) {
    delete migrated.publicTrendRecords;
    changed = true;
  }

  const cleanedSettings = removePublicTrendSettings(migrated.appSettings);
  if (cleanedSettings.changed) {
    migrated.appSettings = cleanedSettings.settings;
    changed = true;
  }

  for (const key of ["metadataVariants", "metadataFeedback", "clipProposals", "clipProposalFeedback"] as const) {
    const original = migrated[key];
    const cleaned = removeTrendProvenance(original);
    if (cleaned.changed) {
      Object.assign(migrated, { [key]: cleaned.records });
      changed = true;
    }
  }

  return { store: migrated, changed };
}

function removePublicTrendSettings(
  settings: PersistedStoreShape["appSettings"]
): { settings: PersistedStoreShape["appSettings"]; changed: boolean } {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { settings, changed: false };
  }

  const nextSettings = { ...settings };
  let changed = false;
  const filterSetting = nextSettings["performance.dashboard_filters"];
  if (filterSetting) {
    const cleaned = removeSettingKeys(filterSetting, ["regionCode", "trendMode", "query"]);
    if (cleaned.changed) {
      nextSettings["performance.dashboard_filters"] = cleaned.setting;
      changed = true;
    }
  }

  const profilesSetting = nextSettings["ai.profiles"];
  if (profilesSetting) {
    const cleaned = removeTrendProfiles(profilesSetting);
    if (cleaned.changed) {
      nextSettings["ai.profiles"] = cleaned.setting;
      changed = true;
    }
  }

  const assignmentsSetting = nextSettings["ai.profile_assignments"];
  if (assignmentsSetting) {
    const cleaned = removeSettingKeys(assignmentsSetting, ["trendResearchProfileId"]);
    if (cleaned.changed) {
      nextSettings["ai.profile_assignments"] = cleaned.setting;
      changed = true;
    }
  }

  return { settings: nextSettings, changed };
}

function removeSettingKeys(
  setting: { value: string; updatedAt: string },
  keys: string[]
): { setting: { value: string; updatedAt: string }; changed: boolean } {
  try {
    const parsed = JSON.parse(setting.value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { setting, changed: false };
    }

    const next = { ...(parsed as Record<string, unknown>) };
    let changed = false;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        changed = true;
      }
    }

    return changed
      ? { setting: { ...setting, value: JSON.stringify(next) }, changed: true }
      : { setting, changed: false };
  } catch {
    return { setting, changed: false };
  }
}

function removeTrendProfiles(
  setting: { value: string; updatedAt: string }
): { setting: { value: string; updatedAt: string }; changed: boolean } {
  try {
    const parsed = JSON.parse(setting.value) as unknown;
    if (!Array.isArray(parsed)) {
      return { setting, changed: false };
    }

    const next = parsed.filter(
      (profile) => !profile || typeof profile !== "object" || (profile as { task?: unknown }).task !== "trend_research"
    );
    return next.length !== parsed.length
      ? { setting: { ...setting, value: JSON.stringify(next) }, changed: true }
      : { setting, changed: false };
  } catch {
    return { setting, changed: false };
  }
}

function removeTrendProvenance(records: unknown): { records: unknown; changed: boolean } {
  if (!Array.isArray(records)) {
    return { records, changed: false };
  }

  let changed = false;
  const next = records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return record;
    }

    const candidate = record as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(candidate, "provenance")) {
      return record;
    }

    const provenance = candidate.provenance;
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance) ||
      !Object.prototype.hasOwnProperty.call(provenance, "trendContextUsed")) {
      return record;
    }

    const { trendContextUsed: _removed, ...cleanedProvenance } = provenance as Record<string, unknown>;
    changed = true;
    return { ...candidate, provenance: cleanedProvenance };
  });

  return { records: next, changed };
}

function normalizeStore(store: PersistedStoreShape): CreatorWorkspaceStore {
  const metadataPackages = Array.isArray(store.metadataPackages)
    ? store.metadataPackages.map((record) => normalizeMetadataPackageRecord(record))
    : Array.isArray(store.clipMetadata)
      ? store.clipMetadata.map((record) => normalizeLegacyClipMetadataRecord(record))
      : [];

  const scheduledPosts = Array.isArray(store.scheduledPosts)
    ? store.scheduledPosts.map((post) => normalizeScheduledPostRecord(post))
    : [];

  const clipProposals = Array.isArray(store.clipProposals) ? store.clipProposals : [];
  const clipProposalFeedback = Array.isArray(store.clipProposalFeedback)
    ? store.clipProposalFeedback
    : clipProposals
        .filter((proposal) => proposal.status === "approved" || proposal.status === "rejected")
        .map((proposal) => buildLegacyClipProposalFeedback(proposal));

  const longFormSources = Array.isArray(store.longFormSources)
    ? store.longFormSources.map((source) => normalizeLongFormSourceRecord(source))
    : [];

  const clips = Array.isArray(store.clips)
    ? store.clips.map((clip) => normalizeClipRecord(clip))
    : [];

  return {
    schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
    workspaces: Array.isArray(store.workspaces) ? store.workspaces : [],
    clips,
    appSettings:
      store.appSettings && typeof store.appSettings === "object" ? store.appSettings : {},
    jobs: Array.isArray(store.jobs) ? store.jobs.map((job) => normalizeJobRecord(job)) : [],
    transcripts: Array.isArray(store.transcripts)
      ? store.transcripts.map((transcript) => normalizeTranscriptRecord(transcript, clips, longFormSources))
      : [],
    metadataPackages,
    metadataVariants: Array.isArray(store.metadataVariants) ? store.metadataVariants : [],
    metadataFeedback: Array.isArray(store.metadataFeedback) ? store.metadataFeedback : [],
    youtubeVideoCache: Array.isArray(store.youtubeVideoCache)
      ? store.youtubeVideoCache.map((record) => normalizeYouTubeManagedVideoRecord(record))
      : [],
    youtubeMetadataDrafts: Array.isArray(store.youtubeMetadataDrafts)
      ? store.youtubeMetadataDrafts.map((draft) => normalizeYouTubeMetadataDraft(draft))
      : [],
    thumbnailCandidates: Array.isArray(store.thumbnailCandidates)
      ? store.thumbnailCandidates.map((candidate) => normalizeThumbnailCandidateRecord(candidate))
      : [],
    youtubePerformanceSnapshots: Array.isArray(store.youtubePerformanceSnapshots)
      ? store.youtubePerformanceSnapshots.map((snapshot) => normalizeYouTubePerformanceSnapshotRecord(snapshot))
      : [],
    importedYouTubePerformanceRecords: Array.isArray(store.importedYouTubePerformanceRecords)
      ? store.importedYouTubePerformanceRecords.map((record) => normalizeImportedYouTubePerformanceRecord(record))
      : [],
    scheduledPosts,
    longFormSources,
    clipProposals,
    clipProposalFeedback
  };
}

function storeNeedsMigration(store: PersistedStoreShape, normalized: CreatorWorkspaceStore): boolean {
  const persistedClips = Array.isArray(store.clips) ? store.clips : [];
  const persistedSources = Array.isArray(store.longFormSources) ? store.longFormSources : [];
  const persistedTranscripts = Array.isArray(store.transcripts) ? store.transcripts : [];
  const persistedJobs = Array.isArray(store.jobs) ? store.jobs : [];

  return (
    store.schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION ||
    !Array.isArray(store.clipProposalFeedback) ||
    !Array.isArray(store.youtubeVideoCache) ||
    !Array.isArray(store.youtubeMetadataDrafts) ||
    !Array.isArray(store.thumbnailCandidates) ||
    persistedScheduledPostsNeedCaptionMigration(store.scheduledPosts, normalized.scheduledPosts) ||
    persistedClips.some((clip, index) => {
      const normalizedClip = normalized.clips[index];
      return !normalizedClip || (clip as Partial<ClipRecord>).indexState !== normalizedClip.indexState ||
        (clip as Partial<ClipRecord>).archivedAt !== normalizedClip.archivedAt ||
        sourceFingerprintNeedsMigration(clip, normalizedClip.sourceFingerprint ?? null);
    }) ||
    persistedSources.some((source, index) => {
      const normalizedSource = normalized.longFormSources[index];
      return !normalizedSource || (source as Partial<LongFormSourceRecord>).indexState !== normalizedSource.indexState ||
        (source as Partial<LongFormSourceRecord>).archivedAt !== normalizedSource.archivedAt ||
        sourceFingerprintNeedsMigration(source, normalizedSource.sourceFingerprint ?? null);
    }) ||
    persistedTranscripts.some((transcript, index) => {
      const normalizedTranscript = normalized.transcripts[index];
      return !normalizedTranscript ||
        (transcript as Partial<TranscriptRecord>).assetType !== normalizedTranscript.assetType ||
        (transcript as Partial<TranscriptRecord>).assetId !== normalizedTranscript.assetId;
    }) ||
    persistedJobs.some((job, index) => {
      const normalizedJob = normalized.jobs[index];
      return !normalizedJob ||
        (job as Partial<JobRecord>).assetType !== normalizedJob.assetType ||
        (job as Partial<JobRecord>).assetId !== normalizedJob.assetId;
    })
  );
}

function sourceFingerprintNeedsMigration(record: object, normalizedFingerprint: SourceFingerprint | null): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, "sourceFingerprint")) {
    return true;
  }

  return JSON.stringify((record as { sourceFingerprint?: unknown }).sourceFingerprint ?? null) !== JSON.stringify(normalizedFingerprint);
}

function persistedScheduledPostsNeedCaptionMigration(
  persistedPosts: LegacyScheduledPostRecord[] | undefined,
  normalizedPosts: ScheduledPostRecord[]
): boolean {
  return (persistedPosts ?? []).some((post, index) => {
    const normalizedPost = normalizedPosts[index];
    if (!normalizedPost) {
      return true;
    }

    return (
      (post as Partial<ScheduledPostRecord>).captionStatus !== normalizedPost.captionStatus ||
      (post as Partial<ScheduledPostRecord>).captionRemoteId !== normalizedPost.captionRemoteId ||
      (post as Partial<ScheduledPostRecord>).captionLanguage !== normalizedPost.captionLanguage ||
      (post as Partial<ScheduledPostRecord>).captionName !== normalizedPost.captionName ||
      (post as Partial<ScheduledPostRecord>).captionErrorMessage !== normalizedPost.captionErrorMessage ||
      (post as Partial<ScheduledPostRecord>).captionUpdatedAt !== normalizedPost.captionUpdatedAt ||
      (post as Partial<ScheduledPostRecord>).operationId !== normalizedPost.operationId ||
      (post as Partial<ScheduledPostRecord>).remoteOutcome !== normalizedPost.remoteOutcome ||
      (post as Partial<ScheduledPostRecord>).lastRemoteCheckAt !== normalizedPost.lastRemoteCheckAt ||
      (post as Partial<ScheduledPostRecord>).reconciliationReason !== normalizedPost.reconciliationReason
    );
  });
}

function normalizeClipRecord(record: Partial<ClipRecord>): ClipRecord {
  return {
    id: typeof record.id === "string" ? record.id : "",
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : "",
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : "",
    sourceFingerprint: normalizeSourceFingerprint(record.sourceFingerprint),
    fileSizeBytes: Number(record.fileSizeBytes ?? 0),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
    frameRate: typeof record.frameRate === "number" ? record.frameRate : null,
    widthPx: typeof record.widthPx === "number" ? record.widthPx : null,
    heightPx: typeof record.heightPx === "number" ? record.heightPx : null,
    status:
      record.status === "transcribed" || record.status === "metadata_ready" || record.status === "scheduled" ||
      record.status === "posted" || record.status === "failed"
        ? record.status
        : "imported",
    inspectionStatus: record.inspectionStatus === "ffprobe" ? "ffprobe" : "basic",
    lineage: normalizeClipLineage(record.lineage),
    indexState: record.indexState === "archived" ? "archived" : "active",
    archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
    importedAt: typeof record.importedAt === "string" ? record.importedAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function normalizeClipLineage(value: unknown): ClipLineage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<ClipLineage>;
  if (
    record.sourceType !== "long_form_source" ||
    typeof record.sourceId !== "string" ||
    typeof record.proposalId !== "string" ||
    typeof record.startMs !== "number" ||
    typeof record.endMs !== "number"
  ) {
    return null;
  }

  return {
    sourceType: "long_form_source",
    sourceId: record.sourceId,
    proposalId: record.proposalId,
    startMs: record.startMs,
    endMs: record.endMs
  };
}

function normalizeJobRecord(record: Partial<JobRecord>): JobRecord {
  const inferredAssetType: JobOwnerType =
    record.assetType === "clip" || record.assetType === "long_form_source" || record.assetType === "workspace"
      ? record.assetType
      : record.jobType?.includes("long_form")
        ? "long_form_source"
        : record.clipId
          ? "clip"
          : "workspace";
  const inferredAssetId = inferredAssetType === "workspace"
    ? null
    : typeof record.assetId === "string"
      ? record.assetId
      : typeof record.clipId === "string"
        ? record.clipId
        : null;

  return {
    id: typeof record.id === "string" ? record.id : "",
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : "",
    assetType: inferredAssetType,
    assetId: inferredAssetId,
    clipId: inferredAssetType === "clip" ? inferredAssetId : typeof record.clipId === "string" ? record.clipId : null,
    jobType: typeof record.jobType === "string" ? record.jobType : "unknown",
    status: record.status === "queued" || record.status === "running" || record.status === "completed" ||
      record.status === "failed" || record.status === "cancelled" || record.status === "interrupted"
      ? record.status
      : "failed",
    errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : null,
    phase: typeof record.phase === "string" ? record.phase : null,
    percent: typeof record.percent === "number" ? record.percent : null,
    elapsedMs: typeof record.elapsedMs === "number" ? record.elapsedMs : 0,
    etaMs: typeof record.etaMs === "number" ? record.etaMs : null,
    etaBasis: record.etaBasis === "measured" || record.etaBasis === "approximate" || record.etaBasis === "unavailable"
      ? record.etaBasis
      : "unavailable",
    message: typeof record.message === "string" ? record.message : null,
    cancellable: record.cancellable === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function normalizeLongFormSourceRecord(record: Partial<LongFormSourceRecord>): LongFormSourceRecord {
  return {
    id: typeof record.id === "string" ? record.id : "",
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : "",
    sourceFingerprint: normalizeSourceFingerprint(record.sourceFingerprint),
    fileSizeBytes: Number(record.fileSizeBytes ?? 0),
    durationMs: typeof record.durationMs === "number" ? record.durationMs : null,
    frameRate: typeof record.frameRate === "number" ? record.frameRate : null,
    widthPx: typeof record.widthPx === "number" ? record.widthPx : null,
    heightPx: typeof record.heightPx === "number" ? record.heightPx : null,
    inspectionStatus: record.inspectionStatus === "ffprobe" ? "ffprobe" : "basic",
    indexState: record.indexState === "archived" ? "archived" : "active",
    archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
    importedAt: typeof record.importedAt === "string" ? record.importedAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function normalizeSourceFingerprint(value: unknown): SourceFingerprint | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<SourceFingerprint>;
  if (
    typeof record.normalizedPath !== "string" ||
    typeof record.fileSizeBytes !== "number" ||
    (record.durationMs !== null && typeof record.durationMs !== "number") ||
    (record.modifiedAtMs !== null && typeof record.modifiedAtMs !== "number")
  ) {
    return null;
  }

  return {
    normalizedPath: record.normalizedPath,
    fileSizeBytes: record.fileSizeBytes,
    durationMs: record.durationMs ?? null,
    modifiedAtMs: record.modifiedAtMs ?? null
  };
}

function buildLegacyClipProposalFeedback(proposal: LongFormClipProposalRecord): LongFormClipProposalFeedbackRecord {
  const decidedAt = proposal.decisionAt ?? proposal.updatedAt;
  return {
    id: `legacy-clip-proposal-feedback-${proposal.id}`,
    sourceId: proposal.sourceId,
    proposalId: proposal.id,
    generationId: proposal.generationId ?? null,
    decision: proposal.status === "approved" ? "approved" : "rejected",
    originalStartMs: proposal.startMs,
    originalEndMs: proposal.endMs,
    selectedStartMs: proposal.startMs,
    selectedEndMs: proposal.endMs,
    hook: proposal.hook,
    reason: proposal.reason,
    confidence: proposal.confidence,
    evidenceSegmentIds: [...proposal.evidenceSegmentIds],
    analysis: proposal.analysis ?? null,
    rejectionReason: proposal.rejectionReason ?? null,
    approvedClipId: proposal.approvedClipId ?? null,
    layout: null,
    decidedAt,
    createdAt: decidedAt
  };
}

function normalizeTranscriptRecord(
  record: Partial<TranscriptRecord>,
  clips: ClipRecord[],
  longFormSources: LongFormSourceRecord[]
): TranscriptRecord {
  const textContent = typeof record.textContent === "string" ? record.textContent : "";
  const srtContent = typeof record.srtContent === "string" ? record.srtContent : "";
  const normalizedSegments =
    Array.isArray(record.segments) && record.segments.length > 0
      ? normalizeTranscriptSegments(record.segments)
      : buildTranscriptSegmentsFromSrt(srtContent, textContent);

  return {
    id: typeof record.id === "string" ? record.id : "",
    assetType:
      record.assetType === "long_form_source" ||
      (!record.assetType && typeof record.clipId === "string" && longFormSources.some((source) => source.id === record.clipId) && !clips.some((clip) => clip.id === record.clipId))
        ? "long_form_source"
        : "clip",
    assetId: typeof record.assetId === "string" && record.assetId
      ? record.assetId
      : typeof record.clipId === "string"
        ? record.clipId
        : "",
    clipId: typeof record.clipId === "string" ? record.clipId : "",
    modelPath: typeof record.modelPath === "string" ? record.modelPath : "",
    language: typeof record.language === "string" ? record.language : null,
    textContent,
    srtContent,
    segments: normalizedSegments,
    status: record.status === "incomplete" ? "incomplete" : "complete",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function normalizeMetadataPackageRecord(
  record: Partial<ClipMetadataPackageRecord>
): ClipMetadataPackageRecord {
  return {
    id: typeof record.id === "string" ? record.id : "",
    clipId: typeof record.clipId === "string" ? record.clipId : "",
    title: typeof record.title === "string" ? record.title : "",
    description: typeof record.description === "string" ? record.description : "",
    publicHashtags: Array.isArray(record.publicHashtags)
      ? record.publicHashtags.filter((tag): tag is string => typeof tag === "string")
      : [],
    platformTags: Array.isArray(record.platformTags)
      ? record.platformTags.filter((tag): tag is string => typeof tag === "string")
      : [],
    seriesKey: typeof record.seriesKey === "string" ? record.seriesKey : "",
    gameTitle: typeof record.gameTitle === "string" ? record.gameTitle : "",
    collaboratorProfileIds: Array.isArray(record.collaboratorProfileIds)
      ? record.collaboratorProfileIds.filter((id): id is string => typeof id === "string")
      : [],
    selectedVariantIds: {
      title:
        record.selectedVariantIds && typeof record.selectedVariantIds.title === "string"
          ? record.selectedVariantIds.title
          : null,
      description:
        record.selectedVariantIds && typeof record.selectedVariantIds.description === "string"
          ? record.selectedVariantIds.description
          : null,
      publicHashtags:
        record.selectedVariantIds && typeof record.selectedVariantIds.publicHashtags === "string"
          ? record.selectedVariantIds.publicHashtags
          : null,
      platformTags:
        record.selectedVariantIds && typeof record.selectedVariantIds.platformTags === "string"
          ? record.selectedVariantIds.platformTags
          : null
    },
    latestScoreSnapshot:
      record.latestScoreSnapshot && typeof record.latestScoreSnapshot === "object"
        ? {
            total: Number(record.latestScoreSnapshot.total ?? 0),
            audienceTopicFit: Number(record.latestScoreSnapshot.audienceTopicFit ?? 0),
            packagingClarity: Number(record.latestScoreSnapshot.packagingClarity ?? 0),
            hookStrength: Number(record.latestScoreSnapshot.hookStrength ?? 0),
            retentionPayoff: Number(record.latestScoreSnapshot.retentionPayoff ?? 0),
            searchContextClarity: Number(record.latestScoreSnapshot.searchContextClarity ?? 0),
            sessionConnection: Number(record.latestScoreSnapshot.sessionConnection ?? 0),
            metadataHygiene: Number(record.latestScoreSnapshot.metadataHygiene ?? 0),
            warnings: Array.isArray(record.latestScoreSnapshot.warnings)
              ? record.latestScoreSnapshot.warnings.filter(
                  (warning): warning is string => typeof warning === "string"
                )
              : [],
            suggestedFixes: Array.isArray(record.latestScoreSnapshot.suggestedFixes)
              ? record.latestScoreSnapshot.suggestedFixes.filter(
                  (fix): fix is string => typeof fix === "string"
                )
              : []
          }
        : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function normalizeLegacyClipMetadataRecord(record: LegacyClipMetadataRecord): ClipMetadataPackageRecord {
  return {
    id: record.id,
    clipId: record.clipId,
    title: record.title,
    description: record.description,
    publicHashtags: [],
    platformTags: Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === "string") : [],
    seriesKey: "",
    gameTitle: "",
    collaboratorProfileIds: [],
    selectedVariantIds: {
      title: null,
      description: null,
      publicHashtags: null,
      platformTags: null
    },
    latestScoreSnapshot: null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function normalizeYouTubePerformanceSnapshotRecord(
  record: Partial<YouTubePerformanceSnapshotRecord>
): YouTubePerformanceSnapshotRecord {
  return {
    id: typeof record.id === "string" ? record.id : "",
    clipId: typeof record.clipId === "string" ? record.clipId : "",
    scheduledPostId: typeof record.scheduledPostId === "string" ? record.scheduledPostId : "",
    videoId: typeof record.videoId === "string" ? record.videoId : "",
    channelId: typeof record.channelId === "string" ? record.channelId : null,
    views: typeof record.views === "number" ? record.views : null,
    engagedViews: typeof record.engagedViews === "number" ? record.engagedViews : null,
    estimatedMinutesWatched: typeof record.estimatedMinutesWatched === "number" ? record.estimatedMinutesWatched : null,
    averageViewDuration: typeof record.averageViewDuration === "number" ? record.averageViewDuration : null,
    averageViewPercentage: typeof record.averageViewPercentage === "number" ? record.averageViewPercentage : null,
    likes: typeof record.likes === "number" ? record.likes : null,
    comments: typeof record.comments === "number" ? record.comments : null,
    shares: typeof record.shares === "number" ? record.shares : null,
    subscribersGained: typeof record.subscribersGained === "number" ? record.subscribersGained : null,
    subscribersLost: typeof record.subscribersLost === "number" ? record.subscribersLost : null,
    viewerPercentage: typeof record.viewerPercentage === "number" ? record.viewerPercentage : null,
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : new Date(0).toISOString()
  };
}

function normalizeImportedYouTubePerformanceRecord(
  record: Partial<ImportedYouTubePerformanceRecord>
): ImportedYouTubePerformanceRecord {
  return {
    id: typeof record.id === "string" ? record.id : "",
    videoId: typeof record.videoId === "string" ? record.videoId : "",
    channelId: typeof record.channelId === "string" ? record.channelId : null,
    title: typeof record.title === "string" ? record.title : "",
    channelTitle: typeof record.channelTitle === "string" ? record.channelTitle : "",
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : new Date(0).toISOString(),
    publishedUrl: typeof record.publishedUrl === "string" ? record.publishedUrl : "",
    durationSeconds: typeof record.durationSeconds === "number" ? record.durationSeconds : null,
    thumbnailUrl: typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null,
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    views: typeof record.views === "number" ? record.views : null,
    engagedViews: typeof record.engagedViews === "number" ? record.engagedViews : null,
    estimatedMinutesWatched: typeof record.estimatedMinutesWatched === "number" ? record.estimatedMinutesWatched : null,
    averageViewDuration: typeof record.averageViewDuration === "number" ? record.averageViewDuration : null,
    averageViewPercentage: typeof record.averageViewPercentage === "number" ? record.averageViewPercentage : null,
    likes: typeof record.likes === "number" ? record.likes : null,
    comments: typeof record.comments === "number" ? record.comments : null,
    shares: typeof record.shares === "number" ? record.shares : null,
    subscribersGained: typeof record.subscribersGained === "number" ? record.subscribersGained : null,
    subscribersLost: typeof record.subscribersLost === "number" ? record.subscribersLost : null,
    viewerPercentage: typeof record.viewerPercentage === "number" ? record.viewerPercentage : null,
    importedAt: typeof record.importedAt === "string" ? record.importedAt : new Date(0).toISOString(),
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : new Date(0).toISOString()
  };
}

function normalizeYouTubeManagedVideoRecord(
  record: Partial<YouTubeManagedVideoRecord>
): YouTubeManagedVideoRecord {
  return {
    videoId: typeof record.videoId === "string" ? record.videoId : "",
    channelId: typeof record.channelId === "string" ? record.channelId : null,
    channelTitle: typeof record.channelTitle === "string" ? record.channelTitle : "",
    title: typeof record.title === "string" ? record.title : "",
    description: typeof record.description === "string" ? record.description : "",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    categoryId: typeof record.categoryId === "string" ? record.categoryId : "",
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : new Date(0).toISOString(),
    privacyStatus: record.privacyStatus === "public" || record.privacyStatus === "unlisted" ? record.privacyStatus : "private",
    publishAt: typeof record.publishAt === "string" ? record.publishAt : null,
    durationSeconds: typeof record.durationSeconds === "number" ? record.durationSeconds : null,
    thumbnailUrl: typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null,
    viewCount: typeof record.viewCount === "number" ? record.viewCount : null,
    likeCount: typeof record.likeCount === "number" ? record.likeCount : null,
    commentCount: typeof record.commentCount === "number" ? record.commentCount : null,
    linkedClipId: typeof record.linkedClipId === "string" ? record.linkedClipId : null,
    linkedScheduledPostId: typeof record.linkedScheduledPostId === "string" ? record.linkedScheduledPostId : null,
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : new Date(0).toISOString(),
    remoteRevision: typeof record.remoteRevision === "string" ? record.remoteRevision : null
  };
}

function normalizeYouTubeMetadataDraft(record: Partial<YouTubeMetadataDraft>): YouTubeMetadataDraft {
  return {
    videoId: typeof record.videoId === "string" ? record.videoId : "",
    title: typeof record.title === "string" ? record.title : "",
    description: typeof record.description === "string" ? record.description : "",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    categoryId: typeof record.categoryId === "string" ? record.categoryId : "",
    baseRemoteRevision: typeof record.baseRemoteRevision === "string" ? record.baseRemoteRevision : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString()
  };
}

function normalizeThumbnailCandidateRecord(
  record: Partial<ThumbnailCandidateRecord>
): ThumbnailCandidateRecord {
  const provenance: Partial<ThumbnailCandidateRecord["provenance"]> = record.provenance ?? {};
  return {
    id: typeof record.id === "string" ? record.id : "",
    videoId: typeof record.videoId === "string" ? record.videoId : "",
    sourceClipId: typeof record.sourceClipId === "string" ? record.sourceClipId : null,
    localPath: typeof record.localPath === "string" ? record.localPath : "",
    mimeType: record.mimeType === "image/png" ? "image/png" : "image/jpeg",
    widthPx: typeof record.widthPx === "number" ? record.widthPx : 0,
    heightPx: typeof record.heightPx === "number" ? record.heightPx : 0,
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
    brief: typeof record.brief === "string" ? record.brief : "",
    status: record.status === "applied" || record.status === "failed" ? record.status : "ready",
    provenance: {
      task: "youtube_thumbnail",
      profileId: typeof provenance.profileId === "string" ? provenance.profileId : null,
      profileName: typeof provenance.profileName === "string" ? provenance.profileName : null,
      model: typeof provenance.model === "string" ? provenance.model : null,
      executionMode: provenance.executionMode === "ai" || provenance.executionMode === "mixed_fallback" ? provenance.executionMode : "fallback",
      sourceVideoId: typeof provenance.sourceVideoId === "string" ? provenance.sourceVideoId : "",
      sourceClipId: typeof provenance.sourceClipId === "string" ? provenance.sourceClipId : null,
      sourceFrameTimestampsMs: Array.isArray(provenance.sourceFrameTimestampsMs)
        ? provenance.sourceFrameTimestampsMs.filter((value: number): value is number => typeof value === "number")
        : [],
      generatedAt: typeof provenance.generatedAt === "string" ? provenance.generatedAt : new Date(0).toISOString()
    },
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    appliedAt: typeof record.appliedAt === "string" ? record.appliedAt : null,
    errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : null
  };
}

function normalizeScheduledPostRecord(post: LegacyScheduledPostRecord): ScheduledPostRecord {
  const status = post.status === "scheduled" || post.status === "posting" || post.status === "posted" ||
    post.status === "failed" || post.status === "reconciliation_required"
    ? post.status
    : "failed";
  const remoteOutcome = post.remoteOutcome === "not_started" || post.remoteOutcome === "pending" ||
    post.remoteOutcome === "confirmed" || post.remoteOutcome === "unknown" || post.remoteOutcome === "failed"
    ? post.remoteOutcome
    : post.remotePostId
      ? "confirmed"
      : status === "posting" || status === "reconciliation_required"
        ? "unknown"
        : "not_started";

  return {
    id: post.id,
    workspaceId: post.workspaceId,
    clipId: post.clipId,
    platform: post.platform,
    accountLabel: post.accountLabel,
    channelId: typeof post.channelId === "string" ? post.channelId : null,
    publishAt: post.publishAt,
    executionMode: post.executionMode,
    status,
    operationId: post.operationId ?? null,
    remoteOutcome,
    lastRemoteCheckAt: post.lastRemoteCheckAt ?? null,
    reconciliationReason: post.reconciliationReason ?? null,
    title: post.title,
    description: post.description,
    platformTags: Array.isArray(post.platformTags)
      ? post.platformTags.filter((tag): tag is string => typeof tag === "string")
      : Array.isArray(post.tags)
        ? post.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
    youtubePlaylistIds: Array.isArray(post.youtubePlaylistIds) ? post.youtubePlaylistIds : [],
    remotePostId: post.remotePostId ?? null,
    publishedUrl: post.publishedUrl ?? null,
    errorMessage: post.errorMessage ?? null,
    captionStatus:
      post.captionStatus === "uploaded" ||
      post.captionStatus === "unavailable" ||
      post.captionStatus === "failed" ||
      post.captionStatus === "reconnect_required" ||
      post.captionStatus === "pending"
        ? post.captionStatus
        : post.platform === "youtube" && post.remotePostId
          ? "pending"
          : "not_applicable",
    captionRemoteId: post.captionRemoteId ?? null,
    captionLanguage: post.captionLanguage ?? null,
    captionName: post.captionName ?? null,
    captionErrorMessage: post.captionErrorMessage ?? null,
    captionUpdatedAt: post.captionUpdatedAt ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };
}

function persistStore(databasePath: string, store: CreatorWorkspaceStore): void {
  const temporaryPath = getDatabaseTempPath(databasePath);
  const persistedStore = {
    ...store,
    schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION
  };

  writeFileSync(temporaryPath, `${JSON.stringify(persistedStore, null, 2)}\n`, "utf8");
  const fileDescriptor = openSync(temporaryPath, "r+");
  try {
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }

  try {
    renameSync(temporaryPath, databasePath);
  } catch (error) {
    removeDatabaseTempFile(databasePath);
    throw new Error(
      `Could not safely replace the Creator Workbench database: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getDatabaseTempPath(databasePath: string): string {
  return `${databasePath}.tmp`;
}

function removeDatabaseTempFile(databasePath: string): void {
  const temporaryPath = getDatabaseTempPath(databasePath);
  if (existsSync(temporaryPath)) {
    unlinkSync(temporaryPath);
  }
}

function recoverDatabaseTempFile(databasePath: string): void {
  const temporaryPath = getDatabaseTempPath(databasePath);
  if (!existsSync(temporaryPath)) {
    return;
  }

  try {
    const raw = readFileSync(temporaryPath, "utf8").trim();
    const parsed = JSON.parse(raw) as unknown;
    assertPersistedStoreObject(parsed);
    assertSupportedDatabaseSchema(parsed.schemaVersion);
    renameSync(temporaryPath, databasePath);
  } catch (error) {
    removeDatabaseTempFile(databasePath);
    if (error instanceof SyntaxError) {
      throw new Error("The Creator Workbench database and its recovery file are invalid JSON.");
    }
    throw error;
  }
}

function readDatabaseText(databasePath: string): string {
  try {
    return readFileSync(databasePath, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read the Creator Workbench database: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function assertPersistedStoreObject(value: unknown): asserts value is PersistedStoreShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Creator Workbench database must contain a JSON object.");
  }
}

function assertPersistedCollectionShapes(store: PersistedStoreShape): void {
  const collectionKeys = [
    "workspaces",
    "clips",
    "jobs",
    "transcripts",
    "metadataPackages",
    "metadataVariants",
    "metadataFeedback",
    "youtubeVideoCache",
    "youtubeMetadataDrafts",
    "thumbnailCandidates",
    "youtubePerformanceSnapshots",
    "importedYouTubePerformanceRecords",
    "scheduledPosts",
    "longFormSources",
    "clipProposals",
    "clipProposalFeedback",
    "clipMetadata"
  ] as const;

  for (const key of collectionKeys) {
    const value = store[key as keyof PersistedStoreShape];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`The Creator Workbench database collection '${key}' is invalid; expected an array.`);
    }
  }

  if (store.appSettings !== undefined && (!store.appSettings || typeof store.appSettings !== "object" || Array.isArray(store.appSettings))) {
    throw new Error("The Creator Workbench database collection 'appSettings' is invalid; expected an object.");
  }
}

function assertSupportedDatabaseSchema(schemaVersion: unknown): void {
  if (schemaVersion === undefined) {
    return;
  }

  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new Error("The Creator Workbench database schema version is invalid.");
  }

  if (schemaVersion > CURRENT_DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `The Creator Workbench database was created by a newer app version (schema ${schemaVersion}). Update the app before opening it.`
    );
  }
}
