import { useEffect, useState } from "react";
import type { LongFormClipProposalRecord } from "../shared/contracts";
import { Button, Card, PanelHeader } from "./WorkbenchPrimitives";

interface ProposalDecisionPanelProps {
  proposal: LongFormClipProposalRecord;
  clipLibraryConfigured: boolean;
  proposalActionBusy: boolean;
  canApprove: boolean;
  suggestedFileName: string;
  onApprove?: (fileName: string) => void | Promise<void>;
  onReject?: (reason?: string) => void | Promise<unknown>;
  onReopen?: () => void | Promise<unknown>;
}

export default function ProposalDecisionPanel({
  proposal,
  clipLibraryConfigured,
  proposalActionBusy,
  canApprove,
  suggestedFileName,
  onApprove,
  onReject,
  onReopen
}: ProposalDecisionPanelProps): JSX.Element {
  const [fileName, setFileName] = useState(suggestedFileName);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const recovery = proposal.approvalReceipt && proposal.approvalReceipt.stage !== "completed"
    ? proposal.approvalReceipt : null;

  useEffect(() => {
    setFileName(suggestedFileName);
  }, [proposal.id, suggestedFileName]);
  useEffect(() => {
    setRejectionError(null);
    setRejectionReason("");
  }, [proposal.id]);
  const statusLabel = proposal.status === "proposed"
    ? "Awaiting review"
    : proposal.status === "approved"
      ? "Approved"
      : "Rejected";

  async function handleReject(): Promise<void> {
    if (!onReject) {
      return;
    }

    setRejectionError(null);
    try {
      await onReject(rejectionReason);
      setRejectionReason("");
    } catch (error) {
      setRejectionError(error instanceof Error ? error.message : "Failed to reject the clip proposal.");
    }
  }

  return (
    <Card className="panel review-proposal-decision-panel">
      <PanelHeader className="panel-header">
        <div>
          <h3>Proposal decision</h3>
          <p className="detail-meta">
            Status: {statusLabel}{proposal.status === "approved" && proposal.approvedClipId ? ` | Clip ${proposal.approvedClipId}` : ""}
          </p>
        </div>
      </PanelHeader>

      {proposal.status === "proposed" ? (
        <>
          {recovery ? <p className="inline-warning">Approval was not completed. Finish using the saved settings, or reject this proposal. Any completed render will be preserved.</p> : null}
          <div className="proposal-file-name-field">
            <label htmlFor="proposal-clip-file-name">Clip filename</label>
            <input
              id="proposal-clip-file-name"
              type="text"
              className="editor-input"
              value={recovery?.requestedFileName ?? fileName}
              disabled={Boolean(recovery)}
              onChange={(event) => setFileName(event.target.value)}
              maxLength={120}
              required
              aria-describedby="proposal-clip-file-name-hint"
            />
            <p id="proposal-clip-file-name-hint" className="detail-meta">
              This names the new clip file only. The app will save it as an MP4 in the Clip Library.
            </p>
          </div>
          <div className="review-trim-actions proposal-decision-actions">
            <Button
              type="button"
              variant="primary"
              className="primary-button"
              onClick={() => void onApprove?.(fileName)}
              disabled={proposalActionBusy || !clipLibraryConfigured || (!recovery && !canApprove) || !onApprove || (!recovery && !fileName.trim())}
            >
              {proposalActionBusy ? "Approving..." : recovery ? "Finish Saved Approval" : "Approve & Add Vertical Clip"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="secondary-button"
              onClick={() => void handleReject()}
              disabled={proposalActionBusy || !onReject}
            >
              Reject Proposal
            </Button>
            <input
              type="text"
              className="editor-input proposal-rejection-input"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Optional rejection reason"
              aria-label="Optional rejection reason"
            />
          </div>
          {rejectionError ? <div className="alert error" role="alert">{rejectionError}</div> : null}
        </>
      ) : null}

      {proposal.status === "rejected" && onReopen ? (
        <Button type="button" variant="secondary" className="secondary-button" onClick={() => void onReopen()} disabled={proposalActionBusy}>
          {proposalActionBusy ? "Reopening..." : "Reopen Decision"}
        </Button>
      ) : null}

      {!clipLibraryConfigured && proposal.status === "proposed" ? (
        <p className="inline-warning">Configure the Clip Library Folder in Settings before approving this proposal.</p>
      ) : null}
    </Card>
  );
}
