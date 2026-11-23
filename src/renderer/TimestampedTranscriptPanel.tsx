import { useEffect, useMemo, useState } from "react";
import { useEditingSession } from "./useEditingSession";
import type {
  CollaboratorProfile,
  TranscriptAssetRef,
  TranscriptAutoAssignScope,
  TranscriptRecord,
  TranscriptSegmentRecord
} from "../shared/contracts";
import {
  buildTranscriptSegmentsFromSrt,
  normalizeTranscriptSegments,
  splitTranscriptSegment
} from "../shared/transcriptSegments";
import {
  CREATOR_SPEAKER_COLOR,
  CREATOR_SPEAKER_ID,
  CREATOR_SPEAKER_LABEL,
  normalizeSpeakerColorHex
} from "../shared/speakerProfiles";
import InfoTip from "./InfoTip";
import { buildSpeakerContextSummary, classifySpeakerAssignment } from "../shared/speakerContext";
import { SpeakerContextBadge, SpeakerContextWarning } from "./SpeakerContext";
import { Button, Panel, PanelHeader, ScrollArea, SegmentedTabs, StatusBadge } from "./WorkbenchPrimitives";

interface TimestampedTranscriptPanelProps {
  clipId: string | null;
  transcriptAsset?: TranscriptAssetRef | null;
  selectedTranscript: TranscriptRecord | null;
  transcriptLoading: boolean;
  currentTimeSeconds?: number;
  onSeekToSeconds?: (seconds: number) => void;
  onTranscriptSaved: (transcript: TranscriptRecord) => void;
  onRerunTranscription?: () => void | Promise<void>;
  rerunTranscriptionBusy?: boolean;
  onExportSrt?: () => void | Promise<void>;
  exportSrtBusy?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onOpenEdit?: () => void;
  collaboratorProfiles?: CollaboratorProfile[];
  creatorVoiceSampleCount?: number;
  onAutoAssignSpeakers?: (scope: TranscriptAutoAssignScope) => void | Promise<void>;
  onSaveCreatorVoiceSample?: (segment: TranscriptSegmentRecord) => void | Promise<void>;
  onSaveCollaboratorVoiceSample?: (profileId: string, segment: TranscriptSegmentRecord) => void | Promise<void>;
  openSpeakerReviewRequest?: number;
}

type TranscriptPanelMode = "transcript" | "speakers";
type SpeakerReviewFilter = "all" | "needs_review" | "unassigned";

type SplitDraft = {
  segmentId: string;
  splitAtMs: number;
  splitTimeSeconds: string;
  beforeText: string;
  afterText: string;
};

