const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildSrtFromTranscriptSegments } = require("../dist/shared/transcriptSegments.js");
const {
  bootstrapLocalDatabase
} = require("../dist/electron/services/database.js");
const {
  createJob,
  updateJobStatus,
  updateJobProgress,
  markRunningJobsInterrupted,
  listJobs,
  subscribeJobUpdates
} = require("../dist/electron/services/jobRepository.js");

const workflowTestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workflow-safety-"));
bootstrapLocalDatabase(workflowTestDirectory);
test.after(() => fs.rmSync(workflowTestDirectory, { recursive: true, force: true }));

test("canonical timed transcript edits produce derived SRT", () => {
  const srt = buildSrtFromTranscriptSegments([
    { id: "one", startMs: 0, endMs: 1_250, text: "First line" },
    { id: "two", startMs: 1_250, endMs: 3_000, text: "Second line" }
  ]);

  assert.match(srt, /00:00:00,000 --> 00:00:01,250/);
  assert.match(srt, /00:00:01,250 --> 00:00:03,000/);
  assert.match(srt, /First line[\s\S]+Second line/);
});

test("running jobs become interrupted and publish an honest terminal update", () => {
  const updates = [];
  const unsubscribe = subscribeJobUpdates((operation) => updates.push(operation));

  try {
    const job = createJob({ workspaceId: "workspace-1", clipId: "clip-1", jobType: "transcription" });
    assert.equal(job.assetType, "clip");
    assert.equal(job.assetId, "clip-1");
    updateJobStatus(job.id, "running");
    markRunningJobsInterrupted();

    const stored = listJobs().find((candidate) => candidate.id === job.id);
    assert.equal(stored.status, "interrupted");
    assert.match(stored.message, /closed before this operation completed/);
    assert.equal(updates.at(-1).status, "interrupted");
  } finally {
    unsubscribe();
  }
});

test("shutdown interruption covers queued jobs and is idempotent", () => {
  const updates = [];
  const unsubscribe = subscribeJobUpdates((operation) => updates.push(operation));

  try {
    const queued = createJob({ workspaceId: "workspace-1", clipId: "clip-queued", jobType: "export" });
    const running = createJob({ workspaceId: "workspace-1", clipId: "clip-running", jobType: "transcription" });
    updateJobStatus(running.id, "running");

    markRunningJobsInterrupted();
    const interruptedUpdateCount = updates.filter((operation) => operation.status === "interrupted").length;
    markRunningJobsInterrupted();

    const storedJobs = listJobs();
    assert.equal(storedJobs.find((job) => job.id === queued.id).status, "interrupted");
    assert.equal(storedJobs.find((job) => job.id === running.id).status, "interrupted");
    assert.equal(updates.filter((operation) => operation.status === "interrupted").length, interruptedUpdateCount);
  } finally {
    unsubscribe();
  }
});

test("late status and progress callbacks cannot overwrite a terminal job", () => {
  const updates = [];
  const unsubscribe = subscribeJobUpdates((operation) => updates.push(operation));

  try {
    const job = createJob({ workspaceId: "workspace-1", clipId: "clip-1", jobType: "transcription" });
    updateJobStatus(job.id, "running");
    updateJobStatus(job.id, "interrupted");
    const updateCountAfterInterruption = updates.length;

    updateJobProgress(job.id, { phase: "failed", percent: 10, message: "Late process callback" });
    updateJobStatus(job.id, "failed", "Late process callback");

    const stored = listJobs().find((candidate) => candidate.id === job.id);
    assert.equal(stored.status, "interrupted");
    assert.equal(stored.phase, null);
    assert.equal(stored.percent, null);
    assert.equal(stored.message, null);
    assert.equal(updates.length, updateCountAfterInterruption);
  } finally {
    unsubscribe();
  }
});
