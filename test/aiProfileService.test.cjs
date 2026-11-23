const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bootstrapLocalDatabase,
  getDatabaseContext
} = require("../dist/electron/services/database.js");
const {
  getAiProfileAssignments,
  getAiProfiles,
  resolveAiProfileForTask,
  saveAiProfilesConfiguration
} = require("../dist/electron/services/aiProfileService.js");
const {
  buildAiProfileLearningPrompt
} = require("../dist/electron/services/aiProfileLearningService.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-ai-profiles-test-"));
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

test("returns built-in AI profiles and a default metadata assignment", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const assignments = getAiProfileAssignments();
  const metadataProfiles = profiles.filter((profile) => profile.task === "youtube_metadata");

  assert.equal(metadataProfiles.length >= 3, true);
  assert.equal(assignments.youtubeMetadataProfileId, metadataProfiles[0].id);
  assert.equal(resolveAiProfileForTask("youtube_metadata")?.id, metadataProfiles[0].id);
});

test("returns a dedicated thumbnail profile and assignment", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const assignments = getAiProfileAssignments();
  const thumbnailProfiles = profiles.filter((profile) => profile.task === "youtube_thumbnail");

  assert.equal(thumbnailProfiles.length >= 1, true);
  assert.equal(assignments.youtubeThumbnailProfileId, thumbnailProfiles[0].id);
  assert.equal(resolveAiProfileForTask("youtube_thumbnail")?.id, thumbnailProfiles[0].id);
  assert.match(thumbnailProfiles[0].systemPrompt, /thumbnail/i);
});

test("ships task-specific built-in prompts with evidence and quality guardrails", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const builtIns = profiles.filter((profile) => profile.builtIn);
  const metadataPrompts = builtIns
    .filter((profile) => profile.task === "youtube_metadata")
    .map((profile) => profile.systemPrompt);
  const clipPrompt = builtIns.find((profile) => profile.task === "clip_discovery")?.systemPrompt;

  assert.equal(builtIns.every((profile) => profile.promptVersion === 3), true);
  assert.equal(metadataPrompts.some((prompt) => /specific_fail/i.test(prompt)), true);
  assert.equal(metadataPrompts.some((prompt) => /meaningfully different/i.test(prompt)), true);
  assert.equal(metadataPrompts.every((prompt) => /trusted (?:speaker|creator)/i.test(prompt)), true);
  assert.equal(
    profiles.filter((profile) => profile.task === "youtube_metadata").every(
      (profile) => profile.speakerContextSettings?.enabled === true
    ),
    true
  );
  assert.match(clipPrompt, /setup.*payoff/i);
  assert.match(clipPrompt, /unseen visuals/i);
});

test("upgrades an untouched legacy built-in prompt while preserving customized wording", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const balanced = profiles.find((profile) => profile.id === "ai-profile-youtube-metadata-balanced");
  assert.ok(balanced);

  const legacyPrompt =
    "Prioritize grounded gaming YouTube Shorts packaging. Keep titles concrete, hooks early, and descriptions creator-authentic. Favor clarity over hype.";
  const migrated = saveAiProfilesConfiguration({
    profiles: profiles.map((profile) =>
      profile.id === balanced.id ? { ...profile, promptVersion: undefined, systemPrompt: legacyPrompt } : profile
    ),
    assignments: getAiProfileAssignments()
  });
  const migratedBalanced = migrated.profiles.find((profile) => profile.id === balanced.id);
  assert.equal(migratedBalanced.promptVersion, 3);
  assert.notEqual(migratedBalanced.systemPrompt, legacyPrompt);

  const customPrompt = "Use my deliberate channel voice and keep every title understated.";
  const customized = saveAiProfilesConfiguration({
    profiles: migrated.profiles.map((profile) =>
      profile.id === balanced.id ? { ...profile, promptVersion: undefined, systemPrompt: customPrompt } : profile
    ),
    assignments: migrated.assignments
  });
  const customizedBalanced = customized.profiles.find((profile) => profile.id === balanced.id);
  assert.equal(customizedBalanced.systemPrompt, customPrompt);
});

