import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LongFormClipProposalAnalysis } from "../../shared/contracts";
import { getToolRuntimeStatus } from "./runtimeTools";

const execFileAsync = promisify(execFile);

export interface CandidateMediaAnalysis {
  analysis: LongFormClipProposalAnalysis;
  frames: string[];
  frameTimestampsMs: number[];
  issue: string | null;
}

export async function analyzeCandidateMedia(input: {
  sourcePath: string;
  startMs: number;
  endMs: number;
  includeFrames: boolean;
  signal?: AbortSignal;
}): Promise<CandidateMediaAnalysis> {
  throwIfAborted(input.signal);
  const durationMs = Math.max(1, input.endMs - input.startMs);
  const ffmpegRuntime = await getToolRuntimeStatus("ffmpeg");
  if (!ffmpegRuntime.available || !ffmpegRuntime.resolvedPath) {
    return {
      analysis: emptyAnalysis(),
      frames: [],
      frameTimestampsMs: [],
      issue: "FFmpeg is not configured, so audio and scene signals were unavailable."
    };
  }

  const [audio, scene] = await Promise.all([
    analyzeAudio(ffmpegRuntime.resolvedPath, input.sourcePath, input.startMs, durationMs, input.signal).catch((error) => {
      if (input.signal?.aborted) {
        throw new Error("Clip proposal generation cancelled.");
      }
      return null;
    }),
    analyzeSceneChanges(ffmpegRuntime.resolvedPath, input.sourcePath, input.startMs, durationMs, input.signal).catch((error) => {
      if (input.signal?.aborted) {
        throw new Error("Clip proposal generation cancelled.");
      }
      return null;
    })
  ]);
  const sampledFrames = input.includeFrames
    ? await extractSampledFrames(ffmpegRuntime.resolvedPath, input.sourcePath, input.startMs, durationMs, input.signal)
      .catch((error) => {
        if (input.signal?.aborted) {
          throw new Error("Clip proposal generation cancelled.");
        }
        return { frames: [], frameTimestampsMs: [] };
      })
    : { frames: [], frameTimestampsMs: [] };
  throwIfAborted(input.signal);

  const issues: string[] = [];
  if (!audio) {
    issues.push("audio signals were unavailable");
  }
  if (!scene) {
    issues.push("scene-change signals were unavailable");
  }
  if (input.includeFrames && sampledFrames.frames.length === 0) {
    issues.push("sampled video frames were unavailable");
  }

  const audioScore = audio ? calculateAudioScore(audio.meanDb, audio.peakDb, audio.silenceRatio) : null;
  const sceneScore = scene ? Math.min(1, scene.sceneChangeCount / 6) : null;
  const mediaScore = combineAvailableScores([audioScore, sceneScore]);

  return {
    analysis: {
      audioMeanDb: audio?.meanDb ?? null,
      audioPeakDb: audio?.peakDb ?? null,
      silenceRatio: audio?.silenceRatio ?? null,
      sceneChangeCount: scene?.sceneChangeCount ?? null,
      mediaScore,
      visualScore: null,
      visualSummary: null
    },
    frames: sampledFrames.frames,
    frameTimestampsMs: sampledFrames.frameTimestampsMs,
    issue: issues.length > 0 ? `Candidate media analysis: ${issues.join(" and ")}.` : null
  };
}

function emptyAnalysis(): LongFormClipProposalAnalysis {
  return {
    audioMeanDb: null,
    audioPeakDb: null,
    silenceRatio: null,
    sceneChangeCount: null,
    mediaScore: null,
    visualScore: null,
    visualSummary: null,
    visualModel: null,
    visualEvidence: null
  };
}

