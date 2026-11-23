import type { CreatorSetupState, CreatorSetupItem } from "../shared/setupState";
import InfoTip from "./InfoTip";
import { Button, Panel, StatusBadge } from "./WorkbenchPrimitives";

interface SetupCardProps {
  state: CreatorSetupState;
  onOpenSettings: (sectionId: string) => void;
}

function getItemStatusLabel(item: CreatorSetupItem): string {
  if (item.status === "ready") {
    return "Ready";
  }
  if (item.status === "optional") {
    return "Optional";
  }
  return "Needs setup";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "Storage unavailable";
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

function formatPlatform(platform: string, architecture: string): string {
  const platformLabel = platform === "win32" ? "Windows" : platform;
  const architectureLabel = architecture === "x64" ? "x64" : architecture;
  return `${platformLabel} ${architectureLabel}`;
}

function getModelPackStatusLabel(status: CreatorSetupItem["status"]): string {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "optional") {
    return "Optional";
  }
  return "Download or import";
}

export default function SetupCard({ state, onOpenSettings }: SetupCardProps): JSX.Element {
  if (state.ready) {
    return (
      <Panel className="setup-card setup-card-ready" aria-label="Creator Workbench setup status">
        <div className="setup-card-heading">
          <div>
            <div className="title-with-tip">
              <h2>Creator Workbench is ready</h2>
              <InfoTip label="About setup status">
                Required workspace folders, local media tools, and at least one managed AI model are available. YouTube publishing remains optional.
              </InfoTip>
            </div>
            <p>Core media tools and managed models are ready. Choose the preferred model for each task in Local AI &amp; Profiles.</p>
          </div>
          <StatusBadge className="setup-status-badge" tone="ready">Ready</StatusBadge>
        </div>
        <div className="setup-card-actions">
          <Button type="button" variant="primary" compact className="primary-button compact-button" onClick={() => onOpenSettings("settings-local-ai")}>
            Configure AI profiles
          </Button>
          <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => onOpenSettings("settings-storage")}>
            Workspace folders
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="setup-card" aria-labelledby="setup-card-title">
      <div className="setup-card-heading">
        <div>
          <div className="title-with-tip">
            <h2 id="setup-card-title">Set up your local workspace</h2>
            <InfoTip label="About first-run setup">
              Setup is optional and can be resumed from Settings. The app will not download files, scan media, or contact YouTube until you choose an action.
            </InfoTip>
          </div>
          <p>{state.requiredItemsReady} of {state.requiredItemsTotal} required areas ready. The app will not download large models until you choose them.</p>
        </div>
        <StatusBadge className="setup-status-badge" tone="warning">Needs setup</StatusBadge>
      </div>
      <div className="setup-item-grid">
        {state.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`setup-item setup-item-${item.status}`}
            onClick={() => onOpenSettings(item.settingsSectionId)}
          >
            <span className="setup-item-topline">
              <strong>{item.label}</strong>
              <span className="setup-item-status">{getItemStatusLabel(item)}</span>
            </span>
            <span className="setup-item-detail">{item.detail}</span>
            <span className="setup-item-action">{item.status === "optional" ? "Configure later" : "Open setup"}</span>
          </button>
        ))}
      </div>
      <div className="setup-environment-summary" aria-label="This computer setup summary">
        <span>{formatPlatform(state.environment.platform, state.environment.architecture)}</span>
        <span>{state.environment.freeSpaceBytes === null ? "Free storage unavailable" : `${formatBytes(state.environment.freeSpaceBytes)} free on ${state.environment.storageRoot}`}</span>
        <span>GPU details appear in Local AI</span>
      </div>
      <div className="setup-model-pack-section">
        <div className="title-with-tip">
          <h3>Large AI model packs</h3>
          <InfoTip label="About model packs">
            Models remain outside the application installer so application updates stay small. Choose or import only the packs you want, and never download a model without an explicit action.
          </InfoTip>
        </div>
        <div className="setup-model-pack-grid">
          {state.modelPacks.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className={`setup-model-pack setup-model-pack-${pack.status}`}
              onClick={() => onOpenSettings("settings-local-ai")}
            >
              <span className="setup-item-topline">
                <strong>{pack.label}</strong>
                <span className="setup-item-status">{getModelPackStatusLabel(pack.status)}</span>
              </span>
              <span className="setup-item-detail">{pack.detail}</span>
              <span className="setup-model-pack-size">{pack.sizeHint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="setup-card-footer">
        <p className="setup-card-note">Core media tools are packaged with supported builds. Local AI models stay separate so updates do not redownload multi-gigabyte files.</p>
        <Button type="button" variant="primary" compact className="primary-button compact-button" onClick={() => onOpenSettings("settings-local-ai")}>
          Choose AI models
        </Button>
      </div>
    </Panel>
  );
}
