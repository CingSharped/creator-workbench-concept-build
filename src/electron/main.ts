import { existsSync } from "node:fs";
import { app, BrowserWindow, protocol } from "electron";
import path from "node:path";
import { disposeClipLibraryWatcher, refreshClipLibraryWatcher } from "./services/clipLibraryWatcher";
import { bootstrapLocalDatabase } from "./services/database";
import { bootstrapLocalAiRuntime, disposeLocalAiRuntime } from "./services/localAiRuntimeService";
import { bootstrapLocalAiSetup, disposeLocalAiSetupDownloads } from "./services/localAiSetupService";
import { createLocalMediaResponse } from "./services/localMediaProtocol";
import { disposeTranscriptionProcesses } from "./services/transcriptionService";
import { markRunningJobsInterrupted } from "./services/jobRepository";
import { markPostingPostsForReconciliation } from "./services/scheduledPostRepository";
import { ensureDefaultWorkspace } from "./services/workspaceRepository";
import { registerIpcHandlers } from "./ipc/registerHandlers";

const DEV_SERVER_URL = "http://localhost:5173";
const DEV_SERVER_TIMEOUT_MS = 1500;
const LOCAL_MEDIA_SCHEME = "creator-media";
let appCleanupStarted = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

async function createMainWindow(): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const isDev = !app.isPackaged;
  const indexPath = path.join(__dirname, "..", "renderer", "index.html");

  if (isDev && (await isDevServerReachable())) {
    try {
      await mainWindow.loadURL(DEV_SERVER_URL);
      mainWindow.webContents.openDevTools({ mode: "detach" });
      return mainWindow;
    } catch (error) {
      console.error("Failed to load dev server", error);
    }
  }

  if (!existsSync(indexPath)) {
    throw new Error(
      `Renderer bundle is unavailable at ${indexPath}. Run "npm run build" or start the dev server with "npm run dev".`
    );
  }

  try {
    await mainWindow.loadFile(indexPath);
  } catch (error) {
    console.error("Failed to load renderer bundle", error);
    throw error;
  }

  return mainWindow;
}

async function isDevServerReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEV_SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(DEV_SERVER_URL, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  await app.whenReady();

  protocol.handle(LOCAL_MEDIA_SCHEME, createLocalMediaResponse);

  bootstrapLocalDatabase(app.getPath("userData"));
  bootstrapLocalAiRuntime(app.getPath("userData"));
  bootstrapLocalAiSetup(app.getPath("userData"));
  ensureDefaultWorkspace();
  markRunningJobsInterrupted();
  markPostingPostsForReconciliation();
  registerIpcHandlers();
  await refreshClipLibraryWatcher();

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
}

async function disposeAppResources(): Promise<void> {
  markPostingPostsForReconciliation();
  markRunningJobsInterrupted();
  disposeClipLibraryWatcher();
  await disposeTranscriptionProcesses();
  disposeLocalAiSetupDownloads();
  await disposeLocalAiRuntime();
}

app.on("before-quit", (event) => {
  if (appCleanupStarted) {
    return;
  }

  appCleanupStarted = true;
  event.preventDefault();
  void disposeAppResources()
    .catch((error) => {
      console.error("Failed to dispose app resources", error);
    })
    .finally(() => {
      app.exit();
    });
});

app.on("window-all-closed", () => {
  disposeClipLibraryWatcher();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

main().catch((error) => {
  console.error("Application failed to start", error);
  app.exit(1);
});