async function analyzeAudio(
  ffmpegPath: string,
  sourcePath: string,
  startMs: number,
  durationMs: number,
  signal?: AbortSignal
): Promise<{ meanDb: number | null; peakDb: number | null; silenceRatio: number | null }> {
  const result = await runFfmpeg(ffmpegPath, [
    "-hide_banner",
    "-nostats",
    "-ss",
    formatSeconds(startMs),
    "-t",
    formatSeconds(durationMs),
    "-i",
    sourcePath,
    "-vn",
    "-af",
    "silencedetect=noise=-35dB:d=0.35,volumedetect",
    "-f",
    "null",
    nullOutput()
  ], signal);
  const output = `${result.stdout}\n${result.stderr}`;
  const meanDb = parseDb(output, /mean_volume:\s*(-?[\d.]+)\s*dB/);
  const peakDb = parseDb(output, /max_volume:\s*(-?[\d.]+)\s*dB/);
  const silenceRatio = parseSilenceRatio(output, durationMs / 1000);
  return { meanDb, peakDb, silenceRatio };
}

async function analyzeSceneChanges(
  ffmpegPath: string,
  sourcePath: string,
  startMs: number,
  durationMs: number,
  signal?: AbortSignal
): Promise<{ sceneChangeCount: number }> {
  const result = await runFfmpeg(ffmpegPath, [
    "-hide_banner",
    "-nostats",
    "-ss",
    formatSeconds(startMs),
    "-t",
    formatSeconds(durationMs),
    "-i",
    sourcePath,
    "-an",
    "-vf",
    "select=gt(scene\\,0.35),showinfo",
    "-f",
    "null",
    nullOutput()
  ], signal);
  const output = `${result.stdout}\n${result.stderr}`;
  const matches = output.match(/Parsed_showinfo.*\bn:\s*\d+/g) ?? output.match(/\bn:\s*\d+\s+pts:/g) ?? [];
  return { sceneChangeCount: matches.length };
}

async function extractSampledFrames(
  ffmpegPath: string,
  sourcePath: string,
  startMs: number,
  durationMs: number,
  signal?: AbortSignal
): Promise<{ frames: string[]; frameTimestampsMs: number[] }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "creator-workspace-clip-frames-"));
  try {
    throwIfAborted(signal);
    const offsets = [...new Set([0, durationMs / 2, Math.max(0, durationMs - 250)])];
    await Promise.all(offsets.map((offsetMs, index) => runFfmpeg(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      formatSeconds(startMs + offsetMs),
      "-i",
      sourcePath,
      "-vf",
      "scale=640:-2",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      path.join(directory, `frame-${String(index + 1).padStart(2, "0")}.png`)
    ], signal)));
    throwIfAborted(signal);
    const files = (await readdir(directory))
      .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
      .sort();
    const frames = await Promise.all(
      files.map(async (fileName) => `data:image/png;base64,${(await readFile(path.join(directory, fileName))).toString("base64")}`)
    );
    return { frames, frameTimestampsMs: files.map((_, index) => Math.round(offsets[index] ?? 0)) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function calculateAudioScore(meanDb: number | null, peakDb: number | null, silenceRatio: number | null): number | null {
  if (meanDb === null && peakDb === null && silenceRatio === null) {
    return null;
  }

  const peakScore = peakDb === null ? null : clamp((peakDb + 30) / 30);
  const dynamicScore = meanDb !== null && peakDb !== null ? clamp((peakDb - meanDb) / 24) : null;
  const speechScore = silenceRatio === null ? null : clamp(1 - silenceRatio);
  return combineAvailableScores([peakScore, dynamicScore, speechScore]);
}

function combineAvailableScores(scores: Array<number | null>): number | null {
  const available = scores.filter((score): score is number => score !== null && Number.isFinite(score));
  return available.length > 0 ? available.reduce((total, score) => total + score, 0) / available.length : null;
}

function parseDb(value: string, pattern: RegExp): number | null {
  const match = value.match(pattern);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSilenceRatio(output: string, durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  let openStart: number | null = null;
  let silenceSeconds = 0;
  for (const line of output.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) {
      openStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (endMatch && openStart !== null) {
      silenceSeconds += Math.max(0, Number(endMatch[1]) - openStart);
      openStart = null;
    }
  }

  if (openStart !== null) {
    silenceSeconds += Math.max(0, durationSeconds - openStart);
  }

  return clamp(silenceSeconds / durationSeconds);
}

async function runFfmpeg(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(ffmpegPath, args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("Clip proposal generation cancelled.");
    }
    throw error;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Clip proposal generation cancelled.");
  }
}

function formatSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

function nullOutput(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
