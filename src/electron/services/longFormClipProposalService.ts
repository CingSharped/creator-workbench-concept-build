import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ClipRecord,
  ClipApprovalReceipt,
  ClipProposalGenerationResult,
  AiGenerationProvenance,
  LongFormClipApprovalResult,
  LongFormClipProposalAnalysis,
  LongFormClipVisualEvidence,
  LongFormClipProposalRecord,
  StackedVerticalLayoutSettings,
  TranscriptRecord,
  TranscriptSegmentRecord
} from "../../shared/contracts";
import { sanitizeClipFileName, suggestClipFileName } from "../../shared/clipFileName";
import { parseJsonResponse } from "../../shared/jsonResponse";
import { isStrictAiModeEnabled, resolveAiProfileForTask } from "./aiProfileService";
import { buildAiProfileLearningContext, type AiProfileLearningContext } from "./aiProfileLearningService";
import {
  listClipProposalsBySourceId,
  recordClipProposalDecision,
  recordClipProposalReopened,
  replaceClipProposalsForSource
} from "./clipProposalRepository";
import { importClipPaths } from "./clipImportService";
import { exportStackedVerticalMedia, validateStackedVerticalLayout } from "./clipTrimService";
import { readDatabase } from "./database";
import { setAiActivityCancel, setAiActivityDetail } from "./aiActivityService";
import { getClipById, setClipLineage } from "./clipRepository";
import { generateAiText, generateAiVision } from "./aiExecutionService";
import { analyzeCandidateMedia } from "./mediaAnalysisService";
import { getLongFormSourceById } from "./longFormSourceRepository";
import { getTranscriptByLongFormSourceId } from "./transcriptRepository";
import { getWorkspaceFolderSetting } from "./workspacePreferences";
import { hashApprovalArtifact, publishApprovalArtifact, saveClipApprovalReceipt, verifyApprovalArtifact } from "./clipApprovalRecovery";

const MODEL_PREFERENCE = ["qwen3:14b", "gemma3:12b", "mistral-small:24b"];
const VERIFIED_QWEN25_VL_MODEL = "Qwen2.5-VL-7B-Instruct-Q4_K_M-ggml-org-official.gguf";
export const CLIP_PROPOSAL_WINDOW_MAX_CHARS = 8_000;
export const CLIP_PROPOSAL_CANCELLED_MESSAGE = "Clip proposal generation cancelled.";
const CLIP_PROPOSAL_MIN_DURATION_MS = 5_000;
const CLIP_PROPOSAL_MAX_DURATION_MS = 90_000;
const CLIP_PROPOSAL_SEGMENT_TEXT_MAX_CHARS = 240;
const activeClipProposalControllers = new Map<string, AbortController>();
const activeApprovals = new Set<string>();
const DEFAULT_APPROVAL_LAYOUT: StackedVerticalLayoutSettings = {
  topFocusX: 0.5,
  topFocusY: 0.5,
  topScale: 1,
  bottomFocusX: 0.5,
  bottomFocusY: 0.5,
  bottomScale: 1
};

interface RawClipProposal {
  startMs?: unknown;
  endMs?: unknown;
  start?: unknown;
  end?: unknown;
  hook?: unknown;
  title?: unknown;
  reason?: unknown;
  evidence?: unknown;
  confidence?: unknown;
  score?: unknown;
  evidenceSegmentIds?: unknown;
}

export async function generateLongFormClipProposals(sourceId: string): Promise<ClipProposalGenerationResult> {
  if (activeClipProposalControllers.has(sourceId)) {
    throw new Error("Clip proposal generation is already running for this source.");
  }

  const controller = new AbortController();
  activeClipProposalControllers.set(sourceId, controller);
  const clearActivityCancel = setAiActivityCancel(() => controller.abort());

  try {
    return await generateLongFormClipProposalsInternal(sourceId, controller.signal);
  } finally {
    clearActivityCancel();
    if (activeClipProposalControllers.get(sourceId) === controller) {
      activeClipProposalControllers.delete(sourceId);
    }
  }
}

export function cancelLongFormClipProposals(sourceId: string): boolean {
  const controller = activeClipProposalControllers.get(sourceId);
  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}

