const assert = require("node:assert/strict");
const test = require("node:test");

const { chooseWhisperBackend } = require("../dist/electron/services/runtimeTools.js");

test("auto prefers CUDA when both Whisper pairs are ready", () => {
  const result = chooseWhisperBackend("auto", true, true);

  assert.equal(result.activeBackend, "cuda");
  assert.match(result.statusDetail, /CUDA/);
});

test("auto falls back to CPU when CUDA is unavailable", () => {
  const result = chooseWhisperBackend("auto", false, true);

  assert.equal(result.activeBackend, "cpu");
  assert.match(result.statusDetail, /CPU Whisper fallback/);
});

test("explicit CUDA preference still uses CPU only as a visible fallback", () => {
  const result = chooseWhisperBackend("cuda", false, true);

  assert.equal(result.activeBackend, "cpu");
  assert.match(result.statusDetail, /CUDA was requested/);
});

test("an unavailable explicit backend does not claim a usable runtime", () => {
  const result = chooseWhisperBackend("cpu", false, false);

  assert.equal(result.activeBackend, "missing");
  assert.match(result.statusDetail, /No complete Whisper runtime/);
});
