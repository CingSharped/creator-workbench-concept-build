const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bootstrapLocalDatabase,
  getDatabaseContext,
  readDatabase,
  updateDatabase
} = require("../dist/electron/services/database.js");
const {
  getPerformanceDashboard,
  refreshPerformanceDashboard
} = require("../dist/electron/services/performanceDashboardService.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-history-test-"));
bootstrapLocalDatabase(tempRoot);

test.beforeEach(() => {
  fs.writeFileSync(
    getDatabaseContext().databasePath,
    JSON.stringify({
      workspaces: [],
      clips: [],
      appSettings: {},
      jobs: [],
      transcripts: [],
      metadataPackages: [],
      metadataVariants: [],
      metadataFeedback: [],
      youtubePerformanceSnapshots: [],
      importedYouTubePerformanceRecords: [],
      scheduledPosts: []
    }),
    "utf8"
  );
});

test("dashboard includes imported channel history and infers known game and series context", () => {
  updateDatabase((store) => {
    store.metadataPackages.push(createMetadataPackage({
      clipId: "clip-known",
      gameTitle: "Minecraft",
      seriesKey: "Hardcore Run"
    }));

    store.importedYouTubePerformanceRecords.push({
      id: "import-1",
      videoId: "video-123",
      title: "Minecraft Hardcore Run 12 was chaos",
      channelTitle: "Splumpy Beast",
      publishedAt: "2026-06-15T12:00:00.000Z",
      publishedUrl: "https://www.youtube.com/watch?v=video-123",
      durationSeconds: 55,
      thumbnailUrl: null,
      tags: ["Minecraft", "Hardcore Run", "gaming"],
      views: 15000,
      engagedViews: 9000,
      estimatedMinutesWatched: 1800,
      averageViewDuration: 12,
      averageViewPercentage: 68,
      likes: 1200,
      comments: 80,
      importedAt: "2026-07-28T10:00:00.000Z",
      fetchedAt: "2026-07-28T10:00:00.000Z"
    });
  });

  const dashboard = getPerformanceDashboard({ range: "since_2025" });

  assert.equal(dashboard.historicalImportedVideoCount, 1);
  assert.equal(dashboard.ownedSnapshots.length, 1);
  assert.equal(dashboard.ownedSnapshots[0].source, "channel_import");
  assert.equal(dashboard.ownedSnapshots[0].gameTitle, "Minecraft");
  assert.equal(dashboard.ownedSnapshots[0].seriesKey, "Hardcore Run");
  assert.ok(dashboard.availableGameTitles.includes("Minecraft"));
  assert.ok(dashboard.availableSeriesKeys.includes("Hardcore Run"));
});

