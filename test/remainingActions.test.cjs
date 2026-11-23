const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { executeAppAction, registerAppActionHandler } = require("../dist/electron/actions/appActionExecutor.js");
const { registerRemainingActions } = require("../dist/electron/actions/registerRemainingActions.js");
const { remainingActionSchemas, parseRemainingAction } = require("../dist/electron/actions/remainingActionSchemas.js");
const { APP_ACTION_DEFINITIONS } = require("../dist/shared/appActions.js");
const services = name => require("../dist/electron/services/" + name + ".js");
const originals = [];
function stub(module, name, implementation) {
  const target = services(module); originals.push([target, name, target[name]]); target[name] = implementation;
}
test.afterEach(() => { for (const [target, name, original] of originals.splice(0)) target[name] = original; });
const context = { source: "ui", confirmed: true, sender: null };
const execute = (id, input, options = {}) => executeAppAction(id, input, { ...context, ...options });
registerRemainingActions();

test("remaining actions reject malformed payloads before changing settings or performing work", async () => {
  let writes = 0;
  stub("settingsRepository", "setAppSetting", () => writes++);
  stub("workspacePreferences", "setWorkspaceFolderSetting", () => writes++);
  stub("localAiSetupService", "downloadLocalAiSetupAsset", () => writes++);
  stub("creatorProfileLinks", "saveCollaboratorProfiles", () => writes++);
  const invalid = [
    ["settings.set_strict_ai", { enabled: "false" }],
    ["settings.set_automation", { setting: "not-a-setting", enabled: true }],
    ["settings.set_tool_path", { tool: "unknown", selectedPath: "runtime.exe" }],
    ["settings.set_folder", { folder: "arbitrary", selectedPath: "folder" }],
    ["settings.set_transcription_backend", { preference: "unknown" }],
    ["ai.download_setup_asset", { assetId: "https://example.com/arbitrary.exe" }],
    ["ai.install_recommended_setup", { recommendation: { runtimeId: "runtime_cpu", modelId: "runtime_cpu", reason: "", memoryDetail: "" } }],
    ["profiles.save_collaborators", { payload: [null] }],
    ["profiles.save_ai", { payload: { profiles: [], assignments: null } }],
    ["profiles.capture_creator_sample", { clipId: "a", segment: { id: "s", startMs: 9, endMs: 2 } }],
    ["profiles.record_voice_sample", { input: { profileId: "creator", audioData: new ArrayBuffer(0), mimeType: "audio/webm", transcriptPreview: "" } }],
    ["long_form.export_trimmed", { sourceId: "a", outputPath: "out.mp4", startMs: 10, endMs: 1 }],
    ["transcripts.export_srt", { clipId: "a", outputPath: "source.mp4" }],
    ["clips.export_stacked_vertical", { clipId: "a", outputPath: "out.mp4", startMs: 0, endMs: 10, layout: {} }]
  ];
  for (const [id, input] of invalid) await assert.rejects(execute(id, input), /Invalid input for action/);
  assert.equal(writes, 0);
  for (const id of Object.keys(remainingActionSchemas)) {
    await assert.rejects(execute(id, null), /Invalid input for action/);
  }
});

test("settings actions preserve explicit false, supported keys and watcher refresh", async () => {
  const calls = [];
  stub("aiProfileService", "setAiStrictModeEnabled", value => calls.push(["strict", value]));
  stub("workspacePreferences", "setWorkspaceAutomationSetting", (...args) => calls.push(["automation", ...args]));
  stub("workspacePreferences", "setWorkspaceFolderSetting", (...args) => calls.push(["folder", ...args]));
  stub("workspacePreferences", "clearWorkspaceFolderSetting", (...args) => calls.push(["clear-folder", ...args]));
  stub("clipLibraryWatcher", "refreshClipLibraryWatcher", async () => calls.push(["watcher"]));
  stub("settingsRepository", "setAppSetting", (...args) => calls.push(["setting", ...args]));
  await execute("settings.set_strict_ai", { enabled: false });
  await execute("settings.set_automation", { setting: "watchClipLibrary", enabled: false });
  await execute("settings.set_folder", { folder: "clipLibrary", selectedPath: "C:/clips" });
  await execute("settings.clear_folder", { folder: "clipLibrary" });
  await execute("settings.set_tool_path", { tool: "ffmpeg", selectedPath: "C:/ffmpeg.exe" });
  assert.deepEqual(calls.slice(0, 7), [
    ["strict", false], ["automation", "watchClipLibrary", false], ["watcher"],
    ["folder", "clipLibrary", "C:/clips"], ["watcher"], ["clear-folder", "clipLibrary"], ["watcher"]
  ]);
  assert.equal(calls[7][2], "C:/ffmpeg.exe");
});

test("explicit AI profile save retains prompt, learning flags, task and assignment values", async () => {
  stub("settingsRepository", "getAppSetting", () => null);
  const profile = services("aiProfileService").getAiProfiles()[0];
  const assignments = { youtubeMetadataProfileId: null, youtubeThumbnailProfileId: null, performanceCoachProfileId: null, clipDiscoveryProfileId: null };
  const payload = { profiles: [{ ...profile, systemPrompt: "Reviewed prompt", enabled: false }], assignments };
  let received;
  stub("aiProfileService", "saveAiProfilesConfiguration", input => { received = input; return input; });
  assert.deepEqual(await execute("profiles.save_ai", { payload }), payload);
  assert.deepEqual(received, payload);
});

