const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { bootstrapLocalDatabase, getDatabaseContext } = require("../dist/electron/services/database.js");
const {
  listMetadataVariantsByClipId,
  replaceMetadataVariantsForClip
} = require("../dist/electron/services/metadataVariantRepository.js");
const { createMetadataFeedback } = require("../dist/electron/services/metadataFeedbackRepository.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-metadata-variants-test-"));
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

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("appends new metadata suggestions without duplicating or replacing old suggestions", () => {
  const clipId = "clip-1";
  replaceMetadataVariantsForClip(clipId, [
    {
      generationId: "generation-1",
      platform: "youtube",
      kind: "title",
      angle: "specific_fail",
      content: "The clutch moment",
      source: "ollama",
      scoreSnapshot: null,
      provenance: {
        task: "youtube_metadata",
        profileId: "profile-1",
        model: "gemma3:12b",
        executionMode: "ai",
        inputRecordIds: [clipId, "transcript-1"],
        learningExampleClipIds: ["older-clip"]
      }
    }
  ]);

  const appended = replaceMetadataVariantsForClip(
    clipId,
    [
      {
        generationId: "generation-2",
        platform: "youtube",
        kind: "title",
        angle: "specific_fail",
        content: " THE CLUTCH MOMENT ",
        source: "ollama",
        scoreSnapshot: null
      },
      {
        generationId: "generation-2",
        platform: "youtube",
        kind: "title",
        angle: "panic_tension",
        content: "The run nearly ended",
        source: "ollama",
        scoreSnapshot: null
      }
    ],
    { append: true }
  );

  assert.equal(appended.length, 1);
  assert.equal(listMetadataVariantsByClipId(clipId).length, 2);
  const originalVariant = listMetadataVariantsByClipId(clipId).find((variant) => variant.content === "The clutch moment");
  assert.equal(originalVariant.provenance.model, "gemma3:12b");
  assert.deepEqual(createMetadataFeedback(clipId, originalVariant.id, "approved").provenance.inputRecordIds, [clipId, "transcript-1"]);

  replaceMetadataVariantsForClip(clipId, [
    {
      generationId: "generation-3",
      platform: "youtube",
      kind: "title",
      angle: "specific_fail",
      content: "A replacement title",
      source: "heuristic",
      scoreSnapshot: null
    }
  ]);

  const finalVariants = listMetadataVariantsByClipId(clipId);
  assert.equal(finalVariants.length, 1);
  assert.equal(finalVariants[0].content, "A replacement title");
});
