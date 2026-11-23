import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ImportedYouTubePerformanceRecord,
  OwnedPerformanceSnapshotRecord,
  PerformanceDashboardFilters,
  PerformanceDashboardResult,
  PerformanceFormat,
  PerformanceHistoryImportResult,
  PerformanceRange,
  PerformanceRecommendation,
  PerformanceChannelProfile,
  PerformanceBreakdownEntry,
  PerformanceCoachAction,
  PerformanceCoachFocus,
  PerformanceCoachInsight,
  PerformanceCoachResult,
  PerformanceEvidenceReference,
  PerformanceLaneBreakdown,
  PerformanceMetricSummary,
  PerformancePeriodSummary,
  PerformanceRetentionPoint,
  PerformanceTimelinePoint,
  PerformanceTrafficSourceBreakdown,
  PerformanceVideoDetail,
  PerformanceInsightConfidence,
  PerformanceInsightType
} from "../../shared/contracts";
import { parseJsonResponse } from "../../shared/jsonResponse";
import { isStrictAiModeEnabled, resolveAiProfileForTask } from "./aiProfileService";
import { buildAiProfileLearningPrompt } from "./aiProfileLearningService";
import { listClipMetadataPackages } from "./clipMetadataRepository";
import { listClips } from "./clipRepository";
import {
  listImportedYouTubePerformanceRecords,
  upsertImportedYouTubePerformanceRecords
} from "./importedYouTubePerformanceRepository";
import { listScheduledPosts } from "./scheduledPostRepository";
import { getAppSetting, setAppSetting } from "./settingsRepository";
import { listYouTubePerformanceSnapshots, upsertYouTubePerformanceSnapshot } from "./youtubePerformanceSnapshotRepository";
import {
  fetchYouTubePerformanceSnapshots,
  fetchYouTubePerformanceSnapshot,
  fetchYouTubeAnalyticsReport,
  fetchYouTubeChannelProfile,
  getYouTubeConnectionStatus,
  listOwnedYouTubeChannelVideos
} from "./youtubeService";
import { generateAiText } from "./aiExecutionService";
import { setAiActivityDetail } from "./aiActivityService";

const PERFORMANCE_FILTERS_KEY = "performance.dashboard_filters";
const PERFORMANCE_HISTORY_IMPORT_START_DATE_KEY = "performance.history_import_start_date";
const PERFORMANCE_OWNED_STALE_MS = 6 * 60 * 60 * 1000;
const PERFORMANCE_CHANNEL_STALE_MS = 24 * 60 * 60 * 1000;
const PERFORMANCE_BREAKDOWNS_STALE_MS = 6 * 60 * 60 * 1000;
const PERFORMANCE_CHANNEL_PROFILE_KEY = "performance.channel_profile";
const PERFORMANCE_TIMELINE_KEY = "performance.channel_timeline";
const PERFORMANCE_BREAKDOWNS_KEY = "performance.channel_breakdowns";
const DEFAULT_HISTORY_IMPORT_START_DATE = "2025-01-01";
const DEFAULT_HISTORY_IMPORT_VIDEO_LIMIT = 150;
const MAX_OWNED_REFRESH_POSTS = 20;
const OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
const OLLAMA_PERFORMANCE_MODEL_PREFERENCE = [
  "qwen3:14b",
  "mistral-small:24b",
  "gemma3:12b",
  "qwen3:8b",
  "gemma3:4b",
  "llama3.1:8b",
  "llama3.1:8b-instruct-q8_0"
];
const OLLAMA_EXECUTABLE_PATHS = [
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe"),
  path.join("C:\\", "Program Files", "Ollama", "ollama.exe")
];
const OLLAMA_START_RETRY_MS = 1000;
const OLLAMA_START_ATTEMPTS = 10;
const OLLAMA_DISCOVERY_TIMEOUT_MS = 5000;
const OLLAMA_GENERATE_TIMEOUT_MS = 45000;
const COMMON_PACKAGING_STOP_WORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "your",
  "just",
  "into",
  "when",
  "what",
  "have",
  "gets",
  "game",
  "gaming",
  "video",
  "shorts",
  "short",
  "clip"
]);

interface OllamaModelTagResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

interface PerformanceTimelineCache {
  channelId: string;
  range: PerformanceRange;
  fetchedAt: string;
  current: PerformanceTimelinePoint[];
  previous: PerformanceTimelinePoint[];
}

interface PerformanceBreakdownCache {
  channelId: string;
  range: PerformanceRange;
  fetchedAt: string;
  trafficSources: PerformanceTrafficSourceBreakdown[];
  devices: PerformanceBreakdownEntry[];
  subscriberStatus: PerformanceBreakdownEntry[];
}

interface PerformanceCoachRawInsight {
  type?: unknown;
  title?: unknown;
  explanation?: unknown;
  confidence?: unknown;
  evidenceIds?: unknown;
  action?: unknown;
}

interface PerformanceCoachRawResponse {
  summary?: unknown;
  limitations?: unknown;
  insights?: unknown;
}

let ollamaStartPromise: Promise<void> | null = null;

export function getPerformanceDashboard(
  filters?: Partial<PerformanceDashboardFilters>
): PerformanceDashboardResult {
  const normalizedFilters = resolvePerformanceDashboardFilters(filters);

  const connection = getYouTubeConnectionStatus();
  const historyImportStartDate = readSavedPerformanceHistoryImportStartDate();
  const historicalRecords = listImportedYouTubePerformanceRecords();
  const allOwnedSnapshots = buildAllOwnedPerformanceSnapshots(historicalRecords, connection.channelId);
  const ownedSnapshots = filterOwnedPerformanceSnapshots(allOwnedSnapshots, normalizedFilters);
  const ownedLastFetchedAt = getLatestFetchedAt(ownedSnapshots.map((record) => record.fetchedAt));
  const channelProfile = readPerformanceChannelProfile(connection.channelId);
  const timelineCache = readPerformanceTimelineCache(connection.channelId, normalizedFilters.range);
  const breakdownCache = readPerformanceBreakdownCache(connection.channelId, normalizedFilters.range);
  const overview = buildPerformanceOverview({
    ownedSnapshots,
    allOwnedSnapshots,
    filters: normalizedFilters,
    timeline: timelineCache
  });
  const availableGameTitles = collectAvailableValues(
    [...listClipMetadataPackages().map((record) => record.gameTitle), ...allOwnedSnapshots.map((record) => record.gameTitle)]
  );
  const availableSeriesKeys = collectAvailableValues(
    [...listClipMetadataPackages().map((record) => record.seriesKey), ...allOwnedSnapshots.map((record) => record.seriesKey)]
  );

  return {
    filters: normalizedFilters,
    youtubeConnected: connection.connected,
    analyticsScopeGranted: connection.analyticsScopeGranted,
    ownedLastFetchedAt,
    historicalImportStartDate: historyImportStartDate,
    historicalImportVideoLimit: DEFAULT_HISTORY_IMPORT_VIDEO_LIMIT,
    historicalImportedVideoCount: historicalRecords.length,
    historicalImportLastFetchedAt: getLatestFetchedAt(
      historicalRecords.map((record) => record.fetchedAt)
    ),
    requiresOwnedRefresh:
      connection.connected &&
      connection.analyticsScopeGranted &&
      shouldRefreshOwnedSnapshots(normalizedFilters, ownedSnapshots, ownedLastFetchedAt),
    availableGameTitles,
    availableSeriesKeys,
    ownedSnapshots,
    recommendations: buildPerformanceRecommendations({
      ownedSnapshots
    }),
    channelProfile,
    overview,
    timeline: timelineCache?.current ?? buildTimelineFromSnapshots(ownedSnapshots),
    laneBreakdowns: buildPerformanceLaneBreakdowns(ownedSnapshots),
    trafficSources: breakdownCache?.trafficSources ?? [],
    devices: breakdownCache?.devices ?? [],
    subscriberStatus: breakdownCache?.subscriberStatus ?? [],
    freshness: buildPerformanceFreshness({
      channelProfile,
      ownedLastFetchedAt,
      breakdownCache,
      connection
    })
  };
}

export async function refreshPerformanceDashboard(
  filters?: Partial<PerformanceDashboardFilters>
): Promise<PerformanceDashboardResult> {
  const normalizedFilters = resolvePerformanceDashboardFilters(filters);
  persistPerformanceDashboardFilters(normalizedFilters);

  const connection = getYouTubeConnectionStatus();
  if (connection.connected) {
    const channelProfile = await fetchYouTubeChannelProfile();
    savePerformanceChannelProfile(channelProfile);

    if (connection.analyticsScopeGranted) {
      await refreshPerformanceAnalyticsCaches(normalizedFilters, channelProfile.channelId);
    }
  }

  if (connection.connected && connection.analyticsScopeGranted) {
    await refreshOwnedPerformanceSnapshots(normalizedFilters);
  }

  return getPerformanceDashboard(normalizedFilters);
}

