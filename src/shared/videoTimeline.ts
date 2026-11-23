export interface VideoTimelineRange {
  startSeconds: number;
  endSeconds: number;
}

export interface VideoTimelineBoundsInput {
  timelineRange?: VideoTimelineRange | null;
  durationSeconds: number;
  nativeDurationSeconds?: number | null;
  frameDurationSeconds: number;
}

export function getVideoTimelineBounds(input: VideoTimelineBoundsInput): VideoTimelineRange {
  const nativeDuration = input.nativeDurationSeconds;
  const durationLimit = nativeDuration && Number.isFinite(nativeDuration) && nativeDuration > 0
    ? nativeDuration
    : input.durationSeconds > 0
      ? input.durationSeconds
      : null;

  if (!input.timelineRange || input.timelineRange.endSeconds <= input.timelineRange.startSeconds) {
    return { startSeconds: 0, endSeconds: durationLimit ?? 0 };
  }

  const requestedEnd = Math.max(0, input.timelineRange.endSeconds);
  const maximumEnd = durationLimit ?? requestedEnd;
  const endSeconds = Math.min(maximumEnd, requestedEnd);
  const startSeconds = Math.min(
    Math.max(0, input.timelineRange.startSeconds),
    Math.max(0, endSeconds - input.frameDurationSeconds)
  );

  return { startSeconds, endSeconds: Math.max(startSeconds, endSeconds) };
}

export function clampVideoTime(seconds: number, bounds: VideoTimelineRange): number {
  if (bounds.endSeconds <= bounds.startSeconds) {
    return Math.max(0, seconds);
  }

  return Math.min(bounds.endSeconds, Math.max(bounds.startSeconds, seconds));
}
