export type AiActivityStatus = "preparing" | "waiting" | "loading" | "generating" | "processing" | "cancelling" | "completed" | "failed" | "cancelled";

export interface AiActivityTask {
  id: string;
  title: string;
  assetLabel: string;
  status: AiActivityStatus;
  queuePosition: number | null;
  model: string | null;
  detail: string;
  warning: string | null;
  error: string | null;
  cancellable: boolean;
  createdAt: number;
  updatedAt: number;
  waitingSince: number | null;
  finishedAt: number | null;
}

export interface AiActivitySnapshot { revision: number; tasks: AiActivityTask[] }

export function isActiveAiTask(task: AiActivityTask): boolean {
  return task.finishedAt === null;
}

export function sortAiActivity(tasks: AiActivityTask[]): AiActivityTask[] {
  const priority = (task: AiActivityTask): number => !isActiveAiTask(task) ? 3 : task.status === "waiting" ? 2 : 0;
  return [...tasks].sort((a, b) => priority(a) - priority(b) ||
    (a.status === "waiting" && b.status === "waiting" ? (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity) : 0) ||
    (isActiveAiTask(a) ? a.createdAt - b.createdAt : b.finishedAt! - a.finishedAt!));
}
