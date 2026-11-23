import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  TranscriptRecord,
  TranscriptSegmentRecord,
  TranscriptionProgress,
  TranscriptionProgressPhase
} from "../../shared/contracts";
import { buildTranscriptSegmentsFromSrt } from "../../shared/transcriptSegments";
import { getClipById, updateClipStatus } from "./clipRepository";
import { createJob, updateJobStatus } from "./jobRepository";
import {
  getToolRuntimeStatus,
  getWhisperRuntimeSelection,
  runProcess
} from "./runtimeTools";
import { getTranscriptByClipId, getTranscriptByLongFormSourceId, upsertTranscript } from "./transcriptRepository";
import { getLongFormSourceById } from "./longFormSourceRepository";

const AUDIO_FILE_NAME = "input.wav";
const OUTPUT_FILE_BASENAME = "transcript";
const LONG_FORM_CHUNK_DURATION_MS = 10 * 60 * 1000;
const LONG_FORM_CHUNK_OVERLAP_MS = 2 * 1000;
const WHISPER_STALL_TIMEOUT_MS = 3 * 60 * 1000;
const WHISPER_HEARTBEAT_INTERVAL_MS = 5 * 1000;
const activeTranscriptions = new Map<string, AbortController>();
const activeTranscriptionCompletions = new Map<string, Promise<void>>();
const resolveTranscriptionCompletions = new Map<string, () => void>();
const progressListeners = new Set<(progress: TranscriptionProgress) => void>();

interface PendingTranscriptionRecovery {
  sourceId: string;
  tempDirectory: string;
  outputBasePath: string;
  modelPath: string;
}

interface RecoverablePartialTranscript {
  textContent: string;
  srtContent: string;
  segments: ReturnType<typeof buildTranscriptSegmentsFromSrt>;
}

export interface WhisperChunk {
  index: number;
  inputStartMs: number;
  outputStartMs: number;
  outputEndMs: number;
  durationMs: number;
}

interface WhisperChunkOutput {
  chunk: WhisperChunk;
  srtContent: string;
  textContent: string;
}

const pendingTranscriptionRecoveries = new Map<string, PendingTranscriptionRecovery>();

export function subscribeTranscriptionProgress(
  listener: (progress: TranscriptionProgress) => void
): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function cancelLongFormTranscription(sourceId: string): boolean {
  const controller = activeTranscriptions.get(sourceId);
  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}

export async function disposeTranscriptionProcesses(): Promise<void> {
  activeTranscriptions.forEach((controller) => controller.abort());
  await Promise.all([...activeTranscriptionCompletions.values()]);
  await Promise.all([...pendingTranscriptionRecoveries.keys()].map((sourceId) => discardLongFormPartialTranscript(sourceId)));
}

export function calculateExtractionPercent(outTimeMs: number, durationMs: number | null): number | null {
  if (!Number.isFinite(outTimeMs) || !durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  return Math.min(99, Math.max(0, Math.round((outTimeMs / durationMs) * 100)));
}

export function calculateExtractionEta(elapsedMs: number, percent: number | null): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || percent === null || percent <= 0) {
    return null;
  }

  return Math.max(0, Math.round((elapsedMs * (100 - percent)) / percent));
}

export function estimateWhisperEtaRange(
  durationMs: number | null,
  modelPath: string | null
): { minMs: number; maxMs: number } | null {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const modelName = path.basename(modelPath ?? "").toLowerCase();
  const multipliers = modelName.includes("large")
    ? [3, 12]
    : modelName.includes("medium")
      ? [1.5, 6]
      : modelName.includes("small")
        ? [0.75, 3]
        : [0.5, 2.5];

  return {
    minMs: Math.round(durationMs * multipliers[0]),
    maxMs: Math.round(durationMs * multipliers[1])
  };
}

