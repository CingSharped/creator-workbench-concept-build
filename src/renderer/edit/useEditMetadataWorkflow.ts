import { useEffect, useRef, useState } from "react";
import { useEditingSession } from "../useEditingSession";
import type { ReviewedMetadataHandoff } from "./reviewedMetadata";
import type { AppInfo, ClipRecord, ClipMetadataPackageDraft, ClipMetadataPackageRecord, CreatorAppApi, GeneratedClipMetadataCandidatesResult, MetadataScoreSnapshot, MetadataVariantKind, MetadataVariantRecord } from "../../shared/contracts";
import { YOUTUBE_VIDEO_TITLE_MAX_LENGTH } from "../../shared/platformLimits";
import { normalizeCreatorProfileLinks, normalizeCollaboratorProfiles, hasAnyCreatorProfileLinks, mergeProfileBlocksIntoDescription } from "../../shared/creatorProfileLinks";
import { createEmptyMetadataPackage, mergeMetadataTags, buildMetadataDraftFromState, formatMetadataGenerationMessage, formatMetadataVariantAngle } from "./editWorkflowHelpers";

export type EditMetadataApi = Pick<CreatorAppApi,
  "getClipMetadata" | "listMetadataVariants" | "evaluateClipMetadataPackage" |
  "saveClipMetadata" | "generateClipMetadataCandidates" | "recordMetadataFeedback">;
