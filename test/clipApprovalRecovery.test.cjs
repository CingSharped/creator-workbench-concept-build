const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-approval-recovery-"));
const db = require("../dist/electron/services/database.js");
const proposals = require("../dist/electron/services/clipProposalRepository.js");
const clips = require("../dist/electron/services/clipRepository.js");
const imports = require("../dist/electron/services/clipImportService.js");
const renders = require("../dist/electron/services/clipTrimService.js");
const recovery = require("../dist/electron/services/clipApprovalRecovery.js");
const service = require("../dist/electron/services/longFormClipProposalService.js");
const { ensureDefaultWorkspace } = require("../dist/electron/services/workspaceRepository.js");
const { createLongFormSource } = require("../dist/electron/services/longFormSourceRepository.js");
const { setWorkspaceFolderSetting } = require("../dist/electron/services/workspacePreferences.js");
db.bootstrapLocalDatabase(root);
const initial = db.readDatabase();
const originals = { render: renders.exportStackedVerticalMedia, import: imports.importClipPaths,
  lineage: clips.setClipLineage, decision: proposals.recordClipProposalDecision, save: recovery.saveClipApprovalReceipt };
let source, proposal, renderCount, library;
const layout = { topFocusX: .5, topFocusY: .5, topScale: 1, bottomFocusX: .5, bottomFocusY: .5, bottomScale: 1 };
const approve = () => service.approveLongFormClipProposal(source.id, proposal.id, 0, 10000, layout, "Approved");
const stored = () => proposals.listClipProposalsBySourceId(source.id)[0];

