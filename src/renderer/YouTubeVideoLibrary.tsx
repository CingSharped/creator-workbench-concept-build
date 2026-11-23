import { useEffect, useMemo, useState } from "react";
import type {
  ThumbnailCandidateRecord,
  YouTubeBulkEditResult,
  YouTubeManagedVideoRecord,
  YouTubeMetadataDraft
} from "../shared/contracts";
import ConfirmActionDialog from "./ConfirmActionDialog";
import InfoTip from "./InfoTip";
import { Card, Panel, PanelHeader, StatusBadge } from "./WorkbenchPrimitives";

type BulkFields = {
  titleEnabled: boolean;
  title: string;
  descriptionEnabled: boolean;
  description: string;
  tagsEnabled: boolean;
  tags: string;
  tagMode: "replace" | "add" | "remove";
  categoryEnabled: boolean;
  categoryId: string;
};

const EMPTY_BULK_FIELDS: BulkFields = {
  titleEnabled: false,
  title: "",
  descriptionEnabled: false,
  description: "",
  tagsEnabled: false,
  tags: "",
  tagMode: "replace",
  categoryEnabled: false,
  categoryId: ""
};

interface YouTubeVideoLibraryProps {
  onOpenClip?: (clipId: string) => void;
}

export default function YouTubeVideoLibrary({ onOpenClip }: YouTubeVideoLibraryProps): JSX.Element {
  const [videos, setVideos] = useState<YouTubeManagedVideoRecord[]>([]);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "30d" | "year">("all");
  const [formatFilter, setFormatFilter] = useState<"all" | "short" | "long" | "unknown">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [draft, setDraft] = useState<YouTubeMetadataDraft | null>(null);
  const [candidates, setCandidates] = useState<ThumbnailCandidateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"saving" | "updating" | "generating" | "applying" | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFields, setBulkFields] = useState<BulkFields>(EMPTY_BULK_FIELDS);
  const [bulkConfirmation, setBulkConfirmation] = useState(false);
  const [thumbnailConfirmation, setThumbnailConfirmation] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeVideo = videos.find((video) => video.videoId === activeVideoId) ?? null;
  const filteredVideos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return videos.filter((video) => {
      const matchesQuery = !normalizedQuery || `${video.title} ${video.description} ${video.tags.join(" ")}`.toLowerCase().includes(normalizedQuery);
      const matchesDate = dateFilter === "all" || matchesPublishedDate(video.publishedAt, dateFilter);
      const matchesFormat = formatFilter === "all" || matchesVideoFormat(video.durationSeconds, formatFilter);
      return matchesQuery && matchesDate && matchesFormat;
    });
  }, [dateFilter, formatFilter, query, videos]);

  useEffect(() => {
    void loadCachedVideos();
  }, []);

  useEffect(() => {
    if (!activeVideo) {
      setDraft(null);
      setCandidates([]);
      return;
    }
    setDraft({
      videoId: activeVideo.videoId,
      title: activeVideo.title,
      description: activeVideo.description,
      tags: [...activeVideo.tags],
      categoryId: activeVideo.categoryId,
      baseRemoteRevision: activeVideo.remoteRevision,
      updatedAt: new Date().toISOString()
    });
    void window.creatorApp.getYouTubeMetadataDraft(activeVideo.videoId).then((saved) => {
      if (saved) setDraft(saved);
    }).catch(() => undefined);
    void window.creatorApp.listYouTubeThumbnailCandidates(activeVideo.videoId).then(setCandidates).catch(() => setCandidates([]));
  }, [activeVideoId]);

  async function loadCachedVideos(): Promise<void> {
    setLoading(true);
    try {
      setVideos(await window.creatorApp.listManagedYouTubeVideos());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The local YouTube video cache could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshVideos(): Promise<void> {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const refreshed = await window.creatorApp.executeAction<YouTubeManagedVideoRecord[]>("youtube_videos.refresh", {
        publishedAfter: "2020-01-01",
        maxResults: 150
      });
      setVideos(refreshed);
      setMessage(`${refreshed.length} owned YouTube videos refreshed.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "YouTube videos could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  function openVideo(video: YouTubeManagedVideoRecord): void {
    setActiveVideoId(video.videoId);
    setError(null);
    setMessage(null);
  }

  function toggleSelected(videoId: string): void {
    setSelectedIds((current) => current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]);
  }

  function updateDraft(patch: Partial<YouTubeMetadataDraft>): void {
    setDraft((current) => current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current);
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return;
    setBusy("saving");
    setError(null);
    try {
      setDraft(await window.creatorApp.saveYouTubeMetadataDraft(draft));
      setMessage("Draft saved locally. YouTube has not been changed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The metadata draft could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function generateMetadata(): Promise<void> {
    if (!activeVideo) return;
    setBusy("saving");
    setError(null);
    try {
      setDraft(await window.creatorApp.generateYouTubeMetadataDraft(activeVideo.videoId));
      setMessage("Local AI created a reviewable metadata draft.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Local AI could not create a metadata draft.");
    } finally {
      setBusy(null);
    }
  }

  async function updateYouTube(): Promise<void> {
    if (!draft) return;
    setBusy("updating");
    setError(null);
    try {
      const updated = await window.creatorApp.updateYouTubeVideoMetadata(draft.videoId, {
        title: draft.title,
        description: draft.description,
        tags: draft.tags,
        categoryId: draft.categoryId
      }, draft.baseRemoteRevision);
      setVideos((current) => current.map((video) => video.videoId === updated.videoId ? updated : video));
      setDraft({ ...draft, baseRemoteRevision: updated.remoteRevision, updatedAt: new Date().toISOString() });
      setMessage("YouTube metadata updated.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "YouTube rejected the metadata update.");
    } finally {
      setBusy(null);
    }
  }

  async function applyBulkEdit(): Promise<void> {
    const selected = selectedIds.filter((id) => videos.some((video) => video.videoId === id));
    const input = {
      videoIds: selected,
      fields: {
        ...(bulkFields.titleEnabled ? { title: bulkFields.title.trim() } : {}),
        ...(bulkFields.descriptionEnabled ? { description: bulkFields.description } : {}),
        ...(bulkFields.categoryEnabled ? { categoryId: bulkFields.categoryId.trim() } : {}),
        ...(bulkFields.tagsEnabled ? { tags: splitTags(bulkFields.tags), tagMode: bulkFields.tagMode } : {})
      },
      baseRemoteRevisions: Object.fromEntries(selected.map((id) => [id, videos.find((video) => video.videoId === id)?.remoteRevision ?? null]))
    };
    setBusy("updating");
    setBulkConfirmation(false);
    setError(null);
    try {
      const result: YouTubeBulkEditResult = await window.creatorApp.bulkUpdateYouTubeVideoMetadata(input);
      await loadCachedVideos();
      setMessage(`${result.completed.length} updated, ${result.failed.length} failed, ${result.conflicts.length} conflicted.`);
      setBulkOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The bulk YouTube update failed.");
    } finally {
      setBusy(null);
    }
  }

  async function generateThumbnails(): Promise<void> {
    if (!activeVideo) return;
    setBusy("generating");
    setError(null);
    try {
      const result = await window.creatorApp.generateYouTubeThumbnailCandidates({
        videoId: activeVideo.videoId,
        sourceClipId: activeVideo.linkedClipId,
        candidateCount: 3
      });
      setCandidates(result.candidates);
      setMessage(result.note);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Thumbnail candidates could not be generated.");
    } finally {
      setBusy(null);
    }
  }

  async function applyThumbnail(candidateId: string): Promise<void> {
    if (!activeVideo) return;
    setBusy("applying");
    setThumbnailConfirmation(null);
    setError(null);
    try {
      const updated = await window.creatorApp.applyYouTubeThumbnail(activeVideo.videoId, candidateId);
      setVideos((current) => current.map((video) => video.videoId === updated.videoId ? updated : video));
      setCandidates(await window.creatorApp.listYouTubeThumbnailCandidates(activeVideo.videoId));
      setMessage("Thumbnail applied to YouTube.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "YouTube rejected the thumbnail.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Panel className="panel youtube-video-library">
        <PanelHeader className="panel-header">
          <div>
            <div className="title-with-tip"><h2>YouTube channel library</h2><InfoTip label="YouTube channel library">Owned YouTube metadata is managed separately from local clip packages. Refresh and update actions are explicit.</InfoTip></div>
            <p className="detail-meta">{videos.length} cached videos · local drafts stay on this computer</p>
          </div>
          <div className="detail-actions"><button type="button" className="secondary-button compact-button" onClick={() => void refreshVideos()} disabled={refreshing}>{refreshing ? "Refreshing..." : "Refresh videos"}</button></div>
        </PanelHeader>
        <div className="youtube-library-toolbar">
          <label className="editor-field youtube-library-search"><span>Search videos</span><input className="editor-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, description, or tag" /></label>
          <label className="editor-field"><span>Date</span><select className="editor-input" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Any date</option><option value="30d">Last 30 days</option><option value="year">This year</option></select></label>
          <label className="editor-field"><span>Format</span><select className="editor-input" value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as typeof formatFilter)}><option value="all">All formats</option><option value="short">Shorts under 60 seconds</option><option value="long">Over 60 seconds</option><option value="unknown">Duration unavailable</option></select></label>
          {selectedIds.length ? <button type="button" className="primary-button compact-button" onClick={() => setBulkOpen(true)}>Edit {selectedIds.length} selected</button> : null}
        </div>
        {error ? <div className="info-banner warning-banner"><strong>Channel library action failed</strong><p className="muted">{error}</p></div> : null}
        {message ? <div className="info-banner success-banner"><strong>Channel library updated</strong><p className="muted">{message}</p></div> : null}
        {loading ? <p className="muted">Loading local channel cache...</p> : filteredVideos.length ? <div className="cw-scroll-area youtube-video-library-grid">{filteredVideos.map((video) => <article className={`cw-card youtube-video-library-card${activeVideoId === video.videoId ? " selected" : ""}`} key={video.videoId}>
          <label className="youtube-video-select"><input type="checkbox" checked={selectedIds.includes(video.videoId)} onChange={() => toggleSelected(video.videoId)} aria-label={`Select ${video.title}`} /></label>
          <button type="button" className="youtube-video-card-button" onClick={() => openVideo(video)} aria-pressed={activeVideoId === video.videoId}>
            <div className="youtube-video-card-thumb">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : <span>No thumbnail</span>}</div>
            <div><div className="performance-row-header"><strong>{video.title}</strong><span className="status-pill">{video.privacyStatus}</span></div><p className="detail-meta">{formatDate(video.publishedAt)} · {video.tags.length} tags</p><p className="detail-meta">{video.linkedClipId ? "Linked local clip" : "Remote-only video"}</p></div>
          </button>
        </article>)}</div> : <div className="empty-state compact"><h3>{videos.length ? "No matching videos" : "Refresh your owned videos"}</h3><p>{videos.length ? "Try a different search." : "The app has not contacted YouTube for this library yet."}</p></div>}
      </Panel>

      {activeVideo && draft ? <Panel className="panel youtube-video-editor">
        <div className="panel-header"><div><p className="eyebrow">Selected YouTube video</p><h2>{activeVideo.title}</h2><p className="detail-meta">Remote video ID: {activeVideo.videoId} · {activeVideo.linkedClipId ? "Linked to local Edit" : "No local source linked"}</p></div><button type="button" className="icon-button" onClick={() => setActiveVideoId(null)} aria-label="Close video editor">×</button></div>
        <div className="youtube-editor-grid"><div className="youtube-editor-fields">
          <label className="editor-field"><span>Title</span><input className="editor-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
          <label className="editor-field"><span>Description</span><textarea className="editor-input youtube-description-input" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} /></label>
          <label className="editor-field"><span>Tags</span><input className="editor-input" value={draft.tags.join(", ")} onChange={(event) => updateDraft({ tags: splitTags(event.target.value) })} placeholder="gaming, funny, halo" /></label>
          <label className="editor-field"><span>Category ID</span><input className="editor-input" value={draft.categoryId} onChange={(event) => updateDraft({ categoryId: event.target.value })} /></label>
          <div className="detail-actions"><button type="button" className="secondary-button compact-button" onClick={() => void generateMetadata()} disabled={busy !== null}>{busy === "saving" ? "Generating..." : "Generate with local AI"}</button><button type="button" className="secondary-button compact-button" onClick={() => void saveDraft()} disabled={busy !== null}>Save draft locally</button><button type="button" className="primary-button compact-button" onClick={() => void updateYouTube()} disabled={busy !== null}>{busy === "updating" ? "Updating..." : "Update YouTube"}</button>{activeVideo.linkedClipId && onOpenClip ? <button type="button" className="secondary-button compact-button" onClick={() => onOpenClip(activeVideo.linkedClipId as string)}>Open in Edit</button> : null}</div>
        </div><ThumbnailStudio video={activeVideo} candidates={candidates} busy={busy} onGenerate={() => void generateThumbnails()} onApply={(candidateId) => setThumbnailConfirmation(candidateId)} /></div>
      </Panel> : null}

      {bulkOpen ? <BulkMetadataPanel fields={bulkFields} selectedVideos={videos.filter((video) => selectedIds.includes(video.videoId))} onChange={setBulkFields} onCancel={() => setBulkOpen(false)} onApply={() => setBulkConfirmation(true)} /> : null}
      {bulkConfirmation ? <ConfirmActionDialog title="Update selected YouTube videos?" body={`This will update ${selectedIds.length} owned videos. Only the fields shown in the preview will change.`} confirmLabel="Update YouTube" acknowledgementLabel="I reviewed the bulk changes" onCancel={() => setBulkConfirmation(false)} onConfirm={() => void applyBulkEdit()} /> : null}
      {thumbnailConfirmation ? <ConfirmActionDialog title="Apply this thumbnail to YouTube?" body="The selected local image will replace the current YouTube thumbnail for this video." confirmLabel="Apply thumbnail" onCancel={() => setThumbnailConfirmation(null)} onConfirm={() => void applyThumbnail(thumbnailConfirmation)} /> : null}
    </>
  );
}

function ThumbnailStudio({ video, candidates, busy, onGenerate, onApply }: { video: YouTubeManagedVideoRecord; candidates: ThumbnailCandidateRecord[]; busy: string | null; onGenerate: () => void; onApply: (candidateId: string) => void }): JSX.Element {
  return (
    <Card className="youtube-thumbnail-studio">
      <PanelHeader className="panel-header">
        <div>
          <div className="title-with-tip"><h3>Thumbnail Studio</h3><InfoTip label="Thumbnail Studio">The assigned thumbnail profile reviews supplied frames and guides local candidate composition. Nothing is uploaded automatically.</InfoTip></div>
          <p className="detail-meta">{video.linkedClipId ? "Source frames available from the linked local clip." : "Remote-only: source frames are unavailable; the current thumbnail is used when available."}</p>
        </div>
        <button type="button" className="secondary-button compact-button" onClick={onGenerate} disabled={busy !== null}>{busy === "generating" ? "Generating..." : "Generate candidates"}</button>
      </PanelHeader>
      {video.thumbnailUrl ? <img className="youtube-current-thumbnail" src={video.thumbnailUrl} alt="Current YouTube thumbnail" /> : null}
      {candidates.length ? (
        <div className="cw-scroll-area youtube-thumbnail-candidates">
          {candidates.map((candidate) => (
            <Card className={`youtube-thumbnail-candidate${candidate.status === "applied" ? " applied" : ""}`} key={candidate.id}>
              <img src={window.creatorApp.getLocalMediaUrl(candidate.localPath)} alt="Generated thumbnail candidate" />
              <p className="detail-meta">{candidate.brief}</p>
              <p className="detail-meta">Profile: {candidate.provenance.profileName ?? "Unknown"} · Model: {candidate.provenance.model ?? "Fallback"}</p>
              <div className="detail-actions">
                <StatusBadge className="status-pill" tone={candidate.status === "applied" ? "success" : "info"}>{candidate.status}</StatusBadge>
                {candidate.status !== "applied" ? <button type="button" className="primary-button compact-button" onClick={() => onApply(candidate.id)}>Apply to YouTube</button> : null}
              </div>
            </Card>
          ))}
        </div>
      ) : <p className="muted">Generate a small set of local candidates to review here.</p>}
    </Card>
  );
}

function BulkMetadataPanel({ fields, selectedVideos, onChange, onCancel, onApply }: { fields: BulkFields; selectedVideos: YouTubeManagedVideoRecord[]; onChange: (fields: BulkFields) => void; onCancel: () => void; onApply: () => void }): JSX.Element {
  return <section className="panel youtube-bulk-editor"><div className="panel-header"><div><h2>Bulk metadata edit</h2><p className="detail-meta">Choose each field deliberately. Unchecked fields remain untouched across all {selectedVideos.length} videos.</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close bulk editor">×</button></div><div className="youtube-bulk-preview">{selectedVideos.map((video) => <div key={video.videoId}><strong>{video.title}</strong><span>{video.tags.length} current tags · {video.privacyStatus}</span></div>)}</div><div className="youtube-editor-grid"><div className="youtube-editor-fields"><label className="editor-field"><span><input type="checkbox" checked={fields.titleEnabled} onChange={(event) => onChange({ ...fields, titleEnabled: event.target.checked })} /> Shared title replacement</span><input className="editor-input" disabled={!fields.titleEnabled} value={fields.title} onChange={(event) => onChange({ ...fields, title: event.target.value })} placeholder="Enter a shared title" /></label><label className="editor-field"><span><input type="checkbox" checked={fields.descriptionEnabled} onChange={(event) => onChange({ ...fields, descriptionEnabled: event.target.checked })} /> Shared description</span><textarea className="editor-input youtube-description-input" disabled={!fields.descriptionEnabled} value={fields.description} onChange={(event) => onChange({ ...fields, description: event.target.value })} placeholder="Enter a shared description" /></label><label className="editor-field"><span><input type="checkbox" checked={fields.tagsEnabled} onChange={(event) => onChange({ ...fields, tagsEnabled: event.target.checked })} /> Tags</span><input className="editor-input" disabled={!fields.tagsEnabled} value={fields.tags} onChange={(event) => onChange({ ...fields, tags: event.target.value })} placeholder="tag-one, tag-two" /></label><label className="editor-field"><span>Tag operation</span><select className="editor-input" disabled={!fields.tagsEnabled} value={fields.tagMode} onChange={(event) => onChange({ ...fields, tagMode: event.target.value as BulkFields["tagMode"] })}><option value="replace">Replace tags</option><option value="add">Add tags</option><option value="remove">Remove tags</option></select></label><label className="editor-field"><span><input type="checkbox" checked={fields.categoryEnabled} onChange={(event) => onChange({ ...fields, categoryEnabled: event.target.checked })} /> Category ID</span><input className="editor-input" disabled={!fields.categoryEnabled} value={fields.categoryId} onChange={(event) => onChange({ ...fields, categoryId: event.target.value })} placeholder="Enter a category ID" /></label><div className="detail-actions"><button type="button" className="secondary-button compact-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button compact-button" onClick={onApply} disabled={!fields.titleEnabled && !fields.descriptionEnabled && !fields.tagsEnabled && !fields.categoryEnabled}>Review and update</button></div></div></div></section>;
}

function splitTags(value: string): string[] { return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))]; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
function matchesPublishedDate(value: string, filter: "30d" | "year"): boolean {
  const publishedAt = new Date(value).getTime();
  if (!Number.isFinite(publishedAt)) return false;
  const now = new Date();
  if (filter === "year") return new Date(publishedAt).getFullYear() === now.getFullYear();
  return publishedAt >= Date.now() - 30 * 24 * 60 * 60 * 1000;
}
function matchesVideoFormat(durationSeconds: number | null, filter: "short" | "long" | "unknown"): boolean {
  if (durationSeconds === null) return filter === "unknown";
  if (filter === "short") return durationSeconds <= 60;
  if (filter === "long") return durationSeconds > 60;
  return false;
}
