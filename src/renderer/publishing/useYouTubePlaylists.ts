import { useEffect, useRef, useState } from "react";
import type { CreatorAppApi, YouTubeConnectionStatus, YouTubePlaylistRecord } from "../../shared/contracts";
import { useEditingSession } from "../useEditingSession";

export function youtubeAccountKey(connection: YouTubeConnectionStatus | null): string | null {
  return connection?.connected
    ? JSON.stringify([connection.channelId, connection.clientId, connection.channelTitle])
    : null;
}

interface Options {
  selectedClipId: string | null;
  connection: YouTubeConnectionStatus | null;
  onError: (message: string | null) => void;
  api?: Pick<CreatorAppApi, "listYouTubePlaylists">;
}
export function useYouTubePlaylists({ selectedClipId, connection, onError, api = window.creatorApp }: Options) {
  const account = useEditingSession(youtubeAccountKey(connection));
  const selection = useEditingSession(selectedClipId);
  const [playlists, setPlaylists] = useState<YouTubePlaylistRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const idsRef = useRef<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const key = youtubeAccountKey(connection);

  function selectIds(ids: string[]): void {
    idsRef.current = [...ids];
    setSelectedIds([...ids]);
    setMessage(null);
  }
  useEffect(() => { selectIds([]); }, [selectedClipId]);

  async function refresh(): Promise<void> {
    if (!key) return;
    const ticket = account.begin("playlists");
    const selectedTicket = selection.capture();
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.listYouTubePlaylists();
      if (!account.latest(ticket)) return;
      setPlaylists(result);
      setLoaded(true);
      if (selection.owns(selectedTicket)) {
        const available = new Set(result.map(item => item.id));
        const before = idsRef.current;
        const next = before.filter(id => available.has(id));
        idsRef.current = next;
        setSelectedIds(next);
        const removed = before.length - next.length;
        if (removed) setMessage(`${removed} selected playlist${removed === 1 ? "" : "s"} is no longer available and was removed from this draft.`);
      }
    } catch (error) {
      if (!account.latest(ticket)) return;
      setLoaded(true);
      onError(error instanceof Error ? error.message : "Failed to load YouTube playlists.");
    } finally {
      if (account.latest(ticket)) setLoading(false);
    }
  }
  useEffect(() => {
    setPlaylists([]);
    setLoaded(false);
    setLoading(false);
    selectIds([]);
    if (key) void refresh();
  }, [key]);

  return { playlists, selectedIds, selectIds, loaded, loading, message, refresh };
}
