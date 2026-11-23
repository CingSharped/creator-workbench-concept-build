const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeClipFileName,
  suggestClipFileName
} = require("../dist/shared/clipFileName.js");

test("suggests a readable filename from the source and proposal hook", () => {
  assert.equal(
    suggestClipFileName("C:\\Example\\Videos\\Part1.mp4", "The clutch save"),
    "Part1 - The clutch save"
  );
});

test("sanitizes Windows filename characters and removes a user-supplied extension", () => {
  assert.equal(
    sanitizeClipFileName("The: clutch/save?.mp4"),
    "The- clutch-save"
  );
  assert.equal(sanitizeClipFileName("NUL.mp4"), "clip-NUL");
});

test("falls back when a filename contains no usable characters", () => {
  assert.equal(sanitizeClipFileName("..."), "approved-clip");
});
