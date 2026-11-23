import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useEditWorkflow, type EditApi } from "../../src/renderer/edit/useEditWorkflow";
import { createEmptyMetadataPackage } from "../../src/renderer/edit/editWorkflowHelpers";
import { buildTranscriptSegmentsFromSrt } from "../../src/shared/transcriptSegments";
import type { AppInfo, ClipRecord, ClipMetadataPackageRecord, GeneratedClipMetadataCandidatesResult, MetadataVariantRecord, TranscriptRecord } from "../../src/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let workflow: ReturnType<typeof useEditWorkflow>;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let api: EditApi;
let errors: Array<string | null>;
let refreshed: Array<string | undefined>;
let profileUpdates: AppInfo[];
let calls: Array<{ method: string; id?: string; input?: any }>;
let rerender: () => void;
let changeSelection: (id: string | null) => void;
let appInfo: AppInfo | null;
const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
const clip = (id: string) => ({ id }) as ClipRecord;
const metadata = (id: string, title = "Title " + id) => ({
  ...createEmptyMetadataPackage(), id: "metadata-" + id, clipId: id,
  title, updatedAt: "2026-10-20T10:00:00Z"
}) as ClipMetadataPackageRecord;
const transcript = (id: string) => ({
  id: "transcript-" + id, clipId: id, updatedAt: "2026-10-20T10:00:00Z",
  textContent: "Hello", srtContent: srt, segments: buildTranscriptSegmentsFromSrt(srt, "Hello")
}) as TranscriptRecord;
const variant = (id: string, kind: MetadataVariantRecord["kind"] = "title") => ({
  id, kind, angle: "default", content: kind === "title" ? "Candidate " + id : ["#one", "two"]
}) as MetadataVariantRecord;
const generated = (id: string) => ({
  variants: [variant(id)], recommendedPackage: metadata(id, "Generated " + id),
  executionMode: "ai", profileName: "Fixture profile", model: "Fixture model", note: null
}) as GeneratedClipMetadataCandidatesResult;
function expect(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  expect(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function Harness(): null {
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [, force] = useState(0);
  changeSelection = setSelectedClipId;
  rerender = () => force(value => value + 1);
  workflow = useEditWorkflow({
    selectedClipId, clips: [clip("a"), clip("b")], appInfo, api,
    onSelectClip: setSelectedClipId, onError: message => errors.push(message),
    onAppInfo: info => profileUpdates.push(info),
    onRefreshWorkspace: async id => { refreshed.push(id); }
  });
  return null;
}
async function setup(): Promise<void> {
  calls = []; errors = []; refreshed = []; profileUpdates = []; appInfo = null;
  api = {
    getClipMetadata: async id => { calls.push({ method: "metadata", id }); return metadata(id); },
    listMetadataVariants: async id => [variant(id)],
    listYouTubePerformanceSnapshots: async () => [],
    getTranscript: async id => transcript(id),
    evaluateClipMetadataPackage: async (id, input) => { calls.push({ method: "score", id, input }); return { total: 80 } as any; },
    saveClipMetadata: async (id, input) => { calls.push({ method: "save", id, input }); return { ...metadata(id), ...input, updatedAt: "2026-10-20T11:00:00Z" }; },
    generateClipMetadataCandidates: async (id, input) => { calls.push({ method: "generate", id, input }); return generated(id); },
    recordMetadataFeedback: async (id, variantId, decision) => { calls.push({ method: "feedback", id, input: { variantId, decision } }); return {} as any; },
    transcribeClip: async id => { calls.push({ method: "transcribe", id }); return transcript(id); },
    updateTranscript: async (id, textContent, srtContent, segments) => {
      calls.push({ method: "update-transcript", id, input: { textContent, srtContent, segments } });
      return { ...transcript(id), textContent, srtContent, segments: segments!, updatedAt: "2026-10-20T12:00:00Z" };
    },
    exportTranscriptSrt: async id => { calls.push({ method: "export", id }); return null; },
    autoAssignTranscriptSpeakers: async (id, scope) => { calls.push({ method: "assign", id, input: scope }); return transcript(id); },
    captureCreatorVoiceSample: async id => { calls.push({ method: "capture-creator", id }); return { creatorVoiceSamples: [{}] } as AppInfo; },
    removeCreatorVoiceSample: async id => { calls.push({ method: "remove-creator", id }); return {} as AppInfo; },
    captureCollaboratorVoiceSample: async (id, clipId) => {
      calls.push({ method: "capture-collaborator", id: clipId, input: id });
      return { collaboratorProfiles: [{ id, displayName: "Alex", voiceSamples: [{}] }] } as AppInfo;
    },
    removeCollaboratorVoiceSample: async id => { calls.push({ method: "remove-collaborator", id }); return {} as AppInfo; }
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<React.StrictMode><Harness /></React.StrictMode>));
}
async function select(id = "a"): Promise<void> { await act(async () => workflow.selectClip(id)); }
const cases: Array<[string, () => Promise<void>]> = [
  ["reviewed publishing handoff captures a copy and only acknowledges its current draft", async () => {
    await select();
    await act(async () => { workflow.setDraftTitle("Reviewed A"); workflow.setDraftCollaboratorProfileIds(["alex"]); });
    let reviewed!: NonNullable<ReturnType<typeof workflow.captureReviewedMetadata>>;
    await act(async () => { reviewed = workflow.captureReviewedMetadata()!; });
    equal(reviewed.clipId, "a", "Explicit owner");
    await act(async () => workflow.setDraftTitle("Newer title"));
    expect(!reviewed.isCurrent(), "New edits invalidate presentation");
    await act(async () => reviewed.acceptSaved(metadata("a", "Reviewed A")));
    equal(workflow.draftTitle, "Newer title", "New text protected");
    expect(workflow.metadataSession.hasEdits, "New edits stay protected from polling");
    equal(reviewed.draft.title, "Reviewed A", "Snapshot retained");
    reviewed.draft.collaboratorProfileIds.push("another");
    equal(workflow.draftCollaboratorProfileIds, ["alex"], "Snapshot arrays isolated");
    await act(async () => { reviewed = workflow.captureReviewedMetadata()!; });
    const oldPoll = workflow.setSelectedMetadata;
    await act(async () => reviewed.acceptSaved(metadata("a", "Newer title")));
    await act(async () => oldPoll({ ...metadata("a", "Old saved title"), updatedAt: "2026-10-20T12:00:00Z" }));
    equal(workflow.draftTitle, "Newer title", "Read started during save cannot overwrite acknowledged package");
    expect(!workflow.metadataSession.hasEdits && reviewed.isCurrent(), "Current save acknowledged");
    await select("b"); await select("a");
    expect(!reviewed.isCurrent(), "Return to same clip is a new visit");
  }],
  ["publishing handoff supersedes a pending metadata generation", async () => {
    await select();
    const pending = deferred<GeneratedClipMetadataCandidatesResult>();
    api.generateClipMetadataCandidates = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleGenerateMetadataCandidates("all"); });
    await act(async () => { workflow.captureReviewedMetadata(); });
    await act(async () => { pending.resolve(generated("old")); await request; });
    equal(workflow.draftTitle, "Title a", "Reviewed package remains stable");
    equal(workflow.metadataGenerationMode, null, "Superseded busy cleared");
  }],
  ["selection loads existing records without starting AI and clears on deselection", async () => {
    equal(calls, [], "No reads without selection");
    await select();
    equal(workflow.draftTitle, "Title a", "Saved metadata loaded");
    equal(workflow.selectedTranscript?.id, "transcript-a", "Transcript loaded");
    expect(!workflow.metadataLoading && !workflow.transcriptLoading, "Reads complete");
    expect(!calls.some(call => call.method === "generate"), "Read cannot trigger generation");
    await act(async () => changeSelection(null));
    equal(workflow.draftTitle, "", "Draft cleared");
    equal(workflow.selectedTranscript, null, "Transcript cleared");
    expect(!workflow.metadataLoading && !workflow.transcriptLoading, "No lingering loading");
  }],
  ["late selection reads cannot replace the next clip", async () => {
    const pending = deferred<ClipMetadataPackageRecord>();
    api.getClipMetadata = id => id === "a" ? pending.promise : Promise.resolve(metadata(id));
    await select("a"); expect(workflow.metadataLoading, "First selection pending");
    await select("b");
    await act(async () => pending.resolve(metadata("a")));
    equal(workflow.draftTitle, "Title b", "Late metadata ignored");
    equal(workflow.selectedTranscript?.id, "transcript-b", "Late transcript ignored");
  }],
  ["generation captures the reviewed draft and selected mode", async () => {
    await select();
    await act(async () => { workflow.setDraftTitle("My draft"); workflow.setDraftSeriesKey("Series"); workflow.setDraftGameTitle("Game"); });
    const pending = deferred<GeneratedClipMetadataCandidatesResult>();
    api.generateClipMetadataCandidates = async (id, input) => { calls.push({ method: "generate", id, input }); return pending.promise; };
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleGenerateMetadataCandidates("hashtags"); });
    equal(workflow.metadataGenerationMode, "hashtags", "Busy mode");
    const input = calls.find(call => call.method === "generate")!.input;
    equal(input.kinds, ["public_hashtags", "platform_tags"], "Tag kinds");
    equal(input.existingPackage.title, "My draft", "Current draft captured");
    equal(input.seriesKey, "Series", "Series captured"); expect(input.append, "Partial generation appends");
    await act(async () => { pending.resolve(generated("a")); await request; });
    equal(workflow.draftTitle, "Generated a", "Recommended package shown for review");
    equal(workflow.metadataGenerationMode, null, "Busy cleared");
    expect(!calls.some(call => call.method === "save"), "Generation never saves automatically");
  }],
  ["newer generation and clip changes invalidate earlier AI results", async () => {
    await select();
    const first = deferred<GeneratedClipMetadataCandidatesResult>();
    api.generateClipMetadataCandidates = () => first.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleGenerateMetadataCandidates("title"); });
    api.generateClipMetadataCandidates = async () => generated("latest");
    await act(async () => workflow.handleGenerateMetadataCandidates("all"));
    await act(async () => { first.resolve(generated("old")); await request; });
    equal(workflow.draftTitle, "Generated latest", "Earlier request ignored");
    const second = deferred<GeneratedClipMetadataCandidatesResult>();
    api.generateClipMetadataCandidates = () => second.promise;
    await act(async () => { request = workflow.handleGenerateMetadataCandidates("title"); });
    await select("b");
    await act(async () => { second.resolve(generated("a")); await request; });
    equal(workflow.draftTitle, "Title b", "Other clip result ignored");
  }],
  ["coach handoff reads the target clip package and does not use another clip draft", async () => {
    await select("a");
    await act(async () => workflow.setDraftTitle("Unsaved A"));
    await act(async () => workflow.selectClip("b"));
    await act(async () => workflow.generateFromCoach("b", "generate_titles"));
    const call = calls.find(call => call.method === "generate")!;
    equal(call.id, "b", "Coach target");
    equal(call.input.existingPackage.title, "Title b", "Target saved package");
    equal(call.input.kinds, ["title"], "Coach title kind");
    expect(!calls.some(call => call.method === "save"), "Coach remains review first");
  }],
  ["saving validates title and saves the captured package with its score", async () => {
    await select();
    await act(async () => workflow.setDraftTitle(" "));
    await act(async () => workflow.handleSaveClipMetadata());
    expect(errors.at(-1)?.includes("Add a title"), "Blank title rejected");
    await act(async () => workflow.setDraftTitle("x".repeat(101)));
    await act(async () => workflow.handleSaveClipMetadata());
    expect(errors.at(-1)?.includes("Shorten"), "Long title rejected");
    await act(async () => { workflow.setDraftTitle(" Saved title "); workflow.setDraftTagsInput("#one, two"); });
    await act(async () => workflow.handleSaveClipMetadata());
    const saved = calls.find(call => call.method === "save")!;
    equal(saved.id, "a", "Save target"); equal(saved.input.title, "Saved title", "Trimmed title");
    equal(saved.input.publicHashtags, ["#one", "two"], "Hashtags captured");
    equal(saved.input.platformTags, ["#one", "two"], "Tags captured");
    equal(refreshed, ["a"], "Shell refresh callback"); expect(!workflow.savingMetadata, "Save flag cleared");
    api.saveClipMetadata = async () => { throw new Error("Metadata save unavailable"); };
    await act(async () => workflow.handleSaveClipMetadata());
    equal(errors.at(-1), "Metadata save unavailable", "Save failure reported");
    equal(workflow.draftTitle, "Saved title", "Failed save retains draft");
    expect(!workflow.savingMetadata, "Failed save clears busy flag");
  }],
  ["profile blocks use saved profiles and removed collaborators are pruned", async () => {
    await select();
    await act(async () => workflow.handleInsertSavedProfileLinksIntoDescription());
    expect(errors.at(-1)?.includes("Save your creator links"), "Missing profiles explained");
    appInfo = {
      creatorProfileLinks: { youtube: "https://www.youtube.com/@creator" },
      collaboratorProfiles: [{ id: "alex", displayName: "Alex", profileLinks: { twitch: "https://www.twitch.tv/alex" } }]
    } as AppInfo;
    await act(async () => rerender());
    await act(async () => workflow.handleToggleCollaboratorProfileSelection("alex", true));
    await act(async () => workflow.handleInsertSavedProfileLinksIntoDescription());
    expect(workflow.draftDescription.includes("@creator") && workflow.draftDescription.includes("twitch.tv/alex"), "Saved profiles inserted");
    appInfo = { ...appInfo, collaboratorProfiles: [] };
    await act(async () => rerender());
    equal(workflow.draftCollaboratorProfileIds, [], "Removed profile no longer selected");
  }],
  ["variant rejection records explicit feedback without silently replacing draft text", async () => {
    await select(); const item = variant("tags", "platform_tags");
    await act(async () => workflow.handleSelectMetadataVariant(item));
    equal(workflow.selectedVariantIds.publicHashtags, "tags", "Combined tag selection");
    await act(async () => workflow.handleRejectMetadataVariant(item));
    equal(workflow.draftTagsInput, "#one, two", "User draft retained");
    equal(workflow.selectedVariantIds.platformTags, null, "Rejected provenance cleared");
    equal(workflow.rejectedVariantIds, ["tags"], "Hidden candidate");
    equal(calls.find(call => call.method === "feedback")?.input.decision, "rejected", "Explicit rejection");
    api.recordMetadataFeedback = async () => { throw new Error("Feedback unavailable"); };
    await act(async () => workflow.handleRejectMetadataVariant(variant("failed")));
    equal(workflow.rejectedVariantIds, ["tags"], "Failed rejection does not hide candidate");
    equal(workflow.recordingMetadataFeedbackId, null, "Busy cleared");
  }],
  ["transcript save passes edited timing and manual speaker assignments; cancel restores persisted data", async () => {
    await select();
    await act(async () => workflow.setEditingTranscript(true));
    const segmentId = workflow.draftTranscriptSegments[0].id;
    await act(async () => workflow.handleAssignSpeakerToSegment(segmentId, "creator"));
    await act(async () => workflow.setDraftTranscriptSegments(current => current.map(segment => ({ ...segment, startMs: 1250, endMs: 2750 }))));
    await act(async () => workflow.handleSaveTranscriptEdits());
    const saved = calls.find(call => call.method === "update-transcript")!;
    equal(saved.input.segments[0].startMs, 1250, "Edited timing sent");
    equal(saved.input.segments[0].speakerAssignmentSource, "manual", "Manual source sent");
    expect(!workflow.editingTranscript && !workflow.savingTranscript, "Save ends edit mode");
    await act(async () => { workflow.setEditingTranscript(true); workflow.setDraftTranscriptText("Unsaved"); });
    await act(async () => workflow.handleCancelTranscriptEdits());
    equal(workflow.draftTranscriptText, "Hello", "Saved text restored"); equal(workflow.speakerReviewFilter, "all", "Filter restored");
  }],
  ["transcript save failure retains the edit draft and rerun preserves the selected view", async () => {
    await select();
    await act(async () => { workflow.setEditingTranscript(true); workflow.setDraftTranscriptText("Keep this"); });
    api.updateTranscript = async () => { throw new Error("Save unavailable"); };
    await act(async () => workflow.handleSaveTranscriptEdits());
    expect(workflow.editingTranscript, "Failed save stays editable"); equal(workflow.draftTranscriptText, "Keep this", "Draft retained");
    equal(errors.at(-1), "Save unavailable", "Error reported"); expect(!workflow.savingTranscript, "Failure clears busy");
    await act(async () => { workflow.handleCancelTranscriptEdits(); workflow.setTranscriptView("speakers"); });
    await act(async () => workflow.handleTranscribeSelectedClip());
    equal(workflow.transcriptView, "speakers", "View preserved");
    equal(refreshed, ["a"], "Rerun refresh delegated"); equal(workflow.transcribingClipId, null, "Transcription cleared");
    await act(async () => workflow.handleExportSelectedTranscript());
    expect(calls.some(call => call.method === "export" && call.id === "a"), "Export target");
  }],
  ["speaker auto assignment passes the requested scope and reports review results", async () => {
    await select();
    const record = transcript("a");
    record.segments[0].speakerAssignmentSource = "auto_low_confidence";
    await act(async () => workflow.setSelectedTranscript({ ...record, updatedAt: "2026-10-20T13:00:00Z" }));
    await act(async () => workflow.handleAutoAssignTranscriptSpeakers("needs_review"));
    equal(calls.find(call => call.method === "assign")?.input, "needs_review", "Scope passed");
    expect(workflow.transcriptMessage?.includes("Rechecked 1 needs-review segment"), "Review summary");
    expect(!workflow.autoAssigningSpeakers, "Assignment cleared");
  }],
  ["voice sample operations update shared profiles through callbacks", async () => {
    await select(); const segment = workflow.selectedTranscript!.segments[0];
    await act(async () => workflow.handleCaptureCreatorVoiceSample(segment));
    expect(workflow.transcriptMessage?.includes("1 sample ready"), "Creator confirmation");
    await act(async () => workflow.handleRemoveCreatorVoiceSample("sample"));
    await act(async () => workflow.handleCaptureCollaboratorVoiceSample("alex", segment));
    expect(workflow.transcriptMessage?.includes("Alex"), "Named collaborator confirmation");
    await act(async () => workflow.handleRemoveCollaboratorVoiceSample("alex", "sample", "Alex"));
    equal(profileUpdates.length, 4, "Profile updates delegated");
    equal(workflow.capturingVoiceSampleKey, null, "Capture cleared"); equal(workflow.removingVoiceSampleKey, null, "Removal cleared");
  }],
  ["background scoring ignores an abandoned selection and unmount cancels the debounce", async () => {
    const pending = deferred<any>(); api.evaluateClipMetadataPackage = () => pending.promise;
    await select();
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 280)));
    expect(workflow.evaluatingMetadata, "Score request in progress");
    await select("b");
    await act(async () => pending.resolve({ total: 99 }));
    equal(workflow.metadataScore, null, "Abandoned score ignored");
    calls = []; api.evaluateClipMetadataPackage = async (id, input) => { calls.push({ method: "score", id, input }); return {} as any; };
    await act(async () => workflow.setDraftTitle("Changed title"));
    await act(async () => root.unmount());
    await new Promise(resolve => window.setTimeout(resolve, 280));
    expect(!calls.some(call => call.method === "score"), "Unmount cancels timer");
  }],
  ["a late transcription cannot replace another clip or clear its newer busy state", async () => {
    await select("a");
    const a = deferred<TranscriptRecord>(), b = deferred<TranscriptRecord>();
    api.transcribeClip = id => { calls.push({ method: "transcribe", id }); return id === "a" ? a.promise : b.promise; };
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = workflow.handleTranscribeSelectedClip(); });
    await select("b");
    await act(async () => { second = workflow.handleTranscribeSelectedClip(); });
    await act(async () => { a.resolve({ ...transcript("a"), textContent: "Late A" }); await first; });
    equal(workflow.selectedTranscript?.clipId, "b", "B transcript stays visible");
    equal(workflow.transcribingClipId, "b", "B operation stays busy");
    equal(refreshed, [], "Old completion cannot refresh/reselect A");
    await act(async () => { b.resolve({ ...transcript("b"), textContent: "Fresh B", updatedAt: "new-b" }); await second; });
    equal(workflow.selectedTranscript?.textContent, "Fresh B", "Current result accepted");
    equal(refreshed, ["b"], "Only current refresh runs");
  }],
  ["returning to the same clip creates a new session for pending commands and callbacks", async () => {
    await select("a");
    const pending = deferred<TranscriptRecord>();
    api.transcribeClip = () => pending.promise;
    const oldCallback = workflow.setSelectedTranscript;
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleTranscribeSelectedClip(); });
    await select("b"); await select("a");
    await act(async () => { pending.resolve({ ...transcript("a"), textContent: "Abandoned visit" }); await request; });
    await act(async () => oldCallback({ ...transcript("a"), textContent: "Old callback", updatedAt: "late" }));
    equal(workflow.selectedTranscript?.textContent, "Hello", "Old visit ignored despite matching clip ID");
    equal(refreshed, [], "Abandoned visit cannot navigate");
    expect(!workflow.transcribingClipId, "New visit not stuck busy");
  }],
  ["transcript saves retain their original input but cannot close newer edits", async () => {
    await select();
    await act(async () => { workflow.setEditingTranscript(true); workflow.setDraftTranscriptText("Submitted text"); });
    const pending = deferred<TranscriptRecord>();
    api.updateTranscript = async (id, textContent, srtContent, segments) => {
      calls.push({ method: "pending-save", id, input: { textContent, segments } }); return pending.promise;
    };
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleSaveTranscriptEdits(); });
    await act(async () => workflow.setDraftTranscriptText("Newer unsaved edit"));
    await act(async () => { pending.resolve({ ...transcript("a"), textContent: "Submitted text", updatedAt: "saved" }); await request; });
    equal(calls.find(call => call.method === "pending-save")?.input.textContent, "Submitted text", "Captured save input");
    equal(workflow.draftTranscriptText, "Newer unsaved edit", "New local text preserved");
    expect(workflow.editingTranscript && !workflow.savingTranscript, "Still editing with busy cleared");
  }],
  ["speaker results do not overwrite manual edits made while assignment runs", async () => {
    await select();
    const pending = deferred<TranscriptRecord>();
    api.autoAssignTranscriptSpeakers = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleAutoAssignTranscriptSpeakers(); });
    await act(async () => workflow.handleAssignSpeakerToSegment(workflow.draftTranscriptSegments[0].id, "creator"));
    await act(async () => { pending.resolve({ ...transcript("a"), updatedAt: "assigned" }); await request; });
    equal(workflow.draftTranscriptSegments[0].speakerAssignmentSource, "manual", "Manual assignment retained");
    expect(!workflow.autoAssigningSpeakers, "Assignment clears its own busy flag");
  }],
  ["metadata generation and save results cannot replace newer draft edits", async () => {
    await select();
    const generatedLater = deferred<GeneratedClipMetadataCandidatesResult>();
    api.generateClipMetadataCandidates = () => generatedLater.promise;
    let generation!: Promise<void>;
    await act(async () => { generation = workflow.handleGenerateMetadataCandidates("all"); });
    await act(async () => workflow.setDraftTitle("Keep my newer title"));
    await act(async () => { generatedLater.resolve(generated("a")); await generation; });
    equal(workflow.draftTitle, "Keep my newer title", "AI result cannot overwrite newer text");
    equal(workflow.metadataGenerationMode, null, "Generation busy cleared");
    const savedLater = deferred<ClipMetadataPackageRecord>();
    api.saveClipMetadata = () => savedLater.promise;
    let save!: Promise<void>;
    await act(async () => { save = workflow.handleSaveClipMetadata(); });
    await act(async () => workflow.setDraftDescription("Newer description"));
    await act(async () => { savedLater.resolve(metadata("a", "Older saved title")); await save; });
    equal(workflow.draftDescription, "Newer description", "Save completion preserves newer description");
    expect(workflow.metadataSession.hasEdits, "Background polling must continue protecting this newer draft");
    equal(refreshed, [], "Stale save cannot trigger draft-refresh");
    expect(!workflow.savingMetadata, "Save busy cleared");
  }],
  ["stale voice-sample completions and transcript failures cannot affect a new selection", async () => {
    await select("a");
    const pending = deferred<AppInfo>();
    api.captureCreatorVoiceSample = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = workflow.handleCaptureCreatorVoiceSample(workflow.selectedTranscript!.segments[0]); });
    await select("b");
    await act(async () => { pending.resolve({ creatorVoiceSamples: [{}] } as AppInfo); await request; });
    equal(profileUpdates, [], "Abandoned completion cannot replace shared profile snapshot");
    equal(workflow.transcriptMessage, null, "No message on unrelated clip");
    const failure = deferred<TranscriptRecord>();
    api.transcribeClip = () => failure.promise.then(() => { throw new Error("Old clip failed"); });
    await act(async () => { request = workflow.handleTranscribeSelectedClip(); });
    await select("a");
    await act(async () => { failure.resolve(transcript("b")); await request; });
    expect(!errors.some(Boolean), "Old failure does not become a new clip error");
  }],
  ["selection and generation errors reach the shell and clear loading state", async () => {
    api.getTranscript = async () => { throw new Error("Read unavailable"); };
    await select();
    equal(errors.at(-1), "Read unavailable", "Read error");
    expect(!workflow.metadataLoading && !workflow.transcriptLoading, "Read flags cleared");
    api.generateClipMetadataCandidates = async () => { throw new Error("Model unavailable"); };
    await act(async () => workflow.handleGenerateMetadataCandidates("all"));
    equal(errors.at(-1), "Model unavailable", "Model error"); equal(workflow.metadataGenerationMode, null, "Generation cleared");
  }]
];
async function run(): Promise<void> {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, check] of cases) {
    try { await setup(); await check(); results.push({ name }); }
    catch (error) { results.push({ name, error: error instanceof Error ? error.stack : String(error) }); }
    finally { await act(async () => root?.unmount()); host?.remove(); }
  }
  console.log("EDIT_WORKFLOW_RESULTS:" + JSON.stringify(results));
}
void run();
