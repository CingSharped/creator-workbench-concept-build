const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildSrtFromTranscriptSegments,
  splitTranscriptSegment
} = require("../dist/shared/transcriptSegments.js");

function makeSegment(overrides = {}) {
  return {
    id: "segment-1",
    startMs: 0,
    endMs: 5000,
    text: "oh oh Johnson yes wait Johnson gets a revive",
    speakerId: null,
    speakerConfidence: null,
    speakerAssignmentSource: null,
    speakerReviewReason: null,
    speakerAlternateSpeakerId: null,
    speakerAlternateConfidence: null,
    ...overrides
  };
}

test("splits one timed segment into ordered SRT segments without mutating the source", () => {
  const source = [
    makeSegment(),
    makeSegment({ id: "segment-2", startMs: 5000, endMs: 7000, text: "Next line" })
  ];

  const result = splitTranscriptSegment(
    source,
    "segment-1",
    2200,
    "oh oh Johnson yes",
    "wait Johnson gets a revive"
  );

  assert.equal(source.length, 2);
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
    [
      { startMs: 0, endMs: 2200, text: "oh oh Johnson yes" },
      { startMs: 2200, endMs: 5000, text: "wait Johnson gets a revive" },
      { startMs: 5000, endMs: 7000, text: "Next line" }
    ]
  );
  assert.notEqual(result[0].id, "segment-1");
  assert.notEqual(result[1].id, "segment-1");
  assert.notEqual(result[0].id, result[1].id);

  const srt = buildSrtFromTranscriptSegments(result);
  assert.match(srt, /00:00:00,000 --> 00:00:02,200\noh oh Johnson yes/);
  assert.match(srt, /00:00:02,200 --> 00:00:05,000\nwait Johnson gets a revive/);
});

test("preserves manual speaker labels but clears automatic review state on split children", () => {
  const manual = splitTranscriptSegment(
    [makeSegment({
      speakerId: "creator:self",
      speakerConfidence: null,
      speakerAssignmentSource: "manual"
    })],
    "segment-1",
    2500,
    "First speaker",
    "Second speaker"
  );
  assert.equal(manual[0].speakerId, "creator:self");
  assert.equal(manual[1].speakerId, "creator:self");
  assert.equal(manual[0].speakerAssignmentSource, "manual");
  assert.equal(manual[1].speakerAssignmentSource, "manual");

  const automatic = splitTranscriptSegment(
    [makeSegment({
      speakerId: "guest-1",
      speakerConfidence: 0.61,
      speakerAssignmentSource: "auto_low_confidence",
      speakerReviewReason: "Review this match",
      speakerAlternateSpeakerId: "creator:self",
      speakerAlternateConfidence: 0.59
    })],
    "segment-1",
    2500,
    "First speaker",
    "Second speaker"
  );
  for (const child of automatic) {
    assert.equal(child.speakerId, null);
    assert.equal(child.speakerConfidence, null);
    assert.equal(child.speakerAssignmentSource, null);
    assert.equal(child.speakerReviewReason, null);
    assert.equal(child.speakerAlternateSpeakerId, null);
    assert.equal(child.speakerAlternateConfidence, null);
  }
});

test("rejects invalid split requests", () => {
  const cases = [
    ["missing segment", [makeSegment()], "missing", 2500, "First", "Second"],
    ["untimed segment", [makeSegment({ startMs: null, endMs: null })], "segment-1", 2500, "First", "Second"],
    ["split at start", [makeSegment()], "segment-1", 0, "First", "Second"],
    ["split at end", [makeSegment()], "segment-1", 5000, "First", "Second"],
    ["empty first text", [makeSegment()], "segment-1", 2500, " ", "Second"],
    ["empty second text", [makeSegment()], "segment-1", 2500, "First", " "],
    ["non-finite split", [makeSegment()], "segment-1", Number.NaN, "First", "Second"]
  ];

  for (const [label, segments, segmentId, splitAtMs, beforeText, afterText] of cases) {
    assert.throws(
      () => splitTranscriptSegment(segments, segmentId, splitAtMs, beforeText, afterText),
      undefined,
      label
    );
  }
});
