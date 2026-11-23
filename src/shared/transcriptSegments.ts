import type { TranscriptSegmentRecord } from "./contracts";

export function buildTranscriptSegmentsFromSrt(
  srtContent: string,
  fallbackText: string,
  existingSegments: Partial<TranscriptSegmentRecord>[] = []
): TranscriptSegmentRecord[] {
  const parsedSegments = parseSrtSegments(srtContent);
  const existingSpeakerAssignments = new Map(
    existingSegments.map((segment) => [
      getSegmentMatchingKey(segment),
      {
        speakerId: segment.speakerId ?? null,
        speakerConfidence:
          typeof segment.speakerConfidence === "number" && Number.isFinite(segment.speakerConfidence)
            ? segment.speakerConfidence
            : null,
        speakerReviewReason:
          typeof segment.speakerReviewReason === "string" && segment.speakerReviewReason.trim().length > 0
            ? segment.speakerReviewReason.trim()
            : null,
        speakerAlternateSpeakerId:
          typeof segment.speakerAlternateSpeakerId === "string" && segment.speakerAlternateSpeakerId.trim().length > 0
            ? segment.speakerAlternateSpeakerId.trim()
            : null,
        speakerAlternateConfidence:
          typeof segment.speakerAlternateConfidence === "number" &&
          Number.isFinite(segment.speakerAlternateConfidence)
            ? segment.speakerAlternateConfidence
            : null,
        speakerAssignmentSource:
          segment.speakerAssignmentSource === "manual" ||
          segment.speakerAssignmentSource === "auto_high_confidence" ||
          segment.speakerAssignmentSource === "auto_low_confidence"
            ? segment.speakerAssignmentSource
            : null
      }
    ])
  );

  if (parsedSegments.length === 0) {
    const normalizedFallbackText = fallbackText.trim();
    if (!normalizedFallbackText) {
      return [];
    }

    const fallbackId = "segment:fallback:0";
    const fallbackKey = getSegmentMatchingKey({
      startMs: null,
      endMs: null,
      text: normalizedFallbackText
    });

    return [
      {
        id: fallbackId,
        startMs: null,
        endMs: null,
        text: normalizedFallbackText,
        speakerId: existingSpeakerAssignments.get(fallbackKey)?.speakerId ?? null,
        speakerConfidence: existingSpeakerAssignments.get(fallbackKey)?.speakerConfidence ?? null,
        speakerAssignmentSource: existingSpeakerAssignments.get(fallbackKey)?.speakerAssignmentSource ?? null,
        speakerReviewReason: existingSpeakerAssignments.get(fallbackKey)?.speakerReviewReason ?? null,
        speakerAlternateSpeakerId: existingSpeakerAssignments.get(fallbackKey)?.speakerAlternateSpeakerId ?? null,
        speakerAlternateConfidence: existingSpeakerAssignments.get(fallbackKey)?.speakerAlternateConfidence ?? null
      }
    ];
  }

  return parsedSegments.map((segment, index) => {
    const matchingKey = getSegmentMatchingKey(segment);

    return {
      id: `segment:${index}:${segment.startMs ?? "x"}:${segment.endMs ?? "x"}`,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      speakerId: existingSpeakerAssignments.get(matchingKey)?.speakerId ?? null,
      speakerConfidence: existingSpeakerAssignments.get(matchingKey)?.speakerConfidence ?? null,
      speakerAssignmentSource: existingSpeakerAssignments.get(matchingKey)?.speakerAssignmentSource ?? null,
      speakerReviewReason: existingSpeakerAssignments.get(matchingKey)?.speakerReviewReason ?? null,
      speakerAlternateSpeakerId: existingSpeakerAssignments.get(matchingKey)?.speakerAlternateSpeakerId ?? null,
      speakerAlternateConfidence: existingSpeakerAssignments.get(matchingKey)?.speakerAlternateConfidence ?? null
    };
  });
}

export function normalizeTranscriptSegments(
  segments: Partial<TranscriptSegmentRecord>[] | null | undefined
): TranscriptSegmentRecord[] {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .map((segment, index) => ({
      id: typeof segment.id === "string" ? segment.id : `segment:normalized:${index}`,
      startMs: typeof segment.startMs === "number" ? segment.startMs : null,
      endMs: typeof segment.endMs === "number" ? segment.endMs : null,
      text: typeof segment.text === "string" ? segment.text.trim() : "",
      speakerId:
        typeof segment.speakerId === "string"
          ? segment.speakerId
          : typeof (segment as { speakerProfileId?: unknown }).speakerProfileId === "string"
            ? ((segment as { speakerProfileId?: string }).speakerProfileId ?? null)
            : null,
      speakerConfidence:
        typeof segment.speakerConfidence === "number" && Number.isFinite(segment.speakerConfidence)
          ? segment.speakerConfidence
          : null,
      speakerReviewReason:
        typeof segment.speakerReviewReason === "string" && segment.speakerReviewReason.trim().length > 0
          ? segment.speakerReviewReason.trim()
          : null,
      speakerAlternateSpeakerId:
        typeof segment.speakerAlternateSpeakerId === "string" && segment.speakerAlternateSpeakerId.trim().length > 0
          ? segment.speakerAlternateSpeakerId.trim()
          : null,
      speakerAlternateConfidence:
        typeof segment.speakerAlternateConfidence === "number" &&
        Number.isFinite(segment.speakerAlternateConfidence)
          ? segment.speakerAlternateConfidence
          : null,
      speakerAssignmentSource:
        segment.speakerAssignmentSource === "manual" ||
        segment.speakerAssignmentSource === "auto_high_confidence" ||
        segment.speakerAssignmentSource === "auto_low_confidence"
          ? segment.speakerAssignmentSource
          : null
    }))
    .filter((segment) => segment.text.length > 0);
}

