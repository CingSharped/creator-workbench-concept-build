import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import https from "node:https";
import path from "node:path";
import type { LocalAiRuntimeStatus } from "../../shared/contracts";
import {
  getLocalAiSetupAsset,
  LOCAL_AI_SETUP_ASSETS,
  type LocalAiSetupAsset,
  type LocalAiSetupAssetId,
  type LocalAiSetupProgress,
  type LocalAiSetupProgressStatus,
  type LocalAiSetupRecommendation
} from "../../shared/localAiSetup";
import {
  installLocalAiModelFile,
  installLocalAiRuntimeBundle,
  getLocalAiRuntimeStatus
} from "./localAiRuntimeService";

const execFileAsync = promisify(execFile);
const activeDownloads = new Map<string, AbortController>();
const progressListeners = new Set<(progress: LocalAiSetupProgress) => void>();
let setupRoot: string | null = null;

export function bootstrapLocalAiSetup(userDataPath: string): void {
  setupRoot ??= path.join(userDataPath, "local-ai", "setup-downloads");
}

export function getLocalAiSetupCatalog(): LocalAiSetupAsset[] {
  return LOCAL_AI_SETUP_ASSETS.map((asset) => ({
    ...asset,
    downloads: asset.downloads.map((download) => ({ ...download })),
    capabilities: asset.capabilities ? [...asset.capabilities] : undefined,
    taskLabels: asset.taskLabels ? [...asset.taskLabels] : undefined
  }));
}

export function subscribeLocalAiSetupProgress(listener: (progress: LocalAiSetupProgress) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export async function downloadLocalAiSetupAsset(assetId: LocalAiSetupAssetId): Promise<LocalAiRuntimeStatus> {
  const asset = getLocalAiSetupAsset(assetId);
  const operationId = randomUUID();
  const controller = new AbortController();
  activeDownloads.set(operationId, controller);
  const root = getSetupRoot();
  const assetRoot = path.join(root, asset.id);
  const stagingRoot = path.join(assetRoot, "staging");
  await mkdir(stagingRoot, { recursive: true });
  publishProgress(operationId, asset, "queued", "Preparing secure download", 0, asset.totalSizeBytes, null);

  try {
    await ensureFreeSpace(asset);
    let downloadedBytes = 0;
    const archivePaths: string[] = [];

    for (const download of asset.downloads) {
      const partPath = path.join(assetRoot, `${download.fileName}.part`);
      const archivePath = path.join(assetRoot, download.fileName);
      const verified = await hasExpectedHash(archivePath, download.sha256);
      if (!verified) {
        const existingBytes = await getFileSize(partPath);
        await downloadFile(download.url, partPath, existingBytes, controller.signal, (bytes) => {
          publishProgress(
            operationId,
            asset,
            "downloading",
            `Downloading ${download.fileName}`,
            Math.min(99, Math.round(((downloadedBytes + bytes) / asset.totalSizeBytes) * 100)),
            asset.totalSizeBytes,
            null
          );
        });
        publishProgress(operationId, asset, "verifying", `Verifying ${download.fileName}`, null, asset.totalSizeBytes, null);
        await verifySha256(partPath, download.sha256, download.fileName);
        await rm(archivePath, { force: true });
        await rename(partPath, archivePath);
      }
      downloadedBytes += download.sizeBytes;
      archivePaths.push(archivePath);
    }

    throwIfAborted(controller.signal);
    publishProgress(operationId, asset, "installing", `Installing ${asset.installLabel}`, null, asset.totalSizeBytes, null);
    let runtimeStatus: LocalAiRuntimeStatus;
    if (asset.kind === "runtime") {
      await rm(stagingRoot, { recursive: true, force: true });
      await mkdir(stagingRoot, { recursive: true });
      for (const archivePath of archivePaths) {
        throwIfAborted(controller.signal);
        await extractZip(archivePath, stagingRoot);
      }
      runtimeStatus = await installLocalAiRuntimeBundle(stagingRoot);
    } else {
      const modelPath = path.join(stagingRoot, asset.downloads[0]?.fileName ?? "model.gguf");
      await rm(modelPath, { force: true });
      await rename(archivePaths[0]!, modelPath);
      runtimeStatus = await installLocalAiModelFile(modelPath);
      await rename(modelPath, archivePaths[0]!);
    }

    publishProgress(operationId, asset, "completed", `${asset.installLabel} is installed and ready to verify`, 100, asset.totalSizeBytes, null);
    return runtimeStatus;
  } catch (error) {
    if (controller.signal.aborted) {
      publishProgress(operationId, asset, "cancelled", "Download cancelled. You can retry later.", null, asset.totalSizeBytes, null);
      return getLocalAiRuntimeStatus();
    }

    const message = error instanceof Error ? error.message : "The local AI setup download failed.";
    publishProgress(operationId, asset, "failed", "Setup could not be completed", null, asset.totalSizeBytes, message);
    throw new Error(message);
  } finally {
    activeDownloads.delete(operationId);
  }
}

export async function installRecommendedLocalAiSetup(
  recommendation: LocalAiSetupRecommendation
): Promise<LocalAiRuntimeStatus> {
  const runtimeAsset = getLocalAiSetupAsset(recommendation.runtimeId);
  const modelAsset = getLocalAiSetupAsset(recommendation.modelId);
  if (runtimeAsset.kind !== "runtime" || modelAsset.kind !== "model") {
    throw new Error("The recommended local AI setup is invalid.");
  }

  let runtimeStatus = await getLocalAiRuntimeStatus();
  if (!runtimeStatus.executablePath) {
    runtimeStatus = await downloadLocalAiSetupAsset(runtimeAsset.id);
  }

  const modelFileNames = new Set(modelAsset.downloads.map((download) => download.fileName));
  const modelAlreadyInstalled = runtimeStatus.availableModels.some((model) => modelFileNames.has(model.fileName));
  if (!modelAlreadyInstalled) {
    runtimeStatus = await downloadLocalAiSetupAsset(modelAsset.id);
  }

  return runtimeStatus;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Download cancelled.");
  }
}