test("workspace-managed posts win over imported history when the same YouTube video is present twice", () => {
  updateDatabase((store) => {
    store.clips.push({
      id: "clip-1",
      workspaceId: "workspace-1",
      displayName: "Clip One",
      sourcePath: "C:/clips/clip-one.mp4",
      fileSizeBytes: 2048,
      durationMs: 45000,
      widthPx: 1080,
      heightPx: 1920,
      status: "posted",
      inspectionStatus: "ffprobe",
      importedAt: "2026-07-01T09:00:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z"
    });
    store.metadataPackages.push(createMetadataPackage({
      clipId: "clip-1",
      gameTitle: "Minecraft",
      seriesKey: "Hardcore Run"
    }));
    store.scheduledPosts.push({
      id: "post-1",
      workspaceId: "workspace-1",
      clipId: "clip-1",
      platform: "youtube",
      accountLabel: "Primary account",
      publishAt: "2026-07-02T09:00:00.000Z",
      executionMode: "native_schedule",
      status: "posted",
      title: "Minecraft Hardcore Run 12 was chaos",
      description: "",
      platformTags: ["Minecraft"],
      youtubePlaylistIds: [],
      remotePostId: "video-123",
      publishedUrl: "https://www.youtube.com/watch?v=video-123",
      errorMessage: null,
      createdAt: "2026-07-01T09:00:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z"
    });
    store.youtubePerformanceSnapshots.push({
      id: "snapshot-1",
      clipId: "clip-1",
      scheduledPostId: "post-1",
      videoId: "video-123",
      views: 15000,
      engagedViews: 9000,
      estimatedMinutesWatched: 1800,
      averageViewDuration: 12,
      averageViewPercentage: 68,
      likes: 1200,
      comments: 80,
      fetchedAt: "2026-07-28T10:00:00.000Z"
    });
    store.importedYouTubePerformanceRecords.push({
      id: "import-1",
      videoId: "video-123",
      title: "Minecraft Hardcore Run 12 was chaos",
      channelTitle: "Splumpy Beast",
      publishedAt: "2026-07-02T09:00:00.000Z",
      publishedUrl: "https://www.youtube.com/watch?v=video-123",
      durationSeconds: 45,
      thumbnailUrl: null,
      tags: ["Minecraft", "Hardcore Run"],
      views: 15000,
      engagedViews: 9000,
      estimatedMinutesWatched: 1800,
      averageViewDuration: 12,
      averageViewPercentage: 68,
      likes: 1200,
      comments: 80,
      importedAt: "2026-07-28T10:00:00.000Z",
      fetchedAt: "2026-07-28T10:00:00.000Z"
    });
  });

  const dashboard = getPerformanceDashboard({ range: "since_2025" });

  assert.equal(dashboard.ownedSnapshots.length, 1);
  assert.equal(dashboard.ownedSnapshots[0].source, "workspace_post");
  assert.equal(dashboard.ownedSnapshots[0].clipId, "clip-1");
  assert.equal(dashboard.ownedSnapshots[0].scheduledPostId, "post-1");
});

test("dashboard reads saved filters without recursively resolving or rewriting them", () => {
  const savedValue = JSON.stringify({
    range: "28d",
    regionCode: "GB",
    format: "all",
    gameTitle: "Minecraft",
    seriesKey: "Hardcore Run",
    trendMode: "most_popular_gaming",
    query: "",
    metric: "views"
  });
  const savedAt = "2026-08-09T09:00:00.000Z";

  updateDatabase((store) => {
    store.appSettings["performance.dashboard_filters"] = {
      value: savedValue,
      updatedAt: savedAt
    };
  });

  const dashboard = getPerformanceDashboard();
  assert.equal(dashboard.filters.gameTitle, "Minecraft");
  assert.equal(dashboard.filters.metric, "views");

  const stored = require("../dist/electron/services/database.js").readDatabase();
  assert.equal(stored.appSettings["performance.dashboard_filters"].updatedAt, savedAt);
});

