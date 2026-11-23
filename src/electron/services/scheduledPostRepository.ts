import { randomUUID } from "node:crypto";
import type {
  NextAvailablePostingSlotResult,
  PostingScheduleSettings,
  PublishExecutionMode,
  PublishPlatform,
  ScheduledPostRecord
} from "../../shared/contracts";
import { resolveNextAvailablePostingSlot } from "../../shared/postingSchedule";
import { type CreatorWorkspaceStore, readDatabase, updateDatabase } from "./database";

export interface CreateScheduledPostInput {
  workspaceId: string;
  clipId: string;
  platform: PublishPlatform;
  accountLabel: string;
  channelId?: string | null;
  publishAt: string;
  executionMode: PublishExecutionMode;
  title: string;
  description: string;
  platformTags: string[];
  youtubePlaylistIds: string[];
}

export interface NextSlotScheduledPostResult {
  post: ScheduledPostRecord | null;
  resolution: NextAvailablePostingSlotResult;
}

export function listScheduledPosts(): ScheduledPostRecord[] {
  return [...readDatabase().scheduledPosts].sort((left, right) => {
    const publishOrder = left.publishAt.localeCompare(right.publishAt);
    if (publishOrder !== 0) {
      return publishOrder;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function slotKey(channelId: string) {
  return "youtubeScheduledTimes." + channelId;
}

function occupiedTimes(store: CreatorWorkspaceStore, channelId?: string | null): string[] {
  const saved = channelId && store.appSettings[slotKey(channelId)];
  return saved ? JSON.parse(saved.value) : [];
}

export function previewPostingSlot(schedule: PostingScheduleSettings, channelId: string | null, accountLabel: string | null) {
  const store = readDatabase();
  return resolveNextAvailablePostingSlot(schedule, store.scheduledPosts, {
    channelId, accountLabel, remoteTimes: occupiedTimes(store, channelId)
  });
}

export function removeScheduledPost(postId: string) {
  updateDatabase(store => {
    const post = store.scheduledPosts.find(item => item.id === postId);
    if (!post) return;
    if (post.status === "posting") throw new Error("Wait for the upload to finish.");
    if (post.platform === "youtube" && post.status === "scheduled" && post.remotePostId && post.channelId) {
      const times = new Set(occupiedTimes(store, post.channelId));
      times.add(post.publishAt);
      store.appSettings[slotKey(post.channelId)] = { value: JSON.stringify([...times]), updatedAt: new Date().toISOString() };
    }
    store.scheduledPosts = store.scheduledPosts.filter(item => item.id !== postId);
  });
}

export function applyYouTubeSchedule(channelId: string, originals: ScheduledPostRecord[],
  videos: Map<string, { status: ScheduledPostRecord["status"]; publishAt?: string }>) {
  return updateDatabase(store => {
    const now = new Date().toISOString();
    const times = [...videos.values()].flatMap(video => video.status === "scheduled" && video.publishAt ? [video.publishAt] : []);
    store.appSettings[slotKey(channelId)] = { value: JSON.stringify(times), updatedAt: now };
    let updatedCount = 0;
    const snapshots = new Map(originals.map(post => [post.id, post]));
    for (const post of store.scheduledPosts) {
      const original = snapshots.get(post.id);
      if (!original || original.updatedAt !== post.updatedAt || post.status === "posting") continue;
      const video = post.remotePostId ? videos.get(post.remotePostId) : undefined;
      const status = video?.status ?? "failed";
      if (status !== post.status || (video?.publishAt && post.publishAt !== video.publishAt)) updatedCount++;
      post.status = status;
      if (video?.publishAt) post.publishAt = video.publishAt;
      post.remoteOutcome = video ? "confirmed" : "failed";
      post.lastRemoteCheckAt = now;
      post.updatedAt = now;
      post.reconciliationReason = null;
      post.errorMessage = status === "failed" ? post.errorMessage && original.status === "failed" ? post.errorMessage : "YouTube has no active schedule for this post." : null;
    }
    return updatedCount;
  });
}

export function createScheduledPost(input: CreateScheduledPostInput): ScheduledPostRecord {
  return updateDatabase((store) => {
    const record = buildScheduledPostRecord(input);
    store.scheduledPosts.push(record);
    return record;
  });
}

export function createScheduledPostAtNextSlot(
  input: CreateScheduledPostInput & {
    schedule: PostingScheduleSettings;
  }
): NextSlotScheduledPostResult {
  return updateDatabase((store) => {
    const resolution = resolveNextAvailablePostingSlot(input.schedule, store.scheduledPosts, {
      remoteTimes: occupiedTimes(store, input.channelId),
      channelId: input.channelId,
      accountLabel: input.accountLabel
    });
    if (!resolution.publishAt) {
      return { post: null, resolution };
    }

    const record = buildScheduledPostRecord({
      ...input,
      publishAt: resolution.publishAt
    });
    store.scheduledPosts.push(record);
    return { post: record, resolution };
  });
}

export function getScheduledPostById(postId: string): ScheduledPostRecord | null {
  return readDatabase().scheduledPosts.find((post) => post.id === postId) ?? null;
}

function buildScheduledPostRecord(input: CreateScheduledPostInput): ScheduledPostRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    clipId: input.clipId,
    platform: input.platform,
    accountLabel: input.accountLabel,
    channelId: input.channelId ?? null,
    publishAt: input.publishAt,
    executionMode: input.executionMode,
    status: "scheduled",
    operationId: null,
    remoteOutcome: "not_started",
    lastRemoteCheckAt: null,
    reconciliationReason: null,
    title: input.title,
    description: input.description,
    platformTags: input.platformTags,
    youtubePlaylistIds: input.youtubePlaylistIds,
    remotePostId: null,
    publishedUrl: null,
    errorMessage: null,
    captionStatus: input.platform === "youtube" ? "pending" : "not_applicable",
    captionRemoteId: null,
    captionLanguage: null,
    captionName: null,
    captionErrorMessage: null,
    captionUpdatedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export function markPostingPostsForReconciliation(): number {
  return updateDatabase((store) => {
    const now = new Date().toISOString();
    let updatedCount = 0;
    for (const post of store.scheduledPosts) {
      if (post.status !== "posting") {
        continue;
      }

      post.status = "reconciliation_required";
      post.remoteOutcome = "unknown";
      post.lastRemoteCheckAt = null;
      post.reconciliationReason = "The app closed before the YouTube upload outcome was confirmed. Reconcile before retrying.";
      post.errorMessage = post.reconciliationReason;
      post.updatedAt = now;
      updatedCount += 1;
    }
    return updatedCount;
  });
}

export function updateScheduledPost(
  postId: string,
  updates: Partial<
    Pick<
      ScheduledPostRecord,
      | "status"
      | "operationId"
      | "remoteOutcome"
      | "lastRemoteCheckAt"
      | "reconciliationReason"
      | "remotePostId"
      | "publishedUrl"
      | "errorMessage"
      | "youtubePlaylistIds"
      | "captionStatus"
      | "captionRemoteId"
      | "captionLanguage"
      | "captionName"
      | "captionErrorMessage"
      | "captionUpdatedAt"
    >
  >
): ScheduledPostRecord | null {
  return updateDatabase((store) => {
    const post = store.scheduledPosts.find((existingPost) => existingPost.id === postId);
    if (!post) {
      return null;
    }

    if (updates.status) {
      post.status = updates.status;
    }

    if (updates.operationId !== undefined) {
      post.operationId = updates.operationId;
    }

    if (updates.remoteOutcome !== undefined) {
      post.remoteOutcome = updates.remoteOutcome;
    }

    if (updates.lastRemoteCheckAt !== undefined) {
      post.lastRemoteCheckAt = updates.lastRemoteCheckAt;
    }

    if (updates.reconciliationReason !== undefined) {
      post.reconciliationReason = updates.reconciliationReason;
    }

    if (updates.remotePostId !== undefined) {
      post.remotePostId = updates.remotePostId;
    }

    if (updates.publishedUrl !== undefined) {
      post.publishedUrl = updates.publishedUrl;
    }

    if (updates.errorMessage !== undefined) {
      post.errorMessage = updates.errorMessage;
    }

    if (updates.youtubePlaylistIds !== undefined) {
      post.youtubePlaylistIds = updates.youtubePlaylistIds;
    }

    if (updates.captionStatus !== undefined) {
      post.captionStatus = updates.captionStatus;
    }

    if (updates.captionRemoteId !== undefined) {
      post.captionRemoteId = updates.captionRemoteId;
    }

    if (updates.captionLanguage !== undefined) {
      post.captionLanguage = updates.captionLanguage;
    }

    if (updates.captionName !== undefined) {
      post.captionName = updates.captionName;
    }

    if (updates.captionErrorMessage !== undefined) {
      post.captionErrorMessage = updates.captionErrorMessage;
    }

    if (updates.captionUpdatedAt !== undefined) {
      post.captionUpdatedAt = updates.captionUpdatedAt;
    }

    post.updatedAt = new Date().toISOString();
    return post;
  });
}
