import { useEffect, useState } from "react";
import type {
  AppInfo, CreatorAppApi, ToolSettingKey, TranscriptionBackendPreference,
  WorkspaceAutomationSettingKey, WorkspaceFolderSettingKey
} from "../../shared/contracts";
import type { LocalAiSetupAssetId, LocalAiSetupProgress, LocalAiSetupRecommendation } from "../../shared/localAiSetup";

export type SettingsSetupApi = Pick<CreatorAppApi,
  "setAiStrictMode" | "refreshLocalAiRuntime" | "importLocalAiRuntimeExecutable" |
  "clearLocalAiRuntimeExecutable" | "importLocalAiModel" | "downloadLocalAiSetupAsset" |
  "installRecommendedLocalAiSetup" | "cancelLocalAiSetupDownload" | "configureToolPath" |
  "clearToolPath" | "setTranscriptionBackend" | "configureWorkspaceFolder" |
  "clearWorkspaceFolder" | "setWorkspaceAutomationSetting" | "onLocalAiSetupProgress">;

interface Options {
  onAppInfo: (info: AppInfo) => void;
  onError: (message: string | null) => void;
  api?: SettingsSetupApi;
}

/** Owns local setup operations; the shell distributes the returned application snapshot. */
export function useSettingsSetupWorkflow({ onAppInfo: setAppInfo, onError: setError, api = window.creatorApp }: Options) {
  const [configuringTool, setConfiguringTool] = useState<ToolSettingKey | null>(null);
  const [savingTranscriptionBackend, setSavingTranscriptionBackend] = useState(false);
  const [configuringFolder, setConfiguringFolder] = useState<WorkspaceFolderSettingKey | null>(null);
  const [configuringAutomation, setConfiguringAutomation] = useState<WorkspaceAutomationSettingKey | null>(null);
  const [savingStrictAiMode, setSavingStrictAiMode] = useState(false);
  const [localAiAction, setLocalAiAction] = useState<"refresh" | "import_runtime" | "clear_runtime" | "import_model" | "install_recommended" | null>(null);
  const [localAiSetupProgress, setLocalAiSetupProgress] = useState<LocalAiSetupProgress | null>(null);

  useEffect(() => {
    if (typeof api.onLocalAiSetupProgress !== "function") return;
    return api.onLocalAiSetupProgress(setLocalAiSetupProgress);
  }, [api]);

  async function handleSetAiStrictMode(enabled: boolean): Promise<void> {
    setSavingStrictAiMode(true);
    setError(null);

    try {
      const nextInfo = await api.setAiStrictMode(enabled);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update the Strict AI setting.");
    } finally {
      setSavingStrictAiMode(false);
    }
  }

  async function handleRefreshLocalAiRuntime(): Promise<void> {
    setLocalAiAction("refresh");
    setError(null);

    try {
      const nextInfo = await api.refreshLocalAiRuntime();
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh the local AI runtime state.");
    } finally {
      setLocalAiAction(null);
    }
  }

  async function handleImportLocalAiRuntimeExecutable(): Promise<void> {
    setLocalAiAction("import_runtime");
    setError(null);

    try {
      const nextInfo = await api.importLocalAiRuntimeExecutable();
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to import the local AI runtime.");
    } finally {
      setLocalAiAction(null);
    }
  }

  async function handleClearLocalAiRuntimeExecutable(): Promise<void> {
    setLocalAiAction("clear_runtime");
    setError(null);

    try {
      const nextInfo = await api.clearLocalAiRuntimeExecutable();
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear the local AI runtime.");
    } finally {
      setLocalAiAction(null);
    }
  }

  async function handleImportLocalAiModel(): Promise<void> {
    setLocalAiAction("import_model");
    setError(null);

    try {
      const nextInfo = await api.importLocalAiModel();
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to import the local AI model.");
    } finally {
      setLocalAiAction(null);
    }
  }

  async function handleDownloadLocalAiSetupAsset(assetId: LocalAiSetupAssetId): Promise<void> {
    setError(null);
    try {
      const nextInfo = await api.downloadLocalAiSetupAsset(assetId);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to download the local AI setup asset.");
    }
  }

  async function handleInstallRecommendedLocalAiSetup(recommendation: LocalAiSetupRecommendation): Promise<void> {
    setLocalAiAction("install_recommended");
    setError(null);

    try {
      const nextInfo = await api.installRecommendedLocalAiSetup(recommendation);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to install the recommended local AI setup.");
    } finally {
      setLocalAiAction(null);
    }
  }

  async function handleCancelLocalAiSetupDownload(): Promise<void> {
    if (!localAiSetupProgress) {
      return;
    }
    await api.cancelLocalAiSetupDownload(localAiSetupProgress.operationId).catch(() => false);
  }
  async function handleConfigureToolPath(tool: ToolSettingKey): Promise<void> {
    setConfiguringTool(tool);
    setError(null);

    try {
      const nextInfo = await api.configureToolPath(tool);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to configure local tool path.");
    } finally {
      setConfiguringTool(null);
    }
  }

  async function handleClearToolPath(tool: ToolSettingKey): Promise<void> {
    setConfiguringTool(tool);
    setError(null);

    try {
      const nextInfo = await api.clearToolPath(tool);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear local tool path.");
    } finally {
      setConfiguringTool(null);
    }
  }

  async function handleSetTranscriptionBackend(preference: TranscriptionBackendPreference): Promise<void> {
    setSavingTranscriptionBackend(true);
    setError(null);

    try {
      const nextInfo = await api.setTranscriptionBackend(preference);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update the transcription backend.");
    } finally {
      setSavingTranscriptionBackend(false);
    }
  }

  async function handleConfigureWorkspaceFolder(folder: WorkspaceFolderSettingKey): Promise<void> {
    setConfiguringFolder(folder);
    setError(null);

    try {
      const nextInfo = await api.configureWorkspaceFolder(folder);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to configure workspace folder.");
    } finally {
      setConfiguringFolder(null);
    }
  }

  async function handleClearWorkspaceFolder(folder: WorkspaceFolderSettingKey): Promise<void> {
    setConfiguringFolder(folder);
    setError(null);

    try {
      const nextInfo = await api.clearWorkspaceFolder(folder);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clear workspace folder.");
    } finally {
      setConfiguringFolder(null);
    }
  }

  async function handleSetWorkspaceAutomationSetting(
    setting: WorkspaceAutomationSettingKey,
    enabled: boolean
  ): Promise<void> {
    setConfiguringAutomation(setting);
    setError(null);

    try {
      const nextInfo = await api.setWorkspaceAutomationSetting(setting, enabled);
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update automation setting.");
    } finally {
      setConfiguringAutomation(null);
    }
  }



  return {
    configuringTool, savingTranscriptionBackend, configuringFolder, configuringAutomation,
    savingStrictAiMode, localAiAction, localAiSetupProgress,
    handleSetAiStrictMode, handleRefreshLocalAiRuntime, handleImportLocalAiRuntimeExecutable,
    handleClearLocalAiRuntimeExecutable, handleImportLocalAiModel, handleDownloadLocalAiSetupAsset,
    handleInstallRecommendedLocalAiSetup, handleCancelLocalAiSetupDownload,
    handleConfigureToolPath, handleClearToolPath, handleSetTranscriptionBackend,
    handleConfigureWorkspaceFolder, handleClearWorkspaceFolder, handleSetWorkspaceAutomationSetting
  };
}
