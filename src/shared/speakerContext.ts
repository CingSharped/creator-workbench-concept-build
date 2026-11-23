import type {
  CollaboratorProfile,
  SpeakerContextSummary,
  TranscriptRecord,
  TranscriptSegmentRecord
} from "./contracts";
import { CREATOR_SPEAKER_ID } from "./speakerProfiles";

export type SpeakerAssignmentState = "unassigned" | "needs_review" | "resolved";

function isKnownSpeaker(
  segment: TranscriptSegmentRecord,
  collaboratorById: Map<string, CollaboratorProfile>
): boolean {
  return segment.speakerId === CREATOR_SPEAKER_ID ||
    (segment.speakerId !== null && collaboratorById.has(segment.speakerId));
}

export function classifySpeakerAssignment(
  segment: TranscriptSegmentRecord,
  collaborators: CollaboratorProfile[] = []
): SpeakerAssignmentState {
  const collaboratorById = new Map(collaborators.map((profile) => [profile.id, profile]));
  if (!segment.speakerId || !isKnownSpeaker(segment, collaboratorById)) {
    return "unassigned";
  }

  if (isLowConfidenceSpeakerAssignment(segment)) {
    return "needs_review";
  }

  return "resolved";
}

export function buildSpeakerContextSummary(
  transcript: TranscriptRecord | null,
  collaborators: CollaboratorProfile[] = []
): SpeakerContextSummary {
  if (!transcript) {
    return {
      status: "unavailable",
      transcriptId: null,
      transcriptUpdatedAt: null,
      transcriptComplete: false,
      creatorTrustedSegmentCount: 0,
      collaboratorCounts: [],
      unassignedSegmentCount: 0,
      needsReviewSegmentCount: 0,
      unresolvedSegmentCount: 0,
      lowConfidenceSegmentCount: 0
    };
  }

  const collaboratorById = new Map(
    collaborators.map((profile) => [profile.id, profile])
  );
  const collaboratorCounts = new Map<string, number>();
  let creatorTrustedSegmentCount = 0;
  let creatorAssignmentCount = 0;
  let unassignedSegmentCount = 0;
  let needsReviewSegmentCount = 0;
  let unresolvedSegmentCount = 0;
  let lowConfidenceSegmentCount = 0;

  for (const segment of transcript.segments) {
    if (isLowConfidenceSpeakerAssignment(segment)) {
      lowConfidenceSegmentCount += 1;
    }

    const assignmentState = classifySpeakerAssignment(segment, collaborators);
    if (assignmentState === "unassigned") {
      unassignedSegmentCount += 1;
      unresolvedSegmentCount += 1;
      continue;
    }
    if (segment.speakerId === CREATOR_SPEAKER_ID) {
      creatorAssignmentCount += 1;
    }
    if (assignmentState === "needs_review") {
      needsReviewSegmentCount += 1;
      unresolvedSegmentCount += 1;
      continue;
    }

    if (segment.speakerId === CREATOR_SPEAKER_ID) {
      creatorTrustedSegmentCount += 1;
      continue;
    }

    if (segment.speakerId) {
      collaboratorCounts.set(
        segment.speakerId,
        (collaboratorCounts.get(segment.speakerId) ?? 0) + 1
      );
    }
  }

  const hasTranscriptSegments = transcript.segments.length > 0;
  const status =
    !hasTranscriptSegments || creatorAssignmentCount === 0
      ? "unavailable"
      : transcript.status === "incomplete" || unresolvedSegmentCount > 0
        ? "partial"
        : "identified";

  return {
    status,
    transcriptId: transcript.id,
    transcriptUpdatedAt: transcript.updatedAt,
    transcriptComplete: transcript.status !== "incomplete",
    creatorTrustedSegmentCount,
    collaboratorCounts: [...collaboratorCounts.entries()]
      .map(([speakerId, trustedSegmentCount]) => ({
        speakerId,
        displayName: collaboratorById.get(speakerId)?.displayName || "Unnamed collaborator",
        trustedSegmentCount
      }))
      .sort((left, right) => right.trustedSegmentCount - left.trustedSegmentCount),
    unassignedSegmentCount,
    needsReviewSegmentCount,
    unresolvedSegmentCount,
    lowConfidenceSegmentCount
  };
}

export function isTrustedSpeakerAssignment(
  segment: TranscriptSegmentRecord,
  collaborators: CollaboratorProfile[] = []
): boolean {
  return classifySpeakerAssignment(segment, collaborators) === "resolved";
}

export function isLowConfidenceSpeakerAssignment(segment: TranscriptSegmentRecord): boolean {
  if (segment.speakerAssignmentSource === "manual") {
    return false;
  }

  return Boolean(
    segment.speakerAssignmentSource === "auto_low_confidence" ||
      segment.speakerReviewReason ||
      (segment.speakerConfidence !== null && segment.speakerConfidence < 0.72)
  );
}
