import { randomUUID } from "node:crypto";
import type { TranscriptAssetType, TranscriptRecord, TranscriptSegmentRecord } from "../../shared/contracts";
import { buildSrtFromTranscriptSegments, buildTranscriptSegmentsFromSrt, normalizeTranscriptSegments } from "../../shared/transcriptSegments";
import { readDatabase, updateDatabase } from "./database";

interface UpsertTranscriptInput {
  clipId: string;
  assetType?: TranscriptAssetType;
  assetId?: string;
  modelPath: string;
  language: string | null;
  textContent: string;
  srtContent: string;
  segments?: TranscriptSegmentRecord[];
  status?: "complete" | "incomplete";
}

export function getTranscriptByClipId(clipId: string): TranscriptRecord | null {
  return getTranscriptByAsset("clip", clipId);
}

export function getTranscriptByLongFormSourceId(sourceId: string): TranscriptRecord | null {
  return getTranscriptByAsset("long_form_source", sourceId);
}

export function getTranscriptByAsset(assetType: TranscriptAssetType, assetId: string): TranscriptRecord | null {
  return readDatabase().transcripts.find((transcript) => {
    if (transcript.assetType === assetType && transcript.assetId === assetId) {
      return true;
    }
    return transcript.assetType === undefined && transcript.clipId === assetId;
  }) ?? null;
}

export function upsertTranscript(input: UpsertTranscriptInput): TranscriptRecord {
  return updateDatabase((store) => {
    const assetType = input.assetType ?? "clip";
    const assetId = input.assetId ?? input.clipId;
    const existing = store.transcripts.find((transcript) =>
      transcript.assetType === assetType && transcript.assetId === assetId
    );
    const now = new Date().toISOString();

    if (existing) {
      existing.assetType = assetType;
      existing.assetId = assetId;
      existing.clipId = input.clipId;
      existing.modelPath = input.modelPath;
      existing.language = input.language;
      existing.textContent = input.textContent;
      existing.srtContent = input.srtContent;
      existing.segments =
        input.segments && input.segments.length > 0
          ? normalizeTranscriptSegments(input.segments)
          : buildTranscriptSegmentsFromSrt(input.srtContent, input.textContent, existing.segments);
      existing.status = input.status ?? "complete";
      existing.updatedAt = now;
      return existing;
    }

    const transcript: TranscriptRecord = {
      id: randomUUID(),
      assetType,
      assetId,
      clipId: input.clipId,
      modelPath: input.modelPath,
      language: input.language,
      textContent: input.textContent,
      srtContent: input.srtContent,
      segments:
        input.segments && input.segments.length > 0
          ? normalizeTranscriptSegments(input.segments)
          : buildTranscriptSegmentsFromSrt(input.srtContent, input.textContent),
      status: input.status ?? "complete",
      createdAt: now,
      updatedAt: now
    };

    store.transcripts.push(transcript);
    return transcript;
  });
}

export function saveTranscriptEdits(
  clipId: string,
  textContent: string,
  srtContent: string,
  segments?: TranscriptSegmentRecord[]
): TranscriptRecord {
  return saveTranscriptEditsForAsset("clip", clipId, textContent, srtContent, segments);
}

export function saveTranscriptEditsForAsset(
  assetType: TranscriptAssetType,
  assetId: string,
  textContent: string,
  srtContent: string,
  segments?: TranscriptSegmentRecord[]
): TranscriptRecord {
  return updateDatabase((store) => {
    const transcript = store.transcripts.find((existingTranscript) =>
      existingTranscript.assetType === assetType && existingTranscript.assetId === assetId
    );
    if (!transcript) {
      throw new Error("No transcript exists for the selected clip yet.");
    }

    const normalizedSegments = segments && segments.length > 0
      ? normalizeTranscriptSegments(segments)
      : buildTranscriptSegmentsFromSrt(srtContent, textContent, transcript.segments);
    const hasInvalidTiming = normalizedSegments.some((segment) =>
      (segment.startMs === null) !== (segment.endMs === null) ||
      (segment.startMs !== null && segment.endMs !== null && segment.endMs <= segment.startMs)
    );
    if (hasInvalidTiming) {
      throw new Error("Transcript timing is invalid. Each edited segment needs a start before its end.");
    }
    const hasTimedSegments = normalizedSegments.some(
      (segment) => segment.startMs !== null && segment.endMs !== null
    );
    const canonicalText = normalizedSegments.length > 0
      ? normalizedSegments.map((segment) => segment.text).join(" ").trim()
      : textContent.trim();
    const canonicalSrt = hasTimedSegments
      ? buildSrtFromTranscriptSegments(normalizedSegments)
      : srtContent.trim();

    transcript.textContent = canonicalText;
    transcript.srtContent = canonicalSrt;
    transcript.segments = normalizedSegments;
    transcript.updatedAt = new Date().toISOString();
    return transcript;
  });
}