export async function importYouTubeHistoricalPerformance(input?: {
  publishedAfter?: string;
  maxVideos?: number;
}): Promise<PerformanceHistoryImportResult> {
  const connection = getYouTubeConnectionStatus();
  if (!connection.connected) {
    throw new Error("Connect your YouTube account in Settings before importing channel history.");
  }

  if (!connection.analyticsScopeGranted) {
    throw new Error(
      "Reconnect YouTube in Settings to grant YouTube Analytics access before importing channel history."
    );
  }

  const publishedAfter = normalizeHistoryImportStartDate(
    input?.publishedAfter ?? readSavedPerformanceHistoryImportStartDate()
  );
  const maxVideos = normalizeHistoryImportVideoLimit(input?.maxVideos);
  persistPerformanceHistoryImportStartDate(publishedAfter);

  const channelVideos = await listOwnedYouTubeChannelVideos({
    publishedAfter,
    maxResults: maxVideos
  });
  const analyticsByVideoId = new Map(
    (
      await fetchYouTubePerformanceSnapshots({
        videoIds: channelVideos.videos.map((video) => video.videoId),
        startDate: publishedAfter
      })
    ).map((snapshot) => [snapshot.videoId, snapshot])
  );
  const existingRecordsByVideoId = new Map(
    listImportedYouTubePerformanceRecords().map((record) => [record.videoId, record])
  );

  upsertImportedYouTubePerformanceRecords(
    channelVideos.videos.map((video) => {
      const analytics = analyticsByVideoId.get(video.videoId);
      return {
        videoId: video.videoId,
        channelId: connection.channelId,
        title: video.title,
        channelTitle: video.channelTitle,
        publishedAt: video.publishedAt,
        publishedUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
        durationSeconds: video.durationSeconds,
        thumbnailUrl: video.thumbnailUrl,
        tags: video.tags,
        views: analytics?.views ?? video.viewCount,
        engagedViews: analytics?.engagedViews ?? null,
        estimatedMinutesWatched: analytics?.estimatedMinutesWatched ?? null,
        averageViewDuration: analytics?.averageViewDuration ?? null,
        averageViewPercentage: analytics?.averageViewPercentage ?? null,
        likes: analytics?.likes ?? video.likeCount,
        comments: analytics?.comments ?? video.commentCount,
        shares: analytics?.shares ?? null,
        subscribersGained: analytics?.subscribersGained ?? null,
        subscribersLost: analytics?.subscribersLost ?? null,
        viewerPercentage: analytics?.viewerPercentage ?? null
      };
    })
  );

  const newestPublishedAt = channelVideos.videos[0]?.publishedAt ?? null;
  const oldestPublishedAt = channelVideos.videos[channelVideos.videos.length - 1]?.publishedAt ?? null;
  const updatedVideoCount = channelVideos.videos.filter((video) =>
    existingRecordsByVideoId.has(video.videoId)
  ).length;
  const newVideoCount = Math.max(0, channelVideos.videos.length - updatedVideoCount);

  return {
    importedVideoCount: channelVideos.videos.length,
    newVideoCount,
    updatedVideoCount,
    publishedAfter,
    maxVideos,
    cappedByLimit: channelVideos.cappedByLimit,
    newestPublishedAt,
    oldestPublishedAt,
    fetchedAt: new Date().toISOString()
  };
}

function resolvePerformanceDashboardFilters(
  filters?: Partial<PerformanceDashboardFilters>
): PerformanceDashboardFilters {
  const saved = readSavedPerformanceDashboardFilters();
  const merged = { ...saved, ...filters };

  return normalizePerformanceDashboardFilters(merged);
}

function normalizePerformanceDashboardFilters(
  filters: Partial<PerformanceDashboardFilters>
): PerformanceDashboardFilters {
  return {
    range: normalizeRange(filters.range),
    format: normalizeFormat(filters.format),
    gameTitle: (filters.gameTitle ?? "").trim(),
    seriesKey: (filters.seriesKey ?? "").trim(),
    metric: normalizeMetric(filters.metric)
  };
}

function readSavedPerformanceDashboardFilters(): PerformanceDashboardFilters {
  const raw = getAppSetting(PERFORMANCE_FILTERS_KEY);
  if (!raw) {
    return getDefaultPerformanceDashboardFilters();
  }

  try {
    return normalizePerformanceDashboardFilters(JSON.parse(raw) as Partial<PerformanceDashboardFilters>);
  } catch {
    return getDefaultPerformanceDashboardFilters();
  }
}

function persistPerformanceDashboardFilters(filters: PerformanceDashboardFilters): void {
  setAppSetting(
    PERFORMANCE_FILTERS_KEY,
    JSON.stringify({
      range: filters.range,
      format: filters.format,
      gameTitle: filters.gameTitle,
      seriesKey: filters.seriesKey,
      metric: filters.metric
    })
  );
}

function readSavedPerformanceHistoryImportStartDate(): string {
  return normalizeHistoryImportStartDate(getAppSetting(PERFORMANCE_HISTORY_IMPORT_START_DATE_KEY));
}

function persistPerformanceHistoryImportStartDate(value: string): void {
  setAppSetting(
    PERFORMANCE_HISTORY_IMPORT_START_DATE_KEY,
    normalizeHistoryImportStartDate(value)
  );
}

function getDefaultPerformanceDashboardFilters(): PerformanceDashboardFilters {
  return {
    range: "28d",
    format: "all",
    gameTitle: "",
    seriesKey: "",
    metric: "engaged_views"
  };
}

function buildAllOwnedPerformanceSnapshots(
  historicalRecords: ImportedYouTubePerformanceRecord[],
  activeChannelId: string | null = null
): OwnedPerformanceSnapshotRecord[] {
  const clipsById = new Map(listClips().map((clip) => [clip.id, clip]));
  const metadataPackages = listClipMetadataPackages();
  const metadataByClipId = new Map(metadataPackages.map((record) => [record.clipId, record]));
  const snapshotsByScheduledPostId = new Map(
    listYouTubePerformanceSnapshots().map((snapshot) => [snapshot.scheduledPostId, snapshot])
  );
  const knownGameTitles = collectAvailableValues(metadataPackages.map((record) => record.gameTitle));
  const knownSeriesKeys = collectAvailableValues(metadataPackages.map((record) => record.seriesKey));

  const workspaceSnapshots = listScheduledPosts()
    .filter((post) => post.platform === "youtube")
    .filter((post) => !activeChannelId || post.channelId === activeChannelId)
    .map((post) => {
      const clip = clipsById.get(post.clipId);
      const metadata = metadataByClipId.get(post.clipId);
      const snapshot = snapshotsByScheduledPostId.get(post.id) ?? null;
      const gameTitle = metadata?.gameTitle?.trim() ?? "";
      const seriesKey = metadata?.seriesKey?.trim() ?? "";
      const format = classifyPerformanceFormat(clip?.durationMs ?? null);
      const ageDays = computeAgeDays(post.publishAt);
      const performanceScore = computePerformanceScore(snapshot, post.publishAt);

      const record: OwnedPerformanceSnapshotRecord = {
        id: `workspace:${post.id}`,
        source: "workspace_post",
        clipId: post.clipId,
        scheduledPostId: post.id,
        videoId: post.remotePostId ?? snapshot?.videoId ?? "",
        channelId: post.channelId ?? snapshot?.channelId ?? activeChannelId,
        clipDisplayName: clip?.displayName ?? "Removed clip",
        title: post.title,
        publishedUrl: post.publishedUrl,
        channelTitle: null,
        gameTitle,
        seriesKey,
        tags: [],
        thumbnailUrl: null,
        publishAt: post.publishAt,
        format,
        ageDays,
        performanceScore,
        views: snapshot?.views ?? null,
        engagedViews: snapshot?.engagedViews ?? null,
        estimatedMinutesWatched: snapshot?.estimatedMinutesWatched ?? null,
        averageViewDuration: snapshot?.averageViewDuration ?? null,
        averageViewPercentage: snapshot?.averageViewPercentage ?? null,
        likes: snapshot?.likes ?? null,
        comments: snapshot?.comments ?? null,
        shares: snapshot?.shares ?? null,
        subscribersGained: snapshot?.subscribersGained ?? null,
        subscribersLost: snapshot?.subscribersLost ?? null,
        viewerPercentage: snapshot?.viewerPercentage ?? null,
        classificationSource: gameTitle || seriesKey ? "metadata" : "unknown",
        fetchedAt: snapshot?.fetchedAt ?? null
      };

      return record;
    });
  const workspaceVideoIds = new Set(
    workspaceSnapshots.map((record) => record.videoId.trim()).filter(Boolean)
  );
  const historicalSnapshots = historicalRecords
    .filter((record) => !activeChannelId || record.channelId === activeChannelId)
    .filter((record) => !workspaceVideoIds.has(record.videoId.trim()))
    .map((record) => {
      const inferredGameTitle = matchKnownValueFromText(
        [record.title, ...record.tags].join(" "),
        knownGameTitles
      );
      const inferredSeriesKey = matchKnownValueFromText(
        [record.title, ...record.tags].join(" "),
        knownSeriesKeys
      );
      const performanceScore = computePerformanceScore(record, record.publishedAt);

      return {
        id: `history:${record.videoId}`,
        source: "channel_import",
        clipId: null,
        scheduledPostId: null,
        videoId: record.videoId,
        channelId: record.channelId ?? null,
        clipDisplayName: "Imported channel video",
        title: record.title,
        publishedUrl: record.publishedUrl,
        channelTitle: record.channelTitle,
        gameTitle: inferredGameTitle,
        seriesKey: inferredSeriesKey,
        tags: [...record.tags],
        thumbnailUrl: record.thumbnailUrl,
        publishAt: record.publishedAt,
        format: classifyPerformanceFormat(
          record.durationSeconds !== null ? record.durationSeconds * 1000 : null
        ),
        ageDays: computeAgeDays(record.publishedAt),
        performanceScore,
        views: record.views,
        engagedViews: record.engagedViews,
        estimatedMinutesWatched: record.estimatedMinutesWatched,
        averageViewDuration: record.averageViewDuration,
        averageViewPercentage: record.averageViewPercentage,
        likes: record.likes,
        comments: record.comments,
        shares: record.shares ?? null,
        subscribersGained: record.subscribersGained ?? null,
        subscribersLost: record.subscribersLost ?? null,
        viewerPercentage: record.viewerPercentage ?? null,
        classificationSource: inferredGameTitle || inferredSeriesKey ? "inferred" : "unknown",
        fetchedAt: record.fetchedAt
      } satisfies OwnedPerformanceSnapshotRecord;
    });

  return [...workspaceSnapshots, ...historicalSnapshots];
}

