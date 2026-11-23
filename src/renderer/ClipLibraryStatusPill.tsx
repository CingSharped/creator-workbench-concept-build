import type { ClipRecord, ScheduledPostRecord } from "../shared/contracts";
import { getClipLibraryStatus } from "../shared/workflowPresentation";
import { StatusBadge } from "./WorkbenchPrimitives";

interface ClipLibraryStatusPillProps {
  clip: ClipRecord;
  scheduledPosts: ScheduledPostRecord[];
}

export default function ClipLibraryStatusPill({ clip, scheduledPosts }: ClipLibraryStatusPillProps): JSX.Element {
  const status = getClipLibraryStatus(clip, scheduledPosts);
  const tone = status.tone === "posted" ? "success" : status.tone === "failed" ? "error" : status.tone === "scheduled" ? "info" : "muted";
  return (
    <StatusBadge className={`status-pill${status.tone ? ` status-${status.tone}` : ""}`} tone={tone}>
      {status.label}
    </StatusBadge>
  );
}