async function generateLongFormClipProposalsInternal(
  sourceId: string,
  signal: AbortSignal
): Promise<ClipProposalGenerationResult> {
  throwIfClipProposalCancelled(signal);
  const source = getLongFormSourceById(sourceId);
  if (!source) {
    throw new Error("The selected long-form source no longer exists.");
  }

  const transcript = getTranscriptByLongFormSourceId(sourceId);
  if (!transcript || transcript.segments.length === 0) {
    throw new Error("Transcribe the long-form source before generating clip proposals.");
  }
  if (transcript.status === "incomplete") {
    throw new Error("The saved transcript is incomplete. Run a fresh transcription before generating clip proposals.");
  }

  const profile = resolveAiProfileForTask("clip_discovery");
  const profileLearning = buildAiProfileLearningContext(profile);
  const aiResult = await tryGenerateWithLocalAi(sourceId, source.displayName, transcript, profile, signal, profileLearning);
  if (aiResult.proposals.length > 0) {
    const enriched = await enrichClipProposals(source.sourcePath, aiResult.proposals, transcript, profile, signal, profileLearning);
    const proposals = replaceClipProposalsForSource(sourceId, enriched.proposals, {
      provenance: buildProposalProvenance(sourceId, transcript.id, aiResult.model, aiResult.profileId, aiResult.executionMode, profileLearning.provenance)
    });
    return {
      ...aiResult,
      proposals,
      issueSummary: joinIssues(aiResult.issueSummary, enriched.issueSummary),
      note: enriched.note
    };
  }

  if (isStrictAiModeEnabled()) {
    throw new Error(
      `Strict AI mode blocked clip proposals: ${aiResult.issueSummary ?? "the local AI returned no usable candidates."}`
    );
  }

  const fallback = buildTranscriptClipProposalHeuristics(sourceId, transcript);
  if (fallback.length === 0) {
    throw new Error("The transcript did not contain enough timestamped material for a clip proposal.");
  }

  const enriched = await enrichClipProposals(source.sourcePath, fallback, transcript, profile, signal, profileLearning);
  const proposals = replaceClipProposalsForSource(sourceId, enriched.proposals, {
    provenance: buildProposalProvenance(sourceId, transcript.id, aiResult.model, profile?.id ?? null, "fallback", profileLearning.provenance)
  });
  return {
    sourceId,
    proposals,
    model: aiResult.model,
    profileId: profile?.id ?? null,
    profileName: profile?.name ?? null,
    executionMode: "fallback",
    issueSummary: joinIssues(aiResult.issueSummary ?? "The local AI returned no usable clip candidates.", enriched.issueSummary),
    note: enriched.note
  };
}

function buildProposalProvenance(
  sourceId: string,
  transcriptId: string,
  model: string | null,
  profileId: string | null,
  executionMode: AiGenerationProvenance["executionMode"],
  learningContext: AiProfileLearningContext["provenance"]
): AiGenerationProvenance {
  return {
    task: "clip_discovery",
    profileId,
    model,
    executionMode,
    inputRecordIds: [sourceId, transcriptId],
    learningExampleClipIds: [],
    learningContext
  };
}

export async function approveLongFormClipProposal(
  sourceId: string,
  proposalId: string,
  startMs: number,
  endMs: number,
  layout: StackedVerticalLayoutSettings = DEFAULT_APPROVAL_LAYOUT,
  fileName?: string
): Promise<LongFormClipApprovalResult> {
  if (activeApprovals.has(proposalId)) throw new Error("Approval is already running for this proposal.");
  activeApprovals.add(proposalId);
  try {
    return await approveLongFormClipProposalInternal(sourceId, proposalId, startMs, endMs, layout, fileName);
  } finally {
    activeApprovals.delete(proposalId);
  }
}