test("download cancellation retains operation identity and invalid assets never start network work", async () => {
  const calls = [];
  stub("localAiSetupService", "downloadLocalAiSetupAsset", async id => { calls.push(id); return "downloaded"; });
  stub("localAiSetupService", "cancelLocalAiSetupDownload", id => { calls.push(id); return true; });
  assert.equal(await execute("ai.download_setup_asset", { assetId: "runtime_cpu" }), "downloaded");
  assert.equal(await execute("ai.cancel_setup_download", { operationId: "download-a" }), true);
  assert.deepEqual(calls, ["runtime_cpu", "download-a"]);
});

test("voice actions preserve the selected clip and recording bytes", async () => {
  const calls = [], audioData = new Uint8Array([1, 2, 3]).buffer;
  const segment = { id: "segment-a", startMs: 10, endMs: 100, text: "Reviewed speech",
    speakerId: null, speakerConfidence: null, speakerAssignmentSource: null,
    speakerReviewReason: null, speakerAlternateSpeakerId: null, speakerAlternateConfidence: null };
  stub("voiceProfileService", "captureCollaboratorVoiceSample", async (...args) => { calls.push(args); });
  stub("voiceProfileService", "recordVoiceProfileSample", async input => { calls.push(input); });
  await execute("profiles.capture_collaborator_sample", { collaboratorProfileId: "person-b", clipId: "clip-a", segment });
  await execute("profiles.record_voice_sample", { input: { profileId: "person-b", audioData, mimeType: "audio/webm", transcriptPreview: "Reviewed" } });
  assert.deepEqual(calls[0], ["person-b", "clip-a", segment]);
  assert.equal(calls[1].audioData, audioData);
});

test("genuine account and download failures propagate once without fallback or retry", async () => {
  let calls = 0;
  stub("youtubeService", "connectYouTube", async () => { calls++; throw new Error("Connection unavailable"); });
  stub("localAiSetupService", "downloadLocalAiSetupAsset", async () => { calls++; throw new Error("Download unavailable"); });
  await assert.rejects(execute("youtube.connect", {}), /Connection unavailable/);
  await assert.rejects(execute("ai.download_setup_asset", { assetId: "runtime_cpu" }), /Download unavailable/);
  assert.equal(calls, 2);
});

test("credentials pass unchanged and validation errors contain fields without secret values", async () => {
  const secret = "sensitive-test-secret";
  let received;
  stub("youtubeService", "saveYouTubeCredentials", (...args) => { received = args; return { connected: false }; });
  await execute("youtube.save_credentials", { payload: { clientId: " client ", clientSecret: secret } });
  assert.deepEqual(received, [" client ", secret]);
  await assert.rejects(execute("youtube.save_credentials", { payload: { clientId: secret, clientSecret: 123 } }),
    error => !error.message.includes(secret) && error.message.includes("payload.clientSecret"));
});

test("exports, AI configuration and legacy index clear enforce confirmation before side effects", async () => {
  for (const id of ["profiles.save_ai", "clips.clear_workspace_indexes", "clips.export_stacked_vertical", "long_form.export_trimmed", "long_form.export_stacked_vertical", "transcripts.export_srt"]) {
    assert.equal(APP_ACTION_DEFINITIONS.find(item => item.id === id).requiresConfirmation, true);
    await assert.rejects(execute(id, {}, { source: "orchestrator", confirmed: false }), /requires user confirmation/);
  }
});

test("exports retain captured source, layout and output path without substituting another asset", async () => {
  const layout = { topFocusX: 0.5, topFocusY: 0.2, topScale: 1, bottomFocusX: 0.5, bottomFocusY: 0.8, bottomScale: 0.5 };
  stub("longFormSourceRepository", "getLongFormSourceById", id => ({ sourcePath: id + ".mp4", durationMs: 500, widthPx: 1920, heightPx: 1080 }));
  const received = [];
  stub("clipTrimService", "exportTrimmedMedia", async input => { received.push(input); return input.outputPath; });
  stub("clipTrimService", "exportStackedVerticalClip", async input => { received.push(input); return input.outputPath; });
  assert.equal(await execute("long_form.export_trimmed", { sourceId: "source-a", startMs: 10, endMs: 100, outputPath: "out.mp4" }), "out.mp4");
  assert.equal(received[0].sourcePath, "source-a.mp4");
  await execute("clips.export_stacked_vertical", { clipId: "clip-b", startMs: 20, endMs: 200, outputPath: "stack.mp4", layout });
  assert.deepEqual(received[1], { clipId: "clip-b", startMs: 20, endMs: 200, outputPath: "stack.mp4", layout });
});

