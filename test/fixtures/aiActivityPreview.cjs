// Run with: node_modules/electron/dist/electron.exe test/fixtures/aiActivityPreview.cjs
// Isolated UI fixture: no application database, user media, models or external APIs.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "creator-ai-sidebar-preview-"));
app.setPath("userData", profile);
let server;
app.whenReady().then(async () => {
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  server = await createServer({ configFile: false, root: path.resolve(__dirname, "../.."), plugins: [react()], server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const port = server.httpServer.address().port;
  const window = new BrowserWindow({ width: 1200, height: 840, title: "AI Activity Preview", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const log = (message) => fs.appendFileSync(path.join(__dirname, "aiActivityPreview.log"), `${message}\n`);
  window.webContents.on("console-message", (_event, _level, message) => log(message));
  window.webContents.on("did-fail-load", (_event, code, description) => log(`Load failed: ${code} ${description}`));
  log(`Preview URL: http://127.0.0.1:${port}/test/fixtures/aiActivityPreview.html`);
  await window.loadURL(`http://127.0.0.1:${port}/test/fixtures/aiActivityPreview.html`);
});
app.on("window-all-closed", async () => { await server?.close(); app.quit(); });
