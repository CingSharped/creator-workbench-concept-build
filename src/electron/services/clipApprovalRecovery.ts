import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, stat } from "node:fs/promises";
import type { ClipApprovalReceipt } from "../../shared/contracts";
import { updateDatabase } from "./database";

export function saveClipApprovalReceipt(sourceId: string, proposalId: string, receipt: ClipApprovalReceipt): void {
  updateDatabase((store) => {
    const proposal = store.clipProposals.find((item) => item.id === proposalId && item.sourceId === sourceId);
    if (!proposal || proposal.status !== "proposed") {
      throw new Error("The proposal changed during approval. The rendered file has been preserved for repair.");
    }
    proposal.approvalReceipt = { ...receipt, layout: { ...receipt.layout } };
    proposal.updatedAt = new Date().toISOString();
  });
}

export async function hashApprovalArtifact(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) throw new Error("The approval render is missing or empty. Repair the saved approval before retrying.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyApprovalArtifact(filePath: string, sha256: string | null): Promise<void> {
  if (!sha256 || await hashApprovalArtifact(filePath) !== sha256) {
    throw new Error("The saved approval render changed. Its file has been preserved; repair it before retrying.");
  }
}

export async function publishApprovalArtifact(receipt: ClipApprovalReceipt): Promise<void> {
  await verifyApprovalArtifact(receipt.stagingPath, receipt.sha256);
  try {
    // Both paths are on the library volume. A hard link publishes the complete file
    // atomically without overwriting a file created since the name was reserved.
    await link(receipt.stagingPath, receipt.outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [staging, output] = await Promise.all([stat(receipt.stagingPath), stat(receipt.outputPath)]);
    if (staging.dev !== output.dev || staging.ino !== output.ino) {
      throw new Error("The approval output name is now occupied by another file. Both files were preserved; repair the saved approval before retrying.");
    }
  }
  await verifyApprovalArtifact(receipt.outputPath, receipt.sha256);
}
