const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");

test("Performance controller preserves filtering, refresh, history, detail, coaching and navigation behaviour in React", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-performance-workflow-"));
  try {
    esbuild.buildSync({ entryPoints: [path.join(__dirname, "fixtures", "performanceWorkflowHarness.tsx")],
      bundle: true, platform: "browser", outfile: path.join(directory, "bundle.js"),
      define: { "process.env.NODE_ENV": '"development"' }, jsx: "automatic" });
    fs.writeFileSync(path.join(directory, "index.html"), '<!doctype html><html><body><script src="bundle.js"></script></body></html>');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require("electron"), [path.join(__dirname, "fixtures", "rendererWorkflowRunner.cjs"), directory],
      { env, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const results = JSON.parse(fs.readFileSync(path.join(directory, "results.json"), "utf8"));
    assert.equal(results.length, 8);
    assert.deepEqual(results.filter(item => item.error), [], JSON.stringify(results.filter(item => item.error), null, 2));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
