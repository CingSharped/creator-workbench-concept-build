import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DataHealthCategory,
  DataHealthIssue,
  DataHealthScanResult,
  DataManagementOperationResult,
  DataManagementSummary
} from "../../shared/contracts";
import { normalizeSourcePath } from "./clipRepository";
import { getDatabaseContext, readDatabase, updateDatabase } from "./database";
import { clearLongFormIndexes, clearWorkspaceClipIndexes } from "./workspaceCleanup";

const LAST_SCAN_AT_KEY = "data_management.last_scan_at";
const LAST_ORPHAN_COUNT_KEY = "data_management.last_orphan_count";
const LAST_CLEANUP_AT_KEY = "data_management.last_cleanup_at";
const LAST_OPERATION_AT_KEY = "data_management.last_operation_at";
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

const PROTECTED_HISTORY = "Retained history used by the workflow and AI feedback loop.";

export function getDataManagementSummary(): DataManagementSummary {
  const store = readDatabase();
  const archivedClipCount = store.clips.filter((clip) => clip.indexState === "archived").length;
  const archivedLongFormCount = store.longFormSources.filter((source) => source.indexState === "archived").length;
  const preservedHistoryCount =
    archivedClipCount +
    archivedLongFormCount +
    store.transcripts.length +
    store.metadataPackages.length +
    store.metadataVariants.length +
    store.metadataFeedback.length +
    store.youtubePerformanceSnapshots.length +
    store.scheduledPosts.length +
    store.clipProposals.length +
    store.clipProposalFeedback.length;

  return {
    activeClipLibraryCount: store.clips.filter((clip) => clip.indexState !== "archived").length,
    archivedClipLibraryCount: archivedClipCount,
    activeLongFormSourceCount: store.longFormSources.filter((source) => source.indexState !== "archived").length,
    archivedLongFormSourceCount: archivedLongFormCount,
    preservedHistoryCount,
    orphanedRecordCount: Number(store.appSettings[LAST_ORPHAN_COUNT_KEY]?.value ?? 0),
    lastScanAt: store.appSettings[LAST_SCAN_AT_KEY]?.value ?? null,
    lastCleanupAt: store.appSettings[LAST_CLEANUP_AT_KEY]?.value ?? null,
    lastOperationAt: store.appSettings[LAST_OPERATION_AT_KEY]?.value ?? null
  };
}

