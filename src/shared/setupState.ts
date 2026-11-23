import type { AppInfo, CreatorSetupEnvironment, YouTubeConnectionStatus } from "./contracts";

export type CreatorSetupItemId = "workspace" | "tools" | "local_ai" | "youtube";
export type CreatorSetupItemStatus = "ready" | "needs_setup" | "optional";
export type CreatorModelPackId = "text_generation" | "quality_transcription" | "vision_review";

export interface CreatorSetupItem {
  id: CreatorSetupItemId;
  label: string;
  status: CreatorSetupItemStatus;
  detail: string;
  settingsSectionId: string;
}

export interface CreatorModelPackStatus {
  id: CreatorModelPackId;
  label: string;
  status: CreatorSetupItemStatus;
  detail: string;
  sizeHint: string;
}

export interface CreatorSetupState {
  ready: boolean;
  requiredItemsReady: number;
  requiredItemsTotal: number;
  items: CreatorSetupItem[];
  modelPacks: CreatorModelPackStatus[];
  environment: CreatorSetupEnvironment;
}

export function deriveCreatorSetupState(
  appInfo: AppInfo,
  youtubeConnection: YouTubeConnectionStatus | null
): CreatorSetupState {
  const missingFolders = [
    appInfo.clipLibraryFolder ? null : "Clip Library",
    appInfo.longFormSourceLibraryFolder ? null : "Long-form",
    appInfo.srtOutputFolder ? null : "SRT output"
  ].filter((label): label is string => label !== null);

  const toolsReady =
    appInfo.ffmpeg.available &&
    appInfo.ffprobe.available &&
    appInfo.whisper.available &&
    appInfo.whisperModel.available;
  const aiReady = appInfo.localAiRuntime.health === "ready" && appInfo.localAiRuntime.availableModels.length > 0;
  const modelPacks: CreatorModelPackStatus[] = [
    {
      id: "text_generation",
      label: "Text generation",
      status: appInfo.localAiRuntime.availableModels.length > 0 ? "ready" : "needs_setup",
      detail: appInfo.localAiRuntime.availableModels.length > 0
        ? `${appInfo.localAiRuntime.availableModels.length} GGUF model${appInfo.localAiRuntime.availableModels.length === 1 ? "" : "s"} available.`
        : "Choose at least one instruct GGUF model for metadata, thumbnails, and clip proposals.",
      sizeHint: "Usually several GB"
    },
    {
      id: "quality_transcription",
      label: "High-quality transcription",
      status: appInfo.transcriptionRuntime.cudaModel.available ? "ready" : "needs_setup",
      detail: appInfo.transcriptionRuntime.cudaModel.available
        ? "A CUDA Whisper model is available."
        : "Optional large-v3-turbo improves long-form transcription quality.",
      sizeHint: "About 1.6 GB"
    },
    {
      id: "vision_review",
      label: "Vision review",
      status: "optional",
      detail: "Optional Qwen-VL model and matching projector for visual proposal evidence.",
      sizeHint: "Model plus projector"
    }
  ];

  const items: CreatorSetupItem[] = [
    {
      id: "workspace",
      label: "Workspace folders",
      status: missingFolders.length === 0 ? "ready" : "needs_setup",
      detail: missingFolders.length === 0 ? "Media folders are configured." : `Choose ${missingFolders.join(", ")}.`,
      settingsSectionId: "settings-storage"
    },
    {
      id: "tools",
      label: "Media tools",
      status: toolsReady ? "ready" : "needs_setup",
      detail: toolsReady
        ? [appInfo.ffmpeg.source, appInfo.ffprobe.source, appInfo.whisper.source, appInfo.whisperModel.source].includes("bundled")
          ? "Core FFmpeg and CPU Whisper tools are bundled with this app."
          : "FFmpeg and Whisper are available."
        : "Core media tools or the Whisper model are missing from this installation.",
      settingsSectionId: "settings-local-ai"
    },
    {
      id: "local_ai",
      label: "Local AI",
      status: aiReady ? "ready" : "needs_setup",
      detail: aiReady ? `${appInfo.localAiRuntime.availableModels.length} managed model${appInfo.localAiRuntime.availableModels.length === 1 ? "" : "s"} available.` : "Install a managed runtime and model before generating locally.",
      settingsSectionId: "settings-local-ai"
    },
    {
      id: "youtube",
      label: "YouTube publishing",
      status: youtubeConnection?.connected ? "ready" : "optional",
      detail: youtubeConnection?.connected ? `Connected to ${youtubeConnection.channelTitle ?? "YouTube"}.` : "Optional until you schedule or publish.",
      settingsSectionId: "settings-publishing"
    }
  ];

  const requiredItems = items.filter((item) => item.id !== "youtube");
  const requiredItemsReady = requiredItems.filter((item) => item.status === "ready").length;

  return {
    ready: requiredItemsReady === requiredItems.length,
    requiredItemsReady,
    requiredItemsTotal: requiredItems.length,
    items,
    modelPacks,
    environment: appInfo.setupEnvironment
  };
}
