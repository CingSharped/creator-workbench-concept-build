import type {
  NextAvailablePostingSlotResult,
  PostingScheduleDay,
  PostingScheduleSettings,
  RecurringPostingSlot,
  ScheduledPostRecord
} from "./contracts";

export const DEFAULT_POSTING_SCHEDULE: PostingScheduleSettings = {
  version: 1,
  slots: [
    {
      id: "daily-noon",
      enabled: true,
      recurrence: "weekly",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      localTime: "12:00"
    }
  ],
  updatedAt: null
};

export const POSTING_SCHEDULE_LOOKAHEAD_DAYS = 90;
export const POSTING_SCHEDULE_LEAD_MINUTES = 5;
export const POSTING_SCHEDULE_MAX_EFFECTIVE_OCCURRENCES = 28;

const VALID_DAYS = new Set<PostingScheduleDay>([0, 1, 2, 3, 4, 5, 6]);
const OCCUPYING_POST_STATUSES = new Set<ScheduledPostRecord["status"]>([
  "scheduled",
  "posting",
  "posted",
  "reconciliation_required"
]);

export function normalizePostingScheduleSettings(value: unknown): PostingScheduleSettings {
  const rawSlots = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { slots?: unknown }).slots
    : undefined;
  const slots = Array.isArray(rawSlots) ? rawSlots : [];
  const normalizedSlots: RecurringPostingSlot[] = [];
  const seenSlotKeys = new Set<string>();
  let remainingOccurrences = POSTING_SCHEDULE_MAX_EFFECTIVE_OCCURRENCES;

  slots.forEach((rawSlot, index) => {
    if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot) || remainingOccurrences <= 0) {
      return;
    }

    const slot = rawSlot as {
      id?: unknown;
      enabled?: unknown;
      recurrence?: unknown;
      daysOfWeek?: unknown;
      dayOfWeek?: unknown;
      localTime?: unknown;
    };
    const localTime = typeof slot.localTime === "string" && isValidLocalTime(slot.localTime)
      ? slot.localTime
      : null;
    if (!localTime) {
      return;
    }

    const rawDays = Array.isArray(slot.daysOfWeek)
      ? slot.daysOfWeek
      : typeof slot.dayOfWeek === "number"
        ? [slot.dayOfWeek]
        : [];
    const daysOfWeek = [...new Set(
      rawDays.filter((day): day is PostingScheduleDay => typeof day === "number" && VALID_DAYS.has(day as PostingScheduleDay))
    )].sort((left, right) => left - right).slice(0, remainingOccurrences);
    if (daysOfWeek.length === 0) {
      return;
    }

    const slotKey = `${daysOfWeek.join(",")}|${localTime}`;
    if (seenSlotKeys.has(slotKey)) {
      return;
    }
    seenSlotKeys.add(slotKey);
    remainingOccurrences -= daysOfWeek.length;

    const rawId = typeof slot.id === "string" && slot.id.trim() ? slot.id.trim() : `slot-${index + 1}`;
    normalizedSlots.push({
      id: makeUniqueSlotId(rawId, normalizedSlots),
      enabled: slot.enabled !== false,
      recurrence: "weekly",
      daysOfWeek,
      localTime
    });
  });

  return {
    version: 1,
    slots: normalizedSlots,
    updatedAt: value && typeof value === "object" && !Array.isArray(value) && typeof (value as { updatedAt?: unknown }).updatedAt === "string"
      ? (value as { updatedAt: string }).updatedAt
      : null
  };
}

export function getDefaultPostingSchedule(): PostingScheduleSettings {
  return clonePostingSchedule(DEFAULT_POSTING_SCHEDULE);
}