async function approveLongFormClipProposalInternal(
  sourceId: string,
  proposalId: string,
  startMs: number,
  endMs: number,
  layout: StackedVerticalLayoutSettings,
  fileName?: string
): Promise<LongFormClipApprovalResult> {
  const source = getLongFormSourceById(sourceId);
  if (!source) {
    throw new Error("The selected long-form source no longer exists.");
  }

  const proposal = listClipProposalsBySourceId(sourceId).find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error("The selected clip proposal no longer exists.");
  }
  if (proposal.status === "approved" && proposal.approvedClipId) {
    const approvedClip = getClipById(proposal.approvedClipId);
    if (!approvedClip) {
      throw new Error("This proposal is marked approved, but its clip record is missing. Do not render it again until the clip library is repaired.");
    }
    if (!existsSync(approvedClip.sourcePath)) {
      throw new Error("The approved clip file is missing. Repair the clip library before retrying.");
    }
    return {
      proposal,
      clip: approvedClip,
      outputPath: approvedClip.sourcePath
    };
  }
  if (proposal.status === "approved") {
    throw new Error("This proposal is marked approved but has no linked clip record. Do not render it again until the proposal state is repaired.");
  }
  if (proposal.status === "rejected") {
    throw new Error("A rejected clip proposal cannot be approved. Generate proposals again if needed.");
  }

  const clipLibraryFolder = getWorkspaceFolderSetting("clipLibrary");
  if (!clipLibraryFolder) {
    throw new Error("Configure the Clip Library Folder in Settings before approving a long-form clip.");
  }

  const normalizedStartMs = normalizeProposalTrimPoint(startMs, "start");
  const normalizedEndMs = normalizeProposalTrimPoint(endMs, "end");
  if (normalizedEndMs <= normalizedStartMs) {
    throw new Error("The approval trim end must be after the trim start.");
  }
  if (source.durationMs !== null && normalizedEndMs > source.durationMs) {
    throw new Error("The approval trim end cannot be after the source duration.");
  }

  validateStackedVerticalLayout(layout);
  await mkdir(clipLibraryFolder, { recursive: true });
  const requestedFileName = sanitizeClipFileName(fileName?.trim() || suggestClipFileName(source.displayName, proposal.hook));
  let receipt = proposal.approvalReceipt;
  if (receipt && (receipt.startMs !== normalizedStartMs || receipt.endMs !== normalizedEndMs ||
    receipt.requestedFileName !== requestedFileName ||
    Object.keys(DEFAULT_APPROVAL_LAYOUT).some((key) => receipt!.layout[key as keyof StackedVerticalLayoutSettings] !== layout[key as keyof StackedVerticalLayoutSettings]))) {
    throw new Error("An unfinished approval exists with different trim, layout or filename settings. Retry using the original settings before making another edit.");
  }
  if (!receipt) {
    const sourceStat = await stat(source.sourcePath);
    const id = randomUUID();
    receipt = {
      id, stage: "rendering", outputPath: buildApprovedClipPath(clipLibraryFolder, source.displayName, proposal, fileName),
      stagingPath: path.join(clipLibraryFolder, ".creator-workbench-approvals", `${id}.mp4`),
      sourcePath: source.sourcePath, sourceSize: sourceStat.size, sourceModifiedAt: sourceStat.mtimeMs,
      startMs: normalizedStartMs, endMs: normalizedEndMs, layout: { ...layout }, requestedFileName,
      sha256: null, clipId: null
    };
    saveClipApprovalReceipt(sourceId, proposalId, receipt);
  }
  const outputPath = receipt.outputPath;
  const saveStage = (stage: ClipApprovalReceipt["stage"]): void => {
    receipt!.stage = stage;
    saveClipApprovalReceipt(sourceId, proposalId, receipt!);
  };
  // A render without a durable completion receipt is never treated as complete.
  if (receipt.stage === "rendering") {
    const sourceStat = await stat(source.sourcePath);
    if (receipt.sourcePath !== source.sourcePath || receipt.sourceSize !== sourceStat.size || receipt.sourceModifiedAt !== sourceStat.mtimeMs) {
      throw new Error("The source file changed since approval began. Repair the saved approval before retrying.");
    }
    await rm(receipt.stagingPath, { force: true });
    await exportStackedVerticalMedia({
      sourcePath: source.sourcePath,
      durationMs: source.durationMs,
      widthPx: source.widthPx,
      heightPx: source.heightPx,
      startMs: normalizedStartMs,
      endMs: normalizedEndMs,
      layout,
      outputPath: receipt.stagingPath
    });
    receipt.sha256 = await hashApprovalArtifact(receipt.stagingPath);
    saveStage("rendered");
  }
  if (receipt.stage === "rendered") {
    await publishApprovalArtifact(receipt);
    saveStage("published");
  }
  await verifyApprovalArtifact(outputPath, receipt.sha256);
  if (receipt.stage === "published") {
    const imported = await importClipPaths([outputPath], { source: "long_form_approved" });
    const clipId = imported.importedClipIds[0];
    if (!clipId) {
      throw new Error("The rendered clip could not be added to the clip library.");
    }
    receipt.clipId = clipId;
    saveStage("imported");
  }
  const clipId = receipt.clipId;
  if (!clipId || !getClipById(clipId)) throw new Error("The saved approval clip record is missing. The render was preserved for repair.");
  setClipLineage(clipId, {
    sourceType: "long_form_source",
    sourceId,
    proposalId,
    startMs: normalizedStartMs,
    endMs: normalizedEndMs
  });

  const approvedProposal = recordClipProposalDecision({
    sourceId,
    proposalId,
    decision: "approved",
    selectedStartMs: normalizedStartMs,
    selectedEndMs: normalizedEndMs,
    layout,
    approvedClipId: clipId,
    rejectionReason: null
  }).proposal;
  const clip = readImportedClip(clipId);
  // Only the private staging link is disposable. Never delete the library file.
  await rm(receipt.stagingPath, { force: true }).catch(() => undefined);
  return { proposal: approvedProposal, clip, outputPath };
}

export function rejectLongFormClipProposal(sourceId: string, proposalId: string, reason?: string): LongFormClipProposalRecord {
  const proposal = listClipProposalsBySourceId(sourceId).find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error("The selected clip proposal no longer exists.");
  }
  if (proposal.status === "approved") {
    throw new Error("An approved clip proposal cannot be rejected after it has entered the clip library.");
  }
  if (activeApprovals.has(proposalId)) {
    throw new Error("Wait for the running approval to finish before rejecting this proposal.");
  }

  return recordClipProposalDecision({
    sourceId,
    proposalId,
    decision: "rejected",
    selectedStartMs: proposal.startMs,
    selectedEndMs: proposal.endMs,
    layout: null,
    approvedClipId: null,
    rejectionReason: reason?.trim() || null
  }).proposal;
}

