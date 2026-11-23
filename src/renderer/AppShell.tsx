import { useEffect, useState, type ReactNode } from "react";
import AiActivityQueue from "./AiActivityQueue";
import "./aiActivity.css";

export type WorkbenchView = "workspace" | "review" | "performance" | "settings";

interface AppShellProps {
  activeView: WorkbenchView;
  indexedClipCount: number;
  onViewChange: (view: WorkbenchView) => void;
  children: ReactNode;
}

interface NavigationItem {
  view: WorkbenchView;
  label: string;
  icon: "workspace" | "make" | "performance";
}

const NAVIGATION_ITEMS: NavigationItem[] = [
  { view: "review", label: "Make", icon: "make" },
  { view: "workspace", label: "Edit", icon: "workspace" },
  { view: "performance", label: "Performance", icon: "performance" }
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "creator-workspace.sidebar-collapsed";

export default function AppShell({
  activeView,
  indexedClipCount,
  onViewChange,
  children
}: AppShellProps): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Sidebar preference is best-effort if renderer storage is unavailable.
    }
  }, [sidebarCollapsed]);

  return (
    <main className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <div className="sidebar-head">
          <button
            type="button"
            className="brand-lockup"
            onClick={() => onViewChange("workspace")}
            aria-label="Open Creator Workbench Edit workflow"
          >
            <span className="brand-mark" aria-hidden="true">
              <WorkbenchIcon name="workspace" />
            </span>
            <span className="brand-copy">
              <strong>Creator Workbench</strong>
              <small>LOCAL CREATOR TOOLS</small>
            </span>
          </button>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span aria-hidden="true">{sidebarCollapsed ? ">" : "<"}</span>
            <span className="sidebar-toggle-label">{sidebarCollapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {NAVIGATION_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`primary-nav-button${activeView === item.view ? " active" : ""}`}
              onClick={() => onViewChange(item.view)}
              aria-current={activeView === item.view ? "page" : undefined}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                <WorkbenchIcon name={item.icon} />
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <AiActivityQueue collapsed={sidebarCollapsed} onExpand={() => setSidebarCollapsed(false)} />

        <div className="sidebar-footer">
          <span className="local-status">
            <span className="status-dot" aria-hidden="true" />
            <span className="sidebar-nav-label">Local workspace</span>
          </span>
          <div className="sidebar-storage-card">
            <strong>{indexedClipCount} indexed clips</strong>
            <span>Source files stay on this machine.</span>
            <button type="button" className="sidebar-storage-link" onClick={() => onViewChange("settings")}>
              Manage storage
            </button>
          </div>
          <button type="button" className="sidebar-settings-link" onClick={() => onViewChange("settings")}>
            <span className="sidebar-nav-icon" aria-hidden="true">
              <WorkbenchIcon name="settings" />
            </span>
            <span className="sidebar-nav-label">Settings</span>
          </button>
        </div>
      </aside>

      <div className="app-main">{children}</div>
    </main>
  );
}

export function WorkbenchIcon({ name }: { name: NavigationItem["icon"] | "settings" | "refresh" }): JSX.Element {
  if (name === "make") {
    return (
      <svg viewBox="0 0 24 24" role="presentation" focusable="false">
        <path d="M7 4 20 17l-3 3L4 7V4h3Z" />
        <path d="m14 4 3 3M4 17l3 3" />
      </svg>
    );
  }

  if (name === "performance") {
    return (
      <svg viewBox="0 0 24 24" role="presentation" focusable="false">
        <path d="M4 19V5M4 19h16" />
        <path d="m7 15 4-4 3 2 5-7" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" role="presentation" focusable="false">
        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
        <path d="m19 13.5 1.2 1-.9 1.6-1.5-.5a7.8 7.8 0 0 1-1.5 1.1l-.2 1.6h-1.9l-.4-1.5a7.3 7.3 0 0 1-1.8.1l-.8 1.4-1.7-.8.4-1.5a7.8 7.8 0 0 1-1.5-1.2l-1.5.5-.9-1.6 1.2-1a7.4 7.4 0 0 1 0-1.9l-1.2-1 .9-1.6 1.5.5A7.8 7.8 0 0 1 9.8 8l-.4-1.5 1.7-.8.8 1.4a7.3 7.3 0 0 1 1.8.1l.4-1.5H16l.2 1.6a7.8 7.8 0 0 1 1.5 1.1l1.5-.5.9 1.6-1.2 1a7.4 7.4 0 0 1 .1 1.9Z" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg viewBox="0 0 24 24" role="presentation" focusable="false">
        <path d="M20 11a8 8 0 0 0-14.6-4L4 9" />
        <path d="M4 5v4h4" />
        <path d="M4 13a8 8 0 0 0 14.6 4L20 15" />
        <path d="M20 19v-4h-4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" role="presentation" focusable="false">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}
