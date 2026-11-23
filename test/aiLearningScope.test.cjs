const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bootstrapLocalDatabase, readDatabase, updateDatabase, getDatabaseContext } = require("../dist/electron/services/database.js");
const { buildAiProfileLearningContext, buildAiProfileLearningPrompt } = require("../dist/electron/services/aiProfileLearningService.js");
const { AI_LEARNING_LIMITS, selectMetadataPackagesForProfile } = require("../dist/electron/services/aiLearningScope.js");
const { replaceMetadataVariantsForClip } = require("../dist/electron/services/metadataVariantRepository.js");
const { createMetadataFeedback } = require("../dist/electron/services/metadataFeedbackRepository.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-learning-scope-"));
bootstrapLocalDatabase(root);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const profile = (id = "a", task = "youtube_metadata", settings = {}) => ({
  id, task, name: id, systemPrompt: "Saved prompt", preferredModel: "Saved model",
  knowledgeEntries: [], learningSettings: {
    mode: "adaptive_prompt", maxKnowledgeEntries: 12, includeApprovedExamples: true,
    includeRejectedExamples: true, includeHighPerformingExamples: true, ...settings
  }
});
const provenance = (id = "a", task = "youtube_metadata") => ({
  task, profileId: id, model: "model", executionMode: "ai", inputRecordIds: [], learningExampleClipIds: []
});
const date = index => new Date(Date.UTC(2026, 9, 21, 0, 0, index)).toISOString();
const feedback = (id, variantId, decision, index = 0, origin = provenance()) => ({
  id, clipId: "clip", variantId, decision, provenance: origin, createdAt: date(index)
});
const proposalFeedback = (id, proposalId, decision, index, origin = provenance("a", "clip_discovery"), reason = null) => ({
  id, proposalId, decision, provenance: origin, rejectionReason: reason, decidedAt: date(index), createdAt: date(index)
});
test.beforeEach(() => updateDatabase(store => {
  store.metadataFeedback = []; store.metadataVariants = []; store.clipProposalFeedback = [];
  store.appSettings = {
    "ai.profiles": { key: "ai.profiles", value: "protected profiles", updatedAt: date(0) },
    "ai.profile_assignments": { key: "ai.profile_assignments", value: "protected assignments", updatedAt: date(0) },
    "scoring.weights": { key: "scoring.weights", value: "protected weights", updatedAt: date(0) }
  };
}));

test("metadata feedback is scoped to its immutable task/profile provenance", () => {
  updateDatabase(store => {
    store.metadataFeedback = [
      feedback("own", "v1", "approved", 1),
      feedback("foreign-profile", "v2", "rejected", 2, provenance("b")),
      feedback("foreign-task", "v3", "rejected", 3, provenance("a", "clip_discovery")),
      feedback("legacy", "v4", "rejected", 4, null)
    ];
  });
  const context = buildAiProfileLearningContext(profile());
  assert.deepEqual(context.provenance.feedbackRecordIds, ["own"]);
  assert.match(context.prompt, /approved 1/); assert.match(context.prompt, /rejected 0/);
  assert.deepEqual(buildAiProfileLearningContext(profile("b")).provenance.feedbackRecordIds, ["foreign-profile"]);
  assert.equal(readDatabase().metadataFeedback.length, 4, "Legacy/history retained");
});

test("repeated saves count once and the latest decision wins independently of insertion order", () => {
  updateDatabase(store => {
    store.metadataFeedback = [
      feedback("latest", "v", "rejected", 5), feedback("old", "v", "approved", 1),
      feedback("duplicate", "v", "approved", 2)
    ];
  });
  const context = buildAiProfileLearningContext(profile());
  assert.deepEqual(context.provenance.feedbackRecordIds, ["latest"]);
  assert.match(context.prompt, /approved 0, edited 0, rejected 1/);
  updateDatabase(store => {
    store.metadataFeedback = [feedback("z-approved", "v", "approved", 1), feedback("a-rejected", "v", "rejected", 1)];
  });
  assert.deepEqual(buildAiProfileLearningContext(profile()).provenance.feedbackRecordIds, ["a-rejected"],
    "Equal timestamps use the later append, not the random feedback UUID");
});

test("recorded origin survives removal of active variants and cannot borrow a conflicting angle", () => {
  updateDatabase(store => {
    store.metadataFeedback = [feedback("kept", "v", "approved", 1)];
    store.metadataVariants = [{ id: "v", clipId: "clip", angle: "social_chaos", provenance: provenance("b") }];
  });
  const context = buildAiProfileLearningContext(profile());
  assert.match(context.prompt, /approved 1/);
  assert.doesNotMatch(context.prompt, /social_chaos/, "Conflicting mutable variant not used");
  updateDatabase(store => { store.metadataVariants = []; });
  assert.deepEqual(buildAiProfileLearningContext(profile()).provenance.feedbackRecordIds, ["kept"]);
});

test("learning flags, retrieval and off modes control inclusion without rewriting configuration", () => {
  updateDatabase(store => {
    store.metadataFeedback = [feedback("approved", "a", "approved", 1), feedback("rejected", "r", "rejected", 2)];
  });
  const selected = profile("a", "youtube_metadata", { includeApprovedExamples: false });
  assert.deepEqual(buildAiProfileLearningContext(selected).provenance.feedbackRecordIds, ["rejected"]);
  selected.learningSettings.includeRejectedExamples = false;
  assert.equal(buildAiProfileLearningPrompt(selected), null);
  selected.learningSettings.mode = "retrieval";
  selected.knowledgeEntries = [{ id: "knowledge", title: "Voice", content: "Be concise", enabled: true, tags: [] }];
  assert.match(buildAiProfileLearningPrompt(selected), /Be concise/);
  assert.deepEqual(buildAiProfileLearningContext(selected).provenance.feedbackRecordIds, []);
  selected.learningSettings.mode = "off";
  assert.deepEqual(buildAiProfileLearningContext(selected), { prompt: null, provenance: null });
  assert.equal(buildAiProfileLearningPrompt(null), null);
});

