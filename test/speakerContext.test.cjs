const assert = require("node:assert/strict");
const { test } = require("node:test");

const { buildSpeakerContextSummary } = require("../dist/shared/speakerContext.js");
const { normalizeVoiceSamples } = require("../dist/shared/creatorProfileLinks.js");

function makeTranscript(overrides = {}) {
  return {
    id: "transcript-1",
    clipId: "clip-1",
    sourceId: null,
    status: "complete",
    textContent: "Hello there",
    srtContent: "1\n00:00:00,000 --> 00:00:01,000\nHello there",
    segments: [],
    modelPath: "whisper.bin",
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    ...overrides
  };
}

function segment(id, speakerId, source = "manual", confidence = null, reviewReason = null) {
  return {
    id,
    startMs: 0,
    endMs: 1000,
    text: id,
    speakerId,
    speakerConfidence: confidence,
    speakerAssignmentSource: source,
    speakerReviewReason: reviewReason,
    speakerAlternateSpeakerId: null,
    speakerAlternateConfidence: null
  };
}

test("speaker context is unavailable without trusted creator speech", () => {
  const summary = buildSpeakerContextSummary(makeTranscript({ segments: [segment("guest", "unknown-speaker")] }));

  assert.equal(summary.status, "unavailable");
  assert.equal(summary.creatorTrustedSegmentCount, 0);
  assert.equal(summary.unassignedSegmentCount, 1);
  assert.equal(summary.needsReviewSegmentCount, 0);
  assert.equal(summary.unresolvedSegmentCount, 1);
});

test("speaker context separates trusted creator, collaborators, and uncertain segments", () => {
  const summary = buildSpeakerContextSummary(makeTranscript({
    segments: [
      segment("creator", "creator:self", "manual"),
      segment("collaborator", "guest-1", "auto_high_confidence", 0.91),
      segment("uncertain", null, null, null, "Needs review")
    ]
  }), [
    { id: "guest-1", displayName: "Guest", profileLinks: {}, speakerColorHex: null, voiceSamples: [] }
  ]);

  assert.equal(summary.status, "partial");
  assert.equal(summary.creatorTrustedSegmentCount, 1);
  assert.deepEqual(summary.collaboratorCounts, [{
    speakerId: "guest-1",
    displayName: "Guest",
    trustedSegmentCount: 1
  }]);
  assert.equal(summary.unresolvedSegmentCount, 1);
  assert.equal(summary.unassignedSegmentCount, 1);
  assert.equal(summary.needsReviewSegmentCount, 0);
  assert.equal(summary.lowConfidenceSegmentCount, 1);
});

test("incomplete transcripts remain partial even when assignments are trusted", () => {
  const summary = buildSpeakerContextSummary(makeTranscript({
    status: "incomplete",
    segments: [segment("creator", "creator:self")]
  }));

  assert.equal(summary.status, "partial");
  assert.equal(summary.transcriptComplete, false);
});

test("manual confirmation resolves a low-confidence automatic match", () => {
  const autoSummary = buildSpeakerContextSummary(makeTranscript({
    segments: [segment("creator", "creator:self", "auto_low_confidence", 0.55, "Review this match")]
  }));
  const manualSummary = buildSpeakerContextSummary(makeTranscript({
    segments: [segment("creator", "creator:self", "manual")]
  }));

  assert.equal(autoSummary.status, "partial");
  assert.equal(autoSummary.unresolvedSegmentCount, 1);
  assert.equal(autoSummary.needsReviewSegmentCount, 1);
  assert.equal(autoSummary.unassignedSegmentCount, 0);
  assert.equal(manualSummary.status, "identified");
  assert.equal(manualSummary.needsReviewSegmentCount, 0);
  assert.equal(manualSummary.unassignedSegmentCount, 0);
  assert.equal(manualSummary.unresolvedSegmentCount, 0);
});

test("assigned low-confidence and unknown segments are counted separately", () => {
  const summary = buildSpeakerContextSummary(makeTranscript({
    segments: [
      segment("creator", "creator:self", "manual"),
      segment("guest-review", "guest-1", "auto_low_confidence", 0.55),
      segment("unknown", "unknown-speaker", "manual")
    ]
  }), [
    { id: "guest-1", displayName: "Guest", profileLinks: {}, speakerColorHex: null, voiceSamples: [] }
  ]);

  assert.equal(summary.needsReviewSegmentCount, 1);
  assert.equal(summary.unassignedSegmentCount, 1);
  assert.equal(summary.unresolvedSegmentCount, 2);
  assert.equal(summary.status, "partial");
});

test("fully manual creator and collaborator assignments are resolved", () => {
  const summary = buildSpeakerContextSummary(makeTranscript({
    segments: [
      segment("creator", "creator:self", "manual"),
      segment("guest", "guest-1", "manual")
    ]
  }), [
    { id: "guest-1", displayName: "Guest", profileLinks: {}, speakerColorHex: null, voiceSamples: [] }
  ]);

  assert.equal(summary.status, "identified");
  assert.equal(summary.unassignedSegmentCount, 0);
  assert.equal(summary.needsReviewSegmentCount, 0);
  assert.equal(summary.unresolvedSegmentCount, 0);
});

test("manual assignments remain resolved when legacy review metadata is present", () => {
  const summary = buildSpeakerContextSummary(makeTranscript({
    segments: [
      segment("creator", "creator:self", "manual", 0.2, "Old automatic review note")
    ]
  }));

  assert.equal(summary.status, "identified");
  assert.equal(summary.needsReviewSegmentCount, 0);
  assert.equal(summary.lowConfidenceSegmentCount, 0);
});

test("legacy samples normalize as transcript samples while microphone samples stay unowned", () => {
  const samples = normalizeVoiceSamples([
    {
      id: "legacy",
      clipId: "clip-1",
      segmentId: "segment-1",
      transcriptPreview: "Legacy sample",
      startMs: 10,
      endMs: 1000,
      signature: [0.1],
      createdAt: "2026-09-05T10:00:00.000Z"
    },
    {
      id: "microphone",
      source: "microphone",
      transcriptPreview: "Recorded sample",
      signature: [0.2],
      createdAt: "2026-09-05T10:01:00.000Z"
    }
  ]);

  assert.equal(samples[0].source, "clip_segment");
  assert.equal(samples[1].source, "microphone");
  assert.equal(samples[1].clipId, null);
  assert.equal(samples[1].segmentId, null);
});
