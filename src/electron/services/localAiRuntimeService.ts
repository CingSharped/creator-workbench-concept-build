import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFile, link, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { LocalAiScheduler } from "./localAiScheduler";
import { createAiActivityTurn, updateAiActivityTurn } from "./aiActivityService";
import type {
  LocalAiModelRecord,
  LocalAiRuntimeGpuMode,
  LocalAiRuntimeStatus,
  ToolRuntimeSource
} from "../../shared/contracts";

const LOCAL_AI_RUNTIME_ROOT = "local-ai";
const LOCAL_AI_RUNTIME_EXECUTABLE_NAME = "llama-server.exe";
// Model loading should fail quickly enough to surface a broken runtime, while generation
// gets a larger bounded window for the 12B-24B models used by the live AI tasks.
export const LOCAL_AI_RUNTIME_STARTUP_TIMEOUT_MS = 60_000;
export const LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS = 240_000;
const LOCAL_AI_RUNTIME_PORT_BASE = 46731;
const LOCAL_AI_RUNTIME_PORT_SPAN = 12;

interface LocalAiRuntimeContext {
  rootDirectory: string;
  runtimeDirectory: string;
  modelsDirectory: string;
}

interface LocalAiGpuDetection {
  mode: LocalAiRuntimeGpuMode;
  summary: string | null;
  gpuLayers: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
;
type ChatMessageContent = string | ChatMessagePart[];

interface OllamaManifestLayer {
  mediaType?: string;
  digest?: string;
}

interface OllamaManifest {
  layers?: OllamaManifestLayer[];
}

let runtimeContext: LocalAiRuntimeContext | null = null;
let ownedRuntimeProcess: ChildProcess | null = null;
let ownedRuntimePort: number | null = null;
let ownedRuntimeModelId: string | null = null;
let ownedRuntimeConfigKey: string | null = null;
const runtimeScheduler = new LocalAiScheduler();
let lastRuntimeError: string | null = null;
let gpuDetectionPromise: Promise<LocalAiGpuDetection> | null = null;
const activeRuntimeControllers = new Set<AbortController>();

export function bootstrapLocalAiRuntime(userDataPath: string): void {
  if (runtimeContext) {
    return;
  }

  const rootDirectory = path.join(userDataPath, LOCAL_AI_RUNTIME_ROOT);
  runtimeContext = {
    rootDirectory,
    runtimeDirectory: path.join(rootDirectory, "runtime"),
    modelsDirectory: path.join(rootDirectory, "models")
  };
}

export async function getLocalAiRuntimeStatus(): Promise<LocalAiRuntimeStatus> {
  const context = getRuntimeContext();
  await Promise.all([
    mkdir(context.runtimeDirectory, { recursive: true }),
    mkdir(context.modelsDirectory, { recursive: true })
  ]);

  const executablePath = getManagedRuntimeExecutablePath();
  const availableModels = await listManagedModels();
  const gpuDetection = await detectLocalAiGpu();
  const executableSource: ToolRuntimeSource = executablePath ? "workspace" : "missing";
  const health = !executablePath
    ? "needs_runtime"
    : availableModels.length === 0
      ? "needs_model"
      : lastRuntimeError
        ? "error"
        : "ready";
  const statusLabel =
    health === "ready"
      ? "Ready"
      : health === "needs_runtime"
        ? "Runtime needed"
        : health === "needs_model"
          ? "Model needed"
          : "Runtime issue";
  const statusDetail = !executablePath
    ? availableModels.length > 0
      ? "Compatible local models are available, but the app still needs a Windows llama.cpp server executable imported before local AI can run."
      : "Import a Windows llama.cpp server executable and at least one compatible model so Creator Workbench can run its own local AI runtime."
    : availableModels.length === 0
      ? "Import at least one compatible GGUF instruct model into the app-managed local AI library."
      : lastRuntimeError
        ? lastRuntimeError
        : `App-owned llama.cpp runtime is ready with ${availableModels.length} model${availableModels.length === 1 ? "" : "s"}.`;

  return {
    backend: "llama_cpp",
    health,
    statusLabel,
    statusDetail,
    executablePath,
    executableSource,
    managedRootDirectory: context.rootDirectory,
    managedModelsDirectory: context.modelsDirectory,
    availableModels,
    activeModelId: ownedRuntimeModelId,
    gpuMode: gpuDetection.mode,
    gpuSummary: gpuDetection.summary,
    lastError: lastRuntimeError
  };
}

export async function importLocalAiRuntimeExecutable(sourcePath: string): Promise<LocalAiRuntimeStatus> {
  if (!sourcePath.trim()) {
    throw new Error("Choose a llama.cpp server executable to import.");
  }

  const normalizedSourcePath = sourcePath.trim();
  if (path.extname(normalizedSourcePath).toLowerCase() !== ".exe") {
    throw new Error("The local AI runtime must be a Windows executable.");
  }

  return installLocalAiRuntimeBundle(path.dirname(normalizedSourcePath));
}

export async function installLocalAiRuntimeBundle(sourceDirectory: string): Promise<LocalAiRuntimeStatus> {
  return runtimeScheduler.run(() => installLocalAiRuntimeBundleInternal(sourceDirectory));
}

async function installLocalAiRuntimeBundleInternal(sourceDirectory: string): Promise<LocalAiRuntimeStatus> {
  const context = getRuntimeContext();
  const runtimeFiles = await collectRuntimeFiles(sourceDirectory);
  if (!runtimeFiles.some((filePath) => path.basename(filePath).toLowerCase() === LOCAL_AI_RUNTIME_EXECUTABLE_NAME)) {
    throw new Error("The downloaded runtime did not contain llama-server.exe.");
  }

  await terminateOwnedRuntimeProcess();
  await rm(context.runtimeDirectory, { recursive: true, force: true });
  await mkdir(context.runtimeDirectory, { recursive: true });
  for (const filePath of runtimeFiles) {
    await copyFile(filePath, path.join(context.runtimeDirectory, path.basename(filePath)));
  }
  lastRuntimeError = null;
  return getLocalAiRuntimeStatus();
}

export async function clearLocalAiRuntimeExecutable(): Promise<LocalAiRuntimeStatus> {
  return runtimeScheduler.run(clearLocalAiRuntimeExecutableInternal);
}

async function clearLocalAiRuntimeExecutableInternal(): Promise<LocalAiRuntimeStatus> {
  const context = getRuntimeContext();
  await terminateOwnedRuntimeProcess();
  await rm(context.runtimeDirectory, { recursive: true, force: true });
  lastRuntimeError = null;
  return getLocalAiRuntimeStatus();
}

export async function importLocalAiModelFile(sourcePath: string): Promise<LocalAiRuntimeStatus> {
  if (!sourcePath.trim()) {
    throw new Error("Choose a GGUF model file to import.");
  }

  const normalizedSourcePath = sourcePath.trim();
  if (path.extname(normalizedSourcePath).toLowerCase() !== ".gguf") {
    throw new Error("Only GGUF model files can be imported into the local AI library.");
  }

  return installLocalAiModelFile(normalizedSourcePath);
}

export async function installLocalAiModelFile(sourcePath: string): Promise<LocalAiRuntimeStatus> {
  return runtimeScheduler.run(() => installLocalAiModelFileInternal(sourcePath));
}

async function installLocalAiModelFileInternal(sourcePath: string): Promise<LocalAiRuntimeStatus> {
  const context = getRuntimeContext();
  await terminateOwnedRuntimeProcess();
  await mkdir(context.modelsDirectory, { recursive: true });
  await copyFile(sourcePath, path.join(context.modelsDirectory, path.basename(sourcePath)));
  lastRuntimeError = null;
  return getLocalAiRuntimeStatus();
}

async function collectRuntimeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRuntimeFiles(filePath));
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (extension === ".exe" || extension === ".dll") {
      files.push(filePath);
    }
  }
  return files;
}

