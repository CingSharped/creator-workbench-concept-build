import type { ReactNode } from "react";
import type { SpeakerContextSummary } from "../shared/contracts";
import InfoTip from "./InfoTip";
import { Button } from "./WorkbenchPrimitives";

interface SpeakerContextBadgeProps {
  summary: SpeakerContextSummary;
  compact?: boolean;
}

interface SpeakerContextWarningProps {
  summary: SpeakerContextSummary;
  onReviewSpeakers?: () => void;
}

const STATUS_LABELS: Record<SpeakerContextSummary["status"], string> = {
  identified: "Streamer identified",
  partial: "Needs speaker review",
  unavailable: "Speaker context unavailable",
  stale: "Speaker context stale"
};

const STATUS_TONES: Record<SpeakerContextSummary["status"], string> = {
  identified: "success",
  partial: "warning",
  unavailable: "warning",
  stale: "warning"
};

export function SpeakerContextBadge({ summary, compact = false }: SpeakerContextBadgeProps): JSX.Element {
  return (
    <span className={`speaker-context-badge ${STATUS_TONES[summary.status]}${compact ? " compact" : ""}`}>
      {STATUS_LABELS[summary.status]}
      <InfoTip label="Speaker context details">
        <SpeakerContextTooltip summary={summary} />
      </InfoTip>
    </span>
  );
}

export function SpeakerContextWarning({ summary, onReviewSpeakers }: SpeakerContextWarningProps): JSX.Element | null {
  if (summary.status === "identified") {
    return null;
  }

  const message = summary.status === "stale"
    ? "Speaker assignments changed after this metadata was generated. Review speakers and regenerate if the creator perspective needs updating."
    : summary.status === "partial"
      ? summary.transcriptComplete
        ? summary.creatorTrustedSegmentCount > 0
          ? `The streamer is identified, but ${buildUnresolvedSummary(summary)}. Metadata can still be generated with grounded wording.`
          : `The streamer is not yet confirmed, and ${buildUnresolvedSummary(summary)}. Metadata can still be generated with neutral wording.`
        : summary.creatorTrustedSegmentCount > 0
          ? "The streamer is identified in the available segments, but the transcript is incomplete. Metadata can still be generated with grounded wording."
          : "The transcript is incomplete and the streamer is not yet confirmed. Metadata can still be generated with neutral wording."
      : "Streamer voice not confirmed. Metadata can still be generated, but wording will stay neutral until speaker review is completed.";

  return (
    <div className="speaker-context-warning" role="status">
      <div>
        <strong>{STATUS_LABELS[summary.status]}</strong>
        <p className="muted">{message}</p>
      </div>
      {onReviewSpeakers ? (
        <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onReviewSpeakers}>
          Review speakers
        </Button>
      ) : null}
    </div>
  );
}

function buildUnresolvedSummary(summary: SpeakerContextSummary): string {
  const unresolvedParts: string[] = [];
  if (summary.unassignedSegmentCount > 0) {
    unresolvedParts.push(`${summary.unassignedSegmentCount} segment${summary.unassignedSegmentCount === 1 ? " is" : "s are"} unassigned`);
  }
  if (summary.needsReviewSegmentCount > 0) {
    unresolvedParts.push(`${summary.needsReviewSegmentCount} assigned segment${summary.needsReviewSegmentCount === 1 ? " still needs" : "s still need"} review`);
  }
  if (unresolvedParts.length > 0) {
    return unresolvedParts.join(" and ");
  }
  return `${summary.unresolvedSegmentCount} segment${summary.unresolvedSegmentCount === 1 ? " still needs" : "s still need"} review`;
}

export function SpeakerContextTooltip({ summary }: { summary: SpeakerContextSummary }): ReactNode {
  const collaboratorSummary = summary.collaboratorCounts.length > 0
    ? summary.collaboratorCounts
        .map((collaborator) => `${collaborator.displayName}: ${collaborator.trustedSegmentCount}`)
        .join(", ")
    : "none";

  return (
    <span className="speaker-context-tooltip-copy">
      Trusted streamer segments: {summary.creatorTrustedSegmentCount}. Collaborators: {collaboratorSummary}.
      Unassigned segments: {summary.unassignedSegmentCount}. Assigned segments needing review: {summary.needsReviewSegmentCount}.
      Unresolved segments: {summary.unresolvedSegmentCount}. Low-confidence segments: {summary.lowConfidenceSegmentCount}.
      {summary.transcriptComplete ? "" : " The transcript is incomplete."}
    </span>
  );
}

export const SpeakerContextDetails = SpeakerContextTooltip;