export function buildWhisperChunks(
  durationMs: number | null,
  chunkDurationMs = LONG_FORM_CHUNK_DURATION_MS,
  overlapMs = LONG_FORM_CHUNK_OVERLAP_MS
): WhisperChunk[] {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return [];
  }

  const safeChunkDurationMs = Math.max(1, Math.round(chunkDurationMs));
  const safeOverlapMs = Math.min(Math.max(0, Math.round(overlapMs)), safeChunkDurationMs - 1);
  const chunks: WhisperChunk[] = [];
  let outputStartMs = 0;

  while (outputStartMs < durationMs) {
    const outputEndMs = Math.min(durationMs, outputStartMs + safeChunkDurationMs);
    const inputStartMs = Math.max(0, outputStartMs - (outputStartMs > 0 ? safeOverlapMs : 0));
    chunks.push({
      index: chunks.length,
      inputStartMs,
      outputStartMs,
      outputEndMs,
      durationMs: outputEndMs - inputStartMs
    });
    outputStartMs = outputEndMs;
  }

  return chunks;
}

export function parseWhisperProgress(output: string): number | null {
  const matches = [...output.matchAll(/(\d{1,3})%/g)];
  const value = matches.length > 0 ? Number(matches[matches.length - 1]?.[1]) : NaN;
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function calculateWhisperOverallPercent(
  chunkIndex: number,
  chunkCount: number,
  chunkPercent: number | null
): number | null {
  if (!Number.isFinite(chunkIndex) || !Number.isFinite(chunkCount) || chunkCount <= 0) {
    return null;
  }

  const completedPercent = (Math.max(0, chunkIndex) / chunkCount) * 100;
  const currentPercent = chunkPercent === null ? 0 : Math.min(100, Math.max(0, chunkPercent));
  return Math.min(99, Math.round(completedPercent + currentPercent / chunkCount));
}

export function mergeWhisperChunkOutputs(outputs: WhisperChunkOutput[]): {
  textContent: string;
  srtContent: string;
} {
  const merged: Array<Pick<TranscriptSegmentRecord, "startMs" | "endMs" | "text">> = [];

  outputs.forEach(({ chunk, srtContent, textContent }) => {
    const segments = buildTranscriptSegmentsFromSrt(srtContent, textContent);
    segments.forEach((segment) => {
      if (segment.startMs === null || segment.endMs === null || !segment.text.trim()) {
        return;
      }

      const adjusted = {
        startMs: segment.startMs + chunk.inputStartMs,
        endMs: segment.endMs + chunk.inputStartMs,
        text: segment.text.trim()
      };

      if (chunk.index > 0 && adjusted.endMs <= chunk.outputStartMs) {
        return;
      }

      const duplicate = merged.find((existing) =>
        normalizeChunkText(existing.text) === normalizeChunkText(adjusted.text) &&
        Math.abs((existing.startMs ?? 0) - adjusted.startMs) <= LONG_FORM_CHUNK_OVERLAP_MS + 1_000
      );
      if (duplicate) {
        if ((adjusted.endMs ?? 0) > (duplicate.endMs ?? 0)) {
          duplicate.endMs = adjusted.endMs;
        }
        return;
      }

      merged.push(adjusted);
    });
  });

  merged.sort((left, right) => (left.startMs ?? 0) - (right.startMs ?? 0));
  return {
    textContent: merged.map((segment) => segment.text).join("\n").trim(),
    srtContent: merged
      .map((segment, index) => [
        String(index + 1),
        `${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}`,
        segment.text,
        ""
      ].join("\n"))
      .join("\n")
      .trim()
  };
}

export async function saveLongFormPartialTranscript(sourceId: string): Promise<TranscriptRecord> {
  const recovery = pendingTranscriptionRecoveries.get(sourceId);
  if (!recovery) {
    throw new Error("No recoverable partial transcript is available for this source.");
  }

  const partial = await readRecoverablePartialTranscript(recovery.outputBasePath);
  if (!partial) {
    await discardLongFormPartialTranscript(sourceId);
    throw new Error("The cancelled run did not leave a valid timestamped SRT to save.");
  }

  const transcript = upsertTranscript({
    clipId: sourceId,
    modelPath: recovery.modelPath,
    language: null,
    textContent: partial.textContent,
    srtContent: partial.srtContent,
    segments: partial.segments,
    status: "incomplete"
  });
  await discardLongFormPartialTranscript(sourceId);
  return transcript;
}

export async function discardLongFormPartialTranscript(sourceId: string): Promise<void> {
  const recovery = pendingTranscriptionRecoveries.get(sourceId);
  if (!recovery) {
    return;
  }

  pendingTranscriptionRecoveries.delete(sourceId);
  await rm(recovery.tempDirectory, { recursive: true, force: true });
}

export async function getTranscriptionRuntimeStatus() {
  return (await getWhisperRuntimeSelection()).runtime;
}

export async function getTranscriptionModelStatus() {
  return (await getWhisperRuntimeSelection()).model;
}

export async function getTranscriptionRuntimeSelection() {
  return getWhisperRuntimeSelection();
}

export async function transcribeClip(clipId: string): Promise<TranscriptRecord> {
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  return transcribeMediaSource(
    { id: clip.id, workspaceId: clip.workspaceId, sourcePath: clip.sourcePath },
    "transcribe_clip",
    () => updateClipStatus(clipId, "transcribed"),
    () => updateClipStatus(clipId, getTranscriptByClipId(clipId) ? "transcribed" : "failed")
  );
}

export async function transcribeLongFormSource(sourceId: string): Promise<TranscriptRecord> {
  const source = getLongFormSourceById(sourceId);
  if (!source) {
    throw new Error("The selected long-form source no longer exists.");
  }

  return transcribeMediaSource(
    { id: source.id, workspaceId: "long-form-sources", sourcePath: source.sourcePath },
    "transcribe_long_form_source"
  );
}

async function transcribeMediaSource(
  source: { id: string; workspaceId: string; sourcePath: string },
  jobType: string,
  onSuccess?: () => void,
  onFailure?: () => void
): Promise<TranscriptRecord> {
  if (activeTranscriptions.has(source.id)) {
    throw new Error("Transcription is already running for this source.");
  }

  const controller = new AbortController();
  activeTranscriptions.set(source.id, controller);
  activeTranscriptionCompletions.set(
    source.id,
    new Promise<void>((resolve) => resolveTranscriptionCompletions.set(source.id, resolve))
  );
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const durationMs = sourceDurationMs(source.id);
  let modelPathForEstimate: string | null = null;
  let transcriptionStartedAtMs: number | null = null;
  let currentPhase: TranscriptionProgressPhase = "preparing";
  const emitProgress = (
    phase: TranscriptionProgressPhase,
    detail: string,
    percent: number | null = null,
    status: TranscriptionProgress["status"] = "running",
    errorMessage: string | null = null,
    recoveryAvailable = false,
    recoveryDetail: string | null = null
  ): void => {
    currentPhase = phase;
    const elapsedMs = Date.now() - startedAtMs;
    const phaseElapsedMs = phase === "transcribing" && transcriptionStartedAtMs !== null
      ? Date.now() - transcriptionStartedAtMs
      : elapsedMs;
    const measuredEtaMs = phase === "extracting" || phase === "transcribing"
      ? calculateExtractionEta(phaseElapsedMs, percent)
      : null;
    const approximateEtaRange = phase === "transcribing" ? estimateWhisperEtaRange(durationMs, modelPathForEstimate) : null;
    const progress: TranscriptionProgress = {
      sourceId: source.id,
      phase,
      status,
      percent,
      elapsedMs,
      startedAt,
      detail,
      errorMessage,
      recoveryAvailable,
      recoveryDetail,
      etaMs: measuredEtaMs,
      etaRangeMs: approximateEtaRange,
      etaBasis: measuredEtaMs !== null ? "measured" : approximateEtaRange ? "approximate" : "unavailable"
    };
    progressListeners.forEach((listener) => listener(progress));
  };

  emitProgress("preparing", "Checking local transcription tools.");
  const existingTranscript = jobType === "transcribe_long_form_source"
    ? getTranscriptByLongFormSourceId(source.id)
    : getTranscriptByClipId(source.id);
  const [ffmpegRuntime, whisperRuntime, modelRuntime] = await Promise.all([
    getToolRuntimeStatus("ffmpeg"),
    getTranscriptionRuntimeStatus(),
    getTranscriptionModelStatus()
  ]);

  const missingRequirements = [
    !ffmpegRuntime.available ? "FFmpeg" : null,
    !whisperRuntime.available ? "whisper.cpp" : null,
    !modelRuntime.available ? "Whisper model" : null
  ].filter(Boolean) as string[];

  if (missingRequirements.length > 0) {
    const message = `Transcription requires ${missingRequirements.join(", ")} to be configured locally.`;
    emitProgress("preparing", message, null, "failed", message);
    finishTranscription(source.id);
    throw new Error(message);
  }

  const job = createJob({
    workspaceId: source.workspaceId,
    clipId: source.id,
    jobType,
    assetType: jobType === "transcribe_long_form_source" ? "long_form_source" : "clip",
    assetId: source.id
  });
  updateJobStatus(job.id, "running");
  modelPathForEstimate = modelRuntime.resolvedPath!;

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "creator-workspace-transcription-"));
  const audioPath = path.join(tempDirectory, AUDIO_FILE_NAME);
  const outputBasePath = path.join(tempDirectory, OUTPUT_FILE_BASENAME);
  let preserveRecovery = false;

  try {
    emitProgress("extracting", "Extracting audio from the source video.");
    await extractAudioTrack(
      ffmpegRuntime.resolvedPath!,
      source.sourcePath,
      audioPath,
      durationMs,
      (percent) => emitProgress("extracting", `Extracting audio${percent === null ? "" : ` (${percent}%)`}.`, percent),
      controller.signal
    );
    transcriptionStartedAtMs = Date.now();
    if (jobType === "transcribe_long_form_source" && durationMs) {
      await transcribeLongFormInChunks(
        whisperRuntime.resolvedPath!,
        modelRuntime.resolvedPath!,
        ffmpegRuntime.resolvedPath!,
        audioPath,
        outputBasePath,
        durationMs,
        controller.signal,
        (detail, percent) => emitProgress("transcribing", detail, percent)
      );
    } else {
      emitProgress("transcribing", "Transcribing audio with the local Whisper model.");
      await runWhisperCli(
        whisperRuntime.resolvedPath!,
        modelRuntime.resolvedPath!,
        audioPath,
        outputBasePath,
        controller.signal,
        "auto"
      );
    }

    emitProgress("saving", "Saving the canonical transcript and timestamp data.");
    const [textContent, srtContent] = await Promise.all([
      readFile(`${outputBasePath}.txt`, "utf8"),
      readFile(`${outputBasePath}.srt`, "utf8")
    ]);

    const transcript = upsertTranscript({
      clipId: source.id,
      assetType: jobType === "transcribe_long_form_source" ? "long_form_source" : "clip",
      assetId: source.id,
      modelPath: modelRuntime.resolvedPath!,
      language: jobType === "transcribe_long_form_source" ? "en" : null,
      textContent: textContent.trim(),
      srtContent: srtContent.trim()
    });

    onSuccess?.();
    updateJobStatus(job.id, "completed");
    emitProgress("saving", "Transcript completed and saved locally.", 100, "completed");

    return transcript;
  } catch (error) {
    onFailure?.();
    const message = toErrorMessage(error);
    const cancelled = controller.signal.aborted || message === "Process cancelled.";
    let recoveryAvailable = false;
    let recoveryDetail: string | null = null;
    if (cancelled && jobType === "transcribe_long_form_source") {
      const partial = await readRecoverablePartialTranscript(outputBasePath);
      if (partial) {
        pendingTranscriptionRecoveries.set(source.id, {
          sourceId: source.id,
          tempDirectory,
          outputBasePath,
          modelPath: modelRuntime.resolvedPath!
        });
        preserveRecovery = true;
        recoveryAvailable = true;
        recoveryDetail = "A valid timestamped SRT was found. Save it as an incomplete review transcript, or discard it.";
      } else {
        recoveryDetail = "No valid timestamped SRT was flushed before cancellation. Discard the temporary data; a future run must restart from the beginning.";
      }
    }
    updateJobStatus(job.id, cancelled ? "failed" : "failed", message);
    emitProgress(
      currentPhase,
      cancelled ? "Transcription cancelled." : message,
      null,
      cancelled ? "cancelled" : "failed",
      message,
      recoveryAvailable,
      recoveryDetail
    );
    throw error;
  } finally {
    try {
      if (!preserveRecovery) {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    } finally {
      finishTranscription(source.id);
    }
  }
}

