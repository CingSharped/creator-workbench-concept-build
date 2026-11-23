import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { calculateStackedCropRect } from "../shared/stackedVerticalLayout";
import { clampVideoTime, getVideoTimelineBounds } from "../shared/videoTimeline";
import { SegmentedTabs } from "./WorkbenchPrimitives";

export type VideoPreviewMode = "source" | "vertical";

export interface VideoLoopRange {
  startSeconds: number;
  endSeconds: number;
  active: boolean;
}

export interface VideoTimelineRange {
  startSeconds: number;
  endSeconds: number;
}

export interface VideoPlayerProps {
  displayName: string;
  sourcePath: string;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  frameRate?: number | null;
  previewMode?: VideoPreviewMode;
  defaultPreviewMode?: VideoPreviewMode;
  onPreviewModeChange?: (mode: VideoPreviewMode) => void;
  topFocusX?: number;
  topFocusY?: number;
  topScale?: number;
  bottomFocusX?: number;
  bottomFocusY?: number;
  bottomScale?: number;
  timelineRange?: VideoTimelineRange | null;
  loopRange?: VideoLoopRange;
  onLoopStateChange?: (active: boolean) => void;
  onTimeChange?: (seconds: number) => void;
  onDurationChange?: (seconds: number) => void;
  seekRequest?: { seconds: number; nonce: number } | null;
}

const PLAYER_VOLUME_STORAGE_KEY = "creator-workspace.player-volume";

