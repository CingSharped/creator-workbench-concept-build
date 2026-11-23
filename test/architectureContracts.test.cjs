const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const { APP_ACTION_DEFINITIONS } = require("../dist/shared/appActions.js");

const projectRoot = path.resolve(__dirname, "..");
const actionRegistrationSource = fs.readFileSync(
  path.join(projectRoot, "src", "electron", "actions", "registerCreatorWorkflowActions.ts"),
  "utf8"
) + fs.readFileSync(path.join(projectRoot, "src", "electron", "actions", "registerRemainingActions.ts"), "utf8");
const preloadSource = fs.readFileSync(
  path.join(projectRoot, "src", "electron", "preload.ts"),
  "utf8"
);
const ipcSource = fs.readFileSync(
  path.join(projectRoot, "src", "electron", "ipc", "registerHandlers.ts"),
  "utf8"
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("every catalogue action has one registered creator-workflow handler", () => {
  for (const definition of APP_ACTION_DEFINITIONS) {
    const pattern = new RegExp(
      `registerAppActionHandler\\(\\"${escapeRegExp(definition.id)}\\"`
    );
    assert.match(
      actionRegistrationSource,
      pattern,
      `Missing handler registration for ${definition.id}`
    );
  }
});

test("IPC adapters import read services and delegate mutations to application actions", () => {
  const source = ts.createSourceFile("registerHandlers.ts", ipcSource, ts.ScriptTarget.Latest, true);
  const mutations = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier.text.includes("/services/")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text;
      if (/^(save|set|clear|import|capture|remove|record|download|install|export|refresh|upsert|publish|connect|disconnect|cancel|update|create|delete|approve|reject|reopen|transcribe|generate)/.test(name)) mutations.push(name);
    }
  }
  assert.deepEqual(mutations, [], "Native dialogs and reads stay in IPC; writes belong to actions.");
});

test("preload keeps the action-backed mutation routes on the action executor", () => {
  const expectedRoutes = {
    transcribeLongFormSource: "long_form.transcribe",
    generateLongFormClipProposals: "long_form.generate_proposals",
    approveLongFormClipProposal: "long_form.approve_proposal",
    rejectLongFormClipProposal: "long_form.reject_proposal",
    generateClipMetadataCandidates: "clips.generate_metadata",
    saveClipMetadata: "clips.save_metadata",
    updateTranscript: "transcripts.update",
    autoAssignTranscriptSpeakers: "transcripts.auto_assign_speakers",
    retryYouTubeCaptions: "scheduled_posts.retry_captions",
    reconcileYouTubeUpload: "scheduled_posts.reconcile",
    createScheduledPost: "scheduled_posts.create",
    refreshPerformanceDashboard: "performance.refresh_dashboard"
  };

  for (const [method, actionId] of Object.entries(expectedRoutes)) {
    const pattern = new RegExp(
      `${escapeRegExp(method)}[\\s\\S]{0,500}executeCreatorAction\\(\\"${escapeRegExp(actionId)}\\"`
    );
    assert.match(
      preloadSource,
      pattern,
      `${method} no longer routes through ${actionId}`
    );
  }
});

