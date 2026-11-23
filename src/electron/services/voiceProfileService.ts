import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CollaboratorProfile,
  CollaboratorVoiceSample,
  TranscriptAutoAssignScope,
  TranscriptRecord,
  TranscriptSegmentRecord,
  VoiceProfileRecordingInput
} from "../../shared/contracts";
import { CREATOR_SPEAKER_ID } from "../../shared/speakerProfiles";
import { getClipById } from "./clipRepository";
import {
  addCollaboratorVoiceSample,
  addCreatorVoiceSample,
  getCollaboratorProfiles,
  getCreatorVoiceSamples
} from "./creatorProfileLinks";
import { getToolRuntimeStatus, runProcess } from "./runtimeTools";
import { getTranscriptByClipId, saveTranscriptEdits } from "./transcriptRepository";

const AUDIO_FILE_NAME = "voice-analysis.wav";
const TARGET_SAMPLE_RATE = 16_000;
const MIN_SAMPLE_DURATION_MS = 1_000;
const MIN_ASSIGNMENT_DURATION_MS = 800;
const HIGH_CONFIDENCE_THRESHOLD = 0.6;
const REVIEW_CONFIDENCE_THRESHOLD = 0.48;
const VOICE_MATCH_MARGIN = 0.04;
const MAX_RECORDED_SAMPLE_BYTES = 20 * 1024 * 1024;
const BAND_FREQUENCIES = [220, 440, 880, 1760, 3200] as const;
const FEATURE_SCALES = [0.6, 0.35, 0.08, 0.12, 1, 0.35, 0.35, 0.35, 0.35, 0.35, 1.1, 0.4] as const;
const FEATURE_WEIGHTS = [1.4, 1, 1.1, 0.8, 1.25, 1, 1, 1, 1, 1, 0.9, 0.8] as const;

interface AudioData {
  sampleRate: number;
  samples: Float32Array;
}

interface VoiceReference {
  speakerId: string;
  signature: number[];
}

interface RankedVoiceMatch {
  reference: VoiceReference;
  similarity: number;
}

interface VoiceMatchResult {
  speakerId: string;
  similarity: number;
  speakerAssignmentSource: TranscriptSegmentRecord["speakerAssignmentSource"];
  reviewReason: string | null;
  alternateSpeakerId: string | null;
  alternateSimilarity: number | null;
}

export async function captureCreatorVoiceSample(
  clipId: string,
  segment: TranscriptSegmentRecord
): Promise<CollaboratorVoiceSample> {
  return captureVoiceSample(clipId, segment, (sample) => {
    addCreatorVoiceSample(sample);
  });
}

export async function captureCollaboratorVoiceSample(
  collaboratorProfileId: string,
  clipId: string,
  segment: TranscriptSegmentRecord
): Promise<CollaboratorVoiceSample> {
  const collaborator = getCollaboratorProfiles().find((profile) => profile.id === collaboratorProfileId);
  if (!collaborator) {
    throw new Error("The selected collaborator profile no longer exists.");
  }

  return captureVoiceSample(clipId, segment, (sample) => {
    addCollaboratorVoiceSample(collaborator.id, sample);
  });
}

