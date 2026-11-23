import type { PostingScheduleSettings } from "../../shared/contracts";
import {
  getDefaultPostingSchedule,
  normalizePostingScheduleSettings
} from "../../shared/postingSchedule";
import { getAppSetting, setAppSetting } from "./settingsRepository";

export const POSTING_SCHEDULE_SETTING_KEY = "publishing.default_posting_slots";

export function getPostingScheduleSettings(): PostingScheduleSettings {
  const stored = getAppSetting(POSTING_SCHEDULE_SETTING_KEY);
  if (!stored) {
    return getDefaultPostingSchedule();
  }

  try {
    return normalizePostingScheduleSettings(JSON.parse(stored));
  } catch {
    return getDefaultPostingSchedule();
  }
}

export function savePostingScheduleSettings(input: unknown): PostingScheduleSettings {
  const normalized = normalizePostingScheduleSettings(input);
  const saved: PostingScheduleSettings = {
    ...normalized,
    updatedAt: new Date().toISOString()
  };
  setAppSetting(POSTING_SCHEDULE_SETTING_KEY, JSON.stringify(saved));
  return saved;
}
