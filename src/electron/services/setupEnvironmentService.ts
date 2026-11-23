import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CreatorGpuVendor,
  CreatorHardwareSummary,
  CreatorSetupEnvironment
} from "../../shared/contracts";

const execFileAsync = promisify(execFile);

let cachedEnvironment: { checkedAt: number; value: CreatorSetupEnvironment } | null = null;
const ENVIRONMENT_CACHE_TTL_MS = 30_000;

export async function getCreatorSetupEnvironment(userDataPath: string): Promise<CreatorSetupEnvironment> {
  const now = Date.now();
  if (cachedEnvironment && now - cachedEnvironment.checkedAt < ENVIRONMENT_CACHE_TTL_MS) {
    return cachedEnvironment.value;
  }

  const value: CreatorSetupEnvironment = {
    platform: process.platform,
    architecture: os.arch(),
    storageRoot: path.parse(userDataPath).root,
    freeSpaceBytes: await getFreeSpaceBytes(userDataPath),
    hardware: await detectHardware()
  };

  cachedEnvironment = { checkedAt: now, value };
  return value;
}

interface WindowsVideoController {
  Name?: string;
  AdapterRAM?: number;
}

async function detectHardware(): Promise<CreatorHardwareSummary> {
  const cpuCores = Math.max(1, os.cpus().length);
  const systemMemoryBytes = os.totalmem();

  if (process.platform === "win32") {
    const nvidiaGpu = await detectNvidiaGpu();
    if (nvidiaGpu) {
      const driverDetail = nvidiaGpu.driverVersion ? ` Driver ${nvidiaGpu.driverVersion}.` : "";
      return {
        cpuCores,
        systemMemoryBytes,
        gpuName: nvidiaGpu.name,
        gpuVendor: "nvidia",
        gpuMemoryBytes: nvidiaGpu.memoryTotalMiB === null
          ? null
          : nvidiaGpu.memoryTotalMiB * 1024 * 1024,
        gpuBackend: "cuda",
        detectionDetail: `NVIDIA GPU detected through the installed driver.${driverDetail}`
      };
    }

    const controller = (await detectWindowsVideoControllers()).find((candidate) => candidate.Name);
    if (controller?.Name) {
      const gpuVendor = inferGpuVendor(controller.Name);
      return {
        cpuCores,
        systemMemoryBytes,
        gpuName: controller.Name.trim(),
        gpuVendor,
        gpuMemoryBytes: typeof controller.AdapterRAM === "number" && controller.AdapterRAM > 0
          ? controller.AdapterRAM
          : null,
        gpuBackend: gpuVendor === "amd" || gpuVendor === "intel" ? "vulkan" : "unknown",
        detectionDetail: "GPU detected through Windows device information. The app will use a conservative runtime recommendation until this backend is configured."
      };
    }
  }

  return {
    cpuCores,
    systemMemoryBytes,
    gpuName: null,
    gpuVendor: "unknown",
    gpuMemoryBytes: null,
    gpuBackend: "cpu",
    detectionDetail: "No dedicated GPU was detected. CPU-safe local AI recommendations are shown."
  };
}

async function detectNvidiaGpu(): Promise<{
  name: string;
  memoryTotalMiB: number | null;
  driverVersion: string | null;
} | null> {
  const result = await execFileAsync(
    "nvidia-smi.exe",
    ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
    { windowsHide: true, timeout: 5000 }
  ).catch(() => null);
  if (!result) {
    return null;
  }

  const firstLine = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) {
    return null;
  }

  const [name, memoryTotalMiB, driverVersion] = firstLine.split(",").map((part) => part.trim());
  if (!name) {
    return null;
  }

  return {
    name,
    memoryTotalMiB: memoryTotalMiB && Number.isFinite(Number(memoryTotalMiB)) ? Number(memoryTotalMiB) : null,
    driverVersion: driverVersion || null
  };
}

async function detectWindowsVideoControllers(): Promise<WindowsVideoController[]> {
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress"
    ],
    { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }
  ).catch(() => null);
  if (!result?.stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout) as WindowsVideoController | WindowsVideoController[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function inferGpuVendor(name: string): CreatorGpuVendor {
  const normalized = name.toLowerCase();
  if (normalized.includes("nvidia") || normalized.includes("geforce")) {
    return "nvidia";
  }
  if (normalized.includes("amd") || normalized.includes("radeon")) {
    return "amd";
  }
  if (normalized.includes("intel") || normalized.includes("arc")) {
    return "intel";
  }
  return "other";
}

async function getFreeSpaceBytes(targetPath: string): Promise<number | null> {
  try {
    const filesystem = await statfs(targetPath);
    const availableBlocks = typeof filesystem.bavail === "bigint"
      ? filesystem.bavail
      : BigInt(filesystem.bavail);
    const blockSize = typeof filesystem.bsize === "bigint"
      ? filesystem.bsize
      : BigInt(filesystem.bsize);
    const bytes = availableBlocks * blockSize;
    return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null;
  } catch {
    return null;
  }
}
