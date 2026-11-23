import type { ClipMetadataPackageDraft, ClipMetadataPackageRecord } from "../../shared/contracts";

/** Immutable input plus a guarded acknowledgement back to the initiating Edit session. */
export interface ReviewedMetadataHandoff {
  clipId: string;
  draft: ClipMetadataPackageDraft;
  isCurrent: () => boolean;
  acceptSaved: (metadata: ClipMetadataPackageRecord) => void;
}
