import { randomUUID } from "node:crypto";
import { readDatabase, updateDatabase } from "./database";

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_WORKSPACE_NAME = "Default Creator Workspace";

export function ensureDefaultWorkspace(): WorkspaceRecord {
  const existing = getDefaultWorkspaceOrNull();
  if (existing) {
    return existing;
  }

  return updateDatabase((store) => {
    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: DEFAULT_WORKSPACE_NAME,
      createdAt: now,
      updatedAt: now
    };

    store.workspaces.push(workspace);
    return workspace;
  });
}

export function getDefaultWorkspace(): WorkspaceRecord {
  const workspace = getDefaultWorkspaceOrNull();
  if (!workspace) {
    throw new Error("Default workspace is missing.");
  }

  return workspace;
}

function getDefaultWorkspaceOrNull(): WorkspaceRecord | null {
  return (
    [...readDatabase().workspaces].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ??
    null
  );
}
