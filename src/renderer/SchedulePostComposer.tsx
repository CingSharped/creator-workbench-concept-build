import type { ChangeEvent } from "react";
import type {
  ClipRecord,
  NextAvailablePostingSlotResult,
  PublishPlatform,
  YouTubeConnectionStatus
} from "../shared/contracts";
import { Panel, PanelHeader } from "./WorkbenchPrimitives";

export interface SchedulePostComposerProps {
  selectedClip: ClipRecord | null;
  platform: PublishPlatform;
  accountLabel: string;
  publishAt: string;
  youtubeConnection: YouTubeConnectionStatus | null;
  busy: boolean;
  savingMetadata: boolean;
  error?: string | null;
  message?: string | null;
  nextPostingSlot?: NextAvailablePostingSlotResult | null;
  onPlatformChange: (platform: PublishPlatform) => void;
  onAccountLabelChange: (value: string) => void;
  onPublishAtChange: (value: string) => void;
  onOpenSettings: () => void;
  onSchedule: () => void;
  onScheduleAtNextSlot?: () => void;
}

export default function SchedulePostComposer({
  selectedClip,
  platform,
  accountLabel,
  publishAt,
  youtubeConnection,
  busy,
  savingMetadata,
  error,
  message,
  nextPostingSlot,
  onPlatformChange,
  onAccountLabelChange,
  onPublishAtChange,
  onOpenSettings,
  onSchedule,
  onScheduleAtNextSlot
}: SchedulePostComposerProps): JSX.Element {
  const publishParts = splitLocalDateTime(publishAt);
  const timeOptions = buildTimeOptions(publishParts.time);
  const youtubeConnected = youtubeConnection?.connected === true;
  const hasPublishTime = Boolean(publishParts.date && publishParts.time);
  const canSchedule = Boolean(
    selectedClip &&
    hasPublishTime &&
    !busy &&
    !savingMetadata &&
    (platform !== "youtube" || youtubeConnected)
  );
  const canScheduleAtNextSlot = Boolean(
    platform === "youtube" &&
    selectedClip &&
    youtubeConnected &&
    !busy &&
    !savingMetadata &&
    nextPostingSlot?.reason === "available"
  );

  function handleDateChange(event: ChangeEvent<HTMLInputElement>): void {
    onPublishAtChange(joinLocalDateTime(event.currentTarget.value, publishParts.time));
  }

  function handleTimeChange(event: ChangeEvent<HTMLSelectElement>): void {
    onPublishAtChange(joinLocalDateTime(publishParts.date, event.currentTarget.value));
  }

  return (
    <Panel className="schedule-post-composer" aria-labelledby="schedule-post-composer-title">
      <PanelHeader className="schedule-composer-heading">
        <div>
          <div className="title-with-tip">
            <h3 id="schedule-post-composer-title">Schedule post</h3>
            <span className="schedule-composer-platform-label">{platform === "youtube" ? "YouTube" : "TikTok draft handoff"}</span>
          </div>
          <p className="detail-meta">Choose the account and local publish time before the explicit action below.</p>
        </div>
        <div className="schedule-platform-switch" role="group" aria-label="Publish platform">
          <button type="button" className={platform === "youtube" ? "active" : ""} onClick={() => onPlatformChange("youtube")} aria-pressed={platform === "youtube"}>YouTube</button>
          <button type="button" className={platform === "tiktok" ? "active" : ""} onClick={() => onPlatformChange("tiktok")} aria-pressed={platform === "tiktok"}>TikTok</button>
        </div>
      </PanelHeader>

      {!selectedClip ? (
        <div className="empty-state compact">
          <h4>No clip selected</h4>
          <p>Choose a clip first, then set its account and local publish time here.</p>
        </div>
      ) : (
        <>
          <div className="schedule-composer-columns">
            <div className="schedule-composer-column">
              <span className="schedule-composer-label">{platform === "youtube" ? "YouTube account" : "Account"}</span>
              {platform === "youtube" ? (
                <>
                  <div className="schedule-account-summary">
                    <span className="schedule-account-avatar" aria-hidden="true">{getAccountInitial(youtubeConnection?.channelTitle)}</span>
                    <span>
                      <strong>{youtubeConnection?.channelTitle ?? "No YouTube account"}</strong>
                      <small>{youtubeConnected ? youtubeConnection?.channelId ? `Channel ID ${youtubeConnection.channelId}` : "Connected channel" : "Not connected"}</small>
                    </span>
                  </div>
                  <select
                    className="editor-input schedule-account-select"
                    value={youtubeConnected ? (youtubeConnection?.channelId ?? "connected") : ""}
                    onChange={() => undefined}
                    aria-label="YouTube account"
                    disabled={!youtubeConnected}
                  >
                    <option value="">Connect YouTube in Settings</option>
                    {youtubeConnected ? <option value={youtubeConnection?.channelId ?? "connected"}>{youtubeConnection?.channelTitle ?? "Connected channel"}</option> : null}
                  </select>
                  {!youtubeConnected ? (
                    <button type="button" className="secondary-button compact-button" onClick={onOpenSettings}>Open Settings</button>
                  ) : null}
                </>
              ) : (
                <input
                  className="editor-input"
                  value={accountLabel}
                  onChange={(event) => onAccountLabelChange(event.currentTarget.value)}
                  placeholder="Primary account"
                  aria-label="TikTok account label"
                />
              )}
            </div>

            <div className="schedule-composer-column">
              <span className="schedule-composer-label">Publish time</span>
              <div className="schedule-time-fields">
                <input
                  type="date"
                  className="editor-input"
                  value={publishParts.date}
                  onChange={handleDateChange}
                  aria-label="Publish date"
                />
                <select
                  className="editor-input"
                  value={publishParts.time}
                  onChange={handleTimeChange}
                  disabled={!publishParts.date}
                  aria-label="Publish time"
                >
                  <option value="">Select time</option>
                  {timeOptions.map((time) => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}
                </select>
              </div>
              <small className="schedule-local-time">Your time (Local)</small>
            </div>
          </div>

          <div className="schedule-composer-footer">
            <p className="detail-meta">
              {platform === "youtube"
                ? "YouTube uploads immediately and uses the selected future time when supported."
                : "This item is added to the local draft-handoff queue."}
            </p>
            <div className="schedule-composer-actions">
              {platform === "youtube" ? (
                <button type="button" className="primary-button" onClick={onScheduleAtNextSlot} disabled={!canScheduleAtNextSlot}>
                  {busy ? "Publishing..." : "Publish at next slot"}
                </button>
              ) : null}
              <button type="button" className={platform === "youtube" ? "secondary-button" : "primary-button"} onClick={onSchedule} disabled={!canSchedule}>
                {busy ? (platform === "youtube" ? "Publishing..." : "Scheduling...") : platform === "youtube" ? "Publish / schedule" : "Schedule post"}
              </button>
            </div>
          </div>
          {platform === "youtube" ? (
            <div className="schedule-next-slot" role="status">
              <span>Next recurring slot</span>
              <strong>{nextPostingSlot?.localLabel ?? "Not available"}</strong>
              {nextPostingSlot?.reason === "not_configured" ? <button type="button" className="link-button" onClick={onOpenSettings}>Configure in Settings</button> : null}
              {nextPostingSlot?.reason === "no_free_slot" ? <small>All future slots are occupied. Manual scheduling is still available.</small> : null}
              {nextPostingSlot?.reason === "youtube_disconnected" ? <small>Connect YouTube in Settings to use this action.</small> : null}
            </div>
          ) : null}
          {error ? <p className="schedule-composer-error" role="alert">{error}</p> : null}
          {message ? <p className="muted" role="status">{message}</p> : null}
        </>
      )}
    </Panel>
  );
}

function splitLocalDateTime(value: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value.trim());
  return { date: match?.[1] ?? "", time: match?.[2] ?? "" };
}

function joinLocalDateTime(date: string, time: string): string {
  if (!date) {
    return "";
  }
  return time ? `${date}T${time}` : date;
}

function buildTimeOptions(currentTime: string): string[] {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }
  if (currentTime && !options.includes(currentTime)) {
    options.push(currentTime);
    options.sort();
  }
  return options;
}

function formatTimeLabel(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function getAccountInitial(label: string | null | undefined): string {
  return label?.trim().charAt(0).toUpperCase() || "?";
}
