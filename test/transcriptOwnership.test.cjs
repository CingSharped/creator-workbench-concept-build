const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { bootstrapLocalDatabase, readDatabase, updateDatabase } = require("../dist/electron/services/database.js");
const { saveTranscriptEditsForAsset } = require("../dist/electron/services/transcriptRepository.js");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-transcript-owner-"));
bootstrapLocalDatabase(tempDirectory);

updateDatabase((store) => {
  store.longFormSources.push({
    id: "source-1",
    displayName: "Co-op stream",
    sourcePath: "C:\\Videos\\co-op.mp4",
    sourceFingerprint: null,
    fileSizeBytes: 100,
    durationMs: 5000,
    frameRate: 60,
    widthPx: 1920,
    heightPx: 1080,
    inspectionStatus: "basic",
    indexState: "active",
    archivedAt: null,
    importedAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z"
  });
  store.transcripts.push({
    id: "transcript-1",
    assetType: "long_form_source",
    assetId: "source-1",
    clipId: "source-1",
    modelPath: "whisper.bin",
    language: "en",
    textContent: "Original line",
    srtContent: "1\n00:00:00,000 --> 00:00:05,000\nOriginal line",
    segments: [{
      id: "segment-1",
      startMs: 0,
      endMs: 5000,
      text: "Original line",
      speakerId: null,
      speakerConfidence: null,
      speakerAssignmentSource: null,
      speakerReviewReason: null,
      speakerAlternateSpeakerId: null,
      speakerAlternateConfidence: null
    }],
    status: "complete",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z"
  });
});

test("asset-aware transcript edits update the long-form transcript", () => {
  const updated = saveTranscriptEditsForAsset(
    "long_form_source",
    "source-1",
    "First line Second line",
    "1\n00:00:00,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:02,000 --> 00:00:05,000\nSecond line",
    [
      {
        id: "segment-1-before",
        startMs: 0,
        endMs: 2000,
        text: "First line",
        speakerId: null,
        speakerConfidence: null,
        speakerAssignmentSource: null,
        speakerReviewReason: null,
        speakerAlternateSpeakerId: null,
        speakerAlternateConfidence: null
      },
      {
        id: "segment-1-after",
        startMs: 2000,
        endMs: 5000,
        text: "Second line",
        speakerId: null,
        speakerConfidence: null,
        speakerAssignmentSource: null,
        speakerReviewReason: null,
        speakerAlternateSpeakerId: null,
        speakerAlternateConfidence: null
      }
    ]
  );

  assert.equal(updated.assetType, "long_form_source");
  assert.equal(updated.assetId, "source-1");
  assert.equal(updated.segments.length, 2);
  assert.equal(readDatabase().transcripts[0].assetType, "long_form_source");
  assert.equal(readDatabase().transcripts[0].textContent, "First line Second line");
});

test.after(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});
