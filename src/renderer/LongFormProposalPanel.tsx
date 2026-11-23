import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  ClipProposalGenerationResult,
  LongFormClipProposalRecord,
  LongFormSourceRecord,
  TranscriptRecord,
  TranscriptionProgress
} from "../shared/contracts";
import {
  CLIP_PROPOSAL_FILTERS,
  countClipProposalsByFilter,
  filterClipProposals,
  type ClipProposalFilter
} from "../shared/clipProposalPresentation";
import InfoTip from "./InfoTip";
import { Button, Panel, PanelHeader, ScrollArea, SegmentedTabs, StatusBadge } from "./WorkbenchPrimitives";

const CLIP_PROPOSAL_FILTER_STORAGE_KEY = "creator-workbench.clip-proposals.filter";

function isClipProposalFilter(value: string | null): value is ClipProposalFilter {
  return value === "all" || value === "unreviewed" || value === "approved" || value === "rejected";
}

function readStoredClipProposalFilter(): ClipProposalFilter {
  try {
    const stored = window.localStorage.getItem(CLIP_PROPOSAL_FILTER_STORAGE_KEY);
    return isClipProposalFilter(stored) ? stored : "unreviewed";
  } catch {
    return "unreviewed";
  }
}

interface LongFormProposalPanelProps {
  sources: LongFormSourceRecord[];
  selectedSource: LongFormSourceRecord | null;
  transcript: TranscriptRecord | null;
  proposals: LongFormClipProposalRecord[];
  selectedProposalId: string | null;
  generationResult: ClipProposalGenerationResult | null;
  importing: boolean;
  transcribing: boolean;
  generating: boolean;
  cancellingGeneration: boolean;
  generationMessage: string | null;
  transcriptionProgress: TranscriptionProgress | null;
  recoveringPartial: boolean;
  onImport: () => void;
  onSelectSource: (sourceId: string) => void;
  onGenerate: () => void;
  onCancelGeneration: () => void;
  onCancelTranscription: () => void;
  onSavePartial: () => void;
  onDiscardPartial: () => void;
  onOpenProposal: (proposal: LongFormClipProposalRecord) => void;
}