export async function listLocalAiModels(): Promise<LocalAiModelRecord[]> {
  return listManagedModels();
}

export function generateLocalAiJson(input: Parameters<typeof generateLocalAiJsonInternal>[0]): ReturnType<typeof generateLocalAiJsonInternal> {
  return runGeneration((signal) => generateLocalAiJsonInternal({ ...input, signal }), input.signal, input.preferredModel);
}

async function generateLocalAiJsonInternal(input: {
  preferredModel: string | null;
  fallbackPreferences?: string[];
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  disableThinking?: boolean;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  model: string;
  responseText: string;
  runtimeNotice: string | null;
  finishReason: string | null;
}> {
  throwIfLocalAiAborted(input.signal);
  const executablePath = getManagedRuntimeExecutablePath();
  const models = await listManagedModels();
  if (!executablePath && models.length === 0) {
    throw new Error(
      "No app-owned local AI runtime is configured yet. Import a Windows llama.cpp server executable and at least one compatible model in AI Profiles before running local AI generation."
    );
  }

  if (!executablePath) {
    throw new Error(
      "No app-owned local AI runtime executable is configured yet. Import a Windows llama.cpp server executable in AI Profiles before running local AI generation."
    );
  }

  if (models.length === 0) {
    throw new Error(
      "No app-managed GGUF models are available yet. Import a model in AI Profiles before running local AI generation."
    );
  }

  const modelCandidates = resolvePreferredLocalAiModels(
    models,
    input.preferredModel,
    input.fallbackPreferences ?? []
  );
  if (modelCandidates.length === 0) {
    throw new Error(
      "No compatible app-managed local AI model matched the current profile preference. Refresh the model list or pick a different model in AI Profiles."
    );
  }

  let selectedModel: LocalAiModelRecord | null = null;
  const startupFailures: string[] = [];
  for (const candidate of modelCandidates) {
    try {
      await ensureRuntimeReady(candidate, null, input.signal);
      selectedModel = candidate;
      break;
    } catch (error) {
      if (input.signal?.aborted) {
        throw createLocalAiCancelledError();
      }
      startupFailures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!selectedModel) {
    throw new Error(
      startupFailures.length > 0
        ? startupFailures.join(" ")
        : "The app-owned local AI runtime could not start with any compatible managed model."
    );
  }

  updateAiActivityTurn("generating", selectedModel.label);
  const response = await postRuntimeJson<ChatCompletionResponse>(
    "/v1/chat/completions",
    {
      model: selectedModel.id,
      messages: [
        {
          role: "system",
          content: input.systemPrompt
        },
        {
          role: "user",
          content: input.userPrompt
        }
      ],
      temperature: input.temperature ?? 0.3,
      response_format: {
        type: "json_schema",
        schema: input.responseSchema
      },
      ...(input.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      stream: false
    },
    input.timeoutMs ?? LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS,
    input.signal
  );

  const responseText = extractChatCompletionContent(response);
  if (!responseText) {
    lastRuntimeError = `The local AI runtime returned an empty response for ${selectedModel.label}.`;
    throw new Error(lastRuntimeError);
  }

  lastRuntimeError = null;
  return {
    model: selectedModel.label,
    responseText,
    finishReason: response.choices?.[0]?.finish_reason ?? null,
    runtimeNotice:
      startupFailures.length > 0
        ? `The preferred local AI model failed to start (${startupFailures[0]}). Creator Workbench continued with ${selectedModel.label}.`
        : null
  };
}

export function generateLocalAiVisionJson(input: Parameters<typeof generateLocalAiVisionJsonInternal>[0]): ReturnType<typeof generateLocalAiVisionJsonInternal> {
  return runGeneration((signal) => generateLocalAiVisionJsonInternal({ ...input, signal }), input.signal, input.preferredModel);
}

async function generateLocalAiVisionJsonInternal(input: {
  preferredModel: string | null;
  fallbackPreferences?: string[];
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls: string[];
  responseSchema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{
  model: string;
  responseText: string;
  runtimeNotice: string | null;
}> {
  throwIfLocalAiAborted(input.signal);
  const models = await listManagedModels();
  const modelCandidates = resolvePreferredLocalAiModels(
    models,
    input.preferredModel ?? "qwen3-vl:8b",
    input.fallbackPreferences ?? ["qwen2.5-vl:7b"]
  );
  const startupFailures: string[] = [];

  for (const candidate of modelCandidates) {
    const projectorPath = await findVisionProjector(candidate.fileName);
    if (!projectorPath) {
      continue;
    }

    try {
      await ensureRuntimeReady(candidate, projectorPath, input.signal);
      updateAiActivityTurn("generating", candidate.label);
      const content: ChatMessageContent = [
        { type: "text", text: input.userPrompt },
        ...input.imageDataUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url }
        }))
      ];
      const response = await postRuntimeJson<ChatCompletionResponse>(
        "/v1/chat/completions",
        {
          model: candidate.id,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content }
          ],
          temperature: input.temperature ?? 0.2,
          response_format: {
            type: "json_schema",
            schema: input.responseSchema
          },
          chat_template_kwargs: { enable_thinking: false },
          stream: false
        },
        input.timeoutMs ?? LOCAL_AI_RUNTIME_GENERATION_TIMEOUT_MS,
        input.signal
      );
      const responseText = extractChatCompletionContent(response);
      if (!responseText) {
        throw new Error(`The local vision model returned an empty response for ${candidate.label}.`);
      }

      lastRuntimeError = null;
      return {
        model: candidate.label,
        responseText,
        runtimeNotice: startupFailures.length > 0
          ? `The preferred local vision model failed to start (${startupFailures[0]}). Creator Workbench continued with ${candidate.label}.`
          : null
      };
    } catch (error) {
      if (input.signal?.aborted) {
        throw createLocalAiCancelledError();
      }
      startupFailures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    startupFailures.length > 0
      ? startupFailures.join(" ")
      : "No app-managed Qwen-VL model and matching mmproj projector are available for visual clip analysis."
  );
}

