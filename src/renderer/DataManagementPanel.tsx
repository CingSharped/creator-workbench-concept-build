import { useEffect, useState } from "react";
import type {
  DataHealthCategory,
  DataHealthIssue,
  DataHealthScanResult,
  DataManagementSummary
} from "../shared/contracts";
import InfoTip from "./InfoTip";
import ConfirmActionDialog from "./ConfirmActionDialog";
import { Card, Panel, PanelHeader } from "./WorkbenchPrimitives";

type ConfirmAction = "clip" | "long_form" | "cleanup" | null;

interface DataManagementPanelProps {
  summary: DataManagementSummary | null;
  scan: DataHealthScanResult | null;
  busy: "scan" | "clip" | "long_form" | "cleanup" | null;
  message: string | null;
  onScan: () => void;
  onClearClipLibrary: () => void;
  onClearLongForm: () => void;
  onCleanup: (issueIds: string[]) => void;
}

const CATEGORY_LABELS: Record<DataHealthCategory, string> = {
  invalid_record: "Invalid records",
  broken_reference: "Broken references",
  historical_unlinked: "Historical but unlinked",
  missing_source_file: "Missing source files",
  duplicate_source_path: "Duplicate source paths",
  completed_job_without_owner: "Completed jobs without an owner"
};

export default function DataManagementPanel({
  summary,
  scan,
  busy,
  message,
  onScan,
  onClearClipLibrary,
  onClearLongForm,
  onCleanup
}: DataManagementPanelProps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [activeCategories, setActiveCategories] = useState<DataHealthCategory[]>([]);
  const actionableIssues = scan?.issues.filter((issue) => issue.safeToDelete) ?? [];
  const protectedIssues = scan?.issues.filter((issue) => !issue.safeToDelete) ?? [];
  const categoryFilterActive = activeCategories.length > 0;
  const visibleActionableIssues = categoryFilterActive
    ? actionableIssues.filter((issue) => activeCategories.includes(issue.category))
    : actionableIssues;
  const visibleProtectedIssues = categoryFilterActive
    ? protectedIssues.filter((issue) => activeCategories.includes(issue.category))
    : protectedIssues;

  useEffect(() => {
    const safeIssueIds = new Set(actionableIssues.map((issue) => issue.id));
    setSelectedIssueIds((current) => current.filter((issueId) => safeIssueIds.has(issueId)));
  }, [scan]);

  useEffect(() => {
    const availableCategories = new Set(scan?.issues.map((issue) => issue.category) ?? []);
    setActiveCategories((current) => current.filter((category) => availableCategories.has(category)));
  }, [scan]);

  const toggleIssue = (issue: DataHealthIssue) => {
    if (!issue.safeToDelete) return;
    setSelectedIssueIds((current) => current.includes(issue.id)
      ? current.filter((id) => id !== issue.id)
      : [...current, issue.id]);
  };

  const bulkSelectableIssues = visibleActionableIssues.filter((issue) => !issue.reviewRequired);
  const allSafeIssuesSelected = bulkSelectableIssues.length > 0 && bulkSelectableIssues.every((issue) => selectedIssueIds.includes(issue.id));

  const toggleSelectAll = () => {
    setSelectedIssueIds(allSafeIssuesSelected
      ? selectedIssueIds.filter((issueId) => !bulkSelectableIssues.some((issue) => issue.id === issueId))
      : [...new Set([...selectedIssueIds, ...bulkSelectableIssues.map((issue) => issue.id)])]);
  };

  const toggleCategory = (category: DataHealthCategory) => {
    setSelectedIssueIds([]);
    setActiveCategories((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : [...current, category]);
  };

  const confirm = () => {
    if (confirmAction === "clip") onClearLibraryAndClose();
    if (confirmAction === "long_form") onClearLongFormAndClose();
    if (confirmAction === "cleanup") {
      onCleanup(selectedIssueIds);
      setConfirmAction(null);
      setSelectedIssueIds([]);
    }
  };

  const onClearLibraryAndClose = () => {
    onClearClipLibrary();
    setConfirmAction(null);
  };

  const onClearLongFormAndClose = () => {
    onClearLongForm();
    setConfirmAction(null);
  };

  return (
    <Panel className="panel data-management-panel" id="settings-data-management">
      <PanelHeader className="panel-header">
        <div>
          <div className="title-with-tip">
            <h2>Data Management</h2>
            <InfoTip label="Data Management">Active indexes control what appears in the workspace. Archive actions hide records without deleting source files or workflow history.</InfoTip>
          </div>
          <p className="muted">Manage active indexes separately from the history that helps the workflow and AI improve.</p>
        </div>
        <span className="panel-badge">Local only</span>
      </PanelHeader>

      <div className="data-management-overview">
        <DataMetric label="Active clips" value={summary?.activeClipLibraryCount ?? "—"} />
        <DataMetric label="Active long-form" value={summary?.activeLongFormSourceCount ?? "—"} />
        <DataMetric label="Preserved history" value={summary?.preservedHistoryCount ?? "—"} />
        <DataMetric label="Orphaned records" value={summary?.orphanedRecordCount ?? "—"} />
      </div>

      <div className="data-management-index-grid">
        <Card className="data-management-action-card">
          <div>
            <h3>Clip Library index</h3>
            <p className="muted">Hide active clips from the Clip Library view. Video files, transcripts, metadata, schedules, performance, jobs, and feedback remain preserved.</p>
          </div>
          <button className="secondary-button" type="button" disabled={!summary?.activeClipLibraryCount || busy !== null} onClick={() => setConfirmAction("clip")}>
            {busy === "clip" ? "Clearing..." : "Clear Clip Library index"}
          </button>
        </Card>
        <Card className="data-management-action-card">
          <div>
            <h3>Long-form index</h3>
            <p className="muted">Hide active sources from Make Clips. Original videos, transcripts, proposals, decisions, and approved clips remain preserved.</p>
          </div>
          <button className="secondary-button" type="button" disabled={!summary?.activeLongFormSourceCount || busy !== null} onClick={() => setConfirmAction("long_form")}>
            {busy === "long_form" ? "Clearing..." : "Clear Long-form index"}
          </button>
        </Card>
      </div>

      <div className="data-management-health">
        <div className="data-management-health-header">
          <div>
            <div className="title-with-tip"><h3>Data health</h3><InfoTip label="Data health">Scanning is read-only. Useful historical feedback and missing files are reported, not automatically deleted.</InfoTip></div>
            <p className="muted">Find broken references and review safe cleanup candidates before any permanent database deletion.</p>
          </div>
          <button className="secondary-button compact-button" type="button" disabled={busy !== null} onClick={onScan}>
            {busy === "scan" ? "Scanning..." : "Scan for orphaned data"}
          </button>
        </div>
        {scan ? (
          <>
            <div className="data-health-summary">
              <span>Last scan {new Date(scan.scannedAt).toLocaleString()}</span>
              <span>{scan.issues.length} record{scan.issues.length === 1 ? "" : "s"} reported</span>
            </div>
            <div className="data-health-categories">
              {(Object.keys(CATEGORY_LABELS) as DataHealthCategory[]).map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`data-health-category${activeCategories.includes(category) ? " active" : ""}`}
                  aria-pressed={activeCategories.includes(category)}
                  onClick={() => toggleCategory(category)}
                >
                  {CATEGORY_LABELS[category]}: <strong>{scan.categoryCounts[category]}</strong>
                </button>
              ))}
            </div>
            {categoryFilterActive ? (
              <div className="data-health-filter-summary">
                <span className="muted">Showing: {activeCategories.map((category) => CATEGORY_LABELS[category]).join(", ")}</span>
                <button className="secondary-button compact-button" type="button" onClick={() => { setActiveCategories([]); setSelectedIssueIds([]); }}>
                  Clear filters
                </button>
              </div>
            ) : null}
            {visibleActionableIssues.length > 0 ? (
              <div className="data-health-selection-actions">
                <span className="muted">{selectedIssueIds.length} of {visibleActionableIssues.length} visible eligible record{visibleActionableIssues.length === 1 ? "" : "s"} selected</span>
                {bulkSelectableIssues.length > 0 ? (
                  <button className="secondary-button compact-button" type="button" onClick={toggleSelectAll}>
                    {allSafeIssuesSelected ? "Clear selection" : "Select all visible safe"}
                  </button>
                ) : <span className="muted">Review duplicates individually.</span>}
              </div>
            ) : null}
            {visibleActionableIssues.length > 0 ? (
              <div className="data-health-issue-group">
                <h4>Cleanup candidates</h4>
                <div className="data-health-issue-list">
                  {visibleActionableIssues.map((issue) => (
                <div
                  key={issue.id}
                  className={`data-health-issue selectable${selectedIssueIds.includes(issue.id) ? " selected" : ""}`}
                  role="checkbox"
                  aria-checked={selectedIssueIds.includes(issue.id)}
                  tabIndex={0}
                  onClick={() => toggleIssue(issue)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleIssue(issue);
                    }
                  }}
                >
                  <span className="data-health-issue-indicator" aria-hidden="true">{selectedIssueIds.includes(issue.id) ? "Selected" : issue.reviewRequired ? "Review" : "Eligible"}</span>
                  <span>
                    <strong>{issue.label}</strong>
                    <small>{issue.detail}</small>
                    <small>{issue.reviewRequired ? "Review required: choose which duplicate to remove; the remaining record keeps the history." : "Eligible after review and backup."}</small>
                  </span>
                </div>
                  ))}
                </div>
                <button className="danger-button compact-button" type="button" disabled={selectedIssueIds.length === 0 || busy !== null} onClick={() => setConfirmAction("cleanup")}>
                  Delete selected records
                </button>
              </div>
            ) : null}
            {visibleProtectedIssues.length > 0 ? (
              <details className="cw-disclosure data-health-protected-details">
                <summary>Protected information ({visibleProtectedIssues.length})</summary>
                <p className="muted">These records are shown for information only. They are retained history and cannot be selected for permanent cleanup.</p>
                <div className="data-health-issue-list">
                  {visibleProtectedIssues.map((issue) => (
                    <div key={issue.id} className="data-health-issue protected" aria-disabled="true">
                      <span className="data-health-issue-indicator" aria-hidden="true">Protected</span>
                      <span>
                        <strong>{issue.label}</strong>
                        <small>{issue.detail}</small>
                        <small>{issue.protectedReason}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {scan.issues.length === 0 ? <p className="muted">No orphaned records found.</p> : visibleActionableIssues.length === 0 && visibleProtectedIssues.length === 0 ? <p className="muted">No records match the selected categories.</p> : null}
          </>
        ) : <p className="muted">Run a read-only scan to see categorized results. No cleanup happens automatically.</p>}
      </div>

      {message ? <div className="alert success">{message}</div> : null}

      {confirmAction === "clip" ? (
        <ConfirmActionDialog
          title="Clear Clip Library index?"
          body={`This will remove ${summary?.activeClipLibraryCount ?? 0} clip${summary?.activeClipLibraryCount === 1 ? "" : "s"} from the active Clip Library view. Your video files will not be deleted. Saved transcripts, metadata, schedules, performance history, and AI feedback will be preserved and can reconnect when files are re-imported.`}
          confirmLabel="Clear Clip Library index"
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirm}
        />
      ) : null}
      {confirmAction === "long_form" ? (
        <ConfirmActionDialog
          title="Clear Long-form index?"
          body={`This will remove ${summary?.activeLongFormSourceCount ?? 0} source${summary?.activeLongFormSourceCount === 1 ? "" : "s"} from the active Make Clips source list. Original videos, transcripts, proposals, approval decisions, rejection feedback, and approved clips will be preserved. No source files will be deleted.`}
          confirmLabel="Clear Long-form index"
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirm}
        />
      ) : null}
      {confirmAction === "cleanup" ? (
        <ConfirmActionDialog
          title="Permanently delete selected orphaned data?"
          body="This cannot be undone. It will delete only the selected database records. It will not delete video files, AI models, AI profiles, or Google/YouTube credentials."
          confirmLabel="Delete selected records"
          destructive
          acknowledgementLabel="I understand these selected database records will be permanently deleted."
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirm}
        >
          <p className="muted">Selected: {selectedIssueIds.length} of {actionableIssues.length} safe cleanup candidate{actionableIssues.length === 1 ? "" : "s"}. Protected history remains untouched.</p>
        </ConfirmActionDialog>
      ) : null}
    </Panel>
  );
}

function DataMetric({ label, value }: { label: string; value: number | string }) {
  return <div className="data-management-metric"><strong>{value}</strong><span>{label}</span></div>;
}
