import { randomUUID } from "node:crypto";
import type {
  LongFormClipProposalFeedbackRecord,
  LongFormClipProposalRecord,
  StackedVerticalLayoutSettings
} from "../../shared/contracts";
import { readDatabase, updateDatabase } from "./database";

export function listClipProposalsBySourceId(sourceId: string): LongFormClipProposalRecord[] {
  return readDatabase().clipProposals
    .filter((proposal) => proposal.sourceId === sourceId)
    .sort((left, right) => right.confidence - left.confidence);
}

export function replaceClipProposalsForSource(
  sourceId: string,
  proposals: Array<Omit<LongFormClipProposalRecord, "id" | "createdAt" | "updatedAt">>,
  options: { provenance?: LongFormClipProposalRecord["provenance"] } = {}
): LongFormClipProposalRecord[] {
  const now = new Date().toISOString();
  const generationId = randomUUID();
  const records = proposals.map((proposal) => ({
    ...proposal,
    id: randomUUID(),
    generationId,
    provenance: options.provenance ?? proposal.provenance ?? null,
    approvedClipId: null,
    rejectionReason: null,
    decisionAt: null,
    createdAt: now,
    updatedAt: now
  }));
  updateDatabase((store) => {
    if (store.clipProposals.some((proposal) => proposal.sourceId === sourceId &&
      proposal.approvalReceipt && proposal.approvalReceipt.stage !== "completed")) {
      throw new Error("Finish the interrupted clip approval before replacing proposals for this source.");
    }
    store.clipProposals = store.clipProposals.filter((proposal) => proposal.sourceId !== sourceId);
    store.clipProposals.push(...records);
  });
  return records;
}

export function listClipProposalFeedback(): LongFormClipProposalFeedbackRecord[] {
  return readDatabase().clipProposalFeedback
    .slice()
    .sort((left, right) => left.decidedAt.localeCompare(right.decidedAt));
}

export function recordClipProposalDecision(input: {
  sourceId: string;
  proposalId: string;
  decision: "approved" | "rejected";
  selectedStartMs: number;
  selectedEndMs: number;
  layout: StackedVerticalLayoutSettings | null;
  approvedClipId: string | null;
  rejectionReason: string | null;
}): { proposal: LongFormClipProposalRecord; feedback: LongFormClipProposalFeedbackRecord } {
  let result: { proposal: LongFormClipProposalRecord; feedback: LongFormClipProposalFeedbackRecord } | null = null;
  updateDatabase((store) => {
    const proposal = store.clipProposals.find(
      (existingProposal) => existingProposal.sourceId === input.sourceId && existingProposal.id === input.proposalId
    );
    if (!proposal) {
      throw new Error("The selected clip proposal no longer exists.");
    }

    const decidedAt = new Date().toISOString();
    proposal.status = input.decision;
    if (input.decision === "approved" && proposal.approvalReceipt) {
      proposal.approvalReceipt.stage = "completed";
    }
    if (input.decision === "rejected") {
      // End recovery atomically with the decision. Rendered files may already be
      // owned by the library, so rejecting a proposal must not delete them.
      delete proposal.approvalReceipt;
    }
    proposal.approvedClipId = input.decision === "approved" ? input.approvedClipId : null;
    proposal.rejectionReason = input.decision === "rejected" ? input.rejectionReason : null;
    proposal.decisionAt = decidedAt;
    proposal.updatedAt = decidedAt;

    const feedback: LongFormClipProposalFeedbackRecord = {
      id: randomUUID(),
      sourceId: proposal.sourceId,
      proposalId: proposal.id,
      generationId: proposal.generationId ?? null,
      provenance: proposal.provenance ?? null,
      decision: input.decision,
      originalStartMs: proposal.startMs,
      originalEndMs: proposal.endMs,
      selectedStartMs: input.selectedStartMs,
      selectedEndMs: input.selectedEndMs,
      hook: proposal.hook,
      reason: proposal.reason,
      confidence: proposal.confidence,
      evidenceSegmentIds: [...proposal.evidenceSegmentIds],
      analysis: proposal.analysis ?? null,
      rejectionReason: input.rejectionReason,
      approvedClipId: input.approvedClipId,
      layout: input.layout,
      decidedAt,
      createdAt: decidedAt
    };
    store.clipProposalFeedback.push(feedback);
    result = { proposal, feedback };
  });

  return result!;
}

export function recordClipProposalReopened(
  sourceId: string,
  proposalId: string
): LongFormClipProposalRecord {
  let updatedProposal: LongFormClipProposalRecord | null = null;
  updateDatabase((store) => {
    const proposal = store.clipProposals.find(
      (existingProposal) => existingProposal.sourceId === sourceId && existingProposal.id === proposalId
    );
    if (!proposal) {
      throw new Error("The selected clip proposal no longer exists.");
    }

    const decidedAt = new Date().toISOString();
    proposal.status = "proposed";
    proposal.approvedClipId = null;
    proposal.rejectionReason = null;
    proposal.decisionAt = null;
    proposal.updatedAt = decidedAt;
    store.clipProposalFeedback.push({
      id: randomUUID(),
      sourceId: proposal.sourceId,
      proposalId: proposal.id,
      generationId: proposal.generationId ?? null,
      provenance: proposal.provenance ?? null,
      decision: "reopened",
      originalStartMs: proposal.startMs,
      originalEndMs: proposal.endMs,
      selectedStartMs: proposal.startMs,
      selectedEndMs: proposal.endMs,
      hook: proposal.hook,
      reason: proposal.reason,
      confidence: proposal.confidence,
      evidenceSegmentIds: [...proposal.evidenceSegmentIds],
      analysis: proposal.analysis ?? null,
      rejectionReason: null,
      approvedClipId: null,
      layout: null,
      decidedAt,
      createdAt: decidedAt
    });
    updatedProposal = proposal;
  });

  return updatedProposal!;
}

export function updateClipProposalStatus(
  sourceId: string,
  proposalId: string,
  status: LongFormClipProposalRecord["status"],
  approvedClipId: string | null = null,
  rejectionReason: string | null = null
): LongFormClipProposalRecord {
  let updatedProposal: LongFormClipProposalRecord | null = null;
  updateDatabase((store) => {
    const proposal = store.clipProposals.find(
      (existingProposal) => existingProposal.sourceId === sourceId && existingProposal.id === proposalId
    );
    if (!proposal) {
      throw new Error("The selected clip proposal no longer exists.");
    }

    proposal.status = status;
    proposal.approvedClipId = approvedClipId;
    proposal.rejectionReason = status === "rejected" ? rejectionReason : null;
    proposal.decisionAt = status === "proposed" ? null : new Date().toISOString();
    proposal.updatedAt = new Date().toISOString();
    updatedProposal = proposal;
  });

  return updatedProposal!;
}