function finishTranscription(sourceId: string): void {
  activeTranscriptions.delete(sourceId);
  resolveTranscriptionCompletions.get(sourceId)?.();
  resolveTranscriptionCompletions.delete(sourceId);
  activeTranscriptionCompletions.delete(sourceId);
}

async function extractAudioTrack(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  durationMs: number | null,
  onProgress: (percent: number | null) => void,
  signal: AbortSignal
): Promise<void> {
  let progressBuffer = "";
  await runProcess(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:2",
    "-nostats",
    "-i",
    inputPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath
  ], undefined, {
    signal,
    onStderr: (chunk) => {
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match) {
          onProgress(calculateExtractionPercent(Number(match[1]) / 1000, durationMs));
        }
      }
    }
  });
}

async function transcribeLongFormInChunks(
  whisperPath: string,
  modelPath: string,
  ffmpegPath: string,
  audioPath: string,
  outputBasePath: string,
  durationMs: number,
  signal: AbortSignal,
  onProgress: (detail: string, percent: number | null) => void
): Promise<void> {
  const chunks = buildWhisperChunks(durationMs);
  const outputs: WhisperChunkOutput[] = [];
  const tempDirectory = path.dirname(outputBasePath);

  for (const chunk of chunks) {
    const chunkAudioPath = path.join(tempDirectory, "chunk-" + (chunk.index + 1) + ".wav");
    const chunkOutputBasePath = path.join(tempDirectory, "chunk-" + (chunk.index + 1));
    let latestChunkPercent: number | null = null;

    onProgress(
      "Preparing English transcription chunk " + (chunk.index + 1) + " of " + chunks.length + ".",
      calculateWhisperOverallPercent(chunk.index, chunks.length, 0)
    );
    await extractAudioChunk(ffmpegPath, audioPath, chunkAudioPath, chunk, signal);
    onProgress(
      "Transcribing English audio chunk " + (chunk.index + 1) + " of " + chunks.length + ".",
      calculateWhisperOverallPercent(chunk.index, chunks.length, latestChunkPercent)
    );

    await runWhisperCli(
      whisperPath,
      modelPath,
      chunkAudioPath,
      chunkOutputBasePath,
      signal,
      "en",
      (chunkPercent) => {
        latestChunkPercent = chunkPercent;
        onProgress(
          "Transcribing English audio chunk " + (chunk.index + 1) + " of " + chunks.length + " (" + (chunkPercent === null ? "in progress" : chunkPercent + "%") + ").",
          calculateWhisperOverallPercent(chunk.index, chunks.length, chunkPercent)
        );
      },
      (idleMs) => {
        onProgress(
          "Transcribing English audio chunk " + (chunk.index + 1) + " of " + chunks.length + "; Whisper is active, with no new progress line for " + formatElapsed(idleMs) + ".",
          calculateWhisperOverallPercent(chunk.index, chunks.length, latestChunkPercent)
        );
      }
    );

    const [srtContent, textContent] = await Promise.all([
      readFile(chunkOutputBasePath + ".srt", "utf8"),
      readFile(chunkOutputBasePath + ".txt", "utf8")
    ]);
    outputs.push({ chunk, srtContent, textContent });
    const merged = mergeWhisperChunkOutputs(outputs);
    await writeFile(outputBasePath + ".srt", merged.srtContent, "utf8");
    await writeFile(outputBasePath + ".txt", merged.textContent, "utf8");
    await rm(chunkAudioPath, { force: true });
    await rm(chunkOutputBasePath + ".srt", { force: true });
    await rm(chunkOutputBasePath + ".txt", { force: true });
    onProgress(
      "Completed English transcription chunk " + (chunk.index + 1) + " of " + chunks.length + ".",
      calculateWhisperOverallPercent(chunk.index + 1, chunks.length, 0)
    );
  }
}

