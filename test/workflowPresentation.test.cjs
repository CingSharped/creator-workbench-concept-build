const test = require("node:test");
const assert = require("node:assert/strict");

const presentation = require("../dist/shared/workflowPresentation.js");

test("workflow presentation keeps clip status precedence deterministic", () => {
  const clip = { id: "clip", status: "imported" };
  assert.deepEqual(presentation.getClipLibraryStatus(clip, [{ clipId: "clip", status: "scheduled" }]), { label: "Scheduled", tone: "scheduled" });
  assert.deepEqual(presentation.getClipLibraryStatus(clip, [{ clipId: "clip", status: "posted" }]), { label: "Posted", tone: "posted" });
});

test("workflow presentation defaults to owned-channel performance filters", () => {
  const filters = presentation.createDefaultPerformanceFilters();
  assert.equal(filters.range, "28d");
  assert.equal(presentation.arePerformanceFiltersEqual(filters, { ...filters }), true);
});

test("workflow presentation sorts newest performance evidence first", () => {
  const sorted = presentation.sortPerformanceSnapshots([
    { fetchedAt: "2026-01-01" },
    { fetchedAt: "2026-02-01" }
  ]);
  assert.equal(sorted[0].fetchedAt, "2026-02-01");
});
