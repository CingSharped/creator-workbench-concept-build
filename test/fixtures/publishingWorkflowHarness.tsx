import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { usePublishingWorkflow, type PublishingApi } from "../../src/renderer/publishing/usePublishingWorkflow";
import { useYouTubePlaylists } from "../../src/renderer/publishing/useYouTubePlaylists";
import type { ReviewedMetadataHandoff } from "../../src/renderer/edit/reviewedMetadata";
import type { ClipMetadataPackageDraft, ScheduledPostRecord, YouTubeConnectionStatus, CreatorAppApi, PostingScheduleSettings } from "../../src/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let workflow: ReturnType<typeof usePublishingWorkflow>;
let playlists: ReturnType<typeof useYouTubePlaylists>;
let api: PublishingApi & Pick<CreatorAppApi, "listYouTubePlaylists">;
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
let select: (id: string) => void, connect: (connection: YouTubeConnectionStatus) => void;
let errors: Array<string | null>, calls: Array<{ method: string; args: unknown[] }>, refreshes: number;
const connection = (id = "channel-a") => ({ connected: true, channelId: id, channelTitle: id, clientId: "client" } as YouTubeConnectionStatus);
const post = (id = "post-a", captionStatus = "failed") => ({ id, clipId: "a", platform: "youtube", status: "scheduled", captionStatus } as ScheduledPostRecord);
const settings = { enabled: true, timeZone: "Europe/London", slots: [] } as unknown as PostingScheduleSettings;
function expect(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  expect(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function handoff(): ReviewedMetadataHandoff & { accepted: number; current: boolean } {
  const value = {
    clipId: "a", draft: { title: "Reviewed title", description: "Reviewed description", tags: ["reviewed"], latestScoreSnapshot: {} } as ClipMetadataPackageDraft,
    accepted: 0, current: true,
    isCurrent: () => value.current,
    acceptSaved: () => { if (value.current) value.accepted++; }
  };
  return value;
}
function Harness() {
  const [clip, setClip] = useState("a"), [account, setAccount] = useState(connection());
  select = setClip; connect = setAccount;
  workflow = usePublishingWorkflow({ selectedClipId: clip, connection: account, api,
    onError: message => errors.push(message), onRefreshWorkspace: async () => { refreshes++; } });
  playlists = useYouTubePlaylists({ selectedClipId: clip, connection: account, api, onError: message => errors.push(message) });
  return null;
}
async function initialize() {
  errors = []; calls = []; refreshes = 0;
  const operation = (method: string, result: unknown) => async (...args: unknown[]) => { calls.push({ method, args }); return result; };
  api = {
    getPostingSchedule: operation("read-settings", settings),
    getNextAvailablePostingSlot: operation("slot", { reason: "available", localLabel: "Tomorrow" }),
    listScheduledPosts: operation("list", [post()]),
    listYouTubePlaylists: operation("playlists", [{ id: "one" }, { id: "two" }]),
    savePostingSchedule: async input => { calls.push({ method: "settings", args: [input] }); return input; },
    evaluateClipMetadataPackage: operation("evaluate", {}),
    saveClipMetadata: async (id, draft) => { calls.push({ method: "save", args: [id, draft] }); return { ...draft, clipId: id } as any; },
    createScheduledPost: operation("create", post()),
    createScheduledPostAtNextSlot: operation("next", post()),
    refreshScheduledPostStatuses: operation("refresh", { posts: [post()], checkedCount: 1, updatedCount: 0, skippedCount: 0, unavailableCount: 0 }),
    retryYouTubeCaptions: operation("captions", post("post-a", "uploaded")),
    reconcileYouTubeUpload: operation("reconcile", post())
  } as PublishingApi & Pick<CreatorAppApi, "listYouTubePlaylists">;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<React.StrictMode><Harness /></React.StrictMode>));
}
const cases: Array<[string, () => Promise<void>]> = [
  ["mount reads settings and playlists without publishing", async () => {
    expect(workflow.postingSchedule !== null && playlists.loaded, "Initial reads");
    expect(!calls.some(item => ["create", "save", "next", "captions", "reconcile", "settings"].includes(item.method)), "No mutations");
  }],
  ["schedule snapshots reviewed metadata, time and playlists while switching clips", async () => {
    const pending = deferred<any>(), reviewed = handoff(), ids = ["one"];
    api.saveClipMetadata = async (id, draft) => { calls.push({ method: "save", args: [id, draft] }); return pending.promise; };
    await act(async () => workflow.setPublishAt("2026-11-01T12:30"));
    let request!: Promise<void>;
    await act(async () => { request = workflow.schedule(reviewed, ids); });
    ids.push("two"); reviewed.draft.title = "Changed"; reviewed.current = false;
    await act(async () => select("b"));
    await act(async () => workflow.setPublishAt("2026-11-02T15:00"));
    await act(async () => { pending.resolve({}); await request; });
    const call = calls.find(item => item.method === "create")!;
    equal(call.args, ["a", { platform: "youtube", publishAt: "2026-11-01T12:30", accountLabel: "channel-a", youtubePlaylistIds: ["one"] }], "Captured request");
    equal((calls.find(item => item.method === "save")!.args[1] as any).title, "Reviewed title", "Captured metadata");
    equal(workflow.publishAt, "2026-11-02T15:00", "New composer retained");
    equal([reviewed.accepted, refreshes, workflow.message], [0, 0, null], "No stale Edit adoption");
    equal(workflow.posts[0].id, "post-a", "Global queue retains result");
  }],
  ["newer edit revision prevents scheduling completion refreshing the draft", async () => {
    const pending = deferred<ScheduledPostRecord>(), reviewed = handoff();
    api.createScheduledPost = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.schedule(reviewed, []); });
    reviewed.current = false;
    await act(async () => { pending.resolve(post()); await request; });
    equal(refreshes, 0, "No stale refresh"); expect(!workflow.creating, "Busy cleared");
  }],
  ["successful current schedule acknowledges saved metadata and refreshes workspace", async () => {
    const reviewed = handoff();
    await act(async () => workflow.schedule(reviewed, []));
    equal([reviewed.accepted, refreshes], [1, 1], "Current handoff");
    expect(workflow.message?.includes("captions need attention"), "Caption warning preserved");
  }],
  ["invalid titles and disconnected accounts never save or upload", async () => {
    const reviewed = handoff(); reviewed.draft.title = "";
    await act(async () => workflow.schedule(reviewed, []));
    reviewed.draft.title = "x".repeat(101);
    await act(async () => workflow.schedule(reviewed, []));
    reviewed.draft.title = "Valid";
    await act(async () => connect({ ...connection(), connected: false }));
    await act(async () => workflow.schedule(reviewed, []));
    expect(!calls.some(item => item.method === "save" || item.method === "create"), "No mutations");
    expect(errors.filter(Boolean).length === 3, "Validation errors");
  }],
  ["connection change while saving blocks external scheduling", async () => {
    const pending = deferred<any>(); api.saveClipMetadata = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.schedule(handoff(), []); });
    await act(async () => connect(connection("channel-b")));
    await act(async () => { pending.resolve({}); await request; });
    expect(!calls.some(item => item.method === "create"), "No upload for changed account");
    expect(errors.some(error => error?.includes("connection changed")), "Account explanation");
  }],
  ["uncertain scheduling failure reloads persisted queue without retrying upload", async () => {
    let attempts = 0;
    api.createScheduledPost = async () => { attempts++; throw new Error("Upload uncertain"); };
    api.listScheduledPosts = async () => [{ ...post(), status: "reconciliation_required" }];
    await act(async () => workflow.schedule(handoff(), []));
    equal(attempts, 1, "Single explicit upload");
    equal(workflow.posts[0].status, "reconciliation_required", "Recovered persisted status");
    equal(errors.at(-1), "Upload uncertain", "Real error");
    expect(!workflow.busy, "Busy cleared");
  }],
  ["next-slot and TikTok use their existing distinct actions", async () => {
    await act(async () => workflow.schedule(handoff(), ["two"], true));
    equal(calls.find(item => item.method === "next")!.args, ["a", ["two"]], "Canonical next slot");
    await act(async () => workflow.setPlatform("tiktok"));
    await act(async () => workflow.schedule(handoff(), [], true));
    equal(calls.filter(item => item.method === "next").length, 1, "YouTube only");
    await act(async () => workflow.schedule(handoff(), ["two"]));
    const input = calls.find(item => item.method === "create")!.args[1] as any;
    equal(input.platform, "tiktok", "Draft handoff"); equal(input.youtubePlaylistIds, undefined, "No YouTube playlists");
  }],
  ["duplicate clicks cannot dispatch duplicate creates or same-post recovery", async () => {
    const pending = deferred<ScheduledPostRecord>(); api.createScheduledPost = () => { calls.push({ method: "create", args: [] }); return pending.promise; };
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = workflow.schedule(handoff(), []); second = workflow.schedule(handoff(), []); });
    equal(calls.filter(item => item.method === "create").length, 1, "One create");
    await act(async () => { pending.resolve(post()); await Promise.all([first, second]); });
    const recovery = deferred<ScheduledPostRecord>();
    api.retryYouTubeCaptions = () => recovery.promise;
    await act(async () => { first = workflow.retryCaptions("post-a"); second = workflow.reconcileUpload("post-a"); });
    expect(!calls.some(item => item.method === "reconcile"), "Same post locked");
    await act(async () => { recovery.resolve(post("post-a", "uploaded")); await Promise.all([first, second]); });
  }],
  ["caption retry remains attached to its post across clip changes", async () => {
    const pending = deferred<ScheduledPostRecord>(); api.retryYouTubeCaptions = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { workflow.capturePostsRead()([post()]); request = workflow.retryCaptions("post-a"); });
    await act(async () => select("b"));
    await act(async () => { pending.resolve(post("post-a", "uploaded")); await request; });
    equal(workflow.posts[0].captionStatus, "uploaded", "Original post updated");
    equal([workflow.retryingPostId, refreshes], [null, 0], "No Edit refresh");
  }],
  ["old background and status snapshots cannot overwrite completed caption retry", async () => {
    const pending = deferred<any>();
    api.refreshScheduledPostStatuses = () => pending.promise;
    let refresh!: Promise<void>, accept!: ReturnType<typeof workflow.capturePostsRead>;
    await act(async () => { workflow.capturePostsRead()([post()]); accept = workflow.capturePostsRead(); refresh = workflow.refreshStatuses(); });
    await act(async () => workflow.retryCaptions("post-a"));
    await act(async () => { pending.resolve({ posts: [post()], checkedCount: 1, updatedCount: 0 }); await refresh; accept([post()]); });
    equal(workflow.posts[0].captionStatus, "uploaded", "Newer result survives both old reads");
  }],
  ["upload reconciliation failure reloads queue and clears its own busy state", async () => {
    api.reconcileYouTubeUpload = async () => { throw new Error("Remote unavailable"); };
    await act(async () => workflow.reconcileUpload("post-a"));
    equal(workflow.posts[0].id, "post-a", "Reload queue");
    equal(errors.at(-1), "Remote unavailable", "Recovery error"); equal(workflow.reconcilingPostId, null, "Busy cleared");
  }],
  ["playlist refresh prunes current choices and preserves choices made while loading", async () => {
    const pending = deferred<any>(); api.listYouTubePlaylists = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { playlists.selectIds(["one"]); request = playlists.refresh(); });
    await act(async () => playlists.selectIds(["two", "gone"]));
    await act(async () => { pending.resolve([{ id: "two" }]); await request; });
    equal(playlists.selectedIds, ["two"], "Latest selection pruned"); expect(playlists.message?.startsWith("1 selected"), "Pruning explained");
  }],
  ["old playlist refresh cannot prune a different clip's selection", async () => {
    const pending = deferred<any>(); api.listYouTubePlaylists = () => pending.promise;
    let request!: Promise<void>; await act(async () => { request = playlists.refresh(); });
    await act(async () => select("b"));
    await act(async () => playlists.selectIds(["two"]));
    await act(async () => { pending.resolve([{ id: "one" }]); await request; });
    equal(playlists.selectedIds, ["two"], "New clip choices retained");
  }],
  ["account A to B to A rejects the first A playlist response and error", async () => {
    const first = deferred<any>(); api.listYouTubePlaylists = () => first.promise;
    let request!: Promise<void>; await act(async () => { request = playlists.refresh(); });
    api.listYouTubePlaylists = async () => [{ id: "fresh" }] as any;
    await act(async () => connect(connection("channel-b")));
    await act(async () => connect(connection()));
    await act(async () => { first.reject(new Error("Old account failure")); await request; });
    equal(playlists.playlists.map(item => item.id), ["fresh"], "New account catalogue");
    expect(!errors.some(Boolean), "No stale account error");
  }],
  ["posting settings save survives old initial reads and slot lookup failures", async () => {
    const initial = deferred<PostingScheduleSettings>();
    // Remount with an intentionally delayed initial settings read.
    await act(async () => root.unmount());
    api.getPostingSchedule = () => initial.promise;
    api.getNextAvailablePostingSlot = async () => { throw new Error("Slot unavailable"); };
    root = createRoot(host); await act(async () => root.render(<Harness />));
    const changed = { ...settings, enabled: false };
    await act(async () => workflow.savePostingSchedule(changed));
    await act(async () => initial.resolve(settings));
    equal(workflow.postingSchedule, changed, "Old read rejected");
    expect(workflow.postingScheduleMessage?.includes("saved"), "Saved independently of slot lookup");
    expect(!errors.some(Boolean), "Slot read is not a save failure");
  }],
  ["unmount before metadata save completes prevents starting upload", async () => {
    const pending = deferred<any>(); api.saveClipMetadata = () => pending.promise;
    let request!: Promise<void>; const reviewed = handoff();
    await act(async () => { request = workflow.schedule(reviewed, []); });
    await act(async () => root.unmount());
    await act(async () => { pending.resolve({}); await request; });
    equal(reviewed.accepted, 0, "No abandoned Edit acknowledgement");
    expect(!calls.some(item => item.method === "create"), "No new external stage after unmount");
  }]
];
async function run() {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, check] of cases) {
    try { await initialize(); await check(); results.push({ name }); }
    catch (error) { results.push({ name, error: error instanceof Error ? error.stack : String(error) }); }
    finally { await act(async () => root?.unmount()); host?.remove(); }
  }
  console.log("PUBLISHING_WORKFLOW_RESULTS:" + JSON.stringify(results));
}
void run();
