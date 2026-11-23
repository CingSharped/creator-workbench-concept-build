const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const activity = require("../dist/electron/services/aiActivityService.js");
const { LocalAiScheduler } = require("../dist/electron/services/localAiScheduler.js");
const { sortAiActivity } = require("../dist/shared/aiActivity.js");
const { bootstrapLocalDatabase, updateDatabase } = require("../dist/electron/services/database.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-ai-activity-"));
bootstrapLocalDatabase(root);
updateDatabase(store => store.longFormSources.push({ id: "source", workspaceId: "w", displayName: "Example stream", sourcePath: "unused.mp4", fileSizeBytes: 1,
  durationMs: 60000, widthPx: 1920, heightPx: 1080, inspectionStatus: "basic", importedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function until(predicate) {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await new Promise(r => setTimeout(r, 2)); }
  assert.fail("Activity event did not arrive");
}
function tasks() { return activity.getAiActivitySnapshot().tasks; }
function turn(scheduler, model, work, signal) {
  const entry = activity.createAiActivityTurn(model);
  return scheduler.run(() => entry.run(work), signal, entry.observe);
}

test("failure messages mentioning cancellation stay failed while typed cancellation stays cancelled", async () => {
  const { WorkflowCancelledError } = require("../dist/shared/workflowOutcome.js");
  for (const [error, expected] of [
    [new Error("Cleanup failed after a request was cancelled"), "failed"],
    [new WorkflowCancelledError("Stopped by the user"), "cancelled"]
  ]) {
    const before = new Set(tasks().map(task => task.id));
    await assert.rejects(activity.trackAiAction("clips.generate_metadata", {}, async () => { throw error; }));
    const task = tasks().find(task => !before.has(task.id));
    assert.equal(task.status, expected);
    assert.equal(task.error, expected === "failed" ? error.message : null);
  }
});

test("multi-stage work stays one task while other workflows take AI turns", async () => {
  const scheduler = new LocalAiScheduler();
  const first = gate(), second = gate();
  const tracked = activity.trackAiAction("long_form.generate_proposals", { sourceId: "source" }, async () => {
    activity.setAiActivityDetail("Transcript window 1 of 2");
    await turn(scheduler, "Model A", () => first.promise);
    activity.setAiActivityDetail("Transcript window 2 of 2");
    await turn(scheduler, "Model A", async () => {});
    return { issueSummary: "One empty window" };
  });
  await until(() => tasks().some(t => t.title === "Find clips" && t.status === "loading"));
  const metadata = activity.trackAiAction("clips.generate_metadata", {}, () => turn(scheduler, "Model B", () => second.promise));
  await until(() => tasks().some(t => t.title === "Generate metadata" && t.status === "waiting"));
  let sourceTask = tasks().find(t => t.title === "Find clips");
  assert.equal(sourceTask.assetLabel, "Example stream");
  assert.equal(sourceTask.detail, "Transcript window 1 of 2");
  const id = sourceTask.id;
  first.resolve();
  await until(() => tasks().find(t => t.id === id)?.status === "waiting");
  assert.equal(tasks().find(t => t.id === id).queuePosition, 1);
  const order = sortAiActivity(tasks().filter(t => t.finishedAt === null));
  assert.equal(order[0].title, "Generate metadata");
  second.resolve(); await Promise.all([tracked, metadata]);
  sourceTask = tasks().find(t => t.id === id);
  assert.equal(sourceTask.status, "completed");
  assert.equal(sourceTask.warning, "One empty window");
  assert.equal(sourceTask.queuePosition, null);
  assert.equal(tasks().filter(t => t.id === id).length, 1);
});

test("queued positions update immediately and cancellation cannot stop another owner", async () => {
  const scheduler = new LocalAiScheduler();
  const running = gate();
  const started = gate();
  const first = scheduler.run(() => { started.resolve(); return running.promise; });
  await started.promise;
  const controller = new AbortController();
  const events = [];
  const queued = scheduler.run(async () => assert.fail("Cancelled work ran"), controller.signal, state => events.push(state));
  const rejected = assert.rejects(queued, /cancelled/);
  const thirdEvents = [];
  const third = scheduler.run(async () => {}, undefined, state => thirdEvents.push(state));
  assert.equal(thirdEvents.at(-1).position, 2);
  controller.abort(); await rejected;
  assert.equal(events.at(-1).status, "finished");
  assert.equal(thirdEvents.at(-1).position, 1);
  running.resolve(); await Promise.all([first, third]);
  assert.equal(thirdEvents.at(-1).status, "finished");
});

test("three visual requests group into one job with the active candidate's detail", async () => {
  const scheduler = new LocalAiScheduler();
  const gates = [gate(), gate(), gate()];
  let id;
  const result = activity.trackAiAction("long_form.generate_proposals", { sourceId: "source" }, async () => {
    await Promise.all(gates.map((entry, index) => {
      activity.setAiActivityDetail(`Visual review ${index + 1}`);
      return turn(scheduler, "Vision model", () => entry.promise);
    }));
  });
  await until(() => tasks().some(t => t.status === "loading" && t.detail === "Visual review 1"));
  id = tasks().find(t => t.finishedAt === null).id;
  gates[0].resolve();
  await until(() => tasks().find(t => t.id === id)?.detail === "Visual review 2");
  assert.equal(tasks().filter(t => t.finishedAt === null).length, 1);
  gates[1].resolve(); gates[2].resolve(); await result;
});

test("cancellation and failure are retained, snapshots cannot mutate internal state", async () => {
  let id;
  const pending = activity.trackAiAction("long_form.generate_proposals", {}, async () => {
    await new Promise((_resolve, reject) => {
      activity.setAiActivityCancel(() => reject(new Error("Clip proposal generation cancelled.")));
      id = tasks().find(t => t.finishedAt === null).id;
    });
  });
  const cancelled = assert.rejects(pending, /cancelled/);
  assert.equal(activity.cancelAiActivity(id), true);
  await cancelled;
  assert.equal(tasks().find(t => t.id === id).status, "cancelled");
  assert.equal(activity.cancelAiActivity(id), false);
  await assert.rejects(activity.trackAiAction("clips.generate_metadata", {}, async () => { throw new Error("Example failure"); }), /Example failure/);
  assert.ok(tasks().some(t => t.status === "failed" && t.error === "Example failure"));
  const snapshot = activity.getAiActivitySnapshot();
  snapshot.tasks[0].title = "modified";
  assert.notEqual(tasks()[0].title, "modified");
});

test("unrelated actions are not listed and completed history stays bounded", async () => {
  const before = activity.getAiActivitySnapshot().revision;
  await activity.trackAiAction("clips.import", {}, async () => {});
  assert.equal(activity.getAiActivitySnapshot().revision, before);
  for (let index = 0; index < 25; index++) await activity.trackAiAction("performance.generate_coach", {}, async () => {});
  assert.equal(tasks().length, 20);
});
