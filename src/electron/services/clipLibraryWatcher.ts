import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "node:fs";
import { importClipPaths, isSupportedVideoFilePath } from "./clipImportService";
import { getWorkspaceAutomationSetting, getWorkspaceFolderSetting } from "./workspacePreferences";

const FILE_STABLE_DELAY_MS = 1500;
const FILE_STABLE_ATTEMPTS = 8;

let clipLibraryWatcher: FSWatcher | null = null;
const pendingImports = new Map<string, NodeJS.Timeout>();

export async function refreshClipLibraryWatcher(): Promise<void> {
  disposeClipLibraryWatcher();

  if (!getWorkspaceAutomationSetting("watchClipLibrary")) {
    return;
  }

  const clipLibraryFolder = getWorkspaceFolderSetting("clipLibrary");
  if (!clipLibraryFolder) {
    return;
  }

  const folderStats = await stat(clipLibraryFolder).catch(() => null);
  if (!folderStats || !folderStats.isDirectory()) {
    console.error(`Clip library watcher skipped because the folder is unavailable: ${clipLibraryFolder}`);
    return;
  }

  clipLibraryWatcher = watch(clipLibraryFolder, { persistent: true }, (_eventType, fileName) => {
    if (!fileName) {
      return;
    }

    const nextFilePath = path.join(clipLibraryFolder, fileName.toString());
    if (!isSupportedVideoFilePath(nextFilePath)) {
      return;
    }

    scheduleClipImport(nextFilePath);
  });

  clipLibraryWatcher.on("error", (error) => {
    console.error("Clip library watcher failed", error);
  });
}

export function disposeClipLibraryWatcher(): void {
  clipLibraryWatcher?.close();
  clipLibraryWatcher = null;

  for (const timeout of pendingImports.values()) {
    clearTimeout(timeout);
  }

  pendingImports.clear();
}

function scheduleClipImport(filePath: string): void {
  const existingTimeout = pendingImports.get(filePath);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(() => {
    pendingImports.delete(filePath);
    void importFileWhenStable(filePath);
  }, FILE_STABLE_DELAY_MS);

  pendingImports.set(filePath, timeout);
}

async function importFileWhenStable(filePath: string): Promise<void> {
  const fileReady = await waitForStableFile(filePath);
  if (!fileReady) {
    return;
  }

  try {
    await importClipPaths([filePath], { source: "watcher_import" });
  } catch (error) {
    console.error(`Clip library auto-import failed for ${filePath}`, error);
  }
}

async function waitForStableFile(filePath: string): Promise<boolean> {
  let previousSize = -1;
  let stableObservations = 0;

  for (let attempt = 0; attempt < FILE_STABLE_ATTEMPTS; attempt += 1) {
    const fileStats = await stat(filePath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      return false;
    }

    if (fileStats.size > 0 && fileStats.size === previousSize) {
      stableObservations += 1;
      if (stableObservations >= 2) {
        return true;
      }
    } else {
      stableObservations = 0;
      previousSize = fileStats.size;
    }

    await delay(FILE_STABLE_DELAY_MS);
  }

  return previousSize > 0;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