export async function disposeLocalAiRuntime(): Promise<void> {
  return runtimeScheduler.stop(async () => {
    for (const controller of activeRuntimeControllers) controller.abort();
    await terminateOwnedRuntimeProcess();
  });
}

function runGeneration<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, model: string | null = null): Promise<T> {
  const turn = createAiActivityTurn(model);
  return runtimeScheduler.run((ownedSignal) => turn.run(async () => {
    try {
      const result = await work(ownedSignal);
      throwIfLocalAiAborted(ownedSignal);
      return result;
    } catch (error) {
      // An aborted HTTP request does not prove inference has stopped on the server.
      // Stop our process before allowing another generation to acquire the runtime.
      await terminateOwnedRuntimeProcess();
      throw error;
    }
  }), signal, turn.observe);
}

function getRuntimeContext(): LocalAiRuntimeContext {
  if (!runtimeContext) {
    throw new Error("Local AI runtime has not been initialized yet.");
  }

  return runtimeContext;
}

function getManagedRuntimeExecutablePath(): string | null {
  const context = getRuntimeContext();
  const executablePath = path.join(context.runtimeDirectory, LOCAL_AI_RUNTIME_EXECUTABLE_NAME);
  return existsSync(executablePath) ? executablePath : null;
}

async function listManagedModels(): Promise<LocalAiModelRecord[]> {
  const context = getRuntimeContext();
  await mkdir(context.modelsDirectory, { recursive: true });

  let entries = await readdir(context.modelsDirectory, { withFileTypes: true }).catch(() => []);
  if (!entries.some((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".gguf")) {
    await importManagedModelsFromOllamaIfAvailable();
    entries = await readdir(context.modelsDirectory, { withFileTypes: true }).catch(() => []);
  }

  const models: LocalAiModelRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gguf") {
      continue;
    }

    const filePath = path.join(context.modelsDirectory, entry.name);
    const stats = await stat(filePath).catch(() => null);
    const label = buildLocalAiModelLabel(entry.name);
    models.push({
      id: entry.name,
      label,
      fileName: entry.name,
      filePath,
      sizeBytes: stats?.size ?? null,
      modifiedAt: stats ? new Date(stats.mtimeMs).toISOString() : null,
      compatibilityLabel: inferCompatibilityLabel(entry.name),
      source: "managed"
    });
  }

  return models.sort((left, right) => left.label.localeCompare(right.label));
}

