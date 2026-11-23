import { execFile, spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  TranscriptionBackend,
  ToolRuntimeSource,
  ToolRuntimeStatus,
  ToolSettingKey,
  TranscriptionBackendPreference,
  TranscriptionRuntimeStatus
} from "../../shared/contracts";
import { getAppSetting, setAppSetting } from "./settingsRepository";

const execFileAsync = promisify(execFile);

const TOOL_ENV_VARS: Record<ToolSettingKey, string | null> = {
  ffmpeg: "CREATOR_WORKSPACE_FFMPEG_PATH",
  ffprobe: "CREATOR_WORKSPACE_FFPROBE_PATH",
  whisper: "CREATOR_WORKSPACE_WHISPER_PATH",
  whisperModel: "CREATOR_WORKSPACE_WHISPER_MODEL_PATH"
};

const TOOL_SETTING_KEYS: Record<ToolSettingKey, string> = {
  ffmpeg: "tool.ffmpeg_path",
  ffprobe: "tool.ffprobe_path",
  whisper: "tool.whisper_path",
  whisperModel: "tool.whisper_model_path"
};

const WHISPER_BACKEND_SETTING = "tool.whisper_backend";
const WHISPER_CUDA_PATH_SETTING = "tool.whisper_cuda_path";
const WHISPER_CUDA_MODEL_PATH_SETTING = "tool.whisper_cuda_model_path";
const WHISPER_CPU_PATH_SETTING = "tool.whisper_cpu_path";
const WHISPER_CPU_MODEL_PATH_SETTING = "tool.whisper_cpu_model_path";

const TOOL_BINARY_NAMES: Partial<Record<ToolSettingKey, string[]>> = {
  ffmpeg: ["ffmpeg"],
  ffprobe: ["ffprobe"],
  whisper: ["whisper-cli", "whisper"]
};

const WORKSPACE_ROOT = process.cwd();
const TOOL_WORKSPACE_SEARCH_ROOTS: Record<ToolSettingKey, string> = {
  ffmpeg: path.join(WORKSPACE_ROOT, ".local-tools", "ffmpeg"),
  ffprobe: path.join(WORKSPACE_ROOT, ".local-tools", "ffmpeg"),
  whisper: path.join(WORKSPACE_ROOT, ".local-tools", "whisper.cpp"),
  whisperModel: path.join(WORKSPACE_ROOT, ".local-models", "whisper")
};

const BUNDLED_CORE_PACK_ROOT = typeof process.resourcesPath === "string"
  ? path.join(process.resourcesPath, "core-pack")
  : null;

const WHISPER_CUDA_ENV_PATH = "CREATOR_WORKSPACE_WHISPER_CUDA_PATH";
const WHISPER_CUDA_ENV_MODEL_PATH = "CREATOR_WORKSPACE_WHISPER_CUDA_MODEL_PATH";
const WHISPER_CPU_ENV_PATH = "CREATOR_WORKSPACE_WHISPER_CPU_PATH";
const WHISPER_CPU_ENV_MODEL_PATH = "CREATOR_WORKSPACE_WHISPER_CPU_MODEL_PATH";

export async function findBinary(binaryNames: string[]): Promise<string | null> {
  for (const binaryName of binaryNames) {
    const resolvedPath = await resolveBinary(binaryName);
    if (resolvedPath) {
      return resolvedPath;
    }
  }

  return null;
}

export async function getToolRuntimeStatus(tool: ToolSettingKey): Promise<ToolRuntimeStatus> {
  const configuredEnvPath = readConfiguredEnvPath(tool);
  if (configuredEnvPath) {
    return {
      available: await pathExists(configuredEnvPath),
      resolvedPath: configuredEnvPath,
      source: "env"
    };
  }

  const configuredSettingPath = getAppSetting(TOOL_SETTING_KEYS[tool])?.trim();
  if (configuredSettingPath) {
    return {
      available: await pathExists(configuredSettingPath),
      resolvedPath: configuredSettingPath,
      source: "setting"
    };
  }

  const bundledPath = await findBundledCorePackPath(tool);
  if (bundledPath) {
    return {
      available: true,
      resolvedPath: bundledPath,
      source: "bundled"
    };
  }

  const workspaceLocalPath = await findWorkspaceLocalToolPath(tool);
  if (workspaceLocalPath) {
    return {
      available: true,
      resolvedPath: workspaceLocalPath,
      source: "workspace"
    };
  }

  const candidateNames = TOOL_BINARY_NAMES[tool];
  if (candidateNames) {
    const resolvedPath = await findBinary(candidateNames);
    return {
      available: Boolean(resolvedPath),
      resolvedPath,
      source: resolvedPath ? "path" : "missing"
    };
  }

  return {
    available: false,
    resolvedPath: null,
    source: "missing"
  };
}

