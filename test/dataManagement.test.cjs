const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  bootstrapLocalDatabase,
  getDatabaseContext,
  readDatabase,
  updateDatabase
} = require("../dist/electron/services/database.js");
const { CURRENT_DATABASE_SCHEMA_VERSION } = require("../dist/electron/services/database.js");
const { createImportedClip, listClips, setClipLineage } = require("../dist/electron/services/clipRepository.js");
const { createLongFormSource, listLongFormSources } = require("../dist/electron/services/longFormSourceRepository.js");
const { upsertTranscript, getTranscriptByClipId, getTranscriptByLongFormSourceId } = require("../dist/electron/services/transcriptRepository.js");
const { clearClipLibraryIndex, clearLongFormIndex, cleanupOrphanedData, scanDataHealth } = require("../dist/electron/services/dataManagementService.js");
const { deleteClipAppData } = require("../dist/electron/services/clipDataRemovalService.js");

function resetDatabase() {
  fs.writeFileSync(getDatabaseContext().databasePath, JSON.stringify({
    workspaces: [], clips: [], appSettings: {}, jobs: [], transcripts: [], metadataPackages: [],
    metadataVariants: [], metadataFeedback: [], youtubePerformanceSnapshots: [],
    importedYouTubePerformanceRecords: [], scheduledPosts: [],
    longFormSources: [], clipProposals: [], clipProposalFeedback: []
  }), "utf8");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-data-management-"));
bootstrapLocalDatabase(tempRoot);

test.beforeEach(resetDatabase);
test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test("legacy records migrate active index state and separate transcript ownership", () => {
  const legacyClip = { id: "clip-1", workspaceId: "w", displayName: "Clip", sourcePath: "C:\\media\\clip.mp4", fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, status: "imported", inspectionStatus: "basic", importedAt: "2026-01-01", updatedAt: "2026-01-01" };
  const legacySource = { id: "source-1", displayName: "Stream", sourcePath: "C:\\media\\stream.mp4", fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic", importedAt: "2026-01-01", updatedAt: "2026-01-01" };
  fs.writeFileSync(getDatabaseContext().databasePath, JSON.stringify({
    clips: [legacyClip], longFormSources: [legacySource], transcripts: [{ id: "t", clipId: "source-1", modelPath: "m", language: "en", textContent: "hello", srtContent: "", segments: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }]
  }), "utf8");

  const migrated = readDatabase();
  assert.equal(migrated.clips[0].indexState, "active");
  assert.equal(migrated.longFormSources[0].indexState, "active");
  assert.equal(migrated.clips[0].sourceFingerprint, null);
  assert.equal(migrated.longFormSources[0].sourceFingerprint, null);
  assert.equal(migrated.transcripts[0].assetType, "long_form_source");
  assert.equal(migrated.transcripts[0].assetId, "source-1");
  assert.equal(migrated.schemaVersion, CURRENT_DATABASE_SCHEMA_VERSION);
  assert.equal(JSON.parse(fs.readFileSync(getDatabaseContext().databasePath, "utf8")).schemaVersion, CURRENT_DATABASE_SCHEMA_VERSION);
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(getDatabaseContext().databasePath, "utf8")).clips[0], "sourceFingerprint"), true);
});

test("database writes use the current schema and remove the recovery temp file", () => {
  updateDatabase((store) => {
    store.appSettings.test = { value: "value", updatedAt: "2026-08-13" };
  });

  const databasePath = getDatabaseContext().databasePath;
  assert.equal(JSON.parse(fs.readFileSync(databasePath, "utf8")).schemaVersion, CURRENT_DATABASE_SCHEMA_VERSION);
  assert.equal(fs.existsSync(`${databasePath}.tmp`), false);
});

test("a valid recovery temp file is promoted when the main database is missing", () => {
  const databasePath = getDatabaseContext().databasePath;
  const recoveryPath = `${databasePath}.tmp`;
  fs.writeFileSync(recoveryPath, JSON.stringify({
    schemaVersion: 1,
    workspaces: [],
    clips: [],
    appSettings: { recovered: { value: "yes", updatedAt: "2026-08-13" } },
    jobs: [],
    transcripts: [],
    metadataPackages: [],
    metadataVariants: [],
    metadataFeedback: [],
    youtubePerformanceSnapshots: [],
    importedYouTubePerformanceRecords: [],
    scheduledPosts: [],
    longFormSources: [],
    clipProposals: [],
    clipProposalFeedback: []
  }), "utf8");
  fs.rmSync(databasePath);

  const recovered = readDatabase();
  assert.equal(recovered.appSettings.recovered.value, "yes");
  assert.equal(fs.existsSync(databasePath), true);
  assert.equal(fs.existsSync(recoveryPath), false);
});

