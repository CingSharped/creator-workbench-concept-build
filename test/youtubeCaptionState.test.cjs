const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { isValidTimedSrtContent } = require("../dist/shared/transcriptSegments.js");
const {
  bootstrapLocalDatabase,
  readDatabase
} = require("../dist/electron/services/database.js");
const {
  createScheduledPost,
  markPostingPostsForReconciliation,
  updateScheduledPost
} = require("../dist/electron/services/scheduledPostRepository.js");

test("caption eligibility requires a complete timed SRT", () => {
  assert.equal(
    isValidTimedSrtContent("1\n00:00:00,000 --> 00:00:01,000\nHello creator"),
    true
  );
  assert.equal(isValidTimedSrtContent(""), false);
  assert.equal(
    isValidTimedSrtContent("1\n00:00:01,000 --> 00:00:01,000\nNo duration"),
    false
  );
  assert.equal(
    isValidTimedSrtContent("1\nnot-a-time --> 00:00:01,000\nInvalid"),
    false
  );
});

test("scheduled post caption state migrates and stays platform-specific", () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workflow-caption-"));
  const legacyPost = {
    id: "legacy-youtube-post",
    workspaceId: "workspace-1",
    clipId: "clip-1",
    platform: "youtube",
    accountLabel: "Channel",
    publishAt: "2026-08-13T12:00:00.000Z",
    executionMode: "native_schedule",
    status: "posted",
    title: "Legacy video",
    description: "Description",
    platformTags: [],
    youtubePlaylistIds: [],
    remotePostId: "video-1",
    publishedUrl: "https://youtube.com/watch?v=video-1",
    errorMessage: null,
    createdAt: "2026-08-13T11:00:00.000Z",
    updatedAt: "2026-08-13T11:00:00.000Z"
  };

  fs.writeFileSync(
    path.join(tempDirectory, "creator-workspace.json"),
    JSON.stringify({ scheduledPosts: [legacyPost] }),
    "utf8"
  );

  try {
    bootstrapLocalDatabase(tempDirectory);
    const migrated = readDatabase().scheduledPosts[0];
    assert.equal(migrated.captionStatus, "pending");
    assert.equal(migrated.captionRemoteId, null);

    const youtubePost = createScheduledPost({
      workspaceId: "workspace-1",
      clipId: "clip-2",
      platform: "youtube",
      accountLabel: "Channel",
      publishAt: "2026-08-13T12:00:00.000Z",
      executionMode: "native_schedule",
      title: "New video",
      description: "Description",
      platformTags: [],
      youtubePlaylistIds: []
    });
    const tiktokPost = createScheduledPost({
      workspaceId: "workspace-1",
      clipId: "clip-3",
      platform: "tiktok",
      accountLabel: "TikTok",
      publishAt: "2026-08-13T12:00:00.000Z",
      executionMode: "draft_handoff",
      title: "TikTok draft",
      description: "Description",
      platformTags: [],
      youtubePlaylistIds: []
    });

    assert.equal(youtubePost.captionStatus, "pending");
    assert.equal(tiktokPost.captionStatus, "not_applicable");
    assert.equal(youtubePost.remoteOutcome, "not_started");
    assert.equal(youtubePost.operationId, null);

    updateScheduledPost(youtubePost.id, {
      operationId: "youtube-job-1",
      status: "posting",
      remoteOutcome: "pending"
    });
    assert.equal(markPostingPostsForReconciliation(), 1);
    assert.equal(markPostingPostsForReconciliation(), 0);
    const recovered = readDatabase().scheduledPosts.find((candidate) => candidate.id === youtubePost.id);
    assert.equal(recovered.status, "reconciliation_required");
    assert.equal(recovered.remoteOutcome, "unknown");
    assert.match(recovered.reconciliationReason, /outcome was confirmed/);
    assert.equal(recovered.remotePostId, null);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
