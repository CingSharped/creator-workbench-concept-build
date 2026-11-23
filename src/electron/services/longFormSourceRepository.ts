import { randomUUID } from "node:crypto";
import { normalizeSourcePath } from "./clipRepository";
import type { LongFormSourceRecord } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";
import { areSourceFingerprintsCompatible } from "./sourceFingerprint";

export function listLongFormSources(): LongFormSourceRecord[] {
  return readDatabase().longFormSources
    .filter((source) => source.indexState !== "archived")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getLongFormSourceById(sourceId: string): LongFormSourceRecord | null {
  return readDatabase().longFormSources.find((source) => source.id === sourceId) ?? null;
}

export function createLongFormSource(
  input: Omit<LongFormSourceRecord, "id" | "importedAt" | "updatedAt" | "indexState" | "archivedAt">
): LongFormSourceRecord {
  const now = new Date().toISOString();
  return updateDatabase((store) => {
    const existing = store.longFormSources.find(
      (source) => normalizeSourcePath(source.sourcePath) === normalizeSourcePath(input.sourcePath)
    );
    if (existing && areSourceFingerprintsCompatible(existing.sourceFingerprint, input.sourceFingerprint)) {
      Object.assign(existing, input, { indexState: "active", archivedAt: null, updatedAt: now });
      return existing;
    }

    const source: LongFormSourceRecord = {
      ...input,
      id: randomUUID(),
      indexState: "active",
      archivedAt: null,
      importedAt: now,
      updatedAt: now
    };
    store.longFormSources.push(source);
    return source;
  });
}