test("remaining IPC adapters preserve public results and cancelled pickers perform no mutation", async () => {
  const handlers = new Map(), executed = [], calls = [];
  const info = { marker: "app-info" };
  const filename = path.resolve(__dirname, "../dist/electron/ipc/registerHandlers.js"), originalRequire = createRequire(filename);
  let openResult = { canceled: true, filePaths: [] };
  let saveResult = { canceled: true }, saveOptions;
  const modules = {
    "../actions/registerCreatorWorkflowActions": { registerCreatorWorkflowActions() {} },
    "../actions/appActionExecutor": { executeAppAction: async (id, input, ctx) => {
      executed.push({ id, input, ctx }); return id === "ai.cancel_setup_download" ? true : { marker: id };
    } },
    "../services/database": { getDatabaseContext: () => ({ databasePath: "test" }) },
    "../services/workspaceRepository": { getDefaultWorkspace: () => ({ name: "test" }) },
    "../services/mediaInspector": { getMediaRuntimeStatus: async () => ({}) },
    "../services/transcriptionService": { getTranscriptionRuntimeSelection: async () => ({}), subscribeTranscriptionProgress() {} },
    "../services/setupEnvironmentService": { getCreatorSetupEnvironment: async () => ({}) },
    "../services/localAiRuntimeService": { getLocalAiRuntimeStatus: async () => ({}) },
    "../services/jobRepository": { subscribeJobUpdates() {} },
    "../services/localAiSetupService": { subscribeLocalAiSetupProgress() {} },
    "../services/aiActivityService": { subscribeAiActivity() {} }
  };
  const electron = {
    app: { getPath: () => "test" },
    BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: { showOpenDialog: async () => openResult,
      showSaveDialog: async options => { saveOptions = options; return saveResult; } }
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: name => name === "electron" ? electron : modules[name] ?? originalRequire(name),
    module: sandboxModule, exports: sandboxModule.exports, process, Buffer, console, __dirname: path.dirname(filename), __filename: filename
  }, { filename });
  // Stub the remaining read helpers used to assemble AppInfo.
  stub("workspacePreferences", "getWorkspaceFolderSetting", () => null);
  stub("workspacePreferences", "getWorkspaceAutomationSetting", () => false);
  stub("creatorProfileLinks", "getCreatorProfileLinks", () => ({}));
  stub("creatorProfileLinks", "getCreatorVoiceSamples", () => []);
  stub("creatorProfileLinks", "getCollaboratorProfiles", () => []);
  stub("aiProfileService", "getAiProfiles", () => []);
  stub("aiProfileService", "getAiProfileAssignments", () => ({}));
  stub("aiProfileService", "isStrictAiModeEnabled", () => false);
  sandboxModule.exports.registerIpcHandlers();
  const event = { sender: { marker: "sender" } };
  const result = await handlers.get("ai:set-strict-mode")(event, false);
  assert.equal(result.workspaceName, "test", "Compatibility API still returns AppInfo");
  assert.deepEqual(executed.map(item => item.id), ["settings.set_strict_ai"]);
  assert.equal(executed[0].input.enabled, false); assert.equal(executed[0].ctx.sender, event.sender);
  for (const channel of ["tools:configure-path", "folders:configure", "ai:import-local-runtime-executable", "ai:import-local-model"]) {
    await handlers.get(channel)(event, channel.startsWith("tools") ? "ffmpeg" : "clipLibrary");
  }
  assert.equal(executed.length, 1, "No action when a picker is cancelled");
  openResult = { canceled: false, filePaths: ["C:/chosen"] };
  await handlers.get("folders:configure")(event, "clipLibrary");
  assert.equal(executed.at(-1).id, "settings.set_folder");
  assert.equal(executed.at(-1).input.selectedPath, "C:/chosen");
  assert.equal(await handlers.get("ai:cancel-setup-download")(event, "download-a"), true);
  await handlers.get("youtube:disconnect")(event);
  assert.equal(executed.at(-1).id, "youtube.disconnect");
  stub("clipRepository", "getClipById", () => ({ id: "clip-a", displayName: "My clip.mp4" }));
  stub("transcriptRepository", "getTranscriptByClipId", () => ({ srtContent: "Saved captions" }));
  stub("workspacePreferences", "getWorkspaceFolderSetting", key => key === "srtOutput" ? "C:/captions" : null);
  const beforeExport = executed.length;
  assert.equal(await handlers.get("transcripts:export-srt")(event, "clip-a"), null);
  assert.equal(saveOptions.defaultPath, path.join("C:/captions", "My clip.srt"));
  assert.equal(executed.length, beforeExport, "Cancelling export does not write to the configured folder");
  saveResult = { canceled: false, filePath: "C:/chosen/renamed.srt" };
  await handlers.get("transcripts:export-srt")(event, "clip-a");
  assert.equal(executed.at(-1).id, "transcripts.export_srt");
  assert.equal(executed.at(-1).input.outputPath, "C:/chosen/renamed.srt");
  stub("workspacePreferences", "getWorkspaceFolderSetting", () => null);
  await handlers.get("transcripts:export-srt")(event, "clip-a");
  assert.equal(saveOptions.defaultPath, "My clip.srt", "Unconfigured exports still suggest the filename");
});