test("database rejects invalid present collection shapes instead of silently dropping data", () => {
  const databasePath = getDatabaseContext().databasePath;
  fs.writeFileSync(databasePath, JSON.stringify({ clips: { unexpected: true } }), "utf8");
  assert.throws(() => readDatabase(), /collection 'clips' is invalid/);
});

test("clearing indexes archives only and preserves related history", async () => {
  const clip = createImportedClip({ workspaceId: "w", displayName: "Clip", sourcePath: path.join(tempRoot, "clip.mp4"), fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic" }).clip;
  const source = createLongFormSource({ displayName: "Source", sourcePath: path.join(tempRoot, "source.mp4"), fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic" });
  upsertTranscript({ clipId: source.id, assetType: "long_form_source", assetId: source.id, modelPath: "m", language: "en", textContent: "source", srtContent: "" });
  updateDatabase((store) => {
    store.metadataPackages.push({ id: "metadata", clipId: clip.id, title: "title", description: "", publicHashtags: [], platformTags: [], seriesKey: "", gameTitle: "", collaboratorProfileIds: [], selectedVariantIds: { title: null, description: null, publicHashtags: null, platformTags: null }, latestScoreSnapshot: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.clipProposals.push({ id: "proposal", sourceId: source.id, startMs: 0, endMs: 1000, hook: "hook", reason: "reason", confidence: 1, evidenceSegmentIds: [], status: "proposed", approvedClipId: null, rejectionReason: null, decisionAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  });

  const clipResult = await clearClipLibraryIndex();
  const sourceResult = await clearLongFormIndex();
  assert.equal(clipResult.affectedCount, 1);
  assert.equal(sourceResult.affectedCount, 1);
  assert.equal(listClips().length, 0);
  assert.equal(listLongFormSources().length, 0);
  const preserved = readDatabase();
  assert.equal(preserved.clips[0].indexState, "archived");
  assert.equal(preserved.longFormSources[0].indexState, "archived");
  assert.equal(preserved.metadataPackages.length, 1);
  assert.equal(preserved.clipProposals.length, 1);
  assert.equal(getTranscriptByLongFormSourceId(source.id).assetType, "long_form_source");
});

test("reimport reactivates the same clip record", () => {
  const sourcePath = path.join(tempRoot, "reactivate.mp4");
  const first = createImportedClip({ workspaceId: "w", displayName: "First", sourcePath, fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic" }).clip;
  updateDatabase((store) => { store.clips[0].indexState = "archived"; store.clips[0].archivedAt = "2026-01-01"; });
  const second = createImportedClip({ workspaceId: "w", displayName: "Reimported", sourcePath: sourcePath.toUpperCase(), fileSizeBytes: 2, durationMs: 2000, widthPx: 1, heightPx: 1, inspectionStatus: "ffprobe" }).clip;
  assert.equal(second.id, first.id);
  assert.equal(second.indexState, "active");
  assert.equal(listClips()[0].displayName, "Reimported");
});

test("reimport does not attach replacement media to the old clip history", () => {
  const sourcePath = path.join(tempRoot, "replaced.mp4");
  const fingerprint = { normalizedPath: sourcePath.toLowerCase(), fileSizeBytes: 10, durationMs: 1000, modifiedAtMs: 1 };
  const first = createImportedClip({ workspaceId: "w", displayName: "First", sourcePath, sourceFingerprint: fingerprint, fileSizeBytes: 10, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic" }).clip;
  updateDatabase((store) => { store.clips[0].indexState = "archived"; store.clips[0].archivedAt = "2026-01-01"; });

  const replacement = createImportedClip({
    workspaceId: "w",
    displayName: "Replacement",
    sourcePath,
    sourceFingerprint: { ...fingerprint, fileSizeBytes: 20, modifiedAtMs: 2 },
    fileSizeBytes: 20,
    durationMs: 1000,
    widthPx: 1,
    heightPx: 1,
    inspectionStatus: "ffprobe"
  }).clip;
  assert.notEqual(replacement.id, first.id);
  assert.equal(readDatabase().clips.find((clip) => clip.id === first.id).indexState, "archived");
  assert.equal(replacement.indexState, "active");
});

test("deleting clip app data removes workflow records but preserves AI learning history and the source file", () => {
  const sourcePath = path.join(tempRoot, "delete-me.mp4");
  fs.writeFileSync(sourcePath, "video placeholder");
  const clip = createImportedClip({
    workspaceId: "w",
    displayName: "Delete me",
    sourcePath,
    fileSizeBytes: 1,
    durationMs: 1000,
    widthPx: 1,
    heightPx: 1,
    inspectionStatus: "basic"
  }).clip;

  upsertTranscript({ clipId: clip.id, modelPath: "m", language: "en", textContent: "hello", srtContent: "" });
  updateDatabase((store) => {
    store.metadataPackages.push({ id: "metadata", clipId: clip.id, title: "title", description: "", publicHashtags: [], platformTags: [], seriesKey: "", gameTitle: "", collaboratorProfileIds: [], selectedVariantIds: { title: null, description: null, publicHashtags: null, platformTags: null }, latestScoreSnapshot: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.metadataVariants.push({ id: "variant", generationId: "generation", clipId: clip.id, platform: "youtube", kind: "title", angle: "specific_fail", content: "title", source: "ai", scoreSnapshot: null, createdAt: "2026-01-01" });
    store.metadataFeedback.push({ id: "metadata-feedback", clipId: clip.id, variantId: "variant", decision: "approved", createdAt: "2026-01-01" });
    store.scheduledPosts.push({ id: "post", workspaceId: "w", clipId: clip.id, platform: "youtube", accountLabel: "channel", publishAt: "2026-01-01T00:00:00.000Z", executionMode: "scheduled", status: "scheduled", title: "title", description: "", platformTags: [], youtubePlaylistIds: [], remotePostId: null, publishedUrl: null, errorMessage: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.youtubePerformanceSnapshots.push({ id: "snapshot", clipId: clip.id, scheduledPostId: "post", videoId: "video", views: 1, engagedViews: 1, estimatedMinutesWatched: 1, averageViewDuration: 1, averageViewPercentage: 1, likes: 1, comments: 1, fetchedAt: "2026-01-01" });
    store.jobs.push({ id: "job", workspaceId: "w", clipId: clip.id, jobType: "transcription", status: "completed", errorMessage: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.clipProposals.push({ id: "proposal", sourceId: "source", startMs: 0, endMs: 1000, hook: "hook", reason: "reason", confidence: 1, evidenceSegmentIds: [], status: "approved", approvedClipId: clip.id, rejectionReason: null, decisionAt: "2026-01-01", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.clipProposalFeedback.push({ id: "proposal-feedback", sourceId: "source", proposalId: "proposal", generationId: null, decision: "approved", originalStartMs: 0, originalEndMs: 1000, selectedStartMs: 0, selectedEndMs: 1000, hook: "hook", reason: "reason", confidence: 1, evidenceSegmentIds: [], analysis: null, rejectionReason: null, approvedClipId: clip.id, layout: null, decidedAt: "2026-01-01", createdAt: "2026-01-01" });
  });

  const result = deleteClipAppData(clip.id);
  const remaining = readDatabase();
  assert.equal(result.removed.clipRecord, 1);
  assert.equal(result.removed.transcriptRecords, 1);
  assert.equal(result.removed.scheduledPosts, 1);
  assert.equal(result.removed.performanceSnapshots, 1);
  assert.equal(result.removed.jobs, 1);
  assert.equal(result.removed.proposalRecords, 1);
  assert.equal(remaining.clips.some((entry) => entry.id === clip.id), false);
  assert.equal(remaining.transcripts.some((entry) => entry.assetId === clip.id), false);
  assert.equal(remaining.scheduledPosts.some((entry) => entry.clipId === clip.id), false);
  assert.equal(remaining.youtubePerformanceSnapshots.some((entry) => entry.clipId === clip.id), false);
  assert.equal(remaining.jobs.some((entry) => entry.clipId === clip.id), false);
  assert.equal(remaining.metadataPackages[0].clipId, clip.id);
  assert.equal(remaining.metadataVariants[0].clipId, clip.id);
  assert.equal(remaining.metadataFeedback[0].clipId, clip.id);
  assert.equal(remaining.clipProposalFeedback[0].decision, "approved");
  assert.equal(remaining.clipProposalFeedback[0].approvedClipId, null);
  assert.equal(fs.existsSync(sourcePath), true);
});

test("orphan cleanup deletes only selected terminal jobs and blocks active work", async () => {
  updateDatabase((store) => {
    store.jobs.push({ id: "orphan", workspaceId: "w", clipId: "missing", jobType: "transcription", status: "completed", errorMessage: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.jobs.push({ id: "active", workspaceId: "w", clipId: "missing", jobType: "transcription", status: "running", errorMessage: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  });
  const scan = await scanDataHealth();
  assert.ok(scan.safeIssueIds.some((id) => id.endsWith(":job:orphan")));
  await assert.rejects(() => cleanupOrphanedData(scan.safeIssueIds), /Finish or cancel active/);
  updateDatabase((store) => { store.jobs = store.jobs.filter((job) => job.id !== "active"); });
  const result = await cleanupOrphanedData(scan.safeIssueIds);
  assert.equal(result.affectedCount, 1);
  assert.ok(fs.readdirSync(path.join(tempRoot, "backups")).length >= 1);
  assert.equal(readDatabase().jobs.some((job) => job.id === "orphan"), false);
});

test("long-form job ownership and approved clip lineage are validated independently", async () => {
  const source = createLongFormSource({ displayName: "Source", sourcePath: path.join(tempRoot, "lineage-source.mp4"), fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic" });
  const clip = createImportedClip({ workspaceId: "w", displayName: "Approved clip", sourcePath: path.join(tempRoot, "lineage-clip.mp4"), fileSizeBytes: 1, durationMs: 500, widthPx: 1, heightPx: 1, inspectionStatus: "basic" }).clip;
  updateDatabase((store) => {
    store.clipProposals.push({ id: "lineage-proposal", sourceId: source.id, startMs: 100, endMs: 600, hook: "hook", reason: "reason", confidence: 1, evidenceSegmentIds: [], status: "approved", approvedClipId: clip.id, rejectionReason: null, decisionAt: "2026-01-01", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.jobs.push({ id: "long-form-job", workspaceId: "w", clipId: source.id, jobType: "transcribe_long_form_source", status: "completed", errorMessage: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  });
  setClipLineage(clip.id, { sourceType: "long_form_source", sourceId: source.id, proposalId: "lineage-proposal", startMs: 100, endMs: 600 });

  const validScan = await scanDataHealth();
  assert.equal(validScan.issues.some((issue) => issue.recordType === "clip lineage"), false);
  assert.equal(readDatabase().jobs.find((job) => job.id === "long-form-job").assetType, "long_form_source");
  assert.equal(readDatabase().jobs.find((job) => job.id === "long-form-job").assetId, source.id);

  updateDatabase((store) => { store.clipProposals[0].approvedClipId = "different-clip"; });
  const brokenScan = await scanDataHealth();
  assert.ok(brokenScan.issues.some((issue) => issue.recordType === "clip lineage" && issue.recordId === clip.id));
});

test("data health reports malformed records and missing approved proposal relationships without making them deletable", async () => {
  updateDatabase((store) => {
    store.clips.push({ id: "", workspaceId: "w", displayName: "Malformed", sourcePath: "", fileSizeBytes: -1, durationMs: -1, widthPx: 1, heightPx: 1, status: "imported", inspectionStatus: "basic", lineage: null, indexState: "active", archivedAt: null, importedAt: "2026-01-01", updatedAt: "2026-01-01" });
    store.clipProposals.push({ id: "broken-approved-proposal", sourceId: "missing-source", startMs: 0, endMs: 1000, hook: "hook", reason: "reason", confidence: 1, evidenceSegmentIds: [], status: "approved", approvedClipId: "missing-clip", rejectionReason: null, decisionAt: "2026-01-01", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  });

  const scan = await scanDataHealth();
  const invalid = scan.issues.find((issue) => issue.category === "invalid_record" && issue.recordType === "clip");
  const brokenProposal = scan.issues.find((issue) => issue.recordId === "broken-approved-proposal" && issue.detail.includes("approved clip"));
  assert.ok(invalid);
  assert.equal(invalid.safeToDelete, false);
  assert.ok(brokenProposal);
  assert.equal(brokenProposal.safeToDelete, false);
});

test("duplicate source cleanup keeps one owner and repoints long-form history", async () => {
  const sourcePath = path.join(tempRoot, "duplicate-source.mp4");
  const first = createLongFormSource({ displayName: "First", sourcePath, fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1, inspectionStatus: "basic" });
  const second = { ...first, id: "duplicate-source", displayName: "Second", importedAt: "2026-01-02", updatedAt: "2026-01-02" };
  updateDatabase((store) => { store.longFormSources.push(second); });
  upsertTranscript({ clipId: second.id, assetType: "long_form_source", assetId: second.id, modelPath: "m", language: "en", textContent: "duplicate transcript", srtContent: "" });
  updateDatabase((store) => {
    store.clipProposals.push({ id: "duplicate-proposal", sourceId: second.id, startMs: 0, endMs: 1000, hook: "hook", reason: "reason", confidence: 1, evidenceSegmentIds: [], status: "proposed", approvedClipId: null, rejectionReason: null, decisionAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  });

  const scan = await scanDataHealth();
  const duplicateIssue = scan.issues.find((issue) => issue.category === "duplicate_source_path" && issue.recordId === second.id);
  assert.equal(duplicateIssue.reviewRequired, true);
  assert.equal(duplicateIssue.safeToDelete, true);
  await assert.rejects(() => cleanupOrphanedData(scan.issues.filter((issue) => issue.category === "duplicate_source_path").map((issue) => issue.id)), /Keep at least one/);

  const result = await cleanupOrphanedData([duplicateIssue.id]);
  assert.equal(result.affectedCount, 1);
  assert.equal(readDatabase().longFormSources.some((source) => source.id === second.id), false);
  assert.equal(getTranscriptByLongFormSourceId(first.id).textContent, "duplicate transcript");
  assert.equal(readDatabase().clipProposals[0].sourceId, first.id);
});
