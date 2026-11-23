import type { ReactNode } from "react";
import InfoTip from "./InfoTip";
import {
  Card,
  Disclosure,
  Panel,
  ScrollArea,
  StatusBadge as WorkbenchStatusBadge,
} from "./WorkbenchPrimitives";

export type SettingsStatusTone = "ready" | "warning" | "error" | "editing" | "muted";

interface SettingsSectionProps {
  id: string;
  title: string;
  info?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({ id, title, info, status, children, className = "" }: SettingsSectionProps): JSX.Element {
  return (
    <Panel id={id} className={`settings-section ${className}`.trim()}>
      <div className="settings-section-heading">
        <div className="settings-section-title">
          <h2>{title}</h2>
          {info ? <InfoTip label={`${title} information`}>{info}</InfoTip> : null}
        </div>
        {status ? <div className="settings-section-status">{status}</div> : null}
      </div>
      <div className="settings-section-content">{children}</div>
    </Panel>
  );
}

export function SettingsCard({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return <Card className={`settings-card ${className}`.trim()}>{children}</Card>;
}

export function AdvancedDetails({ summary, children }: { summary: string; children: ReactNode }): JSX.Element {
  return (
    <Disclosure className="settings-advanced-details" summary={summary}>
      <div className="settings-advanced-content">{children}</div>
    </Disclosure>
  );
}

export function SettingRow({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-value">{value}</div>
      {action ? <div className="settings-row-action">{action}</div> : null}
    </div>
  );
}

export function StatusBadge({ tone = "muted", children }: { tone?: SettingsStatusTone; children: ReactNode }): JSX.Element {
  return (
    <WorkbenchStatusBadge className="settings-status-badge" tone={tone}>
      {children}
    </WorkbenchStatusBadge>
  );
}

export function ScrollableSettingsList({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return <ScrollArea className={`settings-scroll-list ${className}`.trim()}>{children}</ScrollArea>;
}
