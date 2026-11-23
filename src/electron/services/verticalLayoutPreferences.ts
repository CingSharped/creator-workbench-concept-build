import type { VerticalLayoutPreferences } from "../../shared/contracts";
import { getAppSetting, setAppSetting } from "./settingsRepository";

const VERTICAL_LAYOUT_PREFERENCES_KEY = "ui.vertical_layout_preferences";

const DEFAULT_VERTICAL_LAYOUT_PREFERENCES: VerticalLayoutPreferences = {
  mode: "stacked",
  topFocusX: 0.5,
  topFocusY: 0.5,
  topScale: 1,
  bottomFocusX: 0.5,
  bottomFocusY: 0.5,
  bottomScale: 1
};

export function getVerticalLayoutPreferences(): VerticalLayoutPreferences | null {
  const stored = getAppSetting(VERTICAL_LAYOUT_PREFERENCES_KEY);
  if (!stored) {
    return null;
  }

  try {
    return normalizeVerticalLayoutPreferences(JSON.parse(stored) as Partial<VerticalLayoutPreferences>);
  } catch {
    return null;
  }
}

export function saveVerticalLayoutPreferences(preferences: VerticalLayoutPreferences): VerticalLayoutPreferences {
  const normalized = normalizeVerticalLayoutPreferences(preferences);
  setAppSetting(VERTICAL_LAYOUT_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
}

function normalizeVerticalLayoutPreferences(
  preferences: Partial<VerticalLayoutPreferences>
): VerticalLayoutPreferences {
  return {
    mode: preferences.mode === "single" ? "single" : "stacked",
    topFocusX: clampNumber(preferences.topFocusX, DEFAULT_VERTICAL_LAYOUT_PREFERENCES.topFocusX, 0, 1),
    topFocusY: clampNumber(preferences.topFocusY, DEFAULT_VERTICAL_LAYOUT_PREFERENCES.topFocusY, 0, 1),
    topScale: clampNumber(preferences.topScale, DEFAULT_VERTICAL_LAYOUT_PREFERENCES.topScale, 0.25, 1),
    bottomFocusX: clampNumber(preferences.bottomFocusX, DEFAULT_VERTICAL_LAYOUT_PREFERENCES.bottomFocusX, 0, 1),
    bottomFocusY: clampNumber(preferences.bottomFocusY, DEFAULT_VERTICAL_LAYOUT_PREFERENCES.bottomFocusY, 0, 1),
    bottomScale: clampNumber(preferences.bottomScale, DEFAULT_VERTICAL_LAYOUT_PREFERENCES.bottomScale, 0.25, 1)
  };
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
