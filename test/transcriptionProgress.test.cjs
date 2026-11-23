const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateExtractionPercent,
  calculateExtractionEta,
  estimateWhisperEtaRange,
  parseRecoverablePartialTranscript,
  buildWhisperChunks,
  parseWhisperProgress,
  calculateWhisperOverallPercent,
  mergeWhisperChunkOutputs
} = require("../dist/electron/services/transcriptionService.js");
const { runProcess } = require("../dist/electron/services/runtimeTools.js");

test("reports measured extraction percentage only when source duration is known", () => {
  assert.equal(calculateExtractionPercent(30_000, 120_000), 25);
  assert.equal(calculateExtractionPercent(120_000, 120_000), 99);
  assert.equal(calculateExtractionPercent(30_000, null), null);
});

test("does not produce a percentage for invalid progress values", () => {
  assert.equal(calculateExtractionPercent(Number.NaN, 120_000), null);
  assert.equal(calculateExtractionPercent(30_000, 0), null);
});

test("cancels an active child process through the transcription process runner", async () => {
  const controller = new AbortController();
  const running = runProcess(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], undefined, {
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(running, /Process cancelled/);
});

test("derives measured extraction ETA and labels Whisper ETA as an approximate range", () => {
  assert.equal(calculateExtractionEta(10_000, 25), 30_000);
  assert.equal(calculateExtractionEta(10_000, null), null);
  assert.deepEqual(estimateWhisperEtaRange(120_000, "ggml-base.bin"), { minMs: 60_000, maxMs: 300_000 });
  assert.deepEqual(estimateWhisperEtaRange(120_000, "ggml-large-v3.bin"), { minMs: 360_000, maxMs: 1_440_000 });
});

test("only treats timestamped SRT as a recoverable partial transcript", () => {
  const partial = parseRecoverablePartialTranscript(
    "1\n00:00:01,000 --> 00:00:03,000\nA recoverable line.\n",
    "A recoverable line."
  );
  assert.equal(partial.segments.length, 1);
  assert.equal(partial.textContent, "A recoverable line.");
  assert.equal(parseRecoverablePartialTranscript("partial text", "partial text"), null);
});

test("builds bounded overlapping Whisper chunks", () => {
  const chunks = buildWhisperChunks(1_205_000, 600_000, 2_000);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0], {
    index: 0,
    inputStartMs: 0,
    outputStartMs: 0,
    outputEndMs: 600_000,
    durationMs: 600_000
  });
  assert.deepEqual(chunks[1], {
    index: 1,
    inputStartMs: 598_000,
    outputStartMs: 600_000,
    outputEndMs: 1_200_000,
    durationMs: 602_000
  });
  assert.equal(chunks[2].outputEndMs, 1_205_000);
});

test("parses Whisper progress and maps it to overall chunk progress", () => {
  assert.equal(parseWhisperProgress("progress 42%"), 42);
  assert.equal(parseWhisperProgress("no progress yet"), null);
  assert.equal(calculateWhisperOverallPercent(1, 4, 50), 38);
  assert.equal(calculateWhisperOverallPercent(4, 4, 100), 99);
});

test("merges overlapping chunk SRT output without duplicating boundary text", () => {
  const merged = mergeWhisperChunkOutputs([
    {
      chunk: { index: 0, inputStartMs: 0, outputStartMs: 0, outputEndMs: 600_000, durationMs: 600_000 },
      srtContent: "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:09:59,000 --> 00:10:00,000\nBoundary\n",
      textContent: "Hello\nBoundary"
    },
    {
      chunk: { index: 1, inputStartMs: 598_000, outputStartMs: 600_000, outputEndMs: 1_200_000, durationMs: 602_000 },
      srtContent: "1\n00:00:01,000 --> 00:00:02,000\nBoundary\n\n2\n00:00:03,000 --> 00:00:04,000\nNext\n",
      textContent: "Boundary\nNext"
    }
  ]);

  assert.equal(merged.textContent, "Hello\nBoundary\nNext");
  assert.equal((merged.srtContent.match(/Boundary/g) ?? []).length, 1);
  assert.match(merged.srtContent, /00:10:01,000 --> 00:10:02,000/);
});
