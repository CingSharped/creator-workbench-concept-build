import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { usePerformanceWorkflow, type PerformanceApi } from "../../src/renderer/performance/usePerformanceWorkflow";
import { createDefaultPerformanceFilters } from "../../src/shared/workflowPresentation";
import type { PerformanceDashboardFilters, PerformanceDashboardResult, PerformanceVideoDetail, PerformanceCoachResult } from "../../src/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Options = Parameters<typeof usePerformanceWorkflow>[0];
let workflow: ReturnType<typeof usePerformanceWorkflow>;
let options: Options;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let calls: Array<{ method: string; input: unknown }>;
let errors: Array<string | null>;
const defaults = createDefaultPerformanceFilters();
const dashboard = (filters = defaults, stale = false) => ({ filters, requiresOwnedRefresh: stale,
  freshness: { staleAreas: [] }, availableGameTitles: ["Example game"], availableSeriesKeys: ["Example series"] }) as unknown as PerformanceDashboardResult;
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  expect(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function Harness(): null { workflow = usePerformanceWorkflow(options); return null; }
async function setup(): Promise<void> {
  calls = []; errors = [];
  const api: PerformanceApi = {
    getPerformanceDashboard: async (filters) => { calls.push({ method: "read", input: filters }); return dashboard({ ...defaults, ...filters }); },
    refreshPerformanceDashboard: async (filters) => { calls.push({ method: "refresh", input: filters }); return dashboard({ ...defaults, ...filters }); },
    importYouTubeHistoricalPerformance: async (input) => { calls.push({ method: "import", input }); return {
      importedVideoCount: 4, publishedAfter: input!.publishedAfter!, cappedByLimit: true, maxVideos: 20
    } as Awaited<ReturnType<PerformanceApi["importYouTubeHistoricalPerformance"]>>; },
    getPerformanceVideoDetail: async (id) => { calls.push({ method: "detail", input: id }); return { videoId: id } as PerformanceVideoDetail; },
    generatePerformanceCoach: async (input) => { calls.push({ method: "coach", input }); return { summary: "Example coaching" } as PerformanceCoachResult; }
  };
  options = { isActive: false, selectedClipId: null, onError: message => errors.push(message), api };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
async function render(patch: Partial<Options>): Promise<void> {
  options = { ...options, ...patch };
  await act(async () => root.render(<Harness />));
}
const cases: Array<[string, () => Promise<void>]> = [
  ["default state performs no requests until a source of Performance context needs it", async () => {
    equal(workflow.filters, defaults, "Default filters"); equal(calls, [], "No initial requests");
    await render({ selectedClipId: "clip-a" });
    equal(calls, [{ method: "read", input: undefined }], "Edit context uses a local read only");
    equal(workflow.dashboard?.availableGameTitles, ["Example game"], "Context options remain available to Edit");
    await render({ selectedClipId: "clip-b" });
    equal(calls.length, 1, "Loaded context is reused");
  }],
  ["opening Performance loads cached data and retains the existing stale-refresh policy", async () => {
    options.api!.getPerformanceDashboard = async filters => { calls.push({ method: "read", input: filters }); return dashboard({ ...defaults, ...filters }, true); };
    await render({ isActive: true });
    equal(calls.map(call => call.method), ["read", "refresh"], "Existing stale refresh");
    expect(!workflow.loading, "Loading settles");
    await render({ isActive: false });
    expect(workflow.dashboard !== null, "Dashboard survives navigation");
    await render({ isActive: true });
    equal(calls.map(call => call.method), ["read", "refresh", "read", "refresh"], "Re-entry retains existing refresh behaviour");
  }],
  ["filters trim text and invalidate the dependent detail and coaching results", async () => {
    await act(async () => { await workflow.openVideo("video-a"); await workflow.generateCoach(); });
    expect(workflow.videoDetail !== null && workflow.coachResult !== null, "Fixture results loaded");
    await act(async () => workflow.changeFilters({ gameTitle: "  Game  ", seriesKey: "  Series  ", range: "7d" }));
    equal(workflow.filters.gameTitle, "Game", "Trim game title");
    equal(workflow.filters.seriesKey, "Series", "Trim series");
    equal(workflow.filters.range, "7d", "Range updated");
    equal(workflow.videoDetail, null, "Video detail reset");
    equal(workflow.coachResult, null, "Coaching reset");
    expect(!calls.some(call => call.method === "refresh"), "Filter changes alone do not request an external refresh");
  }],
  ["explicit refresh commits buffered text and applies normalized dashboard filters", async () => {
    const pending = deferred<PerformanceDashboardResult>();
    options.api!.refreshPerformanceDashboard = filters => { calls.push({ method: "refresh", input: filters }); return pending.promise; };
    let request!: Promise<void>;
    await act(async () => { request = workflow.refresh({ gameTitle: "  New game  ", seriesKey: "  New series  " }); });
    expect(workflow.refreshing, "Refresh busy state");
    equal(calls[0].input, { ...defaults, gameTitle: "New game", seriesKey: "New series" }, "Committed request filters");
    await act(async () => { pending.resolve(dashboard({ ...defaults, gameTitle: "Normalized game", seriesKey: "New series" })); await request; });
    equal(workflow.filters.gameTitle, "Normalized game", "Server filter normalization retained");
    expect(!workflow.refreshing, "Refresh busy state cleared");
  }],
  ["history import reloads the dashboard and preserves the result message", async () => {
    await act(async () => workflow.importHistory("2026-01-01"));
    equal(calls.map(call => call.method), ["import", "read"], "Import then cached dashboard read");
    equal(calls[0].input, { publishedAfter: "2026-01-01" }, "Import date");
    equal(workflow.message, "Imported 4 channel videos from 2026-01-01 (capped at 20).", "Import message");
    expect(!workflow.importingHistory, "Import busy state cleared");
  }],
  ["video detail loading, failure and close state remain local to Performance", async () => {
    const pending = deferred<PerformanceVideoDetail>();
    options.api!.getPerformanceVideoDetail = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.openVideo("video-a"); });
    expect(workflow.videoDetailLoading, "Detail busy state");
    await act(async () => { pending.resolve({ videoId: "video-a" } as PerformanceVideoDetail); await request; });
    equal(workflow.videoDetail?.videoId, "video-a", "Selected detail");
    await act(async () => workflow.closeVideo());
    equal(workflow.videoDetail, null, "Detail closes");
    options.api!.getPerformanceVideoDetail = async () => { throw new Error("Detail unavailable"); };
    await act(async () => workflow.openVideo("video-b"));
    equal(workflow.videoDetailError, "Detail unavailable", "Detail error displayed");
    expect(!workflow.videoDetailLoading, "Failed detail clears busy state");
    equal(errors, [], "Detail errors do not overwrite shell errors");
  }],
  ["coaching uses committed filters and reports failures through the shell callback", async () => {
    await act(async () => workflow.changeFilters({ range: "7d" }));
    await act(async () => workflow.generateCoach("video", "video-a"));
    equal(calls[0], { method: "coach", input: { filters: { ...defaults, range: "7d" }, videoId: "video-a", focus: "video" } }, "Coaching context");
    equal(workflow.coachResult?.summary, "Example coaching", "Coaching result");
    options.api!.generatePerformanceCoach = async () => { throw new Error("Model unavailable"); };
    await act(async () => workflow.generateCoach());
    equal(errors.at(-1), "Model unavailable", "Shared error callback");
    expect(!workflow.generatingCoach, "Coaching failure clears busy state");
    await act(async () => workflow.setMessage("Opened the related clip in Edit."));
    equal(workflow.message, "Opened the related clip in Edit.", "Shell handoff can set its message");
  }],
  ["late cached loads after leaving Performance do not update the dashboard", async () => {
    const pending = deferred<PerformanceDashboardResult>();
    options.api!.getPerformanceDashboard = () => pending.promise;
    await render({ isActive: true });
    await render({ isActive: false });
    await act(async () => pending.resolve(dashboard()));
    equal(workflow.dashboard, null, "Abandoned view load is ignored");
  }]
];

async function run(): Promise<void> {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, check] of cases) {
    try { await setup(); await check(); results.push({ name }); }
    catch (error) { results.push({ name, error: error instanceof Error ? error.stack : String(error) }); }
    finally { await act(async () => root?.unmount()); host?.remove(); }
  }
  console.log("PERFORMANCE_WORKFLOW_RESULTS:" + JSON.stringify(results));
}
void run();