export function isValidLocalTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function resolveNextAvailablePostingSlot(
  settings: PostingScheduleSettings,
  posts: ScheduledPostRecord[],
  options: {
    remoteTimes?: string[];
    now?: Date;
    channelId?: string | null;
    accountLabel?: string | null;
    lookaheadDays?: number;
    leadMinutes?: number;
  } = {}
): NextAvailablePostingSlotResult {
  const normalized = normalizePostingScheduleSettings(settings);
  const activeSlots = normalized.slots.filter((slot) => slot.enabled && slot.daysOfWeek.length > 0);
  if (activeSlots.length === 0) {
    return {
      publishAt: null,
      slotId: null,
      reason: "not_configured",
      localLabel: null
    };
  }

  const now = options.now ? new Date(options.now.getTime()) : new Date();
  const minimumTime = now.getTime() + (options.leadMinutes ?? POSTING_SCHEDULE_LEAD_MINUTES) * 60_000;
  const lookaheadDays = options.lookaheadDays ?? POSTING_SCHEDULE_LOOKAHEAD_DAYS;
  const candidates: Array<{ date: Date; slotId: string }> = [];

  for (let dayOffset = 0; dayOffset <= lookaheadDays; dayOffset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
    const dayOfWeek = day.getDay() as PostingScheduleDay;
    for (const slot of activeSlots) {
      if (!slot.daysOfWeek.includes(dayOfWeek)) {
        continue;
      }

      const [hour, minute] = slot.localTime.split(":").map(Number);
      const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
      if (
        candidate.getHours() !== hour ||
        candidate.getMinutes() !== minute ||
        candidate.getDay() !== dayOfWeek ||
        candidate.getTime() < minimumTime
      ) {
        continue;
      }

      candidates.push({ date: candidate, slotId: slot.id });
    }
  }

  candidates.sort((left, right) => left.date.getTime() - right.date.getTime() || left.slotId.localeCompare(right.slotId));
  const remoteMinutes = new Set(options.remoteTimes?.map(time => Math.floor(Date.parse(time) / 60_000)));
  for (const candidate of candidates) {
    if (remoteMinutes.has(Math.floor(candidate.date.getTime() / 60_000)) || isPostingSlotOccupied(posts, candidate.date, options.channelId, options.accountLabel)) {
      continue;
    }

    return {
      publishAt: candidate.date.toISOString(),
      slotId: candidate.slotId,
      reason: "available",
      localLabel: formatLocalSlotLabel(candidate.date)
    };
  }

  return {
    publishAt: null,
    slotId: null,
    reason: "no_free_slot",
    localLabel: null
  };
}

export function isPostingSlotOccupied(
  posts: ScheduledPostRecord[],
  candidate: Date,
  channelId?: string | null,
  accountLabel?: string | null
): boolean {
  const candidateMinute = Math.floor(candidate.getTime() / 60_000);
  return posts.some((post) => {
    if ((post.status === "posted" && post.lastRemoteCheckAt) || post.platform !== "youtube" || !OCCUPYING_POST_STATUSES.has(post.status)) {
      return false;
    }

    if (post.channelId && channelId) {
      if (post.channelId !== channelId) {
        return false;
      }
    } else if (post.channelId || channelId) {
      if (!accountLabel?.trim() || post.accountLabel.trim() !== accountLabel.trim()) {
        return false;
      }
    } else if (!accountLabel?.trim() || post.accountLabel.trim() !== accountLabel.trim()) {
      return false;
    }

    const postTime = new Date(post.publishAt).getTime();
    return Number.isFinite(postTime) && Math.floor(postTime / 60_000) === candidateMinute;
  });
}

function makeUniqueSlotId(baseId: string, slots: RecurringPostingSlot[]): string {
  if (!slots.some((slot) => slot.id === baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (slots.some((slot) => slot.id === `${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

function clonePostingSchedule(settings: PostingScheduleSettings): PostingScheduleSettings {
  return {
    version: 1,
    updatedAt: settings.updatedAt,
    slots: settings.slots.map((slot) => ({ ...slot, daysOfWeek: [...slot.daysOfWeek] }))
  };
}

function formatLocalSlotLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