export default function TimestampedTranscriptPanel({
  clipId,
  transcriptAsset = null,
  selectedTranscript,
  transcriptLoading,
  currentTimeSeconds = 0,
  onSeekToSeconds,
  onTranscriptSaved,
  onEditingChange,
  onSavingChange,
  onOpenEdit,
  onRerunTranscription,
  rerunTranscriptionBusy = false,
  onExportSrt,
  exportSrtBusy = false,
  collaboratorProfiles = [],
  creatorVoiceSampleCount = 0,
  onAutoAssignSpeakers,
  onSaveCreatorVoiceSample,
  onSaveCollaboratorVoiceSample,
  openSpeakerReviewRequest = 0
}: TimestampedTranscriptPanelProps): JSX.Element {
  const sessionKey = JSON.stringify([transcriptAsset ? `${transcriptAsset.assetType}:${transcriptAsset.assetId}` : `clip:${clipId}`, selectedTranscript?.id, selectedTranscript?.updatedAt]);
  const session = useEditingSession(sessionKey);
  useEffect(() => { setSavingTranscript(false); }, [sessionKey]);
  const [editingTranscript, writeEditingTranscript] = useState(false);
  const setEditingTranscript = session.editSetter(writeEditingTranscript, editingTranscript);
  const [draftTranscriptText, writeDraftTranscriptText] = useState("");
  const setDraftTranscriptText = session.editSetter(writeDraftTranscriptText, draftTranscriptText);
  const [draftSegments, writeDraftSegments] = useState<TranscriptSegmentRecord[]>([]);
  const setDraftSegments = session.editSetter(writeDraftSegments, draftSegments);
  const [draftTimes, writeDraftTimes] = useState<Record<string, { start: string; end: string }>>({});
  const setDraftTimes = session.editSetter(writeDraftTimes, draftTimes);
  const [splitDraft, writeSplitDraft] = useState<SplitDraft | null>(null);
  const setSplitDraft = session.editSetter(writeSplitDraft, splitDraft);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptPanelMode, setTranscriptPanelMode] = useState<TranscriptPanelMode>("transcript");
  const [speakerReviewFilter, setSpeakerReviewFilter] = useState<SpeakerReviewFilter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewSegments = useMemo(
    () => selectedTranscript
      ? normalizeTranscriptSegments(selectedTranscript.segments).length > 0
        ? normalizeTranscriptSegments(selectedTranscript.segments)
        : buildTranscriptSegmentsFromSrt(
            selectedTranscript.srtContent,
            selectedTranscript.textContent,
            selectedTranscript.segments
          )
      : [],
    [selectedTranscript?.id, selectedTranscript?.updatedAt]
  );
  const hasUnsavedSpeakerAssignments =
    draftSegments.length > 0 && JSON.stringify(draftSegments) !== JSON.stringify(reviewSegments);
  const speakerContext = buildSpeakerContextSummary(
    selectedTranscript && draftSegments.length > 0
      ? { ...selectedTranscript, segments: draftSegments }
      : selectedTranscript,
    collaboratorProfiles
  );
  const transcriptDisplaySegments = editingTranscript ? draftSegments : reviewSegments;
  const activeSegmentIndex = transcriptDisplaySegments.findIndex((segment) => {
    if (typeof segment.startMs !== "number") {
      return false;
    }

    const startSeconds = segment.startMs / 1000;
    const endSeconds = typeof segment.endMs === "number" ? segment.endMs / 1000 : Number.POSITIVE_INFINITY;
    return currentTimeSeconds >= startSeconds && currentTimeSeconds < endSeconds;
  });

  useEffect(() => {
    setTranscriptPanelMode("transcript");
    setSpeakerReviewFilter("all");
  }, [selectedTranscript?.id]);

  useEffect(() => {
    if (openSpeakerReviewRequest > 0) {
      setTranscriptPanelMode("speakers");
    }
  }, [openSpeakerReviewRequest]);

  useEffect(() => {
    setDraftTranscriptText(selectedTranscript?.textContent ?? "");
    setDraftSegments(reviewSegments);
    setDraftTimes({});
    setSplitDraft(null);
    setEditingTranscript(false);
    setMessage(null);
    setError(null);
  }, [selectedTranscript?.id, selectedTranscript?.updatedAt, reviewSegments]);

  useEffect(() => {
    onEditingChange?.(editingTranscript);
  }, [editingTranscript, onEditingChange]);

  useEffect(() => {
    onSavingChange?.(savingTranscript);
  }, [savingTranscript, onSavingChange]);

  function seekToSegment(segment: TranscriptSegmentRecord): void {
    if (typeof segment.startMs !== "number") {
      return;
    }

    onSeekToSeconds?.(segment.startMs / 1000);
  }

  function beginSplit(segment: TranscriptSegmentRecord): void {
    try {
      getTimedDraftSegments();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Invalid segment timing.");
      return;
    }
    if (typeof segment.startMs !== "number" || typeof segment.endMs !== "number") {
      setError("Only timed transcript segments can be split.");
      return;
    }

    const minimumSplitMs = segment.startMs + 10;
    const maximumSplitMs = segment.endMs - 10;
    if (maximumSplitMs <= minimumSplitMs) {
      setError("This segment is too short to split safely.");
      return;
    }

    const playheadMs = Math.round(currentTimeSeconds * 1000);
    const midpointMs = segment.startMs + Math.round((segment.endMs - segment.startMs) / 2);
    const preferredSplitMs = playheadMs > segment.startMs && playheadMs < segment.endMs
      ? playheadMs
      : midpointMs;
    const splitAtMs = Math.min(
      maximumSplitMs,
      Math.max(minimumSplitMs, Math.round(preferredSplitMs / 10) * 10)
    );

    setError(null);
    setMessage(null);
    setSplitDraft({
      segmentId: segment.id,
      splitAtMs,
      splitTimeSeconds: String(splitAtMs / 1000),
      beforeText: segment.text,
      afterText: ""
    });
  }

  function updateSplitDraft(update: Partial<SplitDraft>): void {
    setSplitDraft((current) => current ? {
      ...current,
      ...update,
      ...(typeof update.splitAtMs === "number" && update.splitTimeSeconds === undefined
        ? { splitTimeSeconds: String(update.splitAtMs / 1000) }
        : {})
    } : current);
  }

  function applySplit(): void {
    if (!splitDraft) {
      return;
    }

    try {
      const splitAtMs = Math.round(Number(splitDraft.splitTimeSeconds) * 1000);
      if (!splitDraft.splitTimeSeconds.trim() || !Number.isFinite(splitAtMs)) {
        throw new Error("Enter a valid start time in seconds for the second segment.");
      }
      const nextSegments = splitTranscriptSegment(
        getTimedDraftSegments(),
        splitDraft.segmentId,
        splitAtMs,
        splitDraft.beforeText,
        splitDraft.afterText
      );
      setDraftSegments(nextSegments);
      setSplitDraft(null);
      setError(null);
      setMessage("Segment split in the draft. Save transcript edits to keep the new timestamps.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to split transcript segment.");
    }
  }

  function getTimedDraftSegments(): TranscriptSegmentRecord[] {
    return draftSegments.map((segment, index) => {
      const times = draftTimes[segment.id];
      if (!times) {
        return segment;
      }
      const startMs = Math.round(Number(times.start) * 1000);
      const endMs = Math.round(Number(times.end) * 1000);
      if (!times.start.trim() || !times.end.trim() ||
          !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
        throw new Error(`Segment ${index + 1}: enter a non-negative start time and an end time after its start.`);
      }
      return { ...segment, startMs, endMs };
    });
  }

  function updateSegmentTime(segment: TranscriptSegmentRecord, field: "start" | "end", value: string): void {
    setDraftTimes((current) => ({
      ...current,
      [segment.id]: {
        ...(current[segment.id] ?? {
          start: String((segment.startMs ?? 0) / 1000),
          end: String((segment.endMs ?? 0) / 1000)
        }),
        [field]: value
      }
    }));
    const timeMs = Math.round(Number(value) * 1000);
    if (value.trim() && Number.isFinite(timeMs) && timeMs >= 0) {
      setDraftSegments((current) => current.map((item) => item.id === segment.id
        ? { ...item, [field === "start" ? "startMs" : "endMs"]: timeMs }
        : item));
    }
    setSplitDraft(null);
    setError(null);
    setMessage(null);
  }

  function assignSpeaker(segmentId: string, speakerId: string): void {
    setDraftSegments((currentSegments) => currentSegments.map((segment) =>
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
    ));
  }

  function speakerName(speakerId: string | null): string {
    if (!speakerId) {
      return "Unassigned";
    }
    if (speakerId === CREATOR_SPEAKER_ID) {
      return CREATOR_SPEAKER_LABEL;
    }
    return collaboratorProfiles.find((profile) => profile.id === speakerId)?.displayName || "Unknown speaker";
  }

  function speakerAccentColor(speakerId: string | null): string | null {
    if (!speakerId) {
      return null;
    }
    if (speakerId === CREATOR_SPEAKER_ID) {
      return CREATOR_SPEAKER_COLOR;
    }

    const profile = collaboratorProfiles.find((candidate) => candidate.id === speakerId);
    return profile?.speakerColorHex ? normalizeSpeakerColorHex(profile.speakerColorHex) : null;
  }

  function visibleSpeakerSegments(): TranscriptSegmentRecord[] {
    return draftSegments.filter((segment) => {
      const assignmentState = classifySpeakerAssignment(segment, collaboratorProfiles);
      return speakerReviewFilter === "all" ||
        (speakerReviewFilter === "needs_review" && assignmentState === "needs_review") ||
        (speakerReviewFilter === "unassigned" && assignmentState === "unassigned");
    });
  }

  async function saveTranscriptCorrections(): Promise<void> {
    if (!clipId || !selectedTranscript) {
      setError("Select a clip before saving transcript edits.");
      return;
    }

    const ticket = session.begin("save", true);
    setSavingTranscript(true);
    setError(null);
    setMessage(null);
    try {
      const nextSegments = normalizeTranscriptSegments(getTimedDraftSegments());
      const nextText = nextSegments.length > 0
        ? nextSegments.map((segment) => segment.text).join(" ").trim()
        : draftTranscriptText.trim();
      const nextSrt = nextSegments.some(
        (segment) => typeof segment.startMs === "number" && typeof segment.endMs === "number"
      )
        ? buildSrtContent(nextSegments)
        : selectedTranscript.srtContent;
      const updatedTranscript = await window.creatorApp.updateTranscript(
        clipId,
        nextText,
        nextSrt,
        nextSegments,
        transcriptAsset ?? undefined
      );
      if (!session.accepts(ticket)) return;
      onTranscriptSaved(updatedTranscript);
      setMessage("Transcript edits saved, including the updated timed subtitle file.");
      setSplitDraft(null);
      setEditingTranscript(false);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to save transcript edits.");
    } finally {
      if (session.latest(ticket)) setSavingTranscript(false);
    }
  }

  function cancelTranscriptEdits(): void {
    setDraftTranscriptText(selectedTranscript?.textContent ?? "");
    setDraftSegments(reviewSegments);
    setDraftTimes({});
    setSplitDraft(null);
    setEditingTranscript(false);
    setError(null);
  }

  const visibleSegments = visibleSpeakerSegments();
  const activeAutoAssignScope: TranscriptAutoAssignScope = speakerReviewFilter;
  const activeAutoAssignLabel = speakerReviewFilter === "all"
    ? "All"
    : speakerReviewFilter === "needs_review"
      ? "Needs review"
      : "Unassigned";

  return (
    <Panel className="panel review-transcript-panel timestamped-transcript-panel">
      <PanelHeader className="panel-header">
        <div>
          <div className="title-with-tip">
            <h3>Transcript</h3>
            <InfoTip label="Transcript controls">Click a line to seek the video. The highlighted line follows playback, and saved edits update the transcript used by metadata and SRT export.</InfoTip>
          </div>
          <p className="detail-meta">Click a line to seek the video. The highlighted line follows playback.</p>
        </div>
        <div className="detail-actions">
          {selectedTranscript ? <StatusBadge className="panel-badge" tone="info">Saved transcript</StatusBadge> : null}
          {selectedTranscript ? <SpeakerContextBadge summary={speakerContext} compact /> : null}
          {onRerunTranscription ? (
            <Button
              type="button"
              variant={selectedTranscript ? "secondary" : "primary"}
              className={selectedTranscript ? "secondary-button compact-button" : "primary-button compact-button"}
              onClick={() => void onRerunTranscription()}
              disabled={transcriptLoading || rerunTranscriptionBusy}
            >
              {transcriptLoading || rerunTranscriptionBusy ? "Running..." : selectedTranscript ? "Re-Run" : "Run"}
            </Button>
          ) : null}
        </div>
      </PanelHeader>

      <SegmentedTabs className="transcript-mode-tabs" role="tablist" aria-label="Transcript review mode">
        <button type="button" className={transcriptPanelMode === "transcript" ? "active" : ""} onClick={() => setTranscriptPanelMode("transcript")} role="tab" aria-selected={transcriptPanelMode === "transcript"}>Transcript</button>
        <button type="button" className={transcriptPanelMode === "speakers" ? "active" : ""} onClick={() => setTranscriptPanelMode("speakers")} role="tab" aria-selected={transcriptPanelMode === "speakers"}>Speaker review</button>
      </SegmentedTabs>

      {transcriptLoading ? <p className="muted">Loading transcript...</p> : selectedTranscript ? (
        <>
          {selectedTranscript.status === "incomplete" ? (
            <div className="info-banner warning-banner">
              <strong>Incomplete transcript</strong>
              <p className="muted">This partial transcript is available for review and export, but a fresh transcription is needed before treating it as complete.</p>
            </div>
          ) : null}
          {transcriptPanelMode === "speakers" ? (
            <div className="speaker-review-mode">
              <SpeakerContextWarning summary={speakerContext} />
              <div className="speaker-review-toolbar">
                <SegmentedTabs className="view-toggle" role="tablist" aria-label="Speaker review filter">
                  {(["all", "needs_review", "unassigned"] as const).map((filter) => (
                    <button key={filter} type="button" className={speakerReviewFilter === filter ? "active" : ""} onClick={() => setSpeakerReviewFilter(filter)} role="tab" aria-selected={speakerReviewFilter === filter}>
                      {filter === "all" ? "All" : filter === "needs_review" ? "Needs review" : "Unassigned"}
                    </button>
                  ))}
                </SegmentedTabs>
                <div className="detail-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    compact
                    className="secondary-button compact-button"
                    onClick={() => void onAutoAssignSpeakers?.(activeAutoAssignScope)}
                    disabled={!onAutoAssignSpeakers || draftSegments.length === 0}
                  >
                    Run {activeAutoAssignLabel}
                  </Button>
                </div>
              </div>
              <p className="detail-meta">Manual labels take priority. Low-confidence or unassigned segments remain visible until reviewed.</p>
              <ScrollArea className="speaker-segment-list review-speaker-list">
                {visibleSegments.length === 0 ? <p className="muted">No segments match this review filter.</p> : visibleSegments.map((segment) => {
                  const accentColor = speakerAccentColor(segment.speakerId);
                  const assignmentState = classifySpeakerAssignment(segment, collaboratorProfiles);
                  return (
                  <article
                    key={segment.id}
                    className={`speaker-segment-card${accentColor ? " speaker-matched-card" : ""}`}
                    style={accentColor ? {
                      borderLeftColor: accentColor,
                      background: `linear-gradient(90deg, ${accentColor}20, rgba(255, 255, 255, 0.025) 48%)`
                    } : undefined}
                  >
                    <button type="button" className="review-transcript-seek" onClick={() => seekToSegment(segment)}>
                      <span className="review-transcript-time">{formatTranscriptTime((segment.startMs ?? 0) / 1000)}</span>
                      <span className="review-transcript-text">{segment.text}</span>
                    </button>
                    <div className="speaker-segment-controls">
                      <label className="editor-field">
                        <span>Speaker</span>
                        <select className="editor-input" value={segment.speakerId ?? ""} onChange={(event) => assignSpeaker(segment.id, event.target.value)}>
                          <option value="">Unassigned</option>
                          <option value={CREATOR_SPEAKER_ID}>{CREATOR_SPEAKER_LABEL}</option>
                          {collaboratorProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName || "Unnamed collaborator"}</option>)}
                        </select>
                      </label>
                      <StatusBadge className={`status-pill ${assignmentState === "resolved" ? "success" : "warning"}`} tone={assignmentState === "resolved" ? "success" : "warning"}>
                        {assignmentState !== "resolved" ? "Needs review" : `${speakerName(segment.speakerId)} - ${segment.speakerConfidence !== null ? `${Math.round(segment.speakerConfidence * 100)}%` : "Manual"}`}
                      </StatusBadge>
                    </div>
                    {segment.speakerReviewReason ? <p className="detail-meta">{segment.speakerReviewReason}{segment.speakerAlternateSpeakerId ? ` Suggested alternative: ${speakerName(segment.speakerAlternateSpeakerId)}.` : ""}</p> : null}
                    <div className="speaker-sample-actions">
                      <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => void onSaveCreatorVoiceSample?.(segment)} disabled={!onSaveCreatorVoiceSample || segment.speakerId !== CREATOR_SPEAKER_ID}>Save You sample ({creatorVoiceSampleCount})</Button>
                      {collaboratorProfiles.map((profile) => (
                        <Button key={profile.id} type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => void onSaveCollaboratorVoiceSample?.(profile.id, segment)} disabled={!onSaveCollaboratorVoiceSample || segment.speakerId !== profile.id}>Save {profile.displayName || "collaborator"} sample ({profile.voiceSamples.length})</Button>
                      ))}
                    </div>
                  </article>
                  );
                })}
              </ScrollArea>
              <p className="detail-meta">
                {hasUnsavedSpeakerAssignments
                  ? "Speaker assignments are changed locally. Save them before generating metadata so the saved transcript carries the updated context."
                  : "Speaker assignments are saved with the transcript and will be used by metadata generation."}
              </p>
              {editingTranscript || hasUnsavedSpeakerAssignments ? (
                <div className="review-transcript-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    compact
                    className="secondary-button compact-button"
                    onClick={cancelTranscriptEdits}
                    disabled={savingTranscript}
                  >
                    Discard changes
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    compact
                    className="primary-button compact-button"
                    onClick={() => void saveTranscriptCorrections()}
                    disabled={savingTranscript}
                  >
                    {savingTranscript ? "Saving..." : "Save speaker assignments"}
                  </Button>
                </div>
              ) : (
                <div className="review-transcript-actions">
                  <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => setEditingTranscript(true)}>Edit</Button>
                  {onRerunTranscription ? <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => void onRerunTranscription()} disabled={rerunTranscriptionBusy}>Re-Run</Button> : null}
                  {onExportSrt ? <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => void onExportSrt()} disabled={exportSrtBusy}>{exportSrtBusy ? "Exporting..." : "Export SRT"}</Button> : null}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="review-transcript-actions">
                {editingTranscript ? (
                  <>
                    <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={cancelTranscriptEdits} disabled={savingTranscript}>Cancel</Button>
                    <Button type="button" variant="primary" compact className="primary-button compact-button" onClick={() => void saveTranscriptCorrections()} disabled={savingTranscript}>{savingTranscript ? "Saving..." : "Save Transcript Edits"}</Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => setEditingTranscript(true)}>Edit</Button>
                    {onRerunTranscription ? <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => void onRerunTranscription()} disabled={rerunTranscriptionBusy}>Re-Run</Button> : null}
                  </>
                )}
              </div>
              <ScrollArea className="review-transcript-list">
                {transcriptDisplaySegments.length > 0 ? transcriptDisplaySegments.map((segment, index) => (
                  <article key={segment.id} className={`review-transcript-line${index === activeSegmentIndex ? " active" : ""}`}>
                    {editingTranscript ? (
                      <div className="review-transcript-edit-row">
                        <button type="button" className="review-transcript-seek" onClick={() => seekToSegment(segment)}>
                          <span className="review-transcript-time">{formatTranscriptTime((segment.startMs ?? 0) / 1000)}</span>
                          <span className="review-transcript-text">{segment.text}</span>
                        </button>
                        {typeof segment.startMs === "number" && typeof segment.endMs === "number" ? (
                          <div className="transcript-split-fields">
                            {(["start", "end"] as const).map((field) => (
                              <label className="editor-field" key={field}>
                                <span>{field === "start" ? "Start" : "End"} (seconds)</span>
                                <input
                                  className="editor-input"
                                  type="number"
                                  min={0}
                                  step={0.001}
                                  aria-label={`Segment ${index + 1} ${field} time in seconds`}
                                  value={draftTimes[segment.id]?.[field] ?? String((field === "start" ? segment.startMs! : segment.endMs!) / 1000)}
                                  onChange={(event) => updateSegmentTime(segment, field, event.target.value)}
                                  disabled={savingTranscript}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                        <textarea className="editor-textarea review-transcript-input" value={draftSegments.find((item) => item.id === segment.id)?.text ?? segment.text} onChange={(event) => setDraftSegments((current) => current.map((item) => item.id === segment.id ? { ...item, text: event.target.value } : item))} rows={2} />
                        {typeof segment.startMs === "number" && typeof segment.endMs === "number" ? (
                          splitDraft?.segmentId === segment.id ? (
                            <div className="transcript-split-editor" aria-label="Split transcript segment editor">
                              <div className="transcript-split-header">
                                <strong>Split at {formatTranscriptTime(splitDraft.splitAtMs / 1000)}</strong>
                                <span className="detail-meta">
                                  {formatTranscriptTime(segment.startMs / 1000)} - {formatTranscriptTime(segment.endMs / 1000)}
                                </span>
                              </div>
                              <label className="editor-field">
                                <span>Second segment start (seconds)</span>
                                <input
                                  className="editor-input"
                                  type="number"
                                  min={(segment.startMs + 1) / 1000}
                                  max={(segment.endMs - 1) / 1000}
                                  step={0.001}
                                  value={splitDraft.splitTimeSeconds}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    const splitAtMs = Math.round(Number(value) * 1000);
                                    updateSplitDraft({
                                      splitTimeSeconds: value,
                                      ...(value.trim() && Number.isFinite(splitAtMs) && splitAtMs > segment.startMs! && splitAtMs < segment.endMs!
                                        ? { splitAtMs }
                                        : {})
                                    });
                                  }}
                                />
                              </label>
                              <label className="editor-field">
                                <span>Split point</span>
                                <input
                                  className="editor-range"
                                  type="range"
                                  min={segment.startMs + 10}
                                  max={segment.endMs - 10}
                                  step={10}
                                  value={splitDraft.splitAtMs}
                                  aria-label="Split point in milliseconds"
                                  onChange={(event) => updateSplitDraft({ splitAtMs: Number(event.target.value) })}
                                />
                              </label>
                              <div className="detail-actions transcript-split-playhead-actions">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  compact
                                  className="secondary-button compact-button"
                                  onClick={() => updateSplitDraft({ splitAtMs: Math.min(segment.endMs! - 10, Math.max(segment.startMs! + 10, Math.round(currentTimeSeconds * 1000))) })}
                                  disabled={currentTimeSeconds * 1000 <= segment.startMs + 10 || currentTimeSeconds * 1000 >= segment.endMs - 10}
                                >
                                  Use playhead
                                </Button>
                                <span className="detail-meta">The split stays inside this segment.</span>
                              </div>
                              <div className="transcript-split-fields">
                                <label className="editor-field">
                                  <span>Before split</span>
                                  <textarea className="editor-textarea" value={splitDraft.beforeText} onChange={(event) => updateSplitDraft({ beforeText: event.target.value })} rows={2} />
                                </label>
                                <label className="editor-field">
                                  <span>After split</span>
                                  <textarea className="editor-textarea" value={splitDraft.afterText} onChange={(event) => updateSplitDraft({ afterText: event.target.value })} rows={2} />
                                </label>
                              </div>
                              <div className="detail-actions">
                                <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => setSplitDraft(null)}>Cancel split</Button>
                                <Button type="button" variant="primary" compact className="primary-button compact-button" onClick={applySplit}>Split segment</Button>
                              </div>
                            </div>
                          ) : (
                            <Button type="button" variant="secondary" compact className="secondary-button compact-button transcript-split-button" onClick={() => beginSplit(segment)}>
                              Split segment
                            </Button>
                          )
                        ) : (
                          <span className="detail-meta">Splitting is available for timed segments only.</span>
                        )}
                      </div>
                    ) : (
                      <button type="button" className="review-transcript-seek" onClick={() => seekToSegment(segment)}>
                        <span className="review-transcript-time">{formatTranscriptTime((segment.startMs ?? 0) / 1000)}</span>
                        <span className="review-transcript-text">{segment.text}</span>
                      </button>
                    )}
                  </article>
                )) : <p className="muted">This transcript has no timestamped segments yet.</p>}
              </ScrollArea>
              {editingTranscript && transcriptDisplaySegments.length === 0 ? (
                <label className="editor-field review-fallback-transcript">
                  <span>Transcript text</span>
                  <textarea className="editor-textarea" value={draftTranscriptText} onChange={(event) => setDraftTranscriptText(event.target.value)} rows={6} />
                </label>
              ) : null}
              <p className="detail-meta">{message ?? "Saved edits update the transcript used by metadata generation and SRT export."}</p>
            </>
          )}
        </>
      ) : (
        <div className="empty-state compact-empty-state">
          <h4>No transcript saved</h4>
          <p>{onRerunTranscription ? "Use Run above to prepare timestamped transcript lines for this source." : "Transcribe this clip before reviewing timestamped lines."}</p>
          {!onRerunTranscription && onOpenEdit ? <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onOpenEdit}>Open Edit</Button> : null}
        </div>
      )}
      {error ? <p className="inline-warning">{error}</p> : null}
    </Panel>
  );
}

function buildSrtContent(segments: TranscriptSegmentRecord[]): string {
  return segments
    .filter((segment) => typeof segment.startMs === "number" && typeof segment.endMs === "number" && segment.text.trim())
    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.startMs!)} --> ${formatSrtTimestamp(segment.endMs!)}\n${segment.text.trim()}`)
    .join("\n\n");
}

function formatSrtTimestamp(milliseconds: number): string {
  const totalMs = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function formatTranscriptTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