test.beforeEach(() => {
  fs.writeFileSync(db.getDatabaseContext().databasePath, JSON.stringify(initial));
  const workspace = ensureDefaultWorkspace();
  library = fs.mkdtempSync(path.join(root, "library-"));
  setWorkspaceFolderSetting("clipLibrary", library);
  const sourcePath = path.join(root, "source.mp4");
  fs.writeFileSync(sourcePath, "original source");
  source = createLongFormSource({ workspaceId: workspace.id, sourcePath, displayName: "Source", fileSizeBytes: 15,
    durationMs: 60000, widthPx: 1920, heightPx: 1080, inspectionStatus: "basic" });
  [proposal] = proposals.replaceClipProposalsForSource(source.id, [{ sourceId: source.id, startMs: 0, endMs: 10000,
    hook: "Hook", reason: "Reason", confidence: .9, evidenceSegmentIds: [], status: "proposed" }]);
  renderCount = 0;
  renders.exportStackedVerticalMedia = async ({ outputPath }) => {
    renderCount++;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, "complete rendered clip");
    return outputPath;
  };
  imports.importClipPaths = async ([sourcePath]) => {
    const result = clips.createImportedClip({ workspaceId: workspace.id, sourcePath, displayName: "Approved",
      fileSizeBytes: fs.statSync(sourcePath).size, durationMs: 10000, widthPx: 1080, heightPx: 1920, inspectionStatus: "basic" });
    return { importedClipIds: [result.clip.id], createdClipIds: result.created ? [result.clip.id] : [] };
  };
});
test.afterEach(() => {
  renders.exportStackedVerticalMedia = originals.render;
  imports.importClipPaths = originals.import;
  clips.setClipLineage = originals.lineage;
  proposals.recordClipProposalDecision = originals.decision;
  recovery.saveClipApprovalReceipt = originals.save;
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

for (const stage of ["rendered", "published", "imported", "lineage", "decision"]) {
  test(`retry preserves one artifact after failure at ${stage}`, async () => {
    let failed = false;
    recovery.saveClipApprovalReceipt = (...args) => {
      if (!failed && args[2].stage === stage) { failed = true; throw new Error("injected failure"); }
      return originals.save(...args);
    };
    if (stage === "lineage") clips.setClipLineage = () => { throw new Error("injected failure"); };
    if (stage === "decision") proposals.recordClipProposalDecision = () => { throw new Error("injected failure"); };
    await assert.rejects(approve(), /injected failure/);
    const receipt = stored().approvalReceipt;
    for (const clip of db.readDatabase().clips) assert.ok(fs.existsSync(clip.sourcePath));
    clips.setClipLineage = originals.lineage;
    proposals.recordClipProposalDecision = originals.decision;
    const result = await approve();
    assert.equal(result.outputPath, receipt.outputPath);
    assert.equal(renderCount, stage === "rendered" ? 2 : 1);
    assert.equal(db.readDatabase().clips.length, 1);
    assert.equal(proposals.listClipProposalFeedback().length, 1);
    assert.equal(stored().approvalReceipt.stage, "completed");
    assert.equal((await approve()).clip.id, result.clip.id);
    assert.equal(proposals.listClipProposalFeedback().length, 1);
    assert.equal(fs.readFileSync(source.sourcePath, "utf8"), "original source");
  });
}

test("import failure after a committed clip retains it and retry adopts the same identity", async () => {
  const importOnce = imports.importClipPaths;
  imports.importClipPaths = async (...args) => { await importOnce(...args); throw new Error("post-import failure"); };
  await assert.rejects(approve(), /post-import failure/);
  const clip = db.readDatabase().clips[0];
  assert.ok(fs.existsSync(clip.sourcePath));
  imports.importClipPaths = importOnce;
  assert.equal((await approve()).clip.id, clip.id);
  assert.equal(renderCount, 1);
});

test("unfinished approval survives a new process and cannot be replaced or changed", async () => {
  clips.setClipLineage = () => { throw new Error("stop after adoption"); };
  await assert.rejects(approve(), /stop after adoption/);
  assert.throws(() => proposals.replaceClipProposalsForSource(source.id, []), /interrupted/);
  await assert.rejects(service.approveLongFormClipProposal(source.id, proposal.id, 1, 10000, layout, "Approved"), /different/);
  const script = `const db=require('./dist/electron/services/database.js');db.bootstrapLocalDatabase(process.argv[1]);
    require('./dist/electron/services/longFormClipProposalService.js').approveLongFormClipProposal(
    process.argv[2],process.argv[3],0,10000,${JSON.stringify(layout)},'Approved').then(r=>console.log(r.clip.id)).catch(e=>{console.error(e);process.exitCode=1});`;
  const result = spawnSync(process.execPath, ["-e", script, root, source.id, proposal.id], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), db.readDatabase().clips[0].id);
  assert.equal(stored().status, "approved");
});

test("concurrent approval is rejected and only one render runs", async () => {
  const first = approve();
  await assert.rejects(approve(), /already running/);
  assert.throws(() => service.rejectLongFormClipProposal(source.id, proposal.id), /running approval/);
  await first;
  assert.equal(renderCount, 1);
});

for (const stage of ["rendering", "rendered", "published", "imported"]) {
  test(`reject ends interrupted approval at ${stage} without deleting artifacts`, async () => {
    const render = renders.exportStackedVerticalMedia;
    renders.exportStackedVerticalMedia = async (input) => {
      await render(input);
      if (stage === "rendering") throw new Error("interrupted");
    };
    recovery.saveClipApprovalReceipt = (...args) => {
      originals.save(...args);
      if (stage !== "rendering" && args[2].stage === stage) throw new Error("interrupted");
    };
    await assert.rejects(approve(), /interrupted/);
    const receipt = stored().approvalReceipt;
    assert.equal(receipt.stage, stage);
    const existingFiles = [receipt.stagingPath, receipt.outputPath].filter(fs.existsSync);
    const existingClipIds = db.readDatabase().clips.map(clip => clip.id);
    const result = service.rejectLongFormClipProposal(source.id, proposal.id, "Not wanted");
    assert.equal(result.status, "rejected");
    assert.equal(stored().approvalReceipt, undefined);
    assert.equal(stored().rejectionReason, "Not wanted");
    assert.equal(proposals.listClipProposalFeedback()[0].decision, "rejected");
    for (const file of existingFiles) assert.ok(fs.existsSync(file));
    assert.deepEqual(db.readDatabase().clips.map(clip => clip.id), existingClipIds);
    proposals.recordClipProposalReopened(source.id, proposal.id);
    assert.equal(stored().approvalReceipt, undefined);
    assert.doesNotThrow(() => proposals.replaceClipProposalsForSource(source.id, []));
  });
}

test("partial render never enters the library and a retry renders it again", async () => {
  const render = renders.exportStackedVerticalMedia;
  renders.exportStackedVerticalMedia = async (input) => {
    await render(input);
    fs.writeFileSync(input.outputPath, "partial render");
    throw new Error("render interrupted");
  };
  await assert.rejects(approve(), /render interrupted/);
  const receipt = stored().approvalReceipt;
  assert.equal(receipt.stage, "rendering");
  assert.equal(fs.existsSync(receipt.outputPath), false);
  assert.equal(db.readDatabase().clips.length, 0);
  renders.exportStackedVerticalMedia = render;
  const result = await approve();
  assert.equal(fs.readFileSync(result.outputPath, "utf8"), "complete rendered clip");
  assert.equal(renderCount, 2);
});

test("invalid layout does not create an unretryable approval receipt", async () => {
  await assert.rejects(service.approveLongFormClipProposal(source.id, proposal.id, 0, 10000,
    { ...layout, topScale: 0 }, "Approved"), /crop size/);
  assert.equal(stored().approvalReceipt, undefined);
  assert.equal(renderCount, 0);
  await approve();
});

test("output collision never overwrites an unrelated file", async () => {
  const render = renders.exportStackedVerticalMedia;
  renders.exportStackedVerticalMedia = async (input) => {
    await render(input);
    fs.writeFileSync(stored().approvalReceipt.outputPath, "unrelated file");
  };
  await assert.rejects(approve(), /another file/);
  assert.equal(fs.readFileSync(stored().approvalReceipt.outputPath, "utf8"), "unrelated file");
  assert.equal(db.readDatabase().clips.length, 0);
});

test("changed adopted artifact blocks retry without removing either record or file", async () => {
  clips.setClipLineage = () => { throw new Error("stop"); };
  await assert.rejects(approve(), /stop/);
  const output = stored().approvalReceipt.outputPath;
  fs.writeFileSync(output, "changed");
  await assert.rejects(approve(), /changed/);
  assert.ok(fs.existsSync(output));
  assert.equal(db.readDatabase().clips.length, 1);
});
