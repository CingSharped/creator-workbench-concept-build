import { useEffect, useRef, useState } from "react";
import type {
  CreatorAppApi, NextAvailablePostingSlotResult, PostingScheduleSettings,
  PublishPlatform, ScheduledPostRecord, YouTubeConnectionStatus
} from "../../shared/contracts";
import { YOUTUBE_VIDEO_TITLE_MAX_LENGTH } from "../../shared/platformLimits";
import type { ReviewedMetadataHandoff } from "../edit/reviewedMetadata";
import { useEditingSession } from "../useEditingSession";
import { youtubeAccountKey } from "./useYouTubePlaylists";

export type PublishingApi = Pick<CreatorAppApi,
  "executeAction" | "evaluateClipMetadataPackage" | "saveClipMetadata" | "createScheduledPost" |
  "createScheduledPostAtNextSlot" | "listScheduledPosts" | "refreshScheduledPostStatuses" |
  "retryYouTubeCaptions" | "reconcileYouTubeUpload" | "getPostingSchedule" |
  "savePostingSchedule" | "getNextAvailablePostingSlot">;
interface Options {
  selectedClipId: string | null;
  connection: YouTubeConnectionStatus | null;
  onError: (message: string | null) => void;
  onRefreshWorkspace: () => Promise<void>;
  api?: PublishingApi;
}
function defaultPublishTime(): string {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function scheduleMessage(post: ScheduledPostRecord): string {
  if (["unavailable", "failed", "reconnect_required"].includes(post.captionStatus)) {
    return `Clip uploaded to YouTube, but captions need attention: ${post.captionErrorMessage ?? "retry captions from the queued post details."}`;
  }
  return post.status === "scheduled"
    ? "Clip uploaded to YouTube and handed off to YouTube's native scheduler."
    : "Clip uploaded to YouTube.";
}

/** Owns publishing state; it never reads or selects a different Edit clip after dispatch. */
export function usePublishingWorkflow({
  selectedClipId, connection, onError, onRefreshWorkspace, api = window.creatorApp
}: Options) {
  const session = useEditingSession(selectedClipId);
  const account = useEditingSession(youtubeAccountKey(connection));
  const lifetime = useEditingSession("publishing");
  const [posts, setPosts] = useState<ScheduledPostRecord[]>([]);
  const postsRevision = useRef(0);
  const postVersions = useRef(new Map<string, number>());
  const mutations = useRef(0);
  const locks = useRef(new Set<string>());
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingPostId, setRetryingPostId] = useState<string | null>(null);
  const [reconcilingPostId, setReconcilingPostId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PublishPlatform>("youtube");
  const [accountLabel, setAccountLabel] = useState("Primary account");
  const [publishAt, setPublishAt] = useState("");
  const [postingSchedule, setPostingSchedule] = useState<PostingScheduleSettings | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [postingScheduleMessage, setPostingScheduleMessage] = useState<string | null>(null);
  const [nextSlot, setNextSlot] = useState<NextAvailablePostingSlotResult | null>(null);
  const settingsRevision = useRef(0);

  useEffect(() => {
    setPlatform("youtube"); setPublishAt(defaultPublishTime()); setMessage(null);
    setAccountLabel(connection?.channelTitle ?? "Primary account");
  }, [selectedClipId]);
  useEffect(() => {
    if (platform === "youtube") setAccountLabel(connection?.channelTitle ?? "Primary account");
  }, [platform, connection?.channelTitle]);
  useEffect(() => {
    const ticket = lifetime.capture(), revision = settingsRevision.current;
    void api.getPostingSchedule().then(saved => {
      if (lifetime.owns(ticket) && revision === settingsRevision.current) setPostingSchedule(saved);
    }).catch(error => {
      if (lifetime.owns(ticket) && revision === settingsRevision.current)
        onError(error instanceof Error ? error.message : "Failed to load posting times.");
    });
  }, []);
  useEffect(() => {
    if (platform !== "youtube") { setNextSlot(null); return; }
    let cancelled = false;
    const ticket = account.capture();
    void api.getNextAvailablePostingSlot().then(result => {
      if (!cancelled && account.owns(ticket)) setNextSlot(result);
    }).catch(() => { if (!cancelled && account.owns(ticket)) setNextSlot(null); });
    return () => { cancelled = true; };
  }, [platform, connection?.connected, connection?.channelId, posts, postingSchedule]);
  useEffect(() => { setMessage(null); }, [connection?.connected, connection?.channelId]);

  /** Capture before starting a read; later mutations invalidate that read's snapshot. */
  function capturePostsRead(): (snapshot: ScheduledPostRecord[]) => void {
    const revision = postsRevision.current, ticket = lifetime.capture();
    return snapshot => {
      if (lifetime.owns(ticket) && revision === postsRevision.current && mutations.current === 0) adoptSnapshot(snapshot);
    };
  }
  function adoptSnapshot(snapshot: ScheduledPostRecord[]): void {
    postsRevision.current++;
    for (const post of snapshot) postVersions.current.set(post.id, (postVersions.current.get(post.id) ?? 0) + 1);
    setPosts(snapshot);
  }
  function begin(key: string): boolean {
    if (locks.current.has(key)) return false;
    locks.current.add(key); mutations.current++; postsRevision.current++;
    return true;
  }
  function finish(key: string): void {
    locks.current.delete(key); mutations.current--; postsRevision.current++;
  }
  async function reloadPosts(): Promise<void> {
    const revision = postsRevision.current, ticket = lifetime.capture();
    const snapshot = await api.listScheduledPosts();
    if (lifetime.owns(ticket) && revision === postsRevision.current) adoptSnapshot(snapshot);
  }
  function adopt(post: ScheduledPostRecord): void {
    postsRevision.current++;
    postVersions.current.set(post.id, (postVersions.current.get(post.id) ?? 0) + 1);
    setPosts(current => current.some(item => item.id === post.id)
      ? current.map(item => item.id === post.id ? post : item) : [post, ...current]);
  }

  async function schedule(
    handoff: ReviewedMetadataHandoff | null, playlistIds: string[], nextAvailable = false
  ): Promise<void> {
    if (!handoff || locks.current.has("create")) return;
    const title = handoff.draft.title.trim();
    if (!title) { onError("Add a title before scheduling the post."); return; }
    if (title.length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH) {
      onError(`Shorten the title to ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters or fewer before scheduling.`); return;
    }
    if (platform === "youtube" && !connection?.connected) {
      onError("Connect your YouTube account in Settings before scheduling uploads there."); return;
    }
    if (nextAvailable && platform !== "youtube") {
      onError("The next-slot action is available for YouTube only."); return;
    }
    const request = {
      clipId: handoff.clipId, draft: structuredClone(handoff.draft),
      playlistIds: [...playlistIds], platform, accountLabel,
      publishAt, channelTitle: connection?.channelTitle
    };
    const ticket = session.capture(), accountTicket = account.capture(), alive = lifetime.capture();
    begin("create"); setCreating(true); setMessage(null); onError(null);
    try {
      const score = request.draft.latestScoreSnapshot ??
        await api.evaluateClipMetadataPackage(request.clipId, request.draft);
      if (!lifetime.owns(alive)) return;
      const saved = await api.saveClipMetadata(request.clipId, { ...request.draft, latestScoreSnapshot: score });
      if (!lifetime.owns(alive)) return;
      handoff.acceptSaved(saved);
      if (request.platform === "youtube" && !account.owns(accountTicket)) {
        throw new Error("The YouTube connection changed. Review the account and schedule again.");
      }
      const post = nextAvailable
        ? await api.createScheduledPostAtNextSlot(request.clipId, request.playlistIds)
        : await api.createScheduledPost(request.clipId, {
            platform: request.platform, publishAt: request.publishAt,
            accountLabel: request.platform === "youtube" ? request.channelTitle ?? request.accountLabel : request.accountLabel,
            youtubePlaylistIds: request.platform === "youtube" ? request.playlistIds : undefined
          });
      if (!lifetime.owns(alive)) return;
      adopt(post);
      if (session.owns(ticket) && handoff.isCurrent()) {
        setMessage(request.platform === "youtube" ? scheduleMessage(post) : "Metadata saved and queued into the publish backlog.");
        await onRefreshWorkspace().catch(error => {
          if (lifetime.owns(alive) && session.owns(ticket) && handoff.isCurrent())
            onError("Post created, but workspace refresh failed: " + (error instanceof Error ? error.message : "try refreshing again."));
        });
      }
    } catch (error) {
      if (!lifetime.owns(alive)) return;
      await reloadPosts().catch(() => undefined);
      const detail = error instanceof Error ? error.message : "Failed to create the scheduled post.";
      if (session.owns(ticket) && handoff.isCurrent()) onError(detail);
      else setStatusMessage(`Scheduling clip ${request.clipId}: ${detail}`);
    } finally {
      finish("create");
      if (lifetime.owns(alive)) setCreating(false);
    }
  }

  async function removePost(postId: string) {
    const key = "post:" + postId;
    if (!begin(key)) return;
    const ticket = lifetime.capture();
    try {
      await api.executeAction("scheduled_posts.remove", { postId });
      if (!lifetime.owns(ticket)) return;
      postVersions.current.set(postId, (postVersions.current.get(postId) ?? 0) + 1);
      setPosts(current => current.filter(post => post.id !== postId));
      setStatusMessage("Removed from the local queue.");
    } catch (error) {
      if (lifetime.owns(ticket)) onError(error instanceof Error ? error.message : "Failed to remove queued post.");
    } finally {
      finish(key);
    }
  }

  async function refreshStatuses(): Promise<void> {
    if (!begin("refresh")) return;
    const ticket = lifetime.capture();
    setRefreshing(true); setStatusMessage(null); onError(null);
    const versions = new Map(postVersions.current);
    try {
      const result = await api.refreshScheduledPostStatuses();
      if (!lifetime.owns(ticket)) return;
      // Merge only the returned records; unrelated concurrent post actions retain ownership.
      setPosts(current => {
        const byId = new Map(current.map(post => [post.id, post]));
        for (const post of result.posts) {
          if (!locks.current.has("post:" + post.id) && versions.get(post.id) === postVersions.current.get(post.id)) byId.set(post.id, post);
        }
        return [...byId.values()];
      });
      const details = [`Checked ${result.checkedCount} YouTube post${result.checkedCount === 1 ? "" : "s"}`, `${result.updatedCount} status${result.updatedCount === 1 ? "" : "es"} updated`];
      if (result.skippedCount) details.push(`${result.skippedCount} skipped without a remote YouTube ID`);
      if (result.unavailableCount) details.push(`${result.unavailableCount} remote video${result.unavailableCount === 1 ? "" : "s"} unavailable`);
      setStatusMessage(details.join(" | ") + ".");
    } catch (error) {
      if (lifetime.owns(ticket)) onError(error instanceof Error ? error.message : "Failed to refresh queued post statuses.");
    } finally {
      finish("refresh"); if (lifetime.owns(ticket)) setRefreshing(false);
    }
  }

  async function updatePost(postId: string, kind: "captions" | "reconcile"): Promise<void> {
    const key = "post:" + postId, group = kind;
    if (locks.current.has(key) || !begin(group)) return;
    locks.current.add(key);
    postVersions.current.set(postId, (postVersions.current.get(postId) ?? 0) + 1);
    const ticket = lifetime.capture();
    const setBusy = kind === "captions" ? setRetryingPostId : setReconcilingPostId;
    setBusy(postId); onError(null);
    setStatusMessage(kind === "captions" ? "Uploading the complete transcript captions to YouTube..." : "Checking the uncertain YouTube upload before any retry...");
    try {
      const post = await (kind === "captions" ? api.retryYouTubeCaptions(postId) : api.reconcileYouTubeUpload(postId));
      if (!lifetime.owns(ticket)) return;
      adopt(post);
      setStatusMessage(kind === "captions"
        ? post.captionStatus === "uploaded" ? "YouTube captions uploaded successfully." : post.captionErrorMessage ?? "YouTube captions still need attention."
        : post.status === "reconciliation_required" ? post.reconciliationReason ?? "YouTube still needs manual reconciliation." : `YouTube upload reconciled as ${post.status}.`);
    } catch (error) {
      if (lifetime.owns(ticket)) {
        await reloadPosts().catch(() => undefined);
        onError(error instanceof Error ? error.message : kind === "captions" ? "Failed to retry YouTube captions." : "Failed to reconcile the YouTube upload.");
      }
    } finally {
      locks.current.delete(key); finish(group); if (lifetime.owns(ticket)) setBusy(null);
    }
  }
  async function savePostingSchedule(settings: PostingScheduleSettings): Promise<void> {
    if (locks.current.has("settings")) return;
    locks.current.add("settings"); settingsRevision.current++;
    const ticket = lifetime.capture();
    setSavingSchedule(true); setPostingScheduleMessage(null); onError(null);
    try {
      const saved = await api.savePostingSchedule(structuredClone(settings));
      if (!lifetime.owns(ticket)) return;
      setPostingSchedule(saved);
      setPostingScheduleMessage("Posting times saved. The next-slot action will use the next free occurrence.");
    } catch (error) {
      if (lifetime.owns(ticket)) onError(error instanceof Error ? error.message : "Failed to save posting times.");
    } finally {
      locks.current.delete("settings"); if (lifetime.owns(ticket)) setSavingSchedule(false);
    }
  }

  return {
    posts, capturePostsRead, creating, refreshing, retryingPostId, reconcilingPostId,
    statusMessage, message, platform, setPlatform, accountLabel, setAccountLabel, publishAt, setPublishAt,
    postingSchedule, savingSchedule, postingScheduleMessage, nextSlot,
    schedule, removePost, refreshStatuses, retryCaptions: (id: string) => updatePost(id, "captions"),
    reconcileUpload: (id: string) => updatePost(id, "reconcile"), savePostingSchedule,
    busy: creating || refreshing || retryingPostId !== null || reconcilingPostId !== null
  };
}
