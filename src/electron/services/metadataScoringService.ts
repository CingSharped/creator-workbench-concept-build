import type {
  ClipMetadataPackageDraft,
  ClipRecord,
  MetadataScoreSnapshot,
  TranscriptRecord
} from "../../shared/contracts";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "up",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "with",
  "you",
  "your"
]);

const VAGUE_REACTION_PHRASES = [
  "oh no",
  "this happened",
  "that happened",
  "i panicked",
  "i may have panicked",
  "this is terrible",
  "that was terrible",
  "that was crazy",
  "i was not ready",
  "i wasn't ready",
  "it was bad"
];

export interface MetadataScoringContext {
  clip: ClipRecord;
  transcript: TranscriptRecord | null;
  metadataPackage: ClipMetadataPackageDraft;
  approvedExampleCount: number;
  highPerformingExampleCount: number;
}

export function scoreYouTubeMetadataPackage(
  context: MetadataScoringContext
): MetadataScoreSnapshot {
  const warnings = new Set<string>();
  const suggestedFixes = new Set<string>();
  const transcriptText = context.transcript?.textContent ?? "";
  const firstSubtitleStartSeconds = getFirstSubtitleStartSeconds(context.transcript?.srtContent ?? "");
  const title = context.metadataPackage.title.trim();
  const titleKeywords = extractMeaningfulKeywords(title);
  const firstTranscriptWindow = getTranscriptWindow(transcriptText, 0.35);
  const promiseTermsAppearEarly =
    titleKeywords.length === 0 || titleKeywords.some((keyword) => firstTranscriptWindow.includes(keyword));
  const likelyPayoffAppearsLate = doesLikelyPayoffAppearLate(
    titleKeywords,
    transcriptText,
    context.clip.durationMs
  );
  const titleLooksVague = isVagueReactionTitle(title);
  const hasRelevantContext = hasRelevantSeriesOrGameContext(context.metadataPackage);
  const descriptionLooksStructured = doesDescriptionLookStructured(context.metadataPackage.description);
  const genericTagPadding = hasGenericTagPadding(context.metadataPackage.platformTags);

  let audienceTopicFit = 6;
  if (context.metadataPackage.seriesKey) {
    audienceTopicFit += 4;
  }
  if (context.metadataPackage.gameTitle) {
    audienceTopicFit += 3;
  }
  if (context.approvedExampleCount > 0) {
    audienceTopicFit += 4;
  }
  if (context.highPerformingExampleCount > 0) {
    audienceTopicFit += 3;
  }
  if (!context.metadataPackage.seriesKey && !context.metadataPackage.gameTitle) {
    warnings.add("No series or game context is set for this clip yet.");
    suggestedFixes.add("Set the game title or series key so the AI can package this clip more clearly.");
  }
  audienceTopicFit = clamp(audienceTopicFit, 0, 20);

  let packagingClarity = 8;
  if (titleLooksVague) {
    packagingClarity -= 6;
    warnings.add("The title reads like a vague reaction instead of a specific moment.");
    suggestedFixes.add("Rewrite the title around the exact fail, panic moment, or social-chaos beat.");
  } else {
    packagingClarity += 5;
  }
  if (title.length >= 38 && title.length <= 62) {
    packagingClarity += 4;
  } else if (title.length <= 75) {
    packagingClarity += 2;
  } else {
    warnings.add("The title is longer than the current preferred Shorts range.");
    suggestedFixes.add("Shorten the title so the main hook lands faster.");
  }
  if (!hasRelevantContext && (context.metadataPackage.gameTitle || context.metadataPackage.seriesKey)) {
    packagingClarity -= 2;
    warnings.add("The package does not surface the current game or series clearly.");
    suggestedFixes.add("Mention the game or series in the title, description, or public hashtags when it helps comprehension.");
  }
  packagingClarity = clamp(packagingClarity, 0, 20);

  let hookStrength = 10;
  if (firstSubtitleStartSeconds !== null && firstSubtitleStartSeconds > 1.5) {
    hookStrength -= 6;
    warnings.add("The first subtitle or spoken beat starts slowly for a Short.");
    suggestedFixes.add("Trim the clip start so the action or tension appears sooner.");
  } else {
    hookStrength += 4;
  }
  if (!promiseTermsAppearEarly) {
    hookStrength -= 4;
    warnings.add("The title promise does not seem to show up early in the transcript.");
    suggestedFixes.add("Choose a title that matches the first seconds more closely, or trim the clip tighter.");
  } else {
    hookStrength += 4;
  }
  if (!transcriptText.trim()) {
    warnings.add("No transcript is available, so hook scoring is low-confidence.");
  }
  hookStrength = clamp(hookStrength, 0, 20);

  let retentionPayoff = 9;
  if (context.clip.durationMs !== null && context.clip.durationMs / 1000 > 25) {
    retentionPayoff -= 2;
  } else {
    retentionPayoff += 2;
  }
  if (likelyPayoffAppearsLate) {
    retentionPayoff -= 4;
    warnings.add("The likely payoff appears late for the current clip length.");
    suggestedFixes.add("Trim setup or choose a shorter moment so the payoff lands earlier.");
  } else {
    retentionPayoff += 3;
  }
  retentionPayoff = clamp(retentionPayoff, 0, 15);

  let searchContextClarity = 4;
  if (hasRelevantContext) {
    searchContextClarity += 4;
  } else if (context.metadataPackage.gameTitle || context.metadataPackage.seriesKey) {
    searchContextClarity -= 2;
    warnings.add("Search and recommendation context is weak because the game or series is not surfaced.");
    suggestedFixes.add("Add the game, series, or scenario nouns into the package.");
  }
  if (context.metadataPackage.publicHashtags.length > 0) {
    searchContextClarity += 2;
  }
  searchContextClarity = clamp(searchContextClarity, 0, 10);

  let sessionConnection = 3;
  if (context.metadataPackage.seriesKey) {
    sessionConnection += 4;
  }
  if (
    context.metadataPackage.publicHashtags.some((tag) =>
      normalizeToken(tag).includes(normalizeToken(context.metadataPackage.seriesKey))
    )
  ) {
    sessionConnection += 2;
  }
  if (context.metadataPackage.description.toLowerCase().includes("youtube:")) {
    sessionConnection += 1;
  }
  sessionConnection = clamp(sessionConnection, 0, 10);

  let metadataHygiene = 2;
  if (descriptionLooksStructured) {
    metadataHygiene += 1;
  } else {
    warnings.add("The description does not follow the preferred block-based Shorts structure yet.");
    suggestedFixes.add("Use a short hook line, a short context line, and keep extra blocks intentional.");
  }
  if (!genericTagPadding) {
    metadataHygiene += 1;
  } else {
    warnings.add("The platform tags look padded with generic terms.");
    suggestedFixes.add("Prefer series-aware and moment-aware tags over generic gaming tag padding.");
  }
  if (context.metadataPackage.publicHashtags.length > 0 && context.metadataPackage.publicHashtags.length <= 4) {
    metadataHygiene += 1;
  }
  metadataHygiene = clamp(metadataHygiene, 0, 5);

  return {
    total:
      audienceTopicFit +
      packagingClarity +
      hookStrength +
      retentionPayoff +
      searchContextClarity +
      sessionConnection +
      metadataHygiene,
    audienceTopicFit,
    packagingClarity,
    hookStrength,
    retentionPayoff,
    searchContextClarity,
    sessionConnection,
    metadataHygiene,
    warnings: [...warnings],
    suggestedFixes: [...suggestedFixes]
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function extractMeaningfulKeywords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isVagueReactionTitle(title: string): boolean {
  const normalizedTitle = title.toLowerCase();
  if (VAGUE_REACTION_PHRASES.some((phrase) => normalizedTitle.includes(phrase))) {
    return true;
  }

  const keywords = extractMeaningfulKeywords(title);
  return keywords.length < 3;
}

function hasRelevantSeriesOrGameContext(metadataPackage: ClipMetadataPackageDraft): boolean {
  const haystack = [
    metadataPackage.title,
    metadataPackage.description,
    metadataPackage.publicHashtags.join(" "),
    metadataPackage.platformTags.join(" ")
  ]
    .join(" ")
    .toLowerCase();

  const contextTerms = [metadataPackage.seriesKey, metadataPackage.gameTitle]
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  if (contextTerms.length === 0) {
    return true;
  }

  return contextTerms.some((term) => haystack.includes(term));
}

function getTranscriptWindow(transcriptText: string, fraction: number): string {
  if (!transcriptText.trim()) {
    return "";
  }

  const boundary = Math.max(1, Math.floor(transcriptText.length * fraction));
  return transcriptText.slice(0, boundary).toLowerCase();
}

function doesLikelyPayoffAppearLate(
  titleKeywords: string[],
  transcriptText: string,
  durationMs: number | null
): boolean {
  if (!transcriptText.trim() || !durationMs || durationMs / 1000 <= 25 || titleKeywords.length === 0) {
    return false;
  }

  const normalizedTranscript = transcriptText.toLowerCase();
  const payoffKeyword = titleKeywords.find((keyword) => normalizedTranscript.includes(keyword));
  if (!payoffKeyword) {
    return false;
  }

  const firstIndex = normalizedTranscript.indexOf(payoffKeyword);
  if (firstIndex < 0) {
    return false;
  }

  return firstIndex / normalizedTranscript.length >= 0.8;
}

function doesDescriptionLookStructured(description: string): boolean {
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length >= 2 && lines.length <= 16;
}

function hasGenericTagPadding(platformTags: string[]): boolean {
  if (platformTags.length === 0) {
    return false;
  }

  const genericTerms = new Set(["gaming", "games", "funny", "shorts", "clip", "clips"]);
  const genericCount = platformTags.filter((tag) => genericTerms.has(tag.trim().toLowerCase())).length;
  return genericCount >= Math.max(2, platformTags.length - 1);
}

function getFirstSubtitleStartSeconds(srtContent: string): number | null {
  const match = srtContent.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->/);
  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}