function filterOwnedPerformanceSnapshots(
  records: OwnedPerformanceSnapshotRecord[],
  filters: PerformanceDashboardFilters
): OwnedPerformanceSnapshotRecord[] {
  return records
    .filter((record) => isWithinRange(record.publishAt, filters.range))
    .filter((record) => {
      if (filters.format !== "all" && record.format !== filters.format) {
        return false;
      }

      if (filters.gameTitle && normalizeFilterText(record.gameTitle) !== normalizeFilterText(filters.gameTitle)) {
        return false;
      }

      if (filters.seriesKey && normalizeFilterText(record.seriesKey) !== normalizeFilterText(filters.seriesKey)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => right.performanceScore - left.performanceScore);
}

async function refreshOwnedPerformanceSnapshots(filters: PerformanceDashboardFilters): Promise<void> {
  const targetPosts = listScheduledPosts()
    .filter(
      (post) =>
        post.platform === "youtube" &&
        post.remotePostId &&
        isWithinRange(post.publishAt, filters.range)
    )
    .sort((left, right) => right.publishAt.localeCompare(left.publishAt))
    .slice(0, MAX_OWNED_REFRESH_POSTS);

  for (const post of targetPosts) {
    if (!post.remotePostId) {
      continue;
    }

    const performance = await fetchYouTubePerformanceSnapshot(post.remotePostId);
    upsertYouTubePerformanceSnapshot({
      clipId: post.clipId,
      scheduledPostId: post.id,
      videoId: performance.videoId,
      channelId: post.channelId ?? getYouTubeConnectionStatus().channelId,
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
  }
}

async function refreshPerformanceAnalyticsCaches(
  filters: PerformanceDashboardFilters,
  channelId: string
): Promise<void> {
  const currentWindow = buildPerformanceDateWindow(filters.range);
  const previousWindow = buildPreviousPerformanceDateWindow(filters.range, currentWindow);
  const timelineReports = await Promise.all([
    fetchYouTubeAnalyticsReport({
      startDate: currentWindow.startDate,
      endDate: currentWindow.endDate,
      dimensions: "day",
      metrics: [
        "views",
        "engagedViews",
        "estimatedMinutesWatched",
        "likes",
        "comments",
        "shares",
        "subscribersGained",
        "subscribersLost"
      ],
      sort: "day"
    }),
    previousWindow
      ? fetchYouTubeAnalyticsReport({
          startDate: previousWindow.startDate,
          endDate: previousWindow.endDate,
          dimensions: "day",
          metrics: [
            "views",
            "engagedViews",
            "estimatedMinutesWatched",
            "likes",
            "comments",
            "shares",
            "subscribersGained",
            "subscribersLost"
          ],
          sort: "day"
        })
      : Promise.resolve(null)
  ]);

  const fetchedAt = new Date().toISOString();
  savePerformanceTimelineCache({
    channelId,
    range: filters.range,
    fetchedAt,
    current: normalizeTimelineReport(timelineReports[0]),
    previous: timelineReports[1] ? normalizeTimelineReport(timelineReports[1]) : []
  });

  const breakdownReports = await Promise.allSettled([
    fetchYouTubeAnalyticsReport({
      startDate: currentWindow.startDate,
      endDate: currentWindow.endDate,
      dimensions: "insightTrafficSourceType",
      metrics: ["views", "engagedViews", "estimatedMinutesWatched"],
      sort: "-views"
    }),
    fetchYouTubeAnalyticsReport({
      startDate: currentWindow.startDate,
      endDate: currentWindow.endDate,
      dimensions: "deviceType",
      metrics: ["views", "engagedViews", "estimatedMinutesWatched"],
      sort: "-views"
    }),
    fetchYouTubeAnalyticsReport({
      startDate: currentWindow.startDate,
      endDate: currentWindow.endDate,
      dimensions: "subscribedStatus",
      metrics: ["views", "engagedViews", "estimatedMinutesWatched"],
      sort: "-views"
    })
  ]);

  savePerformanceBreakdownCache({
    channelId,
    range: filters.range,
    fetchedAt,
    trafficSources: breakdownReports[0].status === "fulfilled"
      ? normalizeBreakdownReport(breakdownReports[0].value, "traffic") as PerformanceTrafficSourceBreakdown[]
      : [],
    devices: breakdownReports[1].status === "fulfilled"
      ? normalizeBreakdownReport(breakdownReports[1].value, "generic")
      : [],
    subscriberStatus: breakdownReports[2].status === "fulfilled"
      ? normalizeBreakdownReport(breakdownReports[2].value, "generic")
      : []
  });
}

function buildPerformanceDateWindow(range: PerformanceRange): { startDate: string; endDate: string } {
  return {
    startDate: buildRangeStartIso(range).slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10)
  };
}

function buildPreviousPerformanceDateWindow(
  range: PerformanceRange,
  currentWindow: { startDate: string; endDate: string }
): { startDate: string; endDate: string } | null {
  if (range === "since_2025") {
    return null;
  }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "365d" ? 365 : 28;
  const currentStart = Date.parse(`${currentWindow.startDate}T00:00:00.000Z`);
  const previousEnd = new Date(currentStart - 86_400_000).toISOString().slice(0, 10);
  const previousStart = new Date(currentStart - (days + 1) * 86_400_000).toISOString().slice(0, 10);
  return { startDate: previousStart, endDate: previousEnd };
}

function normalizeTimelineReport(report: { columnHeaders: string[]; rows: Array<Array<number | string>> }): PerformanceTimelinePoint[] {
  const columns = new Map(report.columnHeaders.map((header, index) => [header, index]));
  return report.rows
    .map((row) => ({
      date: readReportString(row, columns, "day") ?? "",
      views: readReportNumber(row, columns, "views"),
      engagedViews: readReportNumber(row, columns, "engagedViews"),
      estimatedMinutesWatched: readReportNumber(row, columns, "estimatedMinutesWatched"),
      likes: readReportNumber(row, columns, "likes"),
      comments: readReportNumber(row, columns, "comments"),
      shares: readReportNumber(row, columns, "shares"),
      subscribersGained: readReportNumber(row, columns, "subscribersGained"),
      subscribersLost: readReportNumber(row, columns, "subscribersLost")
    }))
    .filter((point) => point.date.length > 0);
}

function normalizeBreakdownReport(
  report: { columnHeaders: string[]; rows: Array<Array<number | string>> },
  kind: "traffic" | "generic"
): PerformanceTrafficSourceBreakdown[] | PerformanceBreakdownEntry[] {
  const columns = new Map(report.columnHeaders.map((header, index) => [header, index]));
  const rows = report.rows.map((row) => ({
    label: readReportString(row, columns, report.columnHeaders[0] ?? "") ?? "Unknown",
    views: readReportNumber(row, columns, "views"),
    engagedViews: readReportNumber(row, columns, "engagedViews"),
    estimatedMinutesWatched: readReportNumber(row, columns, "estimatedMinutesWatched")
  }));
  const totalViews = rows.reduce((sum, row) => sum + (row.views ?? 0), 0);
  return rows
    .filter((row) => row.label.trim().length > 0)
    .slice(0, 20)
    .map((row) => {
      const entry = {
        ...row,
        shareOfViews: totalViews > 0 && row.views !== null ? row.views / totalViews : null
      };
      return kind === "traffic" ? { ...entry, sourceType: row.label } : entry;
    });
}

function readReportString(
  row: Array<number | string>,
  columns: Map<string, number>,
  name: string
): string | null {
  const index = columns.get(name);
  const value = index === undefined ? null : row[index];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readReportNumber(
  row: Array<number | string>,
  columns: Map<string, number>,
  name: string
): number | null {
  const index = columns.get(name);
  const value = index === undefined ? null : row[index];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function readPerformanceChannelProfile(channelId: string | null): PerformanceChannelProfile | null {
  const raw = getAppSetting(PERFORMANCE_CHANNEL_PROFILE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const profile = JSON.parse(raw) as PerformanceChannelProfile;
    return profile.channelId && (!channelId || profile.channelId === channelId) ? profile : null;
  } catch {
    return null;
  }
}

function savePerformanceChannelProfile(profile: PerformanceChannelProfile): void {
  setAppSetting(PERFORMANCE_CHANNEL_PROFILE_KEY, JSON.stringify(profile));
}

function readPerformanceTimelineCache(channelId: string | null, range: PerformanceRange): PerformanceTimelineCache | null {
  if (!channelId) {
    return null;
  }
  const raw = getAppSetting(PERFORMANCE_TIMELINE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const cache = JSON.parse(raw) as PerformanceTimelineCache;
    return cache.channelId === channelId && cache.range === range ? cache : null;
  } catch {
    return null;
  }
}

function savePerformanceTimelineCache(cache: PerformanceTimelineCache): void {
  setAppSetting(PERFORMANCE_TIMELINE_KEY, JSON.stringify(cache));
}

function readPerformanceBreakdownCache(channelId: string | null, range: PerformanceRange): PerformanceBreakdownCache | null {
  if (!channelId) {
    return null;
  }
  const raw = getAppSetting(PERFORMANCE_BREAKDOWNS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const cache = JSON.parse(raw) as PerformanceBreakdownCache;
    return cache.channelId === channelId && cache.range === range ? cache : null;
  } catch {
    return null;
  }
}

function savePerformanceBreakdownCache(cache: PerformanceBreakdownCache): void {
  setAppSetting(PERFORMANCE_BREAKDOWNS_KEY, JSON.stringify(cache));
}

function buildPerformanceOverview(input: {
  ownedSnapshots: OwnedPerformanceSnapshotRecord[];
  allOwnedSnapshots: OwnedPerformanceSnapshotRecord[];
  filters: PerformanceDashboardFilters;
  timeline: PerformanceTimelineCache | null;
}): PerformancePeriodSummary | null {
  if (input.ownedSnapshots.length === 0 && !input.timeline) {
    return null;
  }

  const currentWindow = buildPerformanceDateWindow(input.filters.range);
  const previousWindow = buildPreviousPerformanceDateWindow(input.filters.range, currentWindow);
  const previousRecords = previousWindow
    ? filterOwnedPerformanceSnapshotsInWindow(input.allOwnedSnapshots, input.filters, previousWindow.startDate, previousWindow.endDate)
    : [];
  const current = input.ownedSnapshots.length > 0
    ? buildMetricSummaryFromRecords(input.ownedSnapshots)
    : buildMetricSummaryFromTimeline(input.timeline?.current ?? []);
  const comparison = previousWindow
    ? previousRecords.length > 0
      ? buildMetricSummaryFromRecords(previousRecords)
      : input.timeline?.previous.length
        ? buildMetricSummaryFromTimeline(input.timeline.previous)
        : null
    : null;
  const changes = buildMetricChanges(current, comparison);

  return {
    ...current,
    startDate: currentWindow.startDate,
    endDate: currentWindow.endDate,
    comparison,
    changes,
    sampleSize: input.ownedSnapshots.length
  };
}

function buildMetricSummaryFromTimeline(points: PerformanceTimelinePoint[]): PerformanceMetricSummary {
  return {
    views: sumTimelineMetric(points, "views"),
    engagedViews: sumTimelineMetric(points, "engagedViews"),
    estimatedMinutesWatched: sumTimelineMetric(points, "estimatedMinutesWatched"),
    averageViewDuration: null,
    averageViewPercentage: null,
    likes: sumTimelineMetric(points, "likes"),
    comments: sumTimelineMetric(points, "comments"),
    shares: sumTimelineMetric(points, "shares"),
    subscribersGained: sumTimelineMetric(points, "subscribersGained"),
    subscribersLost: sumTimelineMetric(points, "subscribersLost"),
    publishedVideoCount: 0
  };
}

function sumTimelineMetric(
  points: PerformanceTimelinePoint[],
  key: keyof Omit<PerformanceTimelinePoint, "date">
): number | null {
  const values = points.map((point) => point[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function buildMetricSummaryFromRecords(records: OwnedPerformanceSnapshotRecord[]): PerformanceMetricSummary {
  return {
    views: sumRecordMetric(records, "views"),
    engagedViews: sumRecordMetric(records, "engagedViews"),
    estimatedMinutesWatched: sumRecordMetric(records, "estimatedMinutesWatched"),
    averageViewDuration: averageRecordMetric(records, "averageViewDuration"),
    averageViewPercentage: averageRecordMetric(records, "averageViewPercentage"),
    likes: sumRecordMetric(records, "likes"),
    comments: sumRecordMetric(records, "comments"),
    shares: sumRecordMetric(records, "shares"),
    subscribersGained: sumRecordMetric(records, "subscribersGained"),
    subscribersLost: sumRecordMetric(records, "subscribersLost"),
    publishedVideoCount: records.length
  };
}

function sumRecordMetric(
  records: OwnedPerformanceSnapshotRecord[],
  key: keyof Pick<OwnedPerformanceSnapshotRecord, "views" | "engagedViews" | "estimatedMinutesWatched" | "likes" | "comments" | "shares" | "subscribersGained" | "subscribersLost">
): number | null {
  const values = records
    .map((record) => record[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function averageRecordMetric(
  records: OwnedPerformanceSnapshotRecord[],
  key: "averageViewDuration" | "averageViewPercentage" | "views" | "engagedViews"
): number | null {
  const values = records
    .map((record) => record[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function buildMetricChanges(
  current: PerformanceMetricSummary,
  comparison: PerformanceMetricSummary | null
): Partial<Record<keyof PerformanceMetricSummary, number | null>> {
  if (!comparison) {
    return {};
  }

  const keys: Array<keyof PerformanceMetricSummary> = [
    "views",
    "engagedViews",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "averageViewPercentage",
    "likes",
    "comments",
    "shares",
    "subscribersGained",
    "subscribersLost",
    "publishedVideoCount"
  ];
  return Object.fromEntries(keys.map((key) => [key, calculatePercentageChange(current[key], comparison[key])])) as Partial<Record<keyof PerformanceMetricSummary, number | null>>;
}

export function calculatePercentageChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function filterOwnedPerformanceSnapshotsInWindow(
  records: OwnedPerformanceSnapshotRecord[],
  filters: PerformanceDashboardFilters,
  startDate: string,
  endDate: string
): OwnedPerformanceSnapshotRecord[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T23:59:59.999Z`);
  return records.filter((record) => {
    const timestamp = Date.parse(record.publishAt);
    if (Number.isNaN(timestamp) || timestamp < start || timestamp > end) {
      return false;
    }
    if (filters.format !== "all" && record.format !== filters.format) {
      return false;
    }
    if (filters.gameTitle && normalizeFilterText(record.gameTitle) !== normalizeFilterText(filters.gameTitle)) {
      return false;
    }
    if (filters.seriesKey && normalizeFilterText(record.seriesKey) !== normalizeFilterText(filters.seriesKey)) {
      return false;
    }
    return true;
  });
}

function buildTimelineFromSnapshots(records: OwnedPerformanceSnapshotRecord[]): PerformanceTimelinePoint[] {
  const buckets = new Map<string, OwnedPerformanceSnapshotRecord[]>();
  for (const record of records) {
    const date = record.publishAt.slice(0, 10);
    const bucket = buckets.get(date) ?? [];
    bucket.push(record);
    buckets.set(date, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bucket]) => ({
      date,
      views: sumRecordMetric(bucket, "views"),
      engagedViews: sumRecordMetric(bucket, "engagedViews"),
      estimatedMinutesWatched: sumRecordMetric(bucket, "estimatedMinutesWatched"),
      likes: sumRecordMetric(bucket, "likes"),
      comments: sumRecordMetric(bucket, "comments"),
      shares: sumRecordMetric(bucket, "shares"),
      subscribersGained: sumRecordMetric(bucket, "subscribersGained"),
      subscribersLost: sumRecordMetric(bucket, "subscribersLost")
    }));
}

export function buildPerformanceLaneBreakdowns(
  snapshots: OwnedPerformanceSnapshotRecord[]
): PerformanceLaneBreakdown[] {
  const definitions: Array<{ dimension: PerformanceLaneBreakdown["dimension"]; getLabel: (snapshot: OwnedPerformanceSnapshotRecord) => string }> = [
    { dimension: "game", getLabel: (snapshot) => snapshot.gameTitle },
    { dimension: "series", getLabel: (snapshot) => snapshot.seriesKey },
    { dimension: "format", getLabel: (snapshot) => snapshot.format === "shorts" ? "Shorts" : "Long-form" },
    ...collectPerformanceKeywords(snapshots).map((keyword) => ({
      dimension: "keyword" as const,
      getLabel: (snapshot: OwnedPerformanceSnapshotRecord) => buildOwnedKeywordFamilies(snapshot).includes(keyword) ? keyword : ""
    }))
  ];
  const lanes: PerformanceLaneBreakdown[] = [];

  for (const definition of definitions) {
    const groups = new Map<string, OwnedPerformanceSnapshotRecord[]>();
    for (const snapshot of snapshots) {
      const label = definition.getLabel(snapshot).trim();
      if (!label) {
        continue;
      }
      const group = groups.get(label) ?? [];
      group.push(snapshot);
      groups.set(label, group);
    }

    for (const [label, group] of groups) {
      const ordered = [...group].sort((left, right) => left.publishAt.localeCompare(right.publishAt));
      const midpoint = Math.max(1, Math.floor(ordered.length / 2));
      const recent = ordered.slice(midpoint);
      const earlier = ordered.slice(0, midpoint);
      const recentAverage = averageScore(recent);
      const earlierAverage = averageScore(earlier);
      const strongest = [...group].sort((left, right) => right.performanceScore - left.performanceScore)[0];
      lanes.push({
        id: `lane:${definition.dimension}:${normalizeFilterText(label).replace(/[^a-z0-9]+/g, "-")}`,
        dimension: definition.dimension,
        label,
        sampleSize: group.length,
        averageViews: averageRecordMetric(group, "views"),
        averageEngagedViews: averageRecordMetric(group, "engagedViews"),
        averageViewPercentage: averageRecordMetric(group, "averageViewPercentage"),
        averagePerformanceScore: averageScore(group),
        recentDirection: group.length < 2 || recent.length === 0 || earlier.length === 0
          ? "unknown"
          : recentAverage > earlierAverage * 1.08
            ? "up"
            : recentAverage < earlierAverage * 0.92
              ? "down"
              : "flat",
        classificationSource: group.some((record) => record.classificationSource === "metadata")
          ? "metadata"
          : group.some((record) => record.classificationSource === "inferred")
            ? "inferred"
            : "unknown",
        strongestVideoId: strongest?.videoId || null,
        strongestVideoTitle: strongest?.title || null
      });
    }
  }

  return lanes
    .sort((left, right) => right.averagePerformanceScore - left.averagePerformanceScore)
    .slice(0, 40);
}

function collectPerformanceKeywords(snapshots: OwnedPerformanceSnapshotRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const snapshot of snapshots) {
    for (const keyword of buildOwnedKeywordFamilies(snapshot)) {
      if (COMMON_PACKAGING_STOP_WORDS.has(keyword)) {
        continue;
      }
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([keyword]) => keyword);
}

function averageScore(records: OwnedPerformanceSnapshotRecord[]): number {
  return records.length > 0
    ? records.reduce((sum, record) => sum + record.performanceScore, 0) / records.length
    : 0;
}

function buildPerformanceFreshness(input: {
  channelProfile: PerformanceChannelProfile | null;
  ownedLastFetchedAt: string | null;
  breakdownCache: PerformanceBreakdownCache | null;
  connection: ReturnType<typeof getYouTubeConnectionStatus>;
}): NonNullable<PerformanceDashboardResult["freshness"]> {
  const staleAreas: NonNullable<PerformanceDashboardResult["freshness"]>["staleAreas"] = [];
  if (input.connection.connected && (!input.channelProfile || isOlderThan(input.channelProfile.fetchedAt, PERFORMANCE_CHANNEL_STALE_MS))) {
    staleAreas.push("channel");
  }
  if (input.connection.connected && input.connection.analyticsScopeGranted && isOlderThan(input.ownedLastFetchedAt, PERFORMANCE_OWNED_STALE_MS)) {
    staleAreas.push("owned");
  }
  if (input.connection.connected && input.connection.analyticsScopeGranted && (!input.breakdownCache || isOlderThan(input.breakdownCache.fetchedAt, PERFORMANCE_BREAKDOWNS_STALE_MS))) {
    staleAreas.push("breakdowns");
  }
  return {
    channel: input.channelProfile?.fetchedAt ?? null,
    owned: input.ownedLastFetchedAt,
    breakdowns: input.breakdownCache?.fetchedAt ?? null,
    staleAreas
  };
}

export async function getPerformanceVideoDetail(videoId: string): Promise<PerformanceVideoDetail> {
  const normalizedVideoId = videoId.trim();
  if (!normalizedVideoId) {
    throw new Error("A YouTube video ID is required to open performance detail.");
  }

  const connection = getYouTubeConnectionStatus();
  const records = buildAllOwnedPerformanceSnapshots(
    listImportedYouTubePerformanceRecords(),
    connection.channelId
  );
  const snapshot = records.find((record) => record.videoId === normalizedVideoId);
  if (!snapshot) {
    throw new Error("That video is not in the connected channel's local performance history.");
  }

  const currentRecords = records.filter((record) => isWithinRange(record.publishAt, "28d"));
  const dataLimitations: string[] = [];
  if (!connection.connected) {
    dataLimitations.push("Connect YouTube to load audience breakdowns and retention.");
  } else if (!connection.analyticsScopeGranted) {
    dataLimitations.push("Reconnect YouTube with Analytics access to load audience breakdowns and retention.");
  }

  let trafficSources: PerformanceTrafficSourceBreakdown[] = [];
  let devices: PerformanceBreakdownEntry[] = [];
  let subscriberStatus: PerformanceBreakdownEntry[] = [];
  let retention: PerformanceRetentionPoint[] = [];
  let retentionFetchedAt: string | null = null;

  if (connection.connected && connection.analyticsScopeGranted) {
    const window = buildPerformanceDateWindow("since_2025");
    const reports = await Promise.allSettled([
      fetchYouTubeAnalyticsReport({
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: "insightTrafficSourceType",
        metrics: ["views", "engagedViews", "estimatedMinutesWatched"],
        filters: `video==${normalizedVideoId}`,
        sort: "-views"
      }),
      fetchYouTubeAnalyticsReport({
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: "deviceType",
        metrics: ["views", "engagedViews", "estimatedMinutesWatched"],
        filters: `video==${normalizedVideoId}`,
        sort: "-views"
      }),
      fetchYouTubeAnalyticsReport({
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: "subscribedStatus",
        metrics: ["views", "engagedViews", "estimatedMinutesWatched"],
        filters: `video==${normalizedVideoId}`,
        sort: "-views"
      }),
      fetchYouTubeAnalyticsReport({
        startDate: window.startDate,
        endDate: window.endDate,
        dimensions: "elapsedVideoTimeRatio",
        metrics: ["audienceWatchRatio", "relativeRetentionPerformance", "startedWatching", "stoppedWatching"],
        filters: `video==${normalizedVideoId}`,
        sort: "elapsedVideoTimeRatio"
      })
    ]);

    if (reports[0].status === "fulfilled") {
      trafficSources = normalizeBreakdownReport(reports[0].value, "traffic") as PerformanceTrafficSourceBreakdown[];
    } else {
      dataLimitations.push("Traffic-source detail was unavailable for this video.");
    }
    if (reports[1].status === "fulfilled") {
      devices = normalizeBreakdownReport(reports[1].value, "generic") as PerformanceBreakdownEntry[];
    } else {
      dataLimitations.push("Device detail was unavailable for this video.");
    }
    if (reports[2].status === "fulfilled") {
      subscriberStatus = normalizeBreakdownReport(reports[2].value, "generic") as PerformanceBreakdownEntry[];
    } else {
      dataLimitations.push("Subscriber-status detail was unavailable for this video.");
    }
    if (reports[3].status === "fulfilled") {
      retention = normalizeRetentionReport(reports[3].value);
      retentionFetchedAt = new Date().toISOString();
    } else {
      dataLimitations.push("Audience-retention detail was unavailable for this video.");
    }
  }

  if (snapshot.classificationSource === "inferred") {
    dataLimitations.push("Game or series labels were inferred from the title and tags.");
  }

  return {
    snapshot,
    channelBaseline: buildMetricSummaryFromRecords(currentRecords),
    trafficSources,
    devices,
    subscriberStatus,
    retention,
    retentionFetchedAt,
    dataLimitations
  };
}

function normalizeRetentionReport(
  report: { columnHeaders: string[]; rows: Array<Array<number | string>> }
): PerformanceRetentionPoint[] {
  const columns = new Map(report.columnHeaders.map((header, index) => [header, index]));
  return report.rows
    .map((row) => ({
      elapsedVideoTimeRatio: readReportNumber(row, columns, "elapsedVideoTimeRatio") ?? 0,
      audienceWatchRatio: readReportNumber(row, columns, "audienceWatchRatio"),
      relativeRetentionPerformance: readReportNumber(row, columns, "relativeRetentionPerformance"),
      startedWatching: readReportNumber(row, columns, "startedWatching"),
      stoppedWatching: readReportNumber(row, columns, "stoppedWatching")
    }))
    .filter((point) => point.elapsedVideoTimeRatio >= 0 && point.elapsedVideoTimeRatio <= 1);
}

export async function generatePerformanceCoach(input?: {
  filters?: Partial<PerformanceDashboardFilters>;
  videoId?: string;
  focus?: PerformanceCoachFocus;
}): Promise<PerformanceCoachResult> {
  const dashboard = getPerformanceDashboard(input?.filters);
  const focus = input?.focus ?? (input?.videoId ? "video" : "overview");
  let videoDetail: PerformanceVideoDetail | null = null;
  const limitations = collectPerformanceCoachLimitations(dashboard);
  if (input?.videoId) {
    videoDetail = await getPerformanceVideoDetail(input.videoId).catch((error) => {
      limitations.push(error instanceof Error ? error.message : "Selected video detail was unavailable.");
      return null;
    });
    if (videoDetail) {
      limitations.push(...videoDetail.dataLimitations);
    }
  }

  const aiProfile = resolveAiProfileForTask("performance_coach");
  const evidence = buildPerformanceEvidence(dashboard, videoDetail);
  const heuristicInsights = buildPerformanceCoachHeuristicInsights(dashboard, videoDetail, evidence);
  const ollamaResult = await tryGeneratePerformanceCoachWithOllama({
    dashboard,
    videoDetail,
    evidence,
    aiProfileId: aiProfile?.id ?? null,
    aiProfileName: aiProfile?.name ?? null,
    aiProfilePrompt: aiProfile?.systemPrompt ?? "",
    aiProfileLearningPrompt: buildAiProfileLearningPrompt(aiProfile) ?? "",
    preferredModel: aiProfile?.preferredModel ?? null,
    focus
  });

  if (isStrictAiModeEnabled() && ollamaResult.insights.length === 0) {
    throw new Error(
      `Strict AI mode blocked fallback performance coaching. ${ollamaResult.note ?? "The local AI runtime did not return usable coaching."}`
    );
  }

  const insights = ollamaResult.insights.length > 0
    ? ollamaResult.insights
    : heuristicInsights;
  const uniqueLimitations = [...new Set(limitations.map((limitation) => limitation.trim()).filter(Boolean))];
  const coachLimitations = [...new Set([...uniqueLimitations, ...ollamaResult.limitations])];
  return {
    generationId: randomUUID(),
    generatedAt: new Date().toISOString(),
    filters: dashboard.filters,
    focus,
    summary: ollamaResult.summary || buildPerformanceCoachSummary(dashboard),
    insights,
    limitations: coachLimitations,
    model: ollamaResult.model,
    profileId: aiProfile?.id ?? null,
    profileName: aiProfile?.name ?? null,
    executionMode: ollamaResult.insights.length > 0 ? "ai" : "fallback",
    issueSummary: ollamaResult.insights.length > 0 ? null : ollamaResult.note,
    source: ollamaResult.insights.length > 0 ? "ollama" : "heuristic"
  };
}

function collectPerformanceCoachLimitations(dashboard: PerformanceDashboardResult): string[] {
  const limitations: string[] = [];
  if (!dashboard.youtubeConnected) {
    limitations.push("YouTube is disconnected, so this cockpit is using cached or workspace evidence only.");
  } else if (!dashboard.analyticsScopeGranted) {
    limitations.push("YouTube Analytics access is missing; reconnect before treating audience or retention conclusions as complete.");
  }
  if (dashboard.ownedSnapshots.length < 3) {
    limitations.push("Fewer than three comparable videos are available, so confidence is limited.");
  }
  if (!dashboard.overview?.comparison) {
    limitations.push("A previous equivalent period is not available for comparison.");
  }
  if (dashboard.ownedSnapshots.some((snapshot) => snapshot.classificationSource === "inferred")) {
    limitations.push("Some game or series labels were inferred from metadata rather than supplied explicitly.");
  }
  return limitations;
}

function buildPerformanceCoachSummary(dashboard: PerformanceDashboardResult): string {
  if (!dashboard.overview || dashboard.ownedSnapshots.length === 0) {
    return "There is not enough owned channel evidence to make a confident performance call yet.";
  }
  const views = formatPerformanceNumber(dashboard.overview.views);
  const published = dashboard.overview.publishedVideoCount;
  return `${published} video${published === 1 ? "" : "s"} generated ${views} views in the selected period. Use the evidence-linked tests below to decide what to repeat next.`;
}

function buildPerformanceEvidence(
  dashboard: PerformanceDashboardResult,
  videoDetail: PerformanceVideoDetail | null
): PerformanceEvidenceReference[] {
  const evidence: PerformanceEvidenceReference[] = [];
  const overview = dashboard.overview;
  if (overview) {
    for (const [metric, value] of [
      ["views", overview.views],
      ["engagedViews", overview.engagedViews],
      ["averageViewPercentage", overview.averageViewPercentage],
      ["publishedVideoCount", overview.publishedVideoCount]
    ] as Array<[string, number | null]>) {
      evidence.push({
        id: `period:${metric}`,
        source: "period",
        label: `Selected period ${metric}`,
        metric,
        value: value === null ? "not available" : formatPerformanceNumber(value),
        comparisonValue: overview.comparison ? formatPerformanceNumber(overview.comparison[metric as keyof PerformanceMetricSummary] as number | null) : null,
        recordId: null,
        videoId: null
      });
    }
  }
  for (const snapshot of dashboard.ownedSnapshots.slice(0, 8)) {
    evidence.push({
      id: `video:${snapshot.id}`,
      source: "video",
      label: snapshot.title,
      metric: dashboard.filters.metric,
      value: formatPerformanceNumber(readSnapshotMetric(snapshot, dashboard.filters.metric)),
      comparisonValue: null,
      recordId: snapshot.clipId ?? snapshot.id,
      videoId: snapshot.videoId || null
    });
  }
  for (const lane of (dashboard.laneBreakdowns ?? []).slice(0, 12)) {
    evidence.push({
      id: lane.id,
      source: "lane",
      label: `${lane.dimension}: ${lane.label}`,
      metric: "averagePerformanceScore",
      value: formatPerformanceNumber(lane.averagePerformanceScore),
      comparisonValue: null,
      recordId: lane.id,
      videoId: lane.strongestVideoId
    });
  }
  if (videoDetail) {
    evidence.push({
      id: `video:selected:${videoDetail.snapshot.videoId}`,
      source: "video",
      label: videoDetail.snapshot.title,
      metric: "averageViewPercentage",
      value: formatPerformanceNumber(videoDetail.snapshot.averageViewPercentage),
      comparisonValue: formatPerformanceNumber(videoDetail.channelBaseline.averageViewPercentage),
      recordId: videoDetail.snapshot.id,
      videoId: videoDetail.snapshot.videoId
    });
  }
  return evidence;
}

function readSnapshotMetric(snapshot: OwnedPerformanceSnapshotRecord, metric: PerformanceDashboardFilters["metric"]): number | null {
  switch (metric) {
    case "views": return snapshot.views;
    case "average_view_percentage": return snapshot.averageViewPercentage;
    case "likes": return snapshot.likes;
    case "comments": return snapshot.comments;
    case "engaged_views": return snapshot.engagedViews;
  }
}

function formatPerformanceNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-GB") : "not available";
}

function buildPerformanceCoachHeuristicInsights(
  dashboard: PerformanceDashboardResult,
  videoDetail: PerformanceVideoDetail | null,
  evidence: PerformanceEvidenceReference[]
): PerformanceCoachInsight[] {
  const insights: PerformanceCoachInsight[] = [];
  const evidenceMap = new Map(evidence.map((item) => [item.id, item]));
  const strongestLane = (dashboard.laneBreakdowns ?? []).find((lane) => lane.sampleSize >= 2) ?? dashboard.laneBreakdowns?.[0];
  if (strongestLane) {
    insights.push({
      id: "heuristic:leading-lane",
      type: "win",
      title: `${strongestLane.label} is a repeatable signal to test again`,
      explanation: `This lane leads the available comparisons with an average performance score of ${Math.round(strongestLane.averagePerformanceScore)} across ${strongestLane.sampleSize} video${strongestLane.sampleSize === 1 ? "" : "s"}. That is an observation, not proof of causation.`,
      confidence: strongestLane.sampleSize >= 3 ? "medium" : "low",
      evidence: [evidenceMap.get(strongestLane.id)].filter((item): item is PerformanceEvidenceReference => Boolean(item)),
      action: buildCoachActionForVideo(dashboard.ownedSnapshots.find((snapshot) => snapshot.videoId === strongestLane.strongestVideoId) ?? null)
    });
  }

  const weakestVideo = [...dashboard.ownedSnapshots].sort((left, right) => left.performanceScore - right.performanceScore)[0];
  if (weakestVideo) {
    insights.push({
      id: "heuristic:needs-attention",
      type: "warning",
      title: "Review the weakest owned example before changing the whole channel",
      explanation: `“${weakestVideo.title}” is the lowest-ranked comparable example in this view. Compare its packaging and format with a winner before deciding what to change.`,
      confidence: dashboard.ownedSnapshots.length >= 3 ? "medium" : "low",
      evidence: [evidenceMap.get(`video:${weakestVideo.id}`)].filter((item): item is PerformanceEvidenceReference => Boolean(item)),
      action: buildCoachActionForVideo(weakestVideo)
    });
  }

  const periodChange = dashboard.overview?.changes.views;
  if (periodChange !== undefined && periodChange !== null) {
    insights.push({
      id: "heuristic:period-change",
      type: periodChange >= 0 ? "opportunity" : "warning",
      title: `Views are ${periodChange >= 0 ? "up" : "down"} ${Math.abs(Math.round(periodChange))}% versus the previous period`,
      explanation: "Use this as a directional signal for the next test; the dashboard cannot establish which individual change caused the movement.",
      confidence: dashboard.overview?.sampleSize && dashboard.overview.sampleSize >= 3 ? "medium" : "low",
      evidence: [evidenceMap.get("period:views")].filter((item): item is PerformanceEvidenceReference => Boolean(item)),
      action: null
    });
  }

  if (videoDetail?.snapshot.averageViewPercentage !== null && videoDetail?.snapshot.averageViewPercentage !== undefined) {
    const baseline = videoDetail.channelBaseline.averageViewPercentage;
    const selected = videoDetail.snapshot.averageViewPercentage;
    if (baseline !== null && selected < baseline) {
      insights.push({
        id: "heuristic:retention-test",
        type: "experiment",
        title: "Test a tighter opening on this video’s next variation",
        explanation: `The selected video averages ${selected.toFixed(1)}% viewed versus a ${baseline.toFixed(1)}% channel baseline. Test the first 15 seconds and compare retention before changing other variables.`,
        confidence: "medium",
        evidence: [evidenceMap.get(`video:selected:${videoDetail.snapshot.videoId}`)].filter((item): item is PerformanceEvidenceReference => Boolean(item)),
        action: buildCoachActionForVideo(videoDetail.snapshot)
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: "heuristic:collect-data",
      type: "experiment",
      title: "Collect more comparable uploads before making a channel-wide change",
      explanation: "Import channel history or refresh owned videos so the coach can compare games, series, formats, and periods with a usable sample.",
      confidence: "low",
      evidence: [],
      action: null
    });
  }
  return insights.slice(0, 5);
}

function buildCoachActionForVideo(snapshot: OwnedPerformanceSnapshotRecord | null): PerformanceCoachAction | null {
  if (!snapshot) {
    return null;
  }
  if (snapshot.clipId) {
    return { kind: "open_clip", label: "Open in Edit", clipId: snapshot.clipId, videoId: snapshot.videoId || null };
  }
  return { kind: "open_video", label: "Open on YouTube", clipId: null, videoId: snapshot.videoId || null };
}

async function tryGeneratePerformanceCoachWithOllama(context: {
  dashboard: PerformanceDashboardResult;
  videoDetail: PerformanceVideoDetail | null;
  evidence: PerformanceEvidenceReference[];
  aiProfileId: string | null;
  aiProfileName: string | null;
  aiProfilePrompt: string;
  aiProfileLearningPrompt: string;
  preferredModel: string | null;
  focus: PerformanceCoachFocus;
}): Promise<{
  summary: string | null;
  insights: PerformanceCoachInsight[];
  limitations: string[];
  model: string | null;
  note: string | null;
}> {
  const request = {
    task: "performance_coach" as const,
    profileId: context.aiProfileId,
    preferredModel: context.preferredModel,
    fallbackPreferences: OLLAMA_PERFORMANCE_MODEL_PREFERENCE,
    systemPrompt:
      "You are Creator Workbench's local Performance Coach. Return only valid JSON matching the supplied schema. Never invent evidence, metrics, causes, or actions.",
    userPrompt: buildPerformanceCoachPrompt(context),
    responseSchema: buildPerformanceCoachResponseFormat(),
    temperature: 0.2,
    disableThinking: true
  };
  setAiActivityDetail("Generating evidence-linked coaching");
  let response = await generateAiText(request).catch((error) => ({ error }));

  if (!("error" in response) && !parsePerformanceCoachResponse(response.responseText)) {
    setAiActivityDetail("Retrying coaching · correcting JSON format (2 of 2)");
    response = await generateAiText({
      ...request,
      userPrompt: request.userPrompt + "\nReturn one complete JSON object only, without reasoning, markdown or commentary. Keep the summary and explanations concise and return exactly 3 insights using only the allowed evidence IDs. The previous attempt could not be parsed; regenerate from the evidence above."
    }).catch((error) => ({ error }));
  }

  if ("error" in response) {
    return {
      summary: null,
      insights: [],
      limitations: [],
      model: null,
      note: response.error instanceof Error ? response.error.message : "Performance Coach could not reach the local AI runtime."
    };
  }

  const runtimeNotice = response.runtimeNotice ? `${response.runtimeNotice} ` : "";
  if (!response.responseText) {
    return {
      summary: null,
      insights: [],
      limitations: [],
      model: response.model,
      note: `${runtimeNotice}The local AI runtime returned an empty Performance Coach response.`
    };
  }

  const parsed = parsePerformanceCoachResponse(response.responseText);
  if (!parsed) {
    return {
      summary: null,
      insights: [],
      limitations: [],
      model: response.model,
      note: `${runtimeNotice}The local AI runtime returned invalid JSON for Performance Coach after two attempts using ${response.model}.${response.finishReason === "length" ? " The final response reached the model's output limit before completing." : ""}`
    };
  }

  const insights = parsePerformanceCoachInsights(parsed, context.evidence);
  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null,
    insights,
    limitations: Array.isArray(parsed.limitations)
      ? parsed.limitations.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 8)
      : [],
    model: response.model,
    note: insights.length > 0
      ? `${runtimeNotice}Generated evidence-linked coaching with the local AI runtime using ${response.model}.`
      : `${runtimeNotice}The local AI runtime returned no usable evidence-linked coaching.`
  };
}

export function parsePerformanceCoachResponse(value: string): PerformanceCoachRawResponse | null {
  // Some reasoning-capable models still include a leading thinking block. Ignore
  // only that explicit prefix; never repair malformed JSON or use its reasoning
  // as coaching evidence. JSON strings containing these tags remain untouched.
  const answer = value.trim().replace(/^(?:<think>[\s\S]*?<\/think>\s*)+/i, "");
  if (/^<think\b/i.test(answer)) return null;
  const parsed = parseJsonResponse(answer);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const result = parsed as PerformanceCoachRawResponse;
  return Array.isArray(result.insights) ? result : null;
}

function buildPerformanceCoachPrompt(context: {
  dashboard: PerformanceDashboardResult;
  videoDetail: PerformanceVideoDetail | null;
  evidence: PerformanceEvidenceReference[];
  aiProfileName: string | null;
  aiProfilePrompt: string;
  aiProfileLearningPrompt: string;
  focus: PerformanceCoachFocus;
}): string {
  const dashboard = context.dashboard;
  const overview = dashboard.overview;
  const videos = dashboard.ownedSnapshots.slice(0, 10).map((snapshot) => ({
    id: snapshot.id,
    title: snapshot.title,
    format: snapshot.format,
    game: snapshot.gameTitle || null,
    series: snapshot.seriesKey || null,
    classificationSource: snapshot.classificationSource ?? "unknown",
    views: snapshot.views,
    engagedViews: snapshot.engagedViews,
    averageViewPercentage: snapshot.averageViewPercentage,
    likes: snapshot.likes,
    comments: snapshot.comments,
    performanceScore: snapshot.performanceScore,
    clipId: snapshot.clipId,
    videoId: snapshot.videoId || null
  }));
  return [
    "You are coaching one creator using only the supplied local YouTube dashboard evidence.",
    "Compare the creator against their own channel history, owned uploads, and local workspace evidence.",
    "For every insight distinguish observation, interpretation, and recommendation. Do not claim causation from correlation.",
    "Respect sample size. Do not invent CTR, impressions, retention, traffic, or subscriber values that are absent.",
    "Use only the exact evidence IDs supplied below. If evidence is insufficient, say so and recommend one concrete data-collection or content experiment.",
    "Return 3 to 5 insights. Prefer one concrete next action per insight. Actions are review-first; never say that a metadata, thumbnail, or publish change was automatically applied.",
    `Focus: ${context.focus}`,
    `AI worker profile: ${context.aiProfileName || "Default Performance Coach"}`,
    context.aiProfilePrompt ? `Worker instructions: ${context.aiProfilePrompt}` : "",
    context.aiProfileLearningPrompt,
    "",
    "Dashboard filters:",
    JSON.stringify(dashboard.filters),
    "Overview:",
    JSON.stringify(overview ?? null),
    "Lane comparisons:",
    JSON.stringify((dashboard.laneBreakdowns ?? []).slice(0, 20)),
    "Audience/discovery breakdowns:",
    JSON.stringify({
      trafficSources: dashboard.trafficSources ?? [],
      devices: dashboard.devices ?? [],
      subscriberStatus: dashboard.subscriberStatus ?? []
    }),
    "Owned video examples:",
    JSON.stringify(videos),
    "Selected video detail:",
    JSON.stringify(context.videoDetail ?? null),
    "Allowed evidence references:",
    JSON.stringify(context.evidence),
    "Required JSON shape:",
    '{"summary":"one concise channel summary","limitations":["..."],"insights":[{"type":"win|opportunity|warning|experiment","title":"...","explanation":"observation; interpretation; recommendation","confidence":"high|medium|low","evidenceIds":["period:views"],"action":{"kind":"open_clip|open_video|generate_titles|generate_tags|review_thumbnail","label":"...","clipId":null,"videoId":null}}]}'
  ].filter(Boolean).join("\n");
}

function buildPerformanceCoachResponseFormat(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      limitations: { type: "array", items: { type: "string" } },
      insights: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["win", "opportunity", "warning", "experiment"] },
            title: { type: "string" },
            explanation: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            evidenceIds: { type: "array", items: { type: "string" } },
            action: { type: ["object", "null"] }
          },
          required: ["type", "title", "explanation", "confidence", "evidenceIds"]
        }
      }
    },
    required: ["summary", "insights"]
  };
}

export function parsePerformanceCoachInsights(
  parsed: PerformanceCoachRawResponse,
  evidence: PerformanceEvidenceReference[]
): PerformanceCoachInsight[] {
  if (!Array.isArray(parsed.insights)) {
    return [];
  }
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const validTypes = new Set<PerformanceInsightType>(["win", "opportunity", "warning", "experiment"]);
  const validConfidence = new Set<PerformanceInsightConfidence>(["high", "medium", "low"]);
  const validVideoIds = new Set(evidence.map((item) => item.videoId).filter((value): value is string => Boolean(value)));

  return (parsed.insights as unknown[])
    .map((value, index) => {
      const raw = value && typeof value === "object" ? value as PerformanceCoachRawInsight : {};
      const evidenceIds = Array.isArray(raw.evidenceIds)
        ? raw.evidenceIds.filter((value): value is string => typeof value === "string" && evidenceById.has(value))
        : [];
      const action = normalizePerformanceCoachAction(raw.action, validVideoIds, evidence);
      const type = typeof raw.type === "string" && validTypes.has(raw.type as PerformanceInsightType)
        ? raw.type as PerformanceInsightType
        : "opportunity";
      const confidence = typeof raw.confidence === "string" && validConfidence.has(raw.confidence as PerformanceInsightConfidence)
        ? raw.confidence as PerformanceInsightConfidence
        : "low";
      return {
        id: `ollama-performance-insight:${index}`,
        type,
        title: typeof raw.title === "string" ? raw.title.trim() : "",
        explanation: typeof raw.explanation === "string" ? raw.explanation.trim() : "",
        confidence,
        evidence: evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is PerformanceEvidenceReference => Boolean(item)),
        action
      };
    })
    .filter((insight) => insight.title.length > 0 && insight.explanation.length > 0 && insight.evidence.length > 0)
    .slice(0, 5);
}

function normalizePerformanceCoachAction(
  rawAction: unknown,
  validVideoIds: Set<string>,
  evidence: PerformanceEvidenceReference[]
): PerformanceCoachAction | null {
  if (!rawAction || typeof rawAction !== "object") {
    return null;
  }
  const action = rawAction as Record<string, unknown>;
  const kind = action.kind;
  if (kind !== "open_clip" && kind !== "open_video" && kind !== "generate_titles" && kind !== "generate_tags" && kind !== "review_thumbnail") {
    return null;
  }
  const clipId = typeof action.clipId === "string" && action.clipId.trim() ? action.clipId.trim() : null;
  const videoId = typeof action.videoId === "string" && action.videoId.trim() ? action.videoId.trim() : null;
  const referencedVideo = videoId && validVideoIds.has(videoId);
  const referencedClip = clipId && evidence.some((item) => item.recordId === clipId);
  if (kind === "open_clip" || kind === "generate_titles" || kind === "generate_tags" || kind === "review_thumbnail") {
    if (!referencedClip) {
      return null;
    }
  } else if (!referencedVideo) {
    return null;
  }
  return {
    kind,
    label: typeof action.label === "string" && action.label.trim() ? action.label.trim() : kind.replace(/_/g, " "),
    clipId,
    videoId
  };
}

function buildPerformanceRecommendations(input: {
  ownedSnapshots: OwnedPerformanceSnapshotRecord[];
}): PerformanceRecommendation[] {
  const recommendations: PerformanceRecommendation[] = [];

  if (input.ownedSnapshots.length === 0) {
    recommendations.push({
      id: "seed-performance",
      title: "Seed more owned performance into the dashboard",
      summary:
        "This view becomes much sharper after you refresh workspace posts or import older channel history from 2025 onward."
    });
  }

  const topGame = findTopLane(input.ownedSnapshots, "gameTitle");
  if (topGame) {
    recommendations.push({
      id: `top-game:${topGame}`,
      title: `${topGame} is leading your current lane`,
      summary: `Your strongest average performance in the selected window is coming from ${topGame}. Use that owned-channel evidence when planning the next test.`
    });
  }

  const topSeries = findTopLane(input.ownedSnapshots, "seriesKey");
  if (topSeries) {
    recommendations.push({
      id: `top-series:${topSeries}`,
      title: `${topSeries} is giving you repeatable context`,
      summary: `Series-aware packaging is outperforming one-off naming in the current window for ${topSeries}.`
    });
  }

  const leadingFormat = findLeadingFormat(input.ownedSnapshots);
  if (leadingFormat) {
    recommendations.push({
      id: `top-format:${leadingFormat}`,
      title: `${leadingFormat === "shorts" ? "Shorts" : "Long-form"} is currently your stronger format`,
      summary: `In the current slice, ${leadingFormat === "shorts" ? "shorts" : "long-form uploads"} are delivering the better average score. Bias new experiments toward that format until the lane shifts.`
    });
  }

  const winningKeyword = findRecurringWinningKeyword(input.ownedSnapshots);
  if (winningKeyword) {
    recommendations.push({
      id: `winning-keyword:${winningKeyword}`,
      title: `"${winningKeyword}" keeps showing up in stronger posts`,
      summary: "Use that phrase family when pressure-testing hooks, title wording, and tags for the next batch."
    });
  }

  return recommendations.slice(0, 4);
}

function findTopLane(
  snapshots: OwnedPerformanceSnapshotRecord[],
  key: "gameTitle" | "seriesKey"
): string | null {
  const buckets = new Map<string, { total: number; count: number }>();

  for (const snapshot of snapshots) {
    const value = snapshot[key].trim();
    if (!value) {
      continue;
    }

    const bucket = buckets.get(value) ?? { total: 0, count: 0 };
    bucket.total += snapshot.performanceScore;
    bucket.count += 1;
    buckets.set(value, bucket);
  }

  let bestValue: string | null = null;
  let bestAverage = -1;
  for (const [value, bucket] of buckets.entries()) {
    const average = bucket.total / Math.max(1, bucket.count);
    if (average > bestAverage) {
      bestAverage = average;
      bestValue = value;
    }
  }

  return bestValue;
}

function findLeadingFormat(
  snapshots: OwnedPerformanceSnapshotRecord[]
): Exclude<PerformanceFormat, "all"> | null {
  const buckets = new Map<Exclude<PerformanceFormat, "all">, { total: number; count: number }>();

  for (const snapshot of snapshots) {
    const bucket = buckets.get(snapshot.format) ?? { total: 0, count: 0 };
    bucket.total += snapshot.performanceScore;
    bucket.count += 1;
    buckets.set(snapshot.format, bucket);
  }

  let bestFormat: Exclude<PerformanceFormat, "all"> | null = null;
  let bestAverage = -1;
  for (const [format, bucket] of buckets.entries()) {
    const average = bucket.total / Math.max(1, bucket.count);
    if (average > bestAverage) {
      bestAverage = average;
      bestFormat = format;
    }
  }

  return bestFormat;
}

function findRecurringWinningKeyword(
  snapshots: OwnedPerformanceSnapshotRecord[]
): string | null {
  const keywordCounts = new Map<string, number>();
  const topSnapshots = snapshots
    .filter((snapshot) => snapshot.performanceScore > 0)
    .slice(0, Math.min(12, snapshots.length));

  for (const snapshot of topSnapshots) {
    const uniqueKeywords = new Set(
      buildOwnedKeywordFamilies({
        title: snapshot.title,
        tags: snapshot.tags,
        matchedGameTitle: snapshot.gameTitle || null
      }).filter((keyword) => !COMMON_PACKAGING_STOP_WORDS.has(keyword))
    );

    for (const keyword of uniqueKeywords) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
    }
  }

  let bestKeyword: string | null = null;
  let bestCount = 1;
  for (const [keyword, count] of keywordCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestKeyword = keyword;
    }
  }

  return bestKeyword;
}

function shouldRefreshOwnedSnapshots(
  filters: PerformanceDashboardFilters,
  snapshots: OwnedPerformanceSnapshotRecord[],
  lastFetchedAt: string | null
): boolean {
  const hasTargetPosts = listScheduledPosts().some(
    (post) =>
      post.platform === "youtube" &&
      !!post.remotePostId &&
      isWithinRange(post.publishAt, filters.range)
  );

  if (!hasTargetPosts) {
    return false;
  }

  return snapshots.length === 0 || isOlderThan(lastFetchedAt, PERFORMANCE_OWNED_STALE_MS);
}

function getLatestFetchedAt(values: Array<string | null>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function collectAvailableValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeRange(value: PerformanceDashboardFilters["range"] | undefined): PerformanceRange {
  switch (value) {
    case "7d":
    case "28d":
    case "90d":
    case "365d":
    case "since_2025":
      return value;
    default:
      return "28d";
  }
}

function normalizeFormat(value: PerformanceDashboardFilters["format"] | undefined): PerformanceFormat {
  switch (value) {
    case "shorts":
    case "long_form":
    case "all":
      return value;
    default:
      return "all";
  }
}

function normalizeMetric(
  value: PerformanceDashboardFilters["metric"] | undefined
): PerformanceDashboardFilters["metric"] {
  switch (value) {
    case "views":
    case "average_view_percentage":
    case "likes":
    case "comments":
    case "engaged_views":
      return value;
    default:
      return "engaged_views";
  }
}

function classifyPerformanceFormat(durationMs: number | null): Exclude<PerformanceFormat, "all"> {
  if (durationMs !== null && durationMs <= 180_000) {
    return "shorts";
  }

  return "long_form";
}

function computeAgeDays(publishAt: string): number {
  return Math.max(1, Math.ceil((Date.now() - Date.parse(publishAt)) / 86_400_000));
}

function computePerformanceScore(
  snapshot:
    | Pick<OwnedPerformanceSnapshotRecord, "views" | "engagedViews" | "likes" | "comments">
    | ReturnType<typeof listYouTubePerformanceSnapshots>[number]
    | null,
  publishAt: string
): number {
  if (!snapshot) {
    return 0;
  }

  if (snapshot.engagedViews !== null) {
    return snapshot.engagedViews / computeAgeDays(publishAt);
  }

  return ((snapshot.views ?? 0) + (snapshot.likes ?? 0) * 8 + (snapshot.comments ?? 0) * 12) / computeAgeDays(publishAt);
}

function isWithinRange(value: string, range: PerformanceRange): boolean {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= Date.parse(buildRangeStartIso(range));
}

function buildRangeStartIso(range: PerformanceRange): string {
  if (range === "since_2025") {
    return `${DEFAULT_HISTORY_IMPORT_START_DATE}T00:00:00.000Z`;
  }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "365d" ? 365 : 28;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function isOlderThan(value: string | null, maxAgeMs: number): boolean {
  if (!value) {
    return true;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || Date.now() - timestamp > maxAgeMs;
}

function buildOwnedKeywordFamilies(video: {
  title: string;
  tags: string[];
  matchedGameTitle?: string | null;
}): string[] {
  const tokens = [
    ...video.tags,
    ...tokenizeKeywords(video.title),
    ...(video.matchedGameTitle ? tokenizeKeywords(video.matchedGameTitle) : [])
  ];

  return [...new Set(tokens.map((token) => token.trim().toLowerCase()).filter((token) => token.length >= 3))].slice(
    0,
    10
  );
}

function tokenizeKeywords(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeHistoryImportStartDate(value: string | null | undefined): string {
  const normalizedValue = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? normalizedValue
    : DEFAULT_HISTORY_IMPORT_START_DATE;
}

function normalizeHistoryImportVideoLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_HISTORY_IMPORT_VIDEO_LIMIT;
  }

  return Math.min(Math.max(Math.floor(value ?? DEFAULT_HISTORY_IMPORT_VIDEO_LIMIT), 1), DEFAULT_HISTORY_IMPORT_VIDEO_LIMIT);
}

function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

function matchGameTitleFromText(value: string): string | null {
  const knownGames = collectAvailableValues(listClipMetadataPackages().map((record) => record.gameTitle));
  return matchKnownValueFromText(value, knownGames);
}

function matchKnownValueFromText(value: string, candidates: string[]): string {
  const tokens = normalizeFilterText(value);
  if (!tokens) {
    return "";
  }

  return (
    candidates.find((candidate) => tokens.includes(normalizeFilterText(candidate))) ??
    ""
  );
}

async function getAvailableOllamaModels(): Promise<string[]> {
  await ensureOllamaApiReady().catch(() => undefined);

  const response = await getOllamaJson<OllamaModelTagResponse>("/tags").catch(() => null);
  if (response?.models && response.models.length > 0) {
    return response.models
      .map((model) => model.name ?? model.model ?? "")
      .map((model) => model.trim())
      .filter(Boolean);
  }

  return getInstalledModelsFromManifests();
}

async function ensureOllamaApiReady(): Promise<void> {
  if (await isOllamaApiReachable()) {
    return;
  }

  if (!ollamaStartPromise) {
    ollamaStartPromise = startOllamaServer();
  }

  try {
    await ollamaStartPromise;
  } finally {
    ollamaStartPromise = null;
  }
}

async function startOllamaServer(): Promise<void> {
  const executablePath = findOllamaExecutablePath();
  if (!executablePath) {
    return;
  }

  spawn(executablePath, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();

  for (let attempt = 0; attempt < OLLAMA_START_ATTEMPTS; attempt += 1) {
    if (await isOllamaApiReachable()) {
      return;
    }

    await delay(OLLAMA_START_RETRY_MS);
  }
}

function findOllamaExecutablePath(): string | null {
  return OLLAMA_EXECUTABLE_PATHS.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

async function isOllamaApiReachable(): Promise<boolean> {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}/tags`,
    {
      method: "GET"
    },
    OLLAMA_DISCOVERY_TIMEOUT_MS
  ).catch(() => null);

  return Boolean(response?.ok);
}

async function getOllamaJson<T>(route: string): Promise<T> {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}${route}`,
    {
      method: "GET"
    },
    OLLAMA_DISCOVERY_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function postOllamaJson<T>(
  route: string,
  body: object,
  timeoutMs = OLLAMA_DISCOVERY_TIMEOUT_MS
): Promise<T> {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}${route}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`The Ollama request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getInstalledModelsFromManifests(): Promise<string[]> {
  const manifestsRoot = path.join(
    process.env.OLLAMA_MODELS ?? path.join(os.homedir(), ".ollama", "models"),
    "manifests",
    "registry.ollama.ai",
    "library"
  );

  const discoveredModels: string[] = [];
  const families = await readdir(manifestsRoot, { withFileTypes: true }).catch(() => []);
  for (const family of families) {
    if (!family.isDirectory()) {
      continue;
    }

    const familyPath = path.join(manifestsRoot, family.name);
    const tags = await readdir(familyPath, { withFileTypes: true }).catch(() => []);
    for (const tag of tags) {
      if (!tag.isFile()) {
        continue;
      }

      discoveredModels.push(`${family.name}:${tag.name}`);
    }
  }

  return discoveredModels;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