export function reopenLongFormClipProposal(sourceId: string, proposalId: string): LongFormClipProposalRecord {
  const proposal = listClipProposalsBySourceId(sourceId).find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error("The selected clip proposal no longer exists.");
  }
  if (proposal.status === "approved") {
    throw new Error("An approved proposal cannot be reopened because its clip is already in the library.");
  }
  return recordClipProposalReopened(sourceId, proposalId);
}

function normalizeProposalTrimPoint(value: number, label: "start" | "end"): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`The approval trim ${label} must be a non-negative time.`);
  }

  return Math.round(value);
}

function buildApprovedClipPath(
  clipLibraryFolder: string,
  sourceDisplayName: string,
  proposal: LongFormClipProposalRecord,
  fileName?: string
): string {
  const baseName = sanitizeClipFileName(fileName?.trim() || suggestClipFileName(sourceDisplayName, proposal.hook));
  const basePath = path.join(clipLibraryFolder, baseName);
  const reservedPaths = new Set(readDatabase().clipProposals.flatMap((item) =>
    item.approvalReceipt ? [path.resolve(item.approvalReceipt.outputPath).toLowerCase()] : []));
  let outputPath = `${basePath}.mp4`;
  let duplicateIndex = 2;
  while (existsSync(outputPath) || reservedPaths.has(path.resolve(outputPath).toLowerCase())) {
    outputPath = `${basePath}-${duplicateIndex}.mp4`;
    duplicateIndex += 1;
  }
  return outputPath;
}

function readImportedClip(clipId: string): ClipRecord {
  const clip = getClipById(clipId);
  if (!clip) {
    throw new Error("The rendered clip was imported but could not be read back from the clip library.");
  }
  return clip;
}

async function enrichClipProposals(
  sourcePath: string,
  proposals: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">>,
  transcript: TranscriptRecord,
  profile: ReturnType<typeof resolveAiProfileForTask>,
  signal: AbortSignal,
  learningContext: AiProfileLearningContext
): Promise<{
  proposals: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">>;
  issueSummary: string | null;
  note: string;
}> {
  throwIfClipProposalCancelled(signal);
  const proposalsToEnrich = proposals;
  setAiActivityDetail(`Analysing media for ${proposals.length} candidates`);
  const mediaResults = await Promise.all(
    proposalsToEnrich.map((proposal, index) => analyzeCandidateMedia({
      sourcePath,
      startMs: proposal.startMs,
      endMs: proposal.endMs,
      includeFrames: index < 3,
      signal
    }))
  );
  throwIfClipProposalCancelled(signal);
  const issues = mediaResults
    .map((result) => result.issue)
    .filter((issue): issue is string => Boolean(issue));
  const visualResults = await Promise.all(
    mediaResults.slice(0, 3).map(async (result, index) => {
      if (result.frames.length === 0) {
        issues.push(`Visual review candidate ${index + 1}: no sampled frames were available.`);
        return null;
      }

      try {
        setAiActivityDetail(`Visual review · candidate ${index + 1} of ${Math.min(3, mediaResults.length)}`);
        const response = await generateAiVision({
          task: "clip_discovery",
          profileId: profile?.id ?? null,
          preferredModel: VERIFIED_QWEN25_VL_MODEL,
          fallbackPreferences: ["qwen2.5-vl:7b"],
          systemPrompt: [
            "Review sampled video frames as visual evidence for a gaming short. Return exactly one JSON object and nothing else. Never return an array or a content wrapper. Use exactly the requested keys and numeric scores from 0 to 1. Describe only what is visibly supported; do not invent gameplay events, speech, emotion, audio, or context that cannot be seen.",
            learningContext.prompt
          ].filter(Boolean).join("\n\n"),
          userPrompt: buildVisualReviewPrompt(proposalsToEnrich[index]!, transcript, result.frameTimestampsMs),
          imageDataUrls: result.frames,
          responseSchema: buildVisualReviewSchema(),
          temperature: 0.1,
          timeoutMs: 120_000,
          signal
        });
        const parsed = parseJsonResponse(response.responseText);
        const review = parseVisualClipReview(parsed, result.frameTimestampsMs);
        if (!review) {
          throw new Error("The local vision model returned unusable structured visual evidence.");
        }
        if (response.runtimeNotice) {
          issues.push(`Visual review candidate ${index + 1}: ${response.runtimeNotice}`);
        }
        return {
          index,
          review,
          model: response.model
        };
      } catch (error) {
        if (signal.aborted) {
          throw createClipProposalCancelledError();
        }
        issues.push(`Visual review candidate ${index + 1}: ${error instanceof Error ? error.message : "The local vision review failed."}`);
        return null;
      }
    })
  );

  const visualFailures = visualResults.filter((result) => result === null).length;
  throwIfClipProposalCancelled(signal);
  if (isStrictAiModeEnabled() && visualResults.length > 0 && visualFailures > 0) {
    throw new Error(
      `Strict AI mode blocked clip proposals because sampled-frame visual review was unavailable. ${issues.filter((issue) => issue.startsWith("Visual review candidate")).join(" ")}`
    );
  }

  const visualByIndex = new Map(
    visualResults
      .filter((result): result is { index: number; review: LongFormClipVisualEvidence; model: string } => Boolean(result?.review))
      .map((result) => [result.index, result.review] as const)
  );
  const visualModelByIndex = new Map(
    visualResults
      .filter((result): result is { index: number; review: LongFormClipVisualEvidence; model: string } => Boolean(result?.review))
      .map((result) => [result.index, result.model] as const)
  );
  const enriched = proposalsToEnrich.map((proposal, index) => {
    const mediaResult = mediaResults[index]!;
    const visual = visualByIndex.get(index);
    const visualModel = visualModelByIndex.get(index) ?? null;
    const analysis: LongFormClipProposalAnalysis = {
      ...mediaResult.analysis,
      visualScore: visual?.overallScore ?? null,
      visualSummary: visual?.summary ?? null,
      visualModel,
      visualEvidence: visual ?? null,
      mediaScore: combineProposalScores(mediaResult.analysis.mediaScore, visual?.overallScore ?? null)
    };
    return {
      ...proposal,
      confidence: calculateCombinedConfidence(proposal.confidence, analysis),
      analysis
    };
  }).sort((left, right) => right.confidence - left.confidence);

  const hasVisual = enriched.some((proposal) => proposal.analysis?.visualEvidence !== null && proposal.analysis?.visualEvidence !== undefined);
  const hasMedia = enriched.some((proposal) => proposal.analysis?.mediaScore !== null && proposal.analysis?.mediaScore !== undefined);
  return {
    proposals: enriched,
    issueSummary: issues.length > 0 ? [...new Set(issues)].join(" ") : null,
    note: hasVisual
      ? `Ranked transcript candidates with measured audio/scene signals and sampled-frame review using the local vision runtime${profile?.name ? ` for ${profile.name}` : ""}.`
      : hasMedia
        ? "Ranked transcript candidates with measured audio loudness, speech/silence coverage, and scene-change signals. Semantic frame review was unavailable."
        : "Transcript-led candidates were returned because media signals were unavailable. Review every range before exporting."
  };
}

