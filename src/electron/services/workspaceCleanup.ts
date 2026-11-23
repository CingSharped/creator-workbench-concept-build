import { updateDatabase } from "./database";
import { recordWorkspaceIndexActivity } from "./workspaceIndexStatus";

export interface ArchiveIndexResult {
  affectedCount: number;
  skippedActiveJobs: number;
  preservedCategories: string[];
  warnings: string[];
}

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

export function removeClipFromWorkspaceIndex(clipId: string): ArchiveIndexResult {
  const result = archiveClipLibraryRecords([clipId]);
  if (result.affectedCount > 0) {
    recordWorkspaceIndexActivity(`Archived ${result.affectedCount} clip from the active workspace index.`);
  }
  return result;
}

export function clearWorkspaceClipIndexes(): ArchiveIndexResult {
  const result = archiveClipLibraryRecords();
  recordWorkspaceIndexActivity(
    `Archived ${result.affectedCount} indexed clip${result.affectedCount === 1 ? "" : "s"} from the active workspace.`
  );
  return result;
}

export function clearLongFormIndexes(): ArchiveIndexResult {
  return updateDatabase((store) => {
    const activeSources = store.longFormSources.filter((source) => source.indexState !== "archived");
    const activeSourceIds = new Set(activeSources.map((source) => source.id));
    const activeJobSourceIds = new Set(
      store.jobs
        .filter((job) => ACTIVE_JOB_STATUSES.has(job.status) && job.clipId && activeSourceIds.has(job.clipId))
        .map((job) => job.clipId as string)
    );
    const now = new Date().toISOString();
    let affectedCount = 0;

    for (const source of activeSources) {
      if (activeJobSourceIds.has(source.id)) {
        continue;
      }
      source.indexState = "archived";
      source.archivedAt = now;
      source.updatedAt = now;
      affectedCount += 1;
    }

    return {
      affectedCount,
      skippedActiveJobs: activeJobSourceIds.size,
      preservedCategories: [
        "Original source files",
        "Long-form transcripts",
        "Clip proposals and approval/rejection history",
        "Approved clips in the Clip Library"
      ],
      warnings: activeJobSourceIds.size > 0
        ? [`${activeJobSourceIds.size} long-form source${activeJobSourceIds.size === 1 ? " was" : "s were"} kept active because work is still running.`]
        : []
    };
  });
}

function archiveClipLibraryRecords(clipIds?: string[]): ArchiveIndexResult {
  return updateDatabase((store) => {
    const activeClips = store.clips.filter((clip) =>
      clip.indexState !== "archived" && (!clipIds || clipIds.includes(clip.id))
    );
    const activeClipIds = new Set(activeClips.map((clip) => clip.id));
    const activeJobClipIds = new Set(
      store.jobs
        .filter((job) => ACTIVE_JOB_STATUSES.has(job.status) && job.clipId && activeClipIds.has(job.clipId))
        .map((job) => job.clipId as string)
    );
    const now = new Date().toISOString();
    let affectedCount = 0;

    for (const clip of activeClips) {
      if (activeJobClipIds.has(clip.id)) {
        continue;
      }
      clip.indexState = "archived";
      clip.archivedAt = now;
      clip.updatedAt = now;
      affectedCount += 1;
    }

    return {
      affectedCount,
      skippedActiveJobs: activeJobClipIds.size,
      preservedCategories: [
        "Video files",
        "Transcripts and SRT data",
        "Metadata packages and feedback",
        "Schedules and performance snapshots",
        "Jobs and proposal history"
      ],
      warnings: activeJobClipIds.size > 0
        ? [`${activeJobClipIds.size} clip${activeJobClipIds.size === 1 ? " was" : "s were"} kept active because work is still running.`]
        : []
    };
  });
}
