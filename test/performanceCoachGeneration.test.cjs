const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const runtime = require("../dist/electron/services/localAiRuntimeService.js");
const { generatePerformanceCoach, parsePerformanceCoachResponse } = require("../dist/electron/services/performanceDashboardService.js");
const { bootstrapLocalDatabase, updateDatabase } = require("../dist/electron/services/database.js");
const { setAiStrictModeEnabled } = require("../dist/electron/services/aiProfileService.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-coach-json-"));
bootstrapLocalDatabase(root);
const timestamp = new Date(Date.now() - 86400000).toISOString();
updateDatabase(store => store.importedYouTubePerformanceRecords.push({
  id: "fixture-video", videoId: "video-one", title: "Example short", channelTitle: "Fixture channel",
  publishedAt: timestamp, publishedUrl: "https://www.youtube.com/watch?v=video-one", durationSeconds: 30,
  thumbnailUrl: null, tags: [], views: 100, engagedViews: 70, estimatedMinutesWatched: 30,
  averageViewDuration: 18, averageViewPercentage: 60, likes: 4, comments: 1, importedAt: timestamp, fetchedAt: timestamp
}));
const originalGenerate = runtime.generateLocalAiJson;
let calls, replies;
const valid = JSON.stringify({ summary: "Review the cached evidence.", limitations: ["Small sample"], insights: [{
  type: "experiment", title: "Collect comparable uploads", explanation: "Use the supplied period evidence to plan a small test.",
  confidence: "low", evidenceIds: ["period:views"], action: null
}] });
function reply(responseText, finishReason = "stop") { return { responseText, finishReason, model: "Fixture model", runtimeNotice: null }; }
test.beforeEach(() => {
  calls = []; replies = [];
  setAiStrictModeEnabled(true);
  runtime.generateLocalAiJson = async input => {
    calls.push(input);
    assert.ok(replies.length, "Unexpected extra model request");
    const response = replies.shift();
    if (response instanceof Error) throw response;
    return response;
  };
});
test.afterEach(() => { runtime.generateLocalAiJson = originalGenerate; });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("coach requests JSON without thinking and accepts grounded model output", async () => {
  replies.push(reply(valid));
  const result = await generatePerformanceCoach();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].disableThinking, true);
  assert.equal(result.executionMode, "ai");
  assert.equal(result.insights[0].evidence[0].id, "period:views");
});

test("explicit thinking prefix with JSON-like reasoning cannot hide the final answer", async () => {
  replies.push(reply('<think>Consider [metrics] and {possible interpretations} first.</think>\n```json\n' + valid + '\n```'));
  const result = await generatePerformanceCoach();
  assert.equal(result.executionMode, "ai");
  assert.equal(calls.length, 1);
});

test("malformed response gets one format retry with the same evidence", async () => {
  replies.push(reply('{"summary":"unfinished', "length"), reply(valid));
  const result = await generatePerformanceCoach();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].disableThinking, true);
  assert.deepEqual(calls[1].responseSchema, calls[0].responseSchema);
  assert.ok(calls[1].userPrompt.startsWith(calls[0].userPrompt));
  assert.match(calls[1].userPrompt, /regenerate from the evidence/);
  assert.equal(result.executionMode, "ai");
});

test("two malformed responses remain blocked in strict mode and report truncation", async () => {
  replies.push(reply("invalid"), reply('{"summary":"unfinished', "length"));
  await assert.rejects(generatePerformanceCoach(), /Strict AI mode.*after two attempts.*output limit/);
  assert.equal(calls.length, 2);
});

test("runtime failures are not retried as JSON errors", async () => {
  replies.push(new Error("Runtime unavailable"));
  await assert.rejects(generatePerformanceCoach(), /Strict AI mode.*Runtime unavailable/);
  assert.equal(calls.length, 1);
});

test("syntactically valid hallucinated evidence remains blocked", async () => {
  replies.push(reply(valid.replace('"period:views"', '"invented:evidence"')));
  await assert.rejects(generatePerformanceCoach(), /Strict AI mode.*no usable evidence-linked coaching/);
  assert.equal(calls.length, 1);
});

test("parser rejects incomplete JSON, arrays and unfinished reasoning", () => {
  for (const value of ['{"insights":[', '[{"insights":[]}]', 'null', '"text"', '<think>' + valid, '<think>' + valid + '</think>']) {
    assert.equal(parsePerformanceCoachResponse(value), null);
  }
  const withTag = valid.replace("Review the cached evidence.", "The literal <think> tag is text.");
  assert.equal(parsePerformanceCoachResponse(withTag).summary, "The literal <think> tag is text.");
});