test("preload exposes the action catalogue and generic executor for future orchestration", () => {
  assert.match(preloadSource, /getActionDefinitions:\s*\(\)\s*=>\s*APP_ACTION_DEFINITIONS/);
  assert.match(preloadSource, /executeAction:\s*<T\s*=\s*unknown>/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\(\"creatorApp\", api\)/);
});

test("legacy mutation channels delegate to the canonical action executor", () => {
  const expectedAdapters = [
    ["tools:configure-path", "settings.set_tool_path"],
    ["tools:clear-path", "settings.clear_tool_path"],
    ["transcription:set-backend", "settings.set_transcription_backend"],
    ["folders:configure", "settings.set_folder"],
    ["folders:clear", "settings.clear_folder"],
    ["automation:set", "settings.set_automation"],
    ["creator-profile-links:save", "profiles.save_creator_links"],
    ["creator-voice-samples:capture", "profiles.capture_creator_sample"],
    ["voice-profile-samples:record", "profiles.record_voice_sample"],
    ["creator-voice-samples:remove", "profiles.remove_creator_sample"],
    ["collaborator-profiles:save", "profiles.save_collaborators"],
    ["ai-profiles:save", "profiles.save_ai"],
    ["ai:set-strict-mode", "settings.set_strict_ai"],
    ["ai:download-setup-asset", "ai.download_setup_asset"],
    ["ai:install-recommended-setup", "ai.install_recommended_setup"],
    ["ai:cancel-setup-download", "ai.cancel_setup_download"],
    ["ai:import-local-runtime-executable", "ai.import_runtime"],
    ["ai:clear-local-runtime-executable", "ai.clear_runtime"],
    ["ai:import-local-model", "ai.import_model"],
    ["collaborator-voice-samples:capture", "profiles.capture_collaborator_sample"],
    ["collaborator-voice-samples:remove", "profiles.remove_collaborator_sample"],
    ["youtube:save-credentials", "youtube.save_credentials"],
    ["youtube:clear-credentials", "youtube.clear_credentials"],
    ["youtube:connect", "youtube.connect"],
    ["youtube:disconnect", "youtube.disconnect"],
    ["youtube-performance:refresh", "performance.refresh_post"],
    ["clips:clear-workspace-indexes", "clips.clear_workspace_indexes"],
    ["clips:export-stacked-vertical", "clips.export_stacked_vertical"],
    ["long-form:export-trimmed", "long_form.export_trimmed"],
    ["long-form:export-stacked-vertical", "long_form.export_stacked_vertical"],
    ["transcripts:export-srt", "transcripts.export_srt"],
    ["ai:activity:cancel", "ai.cancel_activity"],
    ["clips:generate-metadata-candidates", "clips.generate_metadata"],
    ["clips:save-metadata", "clips.save_metadata"],
    ["performance:refresh-dashboard", "performance.refresh_dashboard"],
    ["performance:import-youtube-history", "performance.import_youtube_history"],
    ["clips:record-metadata-feedback", "metadata.record_feedback"],
    ["clips:import", "clips.import"],
    ["clips:remove-from-workspace", "clips.remove_from_workspace"],
    ["clips:delete-app-data", "clips.delete_app_data"],
    ["long-form:transcribe", "long_form.transcribe"],
    ["long-form:transcription-cancel", "long_form.cancel_transcription"],
    ["long-form:partial-save", "long_form.save_partial_transcript"],
    ["long-form:partial-discard", "long_form.discard_partial_transcript"],
    ["long-form:proposals:generate", "long_form.generate_proposals"],
    ["long-form:proposals:cancel", "long_form.cancel_proposals"],
    ["long-form:proposals:approve", "long_form.approve_proposal"],
    ["long-form:proposals:reject", "long_form.reject_proposal"],
    ["long-form:proposals:reopen", "long_form.reopen_proposal"],
    ["scheduled-posts:create", "scheduled_posts.create"],
    ["clips:transcribe", "clips.transcribe"],
    ["transcripts:update", "transcripts.update"],
    ["transcripts:auto-assign-speakers", "transcripts.auto_assign_speakers"],
    ["scheduled-posts:refresh-statuses", "scheduled_posts.refresh_statuses"],
    ["data-management:scan", "data_management.scan"],
    ["data-management:clear-clip-library", "data_management.clear_clip_library"],
    ["data-management:clear-long-form", "data_management.clear_long_form"],
    ["data-management:cleanup-orphans", "data_management.cleanup_orphans"],
    ["ui:save-vertical-layout-preferences", "ui.save_vertical_layout_preferences"]
  ];

  for (const [channel, actionId] of expectedAdapters) {
    const channelStart = ipcSource.indexOf(`\"${channel}\"`);
    assert.notEqual(channelStart, -1, `Missing compatibility channel ${channel}`);
    const channelBody = ipcSource.slice(channelStart, channelStart + 1800);
    assert.match(
      channelBody,
      new RegExp(`executeLegacyAction\\([\\s\\S]{0,500}\"${escapeRegExp(actionId)}\"`),
      `${channel} does not delegate to ${actionId}`
    );
  }
});
