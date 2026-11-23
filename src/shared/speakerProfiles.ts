export const DEFAULT_SPEAKER_PROFILE_COLOR_PALETTE = [
  "#7DD3FC",
  "#FCA5A5",
  "#86EFAC",
  "#F9A8D4",
  "#C4B5FD",
  "#FCD34D",
  "#FB923C",
  "#93C5FD"
] as const;

export const FALLBACK_SPEAKER_COLOR = "#8B96A7";
export const CREATOR_SPEAKER_ID = "creator:self";
export const CREATOR_SPEAKER_LABEL = "You";
export const CREATOR_SPEAKER_COLOR = "#7DD3FC";

export function normalizeSpeakerColorHex(
  value: string | null | undefined,
  fallback: string = FALLBACK_SPEAKER_COLOR
): string {
  const normalizedValue = value?.trim() ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(normalizedValue) ? normalizedValue.toUpperCase() : fallback;
}

export function getDefaultSpeakerColor(index: number): string {
  return DEFAULT_SPEAKER_PROFILE_COLOR_PALETTE[
    Math.abs(index) % DEFAULT_SPEAKER_PROFILE_COLOR_PALETTE.length
  ];
}