test("persists a custom profile and resolves the saved metadata assignment", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const customProfile = {
    id: "custom-metadata-profile",
    name: "Custom Metadata Worker",
    task: "youtube_metadata",
    description: "Custom metadata profile",
    preferredModel: "qwen3:14b",
    systemPrompt: "Prefer sharper gaming hooks.",
    enabled: true,
    builtIn: false,
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:00.000Z"
  };

  const saved = saveAiProfilesConfiguration({
    profiles: [...profiles, customProfile],
    assignments: {
      ...getAiProfileAssignments(),
      youtubeMetadataProfileId: customProfile.id
    }
  });

  assert.equal(saved.assignments.youtubeMetadataProfileId, customProfile.id);
  assert.equal(resolveAiProfileForTask("youtube_metadata")?.id, customProfile.id);
});

test("normalizes profile learning settings and supplies AI-agnostic knowledge", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const assignments = getAiProfileAssignments();
  const customProfile = {
    id: "custom-knowledge-profile",
    name: "Knowledge Test Worker",
    task: "youtube_metadata",
    description: "Knowledge test profile",
    preferredModel: "gemma3:12b",
    systemPrompt: "Stay grounded.",
    enabled: true,
    builtIn: false,
    createdAt: "2026-07-29T10:30:00.000Z",
    updatedAt: "2026-07-29T10:30:00.000Z"
  };

  const saved = saveAiProfilesConfiguration({
    profiles: [...profiles, customProfile],
    assignments: {
      ...assignments,
      youtubeMetadataProfileId: customProfile.id
    }
  });
  const normalized = saved.profiles.find((profile) => profile.id === customProfile.id);
  assert.equal(normalized.learningSettings.mode, "adaptive_prompt");
  assert.equal(normalized.learningSettings.maxKnowledgeEntries, 12);
  assert.deepEqual(normalized.speakerContextSettings, {
    enabled: true,
    warnWhenStreamerUnidentified: true
  });

  const withKnowledge = {
    ...normalized,
    knowledgeEntries: [{
      id: "knowledge-one",
      title: "Channel voice",
      content: "Keep descriptions direct and mention the game in the opening line.",
      tags: ["voice", "youtube"],
      enabled: true,
      createdAt: "2026-07-29T10:31:00.000Z",
      updatedAt: "2026-07-29T10:31:00.000Z"
    }]
  };
  const next = saveAiProfilesConfiguration({
    profiles: saved.profiles.map((profile) => profile.id === customProfile.id ? withKnowledge : profile),
    assignments: saved.assignments
  });
  const prompt = buildAiProfileLearningPrompt(next.profiles.find((profile) => profile.id === customProfile.id));
  assert.match(prompt, /Profile task knowledge/);
  assert.match(prompt, /Keep descriptions direct/);
});

test("falls back to an enabled built-in profile when the assigned profile is disabled", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const customProfile = {
    id: "custom-disabled-profile",
    name: "Disabled Metadata Worker",
    task: "youtube_metadata",
    description: "Disabled test profile",
    preferredModel: "gemma3:12b",
    systemPrompt: "Do not use.",
    enabled: false,
    builtIn: false,
    createdAt: "2026-07-29T11:00:00.000Z",
    updatedAt: "2026-07-29T11:00:00.000Z"
  };

  const saved = saveAiProfilesConfiguration({
    profiles: [...profiles, customProfile],
    assignments: {
      youtubeMetadataProfileId: customProfile.id,
      ...getAiProfileAssignments()
    }
  });

  assert.notEqual(saved.assignments.youtubeMetadataProfileId, customProfile.id);
  assert.equal(resolveAiProfileForTask("youtube_metadata")?.enabled, true);
});

test("does not persist public trend profiles or assignments", { concurrency: false }, () => {
  const profiles = getAiProfiles();
  const legacyProfile = {
    id: "legacy-trend-research-profile",
    name: "Legacy Trend Research Worker",
    task: "trend_research",
    description: "Removed public trend worker.",
    preferredModel: "mistral-small:24b",
    systemPrompt: "Legacy instructions.",
    enabled: true,
    builtIn: false,
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z"
  };

  const saved = saveAiProfilesConfiguration({
    profiles: [...profiles, legacyProfile],
    assignments: getAiProfileAssignments()
  });

  assert.equal(saved.profiles.some((profile) => profile.task === "trend_research"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.assignments, "trendResearchProfileId"), false);
  const persisted = require("../dist/electron/services/database.js").readDatabase();
  const storedProfiles = JSON.parse(persisted.appSettings["ai.profiles"].value);
  const storedAssignments = JSON.parse(persisted.appSettings["ai.profile_assignments"].value);
  assert.equal(storedProfiles.some((profile) => profile.id === legacyProfile.id), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storedAssignments, "trendResearchProfileId"), false);
});
