import { useId, useState, type ReactNode } from "react";
import type { ClipRecord, ScheduledPostRecord } from "../shared/contracts";
import { Button, Card, IconButton, PanelHeader, StatusBadge } from "./WorkbenchPrimitives";

export interface QueuedPostCardProps {
  post: ScheduledPostRecord;
  clip: ClipRecord | null;
  performanceFetchedAt?: string | null;
  performanceContent?: ReactNode;
  defaultExpanded?: boolean;
  onRemove?: (postId: string) => void;
  onReconcile?: (postId: string) => void;
  reconciling?: boolean;
  onRetryCaptions?: (postId: string) => void;
  retryingCaptions?: boolean;
}

export default function QueuedPostCard({
  post,
  clip,
  performanceFetchedAt = null,
  performanceContent = null,
  defaultExpanded = false,
  onRemove,
  onReconcile,
  reconciling = false,
  onRetryCaptions,
  retryingCaptions = false
}: QueuedPostCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = `queued-post-${useId().replace(/:/g, "")}`;

  return (
    <Card className={`queued-post-card${expanded ? " expanded" : ""}`}>
      <PanelHeader className="queued-post-card-header">
        <div className="queued-post-card-title">
          <strong>{post.title || "Untitled post"}</strong>
          <StatusBadge
            className={`status-pill status-${post.status === "posting" ? "scheduled" : post.status}`}
            tone={getPostStatusTone(post.status)}
          >
            {formatPostStatus(post.status)}
          </StatusBadge>
        </div>
        <div className="panel-header-actions queued-post-actions">
          <Button
            type="button"
            compact
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded(current => !current)}
          >
            {expanded ? "Hide details" : "Show details"}
          </Button>
          {onRemove && (
            <IconButton
              type="button"
              className="icon-button"
              aria-label={`Remove ${post.title || "untitled post"} from queue`}
              title="Remove from queue"
              disabled={post.status === "posting"}
              onClick={() => onRemove(post.id)}
            >
              <span aria-hidden="true">&times;</span>
            </IconButton>
          )}
        </div>
      </PanelHeader>

      {expanded ? (
        <div id={bodyId} className="queued-post-card-body">
          <div className="queued-post-card-summary">
            <div>
              <span className="queued-post-card-label">Video / source</span>
              <strong>{clip?.displayName ?? "Removed clip"}</strong>
              <span className="detail-meta">{clip?.sourcePath ?? "The original clip is no longer indexed."}</span>
            </div>
            <div>
              <span className="queued-post-card-label">Post</span>
              <span className="detail-meta">{formatPlatform(post.platform)} | {formatExecutionMode(post.executionMode)}</span>
              <span className="detail-meta">Account: {post.accountLabel}</span>
              <span className="detail-meta">Publishes {formatTimestamp(post.publishAt)}</span>
            </div>
          </div>

          {post.youtubePlaylistIds.length > 0 ? <p className="queue-card-meta">Playlists: {post.youtubePlaylistIds.length}</p> : null}
          {post.remotePostId ? <p className="queue-card-meta">Remote video ID: {post.remotePostId}</p> : null}
          {post.publishedUrl ? <p className="queue-card-meta">Remote URL: {post.publishedUrl}</p> : null}
          <p className="queue-card-description">{post.description || "No description saved."}</p>
          <p className="queue-card-tags">{post.platformTags.length > 0 ? post.platformTags.join(", ") : "No tags saved."}</p>
          {performanceFetchedAt ? <p className="queue-card-meta">Performance refreshed {formatTimestamp(performanceFetchedAt)}</p> : null}
          {performanceContent}
          {renderReconciliationStatus(post, onReconcile, reconciling)}
          {post.errorMessage && post.status !== "reconciliation_required" ? <p className="queue-card-error" role="alert">{post.errorMessage}</p> : null}
          {renderCaptionStatus(post, onRetryCaptions, retryingCaptions)}
        </div>
      ) : null}
    </Card>
  );
}

function getPostStatusTone(status: ScheduledPostRecord["status"]): "ready" | "success" | "warning" | "error" | "editing" | "info" | "muted" {
  switch (status) {
    case "posted":
      return "success";
    case "failed":
      return "error";
    case "reconciliation_required":
      return "warning";
    case "posting":
      return "info";
    case "scheduled":
      return "editing";
  }
}

function renderReconciliationStatus(
  post: ScheduledPostRecord,
  onReconcile: ((postId: string) => void) | undefined,
  reconciling: boolean
): JSX.Element | null {
  if (post.status !== "reconciliation_required") {
    return null;
  }

  return (
    <div className="queue-card-warning" role="alert">
      <strong>Upload needs reconciliation</strong>
      <span>{post.reconciliationReason ?? "The upload outcome is uncertain. Check YouTube before retrying."}</span>
      {onReconcile ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => onReconcile(post.id)}
          disabled={reconciling}
        >
          {reconciling ? "Checking YouTube..." : "Check YouTube"}
        </button>
      ) : null}
    </div>
  );
}

function renderCaptionStatus(
  post: ScheduledPostRecord,
  onRetryCaptions: ((postId: string) => void) | undefined,
  retryingCaptions: boolean
): JSX.Element | null {
  if (post.platform !== "youtube" || post.captionStatus === "not_applicable") {
    return null;
  }

  if (post.captionStatus === "uploaded") {
    const language = post.captionLanguage?.trim().toUpperCase() || "configured language";
    const trackName = post.captionName?.trim() || "Creator Workbench transcript";
    return (
      <div className="queue-card-success" role="status">
        <strong>Captions uploaded</strong>
        <span>{language} track: {trackName}. YouTube returned the caption track ID successfully.</span>
      </div>
    );
  }

  const message = retryingCaptions
    ? "Uploading the complete transcript captions to YouTube..."
    : post.captionErrorMessage ?? (
      post.captionStatus === "pending"
        ? "Caption upload is pending. Retry when the YouTube upload is available."
        : "YouTube captions need attention."
    );
  const canRetry = Boolean(onRetryCaptions);

  return (
    <div className="queue-card-error" role="status" aria-live="polite">
      <strong>Captions</strong>
      <span>{message}</span>
      {canRetry ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => onRetryCaptions?.(post.id)}
          disabled={retryingCaptions}
        >
          {retryingCaptions ? "Retrying captions..." : "Retry captions"}
        </button>
      ) : null}
    </div>
  );
}

function formatPlatform(platform: ScheduledPostRecord["platform"]): string {
  return platform === "youtube" ? "YouTube" : "TikTok";
}

function formatExecutionMode(mode: ScheduledPostRecord["executionMode"]): string {
  if (mode === "native_schedule") return "Native schedule";
  if (mode === "app_side_schedule") return "App-side schedule";
  return "Draft handoff";
}

function formatPostStatus(status: ScheduledPostRecord["status"]): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "posting":
      return "Posting";
    case "posted":
      return "Posted";
    case "failed":
      return "Failed";
    case "reconciliation_required":
      return "Needs reconciliation";
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
