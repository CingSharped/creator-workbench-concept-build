import { useEffect, useRef, useState } from "react";
import { isActiveAiTask, sortAiActivity, type AiActivitySnapshot, type AiActivityTask } from "../shared/aiActivity";

const labels: Record<AiActivityTask["status"], string> = {
  preparing: "Preparing", waiting: "Waiting for AI", loading: "Loading model", generating: "Generating",
  processing: "Processing results", cancelling: "Cancelling…", completed: "Completed", failed: "Failed", cancelled: "Cancelled"
};
function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function AiActivityQueue({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }): JSX.Element {
  const [snapshot, setSnapshot] = useState<AiActivitySnapshot>({ revision: -1, tasks: [] });
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState<string | null>(null);
  const revision = useRef(-1);
  useEffect(() => {
    if (typeof window.creatorApp.onAiActivity !== "function" || typeof window.creatorApp.getAiActivity !== "function") {
      setError("Restart Creator Workbench to load AI activity.");
      return;
    }
    let disposed = false;
    const apply = (next: AiActivitySnapshot): void => {
      if (disposed || next.revision < revision.current) return;
      revision.current = next.revision;
      setSnapshot(next);
      setError(null);
    };
    const unsubscribe = window.creatorApp.onAiActivity(apply);
    void window.creatorApp.getAiActivity().then(apply).catch(() => {
      if (!disposed) setError("AI activity is unavailable. Restart the app to reconnect.");
    });
    return () => { disposed = true; unsubscribe(); };
  }, []);
  const active = sortAiActivity(snapshot.tasks.filter(isActiveAiTask));
  const recent = sortAiActivity(snapshot.tasks.filter((task) => !isActiveAiTask(task))).slice(0, 5);
  const waitingCount = active.filter((task) => task.status === "waiting").length;
  const runningCount = active.filter((task) => task.status === "loading" || task.status === "generating").length;
  useEffect(() => {
    if (active.length === 0 || collapsed) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active.length, collapsed]);

  async function cancel(task: AiActivityTask): Promise<void> {
    setCancelling(task.id);
    try {
      if (!await window.creatorApp.cancelAiActivity(task.id)) setError("This task has finished or cannot be cancelled now.");
    } catch { setError("Could not cancel the task. Please try again."); }
    finally { setCancelling(null); }
  }
  function card(task: AiActivityTask): JSX.Element {
    const activeTask = isActiveAiTask(task);
    return <li key={task.id} className={`ai-activity-card ai-activity-${task.status}`}>
      <div className="ai-activity-card-heading"><strong>{task.title}</strong>
        {task.queuePosition !== null ? <span className="ai-activity-position" title="Position of this task's next AI turn">#{task.queuePosition}</span> : null}
      </div>
      <span className="ai-activity-asset" title={task.assetLabel}>{task.assetLabel}</span>
      <span className="ai-activity-state"><span className="ai-activity-dot" aria-hidden="true" />{labels[task.status]}{task.warning && task.status === "completed" ? " · warnings" : ""}</span>
      {activeTask ? <span className="ai-activity-detail">{task.detail}</span> : null}
      <details className="ai-activity-details"><summary>Details</summary>
        <p>Model: {task.model ?? "Selected when AI starts"}</p>
        <p>{activeTask ? "Elapsed" : "Duration"}: {duration((task.finishedAt ?? now) - task.createdAt)}</p>
        {task.waitingSince !== null ? <p>Waiting: {duration(now - task.waitingSince)}</p> : null}
        {task.queuePosition !== null ? <p>Position {task.queuePosition} for the next AI turn. Tasks can take turns between stages.</p> : null}
        {task.warning ? <p className="ai-activity-warning">{task.warning}</p> : null}
        {task.error ? <p className="ai-activity-error">{task.error}</p> : null}
        {activeTask && !task.cancellable && task.status !== "cancelling" ? <p>Cancellation is unavailable for this task.</p> : null}
      </details>
      {task.cancellable ? <button type="button" className="ai-activity-cancel" disabled={cancelling === task.id} onClick={() => void cancel(task)} aria-label={`Cancel ${task.title} for ${task.assetLabel}`}>{cancelling === task.id ? "Cancelling…" : "Cancel"}</button> : null}
    </li>;
  }
  if (collapsed) return <button type="button" className="ai-activity-collapsed" onClick={onExpand}
    aria-label={`Expand AI activity: ${active.length} active, ${waitingCount} waiting`}
    title={error ?? `AI activity · ${runningCount} using AI · ${waitingCount} waiting`}>
    <span aria-hidden="true">AI</span><span className="ai-activity-count">{active.length}</span>
  </button>;
  return <section className="ai-activity" aria-label="AI activity">
    <div className="ai-activity-heading"><h2>AI Activity</h2><span className="ai-activity-count">{active.length}</span></div>
    <p className="ai-activity-summary" role="status">{active.length ? `${runningCount} using AI · ${waitingCount} waiting` : "No active AI tasks"}</p>
    {error ? <p className="ai-activity-error" role="alert">{error}</p> : null}
    {active.length ? <ol className="ai-activity-list">{active.map(card)}</ol> : null}
    {recent.length ? <details className="ai-activity-recent"><summary>Recent tasks · {recent.length}</summary><ol className="ai-activity-list">{recent.map(card)}</ol></details> : null}
    <p className="ai-activity-session">Current session · ordered by next AI turn</p>
  </section>;
}