export async function recordVoiceProfileSample(
  input: VoiceProfileRecordingInput
): Promise<CollaboratorVoiceSample> {
  const profileId = input.profileId.trim();
  if (!profileId) {
    throw new Error("Choose a voice profile before recording a sample.");
  }

  if (!input.mimeType.trim().toLowerCase().startsWith("audio/")) {
    throw new Error("The recording did not contain an audio track.");
  }

  const audioBuffer = Buffer.from(input.audioData);
  if (audioBuffer.length === 0 || audioBuffer.length > MAX_RECORDED_SAMPLE_BYTES) {
    throw new Error("The voice recording is empty or too large. Record a shorter sample and try again.");
  }

  if (profileId !== CREATOR_SPEAKER_ID && !getCollaboratorProfiles().some((profile) => profile.id === profileId)) {
    throw new Error("The selected voice profile no longer exists.");
  }

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "creator-workspace-voice-recording-"));
  const recordedPath = path.join(tempDirectory, "voice-recording.webm");
  const wavPath = path.join(tempDirectory, AUDIO_FILE_NAME);

  try {
    await writeFile(recordedPath, audioBuffer);
    const ffmpegRuntime = await getToolRuntimeStatus("ffmpeg");
    if (!ffmpegRuntime.available || !ffmpegRuntime.resolvedPath) {
      throw new Error("FFmpeg must be configured locally before microphone samples can be analyzed.");
    }

    await runProcess(ffmpegRuntime.resolvedPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      recordedPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      `${TARGET_SAMPLE_RATE}`,
      "-ac",
      "1",
      wavPath
    ]);

    const audio = parseMono16BitPcmWav(await readFile(wavPath));
    const signature = computeVoiceSignature(audio.samples, audio.sampleRate);
    if (!signature) {
      throw new Error("The recording did not contain enough clear speech. Try a slightly longer sample in a quiet room.");
    }

    const sample: CollaboratorVoiceSample = {
      id: randomUUID(),
      clipId: null,
      segmentId: null,
      source: "microphone",
      transcriptPreview: input.transcriptPreview.trim().slice(0, 140),
      startMs: null,
      endMs: null,
      signature,
      createdAt: new Date().toISOString()
    };

    if (profileId === CREATOR_SPEAKER_ID) {
      addCreatorVoiceSample(sample);
    } else {
      addCollaboratorVoiceSample(profileId, sample);
    }

    return sample;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function autoAssignTranscriptSpeakers(
  clipId: string,
  scope: TranscriptAutoAssignScope = "all"
): Promise<TranscriptRecord> {
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  const transcript = getTranscriptByClipId(clipId);
  if (!transcript) {
    throw new Error("No transcript exists for the selected clip yet.");
  }

  if (transcript.segments.length === 0) {
    throw new Error("This transcript does not contain subtitle segments to auto-assign yet.");
  }

  const references = buildVoiceReferences(getCreatorVoiceSamples(), getCollaboratorProfiles());
  if (references.length === 0) {
    throw new Error("Save at least one creator or collaborator voice sample before running auto-assign.");
  }

  const audio = await extractClipAudio(clip.sourcePath);
  let changed = false;

  const nextSegments = transcript.segments.map((segment) => {
    if (!shouldProcessSegment(segment, scope)) {
      return segment;
    }

    if (
      segment.startMs === null ||
      segment.endMs === null ||
      segment.endMs - segment.startMs < MIN_ASSIGNMENT_DURATION_MS
    ) {
      const clearedSegment = applyAutoAssignmentResult(segment, {
        speakerId: null,
        speakerConfidence: null,
        speakerAssignmentSource: null,
        speakerReviewReason: "This subtitle segment is too short for reliable voice matching.",
        speakerAlternateSpeakerId: null,
        speakerAlternateConfidence: null
      });
      changed = changed || clearedSegment !== segment;
      return clearedSegment;
    }

    const signature = computeVoiceSignatureFromAudio(audio, segment.startMs, segment.endMs);
    if (!signature) {
      const clearedSegment = applyAutoAssignmentResult(segment, {
        speakerId: null,
        speakerConfidence: null,
        speakerAssignmentSource: null,
        speakerReviewReason: "This subtitle segment did not contain a reliable single-speaker voice sample.",
        speakerAlternateSpeakerId: null,
        speakerAlternateConfidence: null
      });
      changed = changed || clearedSegment !== segment;
      return clearedSegment;
    }

    const match = getBestVoiceMatch(signature, references);
    if (!match) {
      const clearedSegment = applyAutoAssignmentResult(segment, {
        speakerId: null,
        speakerConfidence: null,
        speakerAssignmentSource: null,
        speakerReviewReason: "No saved voice sample matched this segment strongly enough yet.",
        speakerAlternateSpeakerId: null,
        speakerAlternateConfidence: null
      });
      changed = changed || clearedSegment !== segment;
      return clearedSegment;
    }

    const nextSegment = applyAutoAssignmentResult(segment, {
      speakerId: match.speakerId,
      speakerConfidence: roundConfidence(match.similarity),
      speakerAssignmentSource: match.speakerAssignmentSource,
      speakerReviewReason: match.reviewReason,
      speakerAlternateSpeakerId: match.alternateSpeakerId,
      speakerAlternateConfidence:
        match.alternateSimilarity !== null ? roundConfidence(match.alternateSimilarity) : null
    });

    if (!areTranscriptSegmentsEquivalent(segment, nextSegment)) {
      changed = true;
    }

    return nextSegment;
  });

  if (!changed) {
    return transcript;
  }

  return saveTranscriptEdits(clipId, transcript.textContent, transcript.srtContent, nextSegments);
}

