const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateStackedCrop,
  calculateStackedCropRect
} = require("../dist/shared/stackedVerticalLayout.js");
const {
  clampVideoTime,
  getVideoTimelineBounds
} = require("../dist/shared/videoTimeline.js");

test("uses the same even 9:8 crop dimensions as stacked export", () => {
  assert.deepEqual(calculateStackedCrop(1920, 1080), { widthPx: 1214, heightPx: 1080 });
  assert.deepEqual(calculateStackedCrop(1080, 1920), { widthPx: 1080, heightPx: 960 });
});

test("maps player crop focus to the same source rectangle as export", () => {
  assert.deepEqual(calculateStackedCropRect(1920, 1080, 1, 0.5, 0.5), {
    widthPx: 1214,
    heightPx: 1080,
    xPx: 353,
    yPx: 0
  });

  const zoomedRight = calculateStackedCropRect(1920, 1080, 0.5, 1, 0.5);
  assert.equal(zoomedRight.widthPx, 606);
  assert.equal(zoomedRight.heightPx, 540);
  assert.equal(zoomedRight.xPx, 1314);
  assert.equal(zoomedRight.yPx, 270);
});

test("clamps invalid crop settings to the source bounds", () => {
  const clamped = calculateStackedCropRect(1920, 1080, 5, 4, -2);

  assert.equal(clamped.widthPx, 1214);
  assert.equal(clamped.heightPx, 1080);
  assert.equal(clamped.xPx + clamped.widthPx <= 1920, true);
  assert.equal(clamped.yPx + clamped.heightPx <= 1080, true);

  const zoomed = calculateStackedCropRect(1920, 1080, 0.25, 4, -2);
  assert.equal(zoomed.widthPx, 302);
  assert.equal(zoomed.heightPx, 270);
  assert.equal(zoomed.xPx, 1618);
  assert.equal(zoomed.yPx, 0);
});

test("keeps the absolute trim end when the trim start moves", () => {
  const input = {
    timelineRange: { startSeconds: 1734, endSeconds: 1738 },
    durationSeconds: 3600,
    nativeDurationSeconds: 3600,
    frameDurationSeconds: 1 / 60
  };

  assert.deepEqual(getVideoTimelineBounds(input), { startSeconds: 1734, endSeconds: 1738 });
  assert.equal(clampVideoTime(1738, getVideoTimelineBounds(input)), 1738);
});
