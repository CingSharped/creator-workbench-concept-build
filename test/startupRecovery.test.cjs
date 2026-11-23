const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const db = require("../dist/electron/services/database.js");
const jobs = require("../dist/electron/services/jobRepository.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-startup-recovery-"));
db.bootstrapLocalDatabase(root);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function launchMain(ownsLock = true) {
  // Execute the real compiled main entrypoint in a fresh process. Only Electron,
  // media and setup adapters are replaced; startup and persistence run normally.
  const script = `
    const Module=require('node:module');const original=Module._load;
    const app={requestSingleInstanceLock:()=>${ownsLock},whenReady:async()=>{},getPath:()=>process.argv[1],
      isPackaged:true,on:()=>{},exit:code=>{process.exitCode=code;},quit:()=>{}};
    class BrowserWindow {constructor(){this.webContents={};}async loadFile(){}static getAllWindows(){return [];}}
    Module._load=function(id,parent,...rest){
      if(id==='electron')return {app,BrowserWindow,protocol:{registerSchemesAsPrivileged(){},handle(){}}};
      if(parent?.filename.endsWith('main.js')) {
        if(id==='node:fs')return {...original.call(this,id,parent,...rest),existsSync:()=>true};
        if(id.endsWith('/clipLibraryWatcher'))return {refreshClipLibraryWatcher:async()=>{},disposeClipLibraryWatcher(){}};
        if(id.endsWith('/localAiRuntimeService'))return {bootstrapLocalAiRuntime(){},disposeLocalAiRuntime:async()=>{}};
        if(id.endsWith('/localAiSetupService'))return {bootstrapLocalAiSetup(){},disposeLocalAiSetupDownloads(){}};
        if(id.endsWith('/localMediaProtocol'))return {createLocalMediaResponse(){}};
        if(id.endsWith('/transcriptionService'))return {disposeTranscriptionProcesses:async()=>{}};
        if(id.endsWith('/registerHandlers'))return {registerIpcHandlers(){}};
      }
      return original.call(this,id,parent,...rest);
    };
    require('./dist/electron/main.js');`;
  const result = spawnSync(process.execPath, ["-e", script, root], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("actual startup interrupts abandoned jobs, preserves terminal jobs and reconciles uncertain uploads", () => {
  const queued = jobs.createJob({ workspaceId: "w", clipId: "c", jobType: "export" });
  const running = jobs.createJob({ workspaceId: "w", clipId: "c", jobType: "transcription" });
  jobs.updateJobStatus(running.id, "running");
  jobs.updateJobProgress(running.id, { cancellable: true, etaMs: 1200, etaBasis: "measured" });
  const completed = jobs.createJob({ workspaceId: "w", clipId: "c", jobType: "export" });
  jobs.updateJobStatus(completed.id, "completed");
  db.updateDatabase(store => store.scheduledPosts.push({ id: "post", clipId: "c", platform: "youtube", status: "posting",
    accountLabel: "test", publishAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  launchMain(false);
  assert.equal(jobs.listJobs().find(j => j.id === running.id).status, "running");
  launchMain();
  const state = db.readDatabase();
  assert.equal(state.jobs.find(j => j.id === queued.id).status, "interrupted");
  const interrupted = state.jobs.find(j => j.id === running.id);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.cancellable, false);
  assert.equal(interrupted.etaMs, null);
  assert.equal(state.jobs.find(j => j.id === completed.id).status, "completed");
  assert.equal(state.scheduledPosts[0].status, "reconciliation_required");
  launchMain();
  assert.deepEqual(db.readDatabase().jobs, state.jobs);
});

test("existing whitespace database is preserved and cannot be mutated into an empty store", () => {
  const file = db.getDatabaseContext().databasePath;
  fs.writeFileSync(file, " \r\n ");
  assert.throws(() => db.readDatabase(), /preserved/);
  assert.throws(() => db.updateDatabase(store => store.jobs.splice(0)), /preserved/);
  assert.equal(fs.readFileSync(file, "utf8"), " \r\n ");
});