function buildVisualReviewPrompt(
  proposal: LongFormClipProposalRecord | Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">,
  transcript: TranscriptRecord,
  frameTimestampsMs: number[]
): string {
  const evidence = transcript.segments
    .filter((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.startMs! < proposal.endMs && segment.endMs! > proposal.startMs)
    .map((segment) => segment.text.trim())
    .join(" ")
    .slice(0, 1_200);
  const frameLabels = frameTimestampsMs
    .map((timestamp, index) => `Frame ${index + 1}: ${formatMilliseconds(proposal.startMs + timestamp)}`)
    .join(", ");
  return `Assess this proposed gaming clip from ${formatMilliseconds(proposal.startMs)} to ${formatMilliseconds(proposal.endMs)} using only the supplied sampled frames and transcript context. The sampled frame timestamps are ${frameLabels || "unavailable"}. Return exactly one JSON object, never an array, with exactly these keys: actionReactionScore, visualClarityContextScore, sceneChangeScore, onScreenImportanceScore, summary, evidence, limitations. Score each dimension from 0 to 1: actionReactionScore means visible gameplay action or human reaction; visualClarityContextScore means the moment is readable and its visual context is clear; sceneChangeScore means a meaningful visible change or escalation is present across the sampled frames; onScreenImportanceScore means the important gameplay, UI, or reaction is actually visible. Use 0 for a dimension that cannot be judged and explain why in limitations. Include short evidence statements tied to visible frames and list limitations such as sparse sampling. Do not add dimension objects, audio scores, a content wrapper, markdown, or invented continuity between frames.`;
}

function buildVisualReviewSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      actionReactionScore: { type: "number" },
      visualClarityContextScore: { type: "number" },
      sceneChangeScore: { type: "number" },
      onScreenImportanceScore: { type: "number" },
      summary: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      limitations: { type: "array", items: { type: "string" } }
    },
    required: [
      "actionReactionScore",
      "visualClarityContextScore",
      "sceneChangeScore",
      "onScreenImportanceScore",
      "summary",
      "evidence",
      "limitations"
    ]
  };
}

