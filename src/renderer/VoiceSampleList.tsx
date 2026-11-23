import type { CollaboratorVoiceSample } from "../shared/contracts";
import { Button } from "./WorkbenchPrimitives";

interface VoiceSampleListProps {
  samples: CollaboratorVoiceSample[];
  locked?: boolean;
  removingSampleId?: string | null;
  onRemove?: (sampleId: string) => void;
  emptyMessage?: string;
}

function formatSampleTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "Time unavailable";
  }

  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSampleDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : parsed.toLocaleDateString();
}

export default function VoiceSampleList({
  samples,
  locked = false,
  removingSampleId = null,
  onRemove,
  emptyMessage = "No voice samples saved yet."
}: VoiceSampleListProps): JSX.Element {
  if (samples.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }

  return (
    <div className="voice-profile-sample-list" aria-label={`${samples.length} voice samples`}>
      {samples.map((sample) => (
        <div key={sample.id} className="voice-profile-sample-row">
          <div className="voice-profile-sample-copy">
            <strong>{sample.transcriptPreview || "Saved voice sample"}</strong>
            <span className="detail-meta">
              <span className="voice-sample-source-badge">
                {sample.source === "microphone" ? "Microphone" : "Transcript segment"}
              </span>
              {` · ${formatSampleDate(sample.createdAt)}`}
              {sample.source !== "microphone" ? ` · ${formatSampleTime(sample.startMs)} - ${formatSampleTime(sample.endMs)}` : ""}
            </span>
          </div>
          {!locked && onRemove ? (
            <Button
              type="button"
              variant="secondary"
              compact
              className="secondary-button compact-button"
              onClick={() => onRemove(sample.id)}
              disabled={removingSampleId === sample.id}
            >
              {removingSampleId === sample.id ? "Removing..." : "Remove"}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
