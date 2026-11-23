import { randomUUID } from "node:crypto";
import type { CollaboratorProfile, CreatorProfileLinks } from "../../shared/contracts";
import {
  hasAnyCreatorProfileLinks,
  normalizeCollaboratorProfiles,
  normalizeCreatorProfileLinks,
  normalizeVoiceSamples
} from "../../shared/creatorProfileLinks";
import { normalizeSpeakerColorHex } from "../../shared/speakerProfiles";
import { clearAppSetting, getAppSetting, setAppSetting } from "./settingsRepository";

const CREATOR_PROFILE_LINK_SETTING_KEYS: Record<keyof CreatorProfileLinks, string> = {
  youtube: "creator.profile_link.youtube",
  tiktok: "creator.profile_link.tiktok",
  twitch: "creator.profile_link.twitch",
  kick: "creator.profile_link.kick",
  instagram: "creator.profile_link.instagram",
  x: "creator.profile_link.x",
  discord: "creator.profile_link.discord",
  website: "creator.profile_link.website"
};
const COLLABORATOR_PROFILES_SETTING_KEY = "creator.collaborator_profiles";
const CREATOR_VOICE_SAMPLES_SETTING_KEY = "creator.voice_samples";
const LEGACY_SPEAKER_PROFILES_SETTING_KEY = "creator.speaker_profiles";

export function getCreatorProfileLinks(): CreatorProfileLinks {
  return normalizeCreatorProfileLinks({
    youtube: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.youtube),
    tiktok: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.tiktok),
    twitch: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.twitch),
    kick: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.kick),
    instagram: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.instagram),
    x: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.x),
    discord: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.discord),
    website: getAppSetting(CREATOR_PROFILE_LINK_SETTING_KEYS.website)
  });
}

export function saveCreatorProfileLinks(payload: CreatorProfileLinks): CreatorProfileLinks {
  const normalizedLinks = normalizeCreatorProfileLinks(payload);

  for (const [key, settingKey] of Object.entries(CREATOR_PROFILE_LINK_SETTING_KEYS) as Array<
    [keyof CreatorProfileLinks, string]
  >) {
    const value = normalizedLinks[key];
    if (value) {
      setAppSetting(settingKey, value);
    } else {
      clearAppSetting(settingKey);
    }
  }

  return normalizedLinks;
}

export function getCreatorVoiceSamples(): CollaboratorProfile["voiceSamples"] {
  const raw = getAppSetting(CREATOR_VOICE_SAMPLES_SETTING_KEY);
  if (!raw) {
    return [];
  }

  try {
    return normalizeVoiceSamples(JSON.parse(raw) as Partial<CollaboratorProfile["voiceSamples"][number]>[]);
  } catch {
    return [];
  }
}

export function saveCreatorVoiceSamples(
  payload: CollaboratorProfile["voiceSamples"]
): CollaboratorProfile["voiceSamples"] {
  const normalizedSamples = normalizeVoiceSamples(payload);
  if (normalizedSamples.length === 0) {
    clearAppSetting(CREATOR_VOICE_SAMPLES_SETTING_KEY);
    return [];
  }

  setAppSetting(CREATOR_VOICE_SAMPLES_SETTING_KEY, JSON.stringify(normalizedSamples));
  return normalizedSamples;
}

export function getCollaboratorProfiles(): CollaboratorProfile[] {
  const raw = getAppSetting(COLLABORATOR_PROFILES_SETTING_KEY);
  const legacySpeakerProfiles = getLegacySpeakerProfiles();

  if (!raw) {
    return legacySpeakerProfiles
      .filter((profile) => profile.role !== "creator")
      .map((profile) => ({
        id: profile.id || randomUUID(),
        displayName: profile.displayName,
        profileLinks: normalizeCreatorProfileLinks(null),
        speakerColorHex: normalizeSpeakerColorHex(profile.colorHex),
        voiceSamples: []
      }));
  }

  try {
    const normalizedProfiles = normalizeCollaboratorProfiles(JSON.parse(raw) as Partial<CollaboratorProfile>[]);
    if (legacySpeakerProfiles.length === 0) {
      return normalizedProfiles;
    }

    const legacyByName = new Map(
      legacySpeakerProfiles.map((profile) => [profile.displayName.trim().toLowerCase(), profile])
    );
    const mergedProfiles = normalizedProfiles.map((profile) => {
      const legacyMatch = legacyByName.get(profile.displayName.trim().toLowerCase());
      if (!legacyMatch || profile.speakerColorHex) {
        return profile;
      }

      return {
        ...profile,
        speakerColorHex: normalizeSpeakerColorHex(legacyMatch.colorHex, profile.speakerColorHex ?? undefined)
      };
    });

    const existingNames = new Set(mergedProfiles.map((profile) => profile.displayName.trim().toLowerCase()));
    const appendedProfiles = legacySpeakerProfiles
      .filter(
        (profile) =>
          profile.role !== "creator" && !existingNames.has(profile.displayName.trim().toLowerCase())
      )
      .map((profile) => ({
        id: profile.id || randomUUID(),
        displayName: profile.displayName,
        profileLinks: normalizeCreatorProfileLinks(null),
        speakerColorHex: normalizeSpeakerColorHex(profile.colorHex),
        voiceSamples: []
      }));

    return [...mergedProfiles, ...appendedProfiles];
  } catch {
    return [];
  }
}

