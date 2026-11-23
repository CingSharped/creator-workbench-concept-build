import { useEffect, useState } from "react";
import { useEditingSession } from "../useEditingSession";
import { isWorkflowCancellation, unwrapWorkflowOutcome } from "../../shared/workflowOutcome";
import type {
  ClipProposalGenerationResult,
  CreatorAppApi,
  LongFormClipProposalRecord,
  LongFormSourceRecord,
  TranscriptRecord,
  TranscriptionProgress
} from "../../shared/contracts";

export type MakeApi = Pick<CreatorAppApi,
  "onTranscriptionProgress" | "getLongFormTranscript" | "listLongFormClipProposals" |
  "importLongFormSource" | "transcribeLongFormSource" | "cancelLongFormTranscription" |
  "saveLongFormPartialTranscript" | "discardLongFormPartialTranscript" |
  "generateLongFormClipProposals" | "cancelLongFormClipProposals"> &
  Partial<Pick<CreatorAppApi, "executeActionOutcome">>;

interface MakeWorkflowOptions {
  onError: (message: string | null) => void;
  onSourceImported: () => void;
  api?: MakeApi;
}

function isExpectedCancellation(error: unknown, expectedMessage: string): boolean {
  if (isWorkflowCancellation(error)) return true;
  if (!(error instanceof Error)) return false;
  // IPC invoke rejections wrap the service's message, sometimes once per channel.
  let message = error.message;
  const remotePrefix = /^Error invoking remote method '[^']+': Error: /;
  while (remotePrefix.test(message)) {
    message = message.replace(remotePrefix, "");
  }
  return message === expectedMessage;
}

