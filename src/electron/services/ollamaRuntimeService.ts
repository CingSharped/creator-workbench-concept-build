import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
export const OLLAMA_DISCOVERY_TIMEOUT_MS = 5000;
export const OLLAMA_GENERATE_TIMEOUT_MS = 45000;

const OLLAMA_EXECUTABLE_PATHS = [
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe"),
  path.join("C:\\", "Program Files", "Ollama", "ollama.exe")
];
const OLLAMA_START_RETRY_MS = 1000;
const OLLAMA_START_ATTEMPTS = 10;

interface OllamaModelTagResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

let ollamaStartPromise: Promise<void> | null = null;
let ownedOllamaProcess: ChildProcess | null = null;
const activeOllamaControllers = new Set<AbortController>();
export async function getAvailableOllamaModels(): Promise<string[]> {
  await ensureOllamaApiReady().catch(() => undefined);

  const response = await getOllamaJson<OllamaModelTagResponse>("/tags").catch(() => null);
  if (response?.models && response.models.length > 0) {
    return response.models
      .map((model) => model.name ?? model.model ?? "")
      .map((model) => model.trim())
      .filter(Boolean);
  }

  return getInstalledModelsFromManifests();
}

export async function postOllamaJson<T>(
  route: string,
  body: object,
  timeoutMs = OLLAMA_DISCOVERY_TIMEOUT_MS
): Promise<T> {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}${route}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function disposeOllamaRuntime(): Promise<void> {
  for (const controller of activeOllamaControllers) {
    controller.abort();
  }
  activeOllamaControllers.clear();

  await terminateOwnedOllamaProcess();
}

async function ensureOllamaApiReady(): Promise<void> {
  if (await isOllamaApiReachable()) {
    return;
  }

  if (!ollamaStartPromise) {
    ollamaStartPromise = startOllamaServer();
  }

  try {
    await ollamaStartPromise;
  } finally {
    ollamaStartPromise = null;
  }
}

async function startOllamaServer(): Promise<void> {
  const executablePath = findOllamaExecutablePath();
  if (!executablePath) {
    return;
  }

  if (ownedOllamaProcess && ownedOllamaProcess.exitCode === null && !ownedOllamaProcess.killed) {
    return;
  }

  const child = spawn(executablePath, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  child.once("exit", () => {
    if (ownedOllamaProcess?.pid === child.pid) {
      ownedOllamaProcess = null;
    }
  });
  ownedOllamaProcess = child;

  for (let attempt = 0; attempt < OLLAMA_START_ATTEMPTS; attempt += 1) {
    if (await isOllamaApiReachable()) {
      return;
    }

    await delay(OLLAMA_START_RETRY_MS);
  }
}

function findOllamaExecutablePath(): string | null {
  return OLLAMA_EXECUTABLE_PATHS.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

async function isOllamaApiReachable(): Promise<boolean> {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}/tags`,
    {
      method: "GET"
    },
    OLLAMA_DISCOVERY_TIMEOUT_MS
  ).catch(() => null);

  return Boolean(response?.ok);
}

async function getOllamaJson<T>(route: string): Promise<T> {
  const response = await fetchWithTimeout(
    `${OLLAMA_BASE_URL}${route}`,
    {
      method: "GET"
    },
    OLLAMA_DISCOVERY_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  activeOllamaControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`The Ollama request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    activeOllamaControllers.delete(controller);
  }
}

async function getInstalledModelsFromManifests(): Promise<string[]> {
  const manifestsRoot = path.join(
    process.env.OLLAMA_MODELS ?? path.join(os.homedir(), ".ollama", "models"),
    "manifests",
    "registry.ollama.ai",
    "library"
  );

  const discoveredModels: string[] = [];
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

      discoveredModels.push(`${family.name}:${tag.name}`);
    }
  }

  return discoveredModels;
}

async function terminateOwnedOllamaProcess(): Promise<void> {
  const ownedProcess = ownedOllamaProcess;
  ownedOllamaProcess = null;

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

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