export function parseVisualClipReview(value: unknown, frameTimestampsMs: number[]): LongFormClipVisualEvidence | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const actionReactionScore = readVisualScore(raw.actionReactionScore ?? raw.actionReaction);
  const visualClarityContextScore = readVisualScore(raw.visualClarityContextScore ?? raw.visualClarity ?? raw.contextClarityScore);
  const sceneChangeScore = readVisualScore(raw.sceneChangeScore ?? raw.sceneChange);
  const onScreenImportanceScore = readVisualScore(raw.onScreenImportanceScore ?? raw.onScreenImportance);
  const summary = text(raw.summary);
  if (
    actionReactionScore === null ||
    visualClarityContextScore === null ||
    sceneChangeScore === null ||
    onScreenImportanceScore === null ||
    !summary
  ) {
    return null;
  }
  const evidence = readVisualTextList(raw.evidence);
  const limitations = readVisualTextList(raw.limitations ?? raw.limitationsText);
  const overallScore = (actionReactionScore + visualClarityContextScore + sceneChangeScore + onScreenImportanceScore) / 4;
  return {
    actionReactionScore,
    visualClarityContextScore,
    sceneChangeScore,
    onScreenImportanceScore,
    overallScore: clampConfidence(overallScore),
    summary: summary.slice(0, 300),
    evidence: evidence.slice(0, 4).map((item) => item.slice(0, 240)),
    limitations: limitations.slice(0, 3).map((item) => item.slice(0, 240)),
    frameTimestampsMs: frameTimestampsMs.filter((value) => Number.isFinite(value)).map((value) => Math.max(0, Math.round(value)))
  };
}

function readVisualScore(value: unknown): number | null {
  const rawValue = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { score?: unknown }).score
    : value;
  const parsed = numeric(rawValue);
  return parsed === null ? null : clampConfidence(parsed > 1 ? parsed / 100 : parsed);
}

function readVisualTextList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function calculateCombinedConfidence(baseConfidence: number, analysis: LongFormClipProposalAnalysis): number {
  const mediaScore = analysis.mediaScore;
  const visualScore = analysis.visualScore;
  if (mediaScore === null && visualScore === null) {
    return baseConfidence;
  }
  if (visualScore === null) {
    return clampConfidence(baseConfidence * 0.7 + (mediaScore ?? 0) * 0.3);
  }
  return clampConfidence(baseConfidence * 0.55 + (mediaScore ?? 0) * 0.25 + visualScore * 0.2);
}

