import { useEffect, useState } from "react";
import type {
  AiProfile, AiProfileAssignments, AiProfileKnowledgeEntry, AiProfileLearningSettings,
  AiProfileTask, AppInfo, CreatorAppApi
} from "../../shared/contracts";
import {
  createEmptyAiProfileAssignments, createCustomAiProfile, createAiProfileKnowledgeEntry,
  normalizeAiProfileAssignmentsForProfiles
} from "./aiProfileDraft";

export type AiProfileSettingsApi = Pick<CreatorAppApi, "saveAiProfiles">;
interface ProfileDraft {
  profiles: AiProfile[];
  assignments: AiProfileAssignments;
}
interface Options {
  appInfo: AppInfo | null;
  onAppInfo: (info: AppInfo) => void;
  onError: (message: string | null) => void;
  api?: AiProfileSettingsApi;
}

/** Profile edits and assignment normalization remain drafts until the user saves. */
export function useAiProfileSettings({
  appInfo, onAppInfo, onError, api = window.creatorApp
}: Options) {
  const savedAiProfiles = appInfo?.aiProfiles ?? [];
  const savedAiProfileAssignments = appInfo?.aiProfileAssignments ?? createEmptyAiProfileAssignments();
  const savedProfilesKey = JSON.stringify(savedAiProfiles);
  const savedAssignmentsKey = JSON.stringify(savedAiProfileAssignments);
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    profiles: savedAiProfiles, assignments: savedAiProfileAssignments
  }));
  const [selectedAiProfileId, setSelectedAiProfileId] = useState<string | null>(null);
  const [editingAiProfiles, setEditingAiProfiles] = useState(false);
  const [savingAiProfiles, setSavingAiProfiles] = useState(false);

  useEffect(() => {
    if (!editingAiProfiles) {
      setDraft({ profiles: savedAiProfiles, assignments: savedAiProfileAssignments });
    }
  }, [savedProfilesKey, savedAssignmentsKey, editingAiProfiles]);

  useEffect(() => {
    setSelectedAiProfileId(currentId =>
      currentId && draft.profiles.some(profile => profile.id === currentId)
        ? currentId : draft.profiles[0]?.id ?? null
    );
  }, [draft.profiles]);

  function updateProfiles(update: (profiles: AiProfile[]) => AiProfile[]): void {
    setDraft(current => {
      const profiles = update(current.profiles);
      return {
        profiles,
        assignments: normalizeAiProfileAssignmentsForProfiles(current.assignments, profiles)
      };
    });
  }

  async function handleSaveAiProfiles(): Promise<void> {
    setSavingAiProfiles(true);
    onError(null);
    try {
      const nextInfo = await api.saveAiProfiles(draft);
      onAppInfo(nextInfo);
      setDraft({
        profiles: nextInfo.aiProfiles,
        assignments: nextInfo.aiProfileAssignments
      });
      setEditingAiProfiles(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save AI profiles.");
    } finally {
      setSavingAiProfiles(false);
    }
  }

  function handleAddAiProfile(): void {
    const profile = createCustomAiProfile();
    // Adding an unassigned profile does not change the existing task choices.
    setDraft(current => ({ ...current, profiles: [...current.profiles, profile] }));
    setSelectedAiProfileId(profile.id);
  }

  function handleCancelAiProfileEdits(): void {
    setDraft({ profiles: savedAiProfiles, assignments: savedAiProfileAssignments });
    setEditingAiProfiles(false);
  }

  function handleRemoveAiProfile(profileId: string): void {
    updateProfiles(profiles => profiles.filter(profile => profile.id !== profileId));
  }

  function handleUpdateAiProfile(
    profileId: string,
    patch: Partial<Pick<AiProfile,
      "name" | "description" | "preferredModel" | "systemPrompt" | "enabled" | "task" | "speakerContextSettings">>
  ): void {
    updateProfiles(profiles => profiles.map(profile => profile.id === profileId ? {
      ...profile, ...patch,
      preferredModel: patch.preferredModel !== undefined
        ? typeof patch.preferredModel === "string" ? patch.preferredModel.trim() || null : null
        : profile.preferredModel,
      updatedAt: new Date().toISOString()
    } : profile));
  }

  function handleUpdateAiProfileLearningSettings(
    profileId: string, patch: Partial<AiProfileLearningSettings>
  ): void {
    setDraft(current => ({
      ...current,
      profiles: current.profiles.map(profile => profile.id === profileId ? {
        ...profile,
        learningSettings: {
          ...profile.learningSettings, ...patch,
          maxKnowledgeEntries: patch.maxKnowledgeEntries === undefined
            ? profile.learningSettings.maxKnowledgeEntries
            : Math.max(0, Math.min(50, Math.round(patch.maxKnowledgeEntries)))
        },
        updatedAt: new Date().toISOString()
      } : profile)
    }));
  }

  function handleAddAiProfileKnowledge(profileId: string): void {
    const entry = createAiProfileKnowledgeEntry();
    setDraft(current => ({
      ...current,
      profiles: current.profiles.map(profile => profile.id === profileId ? {
        ...profile, knowledgeEntries: [...profile.knowledgeEntries, entry],
        updatedAt: new Date().toISOString()
      } : profile)
    }));
  }

  function handleUpdateAiProfileKnowledge(
    profileId: string, entryId: string,
    patch: Partial<Pick<AiProfileKnowledgeEntry, "title" | "content" | "enabled">>
  ): void {
    setDraft(current => ({
      ...current,
      profiles: current.profiles.map(profile => profile.id === profileId ? {
        ...profile,
        knowledgeEntries: profile.knowledgeEntries.map(entry =>
          entry.id === entryId ? { ...entry, ...patch, updatedAt: new Date().toISOString() } : entry
        ),
        updatedAt: new Date().toISOString()
      } : profile)
    }));
  }

  function handleRemoveAiProfileKnowledge(profileId: string, entryId: string): void {
    setDraft(current => ({
      ...current,
      profiles: current.profiles.map(profile => profile.id === profileId ? {
        ...profile, knowledgeEntries: profile.knowledgeEntries.filter(entry => entry.id !== entryId),
        updatedAt: new Date().toISOString()
      } : profile)
    }));
  }

  function handleUpdateAiProfileAssignment(task: AiProfileTask, profileId: string): void {
    setDraft(current => ({
      ...current,
      assignments: normalizeAiProfileAssignmentsForProfiles({
        ...current.assignments,
        youtubeMetadataProfileId:
          task === "youtube_metadata" ? profileId || null : current.assignments.youtubeMetadataProfileId,
        youtubeThumbnailProfileId:
          task === "youtube_thumbnail" ? profileId || null : current.assignments.youtubeThumbnailProfileId,
        performanceCoachProfileId:
          task === "performance_coach" ? profileId || null : current.assignments.performanceCoachProfileId,
        clipDiscoveryProfileId:
          task === "clip_discovery" ? profileId || null : current.assignments.clipDiscoveryProfileId
      }, current.profiles)
    }));
  }

  return {
    savedAiProfiles, savedAiProfileAssignments,
    aiProfilesInput: draft.profiles, aiProfileAssignmentsInput: draft.assignments,
    selectedAiProfileId, setSelectedAiProfileId,
    selectedAiProfile: draft.profiles.find(profile => profile.id === selectedAiProfileId) ?? draft.profiles[0] ?? null,
    editingAiProfiles, setEditingAiProfiles, savingAiProfiles,
    handleSaveAiProfiles, handleAddAiProfile, handleCancelAiProfileEdits,
    handleRemoveAiProfile, handleUpdateAiProfile, handleUpdateAiProfileLearningSettings,
    handleAddAiProfileKnowledge, handleUpdateAiProfileKnowledge,
    handleRemoveAiProfileKnowledge, handleUpdateAiProfileAssignment
  };
}
