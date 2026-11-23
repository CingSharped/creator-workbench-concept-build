import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AppShell, { type WorkbenchView } from "../../src/renderer/AppShell";
import "../../src/renderer/styles.css";
import type { AiActivitySnapshot } from "../../src/shared/aiActivity";

const now = Date.now();
let snapshot: AiActivitySnapshot = { revision: 1, tasks: [
  { id: "find", title: "Find clips", assetLabel: "Weekend stream — a long recording title", status: "generating", queuePosition: null,
    model: "Qwen 3 · 14B", detail: "Transcript window 8 of 22", warning: null, error: null, cancellable: true,
    createdAt: now - 130000, updatedAt: now, waitingSince: null, finishedAt: null },
  { id: "metadata", title: "Generate metadata", assetLabel: "The last-second clutch", status: "waiting", queuePosition: 1,
    model: "Gemma 3 · 12B", detail: "Preparing metadata candidates", warning: null, error: null, cancellable: false,
    createdAt: now - 20000, updatedAt: now, waitingSince: now - 18000, finishedAt: null },
  { id: "completed", title: "Performance coaching", assetLabel: "Channel overview", status: "completed", queuePosition: null,
    model: "Qwen 3 · 14B", detail: "Analysis complete", warning: "Some historical data was unavailable.", error: null, cancellable: false,
    createdAt: now - 300000, updatedAt: now - 160000, waitingSince: null, finishedAt: now - 160000 }
] };
const listeners = new Set<(value: AiActivitySnapshot) => void>();
Object.assign(window, { creatorApp: {
  getAiActivity: async () => snapshot,
  onAiActivity: (listener: (value: AiActivitySnapshot) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  cancelAiActivity: async (id: string) => {
    snapshot = { revision: snapshot.revision + 1, tasks: snapshot.tasks.map(task => task.id === id ? { ...task, status: "cancelled", cancellable: false, queuePosition: null, finishedAt: Date.now() } : task) };
    listeners.forEach(listener => listener(snapshot));
    return true;
  }
} });
function Preview(): JSX.Element {
  const [view, setView] = useState<WorkbenchView>("review");
  return <AppShell activeView={view} indexedClipCount={24} onViewChange={setView}>
    <h1>AI activity preview</h1><p>Fixture data only. Expand the sidebar, inspect task details, switch navigation and cancel the active task.</p>
    <p>Current view: {view}</p>
  </AppShell>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
