import type { CreatorSetupEnvironment, LocalAiModelRecord, LocalAiRuntimeStatus } from "../shared/contracts";
import {
  getLocalAiSetupAsset,
  getLocalAiModelAssets,
  getLocalAiSetupRecommendation,
  type LocalAiSetupAsset,
  type LocalAiSetupAssetId,
  type LocalAiSetupProgress,
  type LocalAiSetupRecommendation
} from "../shared/localAiSetup";
import InfoTip from "./InfoTip";
import { AdvancedDetails, StatusBadge } from "./SettingsPrimitives";
import { Button } from "./WorkbenchPrimitives";

interface LocalAiSetupPanelProps {
  runtime: LocalAiRuntimeStatus | null;
  environment: CreatorSetupEnvironment | null;
  action: "refresh" | "import_runtime" | "clear_runtime" | "import_model" | "install_recommended" | null;
  progress: LocalAiSetupProgress | null;
  onRefresh: () => void;
  onImportRuntime: () => void;
  onImportModel: () => void;
  onClearRuntime: () => void;
  onDownloadAsset: (assetId: LocalAiSetupAssetId) => void;
  onInstallRecommended: (recommendation: LocalAiSetupRecommendation) => void;
  onCancelDownload: () => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "Size unavailable";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function getRuntimeStatusTone(runtime: LocalAiRuntimeStatus | null): "ready" | "warning" | "muted" {
  if (runtime?.health === "ready") {
    return "ready";
  }
  if (runtime?.health === "error") {
    return "warning";
  }
  return "muted";
}

function getModelName(model: LocalAiModelRecord): string {
  return model.compatibilityLabel ?? model.label;
}

function isCatalogModelInstalled(asset: LocalAiSetupAsset, runtime: LocalAiRuntimeStatus | null): boolean {
  const expectedFileNames = new Set(asset.downloads.map((download) => download.fileName));
  return Boolean(runtime?.availableModels.some((model) => expectedFileNames.has(model.fileName)));
}

function formatCapabilityLabel(asset: LocalAiSetupAsset): string {
  return asset.capabilities?.map((capability) => capability === "vision" ? "Vision" : "Text").join(" + ") ?? "Text";
}

function isDownloadBusy(progress: LocalAiSetupProgress | null): boolean {
  return progress?.status === "queued" || progress?.status === "downloading" || progress?.status === "verifying" || progress?.status === "installing";
}

export default function LocalAiSetupPanel({
  runtime,
  environment,
  action,
  progress,
  onRefresh,
  onImportRuntime,
  onImportModel,
  onClearRuntime,
  onDownloadAsset,
  onInstallRecommended,
  onCancelDownload
}: LocalAiSetupPanelProps): JSX.Element {
  const runtimeReady = Boolean(runtime?.executablePath);
  const modelReady = (runtime?.availableModels.length ?? 0) > 0;
  const setupReady = runtime?.health === "ready";
  const downloadBusy = isDownloadBusy(progress);
  const recommendation = getLocalAiSetupRecommendation(environment, runtime);
  const recommendedRuntime = getLocalAiSetupAsset(recommendation.runtimeId);
  const recommendedModel = getLocalAiSetupAsset(recommendation.modelId);
  const modelAssets = getLocalAiModelAssets();
  const recommendedModelInstalled = isCatalogModelInstalled(recommendedModel, runtime);
  const recommendedSetupInstalled = runtimeReady && recommendedModelInstalled;
  const progressAsset = progress ? getLocalAiSetupAsset(progress.assetId) : null;
  const activeProgress = progress && progressAsset && downloadBusy ? progress : null;
  const manualBusy = action !== null || downloadBusy;

  return (
    <section className="local-ai-setup-panel" aria-labelledby="local-ai-setup-title">
      <div className="local-ai-setup-header">
        <div>
          <div className="title-with-tip">
            <h3 id="local-ai-setup-title">Local AI setup</h3>
            <InfoTip label="About local AI setup">
              Follow the guided steps to install an app-owned runtime and model. Downloads come only from the curated official sources shown here and never begin without your action.
            </InfoTip>
          </div>
          <p className="settings-compact-helper">The app recommends a runtime for this computer, downloads it securely, and verifies it before use.</p>
        </div>
        <StatusBadge tone={getRuntimeStatusTone(runtime)}>{runtime?.statusLabel ?? "Checking..."}</StatusBadge>
      </div>

      <div className="local-ai-recommendation">
        <div className="local-ai-recommendation-heading">
          <div>
            <span className="local-ai-eyebrow">Recommended for this computer</span>
            <h4>{recommendedModel.label}</h4>
          </div>
          <StatusBadge tone={recommendedSetupInstalled ? "ready" : "warning"}>
            {recommendedSetupInstalled ? "Installed" : "Suggested"}
          </StatusBadge>
        </div>
        <p>{recommendation.reason} {recommendation.memoryDetail}</p>
        <div className="local-ai-recommendation-meta">
          <span>{recommendedRuntime.label}</span>
          <span>{formatCapabilityLabel(recommendedModel)}</span>
          <span>{formatBytes(recommendedModel.totalSizeBytes)} download</span>
        </div>
        <div className="local-ai-setup-actions">
          <Button
            type="button"
            variant="primary"
            compact
            className="primary-button compact-button"
            onClick={() => onInstallRecommended(recommendation)}
            disabled={manualBusy || recommendedSetupInstalled}
          >
            {action === "install_recommended" || downloadBusy ? "Installing recommended setup..." : recommendedSetupInstalled ? "Recommended setup installed" : "Install recommended setup"}
          </Button>
          <span className="local-ai-action-note">Runtime and model are installed only after you click.</span>
        </div>
      </div>

      <div className="local-ai-setup-steps">
        <article className={`local-ai-setup-step${runtimeReady ? " complete" : " current"}`}>
          <div className="local-ai-setup-step-number">1</div>
          <div className="local-ai-setup-step-content">
            <div className="local-ai-setup-step-heading">
              <div>
                <strong>Install runtime</strong>
                <span>{runtimeReady ? "App-owned runtime is available" : recommendedRuntime.label}</span>
              </div>
              <StatusBadge tone={runtimeReady ? "ready" : "warning"}>{runtimeReady ? "Ready" : "Required"}</StatusBadge>
            </div>
            <p>{runtimeReady ? "The complete llama.cpp runtime is managed privately by Creator Workbench." : `${recommendedRuntime.description} Download: ${formatBytes(recommendedRuntime.totalSizeBytes)}.`}</p>
            <div className="local-ai-setup-actions">
              <Button type="button" variant="primary" compact className="primary-button compact-button" onClick={() => onDownloadAsset(recommendation.runtimeId)} disabled={manualBusy}>
                {progress?.assetId === recommendation.runtimeId && downloadBusy ? "Installing..." : runtimeReady ? "Replace runtime" : "Install runtime"}
              </Button>
              <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onImportRuntime} disabled={manualBusy}>
                Import manually
              </Button>
              {runtimeReady ? (
                <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onClearRuntime} disabled={manualBusy}>
                  {action === "clear_runtime" ? "Clearing..." : "Clear runtime"}
                </Button>
              ) : null}
            </div>
          </div>
        </article>

