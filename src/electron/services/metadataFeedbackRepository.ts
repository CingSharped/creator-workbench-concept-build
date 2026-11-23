import { randomUUID } from "node:crypto";
import type { MetadataFeedbackDecision, MetadataFeedbackRecord } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

export function createMetadataFeedback(
  clipId: string,
  variantId: string,
  decision: MetadataFeedbackDecision
): MetadataFeedbackRecord {
  return updateDatabase((store) => {
    const record: MetadataFeedbackRecord = {
      id: randomUUID(),
      clipId,
      variantId,
      decision,
      provenance: store.metadataVariants.find((variant) => variant.id === variantId)?.provenance ?? null,
      createdAt: new Date().toISOString()
    };
    store.metadataFeedback.push(record);
    return record;
  });
}

export function listMetadataFeedbackByClipId(clipId: string): MetadataFeedbackRecord[] {
  return [...readDatabase().metadataFeedback]
    .filter((record) => record.clipId === clipId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listMetadataFeedback(): MetadataFeedbackRecord[] {
  return [...readDatabase().metadataFeedback].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}
