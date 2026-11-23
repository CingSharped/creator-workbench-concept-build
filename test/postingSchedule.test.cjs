const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_POSTING_SCHEDULE,
  normalizePostingScheduleSettings,
  resolveNextAvailablePostingSlot
} = require("../dist/shared/postingSchedule.js");

function post(overrides = {}) {
  return {
    platform: "youtube",
    status: "scheduled",
    channelId: "channel-1",
    accountLabel: "Test channel",
    publishAt: "2026-09-07T12:00:00.000Z",
    ...overrides
  };
}

function localSlotIso(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month, day, hour, minute, 0, 0).toISOString();
}

test("default posting schedule repeats every day at noon", () => {
  const result = resolveNextAvailablePostingSlot(DEFAULT_POSTING_SCHEDULE, [], {
    now: new Date(2026, 8, 7, 10, 0, 0)
  });

  assert.equal(result.reason, "available");
  assert.equal(result.slotId, "daily-noon");
  assert.equal(new Date(result.publishAt).getHours(), 12);
  assert.equal(new Date(result.publishAt).getDate(), 7);
});

test("occupied occurrences advance to the next free day", () => {
  const result = resolveNextAvailablePostingSlot(DEFAULT_POSTING_SCHEDULE, [
    post({ publishAt: localSlotIso(2026, 8, 7) })
  ], {
    now: new Date(2026, 8, 7, 10, 0, 0),
    channelId: "channel-1",
    accountLabel: "Test channel"
  });

  assert.equal(result.reason, "available");
  assert.equal(new Date(result.publishAt).getDate(), 8);
  assert.equal(new Date(result.publishAt).getHours(), 12);
});

test("failed posts do not reserve a recurring occurrence", () => {
  const result = resolveNextAvailablePostingSlot(DEFAULT_POSTING_SCHEDULE, [
    post({ status: "failed" })
  ], {
    now: new Date(2026, 8, 7, 10, 0, 0),
    channelId: "channel-1",
    accountLabel: "Test channel"
  });

  assert.equal(result.reason, "available");
  assert.equal(new Date(result.publishAt).getDate(), 7);
});

test("paused and empty schedules report not configured", () => {
  const result = resolveNextAvailablePostingSlot({
    version: 1,
    slots: [{
      id: "paused",
      enabled: false,
      recurrence: "weekly",
      daysOfWeek: [1],
      localTime: "12:00"
    }],
    updatedAt: null
  }, [], { now: new Date(2026, 8, 7, 10, 0, 0) });

  assert.equal(result.reason, "not_configured");
});

test("normalization migrates legacy single-day slots and removes duplicates", () => {
  const result = normalizePostingScheduleSettings({
    slots: [
      { id: "legacy", dayOfWeek: 1, localTime: "12:00" },
      { id: "duplicate", daysOfWeek: [1], localTime: "12:00" },
      { id: "weekends", daysOfWeek: [0, 6], localTime: "18:30", enabled: false }
    ]
  });

  assert.equal(result.slots.length, 2);
  assert.deepEqual(result.slots[0].daysOfWeek, [1]);
  assert.equal(result.slots[1].enabled, false);
  assert.deepEqual(result.slots[1].daysOfWeek, [0, 6]);
});

test("different YouTube channels do not block the current channel", () => {
  const result = resolveNextAvailablePostingSlot(DEFAULT_POSTING_SCHEDULE, [
    post({ channelId: "other-channel" })
  ], {
    now: new Date(2026, 8, 7, 10, 0, 0),
    channelId: "channel-1",
    accountLabel: "Test channel"
  });

  assert.equal(result.reason, "available");
  assert.equal(new Date(result.publishAt).getDate(), 7);
});

test("refresh releases a failed reservation and keeps a YouTube-only schedule occupied after queue removal", t => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cw-schedule-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  require("../dist/electron/services/database.js").bootstrapLocalDatabase(dir);
  const repo = require("../dist/electron/services/scheduledPostRepository.js");
  const preview = () => repo.previewPostingSlot(DEFAULT_POSTING_SCHEDULE, "channel-1", "Test channel");
  const first = preview().publishAt;
  const attempt = repo.createScheduledPost({
    workspaceId: "workspace", clipId: "clip", platform: "youtube", channelId: "channel-1",
    accountLabel: "Test channel", publishAt: first, executionMode: "api", title: "Retry",
    description: "", platformTags: [], youtubePlaylistIds: []
  });
  repo.updateScheduledPost(attempt.id, { status: "reconciliation_required" });
  const second = preview().publishAt;
  assert.notEqual(second, first);
  const remote = new Map([["studio-upload", { status: "scheduled", publishAt: second }]]);
  repo.applyYouTubeSchedule("channel-1", repo.listScheduledPosts(), remote);
  assert.equal(preview().publishAt, first);
  assert.equal(repo.getScheduledPostById(attempt.id).status, "failed");
  repo.removeScheduledPost(attempt.id);
  const retry = repo.createScheduledPostAtNextSlot({ ...attempt, schedule: DEFAULT_POSTING_SCHEDULE });
  assert.equal(retry.resolution.publishAt, first);
  assert.notEqual(preview().publishAt, second);
});
