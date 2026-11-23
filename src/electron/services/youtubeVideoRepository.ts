import { randomUUID } from "node:crypto";
import type {
  ThumbnailCandidateRecord,
  YouTubeManagedVideoRecord,
  YouTubeMetadataDraft
} from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

export function listCachedYouTubeVideos(): YouTubeManagedVideoRecord[] {
  return readDatabase().youtubeVideoCache.map((video) => ({
    ...video,
    tags: [...video.tags]
  }));
}

export function replaceCachedYouTubeVideos(videos: YouTubeManagedVideoRecord[]): YouTubeManagedVideoRecord[] {
  return updateDatabase((store) => {
    store.youtubeVideoCache = videos.map((video) => ({ ...video, tags: [...video.tags] }));
    return listCachedYouTubeVideosFromStore(store);
  });
}

export function getYouTubeMetadataDraft(videoId: string): YouTubeMetadataDraft | null {
  return readDatabase().youtubeMetadataDrafts.find((draft) => draft.videoId === videoId) ?? null;
}

export function upsertYouTubeMetadataDraft(input: Omit<YouTubeMetadataDraft, "updatedAt">): YouTubeMetadataDraft {
  return updateDatabase((store) => {
    const draft: YouTubeMetadataDraft = {
      ...input,
      tags: [...input.tags],
      updatedAt: new Date().toISOString()
    };
    const existingIndex = store.youtubeMetadataDrafts.findIndex((candidate) => candidate.videoId === input.videoId);
    if (existingIndex >= 0) {
      store.youtubeMetadataDrafts[existingIndex] = draft;
    } else {
      store.youtubeMetadataDrafts.push(draft);
    }
    return { ...draft, tags: [...draft.tags] };
  });
}

export function clearYouTubeMetadataDraft(videoId: string): void {
  updateDatabase((store) => {
    store.youtubeMetadataDrafts = store.youtubeMetadataDrafts.filter((draft) => draft.videoId !== videoId);
  });
}

export function listThumbnailCandidates(videoId: string): ThumbnailCandidateRecord[] {
  return readDatabase().thumbnailCandidates
    .filter((candidate) => candidate.videoId === videoId)
    .map(cloneThumbnailCandidate);
}

export function createThumbnailCandidate(
  candidate: Omit<ThumbnailCandidateRecord, "id" | "createdAt" | "appliedAt" | "status" | "errorMessage">
): ThumbnailCandidateRecord {
  return updateDatabase((store) => {
    const created: ThumbnailCandidateRecord = {
      ...candidate,
      id: randomUUID(),
      status: "ready",
      createdAt: new Date().toISOString(),
      appliedAt: null,
      errorMessage: null,
      provenance: {
        ...candidate.provenance,
        sourceFrameTimestampsMs: [...candidate.provenance.sourceFrameTimestampsMs]
      }
    };
    store.thumbnailCandidates.push(created);
    return cloneThumbnailCandidate(created);
  });
}

export function markThumbnailCandidateApplied(candidateId: string): ThumbnailCandidateRecord | null {
  return updateDatabase((store) => {
    const candidate = store.thumbnailCandidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return null;
    }
    for (const item of store.thumbnailCandidates) {
      if (item.videoId === candidate.videoId && item.status === "applied") {
        item.status = "ready";
        item.appliedAt = null;
      }
    }
    candidate.status = "applied";
    candidate.appliedAt = new Date().toISOString();
    candidate.errorMessage = null;
    return cloneThumbnailCandidate(candidate);
  });
}

function listCachedYouTubeVideosFromStore(store: ReturnType<typeof readDatabase>): YouTubeManagedVideoRecord[] {
  return store.youtubeVideoCache.map((video) => ({ ...video, tags: [...video.tags] }));
}

function cloneThumbnailCandidate(candidate: ThumbnailCandidateRecord): ThumbnailCandidateRecord {
  return {
    ...candidate,
    provenance: {
      ...candidate.provenance,
      sourceFrameTimestampsMs: [...candidate.provenance.sourceFrameTimestampsMs]
    }
  };
}