export function saveCollaboratorProfiles(payload: CollaboratorProfile[]): CollaboratorProfile[] {
  const normalizedProfiles = normalizeCollaboratorProfiles(payload)
    .map((profile) => ({
      id: profile.id || randomUUID(),
      displayName: profile.displayName.trim(),
      profileLinks: normalizeCreatorProfileLinks(profile.profileLinks),
      speakerColorHex: normalizeSpeakerColorHex(profile.speakerColorHex),
      voiceSamples: profile.voiceSamples
    }))
    .filter(
      (profile) =>
        profile.displayName || hasAnyCreatorProfileLinks(profile.profileLinks) || profile.voiceSamples.length > 0
    );

  if (normalizedProfiles.length === 0) {
    clearAppSetting(COLLABORATOR_PROFILES_SETTING_KEY);
    clearAppSetting(LEGACY_SPEAKER_PROFILES_SETTING_KEY);
    return [];
  }

  setAppSetting(COLLABORATOR_PROFILES_SETTING_KEY, JSON.stringify(normalizedProfiles));
  clearAppSetting(LEGACY_SPEAKER_PROFILES_SETTING_KEY);
  return normalizedProfiles;
}

export function addCollaboratorVoiceSample(
  collaboratorProfileId: string,
  sample: CollaboratorProfile["voiceSamples"][number]
): CollaboratorProfile[] {
  const profiles = getCollaboratorProfiles();
  const targetProfile = profiles.find((profile) => profile.id === collaboratorProfileId);
  if (!targetProfile) {
    throw new Error("The selected collaborator profile no longer exists.");
  }

  targetProfile.voiceSamples = [
    ...targetProfile.voiceSamples.filter(
      (existingSample) =>
        !isSameClipVoiceSample(existingSample, sample)
    ),
    sample
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return saveCollaboratorProfiles(profiles);
}

export function removeCollaboratorVoiceSample(
  collaboratorProfileId: string,
  sampleId: string
): CollaboratorProfile[] {
  const profiles = getCollaboratorProfiles();
  const targetProfile = profiles.find((profile) => profile.id === collaboratorProfileId);
  if (!targetProfile) {
    throw new Error("The selected collaborator profile no longer exists.");
  }

  targetProfile.voiceSamples = targetProfile.voiceSamples.filter((sample) => sample.id !== sampleId);
  return saveCollaboratorProfiles(profiles);
}

export function addCreatorVoiceSample(
  sample: CollaboratorProfile["voiceSamples"][number]
): CollaboratorProfile["voiceSamples"] {
  const nextSamples = [
    ...getCreatorVoiceSamples().filter(
      (existingSample) =>
        !isSameClipVoiceSample(existingSample, sample)
    ),
    sample
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return saveCreatorVoiceSamples(nextSamples);
}

function isSameClipVoiceSample(
  left: CollaboratorProfile["voiceSamples"][number],
  right: CollaboratorProfile["voiceSamples"][number]
): boolean {
  return (
    left.source !== "microphone" &&
    right.source !== "microphone" &&
    left.clipId !== null &&
    left.segmentId !== null &&
    left.clipId === right.clipId &&
    left.segmentId === right.segmentId
  );
}

export function removeCreatorVoiceSample(sampleId: string): CollaboratorProfile["voiceSamples"] {
  const nextSamples = getCreatorVoiceSamples().filter((sample) => sample.id !== sampleId);
  return saveCreatorVoiceSamples(nextSamples);
}

function getLegacySpeakerProfiles(): Array<{
  id: string;
  displayName: string;
  colorHex: string | null;
  role: string | null;
}> {
  const raw = getAppSetting(LEGACY_SPEAKER_PROFILES_SETTING_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Array<{
      id?: string;
      displayName?: string;
      colorHex?: string | null;
      role?: string | null;
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((profile) => ({
        id: typeof profile.id === "string" ? profile.id : "",
        displayName: typeof profile.displayName === "string" ? profile.displayName.trim() : "",
        colorHex: typeof profile.colorHex === "string" ? profile.colorHex : null,
        role: typeof profile.role === "string" ? profile.role : null
      }))
      .filter((profile) => profile.displayName.length > 0);
  } catch {
    return [];
  }
}
