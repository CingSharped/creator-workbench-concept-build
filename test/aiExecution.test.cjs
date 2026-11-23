const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const runtime = require("../dist/electron/services/localAiRuntimeService.js");
const ai = require("../dist/electron/services/aiExecutionService.js");
const outcomes = require("../dist/shared/workflowOutcome.js");
const executor = require("../dist/electron/actions/appActionExecutor.js");
const originals = { text: runtime.generateLocalAiJson, vision: runtime.generateLocalAiVisionJson };
const input = () => ({
  task: "youtube_metadata", profileId: "profile-one", preferredModel: "model-one",
  systemPrompt: "Editorial guidance", userPrompt: "Clip evidence",
  responseSchema: { type: "object" }, disableThinking: true, temperature: 0.2, timeoutMs: 12345
});
test.afterEach(() => {
  runtime.generateLocalAiJson = originals.text;
  runtime.generateLocalAiVisionJson = originals.vision;
});

test("text requests preserve schema, model preferences and caller cancellation without adding a queue", async () => {
  const controller = new AbortController();
  const request = { ...input(), fallbackPreferences: ["model-two"], signal: controller.signal };
  const response = { model: "actual-model", responseText: '{"ok":true}', runtimeNotice: "Model fallback", finishReason: "stop" };
  let received, count = 0;
  runtime.generateLocalAiJson = async value => { received = value; count++; return response; };
  assert.deepEqual(await ai.executeAiRequest({ kind: "text", input: request }), { status: "completed", value: response });
  const { task, profileId, ...expected } = request;
  assert.deepEqual(received, expected);
  assert.equal(received.signal, controller.signal);
  assert.equal(count, 1, "No duplicate execution or automatic retries");
});

test("vision uses the same boundary and preserves actual runtime output", async () => {
  const request = { ...input(), task: "youtube_thumbnail", imageDataUrls: ["data:image/png;base64,fixture"] };
  let received;
  runtime.generateLocalAiVisionJson = async value => {
    received = value; return { model: "vision-model", responseText: '{"brief":"Evidence"}', runtimeNotice: null };
  };
  const response = await ai.generateAiVision(request);
  assert.equal(response.model, "vision-model");
  assert.equal(response.finishReason, null);
  assert.deepEqual(received.imageDataUrls, request.imageDataUrls);
  assert.deepEqual(received.responseSchema, request.responseSchema);
});

test("cancellation before dispatch cannot enter the runtime", async () => {
  const controller = new AbortController(); controller.abort();
  runtime.generateLocalAiJson = async () => { assert.fail("Pre-cancelled work must not dispatch"); };
  const outcome = await ai.executeAiRequest({ kind: "text", input: { ...input(), signal: controller.signal } });
  assert.equal(outcome.status, "cancelled");
  assert.throws(() => outcomes.unwrapWorkflowOutcome(outcome), outcomes.WorkflowCancelledError);
});

test("abort during a request and typed/legacy runtime cancellations produce cancelled outcomes", async () => {
  const controller = new AbortController();
  runtime.generateLocalAiJson = async () => { controller.abort(); throw new Error("Request aborted"); };
  assert.equal((await ai.executeAiRequest({ kind: "text", input: { ...input(), signal: controller.signal } })).status, "cancelled");
  for (const error of [new outcomes.WorkflowCancelledError("Stopped by the user"), new Error("Local AI request cancelled.")]) {
    runtime.generateLocalAiJson = async () => { throw error; };
    await assert.rejects(ai.generateAiText(input()), error => error instanceof outcomes.WorkflowCancelledError);
  }
});

test("timeouts, malformed output notices and genuine failures are not relabelled as cancellation", async () => {
  for (const error of [
    new Error("Model unavailable"),
    new Error("Cancellation failed: Local AI request cancelled."),
    Object.assign(new Error("Generation timeout"), { name: "AbortError" })
  ]) {
    runtime.generateLocalAiJson = async () => { throw error; };
    assert.deepEqual(await ai.executeAiRequest({ kind: "text", input: input() }), { status: "failed", message: error.message });
    await assert.rejects(ai.generateAiText(input()), candidate =>
      !(candidate instanceof outcomes.WorkflowCancelledError) && candidate.message === error.message);
  }
  runtime.generateLocalAiJson = async () => ({
    model: "model-one", responseText: "{unfinished", runtimeNotice: null, finishReason: "length"
  });
  assert.equal((await ai.generateAiText(input())).finishReason, "length", "Feature validators still receive truncation evidence");
});

test("preload preserves outcomes through serialized IPC while compatibility methods retain value/error APIs", async () => {
  let mode = "success", api;
  executor.registerAppActionHandler("clips.import", async (input, context) => {
    assert.equal(context.confirmed, true);
    if (mode === "cancel") throw new outcomes.WorkflowCancelledError("Stopped by the user");
    if (mode === "failure") throw new Error("Disk unavailable");
    return { imported: input.filePaths };
  });
  const preloadPath = path.resolve(__dirname, "../dist/electron/preload.js");
  const originalRequire = createRequire(preloadPath);
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "creatorApp"); api = value; } },
    ipcRenderer: {
      invoke: async (channel, actionId, input, options) => {
        assert.equal(channel, "app:action");
        assert.equal(options.returnOutcome, true);
        const outcome = await outcomes.captureWorkflowOutcome(() =>
          executor.executeAppAction(actionId, input, { source: "ui", sender: null, confirmed: options.confirmed }));
        return JSON.parse(JSON.stringify(outcome));
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(preloadPath, "utf8"), {
    exports: {}, require: name => name === "electron" ? electron : originalRequire(name)
  }, { filename: preloadPath });
  const payload = { filePaths: ["clip.mp4"] };
  assert.deepEqual(await api.executeAction("clips.import", payload), { imported: ["clip.mp4"] });
  mode = "cancel";
  assert.deepEqual(await api.executeActionOutcome("clips.import", payload), { status: "cancelled", message: "Stopped by the user" });
  await assert.rejects(api.executeAction("clips.import", payload), outcomes.WorkflowCancelledError);
  mode = "failure";
  assert.deepEqual(await api.executeActionOutcome("clips.import", payload), { status: "failed", message: "Disk unavailable" });
  await assert.rejects(api.executeAction("clips.import", payload), /Disk unavailable/);
  const denied = await api.executeActionOutcome("long_form.approve_proposal", {}, { confirmed: false });
  assert.equal(denied.status, "failed");
  assert.match(denied.message, /requires user confirmation/);
});

test("current feature generation calls go through the AI boundary", () => {
  for (const name of [
    "metadataGenerationService", "longFormClipProposalService", "performanceDashboardService",
    "thumbnailGenerationService", "youtubeMetadataGenerationService"
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "../src/electron/services", name + ".ts"), "utf8");
    assert.match(source, /from "\.\/aiExecutionService"/, name);
    assert.doesNotMatch(source, /import[^;]+generateLocalAi(?:Json|VisionJson)/, name);
  }
});
