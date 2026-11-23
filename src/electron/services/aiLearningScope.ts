import type { AiGenerationProvenance, AiProfile, ClipMetadataPackageRecord, MetadataFeedbackRecord } from "../../shared/contracts";
import { readDatabase } from "./database";

export const AI_LEARNING_LIMITS = Object.freeze({
  feedbackRecords: 100, knowledgeCharacters: 6000, promptCharacters: 9000,
  examplesPerCategory: 3, exampleDescriptionCharacters: 500
});

export function belongsToAiProfile(provenance: AiGenerationProvenance | null | undefined, profile: AiProfile | null): boolean {
  return Boolean(profile && provenance?.profileId === profile.id && provenance?.task === profile.task);
}

/** Deduplicate before scoping so an obsolete decision cannot be revived. */
export function selectProfileFeedback<T extends { id: string; provenance?: AiGenerationProvenance | null }>(
  records: T[], profile: AiProfile | null, subject: (record: T) => string, timestamp: (record: T) => string
): T[] {
  if (!profile || profile.learningSettings.mode === "off") return [];
  const ordered = records.map((record, index) => ({ record, index })).sort((a, b) =>
    timestamp(b.record).localeCompare(timestamp(a.record)) || b.index - a.index
  );
  const latest = new Map<string, T>();
  for (const { record } of ordered) if (!latest.has(subject(record))) latest.set(subject(record), record);
  return [...latest.values()].filter(record => belongsToAiProfile(record.provenance, profile))
    .slice(0, AI_LEARNING_LIMITS.feedbackRecords);
}

export function selectMetadataFeedbackForProfile(records: MetadataFeedbackRecord[], profile: AiProfile | null): MetadataFeedbackRecord[] {
  return selectProfileFeedback(records, profile, record => record.variantId, record => record.createdAt)
    .filter(record => record.decision === "rejected"
      ? profile?.learningSettings.includeRejectedExamples : profile?.learningSettings.includeApprovedExamples);
}

/** Every populated field must retain a selected variant from the same task/profile. */
export function selectMetadataPackagesForProfile(packages: ClipMetadataPackageRecord[], profile: AiProfile | null): ClipMetadataPackageRecord[] {
  if (!profile || profile.learningSettings.mode === "off") return [];
  const variants = new Map(readDatabase().metadataVariants.map(variant => [variant.id, variant]));
  return packages.filter(metadata => {
    const selected = metadata.selectedVariantIds;
    if ((metadata.title.trim() && !selected.title) ||
        (metadata.description.trim() && !selected.description) ||
        (metadata.publicHashtags.length && !selected.publicHashtags) ||
        (metadata.platformTags.length && !selected.platformTags)) return false;
    const ids = [...new Set(Object.values(selected).filter((id): id is string => Boolean(id)))];
    return ids.length > 0 && ids.every(id => {
      const variant = variants.get(id);
      return variant?.clipId === metadata.clipId && belongsToAiProfile(variant.provenance, profile);
    });
  });
}
