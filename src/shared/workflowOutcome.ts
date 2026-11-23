export type WorkflowOutcome<T> =
  | { status: "completed"; value: T }
  | { status: "cancelled"; message: string }
  | { status: "failed"; message: string };

export class WorkflowCancelledError extends Error {
  readonly code = "WORKFLOW_CANCELLED";
  constructor(message = "Operation cancelled.") {
    super(message);
    this.name = "WorkflowCancelledError";
  }
}

/** Exact legacy messages remain supported while services adopt typed cancellation. */
export function isWorkflowCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof WorkflowCancelledError) return true;
  return error.message === "Local AI request cancelled." ||
    error.message === "Clip proposal generation cancelled." ||
    error.message === "Process cancelled.";
}

export async function captureWorkflowOutcome<T>(
  work: () => Promise<T>, signal?: AbortSignal
): Promise<WorkflowOutcome<T>> {
  try {
    if (signal?.aborted) throw new WorkflowCancelledError();
    const value = await work();
    if (signal?.aborted) throw new WorkflowCancelledError();
    return { status: "completed", value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operation failed.";
    return signal?.aborted || isWorkflowCancellation(error)
      ? { status: "cancelled", message }
      : { status: "failed", message };
  }
}

export function unwrapWorkflowOutcome<T>(outcome: WorkflowOutcome<T>): T {
  switch (outcome?.status) {
    case "completed": return outcome.value;
    case "cancelled": throw new WorkflowCancelledError(outcome.message);
    case "failed": throw new Error(outcome.message);
    default: throw new Error("Restart Creator Workbench to load the updated workflow connection.");
  }
}
