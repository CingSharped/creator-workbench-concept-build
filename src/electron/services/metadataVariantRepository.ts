import { randomUUID } from "node:crypto";
import type { MetadataScoreSnapshot, MetadataVariantRecord } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

export function listMetadataVariantsByClipId(clipId: string): MetadataVariantRecord[] {
  return [...readDatabase().metadataVariants]
    .filter((variant) => variant.clipId === clipId)
    .sort((left, right) => {
      const createdOrder = right.createdAt.localeCompare(left.createdAt);
      if (createdOrder !== 0) {
        return createdOrder;
      }

      return right.id.localeCompare(left.id);
    });
}

export function replaceMetadataVariantsForClip(
  clipId: string,
  variants: Array<Omit<MetadataVariantRecord, "id" | "clipId" | "createdAt">>,
  options: { append?: boolean } = {}
): MetadataVariantRecord[] {
  return updateDatabase((store) => {
    if (!options.append) {
      const kindsToReplace = new Set(variants.map((variant) => variant.kind));
      store.metadataVariants = store.metadataVariants.filter(
        (variant) => variant.clipId !== clipId || !kindsToReplace.has(variant.kind)
      );
    }

    const existingContentKeys = new Set(
      store.metadataVariants
        .filter((variant) => variant.clipId === clipId)
        .map((variant) => getMetadataVariantContentKey(variant.kind, variant.content))
    );
    const createdAt = new Date().toISOString();
    const records = variants
      .filter((variant) => {
        const contentKey = getMetadataVariantContentKey(variant.kind, variant.content);
        if (existingContentKeys.has(contentKey)) {
          return false;
        }

        existingContentKeys.add(contentKey);
        return true;
      })
      .map<MetadataVariantRecord>((variant) => ({
        ...variant,
        id: randomUUID(),
        clipId,
        createdAt
      }));
    store.metadataVariants.push(...records);
    return records;
  });
}

function getMetadataVariantContentKey(
  kind: MetadataVariantRecord["kind"],
  content: MetadataVariantRecord["content"]
): string {
  const normalizedContent = Array.isArray(content)
    ? content.map((value) => value.trim().toLowerCase()).join("\u0000")
    : content.replace(/\s+/g, " ").trim().toLowerCase();

  return `${kind}:${normalizedContent}`;
}

export function updateMetadataVariantScores(
  updates: Array<{ id: string; scoreSnapshot: MetadataScoreSnapshot | null }>
): void {
  if (updates.length === 0) {
    return;
  }

  const updatesById = new Map(updates.map((update) => [update.id, update.scoreSnapshot]));
  updateDatabase((store) => {
    for (const variant of store.metadataVariants) {
      if (!updatesById.has(variant.id)) {
        continue;
      }

      variant.scoreSnapshot = updatesById.get(variant.id) ?? null;
    }
  });
}