/** Owns long-form preparation and discovery; navigation and library adoption stay in the shell. */
export function useMakeWorkflow({ onError: setError, onSourceImported, api = window.creatorApp }: MakeWorkflowOptions) {
  const [longFormSources, setLongFormSources] = useState<LongFormSourceRecord[]>([]);
  const [selectedLongFormSourceId, setSelectedLongFormSourceId] = useState<string | null>(null);
  const [selectedLongFormTranscript, setSelectedLongFormTranscript] = useState<TranscriptRecord | null>(null);
  const [longFormTranscriptionProgress, setLongFormTranscriptionProgress] = useState<TranscriptionProgress | null>(null);
  const [recoveringLongFormPartial, setRecoveringLongFormPartial] = useState(false);
  const [longFormProposals, setLongFormProposals] = useState<LongFormClipProposalRecord[]>([]);
  const [longFormProposalResult, setLongFormProposalResult] = useState<ClipProposalGenerationResult | null>(null);
  const [importingLongFormSource, setImportingLongFormSource] = useState(false);
  const [transcribingLongFormSource, setTranscribingLongFormSource] = useState(false);
  const [generatingLongFormProposals, setGeneratingLongFormProposals] = useState(false);
  const [cancellingLongFormProposals, setCancellingLongFormProposals] = useState(false);
  const [longFormProposalMessage, setLongFormProposalMessage] = useState<string | null>(null);
  const [selectedLongFormProposalId, setSelectedLongFormProposalId] = useState<string | null>(null);
  const session = useEditingSession(selectedLongFormSourceId);
  const selectedLongFormSource = longFormSources.find((source) => source.id === selectedLongFormSourceId) ?? null;

  useEffect(() => {
    const ticket = session.capture();
    const unsubscribe = api.onTranscriptionProgress((progress) => {
      if (!session.owns(ticket) || progress.sourceId !== selectedLongFormSourceId) {
        return;
      }
      setLongFormTranscriptionProgress(progress);
      if (progress.status === "completed" || progress.status === "failed" || progress.status === "cancelled") {
        setTranscribingLongFormSource(false);
      }
    });

    return unsubscribe;
  }, [selectedLongFormSourceId]);

  useEffect(() => {
    let cancelled = false;
    const ticket = session.capture();
    setSelectedLongFormTranscript(null);
    setLongFormProposals([]);
    setLongFormProposalResult(null);
    setLongFormProposalMessage(null);
    setTranscribingLongFormSource(false);
    setLongFormTranscriptionProgress(null);
    setGeneratingLongFormProposals(false);
    setCancellingLongFormProposals(false);
    setRecoveringLongFormPartial(false);
    setImportingLongFormSource(false);
    async function loadLongFormSelection(): Promise<void> {
      if (!selectedLongFormSourceId) {
        setSelectedLongFormTranscript(null);
        setLongFormProposals([]);
        setLongFormProposalResult(null);
        setLongFormProposalMessage(null);
        setLongFormTranscriptionProgress(null);
        return;
      }
      try {
        const [transcript, proposals] = await Promise.all([
          api.getLongFormTranscript(selectedLongFormSourceId),
          api.listLongFormClipProposals(selectedLongFormSourceId)
        ]);
        if (!cancelled && session.current(ticket)) {
          setSelectedLongFormTranscript(transcript);
          setLongFormProposals(proposals);
          setLongFormProposalResult(null);
          setLongFormTranscriptionProgress(null);
        }
      } catch (nextError) {
        if (!cancelled && session.current(ticket)) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load the long-form source.");
        }
      }
    }
    void loadLongFormSelection();
    return () => {
      cancelled = true;
    };
  }, [selectedLongFormSourceId]);

  async function handleImportLongFormSource(): Promise<void> {
    const ticket = session.begin("import", false);
    setImportingLongFormSource(true);
    setError(null);
    try {
      const source = await api.importLongFormSource();
      if (source) {
        setLongFormSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
        if (!session.accepts(ticket)) return;
        session.select(source.id);
        setSelectedLongFormSourceId(source.id);
        setSelectedLongFormProposalId(null);
        setLongFormTranscriptionProgress(null);
        onSourceImported();
      }
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to import the long-form source.");
    } finally {
      if (session.latest(ticket)) setImportingLongFormSource(false);
    }
  }

  async function handleTranscribeLongFormSource(): Promise<void> {
    if (!selectedLongFormSource) return;
    const ticket = session.begin("source-content", true);
    setTranscribingLongFormSource(false);
    setGeneratingLongFormProposals(false);
    setRecoveringLongFormPartial(false);
    setTranscribingLongFormSource(true);
    setLongFormTranscriptionProgress(null);
    setError(null);
    try {
      const transcript = api.executeActionOutcome
        ? unwrapWorkflowOutcome(await api.executeActionOutcome<TranscriptRecord>(
            "long_form.transcribe", { sourceId: selectedLongFormSource.id }, { confirmed: true }
          ))
        : await api.transcribeLongFormSource(selectedLongFormSource.id);
      if (!session.accepts(ticket)) return;
      setSelectedLongFormTranscript(transcript);
      setLongFormProposalResult(null);
      setLongFormProposals([]);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      if (!isExpectedCancellation(nextError, "Process cancelled.")) {
        setError(nextError instanceof Error ? nextError.message : "Failed to prepare the long-form transcript.");
      }
    } finally {
      if (session.latest(ticket)) setTranscribingLongFormSource(false);
    }
  }

  async function handleCancelLongFormTranscription(): Promise<void> {
    if (!selectedLongFormSource) return;
    const ticket = session.begin("cancel-transcription", false);
    const cancelled = await api.cancelLongFormTranscription(selectedLongFormSource.id);
    if (!cancelled && session.current(ticket)) {
      setTranscribingLongFormSource(false);
      setError("No active transcription was found for this source.");
    }
  }

  async function handleSaveLongFormPartial(): Promise<void> {
    if (!selectedLongFormSource) return;
    const ticket = session.begin("source-content", true);
    setTranscribingLongFormSource(false);
    setGeneratingLongFormProposals(false);
    setRecoveringLongFormPartial(false);
    setRecoveringLongFormPartial(true);
    setError(null);
    try {
      const transcript = await api.saveLongFormPartialTranscript(selectedLongFormSource.id);
      if (!session.accepts(ticket)) return;
      setSelectedLongFormTranscript(transcript);
      setLongFormTranscriptionProgress(null);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "No valid partial transcript could be saved.");
    } finally {
      if (session.latest(ticket)) setRecoveringLongFormPartial(false);
    }
  }

  async function handleDiscardLongFormPartial(): Promise<void> {
    if (!selectedLongFormSource) return;
    const ticket = session.begin("source-content", true);
    setTranscribingLongFormSource(false);
    setGeneratingLongFormProposals(false);
    setRecoveringLongFormPartial(false);
    setRecoveringLongFormPartial(true);
    setError(null);
    try {
      await api.discardLongFormPartialTranscript(selectedLongFormSource.id);
      if (!session.accepts(ticket)) return;
      setLongFormTranscriptionProgress(null);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to discard partial transcription data.");
    } finally {
      if (session.latest(ticket)) setRecoveringLongFormPartial(false);
    }
  }

  async function handleGenerateLongFormProposals(): Promise<void> {
    if (!selectedLongFormSource || !selectedLongFormTranscript) return;
    const ticket = session.begin("source-content", true);
    setTranscribingLongFormSource(false);
    setGeneratingLongFormProposals(false);
    setRecoveringLongFormPartial(false);
    setGeneratingLongFormProposals(true);
    setLongFormProposalMessage(null);
    setError(null);
    try {
      const result = api.executeActionOutcome
        ? unwrapWorkflowOutcome(await api.executeActionOutcome<ClipProposalGenerationResult>(
            "long_form.generate_proposals", { sourceId: selectedLongFormSource.id }, { confirmed: true }
          ))
        : await api.generateLongFormClipProposals(selectedLongFormSource.id);
      if (!session.accepts(ticket)) return;
      setLongFormProposalResult(result);
      setLongFormProposals(result.proposals);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      if (isExpectedCancellation(nextError, "Clip proposal generation cancelled.")) {
        setLongFormProposalMessage("Clip search cancelled.");
      } else {
        setError(nextError instanceof Error ? nextError.message : "Failed to generate long-form clip proposals.");
      }
    } finally {
      if (session.latest(ticket)) setGeneratingLongFormProposals(false);
    }
  }

  async function handleCancelLongFormProposals(): Promise<void> {
    if (!selectedLongFormSource) return;
    const ticket = session.begin("cancel-search", false);
    setCancellingLongFormProposals(true);
    setError(null);
    try {
      const cancelled = await api.cancelLongFormClipProposals(selectedLongFormSource.id);
      if (!cancelled && session.current(ticket)) {
        setLongFormProposalMessage("No clip search is currently running.");
      }
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to cancel clip proposal generation.");
    } finally {
      if (session.latest(ticket)) setCancellingLongFormProposals(false);
    }
  }

  function clearSelection(): void {
    session.select(null);
    setSelectedLongFormSourceId(null);
    setSelectedLongFormProposalId(null);
    setSelectedLongFormTranscript(null);
    setLongFormProposals([]);
    setLongFormProposalResult(null);
    setLongFormTranscriptionProgress(null);
  }

  function updateProposal(updated: LongFormClipProposalRecord): void {
    setLongFormProposals((current) => current.map((proposal) => proposal.id === updated.id ? updated : proposal));
  }

  function selectSource(id: string | null): void {
    session.select(id);
    setSelectedLongFormSourceId(id);
  }
  const renderTicket = session.capture();
  function saveTranscript(transcript: TranscriptRecord | null): void {
    if (!session.current(renderTicket)) return;
    session.edit();
    setSelectedLongFormTranscript(transcript);
  }

  return {
    sourceSession: session,
    sources: longFormSources, replaceSources: setLongFormSources,
    selectedSourceId: selectedLongFormSourceId, selectSource,
    selectedProposalId: selectedLongFormProposalId, selectProposal: setSelectedLongFormProposalId,
    transcript: selectedLongFormTranscript, saveTranscript,
    progress: longFormTranscriptionProgress, recoveringPartial: recoveringLongFormPartial,
    proposals: longFormProposals, result: longFormProposalResult, message: longFormProposalMessage,
    importing: importingLongFormSource, transcribing: transcribingLongFormSource,
    generating: generatingLongFormProposals, cancelling: cancellingLongFormProposals,
    importSource: handleImportLongFormSource, transcribe: handleTranscribeLongFormSource,
    cancelTranscription: handleCancelLongFormTranscription,
    savePartial: handleSaveLongFormPartial, discardPartial: handleDiscardLongFormPartial,
    generateProposals: handleGenerateLongFormProposals, cancelSearch: handleCancelLongFormProposals,
    clearSelection, updateProposal
  };
}
