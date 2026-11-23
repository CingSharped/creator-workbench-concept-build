import type {
  WorkspaceAutomationSettingKey,
  WorkspaceFolderSettingKey
} from "../../shared/contracts";
import { clearAppSetting, getAppSetting, setAppSetting } from "./settingsRepository";

const WORKSPACE_FOLDER_SETTING_KEYS: Record<WorkspaceFolderSettingKey, string> = {
  clipLibrary: "folder.clip_library_path",
  longFormSourceLibrary: "folder.long_form_source_library_path",
  srtOutput: "folder.srt_output_path"
};

const WORKSPACE_AUTOMATION_SETTING_KEYS: Record<WorkspaceAutomationSettingKey, string> = {
  watchClipLibrary: "automation.watch_clip_library",
  autoTranscribeOnImport: "automation.auto_transcribe_on_import"
};

export function getWorkspaceFolderSetting(folder: WorkspaceFolderSettingKey): string | null {
  const value = getAppSetting(WORKSPACE_FOLDER_SETTING_KEYS[folder])?.trim();
  return value ? value : null;
}

export function setWorkspaceFolderSetting(folder: WorkspaceFolderSettingKey, value: string): void {
  setAppSetting(WORKSPACE_FOLDER_SETTING_KEYS[folder], value);
}

export function clearWorkspaceFolderSetting(folder: WorkspaceFolderSettingKey): void {
  clearAppSetting(WORKSPACE_FOLDER_SETTING_KEYS[folder]);
}

export function getWorkspaceAutomationSetting(setting: WorkspaceAutomationSettingKey): boolean {
  return getAppSetting(WORKSPACE_AUTOMATION_SETTING_KEYS[setting]) === "true";
}

export function setWorkspaceAutomationSetting(
  setting: WorkspaceAutomationSettingKey,
  enabled: boolean
): void {
  setAppSetting(WORKSPACE_AUTOMATION_SETTING_KEYS[setting], enabled ? "true" : "false");
}
