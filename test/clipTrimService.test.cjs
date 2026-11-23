const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapLocalDatabase, getDatabaseContext } = require("../dist/electron/services/database.js");
const {
  calculateStackedCrop,
  exportStackedVerticalMedia,
  exportTrimmedClip
} = require("../dist/electron/services/clipTrimService.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-trim-test-"));
const sourcePath = path.join(tempRoot, "source.mp4");
bootstrapLocalDatabase(tempRoot);
fs.writeFileSync(sourcePath, "not a real video", "utf8");
fs.writeFileSync(
  getDatabaseContext().databasePath,
  JSON.stringify({
    workspaces: [],
    clips: [{
      id: "clip-1",
      workspaceId: "workspace-1",
      displayName: "Source Clip.mp4",
      sourcePath,
      fileSizeBytes: 16,
      durationMs: 10_000,
      widthPx: 1920,
      heightPx: 1080,
      status: "imported",
      inspectionStatus: "basic",
      importedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    }],
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

test("rejects an invalid trim range before invoking FFmpeg", async () => {
  await assert.rejects(
    () => exportTrimmedClip({ clipId: "clip-1", startMs: 5000, endMs: 5000, outputPath: path.join(tempRoot, "trimmed.mp4") }),
    /trim end must be after the trim start/
  );
});

test("rejects attempts to overwrite the source clip", async () => {
  await assert.rejects(
    () => exportTrimmedClip({ clipId: "clip-1", startMs: 0, endMs: 1000, outputPath: sourcePath }),
    /original clip is not overwritten/
  );
});

test("requires an MP4 output path", async () => {
  await assert.rejects(
    () => exportTrimmedClip({ clipId: "clip-1", startMs: 0, endMs: 1000, outputPath: path.join(tempRoot, "trimmed.mov") }),
    /must use an \.mp4 output path/
  );
});

test("calculates a 9:8 source crop for each stacked vertical panel", () => {
  assert.deepEqual(calculateStackedCrop(1920, 1080), { widthPx: 1214, heightPx: 1080 });
  assert.deepEqual(calculateStackedCrop(1080, 1920), { widthPx: 1080, heightPx: 960 });
});

test("requires source dimensions before stacked vertical export", async () => {
  await assert.rejects(
    () => exportStackedVerticalMedia({
      sourcePath,
      durationMs: 10_000,
      widthPx: null,
      heightPx: null,
      startMs: 0,
      endMs: 1000,
      layout: { topFocusX: 0.5, topFocusY: 0.5, topScale: 1, bottomFocusX: 0.5, bottomFocusY: 0.5, bottomScale: 1 },
      outputPath: path.join(tempRoot, "stacked.mp4")
    }),
    /needs the source video dimensions/
  );
});

test("rejects stacked focus values outside the source frame", async () => {
  await assert.rejects(
    () => exportStackedVerticalMedia({
      sourcePath,
      durationMs: 10_000,
      widthPx: 1920,
      heightPx: 1080,
      startMs: 0,
      endMs: 1000,
      layout: { topFocusX: 1.1, topFocusY: 0.5, topScale: 1, bottomFocusX: 0.5, bottomFocusY: 0.5, bottomScale: 1 },
      outputPath: path.join(tempRoot, "stacked.mp4")
    }),
    /top horizontal focus must be between 0 and 1/
  );
});

test("rejects stacked crop sizes outside the safe zoom range", async () => {
  await assert.rejects(
    () => exportStackedVerticalMedia({
      sourcePath,
      durationMs: 10_000,
      widthPx: 1920,
      heightPx: 1080,
      startMs: 0,
      endMs: 1000,
      layout: { topFocusX: 0.5, topFocusY: 0.5, topScale: 0.1, bottomFocusX: 0.5, bottomFocusY: 0.5, bottomScale: 1 },
      outputPath: path.join(tempRoot, "stacked.mp4")
    }),
    /top crop size must be between 0.25 and 1/
  );
});