function readSavedPlayerVolume(): number {
  try {
    const value = Number(window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.35;
  } catch {
    return 0.35;
  }
}

export default function VideoPlayer({
  displayName,
  sourcePath,
  durationMs,
  widthPx,
  heightPx,
  frameRate,
  previewMode,
  defaultPreviewMode = "vertical",
  onPreviewModeChange,
  topFocusX = 0.5,
  topFocusY = 0.5,
  topScale = 1,
  bottomFocusX = 0.5,
  bottomFocusY = 0.5,
  bottomScale = 1,
  timelineRange = null,
  loopRange,
  onLoopStateChange,
  onTimeChange,
  onDurationChange,
  seekRequest
}: VideoPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bottomVideoRef = useRef<HTMLVideoElement | null>(null);
  const [uncontrolledPreviewMode, setUncontrolledPreviewMode] = useState<VideoPreviewMode>(defaultPreviewMode);
  const [durationSeconds, setDurationSeconds] = useState(durationMs && durationMs > 0 ? durationMs / 1000 : 0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(readSavedPlayerVolume);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const activePreviewMode = previewMode ?? uncontrolledPreviewMode;
  const sourceFrameRate = frameRate && frameRate > 0 ? frameRate : 60;
  const frameDurationSeconds = 1 / sourceFrameRate;
  const mediaUrl = sourcePath.trim() ? window.creatorApp.getLocalMediaUrl(sourcePath) : null;
  const visibleMediaError = mediaError ?? (
    mediaUrl
      ? null
      : `No source file path is recorded for ${displayName}. Re-import or sync the Clip Library, then try again.`
  );

  useEffect(() => {
    setDurationSeconds(durationMs && durationMs > 0 ? durationMs / 1000 : 0);
    setCurrentTimeSeconds(0);
    setIsPlaying(false);
    onTimeChange?.(0);
    setMediaError(null);
  }, [sourcePath, durationMs]);

  useEffect(() => {
    setIsPlaying(false);
  }, [activePreviewMode]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
    if (bottomVideoRef.current) {
      bottomVideoRef.current.volume = volume;
    }
    try {
      window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // Volume persistence is best-effort if renderer storage is unavailable.
    }
  }, [volume, activePreviewMode, mediaUrl]);

  useEffect(() => {
    if (!seekRequest || !videoRef.current) {
      return;
    }

    const nextTime = clampToTimeline(seekRequest.seconds);
    videoRef.current.currentTime = nextTime;
    syncBottomVideo(nextTime);
    setCurrentTimeSeconds(nextTime);
    onTimeChange?.(nextTime);
    void videoRef.current.play().catch(() => undefined);
  }, [seekRequest?.nonce, mediaUrl, timelineRange?.startSeconds, timelineRange?.endSeconds, durationSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    const bounds = getTimelineBounds();
    if (!video || bounds.endSeconds <= bounds.startSeconds) {
      return;
    }

    const nextTime = clampToTimeline(video.currentTime);
    if (Math.abs(video.currentTime - nextTime) < 0.001) {
      return;
    }

    video.currentTime = nextTime;
    syncBottomVideo(nextTime);
    setCurrentTimeSeconds(nextTime);
    onTimeChange?.(nextTime);
  }, [timelineRange?.startSeconds, timelineRange?.endSeconds, durationSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !loopRange?.active || loopRange.endSeconds <= loopRange.startSeconds) {
      return;
    }

    const startTime = clampToTimeline(loopRange.startSeconds);
    video.currentTime = startTime;
    syncBottomVideo(startTime);
    setCurrentTimeSeconds(startTime);
    onTimeChange?.(startTime);
    void video.play().catch(() => onLoopStateChange?.(false));
  }, [loopRange?.active, loopRange?.startSeconds, loopRange?.endSeconds]);

  function syncBottomVideo(nextTime: number): void {
    if (activePreviewMode === "vertical" && bottomVideoRef.current && Math.abs(bottomVideoRef.current.currentTime - nextTime) > 0.08) {
      bottomVideoRef.current.currentTime = nextTime;
    }
  }

  function getTimelineBounds(): VideoTimelineRange {
    return getVideoTimelineBounds({
      timelineRange,
      durationSeconds,
      nativeDurationSeconds: videoRef.current?.duration,
      frameDurationSeconds
    });
  }

  function clampToTimeline(nextTime: number): number {
    return clampVideoTime(nextTime, getTimelineBounds());
  }

  function setPreviewMode(nextMode: VideoPreviewMode): void {
    if (previewMode === undefined) {
      setUncontrolledPreviewMode(nextMode);
    }
    onPreviewModeChange?.(nextMode);
  }

  function handleLoadedMetadata(event: React.SyntheticEvent<HTMLVideoElement>): void {
    const duration = event.currentTarget.duration;
    if (!duration || !Number.isFinite(duration)) {
      return;
    }

    setDurationSeconds(duration);
    onDurationChange?.(duration);
    setMediaError(null);
  }

  function handleTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>): void {
    const currentTime = clampToTimeline(event.currentTarget.currentTime);
    const hasConstrainedTimeline = Boolean(
      timelineRange && timelineRange.endSeconds > timelineRange.startSeconds
    );

    if (Math.abs(event.currentTarget.currentTime - currentTime) > 0.001) {
      event.currentTarget.currentTime = currentTime;
    }

    setCurrentTimeSeconds(currentTime);
    onTimeChange?.(currentTime);
    syncBottomVideo(currentTime);

    if (loopRange?.active && loopRange.endSeconds > loopRange.startSeconds && currentTime >= clampToTimeline(loopRange.endSeconds) - 0.05) {
      const startTime = clampToTimeline(loopRange.startSeconds);
      event.currentTarget.currentTime = startTime;
      syncBottomVideo(startTime);
      setCurrentTimeSeconds(startTime);
      onTimeChange?.(startTime);
      void event.currentTarget.play().catch(() => onLoopStateChange?.(false));
      return;
    }

    if (hasConstrainedTimeline && currentTime >= getTimelineBounds().endSeconds - 0.05) {
      event.currentTarget.currentTime = getTimelineBounds().endSeconds;
      syncBottomVideo(getTimelineBounds().endSeconds);
      setCurrentTimeSeconds(getTimelineBounds().endSeconds);
      onTimeChange?.(getTimelineBounds().endSeconds);
      event.currentTarget.pause();
    }
  }

  function handlePlay(): void {
    setIsPlaying(true);
    syncBottomVideo(videoRef.current?.currentTime ?? 0);
    void bottomVideoRef.current?.play().catch(() => undefined);
  }

  function handlePause(): void {
    setIsPlaying(false);
    bottomVideoRef.current?.pause();
    onLoopStateChange?.(false);
  }

  function togglePlayback(): void {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      const nextTime = clampToTimeline(video.currentTime);
      video.currentTime = nextTime;
      syncBottomVideo(nextTime);
      void video.play().catch(() => setIsPlaying(false));
      return;
    }

    video.pause();
  }

  function handleVolumeChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setVolume(Math.min(1, Math.max(0, event.currentTarget.valueAsNumber)));
  }

  function handleSeeking(): void {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextTime = clampToTimeline(video.currentTime);
    if (Math.abs(video.currentTime - nextTime) > 0.001) {
      video.currentTime = nextTime;
    }
    syncBottomVideo(nextTime);
  }

  function handleMediaError(): void {
    setMediaError(`The source file for ${displayName} could not be loaded. Re-import or sync the Clip Library, then try again.`);
  }

  function seekBySeconds(deltaSeconds: number): void {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextTime = clampToTimeline(video.currentTime + deltaSeconds);
    video.currentTime = nextTime;
    syncBottomVideo(nextTime);
    setCurrentTimeSeconds(nextTime);
    onTimeChange?.(nextTime);
  }

  function seekToTimelineSeconds(nextTime: number): void {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const boundedTime = clampToTimeline(nextTime);
    video.currentTime = boundedTime;
    syncBottomVideo(boundedTime);
    setCurrentTimeSeconds(boundedTime);
    onTimeChange?.(boundedTime);
    void video.play().catch(() => undefined);
  }

  const frameRateLabel = frameRate
    ? `${formatFrameRate(sourceFrameRate)} FPS`
    : "60 FPS assumed for this older record";

  return (
    <div className="shared-video-player">
      <SegmentedTabs className="player-mode-tabs" role="tablist" aria-label="Preview layout">
        <button type="button" className={activePreviewMode === "source" ? "active" : ""} onClick={() => setPreviewMode("source")} role="tab" aria-selected={activePreviewMode === "source"}>Source view</button>
        <button type="button" className={activePreviewMode === "vertical" ? "active" : ""} onClick={() => setPreviewMode("vertical")} role="tab" aria-selected={activePreviewMode === "vertical"}>Vertical preview</button>
      </SegmentedTabs>

      <div className="review-player">
        {activePreviewMode === "vertical" ? (
          <div className="review-stacked-preview" aria-label="Stacked vertical preview">
            <div className="review-stacked-preview-panel top">
              <span className="review-stacked-preview-label">Top section</span>
              <video
                key={`${sourcePath}-top`}
                ref={videoRef}
                className="review-video review-composed-video"
                src={mediaUrl ?? undefined}
                style={getStackedPreviewStyle(widthPx, heightPx, topScale, topFocusX, topFocusY)}
                controls={false}
                preload="metadata"
                aria-label="Vertical preview. Click to play or pause."
                title="Click to play or pause"
                onLoadStart={() => setMediaError(null)}
                onLoadedMetadata={handleLoadedMetadata}
                onError={handleMediaError}
                onTimeUpdate={handleTimeUpdate}
                onPlay={handlePlay}
                onSeeking={handleSeeking}
                onPause={handlePause}
                onEnded={handlePause}
                onClick={togglePlayback}
              />
            </div>
            <div className="review-stacked-preview-panel bottom">
              <span className="review-stacked-preview-label">Bottom section</span>
              <video
                key={`${sourcePath}-bottom`}
                ref={bottomVideoRef}
                className="review-video review-composed-video"
                src={mediaUrl ?? undefined}
                style={getStackedPreviewStyle(widthPx, heightPx, bottomScale, bottomFocusX, bottomFocusY)}
                muted
                preload="metadata"
                aria-hidden="true"
                onError={handleMediaError}
                onClick={togglePlayback}
              />
            </div>
          </div>
        ) : (
          <video
            key={sourcePath}
            ref={videoRef}
            className="review-video"
            src={mediaUrl ?? undefined}
            controls={false}
            preload="metadata"
            aria-label="Source video. Click to play or pause."
            title="Click to play or pause"
            onLoadStart={() => setMediaError(null)}
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleMediaError}
            onTimeUpdate={handleTimeUpdate}
            onPlay={handlePlay}
            onSeeking={handleSeeking}
            onPause={handlePause}
            onEnded={handlePause}
            onClick={togglePlayback}
          />
        )}

        {visibleMediaError ? (
          <div className="video-player-error" role="alert">
            <strong>Video unavailable</strong>
            <span>{visibleMediaError}</span>
          </div>
        ) : null}

        {!visibleMediaError && mediaUrl ? (
          <>
          <div className="player-timeline-control">
            <div className="player-timeline-labels">
              <span>{formatPlaybackTime(getTimelineBounds().startSeconds)}</span>
              <span>{formatPlaybackTime(getTimelineBounds().endSeconds)}</span>
            </div>
            <input
              className="player-timeline"
              type="range"
              min={getTimelineBounds().startSeconds}
              max={getTimelineBounds().endSeconds}
              step={frameDurationSeconds}
              value={clampToTimeline(currentTimeSeconds)}
              onChange={(event) => seekToTimelineSeconds(event.currentTarget.valueAsNumber)}
              disabled={durationSeconds <= 0 || getTimelineBounds().endSeconds <= getTimelineBounds().startSeconds}
              aria-label={timelineRange ? "Seek within trim selection" : "Seek within full clip"}
              title={timelineRange ? "Seek within the selected trim range" : "Seek within the full clip"}
            />
          </div>
          <div className="review-playback-controls" aria-label="Playback stepping controls">
            <button type="button" className="player-play-button" onClick={togglePlayback} disabled={durationSeconds <= 0} aria-label={isPlaying ? "Pause preview" : "Play preview"} title={isPlaying ? "Pause preview" : "Play preview"}>
              {isPlaying ? <span aria-hidden="true">&#10074;&#10074;</span> : <span aria-hidden="true">&#9654;</span>}
            </button>
            <label className="player-volume-control">
              <span className="player-volume-icon" aria-hidden="true">{volume === 0 ? <>&#128263;</> : <>&#128266;</>}</span>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} aria-label="Player volume" title={`Volume ${Math.round(volume * 100)}%`} />
            </label>
            <button type="button" className="player-step-button" onClick={() => seekBySeconds(-5)} disabled={durationSeconds <= 0} title="Back 5 seconds">
              <span className="player-step-icon">&#8634;</span><span>5s</span>
            </button>
            <button type="button" className="player-step-button" onClick={() => seekBySeconds(-1)} disabled={durationSeconds <= 0} title="Back 1 second">
              <span className="player-step-icon">&#8634;</span><span>1s</span>
            </button>
            <button type="button" className="player-step-button" onClick={() => seekBySeconds(-frameDurationSeconds)} disabled={durationSeconds <= 0} title="Back one frame">
              <span className="player-step-icon">&#8634;</span><span>F</span>
            </button>
            <span className="player-time-readout"><strong>{formatPlaybackTime(currentTimeSeconds)}</strong><small>{frameRateLabel}</small></span>
            <button type="button" className="player-step-button" onClick={() => seekBySeconds(frameDurationSeconds)} disabled={durationSeconds <= 0} title="Forward one frame">
              <span className="player-step-icon">&#8635;</span><span>F</span>
            </button>
            <button type="button" className="player-step-button" onClick={() => seekBySeconds(1)} disabled={durationSeconds <= 0} title="Forward 1 second">
              <span className="player-step-icon">&#8635;</span><span>1s</span>
            </button>
            <button type="button" className="player-step-button" onClick={() => seekBySeconds(5)} disabled={durationSeconds <= 0} title="Forward 5 seconds">
              <span className="player-step-icon">&#8635;</span><span>5s</span>
            </button>
          </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function getStackedPreviewStyle(
  sourceWidth: number | null,
  sourceHeight: number | null,
  scale: number,
  focusX: number,
  focusY: number
): CSSProperties {
  if (!sourceWidth || !sourceHeight) {
    return {
      objectPosition: "50% 50%",
      objectFit: "cover"
    };
  }

  const crop = calculateStackedCropRect(sourceWidth, sourceHeight, scale, focusX, focusY);

  return {
    left: `${-(crop.xPx / crop.widthPx) * 100}%`,
    top: `${-(crop.yPx / crop.heightPx) * 100}%`,
    width: `${(sourceWidth / crop.widthPx) * 100}%`,
    height: `${(sourceHeight / crop.heightPx) * 100}%`,
    objectFit: "fill"
  };
}

function formatFrameRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
