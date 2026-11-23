import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ClipLineage, ClipRecord, SourceFingerprint } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";
import { areSourceFingerprintsCompatible } from "./sourceFingerprint";

interface CreateClipInput {
  workspaceId: string;
  displayName: string;
  sourcePath: string;
  sourceFingerprint?: SourceFingerprint | null;
  fileSizeBytes: number;
  durationMs: number | null;
  frameRate?: number | null;
  widthPx: number | null;
  heightPx: number | null;
  inspectionStatus: "basic" | "ffprobe";
}

export interface CreateImportedClipResult {
  clip: ClipRecord;
  created: boolean;
}

export function createImportedClip(input: CreateClipInput): CreateImportedClipResult {
  return updateDatabase((store) => {
    const existing = store.clips.find((clip) => normalizeSourcePath(clip.sourcePath) === normalizeSourcePath(input.sourcePath));
    if (existing && areSourceFingerprintsCompatible(existing.sourceFingerprint, input.sourceFingerprint)) {
      existing.indexState = "active";
      existing.archivedAt = null;
      existing.displayName = input.displayName;
      existing.sourceFingerprint = input.sourceFingerprint ?? existing.sourceFingerprint ?? null;
      existing.fileSizeBytes = input.fileSizeBytes;
      existing.durationMs = input.durationMs;
      existing.frameRate = input.frameRate ?? null;
      existing.widthPx = input.widthPx;
      existing.heightPx = input.heightPx;
      existing.inspectionStatus = input.inspectionStatus;
      existing.updatedAt = new Date().toISOString();
      return {
        clip: existing,
        created: false
      };
    }

    const now = new Date().toISOString();
    const clip: ClipRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      sourcePath: input.sourcePath,
      sourceFingerprint: input.sourceFingerprint ?? null,
      fileSizeBytes: input.fileSizeBytes,
      durationMs: input.durationMs,
      frameRate: input.frameRate ?? null,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      status: "imported",
      inspectionStatus: input.inspectionStatus,
      lineage: null,
      indexState: "active",
      archivedAt: null,
      importedAt: now,
      updatedAt: now
    };

    store.clips.push(clip);
    return {
      clip,
      created: true
    };
  });
}

export function listClips(): ClipRecord[] {
  return readDatabase().clips
    .filter((clip) => clip.indexState !== "archived")
    .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
}

export function getClipById(clipId: string): ClipRecord | null {
  return readDatabase().clips.find((clip) => clip.id === clipId) ?? null;
}

export function updateClipStatus(clipId: string, status: ClipRecord["status"]): void {
  updateDatabase((store) => {
    const clip = store.clips.find((existingClip) => existingClip.id === clipId);
    if (!clip) {
      return;
    }

    clip.status = status;
    clip.updatedAt = new Date().toISOString();
  });
}

export function setClipLineage(clipId: string, lineage: ClipLineage): ClipRecord | null {
  return updateDatabase((store) => {
    const clip = store.clips.find((existingClip) => existingClip.id === clipId);
    if (!clip) {
      return null;
    }

    clip.lineage = lineage;
    clip.updatedAt = new Date().toISOString();
    return clip;
  });
}

export function normalizeSourcePath(sourcePath: string): string {
  const normalized = path.normalize(path.resolve(sourcePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
