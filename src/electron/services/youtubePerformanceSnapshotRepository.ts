import { randomUUID } from "node:crypto";
import type { YouTubePerformanceSnapshotRecord } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

interface UpsertYouTubePerformanceSnapshotInput {
  clipId: string;
  scheduledPostId: string;
  videoId: string;
  channelId?: string | null;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares?: number | null;
  subscribersGained?: number | null;
  subscribersLost?: number | null;
  viewerPercentage?: number | null;
}

export function listYouTubePerformanceSnapshotsByClipId(
  clipId: string
): YouTubePerformanceSnapshotRecord[] {
  return [...readDatabase().youtubePerformanceSnapshots]
    .filter((snapshot) => snapshot.clipId === clipId)
    .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
}

export function listYouTubePerformanceSnapshots(): YouTubePerformanceSnapshotRecord[] {
  return [...readDatabase().youtubePerformanceSnapshots].sort((left, right) =>
    right.fetchedAt.localeCompare(left.fetchedAt)
  );
}

export function upsertYouTubePerformanceSnapshot(
  input: UpsertYouTubePerformanceSnapshotInput
): YouTubePerformanceSnapshotRecord {
  return updateDatabase((store) => {
    const now = new Date().toISOString();
    const existing = store.youtubePerformanceSnapshots.find(
      (snapshot) => snapshot.scheduledPostId === input.scheduledPostId
    );

    if (existing) {
      if (input.channelId !== undefined) {
        existing.channelId = input.channelId;
      }
      existing.videoId = input.videoId;
      existing.views = input.views;
      existing.engagedViews = input.engagedViews;
      existing.estimatedMinutesWatched = input.estimatedMinutesWatched;
      existing.averageViewDuration = input.averageViewDuration;
      existing.averageViewPercentage = input.averageViewPercentage;
      existing.likes = input.likes;
      existing.comments = input.comments;
      existing.shares = input.shares ?? null;
      existing.subscribersGained = input.subscribersGained ?? null;
      existing.subscribersLost = input.subscribersLost ?? null;
      existing.viewerPercentage = input.viewerPercentage ?? null;
      existing.fetchedAt = now;
      return existing;
    }

    const record: YouTubePerformanceSnapshotRecord = {
      id: randomUUID(),
      clipId: input.clipId,
      scheduledPostId: input.scheduledPostId,
      videoId: input.videoId,
      channelId: input.channelId ?? null,
      views: input.views,
      engagedViews: input.engagedViews,
      estimatedMinutesWatched: input.estimatedMinutesWatched,
      averageViewDuration: input.averageViewDuration,
      averageViewPercentage: input.averageViewPercentage,
      likes: input.likes,
      comments: input.comments,
      shares: input.shares ?? null,
      subscribersGained: input.subscribersGained ?? null,
      subscribersLost: input.subscribersLost ?? null,
      viewerPercentage: input.viewerPercentage ?? null,
      fetchedAt: now
    };

    store.youtubePerformanceSnapshots.push(record);
    return record;
  });
}
