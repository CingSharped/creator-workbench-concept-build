const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fixtureDirectory = process.argv[2];
const resultPrefix = process.argv[3] ?? "PERFORMANCE_WORKFLOW_RESULTS:";
app.setPath("userData", path.join(fixtureDirectory, "profile"));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  window.webContents.on("console-message", (_event, _level, message) => {
    if (!message.startsWith(resultPrefix)) return;
    fs.writeFileSync(path.join(fixtureDirectory, "results.json"), message.slice(resultPrefix.length));
    app.quit();
  });
  await window.loadFile(path.join(fixtureDirectory, "index.html"));
});
setTimeout(() => app.exit(2), 15000).unref();
