import path from "node:path";
import type { SourceFingerprint } from "../../shared/contracts";

export function normalizeFingerprintPath(sourcePath: string): string {
  const normalized = path.normalize(path.resolve(sourcePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function areSourceFingerprintsCompatible(
  existing: SourceFingerprint | null | undefined,
  incoming: SourceFingerprint | null | undefined
): boolean {
  if (!existing || !incoming) {
    return true;
  }

  if (existing.normalizedPath !== incoming.normalizedPath || existing.fileSizeBytes !== incoming.fileSizeBytes) {
    return false;
  }

  if (existing.durationMs !== null && incoming.durationMs !== null && existing.durationMs !== incoming.durationMs) {
    return false;
  }

  return existing.modifiedAtMs === null || incoming.modifiedAtMs === null || existing.modifiedAtMs === incoming.modifiedAtMs;
}
