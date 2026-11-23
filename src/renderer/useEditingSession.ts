import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

interface Ticket {
  epoch: number;
  revision: number;
  scope?: string;
  request?: number;
}

/** Tracks a visit to an asset, its local edits, and superseding requests. */
class EditingSession {
  private epoch = 0;
  private revision = 0;
  private active = true;
  private dirty = false;
  private requests = new Map<string, number>();
  constructor(private owner: string | null) {}
  select(owner: string | null): void {
    if (owner === this.owner) return;
    this.owner = owner;
    this.epoch++;
    this.revision = 0;
    this.dirty = false;
    this.requests.clear();
  }
  capture(): Ticket { return { epoch: this.epoch, revision: this.revision }; }
  owns(ticket: Ticket): boolean { return this.active && ticket.epoch === this.epoch; }
  current(ticket: Ticket): boolean { return this.owns(ticket) && ticket.revision === this.revision; }
  latest(ticket: Ticket): boolean {
    return this.owns(ticket) && (!ticket.scope || this.requests.get(ticket.scope) === ticket.request);
  }
  accepts(ticket: Ticket): boolean { return this.current(ticket) && this.latest(ticket); }
  get hasEdits(): boolean { return this.dirty; }
  edit(markDirty = true): void { this.revision++; this.dirty ||= markDirty; }
  commit(ticket: Ticket): void { if (this.accepts(ticket)) this.dirty = false; }
  begin(scope: string, changesDraft = false): Ticket {
    if (changesDraft) this.revision++;
    const request = (this.requests.get(scope) ?? 0) + 1;
    this.requests.set(scope, request);
    return { ...this.capture(), scope, request };
  }
  activate(): void { this.active = true; }
  dispose(): void { this.active = false; }
  editSetter<T>(setter: Dispatch<SetStateAction<T>>, value: T, markDirty = true): Dispatch<SetStateAction<T>> {
    const ticket = this.capture();
    return update => {
      if (!this.owns(ticket)) return;
      if (typeof update === "function" || !Object.is(update, value)) this.edit(markDirty);
      setter(update);
    };
  }
  acceptSetter<T>(setter: Dispatch<SetStateAction<T>>, commit = false): Dispatch<SetStateAction<T>> {
    const ticket = this.capture();
    return update => {
      if (!this.current(ticket)) return;
      if (commit) this.dirty = false;
      setter(update);
    };
  }
}

export function useEditingSession(owner: string | null): EditingSession {
  const ref = useRef<EditingSession>();
  if (!ref.current) ref.current = new EditingSession(owner);
  const session = ref.current;
  session.select(owner);
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);
  return session;
}
