import type { ClipRecord, LongFormClipProposalRecord, LongFormSourceRecord, TranscriptRecord } from "./contracts";

export interface WorkflowSelectionIds {
  selectedClipId: string | null;
  selectedLongFormSourceId: string | null;
  selectedLongFormProposalId: string | null;
}

export function reconcileWorkflowSelection(
  current: WorkflowSelectionIds,
  clips: ClipRecord[],
  longFormSources: LongFormSourceRecord[],
  proposals: LongFormClipProposalRecord[] = []
): WorkflowSelectionIds {
  const selectedClipId = clips.some((clip) => clip.id === current.selectedClipId)
    ? current.selectedClipId
    : clips[0]?.id ?? null;
  const selectedLongFormSourceId = longFormSources.some((source) => source.id === current.selectedLongFormSourceId)
    ? current.selectedLongFormSourceId
    : null;
  const selectedLongFormProposalId = selectedLongFormSourceId && proposals.some((proposal) =>
    proposal.sourceId === selectedLongFormSourceId && proposal.id === current.selectedLongFormProposalId
  )
    ? current.selectedLongFormProposalId
    : null;

  return {
    selectedClipId,
    selectedLongFormSourceId,
    selectedLongFormProposalId
  };
}

export interface ReviewSelection {
  selectedClip: ClipRecord | null;
  selectedLongFormSource: LongFormSourceRecord | null;
  reviewClip: ClipRecord | null;
  reviewTranscript: TranscriptRecord | null;
}

export function deriveReviewSelection(
  clips: ClipRecord[],
  longFormSources: LongFormSourceRecord[],
  selectedClipId: string | null,
  selectedLongFormSourceId: string | null,
  selectedTranscript: TranscriptRecord | null,
  selectedLongFormTranscript: TranscriptRecord | null
): ReviewSelection {
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedLongFormSource = longFormSources.find((source) => source.id === selectedLongFormSourceId) ?? null;
  const reviewClip = selectedLongFormSource
    ? {
        id: selectedLongFormSource.id,
        workspaceId: "long-form-sources",
        displayName: selectedLongFormSource.displayName,
        sourcePath: selectedLongFormSource.sourcePath,
        fileSizeBytes: selectedLongFormSource.fileSizeBytes,
        durationMs: selectedLongFormSource.durationMs,
        frameRate: selectedLongFormSource.frameRate,
        widthPx: selectedLongFormSource.widthPx,
        heightPx: selectedLongFormSource.heightPx,
        status: "imported" as const,
        inspectionStatus: selectedLongFormSource.inspectionStatus,
        indexState: selectedLongFormSource.indexState,
        archivedAt: selectedLongFormSource.archivedAt,
        importedAt: selectedLongFormSource.importedAt,
        updatedAt: selectedLongFormSource.updatedAt
      }
    : selectedClip;

  return {
    selectedClip,
    selectedLongFormSource,
    reviewClip,
    reviewTranscript: selectedLongFormSource ? selectedLongFormTranscript : selectedTranscript
  };
}