export async function scanDataHealth(): Promise<DataHealthScanResult> {
  const store = readDatabase();
  const issues: DataHealthIssue[] = [];
  const push = (
    category: DataHealthCategory,
    recordType: string,
    recordId: string,
    label: string,
    detail: string,
    safeToDelete = false,
    protectedReason: string | null = PROTECTED_HISTORY,
    reviewRequired = false
  ): void => {
    issues.push({
      id: `health:${category}:${recordType}:${recordId}`,
      category,
      label,
      detail,
      recordType,
      recordId,
      safeToDelete,
      reviewRequired,
      protectedReason: safeToDelete ? null : protectedReason
    });
  };

  const clipIds = new Set(store.clips.map((clip) => clip.id));
  const sourceIds = new Set(store.longFormSources.map((source) => source.id));
  const proposalIds = new Set(store.clipProposals.map((proposal) => proposal.id));

  for (const clip of store.clips) {
    if (!clip.id || !clip.sourcePath || clip.fileSizeBytes < 0 || (clip.durationMs !== null && clip.durationMs < 0)) {
      push(
        "invalid_record",
        "clip",
        clip.id || `missing-id-${clip.sourcePath}`,
        "Clip record needs repair",
        "The record is missing a stable ID/path or contains an invalid media measurement. It is protected until reviewed manually."
      );
    }
  }
  for (const source of store.longFormSources) {
    if (!source.id || !source.sourcePath || source.fileSizeBytes < 0 || (source.durationMs !== null && source.durationMs < 0)) {
      push(
        "invalid_record",
        "long-form source",
        source.id || `missing-id-${source.sourcePath}`,
        "Long-form source record needs repair",
        "The record is missing a stable ID/path or contains an invalid media measurement. It is protected until reviewed manually."
      );
    }
  }
  for (const job of store.jobs) {
    if (!job.id || !job.jobType) {
      push(
        "invalid_record",
        "job",
        job.id || "missing-id",
        "Job record needs repair",
        "The job is missing a stable ID or operation type and cannot be safely reconciled automatically."
      );
    }
  }
  const checkClipReference = (recordType: string, recordId: string, clipId: string): void => {
    if (!clipIds.has(clipId)) {
      push("broken_reference", recordType, recordId, `${recordType} has no clip owner`, `Clip ${clipId} is no longer present in the database.`);
    }
  };

  for (const record of store.metadataPackages) checkClipReference("metadata package", record.id, record.clipId);
  for (const record of store.metadataVariants) checkClipReference("metadata variant", record.id, record.clipId);
  for (const record of store.metadataFeedback) checkClipReference("metadata feedback", record.id, record.clipId);
  for (const record of store.youtubePerformanceSnapshots) checkClipReference("performance snapshot", record.id, record.clipId);
  for (const record of store.scheduledPosts) checkClipReference("scheduled post", record.id, record.clipId);

  for (const transcript of store.transcripts) {
    const owner = transcript.assetType === "long_form_source"
      ? store.longFormSources.find((source) => source.id === transcript.assetId)
      : store.clips.find((clip) => clip.id === transcript.assetId);
    if (!owner) {
      push(
        "broken_reference",
        "transcript",
        transcript.id,
        `${transcript.assetType} transcript has no owner`,
        `The transcript points to ${transcript.assetType} ${transcript.assetId}, which is not present.`
      );
      continue;
    }

    if (!(await fileExists(owner.sourcePath))) {
      push(
        "missing_source_file",
        `${transcript.assetType} transcript`,
        transcript.id,
        `${transcript.assetType === "long_form_source" ? "Long-form" : "Clip"} transcript retained without its source file`,
        `The transcript and timed data are still stored, but the source video is missing at ${owner.sourcePath}.`,
        false,
        "Protected transcript history. The source file is needed for re-transcription, visual analysis, or media export."
      );
    }
  }

  for (const proposal of store.clipProposals) {
    if (!sourceIds.has(proposal.sourceId)) {
      push("broken_reference", "clip proposal", proposal.id, "Clip proposal has no source", `Long-form source ${proposal.sourceId} is no longer present.`);
    }
    if (proposal.approvedClipId && !clipIds.has(proposal.approvedClipId)) {
      push(
        "broken_reference",
        "clip proposal",
        proposal.id,
        "Approved proposal has no clip",
        `The proposal points to approved clip ${proposal.approvedClipId}, which is no longer present. The decision history is preserved.`
      );
    }
  }
  for (const clip of store.clips) {
    if (!clip.lineage) {
      continue;
    }

    const source = store.longFormSources.find((item) => item.id === clip.lineage?.sourceId);
    const proposal = store.clipProposals.find((item) => item.id === clip.lineage?.proposalId);
    if (!source || !proposal || proposal.sourceId !== source.id || proposal.approvedClipId !== clip.id) {
      push(
        "broken_reference",
        "clip lineage",
        clip.id,
        `${clip.displayName} has incomplete long-form lineage`,
        "The approved clip does not point to a matching long-form source and approved proposal. The clip and history are preserved for review."
      );
    }
  }
  for (const feedback of store.clipProposalFeedback) {
    if (!proposalIds.has(feedback.proposalId) || !sourceIds.has(feedback.sourceId)) {
      push(
        "historical_unlinked",
        "clip proposal feedback",
        feedback.id,
        "Historical proposal feedback is unlinked",
        "The decision record is retained as AI-learning history even though its current proposal or source is unavailable.",
        false,
        "Protected AI-learning and decision history. Review manually if it ever needs to be removed."
      );
    }
  }

  for (const clip of store.clips) {
    if (!(await fileExists(clip.sourcePath))) {
      push("missing_source_file", "clip", clip.id, `${clip.displayName} is missing`, clip.sourcePath);
    }
  }
  for (const source of store.longFormSources) {
    if (!(await fileExists(source.sourcePath))) {
      push("missing_source_file", "long-form source", source.id, `${source.displayName} is missing`, source.sourcePath);
    }
  }

  addDuplicatePathIssues(store.clips, "clip", push);
  addDuplicatePathIssues(store.longFormSources, "long-form source", push);

  for (const job of store.jobs) {
    if (!TERMINAL_JOB_STATUSES.has(job.status)) continue;
    const ownerType = job.assetType ?? (job.jobType.includes("long_form") ? "long_form_source" : job.clipId ? "clip" : "workspace");
    const ownerId = job.assetId ?? job.clipId;
    if (ownerType === "workspace") continue;
    const ownerExists = ownerType === "long_form_source" ? sourceIds.has(ownerId ?? "") : clipIds.has(ownerId ?? "");
    if (!ownerExists) {
      push(
        "completed_job_without_owner",
        "job",
        job.id,
        "Completed job has no owner",
        `${job.jobType} points to missing ${ownerType === "long_form_source" ? "long-form source" : "clip"} ${ownerId ?? "(none)"}.`,
        true
      );
    }
  }

  const scannedAt = new Date().toISOString();
  const categoryCounts = emptyCategoryCounts();
  for (const issue of issues) categoryCounts[issue.category] += 1;
  const result: DataHealthScanResult = {
    scannedAt,
    issues,
    categoryCounts,
    safeIssueIds: issues.filter((issue) => issue.safeToDelete).map((issue) => issue.id),
    warnings: issues.length > 0 ? ["Missing files and historical records are reported for review and are not disposable by default."] : []
  };

  updateDatabase((nextStore) => {
    const now = new Date().toISOString();
    nextStore.appSettings[LAST_SCAN_AT_KEY] = { value: scannedAt, updatedAt: now };
    nextStore.appSettings[LAST_ORPHAN_COUNT_KEY] = { value: String(issues.length), updatedAt: now };
  });
  return result;
}

