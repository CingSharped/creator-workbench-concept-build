const test = require("node:test");
const assert = require("node:assert/strict");

const { deriveCreatorSetupState } = require("../dist/shared/setupState.js");

function tool(available) {
  return {
    available,
    resolvedPath: available ? "C:\\tools\\tool.exe" : null,
    source: available ? "setting" : "missing"
  };
}

function appInfo(overrides = {}) {
  return {
    clipLibraryFolder: "C:\\clips",
    longFormSourceLibraryFolder: "C:\\long-form",
    srtOutputFolder: "C:\\srt",
    ffmpeg: tool(true),
    ffprobe: tool(true),
    whisper: tool(true),
    whisperModel: tool(true),
    localAiRuntime: {
      health: "ready",
      availableModels: [{ id: "model-1" }]
    },
    transcriptionRuntime: {
      cudaModel: tool(true),
      activeBackend: "cuda",
      preference: "auto"
    },
    setupEnvironment: {
      platform: "win32",
      architecture: "x64",
      storageRoot: "C:\\",
      freeSpaceBytes: 50 * 1024 * 1024 * 1024
    },
    ...overrides
  };
}

function youtube(connected) {
  return {
    connected,
    channelTitle: connected ? "Creator channel" : null
  };
}

test("first-run setup reports all required areas ready and YouTube as optional", () => {
  const state = deriveCreatorSetupState(appInfo(), youtube(false));

  assert.equal(state.ready, true);
  assert.equal(state.requiredItemsReady, 3);
  assert.equal(state.requiredItemsTotal, 3);
  assert.deepEqual(
    state.items.map((item) => [item.id, item.status]),
    [
      ["workspace", "ready"],
      ["tools", "ready"],
      ["local_ai", "ready"],
      ["youtube", "optional"]
    ]
  );
});

test("first-run setup identifies missing folders, tools, and local models", () => {
  const state = deriveCreatorSetupState(
    appInfo({
      clipLibraryFolder: null,
      longFormSourceLibraryFolder: null,
      ffmpeg: tool(false),
      localAiRuntime: { health: "needs_model", availableModels: [] }
    }),
    youtube(true)
  );

  assert.equal(state.ready, false);
  assert.equal(state.requiredItemsReady, 0);
  assert.equal(state.items[0].detail, "Choose Clip Library, Long-form.");
  assert.equal(state.items[1].status, "needs_setup");
  assert.equal(state.items[2].status, "needs_setup");
  assert.equal(state.items[3].status, "ready");
  assert.equal(state.environment.architecture, "x64");
});

test("first-run setup explains when the core media tools are bundled", () => {
  const state = deriveCreatorSetupState(
    appInfo({
      ffmpeg: { ...tool(true), source: "bundled" },
      ffprobe: { ...tool(true), source: "bundled" },
      whisper: { ...tool(true), source: "bundled" },
      whisperModel: { ...tool(true), source: "bundled" }
    }),
    youtube(false)
  );

  assert.match(state.items.find((item) => item.id === "tools").detail, /bundled/i);
});