export function cancelLocalAiSetupDownload(operationId: string): boolean {
  const controller = activeDownloads.get(operationId);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

export function disposeLocalAiSetupDownloads(): void {
  activeDownloads.forEach((controller) => controller.abort());
  activeDownloads.clear();
}

function getSetupRoot(): string {
  if (!setupRoot) {
    throw new Error("The local AI setup service has not been initialized.");
  }
  return setupRoot;
}

async function ensureFreeSpace(asset: LocalAiSetupAsset): Promise<void> {
  const root = getSetupRoot();
  const filesystem = await statfs(root);
  const availableBlocks = typeof filesystem.bavail === "bigint" ? filesystem.bavail : BigInt(filesystem.bavail);
  const blockSize = typeof filesystem.bsize === "bigint" ? filesystem.bsize : BigInt(filesystem.bsize);
  const availableBytes = availableBlocks * blockSize;
  const requiredBytes = BigInt(asset.totalSizeBytes) * (asset.kind === "model" ? 2n : 1n) + 512n * 1024n * 1024n;
  if (availableBytes < requiredBytes) {
    throw new Error(`Not enough free space for ${asset.label}. Required approximately ${formatBytes(Number(requiredBytes))}.`);
  }
}

async function getFileSize(filePath: string): Promise<number> {
  const details = await stat(filePath).catch(() => null);
  return details?.isFile() ? details.size : 0;
}

async function hasExpectedHash(filePath: string, expectedHash: string): Promise<boolean> {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile()) {
    return false;
  }
  return (await hashFile(filePath)) === expectedHash.toLowerCase();
}

async function verifySha256(filePath: string, expectedHash: string, label: string): Promise<void> {
  const actualHash = await hashFile(filePath);
  if (actualHash !== expectedHash.toLowerCase()) {
    await rm(filePath, { force: true });
    throw new Error(`Integrity verification failed for ${label}. The file was discarded.`);
  }
}

function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk: string | Buffer) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function extractZip(archivePath: string, destinationPath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automatic local AI runtime installation currently supports Windows only.");
  }
  await execFileAsync("tar.exe", ["-xf", archivePath, "-C", destinationPath], { windowsHide: true, maxBuffer: 1024 * 1024 });
}

function downloadFile(
  url: string,
  destinationPath: string,
  existingBytes: number,
  signal: AbortSignal,
  onProgress: (bytesDownloaded: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Download cancelled."));
      return;
    }

    const request = https.get(url, { headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined }, (response) => {
      const redirect = response.statusCode && response.statusCode >= 300 && response.statusCode < 400 ? response.headers.location : null;
      if (redirect) {
        response.resume();
        downloadFile(new URL(redirect, url).toString(), destinationPath, existingBytes, signal, onProgress).then(resolve, reject);
        return;
      }

      const append = existingBytes > 0 && response.statusCode === 206;
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode ?? "unknown"}.`));
        return;
      }

      const output = createWriteStream(destinationPath, { flags: append ? "a" : "w" });
      let downloaded = append ? existingBytes : 0;
      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        onProgress(downloaded);
      });
      response.on("error", reject);
      output.on("error", reject);
      output.on("finish", resolve);
      response.pipe(output);

      const abort = (): void => {
        request.destroy(new Error("Download cancelled."));
        output.destroy();
        reject(new Error("Download cancelled."));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
    request.on("error", reject);
  });
}

function publishProgress(
  operationId: string,
  asset: LocalAiSetupAsset,
  status: LocalAiSetupProgressStatus,
  phase: string,
  percent: number | null,
  totalBytes: number,
  errorMessage: string | null
): void {
  const progress: LocalAiSetupProgress = {
    operationId,
    assetId: asset.id,
    status,
    phase,
    percent,
    bytesDownloaded: percent === null ? 0 : Math.round((totalBytes * percent) / 100),
    totalBytes,
    message: phase,
    errorMessage,
    updatedAt: new Date().toISOString()
  };
  progressListeners.forEach((listener) => listener(progress));
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
