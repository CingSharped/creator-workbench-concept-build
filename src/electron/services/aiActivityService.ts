import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isWorkflowCancellation } from "../../shared/workflowOutcome";
import type { AiActivitySnapshot, AiActivityTask } from "../../shared/aiActivity";
import { readDatabase } from "./database";
import type { LocalAiQueueState } from "./localAiScheduler";

const titles: Record<string, string> = {
  "long_form.generate_proposals": "Find clips",
  "clips.generate_metadata": "Generate metadata",
  "youtube_videos.generate_metadata": "Generate video metadata",
  "thumbnails.generate_candidates": "Create thumbnail candidates",
  "performance.generate_coach": "Performance coaching"
};
interface Turn { state: LocalAiQueueState; model: string | null; phase: "loading" | "generating"; detail: string }
interface Activity {
  task: AiActivityTask;
  turns: Map<string, Turn>;
  cancel?: () => void;
}
const context = new AsyncLocalStorage<{ activity: Activity; turnId?: string }>();
const activities = new Map<string, Activity>();
const listeners = new Set<(snapshot: AiActivitySnapshot) => void>();
let revision = 0;

export function getAiActivitySnapshot(): AiActivitySnapshot {
  return { revision, tasks: [...activities.values()].map(({ task }) => ({ ...task })) };
}
export function subscribeAiActivity(listener: (snapshot: AiActivitySnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(): void {
  revision++;
  for (const listener of listeners) {
    try { listener(getAiActivitySnapshot()); } catch (error) { console.error("AI activity update failed", error); }
  }
}
function update(activity: Activity): void {
  const task = activity.task;
  if (task.finishedAt !== null) return;
  const turns = [...activity.turns.values()];
  const running = turns.find((turn) => turn.state.status === "running");
  const waiting = turns.filter((turn) => turn.state.status === "waiting")
    .sort((a, b) => (a.state.position ?? Infinity) - (b.state.position ?? Infinity))[0];
  const status = running?.phase ?? (waiting ? "waiting" : "processing");
  if (task.status !== "cancelling") task.status = status;
  task.queuePosition = running ? null : waiting?.state.position ?? null;
  task.model = running?.model ?? waiting?.model ?? task.model;
  task.detail = running?.detail ?? waiting?.detail ?? task.detail;
  task.waitingSince = status === "waiting" ? task.waitingSince ?? Date.now() : null;
  task.updatedAt = Date.now();
  publish();
}

export async function trackAiAction<T>(actionId: string, input: unknown, work: () => Promise<T>): Promise<T> {
  if (!titles[actionId] || context.getStore()) return work();
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const store = readDatabase();
  const assetLabel = store.longFormSources.find((item) => item.id === values.sourceId)?.displayName ??
    store.clips.find((item) => item.id === values.clipId)?.displayName ??
    store.youtubeVideoCache.find((item) => item.videoId === values.videoId)?.title ??
    (typeof values.videoId === "string" ? "YouTube video" : "Channel overview");
  const activity: Activity = { turns: new Map(), task: {
    id: randomUUID(), title: titles[actionId], assetLabel, status: "preparing", queuePosition: null,
    model: null, detail: "Preparing task", warning: null, error: null, cancellable: false,
    createdAt: Date.now(), updatedAt: Date.now(), waitingSince: null, finishedAt: null
  } };
  activities.set(activity.task.id, activity);
  publish();
  return context.run({ activity }, async () => {
    try {
      const result = await work();
      const summary = result as { issueSummary?: unknown } | null;
      activity.task.warning = typeof summary?.issueSummary === "string" ? summary.issueSummary : null;
      activity.task.status = "completed";
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI task failed.";
      activity.task.status = isWorkflowCancellation(error) ? "cancelled" : "failed";
      activity.task.error = activity.task.status === "failed" ? message : null;
      throw error;
    } finally {
      activity.cancel = undefined;
      Object.assign(activity.task, { cancellable: false, queuePosition: null, waitingSince: null, finishedAt: Date.now(), updatedAt: Date.now() });
      const finished = [...activities.values()].filter((item) => item.task.finishedAt !== null);
      for (const item of finished.slice(0, Math.max(0, finished.length - 20))) activities.delete(item.task.id);
      publish();
    }
  });
}

export function setAiActivityDetail(detail: string): void {
  const activity = context.getStore()?.activity;
  if (!activity || activity.task.finishedAt !== null) return;
  activity.task.detail = detail;
  activity.task.updatedAt = Date.now();
  publish();
}
export function setAiActivityCancel(cancel: () => void): () => void {
  const activity = context.getStore()?.activity;
  if (!activity) return () => {};
  activity.cancel = cancel;
  activity.task.cancellable = true;
  publish();
  return () => { activity.cancel = undefined; activity.task.cancellable = false; };
}
export function cancelAiActivity(id: string): boolean {
  const activity = activities.get(id);
  if (!activity?.cancel || activity.task.finishedAt !== null || activity.task.status === "cancelling") return false;
  activity.task.status = "cancelling";
  activity.task.cancellable = false;
  activity.cancel();
  publish();
  return true;
}

export function createAiActivityTurn(model: string | null): {
  observe: (state: LocalAiQueueState) => void;
  run: <T>(work: () => Promise<T>) => Promise<T>;
} {
  const current = context.getStore();
  const id = randomUUID();
  const detail = current?.activity.task.detail ?? "";
  return {
    observe(state) {
      if (!current) return;
      if (state.status === "finished") current.activity.turns.delete(id);
      else {
        const previous = current.activity.turns.get(id);
        current.activity.turns.set(id, { state, model: previous?.model ?? model, phase: previous?.phase ?? "loading", detail });
      }
      update(current.activity);
    },
    run: (work) => current ? context.run({ ...current, turnId: id }, work) : work()
  };
}
export function updateAiActivityTurn(phase: Turn["phase"], model: string): void {
  const current = context.getStore();
  const turn = current?.activity.turns.get(current.turnId ?? "");
  if (!turn || !current) return;
  turn.phase = phase;
  turn.model = model;
  update(current.activity);
}
