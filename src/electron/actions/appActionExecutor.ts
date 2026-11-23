import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { trackAiAction } from "../services/aiActivityService";
import {
  getAppActionDefinition,
  type AppActionDefinition,
  type AppActionId
} from "../../shared/appActions";

export interface AppActionExecutionContext {
  source: "ui" | "orchestrator";
  confirmed: boolean;
  sender: WebContents | null;
  requestId?: string;
  operationId?: string;
}

type AppActionHandler = (
  input: unknown,
  context: AppActionExecutionContext
) => unknown | Promise<unknown>;

const handlers = new Map<AppActionId, AppActionHandler>();

export function registerAppActionHandler(actionId: AppActionId, handler: AppActionHandler): void {
  if (!getAppActionDefinition(actionId)) {
    throw new Error(`Cannot register unknown app action: ${actionId}.`);
  }
  if (handlers.has(actionId)) {
    throw new Error(`App action is already registered: ${actionId}.`);
  }

  handlers.set(actionId, handler);
}

export async function executeAppAction<T>(
  actionId: string,
  input: unknown,
  context: AppActionExecutionContext
): Promise<T> {
  const definition = getAppActionDefinition(actionId);
  if (!definition) {
    throw new Error(`Unknown Creator Workbench action: ${actionId}.`);
  }

  if (definition.requiresConfirmation && !context.confirmed) {
    throw new Error(`Action requires user confirmation before it can run: ${definition.label}.`);
  }

  const handler = handlers.get(definition.id as AppActionId);
  if (!handler) {
    throw new Error(`Creator Workbench action is not available yet: ${definition.label}.`);
  }

  const executionContext: AppActionExecutionContext = {
    ...context,
    requestId: context.requestId ?? randomUUID(),
    operationId: context.operationId ?? randomUUID()
  };

  return (await trackAiAction(definition.id, input, async () => handler(input, executionContext))) as T;
}

export function listRegisteredAppActions(): AppActionDefinition[] {
  return [...handlers.keys()]
    .map((actionId) => getAppActionDefinition(actionId))
    .filter((definition): definition is AppActionDefinition => definition !== null);
}

export function requireActionObject(input: unknown, actionId: AppActionId): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Invalid input for Creator Workbench action: ${actionId}.`);
  }

  return input as Record<string, unknown>;
}

export function requireActionString(
  input: Record<string, unknown>,
  field: string,
  actionId: AppActionId
): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Action ${actionId} requires a non-empty ${field}.`);
  }

  return value.trim();
}

export function requireActionNumber(
  input: Record<string, unknown>,
  field: string,
  actionId: AppActionId
): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Action ${actionId} requires a finite ${field}.`);
  }

  return value;
}