async function findVisionProjector(modelFileName: string): Promise<string | null> {
  const context = getRuntimeContext();
  const visionDirectory = path.join(context.modelsDirectory, "vision");
  const entries = await readdir(visionDirectory, { withFileTypes: true }).catch(() => []);
  const modelToken = normalizeModelToken(modelFileName);
  const familyToken = modelToken.includes("qwen3vl8b")
    ? "qwen3vl8b"
    : modelToken.includes("qwen25vl7b")
      ? "qwen25vl7b"
      : null;
  if (!familyToken) {
    return null;
  }

  const projector = entries.find((entry) =>
    entry.isFile() &&
    entry.name.toLowerCase().endsWith(".gguf") &&
    normalizeModelToken(entry.name).includes(`mmproj${familyToken}`)
  );
  return projector ? path.join(visionDirectory, projector.name) : null;
}

async function importManagedModelsFromOllamaIfAvailable(): Promise<void> {
  const context = getRuntimeContext();
  const ollamaModelsRoot = getOllamaModelsRootPath();
  const manifestsRoot = path.join(ollamaModelsRoot, "manifests", "registry.ollama.ai", "library");
  const blobsRoot = path.join(ollamaModelsRoot, "blobs");
  if (!existsSync(manifestsRoot) || !existsSync(blobsRoot)) {
    return;
  }

  const families = await readdir(manifestsRoot, { withFileTypes: true }).catch(() => []);
  for (const family of families) {
    if (!family.isDirectory()) {
      continue;
    }

    const familyPath = path.join(manifestsRoot, family.name);
    const tags = await readdir(familyPath, { withFileTypes: true }).catch(() => []);
    for (const tag of tags) {
      if (!tag.isFile()) {
        continue;
      }

      const destinationPath = path.join(
        context.modelsDirectory,
        `${family.name}-${tag.name}.gguf`
      );
      if (existsSync(destinationPath)) {
        continue;
      }

      const manifestPath = path.join(familyPath, tag.name);
      const modelBlobPath = await resolveOllamaModelBlobPath(manifestPath, blobsRoot);
      if (!modelBlobPath) {
        continue;
      }

      try {
        await link(modelBlobPath, destinationPath);
      } catch {
        try {
          await copyFile(modelBlobPath, destinationPath);
        } catch {
          // Ignore best-effort migration failures and leave the model unimported.
        }
      }
    }
  }
}

