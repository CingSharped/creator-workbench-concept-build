const fs = require("node:fs");
const path = require("node:path");

const electronOutputDirectory = path.resolve(__dirname, "..", "dist", "electron");
fs.rmSync(electronOutputDirectory, { recursive: true, force: true });