async function captureVoiceSample(
  clipId: string,
  segment: TranscriptSegmentRecord,
  saveSample: (sample: CollaboratorVoiceSample) => void
): Promise<CollaboratorVoiceSample> {
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists.");
  }

  if (
    segment.startMs === null ||
    segment.endMs === null ||
    segment.endMs - segment.startMs < MIN_SAMPLE_DURATION_MS
  ) {
    throw new Error("Pick a subtitle segment that contains at least one second of clean speech.");
  }

  const audio = await extractClipAudio(clip.sourcePath);
  const signature = computeVoiceSignatureFromAudio(audio, segment.startMs, segment.endMs);
  if (!signature) {
    throw new Error(
      "This subtitle segment did not contain a reliable single-speaker voice sample. Try a cleaner or slightly longer line."
    );
  }

  const sample: CollaboratorVoiceSample = {
    id: randomUUID(),
    clipId,
    segmentId: segment.id,
    source: "clip_segment",
    transcriptPreview: segment.text.trim().slice(0, 140),
    startMs: segment.startMs,
    endMs: segment.endMs,
    signature,
    createdAt: new Date().toISOString()
  };

  saveSample(sample);
  return sample;
}

function buildVoiceReferences(
  creatorVoiceSamples: CollaboratorVoiceSample[],
  collaborators: CollaboratorProfile[]
): VoiceReference[] {
  const creatorReference =
    creatorVoiceSamples.length > 0
      ? [
          {
            speakerId: CREATOR_SPEAKER_ID,
            signature: averageSignature(creatorVoiceSamples.map((sample) => sample.signature))
          }
        ]
      : [];

  const collaboratorReferences = collaborators
    .filter((profile) => profile.voiceSamples.length > 0)
    .map((profile) => ({
      speakerId: profile.id,
      signature: averageSignature(profile.voiceSamples.map((sample) => sample.signature))
    }));

  return [...creatorReference, ...collaboratorReferences].filter((reference) => reference.signature.length > 0);
}

function getBestVoiceMatch(
  signature: number[],
  references: VoiceReference[]
): VoiceMatchResult | null {
  const ranked = rankVoiceMatches(signature, references);

  const best = ranked[0];
  if (!best || best.similarity < REVIEW_CONFIDENCE_THRESHOLD) {
    return null;
  }

  const runnerUp = ranked[1];
  const highConfidence =
    best.similarity >= HIGH_CONFIDENCE_THRESHOLD &&
    (!runnerUp || best.similarity - runnerUp.similarity >= VOICE_MATCH_MARGIN);

  return {
    speakerId: best.reference.speakerId,
    similarity: best.similarity,
    speakerAssignmentSource: highConfidence ? "auto_high_confidence" : "auto_low_confidence",
    reviewReason: highConfidence ? null : buildLowConfidenceReason(best, runnerUp),
    alternateSpeakerId: runnerUp?.reference.speakerId ?? null,
    alternateSimilarity: runnerUp?.similarity ?? null
  };
}

function rankVoiceMatches(
  signature: number[],
  references: VoiceReference[]
): RankedVoiceMatch[] {
  return references
    .map((reference) => ({
      reference,
      similarity: getVoiceSimilarity(signature, reference.signature)
    }))
    .sort((left, right) => right.similarity - left.similarity);
}

function buildLowConfidenceReason(
  best: RankedVoiceMatch,
  runnerUp: RankedVoiceMatch | undefined
): string {
  if (
    runnerUp &&
    best.similarity >= REVIEW_CONFIDENCE_THRESHOLD &&
    best.similarity - runnerUp.similarity < VOICE_MATCH_MARGIN
  ) {
    return "The closest saved voice match was only slightly ahead of another speaker sample.";
  }

  if (best.similarity < HIGH_CONFIDENCE_THRESHOLD) {
    return "The best saved voice match was usable, but it stayed below the high-confidence threshold.";
  }

  return "This match is usable, but it still needs a quick human review.";
}

function getVoiceSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let weightedDistance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const scale = FEATURE_SCALES[index] ?? 1;
    const weight = FEATURE_WEIGHTS[index] ?? 1;
    const normalizedDelta = (left[index]! - right[index]!) / scale;
    weightedDistance += normalizedDelta * normalizedDelta * weight;
  }

  return 1 / (1 + Math.sqrt(weightedDistance));
}

function averageSignature(signatures: number[][]): number[] {
  if (signatures.length === 0) {
    return [];
  }

  const dimensionCount = signatures[0]?.length ?? 0;
  if (dimensionCount === 0) {
    return [];
  }

  const accumulator = new Array<number>(dimensionCount).fill(0);
  for (const signature of signatures) {
    for (let index = 0; index < dimensionCount; index += 1) {
      accumulator[index] += signature[index] ?? 0;
    }
  }

  return accumulator.map((value) => value / signatures.length);
}

