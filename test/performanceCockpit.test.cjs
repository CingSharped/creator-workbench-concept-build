const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPerformanceLaneBreakdowns,
  calculatePercentageChange,
  parsePerformanceCoachInsights
} = require("../dist/electron/services/performanceDashboardService.js");
const {
  YOUTUBE_VIDEO_PERFORMANCE_METRICS
} = require("../dist/electron/services/youtubeService.js");

function snapshot(input) {
  return {
    id: input.id,
    source: "channel_import",
    clipId: input.clipId || null,
    scheduledPostId: null,
    videoId: input.videoId || input.id,
    channelId: "channel-1",
    clipDisplayName: "Imported channel video",
    title: input.title || input.id,
    publishedUrl: `https://youtube.com/watch?v=${input.videoId || input.id}`,
    channelTitle: "Creator",
    gameTitle: input.gameTitle || "",
    seriesKey: input.seriesKey || "",
    tags: input.tags || [],
    thumbnailUrl: null,
    publishAt: input.publishAt || "2026-08-01T12:00:00.000Z",
    format: input.format || "shorts",
    ageDays: 1,
    performanceScore: input.performanceScore || 100,
    classificationSource: input.classificationSource || "metadata",
    views: input.views === undefined ? 1000 : input.views,
    engagedViews: input.engagedViews === undefined ? 700 : input.engagedViews,
    estimatedMinutesWatched: 12,
    averageViewDuration: 30,
    averageViewPercentage: input.averageViewPercentage === undefined ? 60 : input.averageViewPercentage,
    likes: 40,
    comments: 5,
    shares: null,
    subscribersGained: null,
    subscribersLost: null,
    viewerPercentage: null,
    fetchedAt: "2026-08-02T12:00:00.000Z"
  };
}

test("percentage comparisons remain unavailable for zero or missing baselines", () => {
  assert.equal(calculatePercentageChange(120, 100), 20);
  assert.equal(calculatePercentageChange(120, 0), null);
  assert.equal(calculatePercentageChange(null, 100), null);
});

test("video performance queries only use metrics supported by YouTube video reports", () => {
  assert.ok(YOUTUBE_VIDEO_PERFORMANCE_METRICS.includes("averageViewPercentage"));
  assert.ok(YOUTUBE_VIDEO_PERFORMANCE_METRICS.includes("subscribersGained"));
  assert.equal(YOUTUBE_VIDEO_PERFORMANCE_METRICS.includes("viewerPercentage"), false);
});

test("lane aggregation preserves sample size and inferred classification", () => {
  const lanes = buildPerformanceLaneBreakdowns([
    snapshot({ id: "one", title: "Minecraft run one", gameTitle: "Minecraft", tags: ["hardcore"], performanceScore: 120 }),
    snapshot({ id: "two", title: "Minecraft run two", gameTitle: "Minecraft", tags: ["hardcore"], performanceScore: 100, publishAt: "2026-08-03T12:00:00.000Z" }),
    snapshot({ id: "three", title: "Minecraft run three", gameTitle: "Minecraft", classificationSource: "inferred", tags: ["hardcore"], performanceScore: 80, publishAt: "2026-08-04T12:00:00.000Z" })
  ]);
  const gameLane = lanes.find((lane) => lane.dimension === "game" && lane.label === "Minecraft");
  assert.ok(gameLane);
  assert.equal(gameLane.sampleSize, 3);
  assert.equal(gameLane.classificationSource, "metadata");
  assert.equal(gameLane.strongestVideoId, "one");
  assert.ok(lanes.some((lane) => lane.dimension === "keyword" && lane.label === "hardcore"));
});

test("coach parsing drops malformed or hallucinated evidence references", () => {
  const evidence = [
    {
      id: "video:one",
      source: "video",
      label: "Video one",
      metric: "views",
      value: "1000",
      comparisonValue: null,
      recordId: "one",
      videoId: "video-one"
    }
  ];
  const parsed = parsePerformanceCoachInsights({
    summary: "Grounded",
    insights: [
      {
        type: "win",
        title: "Grounded insight",
        explanation: "Use the supplied video evidence.",
        confidence: "medium",
        evidenceIds: ["video:one", "invented-id"],
        action: { kind: "open_video", label: "Open", videoId: "video-one" }
      },
      {
        type: "warning",
        title: "Hallucinated insight",
        explanation: "This should be rejected.",
        confidence: "high",
        evidenceIds: ["invented-id"]
      }
    ]
  }, evidence);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].evidence[0].id, "video:one");
  assert.equal(parsed[0].action.kind, "open_video");
  assert.deepEqual(parsePerformanceCoachInsights({ insights: "not an array" }, evidence), []);
});
