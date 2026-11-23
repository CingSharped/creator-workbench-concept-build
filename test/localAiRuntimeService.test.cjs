const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bootstrapLocalAiRuntime,
  clearLocalAiRuntimeExecutable,
  disposeLocalAiRuntime,
  generateLocalAiJson,
  getLocalAiRuntimeStatus,
  importLocalAiModelFile,
  importLocalAiRuntimeExecutable,
  LOCAL_AI_RUNTIME_STARTUP_TIMEOUT_MS,
  LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS
} = require("../dist/electron/services/localAiRuntimeService.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-local-ai-runtime-test-"));
bootstrapLocalAiRuntime(tempRoot);

test.beforeEach(async () => {
  await disposeLocalAiRuntime();
  fs.rmSync(path.join(tempRoot, "local-ai"), { recursive: true, force: true });
  process.env.OLLAMA_MODELS = path.join(tempRoot, "empty-ollama-models");
  fs.rmSync(process.env.OLLAMA_MODELS, { recursive: true, force: true });
  fs.mkdirSync(process.env.OLLAMA_MODELS, { recursive: true });
});

test("keeps startup and generation timeouts separate and bounded", { concurrency: false }, () => {
  assert.equal(LOCAL_AI_RUNTIME_STARTUP_TIMEOUT_MS, 60_000);
  assert.equal(LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS, 240_000);
  assert.ok(LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS > LOCAL_AI_RUNTIME_STARTUP_TIMEOUT_MS);
  assert.ok(LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS <= 5 * 60_000);
});

test("reports missing runtime before imports", { concurrency: false }, async () => {
  const status = await getLocalAiRuntimeStatus();

  assert.equal(status.health, "needs_runtime");
  assert.equal(status.availableModels.length, 0);
  assert.equal(status.executablePath, null);
});

test("imports a managed runtime executable and GGUF model", { concurrency: false }, async () => {
  const sourceRuntimePath = path.join(tempRoot, "downloads", "llama-server.exe");
  const sourceModelPath = path.join(tempRoot, "downloads", "gemma-3-12b-it-q4_k_m.gguf");

  fs.mkdirSync(path.dirname(sourceRuntimePath), { recursive: true });
  fs.writeFileSync(sourceRuntimePath, "fake-runtime", "utf8");
  fs.writeFileSync(sourceModelPath, "fake-model", "utf8");

  await importLocalAiRuntimeExecutable(sourceRuntimePath);
  const runtimeOnlyStatus = await getLocalAiRuntimeStatus();
  assert.equal(runtimeOnlyStatus.health, "needs_model");
  assert.equal(path.basename(runtimeOnlyStatus.executablePath), "llama-server.exe");

  await importLocalAiModelFile(sourceModelPath);
  const readyStatus = await getLocalAiRuntimeStatus();

  assert.equal(readyStatus.health, "ready");
  assert.equal(readyStatus.availableModels.length, 1);
  assert.equal(readyStatus.availableModels[0].compatibilityLabel, "gemma3:12b");
  assert.equal(
    fs.existsSync(path.join(readyStatus.managedModelsDirectory, "gemma-3-12b-it-q4_k_m.gguf")),
    true
  );
});

test("clears the managed runtime executable without removing imported models", { concurrency: false }, async () => {
  const sourceRuntimePath = path.join(tempRoot, "downloads", "llama-server.exe");
  const sourceModelPath = path.join(tempRoot, "downloads", "qwen3-14b-instruct-q4_k_m.gguf");

  fs.mkdirSync(path.dirname(sourceRuntimePath), { recursive: true });
  fs.writeFileSync(sourceRuntimePath, "fake-runtime", "utf8");
  fs.writeFileSync(sourceModelPath, "fake-model", "utf8");

  await importLocalAiRuntimeExecutable(sourceRuntimePath);
  await importLocalAiModelFile(sourceModelPath);
  const clearedStatus = await clearLocalAiRuntimeExecutable();

  assert.equal(clearedStatus.health, "needs_runtime");
  assert.equal(clearedStatus.availableModels.length, 1);
  assert.equal(clearedStatus.executablePath, null);
});

