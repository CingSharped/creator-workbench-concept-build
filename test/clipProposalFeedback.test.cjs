const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { bootstrapLocalDatabase, getDatabaseContext, readDatabase } = require("../dist/electron/services/database.js");
const {
  listClipProposalFeedback,
  recordClipProposalDecision,
  replaceClipProposalsForSource
} = require("../dist/electron/services/clipProposalRepository.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-clip-feedback-test-"));
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
      scheduledPosts: [],
      longFormSources: [],
      clipProposals: []
    }),
    "utf8"
  );
});

test("preserves decision feedback when active proposals are regenerated", { concurrency: false }, () => {
  const sourceId = "source-1";
  const [proposal] = replaceClipProposalsForSource(sourceId, [{
    sourceId,
    startMs: 10_000,
    endMs: 20_000,
    hook: "The clutch moment",
    reason: "Clear payoff",
    confidence: 0.82,
    evidenceSegmentIds: ["segment-1"],
    analysis: null,
    status: "proposed"
  }], {
    provenance: {
      task: "clip_discovery",
      profileId: "clip-profile",
      model: "qwen3:14b",
      executionMode: "ai",
      inputRecordIds: [sourceId, "transcript-1"],
      learningExampleClipIds: []
    }
  });

  const decision = recordClipProposalDecision({
    sourceId,
    proposalId: proposal.id,
    decision: "rejected",
    selectedStartMs: 11_000,
    selectedEndMs: 18_000,
    layout: null,
    approvedClipId: null,
    rejectionReason: "The payoff starts too late."
  });

  assert.equal(decision.proposal.status, "rejected");
  assert.equal(listClipProposalFeedback().length, 1);
  assert.equal(listClipProposalFeedback()[0].selectedStartMs, 11_000);
  assert.equal(listClipProposalFeedback()[0].rejectionReason, "The payoff starts too late.");
  assert.equal(listClipProposalFeedback()[0].provenance.profileId, "clip-profile");

  replaceClipProposalsForSource(sourceId, [{
    sourceId,
    startMs: 30_000,
    endMs: 42_000,
    hook: "A new moment",
    reason: "A new payoff",
    confidence: 0.76,
    evidenceSegmentIds: ["segment-2"],
    analysis: null,
    status: "proposed"
  }]);

  assert.equal(readDatabase().clipProposals.length, 1);
  assert.equal(readDatabase().clipProposals[0].hook, "A new moment");
  assert.equal(listClipProposalFeedback().length, 1);
  assert.equal(listClipProposalFeedback()[0].proposalId, proposal.id);
});

test("migrates existing decided proposal records into feedback history", { concurrency: false }, () => {
  const databasePath = getDatabaseContext().databasePath;
  fs.writeFileSync(databasePath, JSON.stringify({
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
    scheduledPosts: [],
    longFormSources: [],
    clipProposals: [{
      id: "legacy-proposal",
      sourceId: "source-legacy",
      startMs: 0,
      endMs: 8_000,
      hook: "Legacy hook",
      reason: "Legacy reason",
      confidence: 0.7,
      evidenceSegmentIds: [],
      status: "approved",
      approvedClipId: "clip-legacy",
      rejectionReason: null,
      decisionAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    }]
  }), "utf8");

  const database = readDatabase();
  assert.equal(database.clipProposalFeedback.length, 1);
  assert.equal(database.clipProposalFeedback[0].decision, "approved");
  assert.equal(database.clipProposalFeedback[0].approvedClipId, "clip-legacy");
  assert.ok(JSON.parse(fs.readFileSync(databasePath, "utf8")).clipProposalFeedback);
});