interface Options {
  selectedClipId: string | null;
  selectedClip: ClipRecord | null;
  appInfo: AppInfo | null;
  onError: (message: string | null) => void;
  onRefreshWorkspace: (clipId?: string) => Promise<void>;
  api: EditMetadataApi;
}
export function useEditMetadataWorkflow({ selectedClipId, selectedClip, appInfo, onError: setError, onRefreshWorkspace: refreshWorkspaceData, api }: Options) {
  const session = useEditingSession(selectedClipId);
  const selectedClipIdRef = useRef<string | null>(null);
  const metadataGenerationRequestRef = useRef(0);
  const [selectedMetadata, setSelectedMetadata] = useState<ClipMetadataPackageRecord | null>(null);
  const [metadataVariants, setMetadataVariants] = useState<MetadataVariantRecord[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataGenerationMode, setMetadataGenerationMode] = useState<
    "all" | "title" | "description" | "hashtags" | null
  >(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTagsInput, setDraftTagsInput] = useState("");
  const [draftSeriesKey, setDraftSeriesKey] = useState("");
  const [draftGameTitle, setDraftGameTitle] = useState("");
  const [draftCollaboratorProfileIds, setDraftCollaboratorProfileIds] = useState<string[]>([]);
  const [selectedVariantIds, setSelectedVariantIds] = useState<ClipMetadataPackageDraft["selectedVariantIds"]>(
    createEmptyMetadataPackage().selectedVariantIds
  );
  const [metadataScore, setMetadataScore] = useState<MetadataScoreSnapshot | null>(null);
  const [evaluatingMetadata, setEvaluatingMetadata] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [recordingMetadataFeedbackId, setRecordingMetadataFeedbackId] = useState<string | null>(null);
  const [rejectedVariantIds, setRejectedVariantIds] = useState<string[]>([]);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const [lastMetadataGenerationResult, setLastMetadataGenerationResult] =
    useState<GeneratedClipMetadataCandidatesResult | null>(null);

  const savedCreatorProfileLinks = normalizeCreatorProfileLinks(appInfo?.creatorProfileLinks);
  const savedCollaboratorProfiles = normalizeCollaboratorProfiles(appInfo?.collaboratorProfiles);
  const savedCollaboratorProfilesKey = JSON.stringify(savedCollaboratorProfiles);
  const selectedCollaboratorProfiles = savedCollaboratorProfiles.filter(profile => draftCollaboratorProfileIds.includes(profile.id));
  const canInsertSavedProfileBlocks = hasAnyCreatorProfileLinks(savedCreatorProfileLinks) || selectedCollaboratorProfiles.length > 0;
  useEffect(() => {
    if (selectedClipIdRef.current === selectedClipId) {
      return;
    }

    selectedClipIdRef.current = selectedClipId;
    metadataGenerationRequestRef.current += 1;
  }, [selectedClipId]);


  function resetSelection(): void {
    setSavingMetadata(false);
    setRecordingMetadataFeedbackId(null);
    setRejectedVariantIds([]);
    setSelectedMetadata(null);
    setMetadataVariants([]);
    setMetadataLoading(Boolean(selectedClipId));
    setMetadataScore(null);
    setEvaluatingMetadata(false);
    setMetadataMessage(null);
    setLastMetadataGenerationResult(null);
    setMetadataGenerationMode(null);
    clearDraftMetadataPackage();
  }
  function prepareSelection(clipId: string): boolean {
    if (selectedClipIdRef.current === clipId && selectedClipId === clipId) return false;
    session.select(clipId);
    selectedClipIdRef.current = clipId;
    metadataGenerationRequestRef.current += 1;
    resetSelection();
    setMetadataLoading(true);
    return true;
  }
  function isSelectedClip(clipId: string | null): boolean {
    return selectedClipIdRef.current === clipId;
  }
  useEffect(resetSelection, [selectedClipId]);

  useEffect(() => {
    setDraftCollaboratorProfileIds((currentIds) =>
      currentIds.filter((id) => savedCollaboratorProfiles.some((profile) => profile.id === id))
    );
  }, [savedCollaboratorProfilesKey]);

  useEffect(() => {
    if (!selectedMetadata) {
      clearDraftMetadataPackage();
      return;
    }

    applyDraftMetadataPackage(selectedMetadata);
  }, [selectedMetadata?.id, selectedMetadata?.updatedAt]);


  useEffect(() => {
    if (!selectedClipId) {
      setMetadataScore(null);
      return;
    }

    const draft = captureCurrentMetadataDraft();
    const hasDraftContent =
      draft.title.length > 0 ||
      draft.description.length > 0 ||
      draft.publicHashtags.length > 0 ||
      draft.platformTags.length > 0 ||
      draft.seriesKey.length > 0 ||
      draft.gameTitle.length > 0;

    if (!hasDraftContent) {
      setMetadataScore(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setEvaluatingMetadata(true);

        try {
          const score = await api.evaluateClipMetadataPackage(selectedClipId, draft);
          if (!cancelled) {
            setMetadataScore(score);
          }
        } catch {
          // Preserve the last visible score if a background evaluation fails.
        } finally {
          if (!cancelled) {
            setEvaluatingMetadata(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    selectedClipId,
    draftTitle,
    draftDescription,
    draftTagsInput,
    draftSeriesKey,
    draftGameTitle,
    selectedVariantIds.title,
    selectedVariantIds.description,
    selectedVariantIds.publicHashtags,
    selectedVariantIds.platformTags
  ]);


  function applyDraftMetadataPackage(metadataPackage: ClipMetadataPackageDraft | ClipMetadataPackageRecord): void {
    setDraftTitle(metadataPackage.title);
    setDraftDescription(metadataPackage.description);
    setDraftTagsInput(mergeMetadataTags(metadataPackage.publicHashtags, metadataPackage.platformTags).join(", "));
    setDraftSeriesKey(metadataPackage.seriesKey);
    setDraftGameTitle(metadataPackage.gameTitle);
    setDraftCollaboratorProfileIds(metadataPackage.collaboratorProfileIds);
    const selectedTagVariantId =
      metadataPackage.selectedVariantIds.publicHashtags ?? metadataPackage.selectedVariantIds.platformTags;
    setSelectedVariantIds({
      ...metadataPackage.selectedVariantIds,
      publicHashtags: selectedTagVariantId,
      platformTags: selectedTagVariantId
    });
    setMetadataScore(metadataPackage.latestScoreSnapshot ?? null);
  }


  function clearDraftMetadataPackage(): void {
    const emptyPackage = createEmptyMetadataPackage();
    applyDraftMetadataPackage(emptyPackage);
  }


  function captureCurrentMetadataDraft(
    scoreOverride: MetadataScoreSnapshot | null = metadataScore
  ): ClipMetadataPackageDraft {
    return buildMetadataDraftFromState({
      title: draftTitle,
      description: draftDescription,
      tagsInput: draftTagsInput,
      seriesKey: draftSeriesKey,
      gameTitle: draftGameTitle,
      collaboratorProfileIds: draftCollaboratorProfileIds,
      selectedVariantIds,
      latestScoreSnapshot: scoreOverride
    });
  }


  async function handleSaveClipMetadata(): Promise<void> {
    if (!selectedClip) {
      return;
    }

    if (draftTitle.trim().length === 0) {
      setError("Add a title before saving the metadata package.");
      return;
    }

    if (draftTitle.trim().length > YOUTUBE_VIDEO_TITLE_MAX_LENGTH) {
      setError(`Shorten the title to ${YOUTUBE_VIDEO_TITLE_MAX_LENGTH} characters or fewer before saving.`);
      return;
    }

    const ticket = session.begin("metadata", true);
    setSavingMetadata(false);
    setMetadataGenerationMode(null);
    setSavingMetadata(true);
    setError(null);
    setMetadataMessage(null);

    try {
      const score =
        metadataScore ?? (await api.evaluateClipMetadataPackage(selectedClip.id, captureCurrentMetadataDraft()));
      const metadata = await api.saveClipMetadata(
        selectedClip.id,
        captureCurrentMetadataDraft(score)
      );
      if (!session.accepts(ticket)) return;
      setSelectedMetadata(metadata);
      session.commit(ticket);
      setMetadataScore(metadata.latestScoreSnapshot);
      setMetadataMessage("Metadata package saved locally for this clip.");
      await refreshWorkspaceData(selectedClip.id);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to save clip metadata.");
    } finally {
      if (session.latest(ticket)) setSavingMetadata(false);
    }
  }


  async function handleGenerateMetadataCandidates(
    mode: "all" | "title" | "description" | "hashtags"
  ): Promise<void> {
    if (!selectedClip || metadataLoading) {
      return;
    }

    const generationClipId = selectedClip.id;
    const ticket = session.begin("metadata", true);
    setSavingMetadata(false);
    setMetadataGenerationMode(null);
    const generationRequestId = ++metadataGenerationRequestRef.current;

    const kinds =
      mode === "all"
        ? undefined
        : mode === "title"
          ? (["title"] as MetadataVariantKind[])
          : mode === "description"
            ? (["description"] as MetadataVariantKind[])
            : (["public_hashtags", "platform_tags"] as MetadataVariantKind[]);

    setMetadataGenerationMode(mode);
    setError(null);
    setMetadataMessage(
      mode === "all" ? "Generating title, description, and tag candidates..." : null
    );
    setLastMetadataGenerationResult(null);

    try {
      const result = await api.generateClipMetadataCandidates(generationClipId, {
        kinds,
        append: mode !== "all",
        seriesKey: draftSeriesKey,
        gameTitle: draftGameTitle,
        existingPackage: captureCurrentMetadataDraft()
      });
      if (
        !session.accepts(ticket) ||
        selectedClipIdRef.current !== generationClipId ||
        metadataGenerationRequestRef.current !== generationRequestId
      ) {
        return;
      }
      if (mode === "all") {
        setRejectedVariantIds([]);
      }
      setMetadataVariants(result.variants);
      session.commit(ticket);
      applyDraftMetadataPackage(result.recommendedPackage);
      setLastMetadataGenerationResult(result);
      setMetadataMessage(formatMetadataGenerationMessage(result));
    } catch (nextError) {
      if (
        session.accepts(ticket) &&
        selectedClipIdRef.current === generationClipId &&
        metadataGenerationRequestRef.current === generationRequestId
      ) {
        setError(nextError instanceof Error ? nextError.message : "Failed to generate clip metadata candidates.");
      }
    } finally {
      if (
        session.latest(ticket) &&
        selectedClipIdRef.current === generationClipId &&
        metadataGenerationRequestRef.current === generationRequestId
      ) {
        setMetadataGenerationMode(null);
      }
    }
  }


  async function handleSelectMetadataVariant(variant: MetadataVariantRecord): Promise<void> {
    session.edit();
    switch (variant.kind) {
      case "title":
        if (typeof variant.content === "string") {
          setDraftTitle(variant.content);
          setSelectedVariantIds((current) => ({ ...current, title: variant.id }));
        }
        break;
      case "description":
        if (typeof variant.content === "string") {
          setDraftDescription(variant.content);
          setSelectedVariantIds((current) => ({ ...current, description: variant.id }));
        }
        break;
      case "public_hashtags":
        if (Array.isArray(variant.content)) {
          setDraftTagsInput(variant.content.join(", "));
          setSelectedVariantIds((current) => ({
            ...current,
            publicHashtags: variant.id,
            platformTags: variant.id
          }));
        }
        break;
      case "platform_tags":
        if (Array.isArray(variant.content)) {
          setDraftTagsInput(variant.content.join(", "));
          setSelectedVariantIds((current) => ({
            ...current,
            publicHashtags: variant.id,
            platformTags: variant.id
          }));
        }
        break;
    }

    setMetadataMessage(
      `${formatMetadataVariantAngle(variant.angle)} selected. Review the final package, then save when you are happy with it.`
    );
  }


  async function handleRejectMetadataVariant(variant: MetadataVariantRecord): Promise<void> {
    if (!selectedClip) {
      return;
    }

    const ticket = session.begin("feedback", false);
    setRecordingMetadataFeedbackId(variant.id);
    setError(null);

    try {
      await api.recordMetadataFeedback(selectedClip.id, variant.id, "rejected");
      if (!session.accepts(ticket)) return;
      setRejectedVariantIds((current) =>
        current.includes(variant.id) ? current : [...current, variant.id]
      );
      setSelectedVariantIds((current) => {
        switch (variant.kind) {
          case "title":
            return { ...current, title: current.title === variant.id ? null : current.title };
          case "description":
            return { ...current, description: current.description === variant.id ? null : current.description };
          case "public_hashtags":
            return {
              ...current,
              publicHashtags: current.publicHashtags === variant.id ? null : current.publicHashtags,
              platformTags: current.platformTags === variant.id ? null : current.platformTags
            };
          case "platform_tags":
            return {
              ...current,
              publicHashtags: current.publicHashtags === variant.id ? null : current.publicHashtags,
              platformTags: current.platformTags === variant.id ? null : current.platformTags
            };
        }
      });
      setMetadataMessage(`${formatMetadataVariantAngle(variant.angle)} marked as rejected for future learning.`);
    } catch (nextError) {
      if (!session.accepts(ticket)) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to record metadata feedback.");
    } finally {
      if (session.latest(ticket)) setRecordingMetadataFeedbackId(null);
    }
  }


  function handleToggleCollaboratorProfileSelection(profileId: string, checked: boolean): void {
    session.edit();
    setDraftCollaboratorProfileIds((currentIds) => {
      if (checked) {
        return currentIds.includes(profileId) ? currentIds : [...currentIds, profileId];
      }

      return currentIds.filter((id) => id !== profileId);
    });
  }


  function handleInsertSavedProfileLinksIntoDescription(): void {
    session.edit();
    if (!canInsertSavedProfileBlocks) {
      setError(
        "Save your creator links or select at least one collaborator before inserting a description profile block."
      );
      return;
    }

    setDraftDescription((currentDescription) =>
      mergeProfileBlocksIntoDescription(
        currentDescription,
        savedCreatorProfileLinks,
        selectedCollaboratorProfiles
      )
    );
    setMetadataMessage(
      selectedCollaboratorProfiles.length > 0
        ? "Saved creator and collaborator profile blocks inserted at the bottom of the description."
        : "Saved creator profile links inserted at the bottom of the description."
    );
  }


  async function generateFromCoach(clipId: string, kind: "generate_titles" | "generate_tags"): Promise<void> {
    const mode = kind === "generate_titles" ? "title" : "hashtags";
    const kinds = kind === "generate_titles"
      ? (["title"] as MetadataVariantKind[])
      : (["public_hashtags", "platform_tags"] as MetadataVariantKind[]);
    const generationClipId = clipId;
    const ticket = session.begin("metadata", true);
    setSavingMetadata(false);
    setMetadataGenerationMode(null);
    const generationRequestId = ++metadataGenerationRequestRef.current;
    setMetadataGenerationMode(mode);
    setError(null);
    try {
      const existingPackage = await api.getClipMetadata(generationClipId);
      const result = await api.generateClipMetadataCandidates(generationClipId, {
        kinds,
        append: true,
        existingPackage
      });
      if (
        !session.accepts(ticket) ||
        selectedClipIdRef.current !== generationClipId ||
        metadataGenerationRequestRef.current !== generationRequestId
      ) {
        return;
      }
      setMetadataVariants(result.variants);
      session.commit(ticket);
      applyDraftMetadataPackage(result.recommendedPackage);
      setLastMetadataGenerationResult(result);
      setMetadataMessage(formatMetadataGenerationMessage(result));
    } catch (nextError) {
      if (
        session.accepts(ticket) &&
        selectedClipIdRef.current === generationClipId &&
        metadataGenerationRequestRef.current === generationRequestId
      ) {
        setError(nextError instanceof Error ? nextError.message : "Failed to generate the coach's metadata candidates.");
      }
    } finally {
      if (
        session.latest(ticket) &&
        selectedClipIdRef.current === generationClipId &&
        metadataGenerationRequestRef.current === generationRequestId
      ) {
        setMetadataGenerationMode(null);
      }
    }

  }
  function captureReviewedMetadata(): ReviewedMetadataHandoff | null {
    if (!selectedClip) return null;
    const draft = structuredClone(captureCurrentMetadataDraft());
    let ticket = session.begin("metadata", true);
    setMetadataGenerationMode(null);
    setSavingMetadata(false);
    return {
      clipId: selectedClip.id, draft,
      isCurrent: () => session.accepts(ticket),
      acceptSaved: metadata => {
        if (!session.accepts(ticket)) return;
        // Invalidate reads started while this package was being saved.
        ticket = session.begin("metadata", true);
        setSelectedMetadata(metadata);
        setMetadataScore(metadata.latestScoreSnapshot);
        session.commit(ticket);
      }
    };
  }
  return {
    metadataSession: session,
    selectedMetadata, setSelectedMetadata: session.acceptSetter(setSelectedMetadata, true),
    metadataVariants, setMetadataVariants: session.acceptSetter(setMetadataVariants),
    metadataLoading, setMetadataLoading, metadataGenerationMode,
    draftTitle, setDraftTitle: session.editSetter(setDraftTitle, draftTitle), draftDescription, setDraftDescription: session.editSetter(setDraftDescription, draftDescription),
    draftTagsInput, setDraftTagsInput: session.editSetter(setDraftTagsInput, draftTagsInput), draftSeriesKey, setDraftSeriesKey: session.editSetter(setDraftSeriesKey, draftSeriesKey),
    draftGameTitle, setDraftGameTitle: session.editSetter(setDraftGameTitle, draftGameTitle), draftCollaboratorProfileIds, setDraftCollaboratorProfileIds: session.editSetter(setDraftCollaboratorProfileIds, draftCollaboratorProfileIds),
    selectedVariantIds, metadataScore, setMetadataScore, evaluatingMetadata, savingMetadata,
    recordingMetadataFeedbackId, rejectedVariantIds, metadataMessage, setMetadataMessage,
    lastMetadataGenerationResult, captureCurrentMetadataDraft, captureReviewedMetadata,
    handleSaveClipMetadata, handleGenerateMetadataCandidates, handleSelectMetadataVariant,
    handleRejectMetadataVariant, handleToggleCollaboratorProfileSelection,
    handleInsertSavedProfileLinksIntoDescription,
    prepareSelection, isSelectedClip, generateFromCoach
  };
}
