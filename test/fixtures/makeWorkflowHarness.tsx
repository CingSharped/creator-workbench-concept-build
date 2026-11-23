import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useMakeWorkflow, type MakeApi } from "../../src/renderer/make/useMakeWorkflow";
import type { WorkflowOutcome } from "../../src/shared/workflowOutcome";
import type { LongFormSourceRecord, LongFormClipProposalRecord, TranscriptRecord, TranscriptionProgress } from "../../src/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Options = Parameters<typeof useMakeWorkflow>[0];
let workflow: ReturnType<typeof useMakeWorkflow>;
let options: Options;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let calls: Array<{ method: string; id?: string }>;
let errors: Array<string | null>;
let imported: number;
let listeners: Set<(progress: TranscriptionProgress) => void>;
const source = (id: string) => ({ id, displayName: `Source ${id}`, sourcePath: `${id}.mp4` }) as LongFormSourceRecord;
const transcript = (id: string, status: "complete" | "incomplete" = "complete") => ({ id: `transcript-${id}`, assetId: id, status, textContent: `Words for ${id}`, segments: [] }) as unknown as TranscriptRecord;
const proposal = (id: string, sourceId = "a") => ({ id, sourceId, status: "proposed", hook: `Moment ${id}` }) as LongFormClipProposalRecord;
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  expect(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function Harness(): null { workflow = useMakeWorkflow(options); return null; }
async function setup(): Promise<void> {
  calls = []; errors = []; imported = 0; listeners = new Set();
  const api: MakeApi = {
    onTranscriptionProgress: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getLongFormTranscript: async id => { calls.push({ method: "transcript", id }); return transcript(id); },
    listLongFormClipProposals: async id => { calls.push({ method: "proposals", id }); return [proposal(`${id}-one`, id)]; },
    importLongFormSource: async () => { calls.push({ method: "import" }); return source("a"); },
    transcribeLongFormSource: async id => { calls.push({ method: "transcribe", id }); return transcript(id); },
    cancelLongFormTranscription: async id => { calls.push({ method: "cancel-transcription", id }); return true; },
    saveLongFormPartialTranscript: async id => { calls.push({ method: "save-partial", id }); return transcript(id, "incomplete"); },
    discardLongFormPartialTranscript: async id => { calls.push({ method: "discard-partial", id }); },
    generateLongFormClipProposals: async id => { calls.push({ method: "find", id }); return {
      sourceId: id, proposals: [proposal("generated", id)], model: "Fixture model", profileId: null, profileName: null,
      executionMode: "ai", issueSummary: "One window had no proposals", note: null
    }; },
    cancelLongFormClipProposals: async id => { calls.push({ method: "cancel-search", id }); return true; }
  };
  options = { onError: message => errors.push(message), onSourceImported: () => { imported++; }, api };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<React.StrictMode><Harness /></React.StrictMode>));
}
async function select(id = "a"): Promise<void> {
  await act(async () => { workflow.replaceSources([source("a"), source("b")]); workflow.selectSource(id); });
}
async function progress(sourceId: string, status: TranscriptionProgress["status"]): Promise<void> {
  await act(async () => listeners.forEach(listener => listener({ sourceId, status, phase: "transcribing", percent: 50 } as TranscriptionProgress)));
}
const cases: Array<[string, () => Promise<void>]> = [
  ["initial state does not load or start work and selection loads existing artifacts", async () => {
    equal(calls, [], "No initial requests");
    equal(workflow.sources, [], "No sources until shell supplies them");
    await select();
    equal(calls, [{ method: "transcript", id: "a" }, { method: "proposals", id: "a" }], "Read selected source");
    equal(workflow.transcript?.id, "transcript-a", "Selected transcript");
    equal(workflow.proposals[0].sourceId, "a", "Selected proposals");
    expect(!calls.some(call => call.method === "find" || call.method === "transcribe"), "Selection cannot start AI/media work");
  }],
  ["source import deduplicates the list and delegates opening Make to the shell", async () => {
    await select();
    await act(async () => workflow.importSource());
    equal(workflow.sources.map(item => item.id), ["a", "b"], "Imported source does not duplicate");
    equal(workflow.selectedSourceId, "a", "Imported source selected");
    equal(imported, 1, "Shell navigation callback");
    expect(!workflow.importing, "Import flag cleared");
    options.api!.importLongFormSource = async () => null;
    await act(async () => workflow.importSource());
    equal(imported, 1, "Cancelled file picker does not navigate");
  }],
  ["transcription exposes busy/progress and success replaces discovery inputs", async () => {
    await select();
    const pending = deferred<TranscriptRecord>();
    options.api!.transcribeLongFormSource = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.transcribe(); });
    expect(workflow.transcribing, "Transcription busy");
    await progress("b", "running"); equal(workflow.progress, null, "Other-source progress ignored");
    await progress("a", "running"); equal(workflow.progress?.percent, 50, "Own-source progress displayed");
    await act(async () => { pending.resolve(transcript("new-a")); await request; });
    equal(workflow.transcript?.id, "transcript-new-a", "New transcript applied");
    equal(workflow.proposals, [], "Old proposals cleared");
    equal(workflow.result, null, "Old generation result cleared");
    expect(!workflow.transcribing, "Transcription flag cleared");
  }],
  ["transcription cancellation and terminal progress preserve existing error behaviour", async () => {
    await select();
    options.api!.transcribeLongFormSource = async () => { throw new Error("Process cancelled."); };
    await act(async () => workflow.transcribe());
    expect(!errors.some(Boolean), "Expected cancellation is not reported as failure");
    await act(async () => workflow.cancelTranscription());
    expect(calls.some(call => call.method === "cancel-transcription" && call.id === "a"), "Cancel targets selected source");
    options.api!.cancelLongFormTranscription = async () => false;
    await act(async () => workflow.cancelTranscription());
    equal(errors.at(-1), "No active transcription was found for this source.", "Missing active process message");
    await progress("a", "cancelled");
    expect(!workflow.transcribing, "Terminal event clears busy state");
  }],
  ["partial recovery saves incomplete transcripts and discard preserves the saved transcript", async () => {
    await select(); await progress("a", "running");
    await act(async () => workflow.savePartial());
    equal(workflow.transcript?.status, "incomplete", "Partial remains incomplete");
    equal(workflow.progress, null, "Recovery clears progress");
    const saved = workflow.transcript;
    await act(async () => workflow.discardPartial());
    equal(workflow.transcript, saved, "Discarding recovery data does not erase canonical transcript");
    expect(!workflow.recoveringPartial, "Recovery flag cleared");
  }],
  ["clip search retains proposals, warnings and profile result then clears busy state", async () => {
    await select();
    await act(async () => workflow.generateProposals());
    equal(workflow.proposals[0].id, "generated", "Generated proposals applied");
    equal(workflow.result?.issueSummary, "One window had no proposals", "Review warning retained");
    expect(!workflow.generating, "Search flag cleared");
    expect(calls.some(call => call.method === "find" && call.id === "a"), "Search targets source");
  }],
  ["clip-search cancellation and idle cancellation retain their user messages", async () => {
    await select();
    options.api!.generateLongFormClipProposals = async () => { throw new Error("Clip proposal generation cancelled."); };
    await act(async () => workflow.generateProposals());
    equal(workflow.message, "Clip search cancelled.", "Cancelled search message");
    expect(!errors.some(Boolean), "Cancelled search does not become an error");
    options.api!.cancelLongFormClipProposals = async () => false;
    await act(async () => workflow.cancelSearch());
    equal(workflow.message, "No clip search is currently running.", "Idle cancellation message");
    expect(!workflow.cancelling, "Cancellation flag cleared");
  }],
  ["Electron-wrapped cancellation reports normal completion of cancellation without a global error", async () => {
    await select();
    const existingProposals = workflow.proposals;
    let reject!: (error: Error) => void;
    const requestPromise = new Promise<never>((_resolve, rejectRequest) => { reject = rejectRequest; });
    options.api!.generateLongFormClipProposals = () => requestPromise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.generateProposals(); });
    expect(workflow.generating, "Search running before cancellation");
    await act(async () => workflow.cancelSearch());
    expect(calls.some(call => call.method === "cancel-search" && call.id === "a"), "Cancel targets active source");
    await act(async () => {
      reject(new Error("Error invoking remote method 'app:action': Error: Clip proposal generation cancelled."));
      await request;
    });
    equal(workflow.message, "Clip search cancelled.", "Transport-wrapped cancellation shown as status");
    expect(!errors.some(Boolean), "No global error banner");
    expect(!workflow.generating && !workflow.cancelling, "Busy flags cleared");
    equal(workflow.proposals, existingProposals, "Existing proposals preserved");
    options.api!.transcribeLongFormSource = async () => {
      throw new Error("Error invoking remote method 'app:action': Error: Process cancelled.");
    };
    await act(async () => workflow.transcribe());
    expect(!errors.some(Boolean), "Wrapped transcription cancellation is also expected");
    expect(!workflow.transcribing, "Transcription busy cleared");
  }],
  ["cancellation recognition is exact after IPC unwrapping and cannot hide real failures", async () => {
    await select();
    options.api!.generateLongFormClipProposals = async () => {
      throw new Error("Error invoking remote method 'long-form:proposals:generate': Error: Error invoking remote method 'app:action': Error: Clip proposal generation cancelled.");
    };
    await act(async () => workflow.generateProposals());
    equal(workflow.message, "Clip search cancelled.", "Nested wrapper accepted");
    expect(!errors.some(Boolean), "Nested cancellation is not a failure");
    for (const message of [
      "Error invoking remote method 'app:action': Error: Model unavailable.",
      "Cancellation failed: Clip proposal generation cancelled.",
      "Error invoking remote method 'app:action': Error: Clip proposal generation cancelled. Cleanup failed."
    ]) {
      options.api!.generateLongFormClipProposals = async () => { throw new Error(message); };
      await act(async () => workflow.generateProposals());
      equal(errors.at(-1), message, "Genuine error kept");
      equal(workflow.message, null, "Failure not presented as cancellation");
    }
  }],
  ["structured outcomes preserve cancellation through the renderer bridge without message matching", async () => {
    await select();
    let outcome: WorkflowOutcome<unknown> = {
      status: "completed", value: { sourceId: "a", proposals: [proposal("structured")] }
    };
    options.api!.generateLongFormClipProposals = async () => { throw new Error("Legacy route must not run"); };
    options.api!.executeActionOutcome = async <T,>(actionId: string, input: unknown, settings?: { confirmed?: boolean }) => {
      expect(actionId === "long_form.generate_proposals" || actionId === "long_form.transcribe", "Canonical action");
      equal(input, { sourceId: "a" }, "Selected source supplied");
      expect(settings?.confirmed, "Confirmation policy retained");
      return JSON.parse(JSON.stringify(outcome)) as WorkflowOutcome<T>;
    };
    await act(async () => workflow.generateProposals());
    equal(workflow.proposals[0].id, "structured", "Structured completion applied");
    outcome = { status: "cancelled", message: "Stopped at the user's request" };
    await act(async () => workflow.generateProposals());
    equal(workflow.message, "Clip search cancelled.", "Typed cancellation ignores wording");
    expect(!errors.some(Boolean), "No error banner");
    await act(async () => workflow.transcribe());
    expect(!errors.some(Boolean), "Typed transcription cancellation is expected too");
    outcome = { status: "failed", message: "Cancellation could not stop a failed process" };
    await act(async () => workflow.generateProposals());
    equal(errors.at(-1), outcome.message, "Failed outcome remains a failure");
    expect(!workflow.generating && !workflow.transcribing, "Busy cleared");
  }],
  ["source operations cannot replace another source's transcript or proposals", async () => {
    for (const operation of ["transcribe", "save-partial", "find", "discard"] as const) {
      await select("a");
      const pending = deferred<any>();
      options.api!.transcribeLongFormSource = () => pending.promise;
      options.api!.saveLongFormPartialTranscript = () => pending.promise;
      options.api!.generateLongFormClipProposals = () => pending.promise;
      options.api!.discardLongFormPartialTranscript = () => pending.promise;
      let request!: Promise<void>;
      await act(async () => {
        request = operation === "transcribe" ? workflow.transcribe()
          : operation === "save-partial" ? workflow.savePartial()
          : operation === "find" ? workflow.generateProposals() : workflow.discardPartial();
      });
      await select("b");
      await act(async () => {
        pending.resolve(operation === "find" ? { sourceId: "a", proposals: [proposal("late", "a")] } : transcript("a"));
        await request;
      });
      equal(workflow.transcript?.id, "transcript-b", operation + ": B transcript retained");
      equal(workflow.proposals[0].sourceId, "b", operation + ": B proposals retained");
      expect(!workflow.transcribing && !workflow.generating && !workflow.recoveringPartial, operation + ": no abandoned busy state");
    }
    expect(!errors.some(Boolean), "No unrelated failure banners");
  }],
  ["returning to a source does not let its previous search clear or overwrite a newer search", async () => {
    await select("a");
    const first = deferred<any>(), second = deferred<any>();
    options.api!.generateLongFormClipProposals = () => first.promise;
    let firstRequest!: Promise<void>, secondRequest!: Promise<void>;
    await act(async () => { firstRequest = workflow.generateProposals(); });
    const oldSaveCallback = workflow.saveTranscript;
    await select("b"); await select("a");
    options.api!.generateLongFormClipProposals = () => second.promise;
    await act(async () => { secondRequest = workflow.generateProposals(); });
    await act(async () => {
      first.resolve({ sourceId: "a", proposals: [proposal("abandoned")] });
      await firstRequest;
      oldSaveCallback(transcript("old-visit"));
    });
    expect(workflow.generating, "New search stays busy");
    equal(workflow.transcript?.id, "transcript-a", "Old transcript callback ignored");
    expect(!workflow.proposals.some(item => item.id === "abandoned"), "Old results ignored");
    await act(async () => { second.resolve({ sourceId: "a", proposals: [proposal("current")] }); await secondRequest; });
    equal(workflow.proposals[0].id, "current", "New search result accepted");
    expect(!workflow.generating, "Current search finishes");
  }],
  ["saving a source transcript invalidates an older in-flight search", async () => {
    await select();
    const pending = deferred<any>();
    options.api!.generateLongFormClipProposals = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.generateProposals(); });
    await act(async () => workflow.saveTranscript(transcript("edited")));
    await act(async () => { pending.resolve({ sourceId: "a", proposals: [proposal("obsolete")] }); await request; });
    equal(workflow.transcript?.id, "transcript-edited", "Edited transcript retained");
    expect(!workflow.proposals.some(item => item.id === "obsolete"), "Search using old transcript ignored");
    expect(!workflow.generating, "Busy cleared even when newer edits invalidate result");
  }],
  ["late selection reads cannot replace the newly selected source", async () => {
    const pending = deferred<TranscriptRecord>();
    const original = options.api!.getLongFormTranscript;
    options.api!.getLongFormTranscript = id => id === "a" ? pending.promise : original(id);
    await select("a"); await select("b");
    equal(workflow.transcript?.id, "transcript-b", "New source loaded");
    await act(async () => pending.resolve(transcript("a")));
    equal(workflow.transcript?.id, "transcript-b", "Abandoned read ignored");
    equal(workflow.proposals[0].sourceId, "b", "New proposals retained");
  }],
  ["approval updates preserve recovery receipts and clearSelection clears Make context", async () => {
    await select();
    const updated = { ...workflow.proposals[0], approvalReceipt: { stage: "imported", outputPath: "retained.mp4" } } as LongFormClipProposalRecord;
    await act(async () => workflow.updateProposal(updated));
    equal(workflow.proposals[0].approvalReceipt?.outputPath, "retained.mp4", "Shell-provided recovery receipt retained");
    await act(async () => workflow.selectProposal(updated.id));
    await act(async () => workflow.clearSelection());
    equal(workflow.selectedSourceId, null, "Source cleared");
    equal(workflow.selectedProposalId, null, "Proposal cleared");
    equal(workflow.transcript, null, "Transcript cleared");
    equal(workflow.proposals, [], "Proposals cleared");
    equal(workflow.progress, null, "Progress cleared");
    equal(workflow.sources.length, 2, "Source library retained");
  }],
  ["errors clear busy flags and progress subscription is replaced and disposed", async () => {
    equal(listeners.size, 1, "One progress listener"); await select(); equal(listeners.size, 1, "One listener after selection");
    options.api!.generateLongFormClipProposals = async () => { throw new Error("Model unavailable"); };
    await act(async () => workflow.generateProposals());
    equal(errors.at(-1), "Model unavailable", "Search error reaches shell"); expect(!workflow.generating, "Failure clears flag");
    await act(async () => root.unmount()); equal(listeners.size, 0, "Unmount removes listener");
  }]
];

async function run(): Promise<void> {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, check] of cases) {
    try { await setup(); await check(); results.push({ name }); }
    catch (error) { results.push({ name, error: error instanceof Error ? error.stack : String(error) }); }
    finally { await act(async () => root?.unmount()); host?.remove(); }
  }
  console.log("MAKE_WORKFLOW_RESULTS:" + JSON.stringify(results));
}
void run();