export async function getWhisperRuntimeSelection(): Promise<TranscriptionRuntimeStatus> {
  const preference = readTranscriptionBackendPreference();
  const [cudaRuntime, cudaModel, cpuRuntime, cpuModel] = await Promise.all([
    getWhisperBackendRuntimeStatus("cuda"),
    getWhisperBackendModelStatus("cuda"),
    getWhisperBackendRuntimeStatus("cpu"),
    getWhisperBackendModelStatus("cpu")
  ]);
  const cudaReady = cudaRuntime.available && cudaModel.available;
  const cpuReady = cpuRuntime.available && cpuModel.available;

  const decision = chooseWhisperBackend(preference, cudaReady, cpuReady);
  let activeBackend = decision.activeBackend;
  let runtime = missingRuntimeStatus();
  let model = missingRuntimeStatus();
  let statusDetail = decision.statusDetail;

  if (activeBackend === "cuda") {
    runtime = cudaRuntime;
    model = cudaModel;
  } else if (activeBackend === "cpu") {
    runtime = cpuRuntime;
    model = cpuModel;
  } else if (cudaRuntime.available || cudaModel.available || cpuRuntime.available || cpuModel.available) {
    statusDetail = preference === "cpu"
      ? "CPU was requested, but its executable/model pair is incomplete; configure both before transcribing."
      : preference === "cuda"
        ? "CUDA was requested, but its executable/model pair is incomplete; configure both before transcribing."
        : "A Whisper runtime or model is present, but no complete executable/model pair is available.";
  }

  const statusLabel = activeBackend === "cuda"
    ? "CUDA active"
    : activeBackend === "cpu"
      ? "CPU active"
      : "Whisper unavailable";

  return {
    preference,
    activeBackend,
    statusLabel,
    statusDetail,
    runtime,
    model,
    cudaRuntime,
    cudaModel,
    cpuRuntime,
    cpuModel
  };
}

export function chooseWhisperBackend(
  preference: TranscriptionBackendPreference,
  cudaReady: boolean,
  cpuReady: boolean
): { activeBackend: TranscriptionBackend; statusDetail: string } {
  if (preference === "cuda" && cudaReady) {
    return { activeBackend: "cuda", statusDetail: "CUDA Whisper is selected for transcription." };
  }

  if (preference === "cpu" && cpuReady) {
    return { activeBackend: "cpu", statusDetail: "CPU Whisper is selected for transcription." };
  }

  if (preference === "auto" && cudaReady) {
    return {
      activeBackend: "cuda",
      statusDetail: "Auto mode selected CUDA Whisper because a complete CUDA runtime/model pair is available."
    };
  }

  if (cpuReady) {
    return {
      activeBackend: "cpu",
      statusDetail: preference === "cuda"
        ? "CUDA was requested but is unavailable; CPU Whisper fallback is active."
        : "CPU Whisper fallback is active because CUDA is unavailable."
    };
  }

  return {
    activeBackend: "missing",
    statusDetail: "No complete Whisper runtime/model pair is available."
  };
}

export function setWhisperBackendPreference(preference: TranscriptionBackendPreference): void {
  if (!["auto", "cuda", "cpu"].includes(preference)) {
    throw new Error("Unsupported Whisper backend preference.");
  }

  setAppSetting(WHISPER_BACKEND_SETTING, preference);
}

export interface RunProcessOptions {
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export async function runProcess(
  command: string,
  args: string[],
  cwd?: string,
  options: RunProcessOptions = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let settled = false;
    let cancelled = false;

    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", handleAbort);
    };

