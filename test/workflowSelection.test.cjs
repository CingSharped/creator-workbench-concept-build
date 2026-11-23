const test = require("node:test");
const assert = require("node:assert/strict");

const { deriveReviewSelection, reconcileWorkflowSelection } = require("../dist/shared/workflowSelection.js");

test("review selection prefers long-form source context and transcript", () => {
  const clip = { id: "clip-1", displayName: "Clip" };
  const source = { id: "source-1", displayName: "Source", sourcePath: "source.mp4", inspectionStatus: "basic", indexState: "active", archivedAt: null, importedAt: "now", updatedAt: "now", fileSizeBytes: 1, durationMs: 1000, widthPx: 1, heightPx: 1 };
  const clipTranscript = { id: "clip-transcript", assetType: "clip", assetId: "clip-1" };
  const sourceTranscript = { id: "source-transcript", assetType: "long_form_source", assetId: "source-1" };
  const selection = deriveReviewSelection([clip], [source], "clip-1", "source-1", clipTranscript, sourceTranscript);
  assert.equal(selection.selectedClip.id, "clip-1");
  assert.equal(selection.reviewClip.id, "source-1");
  assert.equal(selection.reviewTranscript.id, "source-transcript");
});

test("workflow selection keeps valid IDs and clears stale proposal context", () => {
  const selection = reconcileWorkflowSelection(
    { selectedClipId: "missing-clip", selectedLongFormSourceId: "source-1", selectedLongFormProposalId: "missing-proposal" },
    [{ id: "clip-1" }],
    [{ id: "source-1" }],
    [{ id: "proposal-1", sourceId: "source-1" }]
  );

  assert.deepEqual(selection, {
    selectedClipId: "clip-1",
    selectedLongFormSourceId: "source-1",
    selectedLongFormProposalId: null
  });
});

test("workflow refresh preserves the selected long-form source and proposal", () => {
  const selection = reconcileWorkflowSelection(
    { selectedClipId: "clip-1", selectedLongFormSourceId: "source-1", selectedLongFormProposalId: "proposal-1" },
    [{ id: "clip-1" }],
    [{ id: "source-1" }],
    [{ id: "proposal-1", sourceId: "source-1" }]
  );

  assert.deepEqual(selection, {
    selectedClipId: "clip-1",
    selectedLongFormSourceId: "source-1",
    selectedLongFormProposalId: "proposal-1"
  });
});
