import type { CollaboratorProfile, CollaboratorVoiceSample, CreatorProfileLinks, VoiceSampleSource } from "./contracts";
import { getDefaultSpeakerColor, normalizeSpeakerColorHex } from "./speakerProfiles";

export const EMPTY_CREATOR_PROFILE_LINKS: CreatorProfileLinks = {
  youtube: null,
  tiktok: null,
  twitch: null,
  kick: null,
  instagram: null,
  x: null,
  discord: null,
  website: null
};

export const CREATOR_PROFILE_LINK_FIELDS: Array<{
  key: keyof CreatorProfileLinks;
  label: string;
  placeholder: string;
}> = [
  {
    key: "youtube",
    label: "YouTube",
    placeholder: "https://www.youtube.com/@YourHandle"
  },
  {
    key: "tiktok",
    label: "TikTok",
    placeholder: "https://www.tiktok.com/@yourhandle"
  },
  {
    key: "twitch",
    label: "Twitch",
    placeholder: "https://www.twitch.tv/yourhandle"
  },
  {
    key: "kick",
    label: "Kick",
    placeholder: "https://kick.com/yourhandle"
  },
  {
    key: "instagram",
    label: "Instagram",
    placeholder: "https://www.instagram.com/yourhandle"
  },
  {
    key: "x",
    label: "X",
    placeholder: "https://x.com/yourhandle"
  },
  {
    key: "discord",
    label: "Discord",
    placeholder: "https://discord.gg/yourinvite"
  },
  {
    key: "website",
    label: "Website",
    placeholder: "https://your-site.example"
  }
];

export function normalizeCreatorProfileLinks(
  links: Partial<CreatorProfileLinks> | null | undefined
): CreatorProfileLinks {
  return {
    youtube: normalizeCreatorProfileLink(links?.youtube),
    tiktok: normalizeCreatorProfileLink(links?.tiktok),
    twitch: normalizeCreatorProfileLink(links?.twitch),
    kick: normalizeCreatorProfileLink(links?.kick),
    instagram: normalizeCreatorProfileLink(links?.instagram),
    x: normalizeCreatorProfileLink(links?.x),
    discord: normalizeCreatorProfileLink(links?.discord),
    website: normalizeCreatorProfileLink(links?.website)
  };
}

export function normalizeCollaboratorProfiles(
  profiles: Partial<CollaboratorProfile>[] | null | undefined
): CollaboratorProfile[] {
  if (!Array.isArray(profiles)) {
    return [];
  }

  return profiles
    .map((profile, index) => ({
      id: typeof profile.id === "string" ? profile.id : "",
      displayName: typeof profile.displayName === "string" ? profile.displayName.trim() : "",
      profileLinks: normalizeCreatorProfileLinks(profile.profileLinks),
      speakerColorHex: normalizeSpeakerColorHex(profile.speakerColorHex, getDefaultSpeakerColor(index + 1)),
      voiceSamples: normalizeVoiceSamples(profile.voiceSamples)
    }))
    .filter(
      (profile) =>
        profile.id ||
        profile.displayName ||
        hasAnyCreatorProfileLinks(profile.profileLinks) ||
        profile.voiceSamples.length > 0
    );
}

export function hasAnyCreatorProfileLinks(links: CreatorProfileLinks): boolean {
  return Object.values(links).some((value) => Boolean(value));
}

export function buildCreatorProfileLinksBlock(links: CreatorProfileLinks): string {
  const normalizedLinks = normalizeCreatorProfileLinks(links);
  const lines = CREATOR_PROFILE_LINK_FIELDS.map((field) => {
    const value = normalizedLinks[field.key];
    return value ? `${field.label}: ${value}` : null;
  }).filter((line): line is string => line !== null);

  if (lines.length === 0) {
    return "";
  }

  return ["More from me:", ...lines].join("\n");
}

export function buildCollaboratorLinksBlock(collaborators: CollaboratorProfile[]): string {
  const normalizedCollaborators = normalizeCollaboratorProfiles(collaborators);
  if (normalizedCollaborators.length === 0) {
    return "";
  }

  return normalizedCollaborators
    .map((collaborator) => {
      const displayName = collaborator.displayName.trim();
      if (!displayName) {
        return "";
      }

      const linkLines = CREATOR_PROFILE_LINK_FIELDS.map((field) => {
        const value = collaborator.profileLinks[field.key];
        return value ? `${field.label}: ${value}` : null;
      }).filter((line): line is string => line !== null);

      return [`Featuring ${displayName}:`, linkLines.join("\n")].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function mergeProfileBlocksIntoDescription(
  description: string,
  creatorLinks: CreatorProfileLinks,
  collaborators: CollaboratorProfile[]
): string {
  const normalizedDescription = stripExistingProfileBlocks(description);
  const creatorBlock = buildCreatorProfileLinksBlock(creatorLinks);
  const collaboratorBlock = buildCollaboratorLinksBlock(collaborators);
  const trailingBlocks = [creatorBlock, collaboratorBlock].filter(Boolean);

  if (trailingBlocks.length === 0) {
    return normalizedDescription;
  }

  return normalizedDescription
    ? `${normalizedDescription}\n\n${trailingBlocks.join("\n\n")}`.trim()
    : trailingBlocks.join("\n\n").trim();
}

export function stripExistingProfileBlocks(description: string): string {
  const normalizedDescription = description.trim();
  const markers = [
    "\n\nFeaturing:",
    "\n\nFeaturing ",
    "\n\nMore from me:",
    "\n\nCheck out the crew:",
    "Featuring:",
    "Featuring ",
    "More from me:",
    "Check out the crew:"
  ];

  let firstIndex = -1;
  for (const marker of markers) {
    const markerIndex = normalizedDescription.indexOf(marker);
    if (markerIndex >= 0 && (firstIndex < 0 || markerIndex < firstIndex)) {
      firstIndex = markerIndex;
    }
  }

  return firstIndex >= 0 ? normalizedDescription.slice(0, firstIndex).trim() : normalizedDescription;
}

function normalizeCreatorProfileLink(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim() ?? "";
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function normalizeVoiceSamples(
  samples: Partial<CollaboratorVoiceSample>[] | null | undefined
): CollaboratorVoiceSample[] {
  if (!Array.isArray(samples)) {
    return [];
  }

  return samples
    .map((sample) => ({
      id: typeof sample.id === "string" ? sample.id : "",
      clipId: typeof sample.clipId === "string" && sample.clipId.trim() ? sample.clipId : null,
      segmentId: typeof sample.segmentId === "string" && sample.segmentId.trim() ? sample.segmentId : null,
      source: (sample.source === "microphone" ? "microphone" : "clip_segment") as VoiceSampleSource,
      transcriptPreview:
        typeof sample.transcriptPreview === "string" ? sample.transcriptPreview.trim() : "",
      startMs: typeof sample.startMs === "number" && Number.isFinite(sample.startMs) ? sample.startMs : null,
      endMs: typeof sample.endMs === "number" && Number.isFinite(sample.endMs) ? sample.endMs : null,
      signature: Array.isArray(sample.signature)
        ? sample.signature.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        : [],
      createdAt: typeof sample.createdAt === "string" ? sample.createdAt : ""
    }))
    .filter(
      (sample) =>
        sample.id &&
        (sample.source === "microphone" || (sample.clipId && sample.segmentId)) &&
        sample.signature.length > 0
    );
}
