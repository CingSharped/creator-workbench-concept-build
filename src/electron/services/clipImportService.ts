import path from "node:path";
import { createImportedClip } from "./clipRepository";
import { inspectMediaFile } from "./mediaInspector";
import { getTranscriptionModelStatus, getTranscriptionRuntimeStatus, transcribeClip } from "./transcriptionService";
import { getToolRuntimeStatus } from "./runtimeTools";
import { recordWorkspaceSyncActivity } from "./workspaceIndexStatus";
import { getWorkspaceAutomationSetting } from "./workspacePreferences";
import { getDefaultWorkspace } from "./workspaceRepository";

export const VIDEO_FILE_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

let autoTranscriptionQueue = Promise.resolve();

export type ClipImportSource = "manual_import" | "clip_library_sync" | "watcher_import" | "long_form_approved";

export interface ImportClipPathsResult {
  importedClipIds: string[];
  createdClipIds: string[];
}

interface ImportClipPathsOptions {
  source?: ClipImportSource;
}

export async function importClipPaths(
  filePaths: string[],
  options: ImportClipPathsOptions = {}
): Promise<ImportClipPathsResult> {
  const workspace = getDefaultWorkspace();
  const importedClipIds: string[] = [];
  const createdClipIds: string[] = [];
  const source = options.source ?? "manual_import";

  for (const filePath of filePaths) {
    const inspection = await inspectMediaFile(filePath);
    const result = createImportedClip({
      workspaceId: workspace.id,
      displayName: inspection.displayName,
      sourcePath: inspection.sourcePath,
      sourceFingerprint: inspection.sourceFingerprint,
      fileSizeBytes: inspection.fileSizeBytes,
      durationMs: inspection.durationMs,
      frameRate: inspection.frameRate,
      widthPx: inspection.widthPx,
      heightPx: inspection.heightPx,
      inspectionStatus: inspection.inspectionStatus
    });

    importedClipIds.push(result.clip.id);
    if (result.created) {
      createdClipIds.push(result.clip.id);
    }
  }

  if (createdClipIds.length > 0 && getWorkspaceAutomationSetting("autoTranscribeOnImport")) {
    queueAutoTranscriptions(createdClipIds);
  }

  recordWorkspaceSyncActivity(
    buildImportSummary({
      source,
      checkedCount: filePaths.length,
      createdCount: createdClipIds.length
    })
  );

  return {
    importedClipIds,
    createdClipIds
  };
}

export function isSupportedVideoFilePath(filePath: string): boolean {
  return VIDEO_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function isTranscriptionStackReady(): Promise<boolean> {
  const [ffmpegRuntime, whisperRuntime, modelRuntime] = await Promise.all([
    getToolRuntimeStatus("ffmpeg"),
    getTranscriptionRuntimeStatus(),
    getTranscriptionModelStatus()
  ]);

  return ffmpegRuntime.available && whisperRuntime.available && modelRuntime.available;
}

function queueAutoTranscriptions(clipIds: string[]): void {
  autoTranscriptionQueue = autoTranscriptionQueue
    .then(async () => {
      for (const clipId of clipIds) {
        if (!(await isTranscriptionStackReady())) {
          return;
        }

        try {
          await transcribeClip(clipId);
        } catch (error) {
          console.error(`Auto-transcription failed for clip ${clipId}`, error);
        }
      }
    })
    .catch((error) => {
      console.error("Auto-transcription queue failed", error);
    });
}

function buildImportSummary(input: {
  source: ClipImportSource;
  checkedCount: number;
  createdCount: number;
}): string {
  const alreadyIndexedCount = input.checkedCount - input.createdCount;
  const checkedLabel = pluralize(input.checkedCount, "clip");
  const createdLabel = pluralize(input.createdCount, "new");
  const alreadyIndexedLabel = pluralize(alreadyIndexedCount, "already indexed");

  switch (input.source) {
    case "long_form_approved":
      return `Approved long-form proposal added ${createdLabel} to the clip library.`;
    case "clip_library_sync":
      return `Library sync checked ${checkedLabel}: ${createdLabel}, ${alreadyIndexedLabel}.`;
    case "watcher_import":
      if (input.createdCount === input.checkedCount) {
        return `Watched folder imported ${createdLabel}.`;
      }

      return `Watched folder checked ${checkedLabel}: ${createdLabel}, ${alreadyIndexedLabel}.`;
    default:
      return `Manual import checked ${checkedLabel}: ${createdLabel}, ${alreadyIndexedLabel}.`;
  }
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