async function extractAudioChunk(
  ffmpegPath: string,
  audioPath: string,
  outputPath: string,
  chunk: WhisperChunk,
  signal: AbortSignal
): Promise<void> {
  await runProcess(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    formatSeconds(chunk.inputStartMs),
    "-t",
    formatSeconds(chunk.durationMs),
    "-i",
    audioPath,
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath
  ], undefined, { signal });
}

async function runWhisperCli(
  whisperPath: string,
  modelPath: string,
  audioPath: string,
  outputBasePath: string,
  signal: AbortSignal,
  language: "auto" | "en",
  onProgress?: (percent: number | null) => void,
  onHeartbeat?: (idleMs: number) => void
): Promise<void> {
  let lastOutputAt = Date.now();
  let stallError: Error | null = null;
  const watchdogController = new AbortController();
  const propagateAbort = (): void => watchdogController.abort();
  signal.addEventListener("abort", propagateAbort, { once: true });
  const watchdog = setInterval(() => {
    const idleMs = Date.now() - lastOutputAt;
    onHeartbeat?.(idleMs);
    if (idleMs >= WHISPER_STALL_TIMEOUT_MS) {
      stallError = new Error("Whisper produced no observable progress for " + formatElapsed(idleMs) + ".");
      watchdogController.abort();
    }
  }, WHISPER_HEARTBEAT_INTERVAL_MS);

  try {
    const args = [
      "-m",
      modelPath,
      "-f",
      audioPath,
      "-l",
      language,
      "-otxt",
      "-osrt",
      "-of",
      outputBasePath
    ];
    args.push(onProgress || onHeartbeat ? "-pp" : "-np");
    await runProcess(whisperPath, args, undefined, {
      signal: watchdogController.signal,
      onStdout: (chunk) => {
        lastOutputAt = Date.now();
        onProgress?.(parseWhisperProgress(chunk));
      },
      onStderr: () => {
        lastOutputAt = Date.now();
      }
    });
  } catch (error) {
    if (stallError) {
      throw stallError;
    }
    throw error;
  } finally {
    clearInterval(watchdog);
    signal.removeEventListener("abort", propagateAbort);
  }
}

