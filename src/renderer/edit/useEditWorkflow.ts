import { useEffect, useState } from "react";
import type { AppInfo, ClipRecord, CreatorAppApi, YouTubePerformanceSnapshotRecord } from "../../shared/contracts";
import { sortPerformanceSnapshots } from "../../shared/workflowPresentation";
import { useEditMetadataWorkflow, type EditMetadataApi } from "./useEditMetadataWorkflow";
import { useEditTranscriptWorkflow, type EditTranscriptApi } from "./useEditTranscriptWorkflow";
export type EditApi = EditMetadataApi & EditTranscriptApi & Pick<CreatorAppApi, "listYouTubePerformanceSnapshots">;
interface Options {
  selectedClipId: string | null;
  clips: ClipRecord[];
  appInfo: AppInfo | null;
  onSelectClip: (clipId: string) => void;
  onError: (message: string | null) => void;
  onAppInfo: (info: AppInfo) => void;
  onRefreshWorkspace: (clipId?: string) => Promise<void>;
  api?: EditApi;
}
/** Coordinates clip reads; draft editing belongs to the two focused controllers. */
export function useEditWorkflow({ selectedClipId, clips, appInfo, onSelectClip, onError: setError, onAppInfo, onRefreshWorkspace, api = window.creatorApp }: Options) {
  const selectedClip = clips.find(clip => clip.id === selectedClipId) ?? null;
  const metadata = useEditMetadataWorkflow({ selectedClipId, selectedClip, appInfo, onError: setError, onRefreshWorkspace, api });
  const transcript = useEditTranscriptWorkflow({ selectedClipId, selectedClip, onError: setError, onAppInfo, onRefreshWorkspace, api });
  const [youtubePerformanceSnapshots, setYouTubePerformanceSnapshots] = useState<YouTubePerformanceSnapshotRecord[]>([]);
  const { setSelectedMetadata, setMetadataVariants, setMetadataLoading } = metadata;
  const { setSelectedTranscript, setTranscriptLoading } = transcript;
  useEffect(() => { setYouTubePerformanceSnapshots([]); }, [selectedClipId]);
  useEffect(() => {
    let cancelled = false;

    async function loadSelectionArtifacts(): Promise<void> {
      if (!selectedClipId) {
        setSelectedMetadata(null);
        setMetadataVariants([]);
        setYouTubePerformanceSnapshots([]);
        return;
      }

      setMetadataLoading(true);
      setTranscriptLoading(true);

      try {
        const [metadata, variants, performanceSnapshots, transcript] = await Promise.all([
          api.getClipMetadata(selectedClipId),
          api.listMetadataVariants(selectedClipId),
          api.listYouTubePerformanceSnapshots(selectedClipId),
          api.getTranscript(selectedClipId)
        ]);
        if (!cancelled) {
          setSelectedMetadata(metadata);
          setMetadataVariants(variants);
          setYouTubePerformanceSnapshots(sortPerformanceSnapshots(performanceSnapshots));
          setSelectedTranscript(transcript);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to load clip metadata, transcript, or performance snapshots."
          );
        }
      } finally {
        if (!cancelled) {
          setMetadataLoading(false);
          setTranscriptLoading(false);
        }
      }
    }

    void loadSelectionArtifacts();

    return () => {
      cancelled = true;
    };
  }, [selectedClipId]);

  function selectClip(clipId: string): void {
    if (!metadata.prepareSelection(clipId)) return;
    transcript.transcriptSession.select(clipId);
    setSelectedTranscript(null);
    setTranscriptLoading(true);
    setYouTubePerformanceSnapshots([]);
    onSelectClip(clipId);
  }
  return { ...metadata, ...transcript, youtubePerformanceSnapshots, setYouTubePerformanceSnapshots, selectClip };
}
