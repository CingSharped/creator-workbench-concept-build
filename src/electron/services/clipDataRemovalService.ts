import type { ClipAppDataRemovalResult } from "../../shared/contracts";
import { getCollaboratorProfiles, getCreatorVoiceSamples } from "./creatorProfileLinks";
import { readDatabase, updateDatabase } from "./database";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

/**
 * Permanently removes the app records owned by one clip without touching its
 * source file or the records deliberately retained for AI learning.
 */
export function deleteClipAppData(clipId: string): ClipAppDataRemovalResult {
  const store = readDatabase();
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error("The selected clip no longer exists in the Clip Library.");
  }

  const activeJobs = store.jobs.filter(
    (job) => job.clipId === clipId && ACTIVE_JOB_STATUSES.has(job.status)
  );
  if (activeJobs.length > 0) {
    throw new Error("Finish or cancel the active operation for this clip before deleting its app data.");
  }

  const clipTranscripts = store.transcripts.filter(
    (transcript) =>
      (transcript.assetType === "clip" && transcript.assetId === clipId) ||
      (!transcript.assetType && transcript.clipId === clipId)
  );
  const clipMetadataPackages = store.metadataPackages.filter((record) => record.clipId === clipId);
  const clipMetadataVariants = store.metadataVariants.filter((record) => record.clipId === clipId);
  const clipMetadataFeedback = store.metadataFeedback.filter((record) => record.clipId === clipId);
  const clipProposalFeedback = store.clipProposalFeedback.filter(
    (record) => record.approvedClipId === clipId
  );
  const clipVoiceSampleCount = countVoiceSamplesForClip(clipId);

  const result = updateDatabase((nextStore) => {
    nextStore.clips = nextStore.clips.filter((candidate) => candidate.id !== clipId);
    nextStore.transcripts = nextStore.transcripts.filter(
      (transcript) =>
        !(
          (transcript.assetType === "clip" && transcript.assetId === clipId) ||
          (!transcript.assetType && transcript.clipId === clipId)
        )
    );
    nextStore.scheduledPosts = nextStore.scheduledPosts.filter((post) => post.clipId !== clipId);
    nextStore.youtubePerformanceSnapshots = nextStore.youtubePerformanceSnapshots.filter(
      (snapshot) => snapshot.clipId !== clipId
    );
    nextStore.jobs = nextStore.jobs.filter((job) => job.clipId !== clipId);
    nextStore.clipProposals = nextStore.clipProposals.filter(
      (proposal) => proposal.approvedClipId !== clipId
    );

    // Keep the decision signal, but remove the link to the deleted clip so
    // the retained history does not claim that the clip still exists.
    for (const feedback of nextStore.clipProposalFeedback) {
      if (feedback.approvedClipId === clipId) {
        feedback.approvedClipId = null;
      }
    }

    return {
      clipId,
      displayName: clip.displayName,
      removed: {
        clipRecord: 1,
        transcriptRecords: clipTranscripts.length,
        scheduledPosts: store.scheduledPosts.filter((post) => post.clipId === clipId).length,
        performanceSnapshots: store.youtubePerformanceSnapshots.filter((snapshot) => snapshot.clipId === clipId).length,
        jobs: store.jobs.filter((job) => job.clipId === clipId).length,
        proposalRecords: store.clipProposals.filter((proposal) => proposal.approvedClipId === clipId).length
      },
      preserved: {
        metadataPackages: clipMetadataPackages.length,
        metadataVariants: clipMetadataVariants.length,
        metadataFeedback: clipMetadataFeedback.length,
        proposalFeedback: clipProposalFeedback.length,
        voiceSamples: clipVoiceSampleCount
      },
      preservedCategories: [
        "Source video file",
        "Metadata packages, variants, and feedback used by the AI learning loop",
        "Proposal approval/rejection feedback",
        "Saved creator and collaborator voice samples"
      ],
      warnings: []
    } satisfies ClipAppDataRemovalResult;
  });

  return result;
}

function countVoiceSamplesForClip(clipId: string): number {
  const creatorSamples = getCreatorVoiceSamples().filter((sample) => sample.clipId === clipId);
  const collaboratorSamples = getCollaboratorProfiles().reduce(
    (count, profile) => count + profile.voiceSamples.filter((sample) => sample.clipId === clipId).length,
    0
  );
  return creatorSamples.length + collaboratorSamples;
}
