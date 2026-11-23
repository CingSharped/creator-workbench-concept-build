import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { StackedVerticalLayoutSettings } from "../../shared/contracts";
import { calculateStackedCrop, calculateStackedCropRect } from "../../shared/stackedVerticalLayout";
import { getClipById } from "./clipRepository";
import { getToolRuntimeStatus, runProcess } from "./runtimeTools";

export interface ExportTrimmedClipInput {
  clipId: string;
  startMs: number;
  endMs: number;
  outputPath: string;
}

export interface ExportTrimmedMediaInput {
  sourcePath: string;
  durationMs: number | null;
  startMs: number;
  endMs: number;
  outputPath: string;
}

export interface ExportStackedVerticalClipInput {
  clipId: string;
  startMs: number;
  endMs: number;
  layout: StackedVerticalLayoutSettings;
  outputPath: string;
}

export async function exportTrimmedClip(input: ExportTrimmedClipInput): Promise<string> {
  const clip = getClipById(input.clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  return exportTrimmedMedia({
    sourcePath: clip.sourcePath,
    durationMs: clip.durationMs,
    startMs: input.startMs,
    endMs: input.endMs,
    outputPath: input.outputPath
  });
}

export async function exportTrimmedMedia(input: ExportTrimmedMediaInput): Promise<string> {
  const startMs = normalizeTrimPoint(input.startMs, "start");
  const endMs = normalizeTrimPoint(input.endMs, "end");
  if (endMs <= startMs) {
    throw new Error("The trim end must be after the trim start.");
  }

  if (input.durationMs !== null && endMs > input.durationMs) {
    throw new Error("The trim end cannot be after the source clip duration.");
  }

  if (!existsSync(input.sourcePath)) {
    throw new Error("The source video is no longer available at its saved path.");
  }

  const outputPath = path.resolve(input.outputPath.trim());
  if (!outputPath || path.extname(outputPath).toLowerCase() !== ".mp4") {
    throw new Error("Trimmed exports must use an .mp4 output path.");
  }

  if (path.resolve(input.sourcePath).toLowerCase() === outputPath.toLowerCase()) {
    throw new Error("Choose a different output path so the original clip is not overwritten.");
  }

  const ffmpegRuntime = await getToolRuntimeStatus("ffmpeg");
  if (!ffmpegRuntime.available || !ffmpegRuntime.resolvedPath) {
    throw new Error("Trim export requires FFmpeg to be configured locally.");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  await runProcess(ffmpegRuntime.resolvedPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    formatSeconds(startMs),
    "-i",
    input.sourcePath,
    "-t",
    formatSeconds(endMs - startMs),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath
  ]);

  return outputPath;
}

export async function exportStackedVerticalClip(input: ExportStackedVerticalClipInput): Promise<string> {
  const clip = getClipById(input.clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  return exportStackedVerticalMedia({
    sourcePath: clip.sourcePath,
    durationMs: clip.durationMs,
    widthPx: clip.widthPx,
    heightPx: clip.heightPx,
    startMs: input.startMs,
    endMs: input.endMs,
    layout: input.layout,
    outputPath: input.outputPath
  });
}

export interface ExportStackedVerticalMediaInput {
  sourcePath: string;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  startMs: number;
  endMs: number;
  layout: StackedVerticalLayoutSettings;
  outputPath: string;
}

export async function exportStackedVerticalMedia(input: ExportStackedVerticalMediaInput): Promise<string> {
  const startMs = normalizeTrimPoint(input.startMs, "start");
  const endMs = normalizeTrimPoint(input.endMs, "end");
  if (endMs <= startMs) {
    throw new Error("The trim end must be after the trim start.");
  }

  if (input.durationMs !== null && endMs > input.durationMs) {
    throw new Error("The trim end cannot be after the source clip duration.");
  }

  if (!existsSync(input.sourcePath)) {
    throw new Error("The source video is no longer available at its saved path.");
  }

  if (!input.widthPx || !input.heightPx || input.widthPx < 2 || input.heightPx < 2) {
    throw new Error("Stacked vertical export needs the source video dimensions. Re-import or inspect the source before exporting.");
  }

  validateStackedVerticalLayout(input.layout);

  const outputPath = path.resolve(input.outputPath.trim());
  if (!outputPath || path.extname(outputPath).toLowerCase() !== ".mp4") {
    throw new Error("Vertical exports must use an .mp4 output path.");
  }

  if (path.resolve(input.sourcePath).toLowerCase() === outputPath.toLowerCase()) {
    throw new Error("Choose a different output path so the original clip is not overwritten.");
  }

  const ffmpegRuntime = await getToolRuntimeStatus("ffmpeg");
  if (!ffmpegRuntime.available || !ffmpegRuntime.resolvedPath) {
    throw new Error("Vertical export requires FFmpeg to be configured locally.");
  }

  const crop = calculateStackedCrop(input.widthPx, input.heightPx);
  const topCrop = buildCropFilter(input.widthPx, input.heightPx, crop, input.layout.topFocusX, input.layout.topFocusY, input.layout.topScale);
  const bottomCrop = buildCropFilter(input.widthPx, input.heightPx, crop, input.layout.bottomFocusX, input.layout.bottomFocusY, input.layout.bottomScale);
  const filterComplex = [
    `[0:v]split=2[topSource][bottomSource]`,
    `[topSource]${topCrop},scale=1080:960:flags=lanczos[top]`,
    `[bottomSource]${bottomCrop},scale=1080:960:flags=lanczos[bottom]`,
    `[top][bottom]vstack=inputs=2[outv]`
  ].join(";");

  await mkdir(path.dirname(outputPath), { recursive: true });

  await runProcess(ffmpegRuntime.resolvedPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    formatSeconds(startMs),
    "-i",
    input.sourcePath,
    "-t",
    formatSeconds(endMs - startMs),
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  ]);

  return outputPath;
}

export { calculateStackedCrop } from "../../shared/stackedVerticalLayout";

function buildCropFilter(
  sourceWidth: number,
  sourceHeight: number,
  crop: { widthPx: number; heightPx: number },
  focusX: number,
  focusY: number,
  scale: number
): string {
  const cropRect = calculateStackedCropRect(sourceWidth, sourceHeight, scale, focusX, focusY);
  return `crop=${cropRect.widthPx}:${cropRect.heightPx}:${Math.round(cropRect.xPx)}:${Math.round(cropRect.yPx)}`;
}

export function validateStackedVerticalLayout(layout: StackedVerticalLayoutSettings): void {
  validateFocusPoint(layout.topFocusX, "top horizontal focus");
  validateFocusPoint(layout.topFocusY, "top vertical focus");
  validateCropScale(layout.topScale, "top crop size");
  validateFocusPoint(layout.bottomFocusX, "bottom horizontal focus");
  validateFocusPoint(layout.bottomFocusY, "bottom vertical focus");
  validateCropScale(layout.bottomScale, "bottom crop size");
}

function validateFocusPoint(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`The ${label} must be between 0 and 1.`);
  }
}

function validateCropScale(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0.25 || value > 1) {
    throw new Error(`The ${label} must be between 0.25 and 1.`);
  }
}

function makeEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function normalizeTrimPoint(value: number, label: "start" | "end"): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`The trim ${label} must be a non-negative time.`);
  }

  return Math.round(value);
}

function formatSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}
