const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const runtime = require("../dist/electron/services/localAiRuntimeService.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-ai-scheduling-"));
runtime.bootstrapLocalAiRuntime(root);
const original = { fetch: global.fetch, spawn: childProcess.spawn, execFile: childProcess.execFile };
let processes, requests, holdHealth, healthRequests;

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function abortable(gate, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    gate.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for runtime event");
    await new Promise(r => setTimeout(r, 5));
  }
}
function generate(model = "qwen3:14b", options = {}) {
  return runtime.generateLocalAiJson({ preferredModel: model, systemPrompt: "test", userPrompt: "test",
    responseSchema: { type: "object" }, ...options });
}

test.beforeEach(() => {
  processes = []; requests = []; healthRequests = 0; holdHealth = null;
  const runtimeDir = path.join(root, "local-ai", "runtime");
  const modelsDir = path.join(root, "local-ai", "models");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.join(modelsDir, "vision"), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "llama-server.exe"), "fixture");
  for (const name of ["qwen3-14b-instruct-q4_k_m.gguf", "gemma-3-12b-it-q4_k_m.gguf", "qwen3-vl-8b-instruct-q4_k_m.gguf"]) {
    fs.writeFileSync(path.join(modelsDir, name), "fixture");
  }
  fs.writeFileSync(path.join(modelsDir, "vision", "mmproj-qwen3-vl-8b.gguf"), "fixture");
  childProcess.execFile = (_file, _args, _options, callback) => { callback(null, "", ""); };
  childProcess.spawn = (_file, args) => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 900000 + processes.length, exitCode: null, signalCode: null, killed: false,
      args, unref() {}, kill() { this.killed = true; this.exitCode = 0; this.emit("exit", 0); } });
    processes.push(child);
    return child;
  };
  global.fetch = async (url, options) => {
    if (url.endsWith("/health")) {
      healthRequests++;
      if (holdHealth) await abortable(holdHealth.promise, options.signal);
      return { ok: true };
    }
    const body = deferred();
    const request = { body, process: processes.at(-1), input: JSON.parse(options.body), signal: options.signal };
    requests.push(request);
    // Headers arrive immediately; the completion body remains deliberately pending.
    return { ok: true, json: async () => {
      await abortable(body.promise, options.signal);
      return { choices: [{ message: { content: '{"ok":true}' } }] };
    } };
  };
});
test.afterEach(async () => {
  await runtime.disposeLocalAiRuntime();
  global.fetch = original.fetch;
  childProcess.spawn = original.spawn;
  childProcess.execFile = original.execFile;
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("different models hold exclusive ownership through response body consumption", async () => {
  const first = generate();
  await until(() => requests.length === 1);
  const second = generate("gemma3:12b");
  await new Promise(r => setTimeout(r, 20));
  assert.equal(processes.length, 1);
  assert.equal(processes[0].killed, false);
  requests[0].body.resolve();
  await first;
  await until(() => requests.length === 2);
  assert.equal(processes[0].killed, true);
  assert.match(requests[1].process.args.join(" "), /gemma/);
  requests[1].body.resolve();
  const result = await second;
  assert.match(result.model, /gemma/i);
});

test("same-model requests reuse the process but never overlap", async () => {
  const first = generate();
  const second = generate();
  await until(() => requests.length === 1);
  assert.equal(processes.length, 1);
  requests[0].body.resolve();
  await first;
  await until(() => requests.length === 2);
  assert.equal(processes.length, 1);
  requests[1].body.resolve();
  await second;
});

test("cancelling a queued request rejects promptly without cancelling the active owner", async () => {
  const first = generate();
  await until(() => requests.length === 1);
  const controller = new AbortController();
  const cancelled = assert.rejects(generate("gemma3:12b", { signal: controller.signal }), /cancelled/);
  controller.abort();
  await cancelled;
  assert.equal(processes[0].killed, false);
  assert.equal(requests[0].signal.aborted, false);
  const third = generate();
  requests[0].body.resolve(); await first;
  await until(() => requests.length === 2);
  assert.equal(processes.length, 1);
  requests[1].body.resolve(); await third;
});

test("active cancellation stops inference before admitting the next request", async () => {
  const controller = new AbortController();
  const first = assert.rejects(generate("qwen3:14b", { signal: controller.signal }), /cancelled/);
  await until(() => requests.length === 1);
  const second = generate();
  controller.abort(); await first;
  await until(() => requests.length === 2);
  assert.equal(processes[0].killed, true);
  assert.equal(processes.length, 2);
  requests[1].body.resolve(); await second;
});

test("text and vision share ownership and switch projector configuration safely", async () => {
  const first = generate("qwen3-vl-8b-instruct-q4_k_m.gguf");
  await until(() => requests.length === 1);
  const vision = runtime.generateLocalAiVisionJson({ preferredModel: "qwen3-vl-8b-instruct-q4_k_m.gguf",
    systemPrompt: "test", userPrompt: "test", imageDataUrls: ["data:image/png;base64,AA=="], responseSchema: {} });
  assert.equal(processes[0].args.includes("--mmproj"), false);
  requests[0].body.resolve(); await first;
  await until(() => requests.length === 2);
  assert.equal(processes[0].killed, true);
  assert.ok(processes[1].args.includes("--mmproj"));
  assert.equal(requests[1].input.messages[1].content[1].type, "image_url");
  requests[1].body.resolve(); await vision;
});

test("runtime removal waits for the active generation", async () => {
  const first = generate();
  await until(() => requests.length === 1);
  let removed = false;
  const clear = runtime.clearLocalAiRuntimeExecutable().then(() => { removed = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(removed, false);
  assert.equal(processes[0].killed, false);
  requests[0].body.resolve(); await first; await clear;
  assert.equal(processes[0].killed, true);
  assert.equal(fs.existsSync(path.join(root, "local-ai", "runtime", "llama-server.exe")), false);
});

test("shutdown cancels startup and queued work without allowing a late process to start", async () => {
  holdHealth = deferred();
  const first = assert.rejects(generate(), /cancelled/);
  await until(() => healthRequests === 1);
  const second = assert.rejects(generate("gemma3:12b"), /cancelled/);
  const stopping = runtime.disposeLocalAiRuntime();
  await assert.rejects(generate(), /stopping/);
  await Promise.all([first, second, stopping]);
  assert.equal(processes.length, 1);
  assert.equal(processes[0].killed, true);
  assert.equal(requests.length, 0);
});

test("generation timeout includes a delayed body and releases the scheduler", async () => {
  const first = assert.rejects(generate("qwen3:14b", { timeoutMs: 30 }), /timed out/);
  await until(() => requests.length === 1);
  const second = generate();
  await first;
  await until(() => requests.length === 2);
  assert.equal(processes[0].killed, true);
  requests[1].body.resolve(); await second;
});
