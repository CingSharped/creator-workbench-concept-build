const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LOCAL_AI_SETUP_ASSETS,
  getLocalAiSetupAsset,
  getLocalAiModelAssets,
  getRecommendedLocalAiModelId,
  getRecommendedLocalAiRuntimeId,
  getLocalAiSetupRecommendation
} = require("../dist/shared/localAiSetup.js");

test("guided local AI setup exposes verified official runtime and model packs", () => {
  assert.deepEqual(
    LOCAL_AI_SETUP_ASSETS.map((asset) => asset.id),
    [
      "runtime_cuda_12_4",
      "runtime_cpu",
      "model_gemma_3_12b_q4_k_m",
      "model_gemma_4_e4b_q4_0",
      "model_qwen3_8b_q8_0"
    ]
  );

  const cuda = getLocalAiSetupAsset("runtime_cuda_12_4");
  assert.equal(cuda.downloads.length, 2);
  assert.match(cuda.downloads[0].url, /github\.com\/ggml-org\/llama\.cpp\/releases/);
  assert.equal(cuda.downloads.every((download) => /^[a-f0-9]{64}$/.test(download.sha256)), true);

  const model = getLocalAiSetupAsset("model_gemma_3_12b_q4_k_m");
  assert.match(model.downloads[0].url, /huggingface\.co\/ggml-org\/gemma-3-12b-it-GGUF/);
  assert.equal(model.downloads[0].sizeBytes, 7300574976);
  assert.equal(model.licenseLabel.length > 0, true);

  const modelAssets = getLocalAiModelAssets();
  assert.equal(modelAssets.length, 3);
  assert.equal(modelAssets.every((asset) => asset.kind === "model"), true);
  assert.equal(modelAssets.every((asset) => asset.downloads.every((download) => /^[a-f0-9]{64}$/.test(download.sha256))), true);
});

test("guided setup recommends CUDA only when an NVIDIA GPU is detected", () => {
  assert.equal(
    getRecommendedLocalAiRuntimeId({ gpuSummary: "Detected GPU: NVIDIA GeForce RTX 4090" }),
    "runtime_cuda_12_4"
  );
  assert.equal(getRecommendedLocalAiRuntimeId({ gpuSummary: "No GPU information was detected" }), "runtime_cpu");
  assert.equal(getRecommendedLocalAiRuntimeId(null), "runtime_cpu");
});

test("hardware-aware setup recommends a quality model for a well-equipped machine", () => {
  const environment = {
    hardware: {
      cpuCores: 16,
      systemMemoryBytes: 32 * 1024 * 1024 * 1024,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuVendor: "nvidia",
      gpuMemoryBytes: 24 * 1024 * 1024 * 1024,
      gpuBackend: "cuda",
      detectionDetail: "test"
    }
  };

  assert.equal(getRecommendedLocalAiRuntimeId(null, environment), "runtime_cuda_12_4");
  assert.equal(getRecommendedLocalAiModelId(environment), "model_qwen3_8b_q8_0");
  const recommendation = getLocalAiSetupRecommendation(environment);
  assert.equal(recommendation.runtimeId, "runtime_cuda_12_4");
  assert.equal(recommendation.modelId, "model_qwen3_8b_q8_0");
  assert.match(recommendation.reason, /RTX 4090/);
});

test("hardware-aware setup keeps modest machines on the compact model", () => {
  const environment = {
    hardware: {
      cpuCores: 4,
      systemMemoryBytes: 8 * 1024 * 1024 * 1024,
      gpuName: null,
      gpuVendor: "unknown",
      gpuMemoryBytes: null,
      gpuBackend: "cpu",
      detectionDetail: "test"
    }
  };

  assert.equal(getRecommendedLocalAiRuntimeId(null, environment), "runtime_cpu");
  assert.equal(getRecommendedLocalAiModelId(environment), "model_gemma_4_e4b_q4_0");
});
