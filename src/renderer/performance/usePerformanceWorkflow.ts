import { useEffect, useRef, useState } from "react";
import type {
  CreatorAppApi,
  PerformanceCoachFocus,
  PerformanceCoachResult,
  PerformanceDashboardFilters,
  PerformanceDashboardResult,
  PerformanceVideoDetail
} from "../../shared/contracts";
import { arePerformanceFiltersEqual, createDefaultPerformanceFilters } from "../../shared/workflowPresentation";

export type PerformanceApi = Pick<CreatorAppApi,
  "getPerformanceDashboard" | "refreshPerformanceDashboard" | "importYouTubeHistoricalPerformance" |
  "getPerformanceVideoDetail" | "generatePerformanceCoach">;

interface PerformanceWorkflowOptions {
  isActive: boolean;
  selectedClipId: string | null;
  onError: (message: string | null) => void;
  api?: PerformanceApi;
}

/** Owns Performance state and requests. Navigation and Edit handoffs belong to the shell. */
export function usePerformanceWorkflow({
  isActive: isPerformanceView,
  selectedClipId,
  onError: setError,
  api = window.creatorApp
}: PerformanceWorkflowOptions) {
  const [performanceDashboard, setPerformanceDashboard] = useState<PerformanceDashboardResult | null>(null);
  const [performanceFilters, setPerformanceFilters] = useState<PerformanceDashboardFilters>(
    createDefaultPerformanceFilters()
  );
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [refreshingPerformanceDashboard, setRefreshingPerformanceDashboard] = useState(false);
  const [importingPerformanceHistory, setImportingPerformanceHistory] = useState(false);
  const [generatingPerformanceCoach, setGeneratingPerformanceCoach] = useState(false);
  const [performanceCoachResult, setPerformanceCoachResult] = useState<PerformanceCoachResult | null>(null);
  const [performanceVideoDetail, setPerformanceVideoDetail] = useState<PerformanceVideoDetail | null>(null);
  const [performanceVideoDetailLoading, setPerformanceVideoDetailLoading] = useState(false);
  const [performanceVideoDetailError, setPerformanceVideoDetailError] = useState<string | null>(null);
  const performanceAutoRefreshKeyRef = useRef<string | null>(null);
  const [performanceMessage, setPerformanceMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedClipId || performanceDashboard) {
      return;
    }

    let cancelled = false;
    void api.getPerformanceDashboard()
      .then((dashboard) => {
        if (!cancelled) {
          setPerformanceDashboard(dashboard);
        }
      })
      .catch(() => {
        // Context suggestions are optional; keep the editor usable if the local read fails.
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClipId, performanceDashboard]);

  useEffect(() => {
    if (!isPerformanceView) {
      performanceAutoRefreshKeyRef.current = null;
      return;
    }

    let cancelled = false;
    setPerformanceLoading(true);
    const performanceLoadKey = JSON.stringify(performanceFilters);

    void api
      .getPerformanceDashboard(performanceFilters)
      .then((dashboard) => {
        if (cancelled) {
          return;
        }

        applyPerformanceDashboardResult(dashboard);
        if (
          (dashboard.requiresOwnedRefresh || dashboard.freshness?.staleAreas.includes("channel") || dashboard.freshness?.staleAreas.includes("breakdowns")) &&
          performanceAutoRefreshKeyRef.current !== performanceLoadKey
        ) {
          performanceAutoRefreshKeyRef.current = performanceLoadKey;
          void api.refreshPerformanceDashboard(dashboard.filters)
            .then((refreshedDashboard) => {
              if (!cancelled) {
                applyPerformanceDashboardResult(refreshedDashboard);
              }
            })
            .catch(() => {
              // Cached data remains usable when an app-open refresh cannot complete.
            });
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load the performance dashboard.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPerformanceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    isPerformanceView,
    performanceFilters
  ]);

  function handlePerformanceFilterChange(patch: Partial<PerformanceDashboardFilters>): void {
    setPerformanceCoachResult(null);
    setPerformanceVideoDetail(null);
    setPerformanceVideoDetailError(null);
    setPerformanceFilters((currentFilters) => ({
      ...currentFilters,
      ...patch,
      gameTitle:
        patch.gameTitle !== undefined ? patch.gameTitle.trim() : currentFilters.gameTitle,
      seriesKey:
        patch.seriesKey !== undefined ? patch.seriesKey.trim() : currentFilters.seriesKey
    }));
  }

  function commitPerformanceTextFilters(
    overrides?: Partial<Pick<PerformanceDashboardFilters, "gameTitle" | "seriesKey">>
  ): PerformanceDashboardFilters {
    const normalizedGameTitle = overrides?.gameTitle?.trim();
    const normalizedSeriesKey = overrides?.seriesKey?.trim();
    const nextFilters = {
      ...performanceFilters,
      gameTitle: normalizedGameTitle ?? performanceFilters.gameTitle,
      seriesKey: normalizedSeriesKey ?? performanceFilters.seriesKey
    };

    setPerformanceFilters((currentFilters) =>
      arePerformanceFiltersEqual(currentFilters, nextFilters) ? currentFilters : nextFilters
    );
    if (!arePerformanceFiltersEqual(performanceFilters, nextFilters)) {
      setPerformanceCoachResult(null);
      setPerformanceVideoDetail(null);
      setPerformanceVideoDetailError(null);
    }

    return nextFilters;
  }

  function applyPerformanceDashboardResult(dashboard: PerformanceDashboardResult): void {
    setPerformanceDashboard(dashboard);
    setPerformanceFilters((currentFilters) =>
      arePerformanceFiltersEqual(currentFilters, dashboard.filters) ? currentFilters : dashboard.filters
    );
  }

  async function refreshPerformanceDashboardData(
    textOverrides?: Partial<Pick<PerformanceDashboardFilters, "gameTitle" | "seriesKey">>
  ): Promise<void> {
    const nextFilters = commitPerformanceTextFilters(textOverrides);
    setRefreshingPerformanceDashboard(true);
    setError(null);
    setPerformanceMessage(null);

    try {
      const dashboard = await api.refreshPerformanceDashboard(nextFilters);
      applyPerformanceDashboardResult(dashboard);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh the performance dashboard.");
    } finally {
      setRefreshingPerformanceDashboard(false);
    }
  }

  async function handleImportYouTubeHistoricalPerformance(publishedAfter: string): Promise<void> {
    if (typeof api.importYouTubeHistoricalPerformance !== "function") {
      setError(
        "This app window is using an older desktop API. Close and reopen the app to load the latest historical import action."
      );
      return;
    }

    setImportingPerformanceHistory(true);
    setError(null);
    setPerformanceMessage(null);

    try {
      const result = await api.importYouTubeHistoricalPerformance({
        publishedAfter
      });
      const nextDashboard = await api.getPerformanceDashboard(performanceFilters);
      applyPerformanceDashboardResult(nextDashboard);
      setPerformanceMessage(
        result.importedVideoCount === 0
          ? `No channel videos were found on or after ${result.publishedAfter}.`
          : `Imported ${result.importedVideoCount} channel videos from ${result.publishedAfter}${result.cappedByLimit ? ` (capped at ${result.maxVideos})` : ""}.`
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to import historical YouTube performance."
      );
    } finally {
      setImportingPerformanceHistory(false);
    }
  }

  async function handleOpenPerformanceVideo(videoId: string): Promise<void> {
    if (typeof api.getPerformanceVideoDetail !== "function") {
      setError("Close and reopen the app to load video performance detail.");
      return;
    }

    setPerformanceVideoDetailLoading(true);
    setPerformanceVideoDetailError(null);
    setPerformanceVideoDetail(null);
    try {
      const detail = await api.getPerformanceVideoDetail(videoId);
      setPerformanceVideoDetail(detail);
    } catch (nextError) {
      setPerformanceVideoDetailError(nextError instanceof Error ? nextError.message : "Failed to load video performance detail.");
    } finally {
      setPerformanceVideoDetailLoading(false);
    }
  }

  function handleClosePerformanceVideoDetail(): void {
    setPerformanceVideoDetail(null);
    setPerformanceVideoDetailError(null);
    setPerformanceVideoDetailLoading(false);
  }

  async function handleGeneratePerformanceCoach(focus: PerformanceCoachFocus = "overview", videoId?: string): Promise<void> {
    if (typeof api.generatePerformanceCoach !== "function") {
      setError("Close and reopen the app to load the Performance Coach action.");
      return;
    }

    setGeneratingPerformanceCoach(true);
    setError(null);
    try {
      const result = await api.generatePerformanceCoach({
        filters: performanceFilters,
        videoId,
        focus
      });
      setPerformanceCoachResult(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to generate performance coaching.");
    } finally {
      setGeneratingPerformanceCoach(false);
    }
  }

  return {
    dashboard: performanceDashboard,
    filters: performanceFilters,
    loading: performanceLoading,
    refreshing: refreshingPerformanceDashboard,
    importingHistory: importingPerformanceHistory,
    generatingCoach: generatingPerformanceCoach,
    coachResult: performanceCoachResult,
    videoDetail: performanceVideoDetail,
    videoDetailLoading: performanceVideoDetailLoading,
    videoDetailError: performanceVideoDetailError,
    message: performanceMessage,
    setMessage: setPerformanceMessage,
    changeFilters: handlePerformanceFilterChange,
    refresh: refreshPerformanceDashboardData,
    importHistory: handleImportYouTubeHistoricalPerformance,
    openVideo: handleOpenPerformanceVideo,
    closeVideo: handleClosePerformanceVideoDetail,
    generateCoach: handleGeneratePerformanceCoach
  };
}