    const handleAbort = (): void => {
      cancelled = true;
      child.kill();
    };

    if (options.signal?.aborted) {
      child.kill();
      reject(new Error("Process cancelled."));
      return;
    }

    options.signal?.addEventListener("abort", handleAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      options.onStdout?.(chunk.toString());
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancelled) {
        reject(new Error("Process cancelled."));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim();
      reject(new Error(detail ? detail : `Process exited with code ${code ?? "unknown"}.`));
    });
  });
}

export function getToolSettingStorageKey(tool: ToolSettingKey): string {
  return TOOL_SETTING_KEYS[tool];
}

async function resolveBinary(binaryName: string): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which";

  try {
    const { stdout } = await execFileAsync(locator, [binaryName]);
    const firstMatch = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    return firstMatch ?? null;
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readConfiguredEnvPath(tool: ToolSettingKey): string | null {
  const envVarName = TOOL_ENV_VARS[tool];
  if (!envVarName) {
    return null;
  }

  const value = process.env[envVarName]?.trim();
  return value ? value : null;
}

function readTranscriptionBackendPreference(): TranscriptionBackendPreference {
  const value = getAppSetting(WHISPER_BACKEND_SETTING)?.trim().toLowerCase();
  return value === "cuda" || value === "cpu" ? value : "auto";
}

async function getWhisperBackendRuntimeStatus(
  backend: "cuda" | "cpu"
): Promise<ToolRuntimeStatus> {
  const configuredPath = readConfiguredPath(
    backend === "cuda" ? WHISPER_CUDA_PATH_SETTING : WHISPER_CPU_PATH_SETTING,
    backend === "cuda" ? WHISPER_CUDA_ENV_PATH : WHISPER_CPU_ENV_PATH
  );
  if (configuredPath) {
    return configuredPathStatus(configuredPath.path, configuredPath.source);
  }

  const genericStatus = await getToolRuntimeStatus("whisper");
  if (genericStatus.resolvedPath && await isWhisperBackendPath(genericStatus.resolvedPath, backend)) {
    return genericStatus;
  }

  const matches = await collectWorkspaceMatches(TOOL_WORKSPACE_SEARCH_ROOTS.whisper, "whisper");
  const workspaceMatch = (
    await Promise.all(matches.map(async (match) => ({
      match,
      compatible: await isWhisperBackendPath(match, backend)
    })))
  )
    .filter((entry) => entry.compatible)
    .map((entry) => entry.match)
    .sort((left, right) => left.localeCompare(right))[0];
  if (workspaceMatch) {
    return configuredPathStatus(workspaceMatch, "workspace");
  }

  const pathMatch = await findBinary(["whisper-cli"]);
  if (pathMatch && await isWhisperBackendPath(pathMatch, backend)) {
    return configuredPathStatus(pathMatch, "path");
  }

  return missingRuntimeStatus();
}

async function getWhisperBackendModelStatus(
  backend: "cuda" | "cpu"
): Promise<ToolRuntimeStatus> {
  const configuredPath = readConfiguredPath(
    backend === "cuda" ? WHISPER_CUDA_MODEL_PATH_SETTING : WHISPER_CPU_MODEL_PATH_SETTING,
    backend === "cuda" ? WHISPER_CUDA_ENV_MODEL_PATH : WHISPER_CPU_ENV_MODEL_PATH
  );
  if (configuredPath) {
    return configuredPathStatus(configuredPath.path, configuredPath.source);
  }

  if (backend === "cpu") {
    return getToolRuntimeStatus("whisperModel");
  }

  const matches = await collectWorkspaceMatches(TOOL_WORKSPACE_SEARCH_ROOTS.whisperModel, "whisperModel");
  const preferredNames = [
    "ggml-large-v3-turbo.bin",
    "ggml-large-v3-turbo-q8_0.bin",
    "ggml-large-v3-turbo-q5_0.bin",
    "ggml-large-v3.bin"
  ];
  const preferredMatch = preferredNames
    .map((name) => matches.find((match) => path.basename(match).toLowerCase() === name))
    .find(Boolean);
  return preferredMatch
    ? configuredPathStatus(preferredMatch, "workspace")
    : missingRuntimeStatus();
}

function readConfiguredPath(
  settingKey: string,
  envKey: string
): { path: string; source: ToolRuntimeSource } | null {
  const configuredSettingPath = getAppSetting(settingKey)?.trim();
  if (configuredSettingPath) {
    return { path: configuredSettingPath, source: "setting" };
  }

  const configuredEnvPath = process.env[envKey]?.trim();
  return configuredEnvPath ? { path: configuredEnvPath, source: "env" } : null;
}

async function configuredPathStatus(resolvedPath: string, source: ToolRuntimeSource): Promise<ToolRuntimeStatus> {
  return {
    available: await pathExists(resolvedPath),
    resolvedPath,
    source
  };
}

function missingRuntimeStatus(): ToolRuntimeStatus {
  return {
    available: false,
    resolvedPath: null,
    source: "missing"
  };
}

async function isWhisperBackendPath(
  executablePath: string,
  backend: "cuda" | "cpu"
): Promise<boolean> {
  const cudaLibraryPath = path.join(path.dirname(executablePath), "ggml-cuda.dll");
  const hasCudaLibrary = await pathExists(cudaLibraryPath);
  return backend === "cuda" ? hasCudaLibrary : !hasCudaLibrary;
}

async function findWorkspaceLocalToolPath(tool: ToolSettingKey): Promise<string | null> {
  const searchRoot = TOOL_WORKSPACE_SEARCH_ROOTS[tool];
  if (!(await pathExists(searchRoot))) {
    return null;
  }

  const matches = await collectWorkspaceMatches(searchRoot, tool);
  if (matches.length === 0) {
    return null;
  }

  return choosePreferredWorkspaceMatch(tool, matches);
}

async function findBundledCorePackPath(tool: ToolSettingKey): Promise<string | null> {
  if (!BUNDLED_CORE_PACK_ROOT) {
    return null;
  }

  const candidates: Record<ToolSettingKey, string[]> = {
    ffmpeg: [path.join(BUNDLED_CORE_PACK_ROOT, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")],
    ffprobe: [path.join(BUNDLED_CORE_PACK_ROOT, "ffmpeg", process.platform === "win32" ? "ffprobe.exe" : "ffprobe")],
    whisper: [path.join(BUNDLED_CORE_PACK_ROOT, "whisper", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli")],
    whisperModel: [path.join(BUNDLED_CORE_PACK_ROOT, "whisper-model", "ggml-base.bin")]
  };

  for (const candidate of candidates[tool]) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function collectWorkspaceMatches(rootPath: string, tool: ToolSettingKey): Promise<string[]> {
  const matches: string[] = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    let entries;

    try {
      entries = await readdir(currentPath, { encoding: "utf8", withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile() && isWorkspaceToolFileMatch(tool, entry.name)) {
        matches.push(entryPath);
      }
    }
  }

  return matches;
}

function isWorkspaceToolFileMatch(tool: ToolSettingKey, fileName: string): boolean {
  const normalizedFileName = fileName.toLowerCase();

  if (tool === "whisperModel") {
    return normalizedFileName.startsWith("ggml-") && normalizedFileName.endsWith(".bin");
  }

  const binaryNames = TOOL_BINARY_NAMES[tool] ?? [];
  const validFileNames = process.platform === "win32"
    ? binaryNames.map((binaryName) => `${binaryName}.exe`)
    : binaryNames;

  return validFileNames.some((candidateName) => candidateName.toLowerCase() === normalizedFileName);
}

function choosePreferredWorkspaceMatch(tool: ToolSettingKey, matches: string[]): string {
  const sortedMatches = [...matches].sort((left, right) => left.localeCompare(right));

  if (tool !== "whisperModel") {
    return sortedMatches[0]!;
  }

  const preferredModelNames = [
    "ggml-base.bin",
    "ggml-base.en.bin",
    "ggml-small.bin",
    "ggml-small.en.bin"
  ];

  for (const preferredModelName of preferredModelNames) {
    const preferredMatch = sortedMatches.find((match) =>
      path.basename(match).toLowerCase() === preferredModelName
    );
    if (preferredMatch) {
      return preferredMatch;
    }
  }

  return sortedMatches[0]!;
}
