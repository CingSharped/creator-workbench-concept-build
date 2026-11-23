import { randomUUID } from "node:crypto";
import type {
  ClipMetadataPackageDraft,
  ClipMetadataPackageRecord,
  MetadataFeedbackDecision,
  MetadataVariantKind,
  SelectedMetadataVariantIds
} from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";
import { listMetadataVariantsByClipId } from "./metadataVariantRepository";
import { createMetadataFeedback } from "./metadataFeedbackRepository";

export function listClipMetadataPackages(): ClipMetadataPackageRecord[] {
  return [...readDatabase().metadataPackages].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function getClipMetadataByClipId(clipId: string): ClipMetadataPackageRecord | null {
  return readDatabase().metadataPackages.find((record) => record.clipId === clipId) ?? null;
}

export function upsertClipMetadata(
  clipId: string,
  payload: ClipMetadataPackageDraft
): ClipMetadataPackageRecord {
  const metadata = updateDatabase((store) => {
    const now = new Date().toISOString();
    const existing = store.metadataPackages.find((record) => record.clipId === clipId);

    if (existing) {
      existing.title = payload.title;
      existing.description = payload.description;
      existing.publicHashtags = payload.publicHashtags;
      existing.platformTags = payload.platformTags;
      existing.seriesKey = payload.seriesKey;
      existing.gameTitle = payload.gameTitle;
      existing.collaboratorProfileIds = payload.collaboratorProfileIds;
      existing.selectedVariantIds = payload.selectedVariantIds;
      existing.latestScoreSnapshot = payload.latestScoreSnapshot;
      existing.updatedAt = now;
      return existing;
    }

    const record: ClipMetadataPackageRecord = {
      id: randomUUID(),
      clipId,
      title: payload.title,
      description: payload.description,
      publicHashtags: payload.publicHashtags,
      platformTags: payload.platformTags,
      seriesKey: payload.seriesKey,
      gameTitle: payload.gameTitle,
      collaboratorProfileIds: payload.collaboratorProfileIds,
      selectedVariantIds: payload.selectedVariantIds,
      latestScoreSnapshot: payload.latestScoreSnapshot,
      createdAt: now,
      updatedAt: now
    };

    store.metadataPackages.push(record);
    return record;
  });

  captureImplicitMetadataFeedback(clipId, payload, metadata.selectedVariantIds);
  return metadata;
}

function captureImplicitMetadataFeedback(
  clipId: string,
  payload: ClipMetadataPackageDraft,
  selectedVariantIds: SelectedMetadataVariantIds
): void {
  const variants = listMetadataVariantsByClipId(clipId);
  const feedbackItems: Array<{ variantId: string; decision: MetadataFeedbackDecision }> = [];

  maybeCaptureFeedback(
    feedbackItems,
    variants,
    selectedVariantIds.title,
    "title",
    payload.title
  );
  maybeCaptureFeedback(
    feedbackItems,
    variants,
    selectedVariantIds.description,
    "description",
    payload.description
  );
  maybeCaptureFeedback(
    feedbackItems,
    variants,
    selectedVariantIds.publicHashtags,
    "public_hashtags",
    payload.publicHashtags
  );
  maybeCaptureFeedback(
    feedbackItems,
    variants,
    selectedVariantIds.platformTags,
    "platform_tags",
    payload.platformTags
  );

  for (const item of feedbackItems) {
    createMetadataFeedback(clipId, item.variantId, item.decision);
  }
}

function maybeCaptureFeedback(
  feedbackItems: Array<{ variantId: string; decision: MetadataFeedbackDecision }>,
  variants: ReturnType<typeof listMetadataVariantsByClipId>,
  variantId: string | null,
  kind: MetadataVariantKind,
  savedContent: string | string[]
): void {
  if (!variantId) {
    return;
  }

  const variant = variants.find((entry) => entry.id === variantId && entry.kind === kind);
  if (!variant) {
    return;
  }

  const decision = areVariantAndSavedContentEqual(variant.content, savedContent)
    ? "approved"
    : "edited";

  feedbackItems.push({
    variantId,
    decision
  });
}

function areVariantAndSavedContentEqual(
  variantContent: string | string[],
  savedContent: string | string[]
): boolean {
  if (typeof variantContent === "string" && typeof savedContent === "string") {
    return normalizeInlineContent(variantContent) === normalizeInlineContent(savedContent);
  }

  if (Array.isArray(variantContent) && Array.isArray(savedContent)) {
    return normalizeListContent(variantContent).join("\u0000") === normalizeListContent(savedContent).join("\u0000");
  }

  return false;
}

function normalizeInlineContent(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeListContent(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}
