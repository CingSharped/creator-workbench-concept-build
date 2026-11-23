const test = require("node:test");
const assert = require("node:assert/strict");

const {
  countClipLibraryByFilter,
  filterClipLibrary,
  matchesClipLibrarySearch
} = require("../dist/shared/clipLibraryPresentation.js");

function clip(id, status, displayName, sourcePath = `C:/clips/${displayName}`) {
  return { id, status, displayName, sourcePath };
}

const clips = [
  clip("one", "imported", "First imported clip.mp4"),
  clip("two", "transcribed", "Second transcript.mp4"),
  clip("three", "metadata_ready", "Third package.mp4"),
  clip("four", "failed", "Fourth failed.mp4")
];

test("clip library counts use effective remote workflow status", () => {
  assert.deepEqual(countClipLibraryByFilter(clips, [
    { clipId: "one", status: "scheduled" },
    { clipId: "two", status: "posted" }
  ]), {
    all: 4,
    imported: 0,
    transcribed: 0,
    metadata_ready: 1,
    scheduled: 1,
    posted: 1,
    failed: 1
  });
});

test("clip library filters preserve source order and isolate status", () => {
  assert.deepEqual(filterClipLibrary(clips, "transcribed", "", []).map((item) => item.id), ["two"]);
  assert.deepEqual(filterClipLibrary(clips, "failed", "", []).map((item) => item.id), ["four"]);
  assert.deepEqual(filterClipLibrary(clips, "scheduled", "", [{ clipId: "one", status: "scheduled" }]).map((item) => item.id), ["one"]);
});

test("clip library search matches display names and source paths", () => {
  assert.equal(filterClipLibrary(clips, "all", "TRANSCRIPT", []).at(0).id, "two");
  assert.equal(filterClipLibrary(clips, "all", "C:/CLIPS/THIRD", []).at(0).id, "three");
  assert.equal(matchesClipLibrarySearch(clips[0], "  "), true);
});