async function resolveOllamaModelBlobPath(
  manifestPath: string,
  blobsRoot: string
): Promise<string | null> {
  const rawManifest = await readFile(manifestPath, "utf8").catch(() => "");
  if (!rawManifest.trim()) {
    return null;
  }

  const parsed = safeJsonParse(rawManifest) as OllamaManifest | null;
  const digest = parsed?.layers?.find(
    (layer) => layer.mediaType === "application/vnd.ollama.image.model" && typeof layer.digest === "string"
  )?.digest;
  if (!digest) {
    return null;
  }

  const blobPath = path.join(blobsRoot, digest.replace(":", "-"));
  return existsSync(blobPath) ? blobPath : null;
}

function getOllamaModelsRootPath(): string {
  return process.env.OLLAMA_MODELS ?? path.join(os.homedir(), ".ollama", "models");
}

function buildLocalAiModelLabel(fileName: string): string {
  return path
    .parse(fileName)
    .name
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCompatibilityLabel(fileName: string): string | null {
  const normalized = normalizeModelToken(fileName);
  if (normalized.includes("gemma3") && normalized.includes("12b")) {
    return "gemma3:12b";
  }
  if (normalized.includes("gemma3") && normalized.includes("4b")) {
    return "gemma3:4b";
  }
  if (normalized.includes("gemma4") && normalized.includes("e4b")) {
    return "gemma4:e4b";
  }
  if (normalized.includes("qwen3") && normalized.includes("14b")) {
    return "qwen3:14b";
  }
  if (normalized.includes("qwen3") && normalized.includes("8b")) {
    return "qwen3:8b";
  }
  if ((normalized.includes("mistralsmall") || normalized.includes("mistral-small")) && normalized.includes("24b")) {
    return "mistral-small:24b";
  }
  if (normalized.includes("llama31") && normalized.includes("8b")) {
    return "llama3.1:8b";
  }

  return null;
}

function resolvePreferredLocalAiModels(
  models: LocalAiModelRecord[],
  preferredModel: string | null,
  fallbackPreferences: string[]
): LocalAiModelRecord[] {
  const candidates = [preferredModel, ...fallbackPreferences].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const matches: LocalAiModelRecord[] = [];
  const addMatch = (model: LocalAiModelRecord | null): void => {
    if (model && !matches.some((existing) => existing.id === model.id)) {
      matches.push(model);
    }
  };

  for (const candidate of candidates) {
    addMatch(findExactModelMatch(models, candidate));
  }

  for (const candidate of candidates) {
    addMatch(findFuzzyModelMatch(models, candidate));
  }

  if (matches.length === 0 && models[0]) {
    matches.push(models[0]);
  }

  return matches;
}

function findExactModelMatch(models: LocalAiModelRecord[], candidate: string): LocalAiModelRecord | null {
  const normalizedCandidate = normalizeModelToken(candidate);
  return (
    models.find((model) => normalizeModelToken(model.id) === normalizedCandidate) ??
    models.find((model) => normalizeModelToken(model.label) === normalizedCandidate) ??
    models.find((model) => normalizeModelToken(model.compatibilityLabel ?? "") === normalizedCandidate) ??
    null
  );
}

function findFuzzyModelMatch(models: LocalAiModelRecord[], candidate: string): LocalAiModelRecord | null {
  const normalizedCandidate = normalizeModelToken(candidate);
  const expectedTokens = buildModelMatchTokens(normalizedCandidate);
  if (expectedTokens.length === 0) {
    return null;
  }

  return (
    models.find((model) => {
      const haystack = [
        normalizeModelToken(model.id),
        normalizeModelToken(model.label),
        normalizeModelToken(model.compatibilityLabel ?? "")
      ].join(" ");

      return expectedTokens.every((token) => haystack.includes(token));
    }) ?? null
  );
}

function buildModelMatchTokens(value: string): string[] {
  const baseTokens = value.split(/[^a-z0-9]+/).filter(Boolean);
  if (value.includes("gemma3")) {
    return [...new Set([...baseTokens, "gemma", "3"])];
  }
  if (value.includes("qwen3")) {
    return [...new Set([...baseTokens, "qwen", "3"])];
  }
  if (value.includes("llama31")) {
    return [...new Set([...baseTokens, "llama", "31"])];
  }
  return [...new Set(baseTokens)];
}

function normalizeModelToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function ensureRuntimeReady(
  model: LocalAiModelRecord,
  projectorPath: string | null = null,
  signal?: AbortSignal
): Promise<void> {
  throwIfLocalAiAborted(signal);
  const configKey = buildRuntimeConfigKey(model, projectorPath);
  updateAiActivityTurn("loading", model.label);
  if (ownedRuntimeConfigKey === configKey && ownedRuntimePort !== null && (await isRuntimeReachable(ownedRuntimePort, signal))) {
    throwIfLocalAiAborted(signal);
    return;
  }

  await startRuntimeForModel(model, projectorPath, signal);
  throwIfLocalAiAborted(signal);
  if (ownedRuntimeConfigKey !== configKey || ownedRuntimePort === null) {
    throw new Error("The local AI runtime configuration changed before generation.");
  }
}

async function startRuntimeForModel(model: LocalAiModelRecord, projectorPath: string | null = null, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw createLocalAiCancelledError();
  }

  const executablePath = getManagedRuntimeExecutablePath();
  if (!executablePath) {
    lastRuntimeError =
      "Creator Workbench could not start local AI because no app-managed llama.cpp runtime executable is installed.";
    throw new Error(lastRuntimeError);
  }

  await terminateOwnedRuntimeProcess();

  const gpuDetection = await detectLocalAiGpu();
  const port = await findAvailablePort();
  throwIfLocalAiAborted(signal);
  const runtimeArgs = [
    "-m",
    model.filePath,
    ...(projectorPath ? ["--mmproj", projectorPath] : []),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--ctx-size",
    "8192",
    "--n-gpu-layers",
    String(gpuDetection.gpuLayers)
  ];
  const child = spawn(
    executablePath,
    runtimeArgs,
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  const startupFailure = { message: null as string | null };
  child.once("error", (error) => {
    startupFailure.message = error instanceof Error ? error.message : String(error);
  });
  child.unref();
  child.once("exit", () => {
    if (ownedRuntimeProcess?.pid === child.pid) {
      ownedRuntimeProcess = null;
      ownedRuntimePort = null;
      ownedRuntimeModelId = null;
      ownedRuntimeConfigKey = null;
    }
  });

  ownedRuntimeProcess = child;
  ownedRuntimePort = port;
  ownedRuntimeModelId = model.id;
  ownedRuntimeConfigKey = buildRuntimeConfigKey(model, projectorPath);

  const deadline = Date.now() + LOCAL_AI_RUNTIME_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await terminateOwnedRuntimeProcess();
      throw createLocalAiCancelledError();
    }
    if (await isRuntimeReachable(port, signal)) {
      throwIfLocalAiAborted(signal);
      lastRuntimeError = null;
      return;
    }

    if (startupFailure.message) {
      lastRuntimeError =
        `The app-owned local AI runtime could not start for ${model.label}: ${startupFailure.message}`;
      throw new Error(lastRuntimeError);
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      const exitDetail =
        child.exitCode !== null
          ? `exit code ${child.exitCode}`
          : `signal ${child.signalCode ?? "unknown"}`;
      lastRuntimeError =
        `The app-owned local AI runtime exited before becoming ready for ${model.label} (${exitDetail}).`;
      throw new Error(lastRuntimeError);
    }

    if (ownedRuntimeProcess !== child) {
      lastRuntimeError =
        `The app-owned local AI runtime stopped before becoming ready for ${model.label}.`;
      throw new Error(lastRuntimeError);
    }

    await delay(750);
  }

  lastRuntimeError =
    `Creator Workbench started llama.cpp for ${model.label}, but the local runtime never became ready.`;
  throw new Error(lastRuntimeError);
}

