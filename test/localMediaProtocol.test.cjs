const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createLocalMediaResponse } = require("../dist/electron/services/localMediaProtocol.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-workspace-media-test-"));
const sourcePath = path.join(tempRoot, "sample.mp4");
fs.writeFileSync(sourcePath, "0123456789", "utf8");

function request(method = "GET", range) {
  const headers = new Headers();
  if (range) {
    headers.set("range", range);
  }

  return {
    url: `creator-media://local?path=${encodeURIComponent(sourcePath)}`,
    method,
    headers
  };
}

test("streams a local media file with video headers", async () => {
  const response = await createLocalMediaResponse(request());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(await response.text(), "0123456789");
});

test("serves a requested byte range", async () => {
  const response = await createLocalMediaResponse(request("GET", "bytes=2-5"));

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(await response.text(), "2345");
});

test("supports suffix ranges and HEAD requests", async () => {
  const rangeResponse = await createLocalMediaResponse(request("GET", "bytes=-3"));
  const headResponse = await createLocalMediaResponse(request("HEAD", "bytes=2-5"));

  assert.equal(await rangeResponse.text(), "789");
  assert.equal(headResponse.status, 206);
  assert.equal(headResponse.headers.get("content-length"), "4");
  assert.equal(await headResponse.text(), "");
});

test("rejects invalid local media requests clearly", async () => {
  const missing = await createLocalMediaResponse({
    ...request(),
    url: "creator-media://local?path=C%3A%5Cmissing.mp4"
  });
  const method = await createLocalMediaResponse(request("POST"));

  assert.equal(missing.status, 404);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");
});
