import { useState } from "react";
import type { YouTubeConnectionStatus, YouTubePlaylistRecord } from "../shared/contracts";
import { IconButton } from "./WorkbenchPrimitives";

export interface YouTubePlaylistPickerProps {
  youtubeConnection: YouTubeConnectionStatus | null;
  youtubePlaylists: YouTubePlaylistRecord[];
  selectedPlaylistIds: string[];
  loading: boolean;
  loaded: boolean;
  selectionMessage?: string | null;
  onSelectionChange: (playlistIds: string[]) => void;
  onRefresh: () => void;
}

export default function YouTubePlaylistPicker({
  youtubeConnection,
  youtubePlaylists,
  selectedPlaylistIds,
  loading,
  loaded,
  selectionMessage,
  onSelectionChange,
  onRefresh
}: YouTubePlaylistPickerProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visiblePlaylists = youtubePlaylists.filter((playlist) =>
    playlist.title.toLowerCase().includes(normalizedQuery)
  );
  const connected = youtubeConnection?.connected === true;
  const selectedCount = selectedPlaylistIds.length;
  const disclosureLabel = selectedCount === 0
    ? "No playlists selected"
    : `${selectedCount} playlist${selectedCount === 1 ? "" : "s"} selected`;

  function handlePlaylistChange(playlistId: string, checked: boolean): void {
    onSelectionChange(checked
      ? [...selectedPlaylistIds, playlistId]
      : selectedPlaylistIds.filter((id) => id !== playlistId));
  }

  return (
    <details className="cw-disclosure youtube-playlist-picker">
      <summary className="youtube-playlist-picker-summary">
        <span>
          <strong>YouTube playlists</strong>
          <small>{disclosureLabel}</small>
        </span>
        <span className="youtube-playlist-picker-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="youtube-playlist-picker-content">
        <div className="field-header youtube-playlist-picker-header">
          <div>
            <span className="schedule-composer-label">Optional publishing destinations</span>
            <span className="detail-meta">This choice is used when publishing and is not saved into the reusable metadata package.</span>
          </div>
          <IconButton
            type="button"
            className="icon-button"
            onClick={onRefresh}
            disabled={!connected || loading}
            aria-label={loaded ? "Refresh YouTube playlists" : "Load YouTube playlists"}
            title={loaded ? "Refresh YouTube playlists" : "Load YouTube playlists"}
          >
            {loading ? "..." : "↻"}
          </IconButton>
        </div>

        {selectionMessage ? <p className="inline-warning youtube-playlist-picker-message" role="status">{selectionMessage}</p> : null}

        {connected && youtubePlaylists.length > 0 ? (
          <>
            <input
              type="search"
              className="editor-input youtube-playlist-picker-search"
              aria-label="Search playlists"
              placeholder="Search playlists…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            <div
              className="youtube-playlist-picker-list"
              role="group"
              aria-label="YouTube playlists"
            >
              {visiblePlaylists.length === 0 ? (
                <p className="detail-meta youtube-playlist-picker-message" role="status">No playlists match your search.</p>
              ) : null}
              {visiblePlaylists.map((playlist) => (
                <label key={playlist.id} className="youtube-playlist-picker-option">
                  <input
                    type="checkbox"
                    checked={selectedPlaylistIds.includes(playlist.id)}
                    onChange={(event) => handlePlaylistChange(playlist.id, event.currentTarget.checked)}
                  />
                  <span>{playlist.title} ({playlist.itemCount})</span>
                </label>
              ))}
            </div>
            </>
        ) : (
          <span className="detail-meta">
            {connected
              ? loaded
                ? "No user-created playlists were returned."
                : "Use refresh to load your YouTube playlists."
              : "Connect YouTube in Settings to choose playlists."}
          </span>
        )}
      </div>
    </details>
  );
}
