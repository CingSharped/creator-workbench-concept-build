const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CORE_PACK_FILES = [
  { sourceRoot: ".local-tools/ffmpeg", sourceName: "ffmpeg.exe", target: "ffmpeg/ffmpeg.exe" },
  { sourceRoot: ".local-tools/ffmpeg", sourceName: "ffprobe.exe", target: "ffmpeg/ffprobe.exe" },
  { sourceRoot: ".local-tools/whisper.cpp", sourceName: "whisper-cli.exe", target: "whisper/whisper-cli.exe" },
  { sourceRoot: ".local-models/whisper", sourceName: "ggml-base.bin", target: "whisper-model/ggml-base.bin" }
];

async function findFile(rootDirectory, fileName) {
  const pending = [rootDirectory];
  while (pending.length > 0) {
    const currentDirectory = pending.shift();
    if (!currentDirectory) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return entryPath;
      }
    }
  }

  return null;
}

async function addCorePackFile(sourceRoot, sourceName, target, buildPath) {
  const sourcePath = await findFile(path.join(__dirname, sourceRoot), sourceName);
  if (!sourcePath) {
    return null;
  }

  const targetPath = path.join(buildPath, "..", "core-pack", target);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  const digest = crypto.createHash("sha256").update(await fs.readFile(targetPath)).digest("hex");
  return { file: target, bytes: (await fs.stat(targetPath)).size, sha256: digest };
}

async function packageCorePack(buildPath) {
  const files = [];
  for (const entry of CORE_PACK_FILES) {
    const copied = await addCorePackFile(entry.sourceRoot, entry.sourceName, entry.target, buildPath);
    if (copied) {
      files.push(copied);
    }
  }

  const whisperExecutable = await findFile(path.join(__dirname, ".local-tools/whisper.cpp"), "whisper-cli.exe");
  if (whisperExecutable) {
    const whisperDirectory = path.dirname(whisperExecutable);
    const supportFiles = await fs.readdir(whisperDirectory, { withFileTypes: true });
    for (const supportFile of supportFiles.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dll"))) {
    const target = path.join(buildPath, "..", "core-pack", "whisper", supportFile.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(whisperDirectory, supportFile.name), target);
      files.push({
        file: `whisper/${supportFile.name}`,
        bytes: (await fs.stat(target)).size,
        sha256: crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex")
      });
    }
  }

  if (files.length === 0) {
    return;
  }

  await fs.writeFile(
    path.join(buildPath, "..", "core-pack", "manifest.json"),
    JSON.stringify({ version: "1", files }, null, 2),
    "utf8"
  );
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    // User-managed runtimes and repository-only files are not installer payload.
    // Keeping them out makes the package portable and lets first-run setup
    // import versions appropriate for each machine.
    ignore: (absolutePath) => /[\\/](?:\.local-(?:models|tools)|\.git|\.agents|docs|src|test)(?:[\\/]|$)/.test(absolutePath)
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      await packageCorePack(buildPath);
    }
  },
  makers: [
    new MakerSquirrel({
      name: "creator_workspace"
    }),
    new MakerZIP({}, ["win32"])
  ]
};

module.exports = config;
