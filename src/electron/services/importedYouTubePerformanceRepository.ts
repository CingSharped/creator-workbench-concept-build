import { randomUUID } from "node:crypto";
import type { ImportedYouTubePerformanceRecord } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

interface UpsertImportedYouTubePerformanceRecordInput {
  videoId: string;
  channelId?: string | null;
  title: string;
  channelTitle: string;
  publishedAt: string;
  publishedUrl: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  tags: string[];
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

export function listImportedYouTubePerformanceRecords(): ImportedYouTubePerformanceRecord[] {
  return [...readDatabase().importedYouTubePerformanceRecords].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt)
  );
}

export function upsertImportedYouTubePerformanceRecords(
  inputs: UpsertImportedYouTubePerformanceRecordInput[]
): ImportedYouTubePerformanceRecord[] {
  if (inputs.length === 0) {
    return [];
  }

  return updateDatabase((store) => {
    const now = new Date().toISOString();
    const results: ImportedYouTubePerformanceRecord[] = [];

    for (const input of inputs) {
      const existing = store.importedYouTubePerformanceRecords.find(
        (record) => record.videoId === input.videoId
      );
      if (existing) {
        if (input.channelId !== undefined) {
          existing.channelId = input.channelId;
        }
        existing.title = input.title;
        existing.channelTitle = input.channelTitle;
        existing.publishedAt = input.publishedAt;
        existing.publishedUrl = input.publishedUrl;
        existing.durationSeconds = input.durationSeconds;
        existing.thumbnailUrl = input.thumbnailUrl;
        existing.tags = [...input.tags];
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
        results.push(existing);
        continue;
      }

      const record: ImportedYouTubePerformanceRecord = {
        id: randomUUID(),
        videoId: input.videoId,
        channelId: input.channelId ?? null,
        title: input.title,
        channelTitle: input.channelTitle,
        publishedAt: input.publishedAt,
        publishedUrl: input.publishedUrl,
        durationSeconds: input.durationSeconds,
        thumbnailUrl: input.thumbnailUrl,
        tags: [...input.tags],
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
        importedAt: now,
        fetchedAt: now
      };
      store.importedYouTubePerformanceRecords.push(record);
      results.push(record);
    }

    return results.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  });
}
