import { useEffect, useRef, useState } from "react";
import type { AppInfo } from "../shared/contracts";
import InfoTip from "./InfoTip";
import { Button } from "./WorkbenchPrimitives";

export const VOICE_SAMPLE_SCRIPT =
  "I was sure we had that round, but the plan changed quickly. We pushed forward, called the target, and somehow turned a quiet setup into complete chaos.";

interface VoiceSampleRecorderProps {
  profileId: string;
  profileLabel: string;
  disabled?: boolean;
  onSaved?: (appInfo: AppInfo) => void;
  onError?: (message: string) => void;
}

type RecorderState = "idle" | "recording" | "ready" | "processing";
const MAX_RECORDING_MS = 15_000;

function getSupportedMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

export default function VoiceSampleRecorder({
  profileId,
  profileLabel,
  disabled = false,
  onSaved,
  onError
}: VoiceSampleRecorderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && state !== "processing") {
        event.preventDefault();
        closeRecorder();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) {
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % focusable.length;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, state]);

  useEffect(() => {
    if (state !== "recording") {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()));
    }, 100);
    return () => window.clearInterval(interval);
  }, [state]);

  useEffect(() => () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function closeRecorder(): void {
    discardingRef.current = true;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    setRecordedBlob(null);
    startedAtRef.current = null;
    setState("idle");
    setElapsedMs(0);
    setError(null);
    setOpen(false);
  }

  async function finalizeRecording(recording: Blob): Promise<void> {
    setState("processing");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      const audioData = await recording.arrayBuffer();
      const nextInfo = await window.creatorApp.recordVoiceProfileSample({
        profileId,
        audioData,
        mimeType: recording.type,
        transcriptPreview: VOICE_SAMPLE_SCRIPT
      });
      setRecordedBlob(null);
      setOpen(false);
      setState("idle");
      onSaved?.(nextInfo);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "The voice sample could not be saved.";
      setError(message);
      onError?.(message);
      setState("ready");
    } finally {
      recorderRef.current = null;
      chunksRef.current = [];
      startedAtRef.current = null;
      setElapsedMs(0);
    }
  }

  async function startRecording(): Promise<void> {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is not available in this app session.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (discardingRef.current) {
          discardingRef.current = false;
          return;
        }
        const recording = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        setRecordedBlob(recording);
        setState("ready");
        setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()));
        startedAtRef.current = null;
        chunksRef.current = [];
      };
      recorder.start();
      discardingRef.current = false;
      setRecordedBlob(null);
      setElapsedMs(0);
      setState("recording");
      stopTimerRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (nextError) {
      const message = nextError instanceof Error && nextError.name === "NotAllowedError"
        ? "Microphone access was denied. Allow access and try again."
        : "The microphone could not be opened. Check the selected input and try again.";
      setError(message);
      onError?.(message);
    }
  }

  function stopRecording(): void {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function retryRecording(): void {
    setRecordedBlob(null);
    setError(null);
    void startRecording();
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        compact
        className="secondary-button compact-button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabled}
      >
        Record sample
      </Button>
      {open ? (
        <div className="modal-backdrop" role="presentation">
          <section ref={dialogRef} className="confirmation-modal voice-sample-recorder" role="dialog" aria-modal="true" aria-labelledby="voice-sample-recorder-title">
            <div className="panel-header">
              <div>
                <h2 id="voice-sample-recorder-title">Record a voice sample</h2>
                <p className="muted">This stays on your computer and helps identify {profileLabel} in transcript review.</p>
              </div>
              <InfoTip label="About voice samples">
                The app stores a compact local voice signature, not the recording itself or a model weight update.
              </InfoTip>
            </div>
            <div className="voice-sample-script">
              <span className="detail-meta">Read this naturally</span>
              <p>{VOICE_SAMPLE_SCRIPT}</p>
            </div>
            {state === "recording" ? (
              <p className="voice-recording-status" role="status">Recording {Math.max(0, Math.round(elapsedMs / 1000))}s of 15s...</p>
            ) : state === "processing" ? (
              <p className="voice-recording-status" role="status">Checking the sample locally...</p>
            ) : null}
            {error ? <p className="inline-error" role="alert">{error}</p> : null}
            <div className="confirmation-modal-actions">
              <Button ref={cancelButtonRef} type="button" variant="secondary" className="secondary-button" onClick={closeRecorder} disabled={state === "processing"}>
                Cancel
              </Button>
              {state === "recording" ? (
                <Button type="button" variant="primary" className="primary-button" onClick={stopRecording}>
                  Stop recording
                </Button>
              ) : state === "ready" && recordedBlob ? (
                <>
                  <Button type="button" variant="secondary" className="secondary-button" onClick={retryRecording}>
                    Retry
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    className="primary-button"
                    onClick={() => void finalizeRecording(recordedBlob)}
                  >
                    Save sample
                  </Button>
                </>
              ) : (
                <Button type="button" variant="primary" className="primary-button" onClick={() => void startRecording()} disabled={state === "processing"}>
                  {state === "processing" ? "Saving..." : "Start recording"}
                </Button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
