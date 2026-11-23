const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseClipProposalResponse,
  parseVisualClipReview,
  buildTranscriptClipProposalHeuristics,
  buildClipProposalPromptWindows,
  CLIP_PROPOSAL_WINDOW_MAX_CHARS
} = require("../dist/electron/services/longFormClipProposalService.js");
const { analyzeCandidateMedia } = require("../dist/electron/services/mediaAnalysisService.js");

const transcript = {
  id: "transcript-1",
  clipId: "source-1",
  modelPath: "whisper.bin",
  language: "en",
  textContent: "",
  srtContent: "",
  segments: [
    { id: "seg-1", startMs: 0, endMs: 12000, text: "We lost the round, but then I found the clutch save.", speakerId: null },
    { id: "seg-2", startMs: 12000, endMs: 30000, text: "That was completely unexpected.", speakerId: null }
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z"
};

test("parses object-shaped AI proposals and derives transcript evidence", () => {
  const proposals = parseClipProposalResponse({
    proposals: [{ startMs: 1000, endMs: 20000, hook: "The clutch save", reason: "A clear payoff", confidence: 0.8 }]
  }, "source-1", transcript);

  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0].evidenceSegmentIds, ["seg-1", "seg-2"]);
  assert.equal(proposals[0].status, "proposed");
});

test("expands short AI moments into reviewable ranges and rejects malformed candidates", () => {
  const expanded = parseClipProposalResponse([{ startMs: 1000, endMs: 2000, hook: "Short reaction", reason: "A clear payoff" }], "source-1", transcript);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].startMs, 0);
  assert.equal(expanded[0].endMs, 5000);

  const malformed = parseClipProposalResponse([{ startMs: 0, endMs: 1000, reason: "Missing hook" }], "source-1", transcript);
  assert.equal(malformed.length, 0);

  const fallback = buildTranscriptClipProposalHeuristics("source-1", transcript);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].evidenceSegmentIds[0], "seg-1");
  assert.equal(fallback[0].status, "proposed");
});

test("does not cap valid AI candidates at six", () => {
  const longTranscript = {
    ...transcript,
    segments: Array.from({ length: 10 }, (_, index) => ({
      id: `ai-segment-${index}`,
      startMs: index * 10000,
      endMs: index * 10000 + 8000,
      text: `Distinct gaming moment ${index}`,
      speakerId: null
    }))
  };
  const proposals = parseClipProposalResponse({
    proposals: longTranscript.segments.map((segment, index) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      hook: `Hook ${index}`,
      reason: `Reason ${index}`,
      confidence: 0.9,
      evidenceSegmentIds: [segment.id]
    }))
  }, "source-1", longTranscript);

  assert.equal(proposals.length, 10);
});

test("does not cap heuristic candidates at three", () => {
  const longTranscript = {
    ...transcript,
    segments: Array.from({ length: 5 }, (_, index) => ({
      id: `fallback-segment-${index}`,
      startMs: index * 70000,
      endMs: index * 70000 + 12000,
      text: `This was an unexpected clutch save ${index}`,
      speakerId: null
    }))
  };
  const fallback = buildTranscriptClipProposalHeuristics("source-1", longTranscript);

  assert.equal(fallback.length, 5);
});

test("parses structured visual evidence and preserves sampled frame timestamps", () => {
  const review = parseVisualClipReview({
    actionReactionScore: 0.9,
    visualClarityContextScore: 0.8,
    sceneChangeScore: 0.6,
    onScreenImportanceScore: 0.7,
    summary: "The gameplay escalation is visible and the important HUD state remains readable.",
    evidence: ["Frame 1 shows the player entering the fight.", "Frame 3 shows the decisive HUD state."],
    limitations: ["Only three frames were sampled; motion between frames is not verified."]
  }, [0, 15000, 29750]);

  assert.ok(review);
  assert.equal(review.overallScore, 0.75);
  assert.deepEqual(review.frameTimestampsMs, [0, 15000, 29750]);
  assert.equal(review.evidence.length, 2);
  assert.equal(parseVisualClipReview({ summary: "Missing scores" }, [0]), null);
});

test("bounds long-form AI context into contiguous transcript windows", () => {
  const longTranscript = {
    ...transcript,
    segments: Array.from({ length: 500 }, (_, index) => ({
      id: `segment-${index}`,
      startMs: index * 5000,
      endMs: index * 5000 + 4500,
      text: "A transcript segment with enough text to exercise the bounded prompt window."
    }))
  };

  const windows = buildClipProposalPromptWindows(longTranscript);
  assert.ok(windows.length > 1);
  assert.equal(windows.flat().length, longTranscript.segments.length);
  assert.ok(windows.every((window) => {
    const chars = window
      .map((segment) => `${segment.id} | ${segment.startMs}-${segment.endMs}ms | ${segment.text}`)
      .join("\n")
      .length;
    return chars <= CLIP_PROPOSAL_WINDOW_MAX_CHARS;
  }));
});

test("stops media analysis immediately when clip proposal generation is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    analyzeCandidateMedia({
      sourcePath: "not-used-after-cancel.mp4",
      startMs: 0,
      endMs: 10_000,
      includeFrames: true,
      signal: controller.signal
    }),
    /Clip proposal generation cancelled\./
  );
});
