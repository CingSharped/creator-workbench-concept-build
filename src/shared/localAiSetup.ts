import type { CreatorSetupEnvironment, LocalAiRuntimeStatus } from "./contracts";

export type LocalAiSetupAssetId =
  | "runtime_cuda_12_4"
  | "runtime_cpu"
  | "model_gemma_3_12b_q4_k_m"
  | "model_gemma_4_e4b_q4_0"
  | "model_qwen3_8b_q8_0";
export type LocalAiSetupAssetKind = "runtime" | "model";
export type LocalAiSetupModelTier = "fast" | "balanced" | "quality";
export type LocalAiSetupModelCapability = "text" | "vision";

export interface LocalAiSetupDownload {
  url: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface LocalAiSetupAsset {
  id: LocalAiSetupAssetId;
  kind: LocalAiSetupAssetKind;
  label: string;
  description: string;
  sourceLabel: string;
  licenseLabel: string;
  totalSizeBytes: number;
  downloads: LocalAiSetupDownload[];
  installLabel: string;
  tier?: LocalAiSetupModelTier;
  capabilities?: LocalAiSetupModelCapability[];
  taskLabels?: string[];
  minimumSystemMemoryBytes?: number;
  recommendedSystemMemoryBytes?: number;
  recommendedGpuMemoryBytes?: number;
  estimatedWorkingSetBytes?: number;
}

export interface LocalAiSetupRecommendation {
  runtimeId: "runtime_cuda_12_4" | "runtime_cpu";
  modelId: Extract<LocalAiSetupAssetId, `model_${string}`>;
  reason: string;
  memoryDetail: string;
}

export type LocalAiSetupProgressStatus =
  | "queued"
  | "downloading"
  | "verifying"
  | "installing"
  | "completed"
  | "failed"
  | "cancelled";

export interface LocalAiSetupProgress {
  operationId: string;
  assetId: LocalAiSetupAssetId;
  status: LocalAiSetupProgressStatus;
  phase: string;
  percent: number | null;
  bytesDownloaded: number;
  totalBytes: number;
  message: string;
  errorMessage: string | null;
  updatedAt: string;
}

const LLAMA_CPP_RELEASE_BASE = "https://github.com/ggml-org/llama.cpp/releases/download/b10453";
const GEMMA_DOWNLOAD_URL = "https://huggingface.co/ggml-org/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf?download=true";
const GEMMA_4_DOWNLOAD_URL = "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf?download=true";
const QWEN_3_DOWNLOAD_URL = "https://huggingface.co/ggml-org/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q8_0.gguf?download=true";

export const LOCAL_AI_SETUP_ASSETS: readonly LocalAiSetupAsset[] = [
  {
    id: "runtime_cuda_12_4",
    kind: "runtime",
    label: "NVIDIA GPU runtime",
    description: "Official llama.cpp Windows x64 CUDA 12.4 server plus its matching CUDA runtime libraries.",
    sourceLabel: "ggml-org/llama.cpp release b10453",
    licenseLabel: "llama.cpp: MIT; CUDA runtime: NVIDIA terms",
    totalSizeBytes: 250790655 + 391443627,
    downloads: [
      {
        url: `${LLAMA_CPP_RELEASE_BASE}/llama-b10453-bin-win-cuda-12.4-x64.zip`,
        fileName: "llama-b10453-bin-win-cuda-12.4-x64.zip",
        sizeBytes: 250790655,
        sha256: "84b863f70a8b4c2873e93385d0b208f24776ecd1b946a2cb6d5cda863d143c3d"
      },
      {
        url: `${LLAMA_CPP_RELEASE_BASE}/cudart-llama-bin-win-cuda-12.4-x64.zip`,
        fileName: "cudart-llama-bin-win-cuda-12.4-x64.zip",
        sizeBytes: 391443627,
        sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6"
      }
    ],
    installLabel: "CUDA runtime"
  },
  {
    id: "runtime_cpu",
    kind: "runtime",
    label: "CPU runtime",
    description: "Official llama.cpp Windows x64 CPU server for machines without a compatible GPU runtime.",
    sourceLabel: "ggml-org/llama.cpp release b10453",
    licenseLabel: "llama.cpp: MIT",
    totalSizeBytes: 18464078,
    downloads: [
      {
        url: `${LLAMA_CPP_RELEASE_BASE}/llama-b10453-bin-win-cpu-x64.zip`,
        fileName: "llama-b10453-bin-win-cpu-x64.zip",
        sizeBytes: 18464078,
        sha256: "70c07211d0027305f0be09cd755d79641ebb0bb646590ff3d498c66b22df29b0"
      }
    ],
    installLabel: "CPU runtime"
  },
  {
    id: "model_gemma_3_12b_q4_k_m",
    kind: "model",
    label: "Gemma 3 12B IT Q4_K_M",
    description: "Balanced text-and-image-capable model for metadata, channel performance, and clip proposals.",
    sourceLabel: "ggml-org/gemma-3-12b-it-GGUF on Hugging Face",
    licenseLabel: "Gemma Terms of Use and Prohibited Use Policy",
    totalSizeBytes: 7300574976,
    downloads: [
      {
        url: GEMMA_DOWNLOAD_URL,
        fileName: "gemma-3-12b-it-Q4_K_M.gguf",
        sizeBytes: 7300574976,
        sha256: "7bb69bff3f48a7b642355d64a90e481182a7794707b3133890646b1efa778ff5"
      }
    ],
    installLabel: "Text generation model",
    tier: "quality",
    capabilities: ["text"],
    taskLabels: ["Metadata", "Performance", "Clip discovery"],
    minimumSystemMemoryBytes: 16 * 1024 * 1024 * 1024,
    recommendedSystemMemoryBytes: 24 * 1024 * 1024 * 1024,
    recommendedGpuMemoryBytes: 12 * 1024 * 1024 * 1024,
    estimatedWorkingSetBytes: 10 * 1024 * 1024 * 1024
  },
  {
    id: "model_gemma_4_e4b_q4_0",
    kind: "model",
    label: "Gemma 4 E4B IT Q4_0",
    description: "Fast, compact instruction model for metadata and channel performance on modest hardware.",
    sourceLabel: "ggml-org/gemma-4-E4B-it-GGUF on Hugging Face",
    licenseLabel: "Apache 2.0",
    totalSizeBytes: 4_590_000_000,
    downloads: [
      {
        url: GEMMA_4_DOWNLOAD_URL,
        fileName: "gemma-4-E4B-it-Q4_0.gguf",
        sizeBytes: 4_590_000_000,
        sha256: "a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2"
      }
    ],
    installLabel: "Balanced model",
    tier: "balanced",
    capabilities: ["text"],
    taskLabels: ["Metadata", "Performance"],
    minimumSystemMemoryBytes: 8 * 1024 * 1024 * 1024,
    recommendedSystemMemoryBytes: 16 * 1024 * 1024 * 1024,
    recommendedGpuMemoryBytes: 6 * 1024 * 1024 * 1024,
    estimatedWorkingSetBytes: 7 * 1024 * 1024 * 1024
  },
  {
    id: "model_qwen3_8b_q8_0",
    kind: "model",
    label: "Qwen3 8B Q8_0",
    description: "Higher-quality text reasoning model for creators with more available memory.",
    sourceLabel: "ggml-org/Qwen3-8B-GGUF on Hugging Face",
    licenseLabel: "Apache 2.0",
    totalSizeBytes: 8_710_000_000,
    downloads: [
      {
        url: QWEN_3_DOWNLOAD_URL,
        fileName: "Qwen3-8B-Q8_0.gguf",
        sizeBytes: 8_710_000_000,
        sha256: "2f98cff159bcdf01431829406d43363ccacb76ed6b76d18bd9d6ab20976792c0"
      }
    ],
    installLabel: "Quality model",
    tier: "quality",
    capabilities: ["text"],
    taskLabels: ["Metadata", "Performance", "Clip discovery"],
    minimumSystemMemoryBytes: 16 * 1024 * 1024 * 1024,
    recommendedSystemMemoryBytes: 24 * 1024 * 1024 * 1024,
    recommendedGpuMemoryBytes: 12 * 1024 * 1024 * 1024,
    estimatedWorkingSetBytes: 12 * 1024 * 1024 * 1024
  }
] as const;

export function getLocalAiSetupAsset(assetId: LocalAiSetupAssetId): LocalAiSetupAsset {
  const asset = LOCAL_AI_SETUP_ASSETS.find((candidate) => candidate.id === assetId);
  if (!asset) {
    throw new Error(`Unknown local AI setup asset: ${assetId}`);
  }
  return asset;
}

export function getRecommendedLocalAiRuntimeId(
  runtime: LocalAiRuntimeStatus | null,
  environment: CreatorSetupEnvironment | null = null
): "runtime_cuda_12_4" | "runtime_cpu" {
  const hardwareBackend = environment?.hardware?.gpuBackend;
  if (hardwareBackend === "cuda") {
    return "runtime_cuda_12_4";
  }

  const gpuSummary = runtime?.gpuSummary?.toLowerCase() ?? "";
  return gpuSummary.includes("nvidia") || gpuSummary.includes("geforce") ? "runtime_cuda_12_4" : "runtime_cpu";
}

export function getRecommendedLocalAiModelId(
  environment: CreatorSetupEnvironment | null,
  runtime: LocalAiRuntimeStatus | null = null
): Extract<LocalAiSetupAssetId, `model_${string}`> {
  const hardware = environment?.hardware;
  const systemMemoryBytes = hardware?.systemMemoryBytes ?? 0;
  const gpuMemoryBytes = hardware?.gpuMemoryBytes ?? 0;
  const hasStrongMemory = systemMemoryBytes >= 24 * 1024 * 1024 * 1024;
  const hasQualityGpu = gpuMemoryBytes >= 12 * 1024 * 1024 * 1024;

  if (hasStrongMemory && hasQualityGpu) {
    return "model_qwen3_8b_q8_0";
  }

  if (systemMemoryBytes >= 16 * 1024 * 1024 * 1024 || gpuMemoryBytes >= 8 * 1024 * 1024 * 1024) {
    return "model_gemma_3_12b_q4_k_m";
  }

  if (runtime?.availableModels.some((model) => model.compatibilityLabel === "gemma3:12b")) {
    return "model_gemma_3_12b_q4_k_m";
  }

  return "model_gemma_4_e4b_q4_0";
}

export function getLocalAiSetupRecommendation(
  environment: CreatorSetupEnvironment | null,
  runtime: LocalAiRuntimeStatus | null = null
): LocalAiSetupRecommendation {
  const runtimeId = getRecommendedLocalAiRuntimeId(runtime, environment);
  const modelId = getRecommendedLocalAiModelId(environment, runtime);
  const hardware = environment?.hardware;
  const ramGb = formatMemoryGb(hardware?.systemMemoryBytes);
  const vramGb = formatMemoryGb(hardware?.gpuMemoryBytes);
  const runtimeLabel = runtimeId === "runtime_cuda_12_4" ? "CUDA acceleration" : "CPU-safe execution";

  return {
    runtimeId,
    modelId,
    reason: hardware?.gpuName
      ? `${hardware.gpuName} with ${vramGb} GPU memory and ${ramGb} system memory supports ${runtimeLabel}.`
      : `${ramGb} system memory is best matched with a compact model and ${runtimeLabel}.`,
    memoryDetail: `Estimated working set: ${formatMemoryGb(getLocalAiSetupAsset(modelId).estimatedWorkingSetBytes)}.`
  };
}

export function getLocalAiModelAssets(): LocalAiSetupAsset[] {
  return LOCAL_AI_SETUP_ASSETS.filter((asset) => asset.kind === "model").map((asset) => ({
    ...asset,
    downloads: asset.downloads.map((download) => ({ ...download })),
    capabilities: asset.capabilities ? [...asset.capabilities] : undefined,
    taskLabels: asset.taskLabels ? [...asset.taskLabels] : undefined
  }));
}

function formatMemoryGb(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) {
    return "unknown";
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
}
