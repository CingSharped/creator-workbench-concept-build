const test = require("node:test");
const assert = require("node:assert/strict");

const { parseJsonResponse } = require("../dist/shared/jsonResponse.js");

test("parses plain JSON responses", () => {
  assert.deepEqual(parseJsonResponse('{"ok":true}'), { ok: true });
});

test("parses JSON wrapped in a markdown code fence", () => {
  assert.deepEqual(parseJsonResponse("```json\n{\"ok\":true}\n```"), { ok: true });
});

test("parses JSON with a short explanatory prefix", () => {
  assert.deepEqual(parseJsonResponse("Here is the result:\n{\"ok\":true}"), { ok: true });
});

test("rejects malformed JSON", () => {
  assert.equal(parseJsonResponse("```json\n{not valid}\n```"), null);
});