export function splitTranscriptSegment(
  segments: TranscriptSegmentRecord[],
  segmentId: string,
  splitAtMs: number,
  beforeText: string,
  afterText: string
): TranscriptSegmentRecord[] {
  const segmentIndex = segments.findIndex((segment) => segment.id === segmentId);
  if (segmentIndex < 0) {
    throw new Error("The selected transcript segment no longer exists.");
  }

  const source = segments[segmentIndex];
  if (
    typeof source.startMs !== "number" ||
    typeof source.endMs !== "number" ||
    !Number.isFinite(source.startMs) ||
    !Number.isFinite(source.endMs) ||
    source.endMs <= source.startMs
  ) {
    throw new Error("Only timed transcript segments can be split.");
  }

  if (!Number.isFinite(splitAtMs) || splitAtMs <= source.startMs || splitAtMs >= source.endMs) {
    throw new Error("Choose a split point inside the segment time range.");
  }

  const normalizedBeforeText = beforeText.trim();
  const normalizedAfterText = afterText.trim();
  if (!normalizedBeforeText || !normalizedAfterText) {
    throw new Error("Both split segments need text.");
  }

  const usedIds = new Set(segments.map((segment) => segment.id));
  usedIds.delete(source.id);
  const createChildId = (side: "before" | "after"): string => {
    const baseId = `${source.id}:split:${Math.round(splitAtMs)}:${side}`;
    let candidate = baseId;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${baseId}:${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const speakerState = source.speakerAssignmentSource === "manual"
    ? {
        speakerId: source.speakerId,
        speakerConfidence: source.speakerConfidence,
        speakerAssignmentSource: source.speakerAssignmentSource,
        speakerReviewReason: source.speakerReviewReason,
        speakerAlternateSpeakerId: source.speakerAlternateSpeakerId,
        speakerAlternateConfidence: source.speakerAlternateConfidence
      }
    : {
        speakerId: null,
        speakerConfidence: null,
        speakerAssignmentSource: null,
        speakerReviewReason: null,
        speakerAlternateSpeakerId: null,
        speakerAlternateConfidence: null
      };

  const beforeSegment: TranscriptSegmentRecord = {
    ...source,
    ...speakerState,
    id: createChildId("before"),
    startMs: source.startMs,
    endMs: splitAtMs,
    text: normalizedBeforeText
  };
  const afterSegment: TranscriptSegmentRecord = {
    ...source,
    ...speakerState,
    id: createChildId("after"),
    startMs: splitAtMs,
    endMs: source.endMs,
    text: normalizedAfterText
  };

  return [
    ...segments.slice(0, segmentIndex),
    beforeSegment,
    afterSegment,
    ...segments.slice(segmentIndex + 1)
  ];
}

export function buildSrtFromTranscriptSegments(segments: TranscriptSegmentRecord[]): string {
  return normalizeTranscriptSegments(segments)
    .filter((segment) => typeof segment.startMs === "number" && typeof segment.endMs === "number" && segment.endMs > segment.startMs)
    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.startMs!)} --> ${formatSrtTimestamp(segment.endMs!)}\n${segment.text}`)
    .join("\n\n");
}

export function isValidTimedSrtContent(srtContent: string): boolean {
  const blocks = srtContent
    .trim()
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return false;
  }

  return blocks.every((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex < 0) {
      return false;
    }

    const [rawStartTime, rawEndTime] = (lines[timeLineIndex] ?? "")
      .split("-->")
      .map((value) => value.trim());
    const startMs = parseSrtTimestampToMs(rawStartTime);
    const endMs = parseSrtTimestampToMs(rawEndTime);
    const hasText = lines.slice(timeLineIndex + 1).some((line) => line.trim().length > 0);
    return startMs !== null && endMs !== null && endMs > startMs && hasText;
  });
}

function parseSrtSegments(
  srtContent: string
): Array<Pick<TranscriptSegmentRecord, "startMs" | "endMs" | "text">> {
  return srtContent
    .trim()
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
      const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeLineIndex < 0) {
        return null;
      }

      const timeRange = lines[timeLineIndex] ?? "";
      const [rawStartTime, rawEndTime] = timeRange.split("-->").map((value) => value.trim());
      const textLines = lines.slice(timeLineIndex + 1).map((line) => line.trim()).filter(Boolean);
      const text = textLines.join("\n").trim();

      if (!text) {
        return null;
      }

      return {
        startMs: parseSrtTimestampToMs(rawStartTime),
        endMs: parseSrtTimestampToMs(rawEndTime),
        text
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
}

function parseSrtTimestampToMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  );
}

function getSegmentMatchingKey(
  segment: Pick<Partial<TranscriptSegmentRecord>, "startMs" | "endMs" | "text">
): string {
  return [
    typeof segment.startMs === "number" ? segment.startMs : "x",
    typeof segment.endMs === "number" ? segment.endMs : "x",
    normalizeSegmentText(segment.text)
  ].join("|");
}

function normalizeSegmentText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function formatSrtTimestamp(valueMs: number): string {
  const totalMilliseconds = Math.max(0, Math.round(valueMs));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}
