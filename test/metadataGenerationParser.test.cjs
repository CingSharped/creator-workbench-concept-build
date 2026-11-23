const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildOllamaPrompt, parseOllamaVariants } = require("../dist/electron/services/metadataGenerationService.js");
const { bootstrapLocalDatabase } = require("../dist/electron/services/database.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-metadata-parser-test-"));
bootstrapLocalDatabase(tempRoot);

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("normalizes Gemma array responses with title aliases and descriptive angles", () => {
  const variants = parseOllamaVariants(
    [
      { title: "Boss fight meltdown", angle: "Self-deprecating humor" },
      { title: "My guild will hate this attempt", angle: "Relatable frustration" },
      { title: "I spent three hours on this boss", angle: "Dramatic defeated ending" }
    ],
    ["title"],
    []
  );

  assert.deepEqual(
    variants.map((variant) => ({ angle: variant.angle, content: variant.content })),
    [
      { angle: "specific_fail", content: "Boss fight meltdown" },
      { angle: "panic_tension", content: "My guild will hate this attempt" },
      { angle: "social_chaos", content: "I spent three hours on this boss" }
    ]
  );
  assert.equal(variants.every((variant) => variant.source === "ollama"), true);
});

test("normalizes grouped alias fields for all metadata kinds", () => {
  const variants = parseOllamaVariants(
    {
      titleVariants: [
        { angle: "specific_fail", title: "A specific fail" },
        { angle: "panic_tension", title: "Panic builds" },
        { angle: "social_chaos", title: "The lobby loses it" }
      ],
      descriptionVariants: [
        { angle: "context_forward", description: "The setup and payoff." },
        { angle: "search_forward", description: "Gaming clip context and outcome." }
      ],
      publicHashtagSets: [
        { angle: "default", hashtags: ["gaming", "shorts"] },
        { angle: "alt", tags: ["funny", "clip"] }
      ],
      platformTagSets: [{ angle: "default", tags: ["gaming fail", "boss attempt"] }]
    },
    ["title", "description", "public_hashtags", "platform_tags"],
    []
  );

  assert.equal(variants.length, 8);
  assert.deepEqual(
    variants.find((variant) => variant.kind === "platform_tags").content,
    ["gaming fail", "boss attempt"]
  );
});

test("keeps saved profile blocks out of generated description candidates", () => {
  const variants = parseOllamaVariants(
    {
      descriptionVariants: [
        {
          angle: "context_forward",
          content: "The setup and payoff.\n\nMore from me:\nYouTube: https://example.com\n\nCheck out the crew:\nGuest"
        }
      ]
    },
    ["description"],
    []
  );

  assert.equal(variants[0].content, "The setup and payoff.");
});

test("marks learned examples as style-only and places current clip evidence last", () => {
  const prompt = buildOllamaPrompt(["description"], {
    clipName: "Current clip",
    transcriptText: "The current clip transcript says Amarillo.",
    transcriptPromptText: "[You] The current clip transcript says Amarillo.",
    clipDurationSeconds: 20,
    seriesKey: "",
    gameTitle: "Halo Campaign Evolved",
    creatorSpokenSegmentCount: 1,
    collaborators: [],
    speakerContext: {
      status: "identified",
      transcriptId: "transcript-current",
      transcriptUpdatedAt: "2026-09-19T07:19:42.063Z",
      creatorTrustedSegmentCount: 1,
      collaboratorTrustedSegmentCounts: [],
      unresolvedSegmentCount: 0,
      lowConfidenceSegmentCount: 0
    },
    speakerContextEnabled: true,
    learningContext: {
      approvedExamples: [],
      highPerformingExamples: [{
        clipId: "clip-donor",
        title: "Old door event",
        description: "The old door event.",
        publicHashtags: ["door"],
        platformTags: ["weapon"],
        seriesKey: "",
        gameTitle: "Halo Campaign Evolved",
        performanceScore: 50
      }],
      rejectedExamples: [],
      approvedExampleCount: 0,
      highPerformingExampleCount: 1
    },
    existingPackage: {
      title: "Current draft",
      description: "Current draft description",
      publicHashtags: [],
      platformTags: [],
      seriesKey: "",
      gameTitle: "Halo Campaign Evolved",
      collaboratorProfileIds: [],
      selectedVariantIds: {
        title: null,
        description: null,
        publicHashtags: null,
        platformTags: null
      },
      latestScoreSnapshot: null
    },
    aiProfileId: "profile-current",
    aiProfileName: "YouTube Metadata",
    aiProfilePrompt: "Treat saved examples as the complete evidence set.",
    aiProfileLearningPrompt: null,
    preferredModel: "model-current"
  });

  const learnedExampleIndex = prompt.indexOf("Old door event");
  const currentEvidenceIndex = prompt.indexOf("AUTHORITATIVE CURRENT CLIP EVIDENCE:");
  const transcriptIndex = prompt.indexOf("The current clip transcript says Amarillo.");

  assert.notEqual(learnedExampleIndex, -1);
  assert.notEqual(currentEvidenceIndex, -1);
  assert.notEqual(transcriptIndex, -1);
  assert.match(prompt, /Learning examples are style-only references/);
  assert.match(prompt, /NON-OVERRIDABLE EVIDENCE RULE/);
  assert.match(prompt, /FINAL GROUNDING CHECK/);
  assert.ok(prompt.indexOf("NON-OVERRIDABLE EVIDENCE RULE") > prompt.indexOf("Treat saved examples as the complete evidence set."));
  assert.ok(learnedExampleIndex < currentEvidenceIndex);
  assert.ok(currentEvidenceIndex < transcriptIndex);
});