export async function clearClipLibraryIndex(): Promise<DataManagementOperationResult> {
  const archiveResult = clearWorkspaceClipIndexes();
  return finishOperation(archiveResult.affectedCount, archiveResult.skippedActiveJobs, archiveResult.preservedCategories, archiveResult.warnings);
}

export async function clearLongFormIndex(): Promise<DataManagementOperationResult> {
  const archiveResult = clearLongFormIndexes();
  return finishOperation(archiveResult.affectedCount, archiveResult.skippedActiveJobs, archiveResult.preservedCategories, archiveResult.warnings);
}

export async function cleanupOrphanedData(issueIds: string[]): Promise<DataManagementOperationResult> {
  const store = readDatabase();
  const activeJobs = store.jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
  if (activeJobs.length > 0) {
    throw new Error("Finish or cancel active transcription, proposal, upload, or export jobs before permanent cleanup.");
  }

  const scan = await scanDataHealth();
  const selected = scan.issues.filter((issue) => issueIds.includes(issue.id));
  const selectedDuplicateIssues = selected.filter((issue) => issue.category === "duplicate_source_path");
  validateDuplicateSelections(store, selectedDuplicateIssues);
  const deletable = selected.filter((issue) => issue.safeToDelete && (issue.recordType === "job" || issue.category === "duplicate_source_path"));
  const skippedProtected = selected.length - deletable.length;
  if (deletable.length > 0) {
    const { databasePath } = getDatabaseContext();
    const backupDirectory = path.join(path.dirname(databasePath), "backups");
    const backupPath = path.join(backupDirectory, `creator-workspace-before-cleanup-${Date.now()}.json`);
    await mkdir(backupDirectory, { recursive: true });
    await copyFile(databasePath, backupPath);
    const deletableIds = new Set(deletable.filter((issue) => issue.recordType === "job").map((issue) => issue.recordId));
    const duplicateRemaps = buildDuplicateRemaps(store, selectedDuplicateIssues);
    updateDatabase((nextStore) => {
      nextStore.jobs = nextStore.jobs.filter((job) => !deletableIds.has(job.id));
      for (const [duplicateId, keeperId] of duplicateRemaps.clips) {
        for (const record of nextStore.transcripts) {
          if (record.assetType === "clip" && record.assetId === duplicateId) record.assetId = keeperId;
          if (record.clipId === duplicateId) record.clipId = keeperId;
        }
        for (const record of nextStore.metadataPackages) if (record.clipId === duplicateId) record.clipId = keeperId;
        for (const record of nextStore.metadataVariants) if (record.clipId === duplicateId) record.clipId = keeperId;
        for (const record of nextStore.metadataFeedback) if (record.clipId === duplicateId) record.clipId = keeperId;
        for (const record of nextStore.youtubePerformanceSnapshots) if (record.clipId === duplicateId) record.clipId = keeperId;
        for (const record of nextStore.scheduledPosts) if (record.clipId === duplicateId) record.clipId = keeperId;
        for (const job of nextStore.jobs) if (job.clipId === duplicateId && !job.jobType.includes("long_form")) job.clipId = keeperId;
        for (const feedback of nextStore.clipProposalFeedback) if (feedback.approvedClipId === duplicateId) feedback.approvedClipId = keeperId;
      }
      for (const [duplicateId, keeperId] of duplicateRemaps.longFormSources) {
        for (const record of nextStore.transcripts) {
          if (record.assetType === "long_form_source" && record.assetId === duplicateId) record.assetId = keeperId;
          if (record.clipId === duplicateId) record.clipId = keeperId;
        }
        for (const proposal of nextStore.clipProposals) if (proposal.sourceId === duplicateId) proposal.sourceId = keeperId;
        for (const feedback of nextStore.clipProposalFeedback) if (feedback.sourceId === duplicateId) feedback.sourceId = keeperId;
        for (const job of nextStore.jobs) if (job.clipId === duplicateId && job.jobType.includes("long_form")) job.clipId = keeperId;
      }
      const duplicateClipIds = new Set(duplicateRemaps.clips.keys());
      const duplicateSourceIds = new Set(duplicateRemaps.longFormSources.keys());
      nextStore.clips = nextStore.clips.filter((clip) => !duplicateClipIds.has(clip.id));
      nextStore.longFormSources = nextStore.longFormSources.filter((source) => !duplicateSourceIds.has(source.id));
    });
  }

  const warnings = skippedProtected > 0
    ? [`${skippedProtected} selected record${skippedProtected === 1 ? " was" : "s were"} protected and not deleted.`]
    : [];
  return finishOperation(
    deletable.length,
    0,
    ["AI profile instructions and knowledge", "AI models and runtime files", "Performance history", "Proposal and metadata feedback", "Video files"],
    warnings
  );
}