async function detectLocalAiGpu(): Promise<LocalAiGpuDetection> {
  if (!gpuDetectionPromise) {
    gpuDetectionPromise = detectLocalAiGpuInternal().catch(() => ({
      mode: "auto" as const,
      summary: "GPU detection failed, so the local AI runtime will stay on conservative auto defaults.",
      gpuLayers: 0
    }));
  }

  return gpuDetectionPromise;
}

async function detectLocalAiGpuInternal(): Promise<LocalAiGpuDetection> {
  if (process.platform !== "win32") {
    return {
      mode: "auto",
      summary: "GPU auto-detection is only configured for Windows in this milestone.",
      gpuLayers: 0
    };
  }

  const nvidiaNames = await new Promise<string[]>((resolve) => {
    execFile(
      "nvidia-smi.exe",
      ["--query-gpu=name", "--format=csv,noheader"],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        );
      }
    );
  });

  if (nvidiaNames.length > 0) {
    return {
      mode: "auto",
      summary: "Detected GPU: " + nvidiaNames.join(", ") + " via the NVIDIA driver. Creator Workbench will request maximum safe offload by default.",
      gpuLayers: 999
    };
  }

  const names = await new Promise<string[]>((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        resolve(
          stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        );
      }
    );
  });

  const dedicatedGpuName = names.find(isHardwareAcceleratedGpuName);

  if (dedicatedGpuName) {
    return {
      mode: "auto",
      summary: "Detected GPU: " + dedicatedGpuName + ". Creator Workbench will request maximum safe offload by default.",
      gpuLayers: 999
    };
  }

  if (names.length > 0) {
    return {
      mode: "auto",
      summary: `Detected GPU: ${names[0]}. Creator Workbench will stay on conservative auto defaults for this runtime build.`,
      gpuLayers: 0
    };
  }

  return {
    mode: "auto",
    summary: "No GPU information was detected, so the local AI runtime will run with CPU-safe defaults.",
    gpuLayers: 0
  };
}

