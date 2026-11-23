import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type {
  ClipRecord,
  CollaboratorProfile,
  LongFormClipApprovalResult,
  LongFormClipProposalRecord,
  StackedVerticalLayoutSettings,
  TranscriptAssetRef,
  TranscriptRecord,
  TranscriptSegmentRecord,
  VerticalLayoutPreferences
  ,TranscriptAutoAssignScope
} from "../shared/contracts";
import { suggestClipFileName } from "../shared/clipFileName";
import { calculateStackedCrop, calculateStackedCropRect } from "../shared/stackedVerticalLayout";
import { buildTranscriptSegmentsFromSrt, normalizeTranscriptSegments } from "../shared/transcriptSegments";
import {
  CREATOR_SPEAKER_COLOR,
  CREATOR_SPEAKER_ID,
  CREATOR_SPEAKER_LABEL,
  normalizeSpeakerColorHex
} from "../shared/speakerProfiles";
import InfoTip from "./InfoTip";
import ProposalDecisionPanel from "./ProposalDecisionPanel";
import TimestampedTranscriptPanel from "./TimestampedTranscriptPanel";
import VideoPlayer from "./VideoPlayer";
import { Card, Panel, PanelHeader, StatusBadge } from "./WorkbenchPrimitives";

interface ReviewClipViewProps {
  id?: string;
  selectedClip: ClipRecord | null;
  selectedTranscript: TranscriptRecord | null;
  transcriptAsset?: TranscriptAssetRef | null;
  transcriptLoading: boolean;
  onTranscriptSaved: (transcript: TranscriptRecord) => void;
  onRerunTranscription?: () => void | Promise<void>;
  rerunTranscriptionBusy?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onOpenWorkspace: () => void;
  rightColumnTopContent?: JSX.Element | null;
  initialTrimRange?: { startMs: number; endMs: number } | null;
  onExportTrimmedCopy?: (startMs: number, endMs: number) => Promise<string | null>;
  onExportStackedVerticalCopy?: (
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings
  ) => Promise<string | null>;
  proposal?: LongFormClipProposalRecord | null;
  clipLibraryConfigured?: boolean;
  proposalActionBusy?: boolean;
  onApproveProposal?: (
    startMs: number,
    endMs: number,
    layout: StackedVerticalLayoutSettings,
    fileName: string
  ) => Promise<LongFormClipApprovalResult>;
  onRejectProposal?: (reason?: string) => Promise<LongFormClipProposalRecord>;
  onReopenProposal?: () => Promise<LongFormClipProposalRecord>;
  collaboratorProfiles?: CollaboratorProfile[];
  creatorVoiceSampleCount?: number;
  onAutoAssignSpeakers?: (scope: TranscriptAutoAssignScope) => void;
  onSaveCreatorVoiceSample?: (segment: TranscriptSegmentRecord) => void;
  onSaveCollaboratorVoiceSample?: (profileId: string, segment: TranscriptSegmentRecord) => void;
}

const VERTICAL_LAYOUT_STORAGE_KEY = "creator-workspace.vertical-layout-preferences";

function readSavedVerticalLayoutPreferences(): VerticalLayoutPreferences {
  const fallback: VerticalLayoutPreferences = {
    mode: "stacked",
    topFocusX: 0.5,
    topFocusY: 0.5,
    topScale: 1,
    bottomFocusX: 0.5,
    bottomFocusY: 0.5,
    bottomScale: 1
  };

  try {
    const stored = window.localStorage.getItem(VERTICAL_LAYOUT_STORAGE_KEY);
    if (!stored) {
      return fallback;
    }

    const parsed = JSON.parse(stored) as Partial<VerticalLayoutPreferences>;
    return {
      mode: parsed.mode === "single" ? "single" : "stacked",
      topFocusX: clampSavedLayoutValue(parsed.topFocusX, fallback.topFocusX, 0, 1),
      topFocusY: clampSavedLayoutValue(parsed.topFocusY, fallback.topFocusY, 0, 1),
      topScale: clampSavedLayoutValue(parsed.topScale, fallback.topScale, 0.25, 1),
      bottomFocusX: clampSavedLayoutValue(parsed.bottomFocusX, fallback.bottomFocusX, 0, 1),
      bottomFocusY: clampSavedLayoutValue(parsed.bottomFocusY, fallback.bottomFocusY, 0, 1),
      bottomScale: clampSavedLayoutValue(parsed.bottomScale, fallback.bottomScale, 0.25, 1)
    };
  } catch {
    return fallback;
  }
}

function clampSavedLayoutValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export default function ReviewClipView({
  id,
  selectedClip,
  selectedTranscript,
  transcriptAsset = null,
  transcriptLoading,
  onTranscriptSaved,
  onRerunTranscription,
  rerunTranscriptionBusy = false,
  onEditingChange,
  onSavingChange,
  onOpenWorkspace,
  rightColumnTopContent = null,
  initialTrimRange,
  onExportTrimmedCopy,
  onExportStackedVerticalCopy,
  proposal,
  clipLibraryConfigured = false,
  proposalActionBusy = false,
  onApproveProposal,
  onRejectProposal,
  onReopenProposal,
  collaboratorProfiles = [],
  creatorVoiceSampleCount = 0,
  onAutoAssignSpeakers,
  onSaveCreatorVoiceSample,
  onSaveCollaboratorVoiceSample
}: ReviewClipViewProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bottomVideoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState(0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [transcriptSeekRequest, setTranscriptSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);
  const [trimStartSeconds, setTrimStartSeconds] = useState(0);
  const [trimEndSeconds, setTrimEndSeconds] = useState(0);
  const [trimStartInput, setTrimStartInput] = useState("00:00:00.000");
  const [trimEndInput, setTrimEndInput] = useState("00:00:00.000");
  const [previewingTrim, setPreviewingTrim] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [draftTranscriptText, setDraftTranscriptText] = useState("");
  const [draftSegments, setDraftSegments] = useState<TranscriptSegmentRecord[]>([]);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [exportingTrim, setExportingTrim] = useState(false);
  const [exportingStackedVertical, setExportingStackedVertical] = useState(false);
  const [initialSavedLayout] = useState<VerticalLayoutPreferences>(() => readSavedVerticalLayoutPreferences());
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [verticalLayout, setVerticalLayout] = useState<"single" | "stacked">(() => initialSavedLayout.mode);
  const [topFocusX, setTopFocusX] = useState(() => initialSavedLayout.topFocusX);
  const [topFocusY, setTopFocusY] = useState(() => initialSavedLayout.topFocusY);
  const [topScale, setTopScale] = useState(() => initialSavedLayout.topScale);
  const [bottomFocusX, setBottomFocusX] = useState(() => initialSavedLayout.bottomFocusX);
  const [bottomFocusY, setBottomFocusY] = useState(() => initialSavedLayout.bottomFocusY);
  const [bottomScale, setBottomScale] = useState(() => initialSavedLayout.bottomScale);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [transcriptPanelMode, setTranscriptPanelMode] = useState<"transcript" | "speakers">("transcript");
  const [speakerReviewFilter, setSpeakerReviewFilter] = useState<"all" | "needs_review" | "unassigned">("all");

  useEffect(() => {
    let cancelled = false;

    async function hydrateLayoutPreferences(): Promise<void> {
      try {
        const saved = await window.creatorApp.getVerticalLayoutPreferences();
        if (cancelled) {
          return;
        }

        const preferences = saved ?? initialSavedLayout;
        setVerticalLayout(preferences.mode);
        setTopFocusX(preferences.topFocusX);
        setTopFocusY(preferences.topFocusY);
        setTopScale(preferences.topScale);
        setBottomFocusX(preferences.bottomFocusX);
        setBottomFocusY(preferences.bottomFocusY);
        setBottomScale(preferences.bottomScale);

        if (!saved) {
          void window.creatorApp.saveVerticalLayoutPreferences(preferences).catch(() => undefined);
        }
      } catch {
        // Keep the migrated renderer value if the app setting cannot be read.
      } finally {
        if (!cancelled) {
          setLayoutHydrated(true);
        }
      }
    }

    void hydrateLayoutPreferences();
    return () => {
      cancelled = true;
    };
  }, [initialSavedLayout]);

  const mediaUrl = selectedClip ? window.creatorApp.getLocalMediaUrl(selectedClip.sourcePath) : null;
  const sourceFrameRate = selectedClip?.frameRate && selectedClip.frameRate > 0 ? selectedClip.frameRate : 60;
  const frameDurationSeconds = 1 / sourceFrameRate;
  const frameRateLabel = selectedClip?.frameRate
    ? `${formatFrameRate(sourceFrameRate)} FPS`
    : "60 FPS assumed for this older record";
  const reviewSegments = useMemo(
    () => selectedTranscript
      ? normalizeTranscriptSegments(selectedTranscript.segments).length > 0
        ? normalizeTranscriptSegments(selectedTranscript.segments)
        : buildTranscriptSegmentsFromSrt(selectedTranscript.srtContent, selectedTranscript.textContent, selectedTranscript.segments)
      : [],
    [selectedTranscript?.id, selectedTranscript?.updatedAt]
  );
  const activeSegmentIndex = reviewSegments.findIndex((segment) => {
    if (typeof segment.startMs !== "number") {
      return false;
    }

    const startSeconds = segment.startMs / 1000;
    const endSeconds = typeof segment.endMs === "number" ? segment.endMs / 1000 : Number.POSITIVE_INFINITY;
    return currentTimeSeconds >= startSeconds && currentTimeSeconds < endSeconds;
  });
  useEffect(() => {
    setCurrentTimeSeconds(0);
    setTranscriptSeekRequest(null);
    setMediaDurationSeconds(selectedClip?.durationMs ? selectedClip.durationMs / 1000 : 0);
    setTrimStartSeconds(initialTrimRange ? initialTrimRange.startMs / 1000 : 0);
    setTrimEndSeconds(initialTrimRange?.endMs ? initialTrimRange.endMs / 1000 : selectedClip?.durationMs ? selectedClip.durationMs / 1000 : 0);
    setPreviewingTrim(Boolean(
      initialTrimRange &&
      initialTrimRange.endMs > initialTrimRange.startMs
    ));
    setEditingTranscript(false);
    setMessage(null);
    setError(null);
    setMediaError(null);
  }, [selectedClip?.id, initialTrimRange?.startMs, initialTrimRange?.endMs]);

  useEffect(() => {
    setDraftTranscriptText(selectedTranscript?.textContent ?? "");
    setDraftSegments(reviewSegments);
    setEditingTranscript(false);
  }, [selectedTranscript?.id, selectedTranscript?.updatedAt, reviewSegments]);

  useEffect(() => {
    if (!layoutHydrated) {
      return;
    }

    const preferences: VerticalLayoutPreferences = {
      mode: verticalLayout,
      topFocusX,
      topFocusY,
      topScale,
      bottomFocusX,
      bottomFocusY,
      bottomScale
    };

    try {
      window.localStorage.setItem(VERTICAL_LAYOUT_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Layout persistence is best-effort if renderer storage is unavailable.
    }

    const saveTimer = window.setTimeout(() => {
      void window.creatorApp.saveVerticalLayoutPreferences(preferences).catch(() => undefined);
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [layoutHydrated, verticalLayout, topFocusX, topFocusY, topScale, bottomFocusX, bottomFocusY, bottomScale]);

  useEffect(() => {
    setTrimStartInput(formatTrimInput(trimStartSeconds));
    setTrimEndInput(formatTrimInput(trimEndSeconds));
  }, [trimStartSeconds, trimEndSeconds]);

  function handleLoadedMetadata(): void {
    const duration = videoRef.current?.duration;
    if (!duration || !Number.isFinite(duration)) {
      return;
    }

    setMediaDurationSeconds(duration);
    setTrimEndSeconds((currentEnd) => (currentEnd > 0 ? Math.min(currentEnd, duration) : duration));
  }

  function handleMediaError(): void {
    setMediaError(`The source file for ${selectedClip?.displayName ?? "this clip"} could not be loaded. Check that it is available and supported, then try again.`);
  }

  function handleTimeUpdate(): void {
    const currentTime = videoRef.current?.currentTime ?? 0;
    setCurrentTimeSeconds(currentTime);

    if (verticalLayout === "stacked" && bottomVideoRef.current && Math.abs(bottomVideoRef.current.currentTime - currentTime) > 0.08) {
      bottomVideoRef.current.currentTime = currentTime;
    }

    if (previewingTrim && currentTime >= trimEndSeconds - 0.05) {
      if (videoRef.current && trimEndSeconds > trimStartSeconds) {
        videoRef.current.currentTime = trimStartSeconds;
        if (verticalLayout === "stacked" && bottomVideoRef.current) {
          bottomVideoRef.current.currentTime = trimStartSeconds;
        }
        setCurrentTimeSeconds(trimStartSeconds);
        void videoRef.current.play().catch(() => {
          setPreviewingTrim(false);
          setError("The selection loop could not continue playback.");
        });
      }
    }
  }

  function handleCompositionPlay(): void {
    if (verticalLayout === "stacked" && bottomVideoRef.current && videoRef.current) {
      bottomVideoRef.current.currentTime = videoRef.current.currentTime;
      void bottomVideoRef.current.play().catch(() => undefined);
    }
  }

  function handleCompositionPause(): void {
    bottomVideoRef.current?.pause();
    setPreviewingTrim(false);
  }

  function handleCompositionSeeking(): void {
    if (verticalLayout === "stacked" && bottomVideoRef.current && videoRef.current) {
      bottomVideoRef.current.currentTime = videoRef.current.currentTime;
    }
  }

  function seekToSegment(segment: TranscriptSegmentRecord): void {
    if (typeof segment.startMs !== "number") {
      return;
    }

    const nextTime = segment.startMs / 1000;
    setCurrentTimeSeconds(nextTime);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      void videoRef.current.play().catch(() => undefined);
    }
  }

  function seekToSeconds(nextTime: number): void {
    setCurrentTimeSeconds(nextTime);
    setTranscriptSeekRequest((current) => ({
      seconds: nextTime,
      nonce: (current?.nonce ?? 0) + 1
    }));
  }

  function assignSpeaker(segmentId: string, speakerId: string): void {
    setDraftSegments((currentSegments) =>
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

  function getVisibleSpeakerSegments(): TranscriptSegmentRecord[] {
    return draftSegments.filter((segment) => {
      if (speakerReviewFilter === "needs_review") {
        return segment.speakerReviewReason !== null || (segment.speakerConfidence !== null && segment.speakerConfidence < 0.72);
      }
      if (speakerReviewFilter === "unassigned") {
        return !segment.speakerId;
      }
      return true;
    });
  }

  function speakerName(speakerId: string | null): string {
    if (!speakerId) return "Unassigned";
    if (speakerId === CREATOR_SPEAKER_ID) return CREATOR_SPEAKER_LABEL;
    return collaboratorProfiles.find((profile) => profile.id === speakerId)?.displayName || "Unknown speaker";
  }

  function speakerAccentColor(speakerId: string | null): string | null {
    if (!speakerId) return null;
    if (speakerId === CREATOR_SPEAKER_ID) return CREATOR_SPEAKER_COLOR;

    const profile = collaboratorProfiles.find((candidate) => candidate.id === speakerId);
    return profile?.speakerColorHex ? normalizeSpeakerColorHex(profile.speakerColorHex) : null;
  }

  function renderSpeakerReview(): JSX.Element {
    const visibleSegments = getVisibleSpeakerSegments();
    const activeAutoAssignScope: TranscriptAutoAssignScope = speakerReviewFilter;
    const activeAutoAssignLabel = speakerReviewFilter === "all"
      ? "All"
      : speakerReviewFilter === "needs_review"
        ? "Needs review"
        : "Unassigned";
    return (
      <div className="speaker-review-mode">
        <div className="speaker-review-toolbar">
          <div className="view-toggle" role="tablist" aria-label="Speaker review filter">
            {(["all", "needs_review", "unassigned"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                className={speakerReviewFilter === filter ? "active" : ""}
                onClick={() => setSpeakerReviewFilter(filter)}
                role="tab"
                aria-selected={speakerReviewFilter === filter}
              >
                {filter === "all" ? "All" : filter === "needs_review" ? "Needs review" : "Unassigned"}
              </button>
            ))}
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => onAutoAssignSpeakers?.(activeAutoAssignScope)}
              disabled={!onAutoAssignSpeakers || draftSegments.length === 0}
            >
              Run {activeAutoAssignLabel}
            </button>
          </div>
        </div>
        <p className="detail-meta">Manual labels are authoritative. Low-confidence or unassigned segments remain visible until reviewed.</p>
        <div className="speaker-segment-list review-speaker-list">
          {visibleSegments.length === 0 ? <p className="muted">No segments match this review filter.</p> : visibleSegments.map((segment) => {
            const accentColor = speakerAccentColor(segment.speakerId);
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
                <span className="review-transcript-time">{formatReviewTime((segment.startMs ?? 0) / 1000)}</span>
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
                <span className={`status-pill ${segment.speakerReviewReason || !segment.speakerId ? "warning" : "success"}`}>
                  {segment.speakerReviewReason || !segment.speakerId ? "Needs review" : `${speakerName(segment.speakerId)} · ${segment.speakerConfidence !== null ? `${Math.round(segment.speakerConfidence * 100)}%` : "Manual"}`}
                </span>
              </div>
              {segment.speakerReviewReason ? <p className="detail-meta">{segment.speakerReviewReason}{segment.speakerAlternateSpeakerId ? ` Suggested alternative: ${speakerName(segment.speakerAlternateSpeakerId)}.` : ""}</p> : null}
              <div className="speaker-sample-actions">
                <button type="button" className="secondary-button compact-button" onClick={() => onSaveCreatorVoiceSample?.(segment)} disabled={!onSaveCreatorVoiceSample || segment.speakerId !== CREATOR_SPEAKER_ID}>Save You sample ({creatorVoiceSampleCount})</button>
                {collaboratorProfiles.map((profile) => (
                  <button key={profile.id} type="button" className="secondary-button compact-button" onClick={() => onSaveCollaboratorVoiceSample?.(profile.id, segment)} disabled={!onSaveCollaboratorVoiceSample || segment.speakerId !== profile.id}>Save {profile.displayName || "collaborator"} sample ({profile.voiceSamples.length})</button>
                ))}
              </div>
            </article>
            );
          })}
        </div>
        <p className="detail-meta">Save transcript after manual assignments to write the canonical timed transcript and derived SRT together.</p>
      </div>
    );
  }

  function updateTrimStart(value: number): void {
    setTrimStartSeconds(Math.min(value, Math.max(0, trimEndSeconds - 0.1)));
  }

  function updateTrimEnd(value: number): void {
    setTrimEndSeconds(Math.max(value, trimStartSeconds + 0.1));
  }

  function nudgeTrimStart(deltaSeconds: number): void {
    updateTrimStart(trimStartSeconds + deltaSeconds);
  }

  function nudgeTrimEnd(deltaSeconds: number): void {
    updateTrimEnd(trimEndSeconds + deltaSeconds);
  }

  function commitTrimStartInput(): void {
    const parsedSeconds = parseTrimInput(trimStartInput);
    if (parsedSeconds === null) {
      setError("Enter the trim start as HH:MM:SS.mmm, MM:SS.mmm, or seconds.");
      setTrimStartInput(formatTrimInput(trimStartSeconds));
      return;
    }

    setError(null);
    updateTrimStart(parsedSeconds);
  }

  function commitTrimEndInput(): void {
    const parsedSeconds = parseTrimInput(trimEndInput);
    if (parsedSeconds === null) {
      setError("Enter the trim end as HH:MM:SS.mmm, MM:SS.mmm, or seconds.");
      setTrimEndInput(formatTrimInput(trimEndSeconds));
      return;
    }

    setError(null);
    updateTrimEnd(parsedSeconds);
  }

  function handleTrimInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    commit: () => void
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  }

  function previewTrim(): void {
    if (mediaDurationSeconds <= 0 || trimEndSeconds <= trimStartSeconds) {
      setError("Set a valid trim range before previewing.");
      return;
    }

    setCurrentTimeSeconds(trimStartSeconds);
    setPreviewingTrim(true);
  }

  async function saveTranscriptCorrections(): Promise<void> {
    if (!selectedClip || !selectedTranscript) {
      return;
    }

    setSavingTranscript(true);
    setError(null);
    setMessage(null);

    try {
      const nextSegments = normalizeTranscriptSegments(draftSegments);
      const nextText = nextSegments.length > 0
        ? nextSegments.map((segment) => segment.text).join(" ").trim()
        : draftTranscriptText.trim();
      const nextSrt = nextSegments.some(
        (segment) => typeof segment.startMs === "number" && typeof segment.endMs === "number"
      )
        ? buildSrtContent(nextSegments)
        : selectedTranscript.srtContent;
      const updatedTranscript = await window.creatorApp.updateTranscript(
        selectedClip.id,
        nextText,
        nextSrt,
        nextSegments
      );
      onTranscriptSaved(updatedTranscript);
      setMessage(
        updatedTranscript.status === "incomplete"
          ? "Corrections are saved to the incomplete recovery transcript for review/export. Run a fresh transcription before treating it as canonical."
          : "Transcript corrections are saved as the canonical local transcript for later metadata and SRT work."
      );
      setEditingTranscript(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save transcript corrections.");
    } finally {
      setSavingTranscript(false);
    }
  }

  async function exportTrimmedCopy(): Promise<void> {
    if (!selectedClip || trimEndSeconds <= trimStartSeconds) {
      setError("Set a valid trim range before exporting.");
      return;
    }

    setExportingTrim(true);
    setError(null);
    setMessage(null);

    try {
      const outputPath = onExportTrimmedCopy
        ? await onExportTrimmedCopy(Math.round(trimStartSeconds * 1000), Math.round(trimEndSeconds * 1000))
        : await window.creatorApp.exportTrimmedClip(
            selectedClip.id,
            Math.round(trimStartSeconds * 1000),
            Math.round(trimEndSeconds * 1000)
          );
      if (outputPath) {
        setMessage(`Trimmed copy exported to ${outputPath}. The original source was not changed.`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to export the trimmed clip.");
    } finally {
      setExportingTrim(false);
    }
  }

  async function exportStackedVerticalCopy(): Promise<void> {
    if (!selectedClip || trimEndSeconds <= trimStartSeconds) {
      setError("Set a valid trim range before exporting.");
      return;
    }

    if (!selectedClip.widthPx || !selectedClip.heightPx) {
      setError("Stacked vertical export needs the source video dimensions. Re-import or inspect the source before exporting.");
      return;
    }

    setExportingStackedVertical(true);
    setError(null);
    setMessage(null);

    const layout: StackedVerticalLayoutSettings = {
      topFocusX,
      topFocusY,
      topScale,
      bottomFocusX,
      bottomFocusY,
      bottomScale
    };

    try {
      const outputPath = onExportStackedVerticalCopy
        ? await onExportStackedVerticalCopy(
            Math.round(trimStartSeconds * 1000),
            Math.round(trimEndSeconds * 1000),
            layout
          )
        : await window.creatorApp.exportStackedVerticalClip(
            selectedClip.id,
            Math.round(trimStartSeconds * 1000),
            Math.round(trimEndSeconds * 1000),
            layout
          );
      if (outputPath) {
        setMessage(`Stacked vertical copy exported to ${outputPath}. The original source was not changed.`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to export the stacked vertical clip.");
    } finally {
      setExportingStackedVertical(false);
    }
  }

  async function exportCurrentLayout(): Promise<void> {
    if (verticalLayout === "stacked") {
      await exportStackedVerticalCopy();
      return;
    }

    await exportTrimmedCopy();
  }

  async function approveProposal(fileName: string): Promise<void> {
    if (!proposal || !onApproveProposal) {
      return;
    }

    const recovery = proposal.approvalReceipt?.stage !== "completed" ? proposal.approvalReceipt : null;
    setError(null);
    setMessage(null);
    try {
      const result = await onApproveProposal(
        recovery?.startMs ?? Math.round(trimStartSeconds * 1000),
        recovery?.endMs ?? Math.round(trimEndSeconds * 1000),
        recovery?.layout ?? {
          topFocusX,
          topFocusY,
          topScale,
          bottomFocusX,
          bottomFocusY,
          bottomScale
        },
        recovery?.requestedFileName ?? fileName
      );
      setMessage(`Approved stacked vertical clip added to the clip library: ${result.outputPath}. The original source was not changed.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to approve the clip proposal.");
    }
  }

  async function rejectProposal(reason?: string): Promise<void> {
    if (!proposal || !onRejectProposal) {
      return;
    }

    setError(null);
    setMessage(null);
    try {
      await onRejectProposal(reason);
      setMessage("Clip proposal rejected. Any files or clips from an earlier approval attempt were preserved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to reject the clip proposal.");
      // Let the decision panel show the failure beside the button as well.
      throw nextError;
    }
  }

  if (!selectedClip) {
    return (
      <Panel className="panel review-clip-empty">
        <PanelHeader className="panel-header">
          <div>
            <p className="eyebrow">Make Clips</p>
            <h2>Open a source clip to begin review</h2>
            <p className="muted">Choose a long-form source, generate proposals, and approve a clip into the Edit workflow for transcript, metadata, and scheduling.</p>
          </div>
        </PanelHeader>
        <button type="button" className="primary-button" onClick={onOpenWorkspace}>Open Edit</button>
      </Panel>
    );
  }

  const duration = mediaDurationSeconds > 0 ? mediaDurationSeconds : 1;
  const hasTimedTranscript = reviewSegments.some((segment) => typeof segment.startMs === "number");
  return (
    <div className="review-clip-shell" id={id}>
      {error ? <div className="alert error">{error}</div> : null}
      {mediaError ? <div className="alert error">Video unavailable: {mediaError}</div> : null}
      {message ? <div className="info-banner success-banner"><strong>Review update</strong><p className="muted">{message}</p></div> : null}

      <section className="review-clip-grid">
        <Card className="panel review-video-panel">
          <PanelHeader className="panel-header">
            <div>
              <h3>{selectedClip.displayName}</h3>
              <p className="detail-meta">Original source. Playback is read-only; exports create a new file.</p>
            </div>
            <StatusBadge className="panel-badge" tone="info">{formatReviewTime(currentTimeSeconds)} / {formatReviewTime(mediaDurationSeconds)}</StatusBadge>
          </PanelHeader>
          <VideoPlayer
            displayName={selectedClip.displayName}
            sourcePath={selectedClip.sourcePath}
            durationMs={selectedClip.durationMs}
            widthPx={selectedClip.widthPx}
            heightPx={selectedClip.heightPx}
            frameRate={selectedClip.frameRate}
            previewMode={verticalLayout === "stacked" ? "vertical" : "source"}
            onPreviewModeChange={(mode) => setVerticalLayout(mode === "vertical" ? "stacked" : "single")}
            topFocusX={topFocusX}
            topFocusY={topFocusY}
            topScale={topScale}
            bottomFocusX={bottomFocusX}
            bottomFocusY={bottomFocusY}
            bottomScale={bottomScale}
            timelineRange={{ startSeconds: trimStartSeconds, endSeconds: trimEndSeconds }}
            loopRange={{ startSeconds: trimStartSeconds, endSeconds: trimEndSeconds, active: previewingTrim }}
            onLoopStateChange={setPreviewingTrim}
            onTimeChange={setCurrentTimeSeconds}
            seekRequest={transcriptSeekRequest}
            onDurationChange={(duration) => {
              setMediaDurationSeconds(duration);
              setTrimEndSeconds((currentEnd) => (currentEnd > 0 ? Math.min(currentEnd, duration) : duration));
            }}
          />
          <p className="detail-meta review-source-path">Source: {selectedClip.sourcePath}</p>
        </Card>

        <div className="review-side-column">
          {rightColumnTopContent}

          {proposal ? (
            <ProposalDecisionPanel
              proposal={proposal}
              clipLibraryConfigured={clipLibraryConfigured}
              proposalActionBusy={proposalActionBusy}
              canApprove={mediaDurationSeconds > 0 && trimEndSeconds > trimStartSeconds}
              suggestedFileName={suggestClipFileName(selectedClip.displayName, proposal.hook)}
              onApprove={approveProposal}
              onReject={rejectProposal}
              onReopen={onReopenProposal}
            />
          ) : null}

          <TimestampedTranscriptPanel
          clipId={selectedClip.id}
          transcriptAsset={transcriptAsset}
          selectedTranscript={selectedTranscript}
          transcriptLoading={transcriptLoading}
          currentTimeSeconds={currentTimeSeconds}
          onSeekToSeconds={seekToSeconds}
          onTranscriptSaved={onTranscriptSaved}
          onRerunTranscription={onRerunTranscription}
          rerunTranscriptionBusy={rerunTranscriptionBusy}
          onEditingChange={onEditingChange}
          onSavingChange={onSavingChange}
          onOpenEdit={onOpenWorkspace}
          collaboratorProfiles={collaboratorProfiles}
          creatorVoiceSampleCount={creatorVoiceSampleCount}
          onAutoAssignSpeakers={onAutoAssignSpeakers}
          onSaveCreatorVoiceSample={onSaveCreatorVoiceSample}
          onSaveCollaboratorVoiceSample={onSaveCollaboratorVoiceSample}
          />
        {false ? (
        <article className="panel review-transcript-panel">
          <div className="panel-header">
            <div>
              <div className="title-with-tip"><h3>Transcript</h3><InfoTip label="Transcript controls">Click a line to seek the video. The highlighted line follows playback, and saved corrections become the trusted local transcript.</InfoTip></div>
              <p className="detail-meta">Click a line to seek the video. The highlighted line follows playback.</p>
            </div>
            {selectedTranscript ? <span className="panel-badge">Canonical local copy</span> : null}
          </div>

          <div className="transcript-mode-tabs" role="tablist" aria-label="Transcript review mode">
            <button type="button" className={transcriptPanelMode === "transcript" ? "active" : ""} onClick={() => setTranscriptPanelMode("transcript")} role="tab" aria-selected={transcriptPanelMode === "transcript"}>Transcript</button>
            <button type="button" className={transcriptPanelMode === "speakers" ? "active" : ""} onClick={() => setTranscriptPanelMode("speakers")} role="tab" aria-selected={transcriptPanelMode === "speakers"}>Speaker review</button>
          </div>

          {transcriptLoading ? <p className="muted">Loading transcript...</p> : selectedTranscript ? (
            <>
              {selectedTranscript!.status === "incomplete" ? (
                <div className="info-banner warning-banner">
                  <strong>Incomplete recovery transcript</strong>
                  <p className="muted">This saved partial SRT is reviewable and exportable, but is not canonical. A future transcription must restart from the beginning.</p>
                </div>
              ) : null}
              {transcriptPanelMode === "speakers" ? renderSpeakerReview() : <>
              <div className="review-transcript-actions">
                {editingTranscript ? (
                  <>
                    <button type="button" className="secondary-button compact-button" onClick={() => { setDraftSegments(reviewSegments); setDraftTranscriptText(selectedTranscript!.textContent); setEditingTranscript(false); }} disabled={savingTranscript}>Cancel</button>
                    <button type="button" className="primary-button compact-button" onClick={() => void saveTranscriptCorrections()} disabled={savingTranscript}>{savingTranscript ? "Saving..." : "Save Canonical Corrections"}</button>
                  </>
                ) : (
                  <button type="button" className="secondary-button compact-button" onClick={() => setEditingTranscript(true)}>Edit Transcript</button>
                )}
              </div>
              <div className="review-transcript-list">
                {reviewSegments.length > 0 ? reviewSegments.map((segment, index) => (
                  <article key={segment.id} className={`review-transcript-line${index === activeSegmentIndex ? " active" : ""}`}>
                    {editingTranscript ? (
                      <div className="review-transcript-edit-row">
                        <button type="button" className="review-transcript-seek" onClick={() => seekToSegment(segment)}>
                          <span className="review-transcript-time">{formatReviewTime((segment.startMs ?? 0) / 1000)}</span>
                          <span className="review-transcript-text">{segment.text}</span>
                        </button>
                        <textarea className="editor-textarea review-transcript-input" value={draftSegments[index]?.text ?? segment.text} onChange={(event) => setDraftSegments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} rows={2} />
                      </div>
                    ) : (
                      <button type="button" className="review-transcript-seek" onClick={() => seekToSegment(segment)}>
                        <span className="review-transcript-time">{formatReviewTime((segment.startMs ?? 0) / 1000)}</span>
                        <span className="review-transcript-text">{segment.text}</span>
                      </button>
                    )}
                  </article>
                )) : (
                  <p className="muted">This transcript has no timestamped segments yet.</p>
                )}
              </div>
              {editingTranscript && reviewSegments.length === 0 ? (
                <label className="editor-field review-fallback-transcript">
                  <span>Canonical transcript text</span>
                  <textarea className="editor-textarea" value={draftTranscriptText} onChange={(event) => setDraftTranscriptText(event.target.value)} rows={6} />
                </label>
              ) : null}
              <p className="detail-meta">Saved corrections become the trusted local transcript used by later metadata generation and SRT export.</p>
              </>}
            </>
          ) : (
            <div className="empty-state compact-empty-state">
              <h4>No transcript saved</h4>
              <p>Transcribe this clip in Edit before reviewing timestamped lines.</p>
              <button type="button" className="secondary-button compact-button" onClick={onOpenWorkspace}>Open Edit</button>
            </div>
          )}
        </article>
        ) : null}
        <Panel className="panel review-trim-panel">
         <PanelHeader className="panel-header">
           <div>
             <div className="title-with-tip"><h3>Trim</h3><InfoTip label="Trim behavior">Trim markers never change the original source. Preview loops the selected range, and exports create a separate copy without overwriting the source.</InfoTip></div>
           </div>
           <StatusBadge className="panel-badge" tone="info">{formatReviewTime(trimEndSeconds - trimStartSeconds)} selection</StatusBadge>
         </PanelHeader>
        <div className="review-trim-actions review-trim-actions-top">
          <button type="button" className="secondary-button" onClick={previewTrim} disabled={mediaDurationSeconds <= 0 || trimEndSeconds <= trimStartSeconds}>Preview</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void exportCurrentLayout()}
            disabled={exportingTrim || exportingStackedVertical || mediaDurationSeconds <= 0 || trimEndSeconds <= trimStartSeconds || (verticalLayout === "stacked" && (!selectedClip.widthPx || !selectedClip.heightPx))}
          >
            {exportingTrim || exportingStackedVertical ? "Exporting..." : "Export"}
          </button>
        </div>
        <details className="review-layout-controls">
          <summary className="review-zoom-summary">
            <span className="title-with-tip">
              <h4>Vertical output layout</h4>
              <InfoTip label="Vertical layout">Stacked uses two independently framed sections from the same source and exports a 1080 x 1920 MP4. Your last layout and framing are saved locally and reused for the next clip.</InfoTip>
            </span>
            <span className="panel-badge">{verticalLayout === "stacked" ? "Stacked vertical" : "Source view"}</span>
          </summary>
          <div className="review-layout-content">
            <label className="editor-field review-layout-select">
              <span>Preview layout</span>
              <select className="editor-input" value={verticalLayout} onChange={(event) => setVerticalLayout(event.target.value as "single" | "stacked")}>
                <option value="single">Original horizontal</option>
                <option value="stacked">Stacked vertical</option>
              </select>
            </label>
            {verticalLayout === "stacked" ? (
              selectedClip.widthPx && selectedClip.heightPx ? (
                <div className="review-focus-grid">
                  <CropSelector
                    title="Top section"
                    sourceUrl={mediaUrl ?? undefined}
                    sourceWidth={selectedClip.widthPx}
                    sourceHeight={selectedClip.heightPx}
                    focusX={topFocusX}
                    focusY={topFocusY}
                    scale={topScale}
                    onFocusXChange={setTopFocusX}
                    onFocusYChange={setTopFocusY}
                    onScaleChange={setTopScale}
                  />
                  <CropSelector
                    title="Bottom section"
                    sourceUrl={mediaUrl ?? undefined}
                    sourceWidth={selectedClip.widthPx}
                    sourceHeight={selectedClip.heightPx}
                    focusX={bottomFocusX}
                    focusY={bottomFocusY}
                    scale={bottomScale}
                    onFocusXChange={setBottomFocusX}
                    onFocusYChange={setBottomFocusY}
                    onScaleChange={setBottomScale}
                  />
                </div>
              ) : (
                <p className="inline-warning">This source has no stored video dimensions. Re-import or inspect it before using stacked export.</p>
              )
            ) : null}
          </div>
        </details>
        <div className="review-trim-controls">
          <label className="review-range-control">
            <span>Start <strong>{formatReviewTime(trimStartSeconds)}</strong></span>
            <input type="range" min={0} max={duration} step={frameDurationSeconds} value={Math.min(trimStartSeconds, duration)} onChange={(event) => updateTrimStart(Number(event.target.value))} disabled={mediaDurationSeconds <= 0} />
            <input
              type="text"
              className="editor-input review-time-input"
              value={trimStartInput}
              inputMode="decimal"
              aria-label="Exact trim start time"
              onChange={(event) => setTrimStartInput(event.target.value)}
              onBlur={commitTrimStartInput}
              onKeyDown={(event) => handleTrimInputKeyDown(event, commitTrimStartInput)}
              disabled={mediaDurationSeconds <= 0}
            />
            <span className="review-marker-stepper" aria-label="Adjust trim start in five second steps">
              <TrimStepButton direction="back" label="5s" title="Move trim start back 5 seconds" onClick={() => nudgeTrimStart(-5)} disabled={mediaDurationSeconds <= 0 || trimStartSeconds <= 0} />
              <TrimStepButton direction="back" label="1s" title="Move trim start back 1 second" onClick={() => nudgeTrimStart(-1)} disabled={mediaDurationSeconds <= 0 || trimStartSeconds <= 0} />
              <TrimStepButton direction="back" label="F" title="Move trim start back one frame" onClick={() => nudgeTrimStart(-frameDurationSeconds)} disabled={mediaDurationSeconds <= 0 || trimStartSeconds <= 0} />
              <TrimStepButton direction="forward" label="F" title="Move trim start forward one frame" onClick={() => nudgeTrimStart(frameDurationSeconds)} disabled={mediaDurationSeconds <= 0 || trimStartSeconds >= trimEndSeconds - frameDurationSeconds} />
              <TrimStepButton direction="forward" label="1s" title="Move trim start forward 1 second" onClick={() => nudgeTrimStart(1)} disabled={mediaDurationSeconds <= 0 || trimStartSeconds >= trimEndSeconds - 0.1} />
              <TrimStepButton direction="forward" label="5s" title="Move trim start forward 5 seconds" onClick={() => nudgeTrimStart(5)} disabled={mediaDurationSeconds <= 0 || trimStartSeconds >= trimEndSeconds - 0.1} />
            </span>
          </label>
          <label className="review-range-control">
            <span>End <strong>{formatReviewTime(trimEndSeconds)}</strong></span>
            <input type="range" min={0} max={duration} step={frameDurationSeconds} value={Math.min(trimEndSeconds || duration, duration)} onChange={(event) => updateTrimEnd(Number(event.target.value))} disabled={mediaDurationSeconds <= 0} />
            <input
              type="text"
              className="editor-input review-time-input"
              value={trimEndInput}
              inputMode="decimal"
              aria-label="Exact trim end time"
              onChange={(event) => setTrimEndInput(event.target.value)}
              onBlur={commitTrimEndInput}
              onKeyDown={(event) => handleTrimInputKeyDown(event, commitTrimEndInput)}
              disabled={mediaDurationSeconds <= 0}
            />
            <span className="review-marker-stepper" aria-label="Adjust trim end in five second steps">
              <TrimStepButton direction="back" label="5s" title="Move trim end back 5 seconds" onClick={() => nudgeTrimEnd(-5)} disabled={mediaDurationSeconds <= 0 || trimEndSeconds <= trimStartSeconds + 0.1} />
              <TrimStepButton direction="back" label="1s" title="Move trim end back 1 second" onClick={() => nudgeTrimEnd(-1)} disabled={mediaDurationSeconds <= 0 || trimEndSeconds <= trimStartSeconds + 0.1} />
              <TrimStepButton direction="back" label="F" title="Move trim end back one frame" onClick={() => nudgeTrimEnd(-frameDurationSeconds)} disabled={mediaDurationSeconds <= 0 || trimEndSeconds <= trimStartSeconds + frameDurationSeconds} />
              <TrimStepButton direction="forward" label="F" title="Move trim end forward one frame" onClick={() => nudgeTrimEnd(frameDurationSeconds)} disabled={mediaDurationSeconds <= 0 || trimEndSeconds >= mediaDurationSeconds} />
              <TrimStepButton direction="forward" label="1s" title="Move trim end forward 1 second" onClick={() => nudgeTrimEnd(1)} disabled={mediaDurationSeconds <= 0 || trimEndSeconds >= mediaDurationSeconds} />
              <TrimStepButton direction="forward" label="5s" title="Move trim end forward 5 seconds" onClick={() => nudgeTrimEnd(5)} disabled={mediaDurationSeconds <= 0 || trimEndSeconds >= mediaDurationSeconds} />
            </span>
          </label>
        </div>
        {!hasTimedTranscript && selectedTranscript ? <p className="inline-warning">This transcript is available for correction, but its current SRT has no usable timestamps for timeline seeking.</p> : null}
        </Panel>
      </div>
      </section>
    </div>
  );
}

interface CropSelectorProps {
  title: string;
  sourceUrl?: string;
  sourceWidth: number;
  sourceHeight: number;
  focusX: number;
  focusY: number;
  scale: number;
  onFocusXChange: (value: number) => void;
  onFocusYChange: (value: number) => void;
  onScaleChange: (value: number) => void;
}

interface CropInteraction {
  mode: "move" | "resize";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLeft: number;
  startTop: number;
  startScale: number;
  rectWidth: number;
  rectHeight: number;
}

function CropSelector({
  title,
  sourceUrl,
  sourceWidth,
  sourceHeight,
  focusX,
  focusY,
  scale,
  onFocusXChange,
  onFocusYChange,
  onScaleChange
}: CropSelectorProps): JSX.Element {
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<CropInteraction | null>(null);
  const baseCrop = calculatePreviewCrop(sourceWidth, sourceHeight);
  const geometry = getCropGeometry(baseCrop, sourceWidth, sourceHeight, scale, focusX, focusY);

  function beginInteraction(event: PointerEvent<HTMLElement>, mode: CropInteraction["mode"]): void {
    const selector = selectorRef.current;
    if (!selector) {
      return;
    }

    const rect = selector.getBoundingClientRect();
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: geometry.left,
      startTop: geometry.top,
      startScale: scale,
      rectWidth: rect.width,
      rectHeight: rect.height
    };
    selector.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updateInteraction(event: PointerEvent<HTMLDivElement>): void {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = (event.clientX - interaction.startClientX) / interaction.rectWidth;
    const deltaY = (event.clientY - interaction.startClientY) / interaction.rectHeight;
    if (interaction.mode === "move") {
      const nextLeft = clamp(interaction.startLeft + deltaX, 0, 1 - geometry.width);
      const nextTop = clamp(interaction.startTop + deltaY, 0, 1 - geometry.height);
      onFocusXChange(normalizeFocus(nextLeft, geometry.width));
      onFocusYChange(normalizeFocus(nextTop, geometry.height));
      return;
    }

    const scaleDelta = Math.max(
      deltaX * sourceWidth / baseCrop.widthPx,
      deltaY * sourceHeight / baseCrop.heightPx
    );
    const nextScale = clamp(interaction.startScale + scaleDelta, 0.25, 1);
    const nextGeometry = getCropGeometry(baseCrop, sourceWidth, sourceHeight, nextScale, focusX, focusY);
    const nextLeft = clamp(interaction.startLeft, 0, 1 - nextGeometry.width);
    const nextTop = clamp(interaction.startTop, 0, 1 - nextGeometry.height);
    onScaleChange(nextScale);
    onFocusXChange(normalizeFocus(nextLeft, nextGeometry.width));
    onFocusYChange(normalizeFocus(nextTop, nextGeometry.height));
  }

  function endInteraction(event: PointerEvent<HTMLDivElement>): void {
    if (interactionRef.current?.pointerId !== event.pointerId) {
      return;
    }

    selectorRef.current?.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
  }

  return (
    <section className="review-focus-card">
      <div className="review-focus-card-header">
        <strong>{title}</strong>
        <span className="detail-meta">{Math.round(scale * 100)}% crop</span>
      </div>
      <div
        ref={selectorRef}
        className="review-crop-selector"
        style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}
        onPointerMove={updateInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        {sourceUrl ? <video className="review-crop-source" src={sourceUrl} muted preload="metadata" aria-hidden="true" /> : null}
        <div
          className="review-crop-box"
          style={{
            left: `${geometry.left * 100}%`,
            top: `${geometry.top * 100}%`,
            width: `${geometry.width * 100}%`,
            height: `${geometry.height * 100}%`
          }}
          onPointerDown={(event) => beginInteraction(event, "move")}
        >
          <span className="review-crop-box-label">Drag to move</span>
          <button
            type="button"
            className="review-crop-resize-handle"
            aria-label={`Resize ${title} crop`}
            onPointerDown={(event) => {
              event.stopPropagation();
              beginInteraction(event, "resize");
            }}
          />
        </div>
      </div>
      <div className="review-crop-actions">
        <span className="detail-meta">Drag the frame to position it; drag the corner to zoom.</span>
        <button type="button" className="secondary-button compact-button" onClick={() => { onFocusXChange(0.5); onFocusYChange(0.5); onScaleChange(1); }}>Reset</button>
      </div>
    </section>
  );
}

function calculatePreviewCrop(sourceWidth: number, sourceHeight: number): { widthPx: number; heightPx: number } {
  return calculateStackedCrop(sourceWidth, sourceHeight);
}

function getCropGeometry(
  baseCrop: { widthPx: number; heightPx: number },
  sourceWidth: number,
  sourceHeight: number,
  scale: number,
  focusX: number,
  focusY: number
): { left: number; top: number; width: number; height: number } {
  const cropRect = calculateStackedCropRect(sourceWidth, sourceHeight, scale, focusX, focusY);
  return {
    left: cropRect.xPx / sourceWidth,
    top: cropRect.yPx / sourceHeight,
    width: cropRect.widthPx / sourceWidth,
    height: cropRect.heightPx / sourceHeight
  };
}

function normalizeFocus(position: number, size: number): number {
  return size >= 1 ? 0.5 : clamp(position / (1 - size), 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTrimInput(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function parseTrimInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(":");
  if (parts.length > 3) {
    return null;
  }

  const seconds = Number(parts[parts.length - 1]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  let totalSeconds = seconds;
  if (parts.length >= 2) {
    const minutes = Number(parts[parts.length - 2]);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 60) {
      return null;
    }
    totalSeconds += minutes * 60;
  }

  if (parts.length === 3) {
    const hours = Number(parts[0]);
    if (!Number.isFinite(hours) || hours < 0) {
      return null;
    }
    totalSeconds += hours * 3600;
  }

  return totalSeconds;
}

function formatFrameRate(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

interface TrimStepButtonProps {
  direction: "back" | "forward";
  label: "5s" | "1s" | "F";
  title: string;
  onClick: () => void;
  disabled: boolean;
}

function TrimStepButton({ direction, label, title, onClick, disabled }: TrimStepButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="player-step-button trim-step-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <span className="player-step-icon">{direction === "back" ? "\u21ba" : "\u21bb"}</span>
      <span>{label}</span>
    </button>
  );
}

function formatReviewTime(seconds: number): string {
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
