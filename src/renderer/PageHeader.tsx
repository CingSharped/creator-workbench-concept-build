import type { ReactNode } from "react";
import { WorkbenchIcon } from "./AppShell";
import { IconButton } from "./WorkbenchPrimitives";

interface PageHeaderProps {
  context: string;
  breadcrumb: string;
  title: string;
  kicker: string;
  info: ReactNode;
  actions: ReactNode;
  onRefresh: () => void;
  refreshing: boolean;
}

export default function PageHeader({
  context,
  breadcrumb,
  title,
  kicker,
  info,
  actions,
  onRefresh,
  refreshing
}: PageHeaderProps): JSX.Element {
  return (
    <header className="app-topbar">
      <div className="page-header-content">
        <div className="topbar-context">{context}</div>
        <section className="page-heading">
          <div>
            <div className="breadcrumb">{breadcrumb}</div>
            <div className="heading-row">
              <h1>{title}</h1>
              {info}
            </div>
            <p className="page-kicker">{kicker}</p>
          </div>
          <div className="page-actions">{actions}</div>
        </section>
      </div>
      <div className="topbar-actions">
        <IconButton
          type="button"
          className={`cw-icon-button icon-button app-refresh-button${refreshing ? " is-refreshing" : ""}`}
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh workspace data"
          aria-busy={refreshing}
          title="Refresh workspace data"
        >
          <WorkbenchIcon name="refresh" />
        </IconButton>
        <button type="button" className="avatar-chip" aria-label="Creator profile">C</button>
      </div>
    </header>
  );
}
