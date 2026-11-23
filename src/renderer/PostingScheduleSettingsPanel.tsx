import { useEffect, useState } from "react";
import type {
  NextAvailablePostingSlotReason,
  PostingScheduleDay,
  PostingScheduleSettings,
  RecurringPostingSlot
} from "../shared/contracts";
import { isValidLocalTime, normalizePostingScheduleSettings } from "../shared/postingSchedule";
import { SettingsCard, StatusBadge } from "./SettingsPrimitives";
import { Button, IconButton } from "./WorkbenchPrimitives";

interface PostingScheduleSettingsPanelProps {
  settings: PostingScheduleSettings;
  busy: boolean;
  nextSlotLabel: string | null;
  nextSlotReason: NextAvailablePostingSlotReason | null;
  onSave: (settings: PostingScheduleSettings) => void;
}

const DAY_OPTIONS: Array<{ value: PostingScheduleDay; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
];

export default function PostingScheduleSettingsPanel({
  settings,
  busy,
  nextSlotLabel,
  nextSlotReason,
  onSave
}: PostingScheduleSettingsPanelProps): JSX.Element {
  const [draft, setDraft] = useState<PostingScheduleSettings>(() => normalizePostingScheduleSettings(settings));

  useEffect(() => {
    setDraft(normalizePostingScheduleSettings(settings));
  }, [settings]);

  const hasInvalidSlot = draft.slots.some((slot) => slot.daysOfWeek.length === 0 || !isValidLocalTime(slot.localTime));
  const activeSlotCount = draft.slots.filter((slot) => slot.enabled).length;

  function updateSlot(slotId: string, update: Partial<RecurringPostingSlot>): void {
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((slot) => slot.id === slotId ? { ...slot, ...update } : slot)
    }));
  }

  function toggleDay(slot: RecurringPostingSlot, day: PostingScheduleDay): void {
    const daysOfWeek = slot.daysOfWeek.includes(day)
      ? slot.daysOfWeek.filter((value) => value !== day)
      : [...slot.daysOfWeek, day];
    updateSlot(slot.id, { daysOfWeek: daysOfWeek.sort((left, right) => left - right) });
  }

  function addSlot(daysOfWeek: PostingScheduleDay[] = [0, 1, 2, 3, 4, 5, 6]): void {
    const id = `slot-${Date.now()}-${draft.slots.length + 1}`;
    setDraft((current) => ({
      ...current,
      slots: [...current.slots, {
        id,
        enabled: true,
        recurrence: "weekly",
        daysOfWeek,
        localTime: "12:00"
      }]
    }));
  }

  function removeSlot(slotId: string): void {
    setDraft((current) => ({
      ...current,
      slots: current.slots.filter((slot) => slot.id !== slotId)
    }));
  }

  function applyPreset(daysOfWeek: PostingScheduleDay[]): void {
    if (draft.slots.length === 0) {
      addSlot(daysOfWeek);
      return;
    }
    updateSlot(draft.slots[0].id, { daysOfWeek, enabled: true });
  }

  return (
    <SettingsCard className="posting-schedule-card">
      <div className="posting-schedule-header">
        <div>
          <h3>Default posting times</h3>
          <p className="muted">Weekly slots are used by the one-click YouTube action. Nothing is scheduled until you explicitly publish from Edit.</p>
        </div>
        <StatusBadge tone={activeSlotCount > 0 ? "ready" : "muted"}>
          {activeSlotCount > 0 ? `${activeSlotCount} active weekly slot${activeSlotCount === 1 ? "" : "s"}` : "No active slots"}
        </StatusBadge>
      </div>

      <div className="posting-schedule-presets" aria-label="Posting schedule presets">
        <span className="detail-meta">Quick presets</span>
        <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => applyPreset([0, 1, 2, 3, 4, 5, 6])} disabled={busy}>Every day</Button>
        <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => applyPreset([1, 2, 3, 4, 5])} disabled={busy}>Weekdays</Button>
        <Button type="button" variant="secondary" compact className="secondary-button compact-button" onClick={() => applyPreset([0, 6])} disabled={busy}>Weekends</Button>
      </div>

      <div className="posting-schedule-list">
        {draft.slots.length === 0 ? (
          <div className="empty-state compact">
            <strong>No recurring posting slots</strong>
            <span>Add a slot to enable the next-slot action in Edit.</span>
          </div>
        ) : draft.slots.map((slot) => (
          <div className={`posting-schedule-slot${slot.enabled ? "" : " paused"}`} key={slot.id}>
            <div className="posting-schedule-slot-heading">
              <label className="posting-schedule-enabled">
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  onChange={(event) => updateSlot(slot.id, { enabled: event.currentTarget.checked })}
                  disabled={busy}
                />
                <span>{slot.enabled ? "Enabled" : "Paused"}</span>
              </label>
              <span className="posting-schedule-recurrence">Repeats weekly</span>
              <IconButton type="button" className="icon-button" onClick={() => removeSlot(slot.id)} disabled={busy} aria-label="Remove posting slot" title="Remove posting slot">X</IconButton>
            </div>
            <div className="posting-schedule-slot-controls">
              <div>
                <span className="posting-schedule-control-label">Days</span>
                <div className="posting-schedule-days" role="group" aria-label="Posting days">
                  {DAY_OPTIONS.map((day) => (
                    <Button
                      key={day.value}
                      type="button"
                      variant="secondary"
                      compact
                      className="posting-schedule-day"
                      onClick={() => toggleDay(slot, day.value)}
                      disabled={busy}
                      aria-pressed={slot.daysOfWeek.includes(day.value)}
                    >
                      <span className="posting-schedule-day-check" aria-hidden="true">
                        {slot.daysOfWeek.includes(day.value) ? "✓" : ""}
                      </span>
                      {day.label}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="posting-schedule-time">
                <span className="posting-schedule-control-label">Local time</span>
                <input
                  type="time"
                  className="editor-input"
                  value={slot.localTime}
                  onChange={(event) => updateSlot(slot.id, { localTime: event.currentTarget.value })}
                  disabled={busy}
                />
              </label>
            </div>
            {slot.daysOfWeek.length === 0 ? <p className="inline-warning">Choose at least one day for this slot.</p> : null}
            {!isValidLocalTime(slot.localTime) ? <p className="inline-warning">Choose a valid local time.</p> : null}
          </div>
        ))}
      </div>

      <div className="posting-schedule-actions">
        <Button type="button" variant="secondary" className="secondary-button" onClick={() => addSlot()} disabled={busy || draft.slots.length >= 28}>Add recurring slot</Button>
        <Button type="button" variant="primary" className="primary-button" onClick={() => onSave(normalizePostingScheduleSettings(draft))} disabled={busy || hasInvalidSlot}>
          {busy ? "Saving..." : "Save posting times"}
        </Button>
      </div>

      <p className="posting-schedule-next">
        <strong>Next available:</strong>{" "}
        {nextSlotLabel ?? (nextSlotReason === "no_free_slot" ? "All future slots are occupied." : nextSlotReason === "youtube_disconnected" ? "Connect YouTube to preview this." : "Not configured yet.")}
      </p>
    </SettingsCard>
  );
}