function isHardwareAcceleratedGpuName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    (normalizedName.includes("nvidia") ||
      normalizedName.includes("geforce") ||
      normalizedName.includes("radeon") ||
      normalizedName.includes("arc")) &&
    !normalizedName.includes("basic render") &&
    !normalizedName.includes("virtual")
  );
}

async function findAvailablePort(): Promise<number> {
  for (let offset = 0; offset < LOCAL_AI_RUNTIME_PORT_SPAN; offset += 1) {
    const port = LOCAL_AI_RUNTIME_PORT_BASE + offset;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error("Creator Workbench could not reserve a local port for the app-owned AI runtime.");
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function isRuntimeReachable(port: number, signal?: AbortSignal): Promise<boolean> {
  const response = await fetchWithTimeout(
    `http://127.0.0.1:${port}/health`,
    {
      method: "GET"
    },
    5000,
    async (response) => response.ok,
    signal
  ).catch(() => null);

  return Boolean(response);
}

async function postRuntimeJson<T>(route: string, body: object, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (ownedRuntimePort === null) {
    throw new Error("The app-owned local AI runtime is not running yet.");
  }

  return fetchWithTimeout(
    `http://127.0.0.1:${ownedRuntimePort}${route}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer no-key"
      },
      body: JSON.stringify(body)
    },
    timeoutMs,
    async (response) => {
      if (!response.ok) {
        const detail = extractRuntimeErrorDetail(await response.text());
        throw new Error(`The local AI runtime request failed with status ${response.status}${detail ? `: ${detail}` : "."}`);
      }
      return (await response.json()) as T;
    },
    signal
  );
}

function extractRuntimeErrorDetail(rawDetail: string): string | null {
  const trimmed = rawDetail.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = safeJsonParse(trimmed) as { error?: unknown; message?: unknown } | null;
  const detail = parsed && typeof parsed.error === "string"
    ? parsed.error
    : parsed && typeof parsed.message === "string"
      ? parsed.message
      : trimmed;
  return detail.replace(/\s+/g, " ").slice(0, 500);
}

async function fetchWithTimeout<T>(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  activeRuntimeControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const handleExternalAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });
    return await consume(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw createLocalAiCancelledError();
      }
      throw new Error(`The local AI runtime timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
    activeRuntimeControllers.delete(controller);
  }
}

function throwIfLocalAiAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createLocalAiCancelledError();
  }
}