function combineProposalScores(mediaScore: number | null, visualScore: number | null): number | null {
  if (mediaScore === null) {
    return visualScore;
  }
  if (visualScore === null) {
    return mediaScore;
  }
  return mediaScore * 0.6 + visualScore * 0.4;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function joinIssues(first: string | null, second: string | null): string | null {
  return [first, second].filter((issue): issue is string => Boolean(issue)).join(" ") || null;
}

function formatMilliseconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function parseClipProposalResponse(
  value: unknown,
  sourceId: string,
  transcript: TranscriptRecord
): Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">> {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { proposals?: unknown }).proposals)
      ? (value as { proposals: unknown[] }).proposals
      : [];
  const segments = transcript.segments.filter(
    (segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.endMs! > segment.startMs!
  );
  const sourceDuration = segments.length > 0 ? Math.max(...segments.map((segment) => segment.endMs!)) : null;

  return raw
    .map((item) => normalizeRawProposal(item as RawClipProposal, sourceId, segments, sourceDuration))
    .filter((proposal): proposal is Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt"> => proposal !== null)
    .sort((left, right) => right.confidence - left.confidence);
}

export function buildClipProposalPromptWindows(transcript: TranscriptRecord): TranscriptSegmentRecord[][] {
  const segments = transcript.segments.filter(
    (segment) => segment.startMs !== null && segment.endMs !== null && segment.text.trim()
  );
  const windows: TranscriptSegmentRecord[][] = [];
  let currentWindow: TranscriptSegmentRecord[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const lineLength = formatProposalSegment(segment).length + 1;
    if (currentWindow.length > 0 && currentChars + lineLength > CLIP_PROPOSAL_WINDOW_MAX_CHARS) {
      windows.push(currentWindow);
      currentWindow = [];
      currentChars = 0;
    }

    currentWindow.push(segment);
    currentChars += lineLength;
  }

  if (currentWindow.length > 0) {
    windows.push(currentWindow);
  }

  return windows;
}

export function buildTranscriptClipProposalHeuristics(
  sourceId: string,
  transcript: TranscriptRecord
): Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">> {
  const segments = transcript.segments.filter(
    (segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.text.trim().length > 0
  );
  const scored = segments
    .map((segment) => ({ segment, score: scoreSegment(segment) }))
    .sort((left, right) => right.score - left.score);
  const selected: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">> = [];

  for (const candidate of scored) {
    if (candidate.score <= 0 || selected.some((proposal) => overlaps(proposal, candidate.segment))) {
      continue;
    }
    const startMs = Math.max(0, candidate.segment.startMs! - 10_000);
    const endMs = Math.min(candidate.segment.endMs! + 20_000, startMs + 60_000);
    selected.push({
      sourceId,
      startMs,
      endMs,
      hook: candidate.segment.text.trim().slice(0, 140),
      reason: "Transcript contains a locally scored gaming moment with a likely hook or payoff.",
      confidence: Math.min(0.85, 0.45 + candidate.score * 0.08),
      evidenceSegmentIds: [candidate.segment.id],
      status: "proposed"
    });
  }

  return selected;
}

async function tryGenerateWithLocalAi(
  sourceId: string,
  displayName: string,
  transcript: TranscriptRecord,
  profile: ReturnType<typeof resolveAiProfileForTask>,
  signal: AbortSignal,
  learningContext: AiProfileLearningContext
): Promise<{
  sourceId: string;
  proposals: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">>;
  model: string | null;
  profileId: string | null;
  profileName: string | null;
  executionMode: "ai";
  issueSummary: string | null;
  note: string | null;
}> {
  const profileId = profile?.id ?? null;
  const profileName = profile?.name ?? null;
  const windows = buildClipProposalPromptWindows(transcript);
  const allProposals: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">> = [];
  const issues: string[] = [];
  let selectedModel: string | null = null;
  const profileLearningPrompt = learningContext.prompt;

  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    throwIfClipProposalCancelled(signal);
    setAiActivityDetail(`Transcript window ${windowIndex + 1} of ${windows.length}`);
    const response = await generateAiText({
      task: "clip_discovery",
      profileId: profile?.id ?? null,
      preferredModel: profile?.preferredModel ?? null,
      fallbackPreferences: MODEL_PREFERENCE,
      systemPrompt: [
        profile?.systemPrompt || "Return only valid JSON matching the supplied clip proposal schema. Use only transcript evidence.",
        profileLearningPrompt
      ].filter(Boolean).join("\n\n"),
      userPrompt: buildProposalPrompt(displayName, windows[windowIndex], windowIndex, windows.length),
      responseSchema: buildProposalSchema(),
      disableThinking: true,
      temperature: 0.25,
      signal
    }).catch((error) => {
      if (signal.aborted) {
        throw createClipProposalCancelledError();
      }
      return { error };
    });

    if ("error" in response) {
      issues.push(
        `Window ${windowIndex + 1} of ${windows.length}: ${response.error instanceof Error ? response.error.message : "The local AI request failed."}`
      );
      continue;
    }

    selectedModel = selectedModel ?? response.model;
    const parsed = parseJsonResponse(response.responseText);
    const proposals = parseClipProposalResponse(parsed, sourceId, transcript);
    if (proposals.length === 0) {
      issues.push(`Window ${windowIndex + 1} of ${windows.length}: the local AI returned no usable clip proposals.`);
      continue;
    }

    allProposals.push(...proposals);
  }

  const proposals = deduplicateClipProposals(allProposals).sort((left, right) => right.confidence - left.confidence);
  return {
    sourceId,
    proposals,
    model: selectedModel,
    profileId,
    profileName,
    executionMode: "ai",
    issueSummary:
      proposals.length > 0
        ? issues.length > 0
          ? issues.join(" ")
          : null
        : issues.join(" ") || `The local AI returned no usable clip proposals${selectedModel ? ` for ${selectedModel}` : ""}.`,
    note:
      proposals.length > 0
        ? `Generated transcript-led candidates across ${windows.length} bounded transcript windows with ${selectedModel ?? "the local AI runtime"}.`
        : null
  };
}

function throwIfClipProposalCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createClipProposalCancelledError();
  }
}

function createClipProposalCancelledError(): Error {
  return new Error(CLIP_PROPOSAL_CANCELLED_MESSAGE);
}

