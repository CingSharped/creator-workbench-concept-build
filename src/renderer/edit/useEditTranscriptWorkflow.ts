import { useEffect, useState } from "react";
import { useEditingSession } from "../useEditingSession";
import type { AppInfo, ClipRecord, CreatorAppApi, TranscriptAutoAssignScope, TranscriptRecord, TranscriptSegmentRecord } from "../../shared/contracts";
import { CREATOR_SPEAKER_ID } from "../../shared/speakerProfiles";
import { buildTranscriptSegmentsFromSrt, normalizeTranscriptSegments } from "../../shared/transcriptSegments";
import { isLowConfidenceSegment, getAutoAssignEligibleSegments, hasSpeakerReviewStateChanged, formatAutoAssignScopeLabel, type TranscriptReviewFilter } from "./editWorkflowHelpers";

export type EditTranscriptApi = Pick<CreatorAppApi, "captureCreatorVoiceSample" | "removeCreatorVoiceSample" | "captureCollaboratorVoiceSample" | "removeCollaboratorVoiceSample" | "autoAssignTranscriptSpeakers" | "transcribeClip" | "exportTranscriptSrt" | "updateTranscript" | "getTranscript">;
interface Options {
  selectedClipId: string | null;
  selectedClip: ClipRecord | null;
  onError: (message: string | null) => void;
  onAppInfo: (info: AppInfo) => void;
  onRefreshWorkspace: (clipId?: string) => Promise<void>;
  api: EditTranscriptApi;
}
export function useEditTranscriptWorkflow({ selectedClipId, selectedClip, onError: setError, onAppInfo: setAppInfo, onRefreshWorkspace: refreshWorkspaceData, api }: Options) {
  const session = useEditingSession(selectedClipId);
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptRecord | null>(null);
  const [transcriptView, setTranscriptView] = useState<"text" | "srt" | "speakers">("text");
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcribingClipId, setTranscribingClipId] = useState<string | null>(null);
  const [exportingClipId, setExportingClipId] = useState<string | null>(null);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [draftTranscriptText, setDraftTranscriptText] = useState("");
  const [draftTranscriptSrt, setDraftTranscriptSrt] = useState("");
  const [draftTranscriptSegments, setDraftTranscriptSegments] = useState<TranscriptSegmentRecord[]>([]);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [autoAssigningSpeakers, setAutoAssigningSpeakers] = useState(false);
  const [speakerReviewFilter, setSpeakerReviewFilter] = useState<TranscriptReviewFilter>("all");
  const [capturingVoiceSampleKey, setCapturingVoiceSampleKey] = useState<string | null>(null);
  const [removingVoiceSampleKey, setRemovingVoiceSampleKey] = useState<string | null>(null);
  const [transcriptMessage, setTranscriptMessage] = useState<string | null>(null);

  useEffect(() => {
    setEditingTranscript(false);
    setDraftTranscriptText("");
    setDraftTranscriptSrt("");
    setSelectedTranscript(null);
    setTranscriptLoading(Boolean(selectedClipId));
    setTranscriptMessage(null);
    setSpeakerReviewFilter("all");
    setSavingTranscript(false);
    setAutoAssigningSpeakers(false);
    setTranscribingClipId(null);
    setExportingClipId(null);
    setCapturingVoiceSampleKey(null);
    setRemovingVoiceSampleKey(null);
  }, [selectedClipId]);

  useEffect(() => {
    if (!selectedTranscript) {
      setDraftTranscriptText("");
      setDraftTranscriptSrt("");
      setDraftTranscriptSegments([]);
      return;
    }

    setDraftTranscriptText(selectedTranscript.textContent);
    setDraftTranscriptSrt(selectedTranscript.srtContent);
    setDraftTranscriptSegments(normalizeTranscriptSegments(selectedTranscript.segments));
  }, [selectedTranscript?.id, selectedTranscript?.updatedAt]);

  useEffect(() => {
    if (!editingTranscript) {
      return;
    }

    setDraftTranscriptSegments((currentSegments) =>
      buildTranscriptSegmentsFromSrt(draftTranscriptSrt, draftTranscriptText, currentSegments)
    );
  }, [editingTranscript, draftTranscriptSrt, draftTranscriptText]);

  function handleAssignSpeakerToSegment(segmentId: string, speakerId: string): void {
    session.edit();
    setDraftTranscriptSegments((currentSegments) =>
      currentSegments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              speakerId: speakerId || null,
              speakerConfidence: null,
              speakerAssignmentSource: speakerId ? "manual" : null,
              speakerReviewReason: null,
              speakerAlternateSpeakerId: null,
              speakerAlternateConfidence: null
            }
          : segment
      )
    );
  }


  async function handleCaptureCreatorVoiceSample(segment: TranscriptSegmentRecord): Promise<void> {
    if (!selectedClip) {
      return;
    }

    const ticket = session.begin("capture", false);
    const requestKey = `${CREATOR_SPEAKER_ID}:${segment.id}`;
    setCapturingVoiceSampleKey(requestKey);
    setError(null);
    setTranscriptMessage(null);

    try {
      const nextInfo = await api.captureCreatorVoiceSample(selectedClip.id, segment);
      if (!session.accepts(ticket)) return;
      setAppInfo(nextInfo);
      const sampleCount = nextInfo.creatorVoiceSamples.length;
      setTranscriptMessage(
        `Saved a voice sample for you. ${sampleCount} sample${sampleCount === 1 ? "" : "s"} ready for auto-assign.`
      );
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to save your voice sample.");
    } finally {
      if (session.latest(ticket)) setCapturingVoiceSampleKey(null);
    }
  }


  async function handleRemoveCreatorVoiceSample(sampleId: string): Promise<void> {
    const ticket = session.begin("remove-sample", false);
    const requestKey = `${CREATOR_SPEAKER_ID}:${sampleId}`;
    setRemovingVoiceSampleKey(requestKey);
    setError(null);
    setTranscriptMessage(null);

    try {
      const nextInfo = await api.removeCreatorVoiceSample(sampleId);
      if (!session.accepts(ticket)) return;
      setAppInfo(nextInfo);
      setTranscriptMessage("Removed one of your saved voice samples.");
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to remove your voice sample.");
    } finally {
      if (session.latest(ticket)) setRemovingVoiceSampleKey(null);
    }
  }


  async function handleCaptureCollaboratorVoiceSample(
    collaboratorProfileId: string,
    segment: TranscriptSegmentRecord
  ): Promise<void> {
    if (!selectedClip) {
      return;
    }

    const ticket = session.begin("capture", false);
    const requestKey = `${collaboratorProfileId}:${segment.id}`;
    setCapturingVoiceSampleKey(requestKey);
    setError(null);
    setTranscriptMessage(null);

    try {
      const nextInfo = await api.captureCollaboratorVoiceSample(
        collaboratorProfileId,
        selectedClip.id,
        segment
      );
      if (!session.accepts(ticket)) return;
      setAppInfo(nextInfo);
      const collaborator = nextInfo.collaboratorProfiles.find((profile) => profile.id === collaboratorProfileId);
      const collaboratorName = collaborator?.displayName || "that collaborator";
      const sampleCount = collaborator?.voiceSamples.length ?? 0;
      setTranscriptMessage(
        `Saved a voice sample for ${collaboratorName}. ${sampleCount} sample${sampleCount === 1 ? "" : "s"} ready for auto-assign.`
      );
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to save the collaborator voice sample.");
    } finally {
      if (session.latest(ticket)) setCapturingVoiceSampleKey(null);
    }
  }


  async function handleRemoveCollaboratorVoiceSample(
    collaboratorProfileId: string,
    sampleId: string,
    collaboratorName: string
  ): Promise<void> {
    const ticket = session.begin("remove-sample", false);
    const requestKey = `${collaboratorProfileId}:${sampleId}`;
    setRemovingVoiceSampleKey(requestKey);
    setError(null);
    setTranscriptMessage(null);

    try {
      const nextInfo = await api.removeCollaboratorVoiceSample(collaboratorProfileId, sampleId);
      if (!session.accepts(ticket)) return;
      setAppInfo(nextInfo);
      setTranscriptMessage(`Removed a saved voice sample from ${collaboratorName || "that collaborator"}.`);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to remove the collaborator voice sample.");
    } finally {
      if (session.latest(ticket)) setRemovingVoiceSampleKey(null);
    }
  }


  async function handleAutoAssignTranscriptSpeakers(
    scope: TranscriptAutoAssignScope = "all"
  ): Promise<void> {
    if (!selectedClip || !selectedTranscript) {
      return;
    }

    const ticket = session.begin("transcript", true);
    setSavingTranscript(false);
    setAutoAssigningSpeakers(false);
    setTranscribingClipId(null);
    setAutoAssigningSpeakers(true);
    setError(null);
    setTranscriptMessage(null);

    try {
      const previousSegments = selectedTranscript.segments;
      const previousAssignedCount = previousSegments.filter((segment) => segment.speakerId).length;
      const previousLowConfidenceCount = previousSegments.filter((segment) =>
        isLowConfidenceSegment(segment)
      ).length;
      const eligibleSegments = getAutoAssignEligibleSegments(previousSegments, scope);
      const eligibleSegmentIds = new Set(eligibleSegments.map((segment) => segment.id));
      const previousSegmentsById = new Map(previousSegments.map((segment) => [segment.id, segment]));
      const transcript = await api.autoAssignTranscriptSpeakers(selectedClip.id, scope);
      if (!session.accepts(ticket)) return;
      setSelectedTranscript(transcript);
      session.commit(ticket);
      const nextAssignedCount = transcript.segments.filter((segment) => segment.speakerId).length;
      const nextLowConfidenceCount = transcript.segments.filter((segment) =>
        isLowConfidenceSegment(segment)
      ).length;
      const changedEligibleCount = transcript.segments.filter((segment) => {
        if (!eligibleSegmentIds.has(segment.id)) {
          return false;
        }

        const previousSegment = previousSegmentsById.get(segment.id);
        return previousSegment ? hasSpeakerReviewStateChanged(previousSegment, segment) : false;
      }).length;
      const untouchedOtherCount = Math.max(0, previousSegments.length - eligibleSegments.length);
      const assignedDelta = Math.max(0, nextAssignedCount - previousAssignedCount);
      const resolvedLowConfidenceCount = Math.max(0, previousLowConfidenceCount - nextLowConfidenceCount);

      if (scope === "needs_review") {
        setTranscriptMessage(
          `Rechecked ${eligibleSegments.length} needs-review segment${
            eligibleSegments.length === 1 ? "" : "s"
          } only. ${changedEligibleCount} changed, ${nextLowConfidenceCount} still need review${
            untouchedOtherCount > 0
              ? `, and ${untouchedOtherCount} other segment${untouchedOtherCount === 1 ? "" : "s"} were left untouched.`
              : "."
          }${
            changedEligibleCount === 0 && resolvedLowConfidenceCount === 0
              ? " The best matches stayed the same this time."
              : ""
          }`
        );
      } else {
        setTranscriptMessage(
          eligibleSegments.length > 0
            ? `Checked ${eligibleSegments.length} ${formatAutoAssignScopeLabel(scope)} segment${
                eligibleSegments.length === 1 ? "" : "s"
              }. ${changedEligibleCount} changed, ${assignedDelta} new assignment${
                assignedDelta === 1 ? "" : "s"
              } landed, and ${nextLowConfidenceCount} segment${
                nextLowConfidenceCount === 1 ? "" : "s"
              } are flagged for review${
                untouchedOtherCount > 0
                  ? `. ${untouchedOtherCount} other segment${untouchedOtherCount === 1 ? "" : "s"} were left untouched.`
                  : "."
              }`
            : "No eligible transcript segments were available for this auto-assign scope."
        );
      }
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to auto-assign transcript speakers.");
    } finally {
      if (session.latest(ticket)) setAutoAssigningSpeakers(false);
    }
  }


  async function handleTranscribeSelectedClip(): Promise<void> {
    if (!selectedClip) {
      return;
    }

    const ticket = session.begin("transcript", true);
    setSavingTranscript(false);
    setAutoAssigningSpeakers(false);
    setTranscribingClipId(null);
    const transcriptViewBeforeRerun = transcriptView;
    setTranscribingClipId(selectedClip.id);
    setError(null);

    try {
      const transcript = await api.transcribeClip(selectedClip.id);
      if (!session.accepts(ticket)) return;
      setSelectedTranscript(transcript);
      session.commit(ticket);
      setTranscriptView(transcriptViewBeforeRerun);
      await refreshWorkspaceData(selectedClip.id);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to transcribe the selected clip.");
      await refreshWorkspaceData(selectedClip.id);
    } finally {
      if (session.latest(ticket)) setTranscribingClipId(null);
    }
  }


  async function handleExportSelectedTranscript(): Promise<void> {
    if (!selectedClip) {
      return;
    }

    const ticket = session.begin("export", false);
    setExportingClipId(selectedClip.id);
    setError(null);

    try {
      await api.exportTranscriptSrt(selectedClip.id);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to export the SRT file.");
    } finally {
      if (session.latest(ticket)) setExportingClipId(null);
    }
  }


  function handleCancelTranscriptEdits(): void {
    session.edit(false);
    session.commit(session.capture());
    setEditingTranscript(false);
    setDraftTranscriptText(selectedTranscript?.textContent ?? "");
    setDraftTranscriptSrt(selectedTranscript?.srtContent ?? "");
    setDraftTranscriptSegments(normalizeTranscriptSegments(selectedTranscript?.segments));
    setSpeakerReviewFilter("all");
  }


  async function handleSaveTranscriptEdits(): Promise<void> {
    if (!selectedClip || !selectedTranscript) {
      return;
    }

    const ticket = session.begin("transcript", true);
    setSavingTranscript(false);
    setAutoAssigningSpeakers(false);
    setTranscribingClipId(null);
    setSavingTranscript(true);
    setError(null);

    try {
      const updatedTranscript = await api.updateTranscript(
        selectedClip.id,
        draftTranscriptText,
        draftTranscriptSrt,
        draftTranscriptSegments
      );
      if (!session.accepts(ticket)) return;
      setSelectedTranscript(updatedTranscript);
      session.commit(ticket);
      setEditingTranscript(false);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to save transcript edits.");
    } finally {
      if (session.latest(ticket)) setSavingTranscript(false);
    }
  }


  return {
    transcriptSession: session,
    selectedTranscript, setSelectedTranscript: session.acceptSetter(setSelectedTranscript, true),
    transcriptView, setTranscriptView,
    transcriptLoading, setTranscriptLoading, transcribingClipId, exportingClipId,
    editingTranscript, setEditingTranscript: session.editSetter(setEditingTranscript, editingTranscript, false), draftTranscriptText, setDraftTranscriptText: session.editSetter(setDraftTranscriptText, draftTranscriptText),
    draftTranscriptSrt, setDraftTranscriptSrt: session.editSetter(setDraftTranscriptSrt, draftTranscriptSrt), draftTranscriptSegments, setDraftTranscriptSegments: session.editSetter(setDraftTranscriptSegments, draftTranscriptSegments),
    savingTranscript, setSavingTranscript: session.acceptSetter(setSavingTranscript), autoAssigningSpeakers,
    speakerReviewFilter, setSpeakerReviewFilter, capturingVoiceSampleKey, removingVoiceSampleKey,
    transcriptMessage, handleAssignSpeakerToSegment, handleCaptureCreatorVoiceSample,
    handleRemoveCreatorVoiceSample, handleCaptureCollaboratorVoiceSample,
    handleRemoveCollaboratorVoiceSample, handleAutoAssignTranscriptSpeakers,
    handleTranscribeSelectedClip, handleExportSelectedTranscript,
    handleCancelTranscriptEdits, handleSaveTranscriptEdits
  };
}
