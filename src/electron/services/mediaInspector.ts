import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getToolRuntimeStatus } from "./runtimeTools";
import { normalizeFingerprintPath } from "./sourceFingerprint";
import type { SourceFingerprint } from "../../shared/contracts";

const execFileAsync = promisify(execFile);

export interface InspectedMediaFile {
  displayName: string;
  sourcePath: string;
  sourceFingerprint: SourceFingerprint;
  fileSizeBytes: number;
  durationMs: number | null;
  frameRate: number | null;
  widthPx: number | null;
  heightPx: number | null;
  inspectionStatus: "basic" | "ffprobe";
}

export async function inspectMediaFile(filePath: string): Promise<InspectedMediaFile> {
  const fileStats = await stat(filePath);
  const baseResult: InspectedMediaFile = {
    displayName: path.basename(filePath),
    sourcePath: filePath,
    sourceFingerprint: {
      normalizedPath: normalizeFingerprintPath(filePath),
      fileSizeBytes: fileStats.size,
      durationMs: null,
      modifiedAtMs: fileStats.mtimeMs
    },
    fileSizeBytes: fileStats.size,
    durationMs: null,
    frameRate: null,
    widthPx: null,
    heightPx: null,
    inspectionStatus: "basic"
  };

  const ffprobeRuntime = await getToolRuntimeStatus("ffprobe");
  if (!ffprobeRuntime.available || !ffprobeRuntime.resolvedPath) {
    return baseResult;
  }

  try {
    const { stdout } = await execFileAsync(ffprobeRuntime.resolvedPath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath
    ]);

    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        duration?: string;
        r_frame_rate?: string;
        avg_frame_rate?: string;
      }>;
    };

    const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
    const durationSeconds = parsed.format?.duration ?? videoStream?.duration ?? null;
    const parsedDurationSeconds = durationSeconds ? Number(durationSeconds) : null;

    return {
      ...baseResult,
      sourceFingerprint: {
        ...baseResult.sourceFingerprint,
        durationMs:
          parsedDurationSeconds !== null && Number.isFinite(parsedDurationSeconds)
            ? Math.round(parsedDurationSeconds * 1000)
            : null
      },
      durationMs:
        parsedDurationSeconds !== null && Number.isFinite(parsedDurationSeconds)
          ? Math.round(parsedDurationSeconds * 1000)
          : null,
      frameRate: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
      widthPx: videoStream?.width ?? null,
      heightPx: videoStream?.height ?? null,
      inspectionStatus: "ffprobe"
    };
  } catch {
    return baseResult;
  }
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const [numeratorValue, denominatorValue] = value.split("/");
  const numerator = Number(numeratorValue);
  const denominator = Number(denominatorValue ?? 1);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) {
    return null;
  }

  const frameRate = numerator / denominator;
  return Number.isFinite(frameRate) && frameRate > 0 && frameRate < 1000 ? frameRate : null;
}

export async function getMediaRuntimeStatus(): Promise<{
  ffmpeg: Awaited<ReturnType<typeof getToolRuntimeStatus>>;
  ffprobe: Awaited<ReturnType<typeof getToolRuntimeStatus>>;
}> {
  const [ffmpeg, ffprobe] = await Promise.all([
    getToolRuntimeStatus("ffmpeg"),
    getToolRuntimeStatus("ffprobe")
  ]);

  return {
    ffmpeg,
    ffprobe
  };
}
