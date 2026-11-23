import type {
  ClipRecord,
  ClipStatus,
  PerformanceDashboardFilters,
  ScheduledPostRecord,
  YouTubePerformanceSnapshotRecord
} from "./contracts";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(durationMs: number | null): string {
  if (!durationMs) {
    return "Unknown";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(seconds);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function formatShortTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatMetricNumber(value: number | null): string {
  return value === null || Number.isNaN(value) ? "Unavailable" : value.toLocaleString();
}

export function formatMetricSeconds(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`;
}

export function formatMetricPercentage(value: number | null): string {
  return value === null || Number.isNaN(value) ? "Unavailable" : `${value.toFixed(1)}%`;
}

export function getLatestYouTubeScheduledPost(
  scheduledPosts: ScheduledPostRecord[],
  clipId: string | null
): ScheduledPostRecord | null {
  if (!clipId) {
    return null;
  }

  return [...scheduledPosts]
    .filter((post) => post.clipId === clipId && post.platform === "youtube")
    .sort((left, right) => right.publishAt.localeCompare(left.publishAt))[0] ?? null;
}

export interface ClipLibraryStatusDisplay {
  label: string;
  tone: "scheduled" | "posted" | "failed" | null;
}

export function getClipLibraryStatusKey(
  clip: ClipRecord,
  scheduledPosts: ScheduledPostRecord[]
): ClipStatus {
  const clipPosts = scheduledPosts.filter((post) => post.clipId === clip.id);
  if (clipPosts.some((post) => post.status === "posted")) {
    return "posted";
  }
  if (clipPosts.some((post) => post.status === "scheduled" || post.status === "posting")) {
    return "scheduled";
  }
  if (clipPosts.some((post) => post.status === "failed")) {
    return "failed";
  }

  return clip.status;
}

export function getClipLibraryStatus(
  clip: ClipRecord,
  scheduledPosts: ScheduledPostRecord[]
): ClipLibraryStatusDisplay {
  switch (getClipLibraryStatusKey(clip, scheduledPosts)) {
    case "transcribed":
      return { label: "Transcribed", tone: null };
    case "metadata_ready":
      return { label: "Metadata ready", tone: null };
    case "scheduled":
      return { label: "Scheduled", tone: "scheduled" };
    case "posted":
      return { label: "Posted", tone: "posted" };
    case "failed":
      return { label: "Failed", tone: "failed" };
    case "imported":
      return { label: "Imported", tone: null };
  }
}

export function sortPerformanceSnapshots(
  snapshots: YouTubePerformanceSnapshotRecord[]
): YouTubePerformanceSnapshotRecord[] {
  return [...snapshots].sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
}

export function createDefaultPerformanceFilters(): PerformanceDashboardFilters {
  return {
    range: "28d",
    format: "all",
    gameTitle: "",
    seriesKey: "",
    metric: "engaged_views"
  };
}

export function arePerformanceFiltersEqual(
  left: PerformanceDashboardFilters,
  right: PerformanceDashboardFilters
): boolean {
  return left.range === right.range &&
    left.format === right.format &&
    left.gameTitle === right.gameTitle &&
    left.seriesKey === right.seriesKey &&
    left.metric === right.metric;
}