function normalizeRawProposal(
  raw: RawClipProposal,
  sourceId: string,
  segments: TranscriptSegmentRecord[],
  sourceDuration: number | null
): Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt"> | null {
  const startMs = numeric(raw.startMs ?? raw.start);
  const endMs = numeric(raw.endMs ?? raw.end);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return null;
  }
  let boundedStart = Math.max(0, Math.round(startMs));
  let boundedEnd = Math.min(sourceDuration ?? endMs, Math.round(endMs));
  if (boundedEnd <= boundedStart || boundedEnd - boundedStart > CLIP_PROPOSAL_MAX_DURATION_MS) {
    return null;
  }
  if (boundedEnd - boundedStart < CLIP_PROPOSAL_MIN_DURATION_MS) {
    if (sourceDuration !== null && sourceDuration < CLIP_PROPOSAL_MIN_DURATION_MS) {
      return null;
    }

    const midpoint = (boundedStart + boundedEnd) / 2;
    boundedStart = Math.max(0, Math.round(midpoint - CLIP_PROPOSAL_MIN_DURATION_MS / 2));
    boundedEnd = boundedStart + CLIP_PROPOSAL_MIN_DURATION_MS;
    if (sourceDuration !== null && boundedEnd > sourceDuration) {
      boundedEnd = sourceDuration;
      boundedStart = Math.max(0, boundedEnd - CLIP_PROPOSAL_MIN_DURATION_MS);
    }
  }
  if (boundedEnd <= boundedStart || boundedEnd - boundedStart < CLIP_PROPOSAL_MIN_DURATION_MS) {
    return null;
  }
  const hook = text(raw.hook ?? raw.title);
  const reason = text(raw.reason ?? raw.evidence);
  if (!hook || !reason) {
    return null;
  }
  const rawConfidence = numeric(raw.confidence ?? raw.score);
  const confidence = rawConfidence === null ? 0.5 : rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
  const evidenceSegmentIds = Array.isArray(raw.evidenceSegmentIds)
    ? raw.evidenceSegmentIds.filter((id): id is string => typeof id === "string" && segments.some((segment) => segment.id === id))
    : segments.filter((segment) => segment.startMs! < boundedEnd && segment.endMs! > boundedStart).map((segment) => segment.id);

  return {
    sourceId,
    startMs: boundedStart,
    endMs: boundedEnd,
    hook: hook.slice(0, 240),
    reason: reason.slice(0, 500),
    confidence: Math.max(0, Math.min(1, confidence)),
    evidenceSegmentIds,
    status: "proposed"
  };
}

function buildProposalPrompt(
  displayName: string,
  segments: TranscriptSegmentRecord[],
  windowIndex: number,
  windowCount: number
): string {
  const lines = segments.map(formatProposalSegment).join("\n");
  return `Find every distinct candidate short clip supported by transcript window ${windowIndex + 1} of ${windowCount} for this long-form gaming source: ${displayName}.

Selection bar:
- Include only moments with a recognizable setup, a turn or escalation, and a payoff in the supplied timestamped transcript.
- Prefer surprising outcomes, genuine creator or collaborator interactions, funny misunderstandings, clutch decisions, failures, and escalating tension.
- Reject filler, dead air, repetitive commentary, setup without payoff, incomplete jokes, materially overlapping candidates, and claims that require unseen visuals or audio.
- There is no fixed candidate-count limit. Return every genuinely distinct qualifying moment, but return an empty proposals array when none meets the bar.

Timing and output:
- Candidates must be 5-90 seconds and use only the supplied timestamped transcript.
- If the meaningful line or reaction is shorter than 5 seconds, include the smallest surrounding setup or payoff that makes it self-contained; never return a range shorter than 5000ms.
- Prefer the tightest useful range, not a whole conversation. Rank candidates by hook strength and payoff clarity.
- Return JSON with a proposals array. Each item must include startMs, endMs, hook, reason, confidence (0-1), and evidenceSegmentIds.
- The hook must describe the specific moment, not generic hype. The reason must name the transcript evidence and why a short viewer would care.
- Use only supplied segment IDs as evidence anchors. Do not mention visual events.

TRANSCRIPT WINDOW:
${lines}`;
}

function buildProposalSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            startMs: { type: "number" },
            endMs: { type: "number" },
            hook: { type: "string" },
            reason: { type: "string" },
            confidence: { type: "number" },
            evidenceSegmentIds: { type: "array", items: { type: "string" } }
          },
          required: ["startMs", "endMs", "hook", "reason", "confidence", "evidenceSegmentIds"]
        }
      }
    },
    required: ["proposals"]
  };
}

function formatProposalSegment(segment: TranscriptSegmentRecord): string {
  return `${segment.id} | ${segment.startMs}-${segment.endMs}ms | ${segment.text.trim().slice(0, CLIP_PROPOSAL_SEGMENT_TEXT_MAX_CHARS)}`;
}

function deduplicateClipProposals(
  proposals: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">>
): Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">> {
  const selected: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">> = [];
  for (const proposal of proposals.sort((left, right) => right.confidence - left.confidence)) {
    if (selected.some((existing) => existing.startMs < proposal.endMs && existing.endMs > proposal.startMs)) {
      continue;
    }
    selected.push(proposal);
  }
  return selected;
}

function scoreSegment(segment: TranscriptSegmentRecord): number {
  const textValue = segment.text.toLowerCase();
  const terms = ["clutch", "panic", "chaos", "scream", "screamed", "funny", "insane", "unexpected", "win", "won", "lost", "died", "fail", "failed", "save"];
  return terms.reduce((score, term) => score + (textValue.includes(term) ? 1 : 0), 0);
}

function overlaps(proposal: { startMs: number; endMs: number }, segment: TranscriptSegmentRecord): boolean {
  return segment.startMs! < proposal.endMs && segment.endMs! > proposal.startMs;
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