function finishOperation(
  affectedCount: number,
  skippedActiveJobs: number,
  preservedCategories: string[],
  warnings: string[]
): DataManagementOperationResult {
  updateDatabase((store) => {
    const now = new Date().toISOString();
    store.appSettings[LAST_OPERATION_AT_KEY] = { value: now, updatedAt: now };
    if (affectedCount > 0 && warnings.length === 0) {
      store.appSettings[LAST_CLEANUP_AT_KEY] = { value: now, updatedAt: now };
    }
  });
  return { affectedCount, skippedActiveJobs, preservedCategories, warnings, summary: getDataManagementSummary() };
}

function emptyCategoryCounts(): Record<DataHealthCategory, number> {
  return {
    invalid_record: 0,
    broken_reference: 0,
    historical_unlinked: 0,
    missing_source_file: 0,
    duplicate_source_path: 0,
    completed_job_without_owner: 0
  };
}

function addDuplicatePathIssues<T extends { id: string; sourcePath: string; displayName: string }>(
  records: T[],
  recordType: string,
  push: (
    category: DataHealthCategory,
    recordType: string,
    recordId: string,
    label: string,
    detail: string,
    safeToDelete?: boolean,
    protectedReason?: string | null,
    reviewRequired?: boolean
  ) => void
): void {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = normalizeSourcePath(record.sourcePath);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const [sourcePath, group] of groups) {
    if (group.length < 2) continue;
    for (const record of group) {
      push("duplicate_source_path", recordType, record.id, `${record.displayName} shares a source path`, `${sourcePath} is used by ${group.length} ${recordType} records. Select this record to remove it and preserve the other record's history.`, true, null, true);
    }
  }
}

function validateDuplicateSelections(
  store: ReturnType<typeof readDatabase>,
  selectedIssues: DataHealthIssue[]
): void {
  const selectedIds = new Set(selectedIssues.map((issue) => issue.recordId));
  const groups = new Map<string, string[]>();
  for (const record of [...store.clips, ...store.longFormSources]) {
    const type = "workspaceId" in record ? "clip" : "long-form source";
    const key = `${type}:${normalizeSourcePath(record.sourcePath)}`;
    groups.set(key, [...(groups.get(key) ?? []), record.id]);
  }
  for (const issue of selectedIssues) {
    const type = issue.recordType;
    const record = type === "clip"
      ? store.clips.find((candidate) => candidate.id === issue.recordId)
      : store.longFormSources.find((candidate) => candidate.id === issue.recordId);
    if (!record) continue;
    const key = `${type}:${normalizeSourcePath(record.sourcePath)}`;
    const group = groups.get(key) ?? [];
    if (group.every((id) => selectedIds.has(id))) {
      throw new Error(`Keep at least one ${type} record for ${record.sourcePath}; select only the duplicate record you want to remove.`);
    }
  }
}

function buildDuplicateRemaps(
  store: ReturnType<typeof readDatabase>,
  selectedIssues: DataHealthIssue[]
): { clips: Map<string, string>; longFormSources: Map<string, string> } {
  const selectedIds = new Set(selectedIssues.map((issue) => issue.recordId));
  const clips = new Map<string, string>();
  const longFormSources = new Map<string, string>();
  for (const issue of selectedIssues) {
    const records = issue.recordType === "clip" ? store.clips : store.longFormSources;
    const duplicate = records.find((record) => record.id === issue.recordId);
    if (!duplicate) continue;
    const keeper = records
      .filter((record) => record.id !== duplicate.id && !selectedIds.has(record.id) && normalizeSourcePath(record.sourcePath) === normalizeSourcePath(duplicate.sourcePath))
      .sort((left, right) => Number(right.indexState === "active") - Number(left.indexState === "active") || left.importedAt.localeCompare(right.importedAt))[0];
    if (!keeper) continue;
    (issue.recordType === "clip" ? clips : longFormSources).set(duplicate.id, keeper.id);
  }
  return { clips, longFormSources };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
