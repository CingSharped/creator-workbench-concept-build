import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useAiProfileSettings, type AiProfileSettingsApi } from "../../src/renderer/settings/useAiProfileSettings";
import { useSettingsSetupWorkflow, type SettingsSetupApi } from "../../src/renderer/settings/useSettingsSetupWorkflow";
import { createCustomAiProfile, createEmptyAiProfileAssignments } from "../../src/renderer/settings/aiProfileDraft";
import type { AppInfo, AiProfile, CreatorAppApi } from "../../src/shared/contracts";
import type { LocalAiSetupProgress, LocalAiSetupRecommendation } from "../../src/shared/localAiSetup";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let profiles: ReturnType<typeof useAiProfileSettings>;
let setup: ReturnType<typeof useSettingsSetupWorkflow>;
let api: SettingsSetupApi & AiProfileSettingsApi;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let info: AppInfo;
let replaceInfo: (info: AppInfo) => void;
let errors: Array<string | null>;
let updates: AppInfo[];
let calls: Array<{ method: string; args: unknown[] }>;
let listeners: Set<(progress: LocalAiSetupProgress) => void>;
let subscribeCount: number;
const profile = (id: string, task: AiProfile["task"] = "youtube_metadata"): AiProfile => ({
  ...createCustomAiProfile(task), id, name: id, preferredModel: "model-one"
});
function seed(): AppInfo {
  return {
    aiProfiles: [profile("metadata-one"), profile("metadata-two"), profile("coach", "performance_coach")],
    aiProfileAssignments: { ...createEmptyAiProfileAssignments(), youtubeMetadataProfileId: "metadata-one", performanceCoachProfileId: "coach" },
    localAiRuntime: { availableModels: [], health: "ready" },
    strictAiModeEnabled: false
  } as unknown as AppInfo;
}
function expect(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  expect(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual) + " != " + JSON.stringify(expected));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function Harness(): null {
  const [snapshot, setSnapshot] = useState(info);
  info = snapshot; replaceInfo = setSnapshot;
  const onAppInfo = (next: AppInfo) => { updates.push(next); setSnapshot(next); };
  const onError = (message: string | null) => errors.push(message);
  setup = useSettingsSetupWorkflow({ onAppInfo, onError, api });
  profiles = useAiProfileSettings({ appInfo: snapshot, onAppInfo, onError, api });
  return null;
}
async function initialize(): Promise<void> {
  info = seed(); errors = []; updates = []; calls = []; listeners = new Set(); subscribeCount = 0;
  const operation = (method: string) => async (...args: unknown[]) => { calls.push({ method, args }); return { ...info }; };
  api = {
    onLocalAiSetupProgress: listener => {
      subscribeCount++; listeners.add(listener); return () => { listeners.delete(listener); };
    },
    refreshLocalAiRuntime: operation("refresh"),
    importLocalAiRuntimeExecutable: operation("import-runtime"),
    clearLocalAiRuntimeExecutable: operation("clear-runtime"),
    importLocalAiModel: operation("import-model"),
    downloadLocalAiSetupAsset: operation("download"),
    installRecommendedLocalAiSetup: operation("recommendation"),
    cancelLocalAiSetupDownload: async id => { calls.push({ method: "cancel-download", args: [id] }); return true; },
    setAiStrictMode: async enabled => {
      calls.push({ method: "strict", args: [enabled] });
      return { ...info, strictAiModeEnabled: enabled };
    },
    configureToolPath: operation("configure-tool"),
    clearToolPath: operation("clear-tool"),
    setTranscriptionBackend: operation("backend"),
    configureWorkspaceFolder: operation("configure-folder"),
    clearWorkspaceFolder: operation("clear-folder"),
    setWorkspaceAutomationSetting: operation("automation"),
    saveAiProfiles: async input => {
      calls.push({ method: "save-profiles", args: [input] });
      return { ...info, aiProfiles: input.profiles, aiProfileAssignments: input.assignments };
    }
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
}
async function edit(): Promise<void> { await act(async () => profiles.setEditingAiProfiles(true)); }
async function progress(status: LocalAiSetupProgress["status"] = "downloading"): Promise<void> {
  await act(async () => listeners.forEach(listener => listener({
    operationId: "download-one", status, percent: 40
  } as LocalAiSetupProgress)));
}
const cases: Array<[string, () => Promise<void>]> = [
  ["mount loads saved drafts and subscribes without starting setup or saving configuration", async () => {
    equal(profiles.aiProfilesInput.map(item => item.id), ["metadata-one", "metadata-two", "coach"], "Saved profiles");
    equal(profiles.selectedAiProfile?.id, "metadata-one", "Initial selection");
    expect(!profiles.editingAiProfiles && !profiles.savingAiProfiles, "Initially locked");
    equal(calls, [], "No side effects on mount"); equal(listeners.size, 1, "Progress subscribed");
  }],
  ["runtime refresh preserves unsaved profile and assignment edits even when saved profiles changed", async () => {
    await edit();
    await act(async () => {
      profiles.handleUpdateAiProfile("metadata-one", { name: "Unsaved name", systemPrompt: "Unsaved prompt", preferredModel: " model-two " });
      profiles.handleUpdateAiProfileAssignment("youtube_metadata", "metadata-two");
    });
    const refreshed = { ...info, aiProfiles: info.aiProfiles.map(item => ({ ...item, name: "Server " + item.id })) };
    api.refreshLocalAiRuntime = async () => refreshed;
    await act(async () => setup.handleRefreshLocalAiRuntime());
    equal(profiles.aiProfilesInput[0].name, "Unsaved name", "Draft preserved");
    equal(profiles.aiProfilesInput[0].systemPrompt, "Unsaved prompt", "Prompt preserved");
    equal(profiles.aiProfilesInput[0].preferredModel, "model-two", "Model edit preserved and trimmed");
    equal(profiles.aiProfileAssignmentsInput.youtubeMetadataProfileId, "metadata-two", "Assignment preserved");
    expect(profiles.editingAiProfiles, "Still editing");
    equal(info.aiProfiles[0].name, "Server metadata-one", "Canonical snapshot updated separately");
    expect(!calls.some(call => call.method === "save-profiles"), "Refresh cannot save drafts");
  }],
  ["locked profiles follow new saved snapshots and Cancel uses the latest saved values", async () => {
    await act(async () => replaceInfo({ ...info, aiProfiles: [profile("new-saved")] }));
    equal(profiles.selectedAiProfile?.id, "new-saved", "Selection reconciled");
    await edit();
    await act(async () => profiles.handleUpdateAiProfile("new-saved", { name: "Draft" }));
    await act(async () => replaceInfo({ ...info, aiProfiles: [profile("latest")] }));
    equal(profiles.aiProfilesInput[0].name, "Draft", "Editing snapshot protected");
    await act(async () => profiles.handleCancelAiProfileEdits());
    equal(profiles.aiProfilesInput[0].id, "latest", "Cancel uses latest saved snapshot");
    expect(!profiles.editingAiProfiles, "Cancel exits edit mode");
    equal(calls, [], "Cancel cannot persist");
  }],
  ["explicit save submits one coherent profile and assignment snapshot and returns to locked mode", async () => {
    await edit();
    await act(async () => {
      profiles.handleUpdateAiProfile("metadata-two", { systemPrompt: "Approved prompt" });
      profiles.handleUpdateAiProfileAssignment("youtube_metadata", "metadata-two");
    });
    const pending = deferred<AppInfo>();
    api.saveAiProfiles = async input => { calls.push({ method: "save-profiles", args: [input] }); return pending.promise; };
    let request!: Promise<void>;
    await act(async () => { request = profiles.handleSaveAiProfiles(); });
    expect(profiles.savingAiProfiles, "Save busy");
    const submitted = calls[0].args[0] as Parameters<CreatorAppApi["saveAiProfiles"]>[0];
    equal(submitted.assignments.youtubeMetadataProfileId, "metadata-two", "Assignment submitted");
    equal(submitted.profiles[1].systemPrompt, "Approved prompt", "Edited prompt submitted");
    await act(async () => {
      pending.resolve({ ...info, aiProfiles: submitted.profiles, aiProfileAssignments: submitted.assignments });
      await request;
    });
    equal(updates.length, 1, "Snapshot callback once");
    expect(!profiles.savingAiProfiles && !profiles.editingAiProfiles, "Save completes and locks");
    equal(profiles.aiProfileAssignmentsInput.youtubeMetadataProfileId, "metadata-two", "Saved choice visible");
  }],
  ["validation/save failure preserves entered profile settings and clears busy state", async () => {
    await edit();
    await act(async () => profiles.handleUpdateAiProfile("metadata-one", { name: "Keep draft" }));
    api.saveAiProfiles = async () => { throw new Error("Invalid profile configuration"); };
    await act(async () => profiles.handleSaveAiProfiles());
    equal(errors.at(-1), "Invalid profile configuration", "Backend validation error");
    equal(profiles.aiProfilesInput[0].name, "Keep draft", "Draft retained");
    expect(profiles.editingAiProfiles && !profiles.savingAiProfiles, "Retry remains possible");
    equal(updates, [], "Failed save does not replace shared snapshot");
  }],
  ["profile creation, learning and knowledge edits are local and reversible", async () => {
    await edit();
    await act(async () => profiles.handleAddAiProfile());
    const added = profiles.selectedAiProfile!;
    expect(!added.builtIn && added.id !== "metadata-one", "Custom profile selected");
    equal(profiles.aiProfileAssignmentsInput.youtubeMetadataProfileId, "metadata-one", "Add preserves assignment");
    await act(async () => {
      profiles.handleUpdateAiProfileLearningSettings(added.id, { maxKnowledgeEntries: 200 });
      profiles.handleAddAiProfileKnowledge(added.id);
    });
    equal(profiles.selectedAiProfile!.learningSettings.maxKnowledgeEntries, 50, "Bounded knowledge limit");
    const entry = profiles.selectedAiProfile!.knowledgeEntries[0];
    await act(async () => profiles.handleUpdateAiProfileKnowledge(added.id, entry.id, { title: "Useful context", content: "Style guidance", enabled: false }));
    equal(profiles.selectedAiProfile!.knowledgeEntries[0].title, "Useful context", "Entry updated");
    await act(async () => profiles.handleRemoveAiProfileKnowledge(added.id, entry.id));
    equal(profiles.selectedAiProfile!.knowledgeEntries, [], "Entry removed");
    await act(async () => profiles.handleCancelAiProfileEdits());
    equal(profiles.aiProfilesInput.length, 3, "Creation cancelled");
    equal(calls, [], "No implicit saves");
  }],
  ["removal and task changes reconcile draft assignments atomically without changing saved choices", async () => {
    await edit();
    await act(async () => profiles.handleRemoveAiProfile("metadata-one"));
    equal(profiles.aiProfileAssignmentsInput.youtubeMetadataProfileId, "metadata-two", "Same-task replacement");
    equal(profiles.selectedAiProfile?.id, "metadata-two", "Removed selection replaced");
    await act(async () => profiles.handleUpdateAiProfile("metadata-two", { task: "clip_discovery", preferredModel: " " }));
    equal(profiles.aiProfileAssignmentsInput.youtubeMetadataProfileId, null, "No remaining metadata profile");
    equal(profiles.aiProfileAssignmentsInput.clipDiscoveryProfileId, "metadata-two", "Existing draft normalization retained");
    equal(profiles.aiProfilesInput[0].preferredModel, null, "Blank preference normalized");
    equal(info.aiProfileAssignments.youtubeMetadataProfileId, "metadata-one", "Saved choices unchanged");
    equal(calls, [], "No automatic persistence");
  }],
  ["invalid task assignment cannot select a profile from another task", async () => {
    await edit();
    await act(async () => profiles.handleUpdateAiProfileAssignment("performance_coach", "metadata-one"));
    equal(profiles.aiProfileAssignmentsInput.performanceCoachProfileId, "coach", "Wrong-task choice rejected by normalization");
    equal(info.aiProfileAssignments.performanceCoachProfileId, "coach", "Saved assignment retained");
    equal(calls, [], "Draft-only normalization");
  }],
  ["runtime import exposes busy state and sends successful snapshots through the shell", async () => {
    const pending = deferred<AppInfo>();
    api.importLocalAiRuntimeExecutable = () => pending.promise;
    let request!: Promise<void>;
    await act(async () => { request = setup.handleImportLocalAiRuntimeExecutable(); });
    equal(setup.localAiAction, "import_runtime", "Import busy");
    await act(async () => { pending.resolve(info); await request; });
    equal(setup.localAiAction, null, "Import cleared"); equal(updates.length, 1, "Import snapshot propagated");
    await act(async () => setup.handleImportLocalAiModel());
    await act(async () => setup.handleClearLocalAiRuntimeExecutable());
    equal(calls.map(call => call.method), ["import-model", "clear-runtime"], "Explicit model/runtime methods");
  }],
  ["setup failures report errors, retain profile drafts and clear every affected busy flag", async () => {
    await edit();
    await act(async () => profiles.handleUpdateAiProfile("metadata-one", { name: "Keep across setup failure" }));
    api.importLocalAiModel = async () => { throw new Error("Bad model"); };
    await act(async () => setup.handleImportLocalAiModel());
    equal(errors.at(-1), "Bad model", "Import failure");
    equal(setup.localAiAction, null, "Import busy cleared");
    api.setAiStrictMode = async () => { throw new Error("Strict update failed"); };
    await act(async () => setup.handleSetAiStrictMode(true));
    expect(!setup.savingStrictAiMode, "Strict busy cleared");
    api.configureToolPath = async () => { throw new Error("Tool failed"); };
    await act(async () => setup.handleConfigureToolPath("ffmpeg"));
    equal(setup.configuringTool, null, "Tool busy cleared");
    api.setTranscriptionBackend = async () => { throw new Error("Backend failed"); };
    await act(async () => setup.handleSetTranscriptionBackend("auto"));
    expect(!setup.savingTranscriptionBackend, "Backend busy cleared");
    api.configureWorkspaceFolder = async () => { throw new Error("Folder failed"); };
    await act(async () => setup.handleConfigureWorkspaceFolder("clipLibrary"));
    equal(setup.configuringFolder, null, "Folder busy cleared");
    api.setWorkspaceAutomationSetting = async () => { throw new Error("Automation failed"); };
    await act(async () => setup.handleSetWorkspaceAutomationSetting("watchClipLibrary", true));
    equal(setup.configuringAutomation, null, "Automation busy cleared");
    equal(profiles.aiProfilesInput[0].name, "Keep across setup failure", "Unsaved profile retained");
    equal(updates, [], "Failed operations never replace snapshot");
  }],
  ["download progress and cancellation target the current operation without inventing a terminal result", async () => {
    await act(async () => setup.handleCancelLocalAiSetupDownload());
    equal(calls, [], "No cancellation without progress");
    await progress();
    equal(setup.localAiSetupProgress?.percent, 40, "Progress displayed");
    await act(async () => setup.handleCancelLocalAiSetupDownload());
    equal(calls[0], { method: "cancel-download", args: ["download-one"] }, "Cancellation ownership");
    equal(setup.localAiSetupProgress?.status, "downloading", "Waits for actual terminal event");
    await progress("cancelled");
    equal(setup.localAiSetupProgress?.status, "cancelled", "Terminal event applied");
    api.cancelLocalAiSetupDownload = async () => { throw new Error("Already ended"); };
    await act(async () => setup.handleCancelLocalAiSetupDownload());
    equal(errors, [], "Cancellation rejection retains existing non-fatal policy");
  }],
  ["asset download and recommendation keep their payload and action state", async () => {
    await act(async () => setup.handleDownloadLocalAiSetupAsset("runtime_cpu"));
    equal(calls[0].args, ["runtime_cpu"], "Asset passed");
    const recommendation = { runtimeId: "runtime_cpu", modelId: "model_qwen3_8b_q8_0" } as unknown as LocalAiSetupRecommendation;
    const pending = deferred<AppInfo>();
    api.installRecommendedLocalAiSetup = async input => { calls.push({ method: "recommendation", args: [input] }); return pending.promise; };
    let request!: Promise<void>;
    await act(async () => { request = setup.handleInstallRecommendedLocalAiSetup(recommendation); });
    equal(setup.localAiAction, "install_recommended", "Recommendation busy");
    await act(async () => { pending.resolve(info); await request; });
    equal(calls[1].args[0], recommendation, "Recommendation passed");
    equal(setup.localAiAction, null, "Recommendation cleared");
    expect(!calls.some(call => call.method === "save-profiles"), "Setup cannot save assignments");
  }],
  ["local tool, backend, folder, automation and strict settings delegate explicit values", async () => {
    await act(async () => setup.handleConfigureToolPath("whisper"));
    await act(async () => setup.handleClearToolPath("ffmpeg"));
    await act(async () => setup.handleSetTranscriptionBackend("auto"));
    await act(async () => setup.handleConfigureWorkspaceFolder("srtOutput"));
    await act(async () => setup.handleClearWorkspaceFolder("longFormSourceLibrary"));
    await act(async () => setup.handleSetWorkspaceAutomationSetting("autoTranscribeOnImport", false));
    await act(async () => setup.handleSetAiStrictMode(true));
    equal(calls, [
      { method: "configure-tool", args: ["whisper"] }, { method: "clear-tool", args: ["ffmpeg"] },
      { method: "backend", args: ["auto"] }, { method: "configure-folder", args: ["srtOutput"] },
      { method: "clear-folder", args: ["longFormSourceLibrary"] },
      { method: "automation", args: ["autoTranscribeOnImport", false] },
      { method: "strict", args: [true] }
    ], "Explicit setup arguments");
    expect(info.strictAiModeEnabled, "Shared strict mode updated");
    expect(!setup.configuringTool && !setup.configuringFolder && !setup.configuringAutomation, "Busy flags cleared");
  }],
  ["progress subscription stays singular across edits and is removed on unmount", async () => {
    await edit();
    await act(async () => profiles.handleUpdateAiProfile("metadata-one", { name: "Edit" }));
    await act(async () => setup.handleRefreshLocalAiRuntime());
    equal(subscribeCount, 1, "No redundant subscription on rerender");
    equal(listeners.size, 1, "One active listener");
    await act(async () => root.unmount());
    equal(listeners.size, 0, "Listener disposed");
  }],
  ["a preload without setup progress support keeps Settings usable", async () => {
    await act(async () => root.unmount());
    api = { ...api, onLocalAiSetupProgress: undefined } as unknown as typeof api;
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
    equal(setup.localAiSetupProgress, null, "No stale progress");
    await act(async () => setup.handleRefreshLocalAiRuntime());
    equal(calls[0].method, "refresh", "Other controls remain usable");
  }]
];
async function run(): Promise<void> {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, check] of cases) {
    try { await initialize(); await check(); results.push({ name }); }
    catch (error) { results.push({ name, error: error instanceof Error ? error.stack : String(error) }); }
    finally { await act(async () => root?.unmount()); host?.remove(); }
  }
  console.log("SETTINGS_WORKFLOW_RESULTS:" + JSON.stringify(results));
}
void run();