export default function LongFormProposalPanel({
  sources,
  selectedSource,
  transcript,
  proposals,
  selectedProposalId,
  generationResult,
  importing,
  transcribing,
  generating,
  cancellingGeneration,
  generationMessage,
  transcriptionProgress,
  recoveringPartial,
  onImport,
  onSelectSource,
  onGenerate,
  onCancelGeneration,
  onCancelTranscription,
  onSavePartial,
  onDiscardPartial,
  onOpenProposal
}: LongFormProposalPanelProps): JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeFilter, setActiveFilter] = useState<ClipProposalFilter>(() => readStoredClipProposalFilter());
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);

  useEffect(() => {
    if (transcriptionProgress?.status !== "running") {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [transcriptionProgress?.status, transcriptionProgress?.startedAt]);

  useEffect(() => {
    setSearchQuery("");
    setExpandedProposalId(null);
  }, [selectedSource?.id]);

  const isTranscribing = transcriptionProgress?.status === "running" || transcribing;
  const elapsedMs = transcriptionProgress
    ? Math.max(transcriptionProgress.elapsedMs, nowMs - new Date(transcriptionProgress.startedAt).getTime())
    : 0;
  const transcriptReady = Boolean(transcript && transcript.status !== "incomplete");
  const proposalCounts = countClipProposalsByFilter(proposals);
  const visibleProposals = filterClipProposals(proposals, activeFilter, searchQuery);
  const proposalIndexes = new Map(proposals.map((proposal, index) => [proposal.id, index]));

  function handleFilterChange(filter: ClipProposalFilter): void {
    setActiveFilter(filter);
    try {
      window.localStorage.setItem(CLIP_PROPOSAL_FILTER_STORAGE_KEY, filter);
    } catch {
      // Local UI preference is optional and must not interrupt proposal review.
    }
  }

  function handleOpenProposalCard(proposal: LongFormClipProposalRecord): void {
    if (expandedProposalId === proposal.id) {
      setExpandedProposalId(null);
      return;
    }
    setExpandedProposalId(proposal.id);
    onOpenProposal(proposal);
  }

  function handleProposalKeyDown(event: KeyboardEvent<HTMLElement>, proposal: LongFormClipProposalRecord): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    handleOpenProposalCard(proposal);
  }

  return (
    <Panel className="panel long-form-proposal-panel" id="long-form-proposal-panel">
      <PanelHeader className="panel-header">
        <div>
          <div className="title-with-tip">
            <h2>Clip Proposals</h2>
            <InfoTip label="How clip discovery works">Import a long recording, prepare its timed transcript, then ask the assigned local AI for candidate ranges. Nothing is published or overwritten automatically.</InfoTip>
          </div>
        </div>
        <StatusBadge className="panel-badge" tone="info">{proposals.length} proposals</StatusBadge>
      </PanelHeader>

      <div className="long-form-source-controls">
        <div className="long-form-source-control-row">
          <label className="review-clip-selector">
            <select
              aria-label="Long-form source"
              className="editor-input"
              value={selectedSource?.id ?? ""}
              onChange={(event) => onSelectSource(event.target.value)}
            >
              <option value="">Select a source</option>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.displayName}</option>)}
            </select>
            {selectedSource ? <span className="long-form-source-path">{selectedSource.sourcePath}</span> : null}
          </label>
          <div className="long-form-source-actions">
            {isTranscribing ? <Button type="button" variant="danger" className="danger-button" onClick={onCancelTranscription}>Cancel Transcription</Button> : null}
            <Button type="button" variant="secondary" className="secondary-button" onClick={onImport} disabled={importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button type="button" variant={generating ? "danger" : "primary"} className={generating ? "danger-button" : "primary-button"} onClick={generating ? onCancelGeneration : onGenerate} disabled={generating ? cancellingGeneration : !transcriptReady}>
              {generating ? (cancellingGeneration ? "Cancelling..." : "Cancel Search") : "Find Clips"}
            </Button>
          </div>
        </div>
        {selectedSource ? (
          <div className="long-form-source-status">
            <strong>{selectedSource.displayName}</strong>
            {generating ? <span>Searching transcript windows and analysing media. New proposals are saved only after the search completes.</span> : null}
          </div>
        ) : null}
      </div>
      {transcript?.status === "incomplete" ? (
        <p className="inline-warning">A partial transcript is available for review/export only. Run a fresh transcription before generating proposals.</p>
      ) : null}

      {generationMessage ? (
        <div className="info-banner warning-banner">
          <strong>{generationMessage}</strong>
          <p className="muted">Existing proposals were left unchanged. You can start the search again when ready.</p>
        </div>
      ) : null}

      {transcriptionProgress ? (
        <div className={`info-banner ${transcriptionProgress.status === "failed" ? "warning-banner" : transcriptionProgress.status === "completed" ? "success-banner" : ""}`}>
          <PanelHeader className="panel-header">
            <div>
              <strong>{formatTranscriptionPhase(transcriptionProgress.phase, transcriptionProgress.status)}</strong>
              <p className="muted">{transcriptionProgress.detail}</p>
              <p className="detail-meta">
                Elapsed {formatElapsed(elapsedMs)}{transcriptionProgress.percent !== null ? ` - ${transcriptionProgress.percent}% complete` : " - Progress is being measured without a percentage for this phase"}
              </p>
              <p className="detail-meta">{formatEta(transcriptionProgress)}</p>
              {transcriptionProgress.errorMessage ? <p className="inline-warning">{transcriptionProgress.errorMessage}</p> : null}
            </div>
          </PanelHeader>
          {transcriptionProgress.status === "cancelled" ? (
            <div className="connection-actions">
              <p className="muted">
                {transcriptionProgress.recoveryDetail ?? "The cancelled run left no recoverable transcript."}
                {" "}Resume is not available with the current Whisper output mode; a future run must restart from the beginning.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="secondary-button"
                onClick={onSavePartial}
                disabled={!transcriptionProgress.recoveryAvailable || recoveringPartial}
              >
                {recoveringPartial ? "Saving Partial..." : "Save Recoverable Partial"}
              </Button>
              <Button type="button" variant="secondary" className="secondary-button" onClick={onDiscardPartial} disabled={recoveringPartial}>
                Discard Partial Data
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {generationResult ? (
        <div className={`info-banner ${generationResult.executionMode === "ai" && !generationResult.issueSummary ? "success-banner" : "warning-banner"}`}>
          <strong>
            {generationResult.executionMode === "fallback"
              ? "Fallback proposals generated"
              : generationResult.issueSummary
                ? "AI proposals generated with review warnings"
                : "AI proposals generated"}
          </strong>
          <p className="muted">
            {generationResult.profileName ? `Profile: ${generationResult.profileName}. ` : ""}
            {generationResult.model ? `Model: ${generationResult.model}. ` : ""}
            {generationResult.issueSummary ?? generationResult.note ?? "Review each range before export."}
          </p>
        </div>
      ) : null}

      {proposals.length > 0 ? (
        <>
          <div className="long-form-proposal-filters">
            <SegmentedTabs className="queued-posts-tabs long-form-proposal-tabs" role="tablist" aria-label="Clip proposal status">
              {CLIP_PROPOSAL_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`queued-posts-tab${activeFilter === filter.id ? " active" : ""}`}
                  role="tab"
                  aria-selected={activeFilter === filter.id}
                  aria-controls="long-form-proposal-tabpanel"
                  tabIndex={activeFilter === filter.id ? 0 : -1}
                  onClick={() => handleFilterChange(filter.id)}
                >
                  {filter.label}
                  <span className="queued-posts-tab-count">{proposalCounts[filter.id]}</span>
                </button>
              ))}
            </SegmentedTabs>
            <label className="long-form-proposal-search">
              <span className="sr-only">Search clip proposals</span>
              <input
                type="search"
                className="editor-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search titles or reasoning"
                aria-label="Search clip proposals"
              />
            </label>
          </div>
          <div id="long-form-proposal-tabpanel" role="tabpanel" className="long-form-proposal-tabpanel">
            {visibleProposals.length > 0 ? (
              <ScrollArea className="long-form-proposal-list">
                {visibleProposals.map((proposal) => {
                  const isSelected = proposal.id === selectedProposalId;
                  const isExpanded = proposal.id === expandedProposalId;
                  const candidateNumber = (proposalIndexes.get(proposal.id) ?? 0) + 1;
                  const detailsId = `long-form-proposal-details-${proposal.id}`;
                  return (
                    <article
                      className={`long-form-proposal-card${isSelected ? " selected" : ""}${isExpanded ? " expanded" : ""}`}
                      key={proposal.id}
                      role="button"
                      tabIndex={0}
                      aria-current={isSelected ? "true" : undefined}
                      aria-expanded={isExpanded}
                      aria-controls={detailsId}
                      onClick={() => handleOpenProposalCard(proposal)}
                      onKeyDown={(event) => handleProposalKeyDown(event, proposal)}
                    >
                      <div className="long-form-proposal-card-summary">
                        <h3>Candidate {candidateNumber}: {proposal.hook}</h3>
                        <span className={`proposal-status-pill ${proposal.status}`}>{formatProposalStatus(proposal.status)}</span>
                      </div>
                      {isExpanded ? (
                        <div id={detailsId} className="long-form-proposal-card-details">
                          {proposal.rejectionReason ? <p className="detail-meta">Rejection note: {proposal.rejectionReason}</p> : null}
                          <p className="detail-meta">{formatProposalTime(proposal.startMs)} - {formatProposalTime(proposal.endMs)} · Confidence {Math.round(proposal.confidence * 100)}%</p>
                          <p className="muted proposal-reason">{proposal.reason}</p>
                          {proposal.analysis ? (
                            <div className="long-form-proposal-evidence">
                              <span className="proposal-evidence-label">Media evidence</span>
                              <span>{formatAnalysisDb(proposal.analysis.audioPeakDb)} audio peak</span>
                              <span>{formatAnalysisPercent(proposal.analysis.silenceRatio, true)} silent</span>
                              <span>{proposal.analysis.sceneChangeCount ?? "-"} scene changes</span>
                              <span>{proposal.analysis.visualScore === null ? "Visual review unavailable" : `Visual ${Math.round(proposal.analysis.visualScore * 100)}%`}</span>
                              {proposal.analysis.visualEvidence ? (
                                <>
                                  <span>Action/reaction {formatVisualScore(proposal.analysis.visualEvidence.actionReactionScore)}</span>
                                  <span>Clarity/context {formatVisualScore(proposal.analysis.visualEvidence.visualClarityContextScore)}</span>
                                  <span>Scene change {formatVisualScore(proposal.analysis.visualEvidence.sceneChangeScore)}</span>
                                  <span>On-screen importance {formatVisualScore(proposal.analysis.visualEvidence.onScreenImportanceScore)}</span>
                                </>
                              ) : null}
                              {proposal.analysis.visualModel ? <span>Vision model: {proposal.analysis.visualModel}</span> : null}
                            </div>
                          ) : null}
                          {proposal.analysis?.visualSummary ? <p className="detail-meta">Visual review: {proposal.analysis.visualSummary}</p> : null}
                          {proposal.analysis?.visualEvidence?.evidence.length ? (
                            <p className="detail-meta">Visible evidence: {proposal.analysis.visualEvidence.evidence.join(" ")}</p>
                          ) : null}
                          {proposal.analysis?.visualEvidence?.limitations.length ? (
                            <p className="detail-meta">Visual limits: {proposal.analysis.visualEvidence.limitations.join(" ")}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </ScrollArea>
            ) : (
              <div className="empty-state compact">
                <h3>No matching proposals</h3>
                <p>{searchQuery.trim() ? "Try a different search." : "There are no proposals in this view yet."}</p>
              </div>
            )}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function formatTranscriptionPhase(phase: TranscriptionProgress["phase"], status: TranscriptionProgress["status"]): string {
  if (status === "completed") return "Transcript ready";
  if (status === "failed") return "Transcription failed";
  if (status === "cancelled") return "Transcription cancelled";
  return phase === "preparing" ? "Preparing transcription" : phase === "extracting" ? "Extracting audio" : phase === "transcribing" ? "Transcribing audio" : "Saving transcript";
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatEta(progress: TranscriptionProgress): string {
  if (progress.etaBasis === "measured" && progress.etaMs !== null) {
    return `Estimated remaining: ${formatElapsed(progress.etaMs)} (measured from extraction progress)`;
  }
  if (progress.etaBasis === "approximate" && progress.etaRangeMs) {
    return `Approximate remaining: ${formatElapsed(progress.etaRangeMs.minMs)}-${formatElapsed(progress.etaRangeMs.maxMs)}; estimate varies by model, device, and source content`;
  }
  return "Estimated remaining: unavailable for this phase";
}

function formatProposalTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatProposalStatus(status: LongFormClipProposalRecord["status"]): string {
  return status === "proposed" ? "Awaiting review" : status === "approved" ? "Approved" : "Rejected";
}

function formatAnalysisDb(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)} dB`;
}

function formatAnalysisPercent(value: number | null, invert = false): string {
  if (value === null) {
    return "-";
  }
  const percentage = Math.round((invert ? value : 1 - value) * 100);
  return `${percentage}%`;
}

function formatVisualScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}