function normalizeChunkText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function formatSrtTimestamp(milliseconds: number | null): string {
  const totalMilliseconds = Math.max(0, Math.round(milliseconds ?? 0));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const millis = totalMilliseconds % 1_000;
  return String(hours).padStart(2, "0") + ":" +
    String(minutes).padStart(2, "0") + ":" +
    String(seconds).padStart(2, "0") + "," +
    String(millis).padStart(3, "0");
}

function formatSeconds(milliseconds: number): string {
  return (Math.max(0, milliseconds) / 1_000).toFixed(3);
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0")
    : minutes + ":" + String(seconds).padStart(2, "0");
}

function sourceDurationMs(sourceId: string): number | null {
  return getLongFormSourceById(sourceId)?.durationMs ?? null;
}

async function readRecoverablePartialTranscript(outputBasePath: string): Promise<RecoverablePartialTranscript | null> {
  const srtContent = await readFile(`${outputBasePath}.srt`, "utf8").catch(() => null);
  if (!srtContent?.trim()) {
    return null;
  }

  const textContent = (await readFile(`${outputBasePath}.txt`, "utf8").catch(() => "")).trim();
  return parseRecoverablePartialTranscript(srtContent, textContent);
}

export function parseRecoverablePartialTranscript(
  srtContent: string,
  textContent: string
): RecoverablePartialTranscript | null {
  const segments = buildTranscriptSegmentsFromSrt(srtContent, textContent);
  const validSegments = segments.filter(
    (segment) =>
      typeof segment.startMs === "number" &&
      typeof segment.endMs === "number" &&
      segment.endMs > segment.startMs &&
      segment.text.trim().length > 0
  );
  if (validSegments.length === 0) {
    return null;
  }

  return {
    textContent: textContent || validSegments.map((segment) => segment.text.trim()).join(" "),
    srtContent: srtContent.trim(),
    segments: validSegments
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "The transcription job failed.";
}