function applyAutoAssignmentResult(
  segment: TranscriptSegmentRecord,
  input: {
    speakerId: string | null;
    speakerConfidence: number | null;
    speakerAssignmentSource: TranscriptSegmentRecord["speakerAssignmentSource"];
    speakerReviewReason: string | null;
    speakerAlternateSpeakerId: string | null;
    speakerAlternateConfidence: number | null;
  }
): TranscriptSegmentRecord {
  if (segment.speakerAssignmentSource === "manual") {
    return segment;
  }

  return {
    ...segment,
    speakerId: input.speakerId,
    speakerConfidence: input.speakerConfidence,
    speakerAssignmentSource: input.speakerAssignmentSource,
    speakerReviewReason: input.speakerReviewReason,
    speakerAlternateSpeakerId: input.speakerAlternateSpeakerId,
    speakerAlternateConfidence: input.speakerAlternateConfidence
  };
}

function areTranscriptSegmentsEquivalent(
  left: TranscriptSegmentRecord,
  right: TranscriptSegmentRecord
): boolean {
  return (
    left.speakerId === right.speakerId &&
    left.speakerConfidence === right.speakerConfidence &&
    left.speakerAssignmentSource === right.speakerAssignmentSource &&
    left.speakerReviewReason === right.speakerReviewReason &&
    left.speakerAlternateSpeakerId === right.speakerAlternateSpeakerId &&
    left.speakerAlternateConfidence === right.speakerAlternateConfidence
  );
}

function shouldProcessSegment(
  segment: TranscriptSegmentRecord,
  scope: TranscriptAutoAssignScope
): boolean {
  if (segment.speakerAssignmentSource === "manual") {
    return false;
  }

  switch (scope) {
    case "all":
      return true;
    case "needs_review":
      return segment.speakerAssignmentSource === "auto_low_confidence";
    case "unassigned":
      return !segment.speakerId;
  }
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function extractClipAudio(sourcePath: string): Promise<AudioData> {
  const ffmpegRuntime = await getToolRuntimeStatus("ffmpeg");
  if (!ffmpegRuntime.available || !ffmpegRuntime.resolvedPath) {
    throw new Error("FFmpeg must be configured locally before voice samples can be analyzed.");
  }

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "creator-workspace-voice-"));
  const wavPath = path.join(tempDirectory, AUDIO_FILE_NAME);

  try {
    await runProcess(ffmpegRuntime.resolvedPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      `${TARGET_SAMPLE_RATE}`,
      "-ac",
      "1",
      wavPath
    ]);

    const wavBuffer = await readFile(wavPath);
    return parseMono16BitPcmWav(wavBuffer);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function parseMono16BitPcmWav(buffer: Buffer): AudioData {
  if (buffer.length < 44) {
    throw new Error("The extracted voice sample audio was unexpectedly short.");
  }

  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("The extracted voice sample audio was not a PCM WAV file.");
  }

  let sampleRate = TARGET_SAMPLE_RATE;
  let bitsPerSample = 16;
  let channelCount = 1;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      const audioFormat = buffer.readUInt16LE(chunkStart);
      channelCount = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      if (audioFormat !== 1) {
        throw new Error("Only PCM WAV voice samples are supported in this milestone.");
      }
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error("The extracted voice sample audio did not contain a PCM data chunk.");
  }

  if (channelCount !== 1 || bitsPerSample !== 16) {
    throw new Error("Voice profile analysis expects mono 16-bit PCM audio.");
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(dataOffset + index * 2) / 32768;
  }

  return {
    sampleRate,
    samples
  };
}

function computeVoiceSignatureFromAudio(
  audio: AudioData,
  startMs: number | null,
  endMs: number | null
): number[] | null {
  if (startMs === null || endMs === null || endMs <= startMs) {
    return null;
  }

  const startIndex = Math.max(0, Math.floor((startMs / 1000) * audio.sampleRate));
  const endIndex = Math.min(audio.samples.length, Math.ceil((endMs / 1000) * audio.sampleRate));
  if (endIndex - startIndex < audio.sampleRate * 0.5) {
    return null;
  }

  return computeVoiceSignature(audio.samples.subarray(startIndex, endIndex), audio.sampleRate);
}