test("destructive migration removes public trend data while preserving owned records", () => {
  fs.writeFileSync(
    getDatabaseContext().databasePath,
    JSON.stringify({
      schemaVersion: 3,
      workspaces: [{ id: "workspace-1", name: "Owned workspace", createdAt: "2026-08-01", updatedAt: "2026-08-01" }],
      clips: [],
      appSettings: {
        "performance.dashboard_filters": {
          value: JSON.stringify({ range: "28d", regionCode: "GB", format: "all", gameTitle: "Halo", seriesKey: "", trendMode: "most_popular_gaming", query: "gaming", metric: "views" }),
          updatedAt: "2026-08-01"
        },
        "ai.profiles": {
          value: JSON.stringify([{ id: "owned-profile", task: "youtube_metadata", name: "Owned" }, { id: "trend-profile", task: "trend_research", name: "Public trends" }]),
          updatedAt: "2026-08-01"
        },
        "ai.profile_assignments": {
          value: JSON.stringify({ youtubeMetadataProfileId: "owned-profile", trendResearchProfileId: "trend-profile" }),
          updatedAt: "2026-08-01"
        }
      },
      jobs: [],
      transcripts: [],
      metadataPackages: [],
      metadataVariants: [{ id: "variant-1", provenance: { task: "youtube_metadata", trendContextUsed: true } }],
      metadataFeedback: [{ id: "feedback-1", provenance: { task: "youtube_metadata", trendContextUsed: false } }],
      youtubeVideoCache: [],
      youtubeMetadataDrafts: [],
      thumbnailCandidates: [],
      youtubePerformanceSnapshots: [],
      importedYouTubePerformanceRecords: [],
      publicTrendRecords: [{ id: "legacy-trend", title: "Delete me" }],
      scheduledPosts: [],
      longFormSources: [],
      clipProposals: [{ id: "proposal-1", provenance: { task: "clip_discovery", trendContextUsed: true } }],
      clipProposalFeedback: [{ id: "feedback-2", provenance: { task: "clip_discovery", trendContextUsed: true } }]
    }),
    "utf8"
  );

  const migrated = readDatabase();
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "publicTrendRecords"), false);
  assert.equal(migrated.workspaces.length, 1);
  assert.equal(JSON.parse(migrated.appSettings["performance.dashboard_filters"].value).regionCode, undefined);
  assert.equal(JSON.parse(migrated.appSettings["ai.profiles"].value).some((profile) => profile.task === "trend_research"), false);
  assert.equal(JSON.parse(migrated.appSettings["ai.profile_assignments"].value).trendResearchProfileId, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.metadataVariants[0].provenance, "trendContextUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.metadataFeedback[0].provenance, "trendContextUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.clipProposals[0].provenance, "trendContextUsed"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.clipProposalFeedback[0].provenance, "trendContextUsed"), false);
  assert.equal(JSON.parse(fs.readFileSync(getDatabaseContext().databasePath, "utf8")).schemaVersion, 4);

  const reread = readDatabase();
  assert.equal(Object.prototype.hasOwnProperty.call(reread, "publicTrendRecords"), false);
  assert.equal(reread.workspaces[0].id, "workspace-1");
});

test("trend cleanup tolerates malformed trend settings without discarding them", () => {
  fs.writeFileSync(
    getDatabaseContext().databasePath,
    JSON.stringify({
      schemaVersion: 3,
      workspaces: [],
      appSettings: {
        "performance.dashboard_filters": { value: "not-json", updatedAt: "2026-08-01" },
        "ai.profiles": { value: "{not-json", updatedAt: "2026-08-01" }
      },
      publicTrendRecords: [{ id: "legacy-trend" }]
    }),
    "utf8"
  );

  const migrated = readDatabase();
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "publicTrendRecords"), false);
  assert.equal(migrated.appSettings["performance.dashboard_filters"].value, "not-json");
  assert.equal(migrated.appSettings["ai.profiles"].value, "{not-json");
  assert.equal(JSON.parse(fs.readFileSync(getDatabaseContext().databasePath, "utf8")).schemaVersion, 4);
});

test("new performance filter saves omit deprecated public trend fields", async () => {
  await refreshPerformanceDashboard({
    range: "28d",
    format: "all",
    gameTitle: "Minecraft",
    seriesKey: "Hardcore Run",
    metric: "views",
    regionCode: "GB",
    trendMode: "most_popular_gaming",
    query: "public search"
  });

  const savedFilters = JSON.parse(readDatabase().appSettings["performance.dashboard_filters"].value);
  assert.deepEqual(savedFilters, {
    range: "28d",
    format: "all",
    gameTitle: "Minecraft",
    seriesKey: "Hardcore Run",
    metric: "views"
  });
});

function createMetadataPackage(input) {
  return {
    id: `metadata-${input.clipId}`,
    clipId: input.clipId,
    title: "",
    description: "",
    publicHashtags: [],
    platformTags: [],
    seriesKey: input.seriesKey,
    gameTitle: input.gameTitle,
    collaboratorProfileIds: [],
    selectedVariantIds: {
      title: null,
      description: null,
      publicHashtags: null,
      platformTags: null
    },
    latestScoreSnapshot: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z"
  };
}
