import type { ClipMetadataPackageDraft, GeneratedClipMetadataCandidatesResult, MetadataScoreSnapshot, MetadataVariantRecord, TranscriptAutoAssignScope, TranscriptSegmentRecord } from "../../shared/contracts";
export type TranscriptReviewFilter = "all" | "needs_review" | "unassigned";

export function parseListInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function mergeMetadataTags(...tagLists: string[][]): string[] {
  const seen = new Set<string>();

  return tagLists.flatMap((tagList) => tagList).reduce<string[]>((merged, tag) => {
    const normalizedTag = tag.trim();
    const comparisonKey = normalizedTag.replace(/^#+/, "").toLowerCase();

    if (!normalizedTag || seen.has(comparisonKey)) {
      return merged;
    }

    seen.add(comparisonKey);
    merged.push(normalizedTag);
    return merged;
  }, []);
}


export function createEmptyMetadataPackage(): ClipMetadataPackageDraft {
  return {
    title: "",
    description: "",
    publicHashtags: [],
    platformTags: [],
    seriesKey: "",
    gameTitle: "",
    collaboratorProfileIds: [],
    selectedVariantIds: {
      title: null,
      description: null,
      publicHashtags: null,
      platformTags: null
    },
    latestScoreSnapshot: null
  };
}

export function formatMetadataGenerationMessage(result: GeneratedClipMetadataCandidatesResult): string {
  const profilePrefix = result.profileName ? `${result.profileName}: ` : "";

  if (result.executionMode === "ai") {
    const aiSummary =
      result.note ??
      `AI packaging is ready${result.model ? ` from ${result.model}` : ""}.`;
    return `${profilePrefix}${aiSummary} Review the candidates, choose the packaging you want, then save the package when you are happy with it.`;
  }

  const issueSummary = result.issueSummary ?? result.note ?? "Fallback variants were used because the AI run had a problem.";
  if (result.executionMode === "mixed_fallback") {
    return `${profilePrefix}AI issue detected. ${issueSummary} Review carefully before saving any metadata from this run.`;
  }

  return `${profilePrefix}AI was unavailable, so the app used low-confidence local fallback candidates instead. ${issueSummary} Review carefully before saving any metadata from this run.`;
}


export function formatMetadataVariantAngle(angle: MetadataVariantRecord["angle"]): string {
  switch (angle) {
    case "specific_fail":
      return "Specific Fail";
    case "panic_tension":
      return "Panic Tension";
    case "social_chaos":
      return "Social Chaos";
    case "context_forward":
      return "Context Forward";
    case "search_forward":
      return "Search Forward";
    case "default":
      return "Default";
    case "alt":
      return "Alt";
  }
}


export function buildMetadataDraftFromState(input: {
  title: string;
  description: string;
  tagsInput: string;
  seriesKey: string;
  gameTitle: string;
  collaboratorProfileIds: string[];
  selectedVariantIds: ClipMetadataPackageDraft["selectedVariantIds"];
  latestScoreSnapshot: MetadataScoreSnapshot | null;
}): ClipMetadataPackageDraft {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    publicHashtags: parseListInput(input.tagsInput),
    platformTags: parseListInput(input.tagsInput),
    seriesKey: input.seriesKey.trim(),
    gameTitle: input.gameTitle.trim(),
    collaboratorProfileIds: input.collaboratorProfileIds.map((id) => id.trim()).filter(Boolean),
    selectedVariantIds: input.selectedVariantIds,
    latestScoreSnapshot: input.latestScoreSnapshot
  };
}


export function isLowConfidenceSegment(segment: TranscriptSegmentRecord): boolean {
  return segment.speakerAssignmentSource === "auto_low_confidence";
}


export function filterTranscriptSegments(
  segments: TranscriptSegmentRecord[],
  filter: TranscriptReviewFilter
): TranscriptSegmentRecord[] {
  switch (filter) {
    case "needs_review":
      return segments.filter((segment) => isLowConfidenceSegment(segment));
    case "unassigned":
      return segments.filter((segment) => !segment.speakerId);
    case "all":
      return segments;
  }
}

export function getAutoAssignEligibleSegments(
  segments: TranscriptSegmentRecord[],
  scope: TranscriptAutoAssignScope
): TranscriptSegmentRecord[] {
  switch (scope) {
    case "all":
      return segments.filter((segment) => segment.speakerAssignmentSource !== "manual");
    case "needs_review":
      return segments.filter((segment) => segment.speakerAssignmentSource === "auto_low_confidence");
    case "unassigned":
      return segments.filter((segment) => segment.speakerAssignmentSource !== "manual" && !segment.speakerId);
  }
}

export function hasSpeakerReviewStateChanged(
  previousSegment: TranscriptSegmentRecord,
  nextSegment: TranscriptSegmentRecord
): boolean {
  return (
    previousSegment.speakerId !== nextSegment.speakerId ||
    previousSegment.speakerConfidence !== nextSegment.speakerConfidence ||
    previousSegment.speakerAssignmentSource !== nextSegment.speakerAssignmentSource ||
    previousSegment.speakerReviewReason !== nextSegment.speakerReviewReason ||
    previousSegment.speakerAlternateSpeakerId !== nextSegment.speakerAlternateSpeakerId ||
    previousSegment.speakerAlternateConfidence !== nextSegment.speakerAlternateConfidence
  );
}

export function formatAutoAssignScopeLabel(scope: TranscriptAutoAssignScope): string {
  switch (scope) {
    case "all":
      return "eligible";
    case "needs_review":
      return "needs-review";
    case "unassigned":
      return "unassigned";
  }
}