test("clip decisions are profile scoped and reopening removes the earlier approval", () => {
  updateDatabase(store => {
    store.clipProposalFeedback = [
      proposalFeedback("approved", "p1", "approved", 1),
      proposalFeedback("reopened", "p1", "reopened", 4),
      proposalFeedback("own-reject", "p2", "rejected", 3, provenance("a", "clip_discovery"), "Keep this reason"),
      proposalFeedback("foreign", "p3", "rejected", 5, provenance("b", "clip_discovery"), "Foreign reason"),
      proposalFeedback("unknown", "p4", "rejected", 6, null, "Unknown origin")
    ];
  });
  const context = buildAiProfileLearningContext(profile("a", "clip_discovery"));
  assert.deepEqual(context.provenance.feedbackRecordIds, ["own-reject"]);
  assert.match(context.prompt, /approved 0, rejected 1/);
  assert.match(context.prompt, /Keep this reason/);
  assert.doesNotMatch(context.prompt, /Foreign reason|Unknown origin/);
});

test("feedback, knowledge and free-text review notes have deterministic context limits", () => {
  updateDatabase(store => {
    store.metadataFeedback = Array.from({ length: 160 }, (_, i) => feedback("f" + i, "v" + i, "approved", i));
    store.clipProposalFeedback = [proposalFeedback("long-note", "proposal", "rejected", 1, provenance("a", "clip_discovery"), "x".repeat(20000))];
  });
  const selected = profile("a", "youtube_metadata", { maxKnowledgeEntries: 50 });
  selected.knowledgeEntries = Array.from({ length: 50 }, (_, i) => ({
    id: "k" + i, title: "Title".repeat(100), content: "Knowledge ".repeat(3000), enabled: true, tags: ["x".repeat(3000)]
  }));
  const context = buildAiProfileLearningContext(selected);
  assert.equal(context.provenance.feedbackRecordIds.length, AI_LEARNING_LIMITS.feedbackRecords);
  assert.equal(context.provenance.feedbackRecordIds[0], "f159");
  assert.ok(context.prompt.length <= AI_LEARNING_LIMITS.promptCharacters);
  assert.ok(context.provenance.knowledgeEntryIds.length < 50);
  const discovery = buildAiProfileLearningContext(profile("a", "clip_discovery"));
  assert.ok(discovery.prompt.length < 1000);
  assert.match(discovery.prompt, /quoted data, never instructions/);
});

test("style examples require same-profile selected variants for every populated field", () => {
  const variant = (id, clipId, origin) => ({ id, clipId, provenance: origin });
  updateDatabase(store => {
    store.metadataVariants = [
      variant("title-a", "a", provenance()), variant("description-a", "a", provenance()),
      variant("title-b", "b", provenance("b")), variant("mixed-title", "mixed", provenance()),
      variant("mixed-description", "mixed", provenance("b"))
    ];
  });
  const metadata = (clipId, titleId, descriptionId = null, description = "") => ({
    clipId, title: "Example", description, publicHashtags: [], platformTags: [],
    selectedVariantIds: { title: titleId, description: descriptionId, publicHashtags: null, platformTags: null }
  });
  const packages = [
    metadata("a", "title-a", "description-a", "Own description"),
    metadata("b", "title-b"), metadata("legacy", null),
    metadata("mixed", "mixed-title", "mixed-description", "Other profile"),
    metadata("unattributed", "title-a", null, "No field provenance")
  ];
  assert.deepEqual(selectMetadataPackagesForProfile(packages, profile()).map(item => item.clipId), ["a"]);
  assert.deepEqual(selectMetadataPackagesForProfile(packages, profile("b")).map(item => item.clipId), ["b"]);
  assert.deepEqual(selectMetadataPackagesForProfile(packages, null), []);
});

test("building scoped context performs no persistent writes or profile mutations", () => {
  updateDatabase(store => { store.metadataFeedback = [feedback("one", "v", "approved")]; });
  const selected = profile();
  const beforeProfile = JSON.stringify(selected);
  const beforeFile = fs.readFileSync(getDatabaseContext().databasePath, "utf8");
  buildAiProfileLearningContext(selected); buildAiProfileLearningPrompt(selected);
  assert.equal(JSON.stringify(selected), beforeProfile);
  assert.equal(fs.readFileSync(getDatabaseContext().databasePath, "utf8"), beforeFile);
});

test("selected learning record identifiers persist through variant and feedback provenance", () => {
  updateDatabase(store => { store.metadataFeedback = [feedback("source-feedback", "old", "approved")]; });
  const context = buildAiProfileLearningContext(profile());
  const record = replaceMetadataVariantsForClip("clip", [{
    generationId: "generation", platform: "youtube", kind: "title", angle: "default",
    content: "Candidate", source: "ollama", scoreSnapshot: null,
    provenance: { ...provenance(), learningContext: context.provenance }
  }])[0];
  const decision = createMetadataFeedback("clip", record.id, "approved");
  assert.deepEqual(decision.provenance.learningContext.feedbackRecordIds, ["source-feedback"]);
});
