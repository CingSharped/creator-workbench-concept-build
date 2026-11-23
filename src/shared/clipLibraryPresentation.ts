import type { ClipRecord, ClipStatus, ScheduledPostRecord } from "./contracts";
import { getClipLibraryStatusKey } from "./workflowPresentation";

export type ClipLibraryFilter = "all" | ClipStatus;

export const CLIP_LIBRARY_FILTERS: Array<{ id: ClipLibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "imported", label: "Imported" },
  { id: "transcribed", label: "Transcribed" },
  { id: "metadata_ready", label: "Metadata ready" },
  { id: "scheduled", label: "Scheduled" },
  { id: "posted", label: "Posted" },
  { id: "failed", label: "Failed" }
];

export function isClipLibraryFilter(value: string | null): value is ClipLibraryFilter {
  return CLIP_LIBRARY_FILTERS.some((filter) => filter.id === value);
}

export function matchesClipLibraryFilter(
  clip: ClipRecord,
  filter: ClipLibraryFilter,
  scheduledPosts: ScheduledPostRecord[]
): boolean {
  return filter === "all" || getClipLibraryStatusKey(clip, scheduledPosts) === filter;
}

export function matchesClipLibrarySearch(clip: ClipRecord, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [clip.displayName, clip.sourcePath].join(" ").toLocaleLowerCase().includes(normalizedQuery);
}

export function filterClipLibrary(
  clips: ClipRecord[],
  filter: ClipLibraryFilter,
  query: string,
  scheduledPosts: ScheduledPostRecord[]
): ClipRecord[] {
  return clips.filter(
    (clip) => matchesClipLibraryFilter(clip, filter, scheduledPosts) && matchesClipLibrarySearch(clip, query)
  );
}

export function countClipLibraryByFilter(
  clips: ClipRecord[],
  scheduledPosts: ScheduledPostRecord[]
): Record<ClipLibraryFilter, number> {
  const counts: Record<ClipLibraryFilter, number> = {
    all: clips.length,
    imported: 0,
    transcribed: 0,
    metadata_ready: 0,
    scheduled: 0,
    posted: 0,
    failed: 0
  };

  for (const clip of clips) {
    counts[getClipLibraryStatusKey(clip, scheduledPosts)] += 1;
  }

  return counts;
}