test("auto-imports compatible models from an Ollama model store when the managed library is empty", { concurrency: false }, async () => {
  const ollamaModelsRoot = path.join(tempRoot, "ollama-models");
  const manifestDirectory = path.join(
    ollamaModelsRoot,
    "manifests",
    "registry.ollama.ai",
    "library",
    "gemma3"
  );
  const blobsDirectory = path.join(ollamaModelsRoot, "blobs");
  const blobDigest = "sha256:e8ad13eff07a78d89926e9e8b882317d082ef5bf9768ad7b50fcdbbcd63748de";

  fs.mkdirSync(manifestDirectory, { recursive: true });
  fs.mkdirSync(blobsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDirectory, "12b"),
    JSON.stringify({
      layers: [
        {
          mediaType: "application/vnd.ollama.image.model",
          digest: blobDigest
        }
      ]
    }),
    "utf8"
  );
  fs.writeFileSync(path.join(blobsDirectory, blobDigest.replace(":", "-")), "fake-model", "utf8");
  process.env.OLLAMA_MODELS = ollamaModelsRoot;

  const status = await getLocalAiRuntimeStatus();

  assert.equal(status.availableModels.length, 1);
  assert.equal(status.availableModels[0].compatibilityLabel, "gemma3:12b");
  assert.equal(
    fs.existsSync(path.join(status.managedModelsDirectory, "gemma3-12b.gguf")),
    true
  );
});

test("reports the runtime executable blocker before model generation when only migrated models exist", { concurrency: false }, async () => {
  const ollamaModelsRoot = path.join(tempRoot, "ollama-models");
  const manifestDirectory = path.join(
    ollamaModelsRoot,
    "manifests",
    "registry.ollama.ai",
    "library",
    "qwen3"
  );
  const blobsDirectory = path.join(ollamaModelsRoot, "blobs");
  const blobDigest = "sha256:a8cc1361f3145dc01f6d77c6c82c9116b9ffe3c97b34716fe20418455876c40e";

  fs.mkdirSync(manifestDirectory, { recursive: true });
  fs.mkdirSync(blobsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDirectory, "14b"),
    JSON.stringify({
      layers: [
        {
          mediaType: "application/vnd.ollama.image.model",
          digest: blobDigest
        }
      ]
    }),
    "utf8"
  );
  fs.writeFileSync(path.join(blobsDirectory, blobDigest.replace(":", "-")), "fake-model", "utf8");
  process.env.OLLAMA_MODELS = ollamaModelsRoot;

  await assert.rejects(
    () =>
      generateLocalAiJson({
        preferredModel: null,
        systemPrompt: "test",
        userPrompt: "test",
        responseSchema: {
          type: "object",
          properties: {
            ok: {
              type: "boolean"
            }
          },
          required: ["ok"]
        }
      }),
    /No app-owned local AI runtime executable is configured yet/
  );
});

test("reports an early runtime process exit without dereferencing cleared process state", { concurrency: false }, async () => {
  const sourceRuntimePath = path.join(tempRoot, "downloads", "llama-server.exe");
  const sourceModelPath = path.join(tempRoot, "downloads", "qwen3-14b-instruct-q4_k_m.gguf");

  fs.mkdirSync(path.dirname(sourceRuntimePath), { recursive: true });
  fs.copyFileSync(process.execPath, sourceRuntimePath);
  fs.writeFileSync(sourceModelPath, "fake-model", "utf8");

  await importLocalAiRuntimeExecutable(sourceRuntimePath);
  await importLocalAiModelFile(sourceModelPath);

  await assert.rejects(
    () =>
      generateLocalAiJson({
        preferredModel: "qwen3-14b-instruct-q4_k_m.gguf",
        systemPrompt: "test",
        userPrompt: "test",
        responseSchema: {
          type: "object",
          properties: {
            ok: {
              type: "boolean"
            }
          },
          required: ["ok"]
        }
      }),
    /app-owned local AI runtime exited before becoming ready|could not start for/
  );
});

test("tries the next configured local model after a preferred model startup failure", { concurrency: false }, async () => {
  const sourceRuntimePath = path.join(tempRoot, "downloads", "llama-server.exe");
  const preferredModelPath = path.join(tempRoot, "downloads", "gemma-3-12b-it-q4_k_m.gguf");
  const fallbackModelPath = path.join(tempRoot, "downloads", "qwen3-14b-instruct-q4_k_m.gguf");

  fs.mkdirSync(path.dirname(sourceRuntimePath), { recursive: true });
  fs.copyFileSync(process.execPath, sourceRuntimePath);
  fs.writeFileSync(preferredModelPath, "fake-preferred-model", "utf8");
  fs.writeFileSync(fallbackModelPath, "fake-fallback-model", "utf8");

  await importLocalAiRuntimeExecutable(sourceRuntimePath);
  await importLocalAiModelFile(preferredModelPath);
  await importLocalAiModelFile(fallbackModelPath);

  await assert.rejects(
    () =>
      generateLocalAiJson({
        preferredModel: "gemma3:12b",
        fallbackPreferences: ["qwen3:14b"],
        systemPrompt: "test",
        userPrompt: "test",
        responseSchema: {
          type: "object",
          properties: {
            ok: {
              type: "boolean"
            }
          },
          required: ["ok"]
        }
      }),
    /gemma.*qwen3|qwen3.*gemma/i
  );
});
