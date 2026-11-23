export interface LocalAiQueueState { status: "waiting" | "running" | "finished"; position: number | null }
/** One owner of the local runtime, including startup, response consumption and cleanup. */
export class LocalAiScheduler {
  private tail: Promise<void> = Promise.resolve();
  private controllers = new Set<AbortController>();
  private stopping: Promise<void> | null = null;
  private entries = new Map<AbortController, { started: boolean; observe?: (state: LocalAiQueueState) => void }>();

  private publishQueue(): void {
    let position = 0;
    for (const [controller, entry] of this.entries) {
      if (controller.signal.aborted && !entry.started) continue;
      this.notify(entry.observe, { status: entry.started ? "running" : "waiting", position: entry.started ? null : ++position });
    }
  }
  private notify(observe: ((state: LocalAiQueueState) => void) | undefined, state: LocalAiQueueState): void {
    try { observe?.(state); } catch (error) { console.error("Local AI queue observer failed", error); }
  }

  run<T>(work: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal, observe?: (state: LocalAiQueueState) => void): Promise<T> {
    if (this.stopping) return Promise.reject(new Error("Local AI runtime is stopping."));
    if (externalSignal?.aborted) return Promise.reject(new Error("Local AI request cancelled."));
    const controller = new AbortController();
    this.controllers.add(controller);
    const entry = { started: false, observe };
    this.entries.set(controller, entry);
    let started = false;
    let rejectWaiting: (error: Error) => void;
    const cancelled = (): void => {
      if (!started) {
        rejectWaiting(new Error("Local AI request cancelled."));
        this.entries.delete(controller);
        this.notify(observe, { status: "finished", position: null });
        this.publishQueue();
      }
    };
    const abort = (): void => controller.abort();
    const result = new Promise<T>((resolve, reject) => {
      rejectWaiting = reject;
      controller.signal.addEventListener("abort", cancelled, { once: true });
      externalSignal?.addEventListener("abort", abort, { once: true });
      this.publishQueue();
      this.tail = this.tail.then(async () => {
        try {
          if (controller.signal.aborted) throw new Error("Local AI request cancelled.");
          started = true;
          entry.started = true;
          this.publishQueue();
          resolve(await work(controller.signal));
        } catch (error) {
          reject(error);
        } finally {
          externalSignal?.removeEventListener("abort", abort);
          controller.signal.removeEventListener("abort", cancelled);
          this.controllers.delete(controller);
          if (this.entries.delete(controller)) this.notify(observe, { status: "finished", position: null });
          this.publishQueue();
        }
      });
    });
    return result;
  }

  stop(cleanup: () => Promise<void>): Promise<void> {
    if (!this.stopping) {
      // Reject new work before notifying abort listeners.
      this.stopping = Promise.resolve().then(async () => {
        for (const controller of this.controllers) controller.abort();
        await this.tail;
        await cleanup();
      }).finally(() => { this.stopping = null; });
    }
    return this.stopping;
  }
}
