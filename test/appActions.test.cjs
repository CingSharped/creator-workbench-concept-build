const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APP_ACTION_DEFINITIONS,
  getAppActionDefinition
} = require("../dist/shared/appActions.js");
const {
  executeAppAction,
  registerAppActionHandler
} = require("../dist/electron/actions/appActionExecutor.js");

test("the action catalogue describes the core creator workflow", () => {
  assert.ok(APP_ACTION_DEFINITIONS.length >= 15);
  assert.equal(getAppActionDefinition("clips.generate_metadata").sideEffect, "local_write");
  assert.equal(getAppActionDefinition("performance.refresh_dashboard").sideEffect, "external_read");
  assert.equal(getAppActionDefinition("long_form.approve_proposal").requiresConfirmation, true);
});

test("the action executor rejects unknown actions and enforces confirmation", async () => {
  await assert.rejects(
    () => executeAppAction("not.a.real.action", {}, { source: "orchestrator", confirmed: true, sender: null }),
    /Unknown Creator Workbench action/
  );

  await assert.rejects(
    () => executeAppAction("long_form.approve_proposal", {}, { source: "orchestrator", confirmed: false, sender: null }),
    /requires user confirmation/
  );

  registerAppActionHandler("clips.import", async (input, context) => ({
    input,
    source: context.source,
    requestId: context.requestId,
    operationId: context.operationId
  }));
  const result = await executeAppAction(
    "clips.import",
    { filePaths: ["sample.mp4"] },
    { source: "orchestrator", confirmed: false, sender: null }
  );
  assert.deepEqual(result, {
    input: { filePaths: ["sample.mp4"] },
    source: "orchestrator",
    requestId: result.requestId,
    operationId: result.operationId
  });
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.match(result.operationId, /^[0-9a-f-]{36}$/);
});