function createLocalAiCancelledError(): Error {
  return new Error("Local AI request cancelled.");
}

function extractChatCompletionContent(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

async function terminateOwnedRuntimeProcess(): Promise<void> {
  const ownedProcess = ownedRuntimeProcess;
  ownedRuntimeProcess = null;
  ownedRuntimePort = null;
  ownedRuntimeModelId = null;
  ownedRuntimeConfigKey = null;

  if (!ownedProcess?.pid || ownedProcess.exitCode !== null || ownedProcess.killed) {
    return;
  }

  try {
    ownedProcess.kill();
  } catch {
    // Ignore and fall through to taskkill if needed.
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile(
        "taskkill",
        ["/PID", String(ownedProcess.pid), "/T", "/F"],
        { windowsHide: true },
        () => resolve()
      );
    });
    return;
  }

  await delay(250);
  if (ownedProcess.exitCode === null && !ownedProcess.killed) {
    try {
      process.kill(ownedProcess.pid, "SIGKILL");
    } catch {
      // Ignore best-effort cleanup failures.
    }
  }
}

function buildRuntimeConfigKey(model: LocalAiModelRecord, projectorPath: string | null): string {
  return JSON.stringify([path.resolve(model.filePath), projectorPath ? path.resolve(projectorPath) : null]);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
