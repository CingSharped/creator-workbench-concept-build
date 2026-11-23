import { useId, useMemo, useState, type ReactNode } from "react";
import type {
  ClipRecord,
  PublishPlatform,
  ScheduledPostRecord
} from "../shared/contracts";
import QueuedPostCard from "./QueuedPostCard";
import InfoTip from "./InfoTip";
import { Panel, PanelHeader, ScrollArea, SegmentedTabs } from "./WorkbenchPrimitives";

interface QueuedPostsPanelProps {
  posts: ScheduledPostRecord[];
  clips: ClipRecord[];
  performanceContentByPostId?: ReadonlyMap<string, ReactNode>;
  refreshingStatuses: boolean;
  refreshMessage: string | null;
  onRefreshStatuses: () => void;
  onRemove?: (postId: string) => void;
  onReconcile?: (postId: string) => void;
  reconcilingPostId?: string | null;
  onRetryCaptions?: (postId: string) => void;
  retryingCaptionsPostId?: string | null;
}

const platforms: Array<{ id: PublishPlatform; label: string }> = [
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" }
];

export default function QueuedPostsPanel({
  posts,
  clips,
  performanceContentByPostId = new Map(),
  refreshingStatuses,
  refreshMessage,
  onRefreshStatuses,
  onRemove,
  onReconcile,
  reconcilingPostId = null,
  onRetryCaptions,
  retryingCaptionsPostId = null
}: QueuedPostsPanelProps): JSX.Element {
  const [activePlatform, setActivePlatform] = useState<PublishPlatform>("youtube");
  const tabId = useId().replace(/:/g, "");
  const clipsById = useMemo(() => {
    const index = new Map<string, ClipRecord>();
    for (const clip of clips) {
      if (!index.has(clip.id)) {
        index.set(clip.id, clip);
      }
    }
    return index;
  }, [clips]);
  const visiblePosts = useMemo(
    () => posts
      .filter((post) => post.platform === activePlatform)
      .sort((left, right) => comparePublishDates(right.publishAt, left.publishAt)),
    [posts, activePlatform]
  );

  return (
    <Panel className="detail-card queued-posts-panel" aria-labelledby={`${tabId}-title`}>
      <PanelHeader className="panel-header">
        <div>
          <div className="title-with-tip">
            <h3 id={`${tabId}-title`}>Queued posts</h3>
            <InfoTip label="Queued post count">
              {posts.length} queued post{posts.length === 1 ? "" : "s"} across the available platform tabs.
            </InfoTip>
          </div>
          <p className="detail-meta">Choose a platform, then open a post to inspect its video, schedule, metadata, and result.</p>
        </div>
        <div className="panel-header-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onRefreshStatuses}
            disabled={refreshingStatuses}
            aria-label="Refresh queued post statuses"
            title="Refresh queued post statuses"
          >
            {refreshingStatuses ? "..." : "↻"}
          </button>
        </div>
      </PanelHeader>

      <SegmentedTabs className="queued-posts-tabs" role="tablist" aria-label="Queued posts by platform">
        {platforms.map((platform) => {
          const count = posts.filter((post) => post.platform === platform.id).length;
          const isActive = activePlatform === platform.id;
          const panelId = `${tabId}-${platform.id}-panel`;

          return (
            <button
              key={platform.id}
              id={`${tabId}-${platform.id}-tab`}
              type="button"
              className={`queued-posts-tab${isActive ? " active" : ""}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActivePlatform(platform.id)}
            >
              <span>{platform.label}</span>
              <span className="queued-posts-tab-count">{count}</span>
            </button>
          );
        })}
      </SegmentedTabs>

      <div
        id={`${tabId}-${activePlatform}-panel`}
        className="queued-posts-tabpanel"
        role="tabpanel"
        aria-labelledby={`${tabId}-${activePlatform}-tab`}
        tabIndex={0}
      >
        {refreshMessage ? <p className="detail-meta queued-posts-refresh-message" aria-live="polite">{refreshMessage}</p> : null}
        {visiblePosts.length === 0 ? (
          <div className="empty-state compact">
            <h4>No {activePlatform === "youtube" ? "YouTube" : "TikTok"} posts yet</h4>
            <p>Posts scheduled for this platform will appear here once you explicitly schedule a clip.</p>
          </div>
        ) : (
          <ScrollArea className="queue-list">
            {visiblePosts.map((post) => (
              <QueuedPostCard
                key={post.id}
                post={post}
                clip={clipsById.get(post.clipId) ?? null}
                performanceContent={performanceContentByPostId.get(post.id) ?? null}
                onRemove={onRemove}
                onReconcile={onReconcile}
                reconciling={reconcilingPostId === post.id}
                onRetryCaptions={onRetryCaptions}
                retryingCaptions={retryingCaptionsPostId === post.id}
              />
            ))}
          </ScrollArea>
        )}
      </div>
    </Panel>
  );
}

function comparePublishDates(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }

  return left.localeCompare(right);
}