        <article className={`local-ai-setup-step${modelReady ? " complete" : " current"}`}>
          <div className="local-ai-setup-step-number">2</div>
          <div className="local-ai-setup-step-content">
            <div className="local-ai-setup-step-heading">
              <div>
                <strong>Manage models</strong>
                <span>{modelReady ? `${runtime?.availableModels.length} managed model${runtime?.availableModels.length === 1 ? "" : "s"}` : recommendedModel.label}</span>
              </div>
              <StatusBadge tone={modelReady ? "ready" : "warning"}>{modelReady ? "Ready" : "Required"}</StatusBadge>
            </div>
            <p>{modelReady ? "Installed models stay available while you add alternatives below." : `${recommendedModel.description} The model licence is shown before installation.`}</p>
            {modelReady ? (
              <div className="local-ai-model-list" aria-label="Managed local AI models">
                {runtime?.availableModels.map((model) => (
                  <div className="local-ai-model-row" key={model.id}>
                    <span>{getModelName(model)}</span>
                    <span>{formatBytes(model.sizeBytes)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="detail-meta">Choose the preferred task model in the AI Profiles editor below, or install another curated option here.</p>
            <div className="local-ai-setup-actions">
              <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onImportModel} disabled={manualBusy}>
                Import manually
              </Button>
            </div>

            <div className="local-ai-model-catalog" aria-label="Curated local AI model catalogue">
              {modelAssets.map((asset) => {
                const installed = isCatalogModelInstalled(asset, runtime);
                const recommended = asset.id === recommendation.modelId;
                return (
                  <article className={`local-ai-model-card${recommended ? " recommended" : ""}`} key={asset.id}>
                    <div className="local-ai-model-card-heading">
                      <div>
                        <strong>{asset.label}</strong>
                        <span>{formatCapabilityLabel(asset)} · {asset.tier ?? "balanced"}</span>
                      </div>
                      <StatusBadge tone={installed ? "ready" : recommended ? "warning" : "muted"}>
                        {installed ? "Installed" : recommended ? "Recommended" : "Available"}
                      </StatusBadge>
                    </div>
                    <p>{asset.description}</p>
                    <div className="local-ai-model-card-meta">
                      <span>{formatBytes(asset.totalSizeBytes)}</span>
                      <span>{asset.taskLabels?.join(" · ") ?? "General local AI"}</span>
                    </div>
                    <div className="local-ai-setup-actions">
                      <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => onDownloadAsset(asset.id)} disabled={manualBusy || installed}>
                        {progress?.assetId === asset.id && downloadBusy ? "Downloading..." : installed ? "Installed" : recommended ? "Install recommendation" : "Install model"}
                      </Button>
                      <span className="local-ai-action-note">{asset.sourceLabel} · {asset.licenseLabel}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </article>

        <article className={`local-ai-setup-step${setupReady ? " complete" : " current"}`}>
          <div className="local-ai-setup-step-number">3</div>
          <div className="local-ai-setup-step-content">
            <div className="local-ai-setup-step-heading">
              <div>
                <strong>Verify setup</strong>
                <span>{setupReady ? "Ready for local AI tasks" : "Check after installation"}</span>
              </div>
              <StatusBadge tone={setupReady ? "ready" : "muted"}>{setupReady ? "Ready" : "Pending"}</StatusBadge>
            </div>
            <p>{runtime?.statusDetail ?? "Install a runtime and model, then verify the local setup."}</p>
            <div className="local-ai-setup-actions">
              <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onRefresh} disabled={manualBusy}>
                {action === "refresh" ? "Checking..." : "Check setup"}
              </Button>
            </div>
          </div>
        </article>
      </div>

      {activeProgress && progressAsset ? (
        <div className="local-ai-download-status" role="status" aria-live="polite">
          <div className="local-ai-download-heading">
            <strong>{progressAsset.label}</strong>
            <span>{activeProgress.percent === null ? activeProgress.status : `${activeProgress.percent}%`}</span>
          </div>
          <div className="local-ai-download-bar" aria-hidden="true"><span style={{ width: `${activeProgress.percent ?? 6}%` }} /></div>
          <div className="local-ai-download-meta">
            <span>{activeProgress.phase}</span>
            <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={onCancelDownload}>Cancel</Button>
          </div>
        </div>
      ) : progress?.status === "failed" ? (
        <div className="local-ai-download-status error" role="alert">
          <strong>Setup failed</strong>
          <span>{progress.errorMessage ?? "The setup download could not be completed."}</span>
        </div>
      ) : progress?.status === "cancelled" ? (
        <div className="local-ai-download-status warning" role="status">Setup cancelled. Retry when ready.</div>
      ) : progress?.status === "completed" ? (
        <div className="local-ai-download-status complete" role="status">{progress.message}.</div>
      ) : null}

      <div className="local-ai-setup-summary">
        <span className="local-ai-summary-item"><strong>GPU</strong>{environment?.hardware?.gpuName ?? runtime?.gpuSummary ?? "Not detected yet"}{environment?.hardware?.gpuMemoryBytes ? ` · ${formatBytes(environment.hardware.gpuMemoryBytes)} VRAM` : ""}</span>
        <span className="local-ai-summary-item"><strong>System memory</strong>{formatBytes(environment?.hardware?.systemMemoryBytes ?? null)}{environment?.hardware?.cpuCores ? ` · ${environment.hardware.cpuCores} CPU cores` : ""}</span>
        <span className="local-ai-summary-item"><strong>Free storage</strong>{formatBytes(environment?.freeSpaceBytes ?? null)}</span>
        <span className="local-ai-summary-item"><strong>Managed folder</strong>{runtime?.managedModelsDirectory ?? "Available after startup"}</span>
      </div>

      <AdvancedDetails summary="What the app manages">
        <ul className="local-ai-setup-details">
          <li>Runtime downloads are verified before the complete executable and DLL set replaces the managed runtime.</li>
          <li>Model downloads are staged and verified before they are copied into the managed model library.</li>
          <li>Runtime processes are app-owned and cleaned up when Creator Workbench closes.</li>
          <li>Manual import remains available for approved model versions, vision projectors, or offline installs.</li>
        </ul>
      </AdvancedDetails>

      <AdvancedDetails summary="Sources and licence information">
        <ul className="local-ai-setup-details">
          <li>{recommendedRuntime.sourceLabel}: {recommendedRuntime.licenseLabel}.</li>
          <li>{recommendedModel.sourceLabel}: {recommendedModel.licenseLabel}.</li>
          <li>Only curated, hash-verified model files are offered by the one-click installer. Manual imports remain separate.</li>
          <li>Large model downloads require enough free space for both the download and managed copy.</li>
        </ul>
      </AdvancedDetails>
    </section>
  );
}
