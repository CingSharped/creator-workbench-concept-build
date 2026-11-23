import type { WorkspaceIndexStatus } from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

const LAST_ACTIVITY_AT_KEY = "workspace.index_activity_at";
const LAST_ACTIVITY_SUMMARY_KEY = "workspace.index_activity_summary";
const LAST_SYNC_AT_KEY = "workspace.index_sync_at";
const LAST_SYNC_SUMMARY_KEY = "workspace.index_sync_summary";

export function getWorkspaceIndexStatus(): WorkspaceIndexStatus {
  const store = readDatabase();

  return {
    indexedClipCount: store.clips.filter((clip) => clip.indexState !== "archived").length,
    lastActivityAt: store.appSettings[LAST_ACTIVITY_AT_KEY]?.value ?? null,
    lastActivitySummary: store.appSettings[LAST_ACTIVITY_SUMMARY_KEY]?.value ?? null,
    lastSyncAt: store.appSettings[LAST_SYNC_AT_KEY]?.value ?? null,
    lastSyncSummary: store.appSettings[LAST_SYNC_SUMMARY_KEY]?.value ?? null
  };
}

export function recordWorkspaceIndexActivity(summary: string): WorkspaceIndexStatus {
  return updateDatabase((store) => {
    const now = new Date().toISOString();

    store.appSettings[LAST_ACTIVITY_AT_KEY] = {
      value: now,
      updatedAt: now
    };
    store.appSettings[LAST_ACTIVITY_SUMMARY_KEY] = {
      value: summary,
      updatedAt: now
    };

    return {
      indexedClipCount: store.clips.filter((clip) => clip.indexState !== "archived").length,
      lastActivityAt: now,
      lastActivitySummary: summary,
      lastSyncAt: store.appSettings[LAST_SYNC_AT_KEY]?.value ?? null,
      lastSyncSummary: store.appSettings[LAST_SYNC_SUMMARY_KEY]?.value ?? null
    };
  });
}

export function recordWorkspaceSyncActivity(summary: string): WorkspaceIndexStatus {
  return updateDatabase((store) => {
    const now = new Date().toISOString();

    store.appSettings[LAST_ACTIVITY_AT_KEY] = {
      value: now,
      updatedAt: now
    };
    store.appSettings[LAST_ACTIVITY_SUMMARY_KEY] = {
      value: summary,
      updatedAt: now
    };
    store.appSettings[LAST_SYNC_AT_KEY] = {
      value: now,
      updatedAt: now
    };
    store.appSettings[LAST_SYNC_SUMMARY_KEY] = {
      value: summary,
      updatedAt: now
    };

    return {
      indexedClipCount: store.clips.filter((clip) => clip.indexState !== "archived").length,
      lastActivityAt: now,
      lastActivitySummary: summary,
      lastSyncAt: now,
      lastSyncSummary: summary
    };
  });
}