function computeVoiceSignature(samples: Float32Array, sampleRate: number): number[] | null {
  const trimmed = trimSilence(samples);
  if (trimmed.length < sampleRate * 0.5) {
    return null;
  }

  const frameSize = 400;
  const hopSize = 160;
  const rmsValues: number[] = [];
  const zcrValues: number[] = [];
  const centroidValues: number[] = [];
  const pitchValues: number[] = [];
  const bandAccumulator = new Array<number>(BAND_FREQUENCIES.length).fill(0);
  let voicedFrames = 0;
  let totalFrames = 0;

  for (let start = 0; start + frameSize <= trimmed.length; start += hopSize) {
    totalFrames += 1;
    const frame = trimmed.subarray(start, start + frameSize);
    const centered = centerFrame(frame);
    const rms = getRms(centered);
    if (rms < 0.018) {
      continue;
    }

    voicedFrames += 1;
    rmsValues.push(rms);
    zcrValues.push(getZeroCrossingRate(centered));

    const bandMagnitudes = BAND_FREQUENCIES.map((frequency) =>
      getGoertzelMagnitude(centered, sampleRate, frequency)
    );
    const totalBandMagnitude = bandMagnitudes.reduce((sum, value) => sum + value, 0);
    if (totalBandMagnitude > 0) {
      bandMagnitudes.forEach((value, index) => {
        bandAccumulator[index] += value / totalBandMagnitude;
      });

      const weightedFrequencySum = bandMagnitudes.reduce(
        (sum, value, index) => sum + value * BAND_FREQUENCIES[index]!,
        0
      );
      centroidValues.push(weightedFrequencySum / totalBandMagnitude / 4000);
    } else {
      centroidValues.push(0);
    }

    const pitch = estimatePitch(centered, sampleRate);
    if (pitch !== null) {
      pitchValues.push(pitch);
    }
  }

  if (voicedFrames < 5) {
    return null;
  }

  const meanBandRatios = bandAccumulator.map((value) => value / voicedFrames);
  const lowHighBalance = Math.log10(
    (meanBandRatios[0]! + meanBandRatios[1]! + 1e-4) /
      (meanBandRatios[3]! + meanBandRatios[4]! + 1e-4)
  );

  return [
    mean(pitchValues) / 400,
    standardDeviation(pitchValues) / 120,
    mean(zcrValues),
    mean(rmsValues),
    mean(centroidValues),
    meanBandRatios[0] ?? 0,
    meanBandRatios[1] ?? 0,
    meanBandRatios[2] ?? 0,
    meanBandRatios[3] ?? 0,
    meanBandRatios[4] ?? 0,
    lowHighBalance,
    voicedFrames / Math.max(totalFrames, 1)
  ].map((value) => (Number.isFinite(value) ? value : 0));
}

function centerFrame(frame: Float32Array): Float32Array {
  const meanValue = mean(Array.from(frame));
  const centered = new Float32Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) {
    centered[index] = frame[index]! - meanValue;
  }
  return centered;
}

function trimSilence(samples: Float32Array): Float32Array {
  let start = 0;
  let end = samples.length - 1;

  while (start < samples.length && Math.abs(samples[start] ?? 0) < 0.012) {
    start += 1;
  }

  while (end > start && Math.abs(samples[end] ?? 0) < 0.012) {
    end -= 1;
  }

  return samples.subarray(start, end + 1);
}

function getRms(frame: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const value = frame[index] ?? 0;
    sum += value * value;
  }

  return Math.sqrt(sum / frame.length);
}

function getZeroCrossingRate(frame: Float32Array): number {
  let crossings = 0;
  for (let index = 1; index < frame.length; index += 1) {
    const previous = frame[index - 1] ?? 0;
    const current = frame[index] ?? 0;
    if ((previous >= 0 && current < 0) || (previous < 0 && current >= 0)) {
      crossings += 1;
    }
  }

  return crossings / frame.length;
}

function estimatePitch(frame: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 70);
  let bestLag = 0;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let index = 0; index + lag < frame.length; index += 1) {
      const left = frame[index] ?? 0;
      const right = frame[index + lag] ?? 0;
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const normalizedCorrelation = correlation / Math.sqrt(leftEnergy * rightEnergy + 1e-8);
    if (normalizedCorrelation > bestScore) {
      bestScore = normalizedCorrelation;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestScore < 0.52) {
    return null;
  }

  return sampleRate / bestLag;
}

function getGoertzelMagnitude(frame: Float32Array, sampleRate: number, frequency: number): number {
  const frameLength = frame.length;
  const bin = Math.max(1, Math.round((frameLength * frequency) / sampleRate));
  const omega = (2 * Math.PI * bin) / frameLength;
  const coefficient = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let index = 0; index < frameLength; index += 1) {
    q0 = coefficient * q1 - q2 + (frame[index] ?? 0);
    q2 = q1;
    q1 = q0;
  }

  const real = q1 - q2 * Math.cos(omega);
  const imaginary = q2 * Math.sin(omega);
  return Math.sqrt(real * real + imaginary * imaginary);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) * (value - average), 0) / values.length
  );
}
