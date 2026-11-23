import type { LongFormClipProposalRecord } from "./contracts";

export type ClipProposalFilter = "all" | "unreviewed" | "approved" | "rejected";

export const CLIP_PROPOSAL_FILTERS: Array<{ id: ClipProposalFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unreviewed", label: "Unreviewed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" }
];

export function matchesClipProposalFilter(
  proposal: LongFormClipProposalRecord,
  filter: ClipProposalFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "unreviewed") {
    return proposal.status === "proposed";
  }
  return proposal.status === filter;
}

export function matchesClipProposalSearch(
  proposal: LongFormClipProposalRecord,
  query: string
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [proposal.hook, proposal.reason, proposal.rejectionReason ?? ""]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export function filterClipProposals(
  proposals: LongFormClipProposalRecord[],
  filter: ClipProposalFilter,
  query: string
): LongFormClipProposalRecord[] {
  return proposals.filter((proposal) => matchesClipProposalFilter(proposal, filter) && matchesClipProposalSearch(proposal, query));
}

export function countClipProposalsByFilter(
  proposals: LongFormClipProposalRecord[]
): Record<ClipProposalFilter, number> {
  return {
    all: proposals.length,
    unreviewed: proposals.filter((proposal) => proposal.status === "proposed").length,
    approved: proposals.filter((proposal) => proposal.status === "approved").length,
    rejected: proposals.filter((proposal) => proposal.status === "rejected").length
  };
}
