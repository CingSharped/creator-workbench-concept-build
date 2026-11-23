import { useEffect, useState } from "react";
import type {
  PerformanceCoachAction,
  PerformanceCoachFocus,
  PerformanceCoachResult,
  PerformanceDashboardFilters,
  PerformanceDashboardResult,
  PerformanceMetric,
  PerformanceVideoDetail,
  YouTubeConnectionStatus
} from "../shared/contracts";
import InfoTip from "./InfoTip";
import YouTubeVideoLibrary from "./YouTubeVideoLibrary";
import { ButtonLink, Card, IconButton, Panel, PanelHeader, SegmentedTabs, StatusBadge } from "./WorkbenchPrimitives";

interface PerformanceDashboardViewProps {
  dashboard: PerformanceDashboardResult | null;
  filters: PerformanceDashboardFilters;
  loading: boolean;
  refreshing: boolean;
  importingHistory: boolean;
  message: string | null;
  performanceCoachBusy: boolean;
  performanceCoachResult: PerformanceCoachResult | null;
  activePerformanceCoachProfileLabel: string | null;
  selectedVideoDetail: PerformanceVideoDetail | null;
  selectedVideoDetailLoading: boolean;
  selectedVideoDetailError: string | null;
  youtubeConnection: YouTubeConnectionStatus | null;
  youtubeRefreshablePostCount: number;
  onFilterChange: (patch: Partial<PerformanceDashboardFilters>) => void;
  onRefresh: (textOverrides?: Partial<Pick<PerformanceDashboardFilters, "gameTitle" | "seriesKey">>) => void;
  onImportHistory: (publishedAfter: string) => void;
  onGeneratePerformanceCoach: (focus?: PerformanceCoachFocus, videoId?: string) => void;
  onCoachAction: (action: PerformanceCoachAction) => void;
  onOpenPerformanceVideo: (videoId: string) => void;
  onClosePerformanceVideoDetail: () => void;
  onOpenSettings: () => void;
  onOpenWorkspace: () => void;
}

export default function PerformanceDashboardView(props: PerformanceDashboardViewProps): JSX.Element {
  const {
    dashboard, filters, loading, refreshing, importingHistory, message,
    performanceCoachBusy,
    performanceCoachResult, activePerformanceCoachProfileLabel, selectedVideoDetail, selectedVideoDetailLoading,
    selectedVideoDetailError, youtubeConnection, youtubeRefreshablePostCount, onFilterChange, onRefresh,
    onImportHistory, onGeneratePerformanceCoach, onCoachAction,
    onOpenPerformanceVideo, onClosePerformanceVideoDetail, onOpenSettings,
    onOpenWorkspace
  } = props;

  const [draftGameTitle, setDraftGameTitle] = useState(filters.gameTitle);
  const [draftSeriesKey, setDraftSeriesKey] = useState(filters.seriesKey);
  const [draftHistoryImportStartDate, setDraftHistoryImportStartDate] = useState(dashboard?.historicalImportStartDate ?? "2025-01-01");
  const [laneDimension, setLaneDimension] = useState<"game" | "series" | "format" | "keyword">("game");
  const [channelTab, setChannelTab] = useState<"overview" | "library">("overview");
  const ownedSnapshots = dashboard?.ownedSnapshots ?? [];
  const overview = dashboard?.overview ?? null;
  const lanes = (dashboard?.laneBreakdowns ?? []).filter((lane) => lane.dimension === laneDimension);
  const clientIdConfigured = youtubeConnection?.clientIdConfigured === true;
  const youtubeConnected = youtubeConnection?.connected === true;
  const analyticsScopeGranted = youtubeConnection?.analyticsScopeGranted === true;
  const readinessItems = buildReadinessItems({ clientIdConfigured, youtubeConnected, analyticsScopeGranted, youtubeRefreshablePostCount });
  const readinessBlockerCount = readinessItems.filter((item) => !item.complete).length;

  useEffect(() => setDraftGameTitle(filters.gameTitle), [filters.gameTitle]);
  useEffect(() => setDraftSeriesKey(filters.seriesKey), [filters.seriesKey]);
  useEffect(() => setDraftHistoryImportStartDate(dashboard?.historicalImportStartDate ?? "2025-01-01"), [dashboard?.historicalImportStartDate]);

  function commitTextFilter(key: "gameTitle" | "seriesKey", value: string): void {
    onFilterChange({ [key]: value.trim() });
  }

  return (
    <>
      <Panel className="panel performance-filter-panel">
        <div className="panel-header"><div><div className="title-with-tip"><h2>Performance cockpit</h2><InfoTip label="Performance cockpit">YouTube account analysis using your own channel history, Analytics, publishing data, and local workspace evidence. AI output stays review-first.</InfoTip></div><p className="detail-meta">Owned channel evidence · {filters.range} window</p></div><div className="detail-actions"><button type="button" className="secondary-button compact-button" onClick={onOpenWorkspace}>Open Edit</button><button type="button" className="primary-button compact-button" onClick={() => onRefresh({ gameTitle: draftGameTitle, seriesKey: draftSeriesKey })} disabled={refreshing}>{refreshing ? "Refreshing..." : "Refresh Data"}</button></div></div>
        {!dashboard?.youtubeConnected ? <div className="info-banner"><strong>Connect YouTube to unlock channel evidence</strong><p className="muted">Cached workspace data can still appear, but channel totals, Analytics breakdowns, and owned video detail need a connected account.</p></div> : null}
        {dashboard?.youtubeConnected && !dashboard.analyticsScopeGranted ? <div className="info-banner"><strong>Reconnect YouTube for Analytics access</strong><p className="muted">The channel is connected, but Google has not granted the read-only Analytics scope required for personal audience and retention data.</p></div> : null}
        {message ? <div className="info-banner"><strong>Channel history updated</strong><p className="muted">{message}</p></div> : null}
        <div className="performance-filter-grid">
          <label className="editor-field"><span>Date range</span><select className="editor-input" value={filters.range} onChange={(event) => onFilterChange({ range: event.target.value as PerformanceDashboardFilters["range"] })}><option value="7d">Last 7 days</option><option value="28d">Last 28 days</option><option value="90d">Last 90 days</option><option value="365d">Last 365 days</option><option value="since_2025">Since Jan 2025</option></select></label>
          <label className="editor-field"><span>Format</span><select className="editor-input" value={filters.format} onChange={(event) => onFilterChange({ format: event.target.value as PerformanceDashboardFilters["format"] })}><option value="all">All</option><option value="shorts">Shorts</option><option value="long_form">Long-form</option></select></label>
          <label className="editor-field"><span>Headline metric</span><select className="editor-input" value={filters.metric} onChange={(event) => onFilterChange({ metric: event.target.value as PerformanceMetric })}><option value="engaged_views">Engaged views</option><option value="views">Views</option><option value="average_view_percentage">Avg viewed</option><option value="likes">Likes</option><option value="comments">Comments</option></select></label>
          <label className="editor-field"><span>Game title</span><input list="performance-game-titles" className="editor-input" value={draftGameTitle} onChange={(event) => setDraftGameTitle(event.target.value)} onBlur={() => commitTextFilter("gameTitle", draftGameTitle)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitTextFilter("gameTitle", draftGameTitle); } }} placeholder="All games" /><datalist id="performance-game-titles">{(dashboard?.availableGameTitles ?? []).map((value) => <option key={value} value={value} />)}</datalist></label>
          <label className="editor-field"><span>Series</span><input list="performance-series-keys" className="editor-input" value={draftSeriesKey} onChange={(event) => setDraftSeriesKey(event.target.value)} onBlur={() => commitTextFilter("seriesKey", draftSeriesKey)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitTextFilter("seriesKey", draftSeriesKey); } }} placeholder="All series" /><datalist id="performance-series-keys">{(dashboard?.availableSeriesKeys ?? []).map((value) => <option key={value} value={value} />)}</datalist></label>
        </div>
      </Panel>

      {readinessBlockerCount > 0 ? <section className="panel"><div className="panel-header"><div><div className="title-with-tip"><h2>Live data readiness</h2><InfoTip label="Live data readiness">Setup checks for connected YouTube data and local workspace evidence.</InfoTip></div><p className="detail-meta">The cockpit still works with cached data while these are incomplete.</p></div><span className="panel-badge">{readinessBlockerCount} blocker{readinessBlockerCount === 1 ? "" : "s"}</span></div><div className="performance-readiness-grid">{readinessItems.map((item) => <article key={item.id} className={`performance-readiness-card${item.complete ? " complete" : ""}`}><div className="performance-row-header"><strong>{item.title}</strong><span className={`status-pill ${item.tone}`}>{item.statusLabel}</span></div><p className="muted">{item.summary}</p>{item.action?.kind === "settings" ? <button type="button" className="secondary-button compact-button" onClick={onOpenSettings}>{item.action.label}</button> : null}{item.action?.kind === "workspace" ? <button type="button" className="secondary-button compact-button" onClick={onOpenWorkspace}>{item.action.label}</button> : null}</article>)}</div></section> : null}

      <Panel className="panel performance-channel-header">
        {dashboard?.channelProfile ? <><div className="performance-channel-identity">{dashboard.channelProfile.thumbnailUrl ? <img className="performance-channel-avatar" src={dashboard.channelProfile.thumbnailUrl} alt="" /> : <div className="performance-channel-avatar performance-channel-avatar-placeholder">{dashboard.channelProfile.title.slice(0, 1).toUpperCase()}</div>}<div><p className="eyebrow">Connected channel</p><h2>{dashboard.channelProfile.title}</h2><p className="detail-meta">{dashboard.channelProfile.customUrl ?? dashboard.channelProfile.channelUrl}</p><p className="detail-meta">Last successful refresh: {formatTimestamp(dashboard.channelProfile.fetchedAt)} · <span className="status-pill readiness-ready">Connected</span></p></div></div><div className="performance-channel-totals"><ChannelTotal label="Subscribers" value={dashboard.channelProfile.subscriberCount} /><ChannelTotal label="Total views" value={dashboard.channelProfile.viewCount} /><ChannelTotal label="Videos" value={dashboard.channelProfile.videoCount} /></div><ButtonLink variant="secondary" compact href={dashboard.channelProfile.channelUrl} target="_blank" rel="noreferrer">Open channel on YouTube</ButtonLink></> : <div><p className="eyebrow">Channel identity</p><h2>{loading ? "Loading channel…" : "No connected channel profile"}</h2><p className="muted">{youtubeConnected ? "Refresh the cockpit to load the connected channel profile." : "Connect YouTube in Settings to scope this cockpit to one channel."}</p></div>}
      </Panel>

      <Panel className="panel performance-channel-tabs" aria-label="YouTube channel workspace">
        <SegmentedTabs className="performance-segmented-control">
          <button type="button" className={channelTab === "overview" ? "active" : ""} onClick={() => setChannelTab("overview")}>Overview</button>
          <button type="button" className={channelTab === "library" ? "active" : ""} onClick={() => setChannelTab("library")}>Channel library</button>
        </SegmentedTabs>
        <p className="detail-meta">Manage owned YouTube metadata separately from local clip packages. Updates are always explicit.</p>
      </Panel>

      {channelTab === "library" ? <YouTubeVideoLibrary onOpenClip={(clipId) => onCoachAction({ kind: "open_clip", label: "Open in Edit", clipId, videoId: null })} /> : <>

      <section className="panel"><div className="panel-header"><div><div className="title-with-tip"><h2>Channel overview</h2><InfoTip label="Channel overview">Selected-period totals are compared with the previous equivalent period when enough local evidence exists. Missing comparisons stay explicitly unavailable.</InfoTip></div><p className="detail-meta">{overview ? `${overview.startDate} to ${overview.endDate} · ${overview.sampleSize} comparable videos` : "No comparable period loaded yet"}</p></div><span className="panel-badge">{dashboard?.freshness?.staleAreas.length ? `Stale: ${dashboard.freshness.staleAreas.join(", ")}` : "Freshness checked"}</span></div>{overview ? <div className="performance-overview-grid">{overviewMetricCards(overview).map((card) => <article key={card.id} className="performance-stat-card"><span className="performance-stat-label">{card.label}</span><strong>{card.value}</strong><span className={`performance-change ${card.change !== null && card.change >= 0 ? "positive" : card.change !== null ? "negative" : "neutral"}`}>{formatChange(card.change)}</span><p className="muted">{card.note}</p></article>)}</div> : <div className="empty-state compact"><h3>{loading ? "Loading owned evidence…" : "Not enough data"}</h3><p>{getOwnedEmptyState({ clientIdConfigured, youtubeConnected, analyticsScopeGranted, youtubeRefreshablePostCount }).summary}</p></div>}</section>

      <section className="panel"><div className="panel-header"><div><h2>Publishing timeline</h2><p className="detail-meta">Owned channel activity in the selected period</p></div><span className="panel-badge">{dashboard?.timeline?.length ?? 0} days</span></div>{dashboard?.timeline?.length ? <div className="performance-timeline">{dashboard.timeline.map((point) => { const value = filters.metric === "views" ? point.views : filters.metric === "engaged_views" ? point.engagedViews : point.views; const max = Math.max(...dashboard.timeline!.map((item) => filters.metric === "views" ? item.views ?? 0 : filters.metric === "engaged_views" ? item.engagedViews ?? 0 : item.views ?? 0), 1); return <div className="performance-timeline-point" key={point.date} title={`${point.date}: ${formatNumber(value)}`}><div className="performance-timeline-bar" style={{ height: `${Math.max(8, ((value ?? 0) / max) * 100)}%` }} /><span>{formatShortDate(point.date)}</span></div>; })}</div> : <p className="muted">Timeline data will appear after a connected Analytics refresh.</p>}</section>

      <section className="panel"><div className="panel-header"><div><div className="title-with-tip"><h2>What is working</h2><InfoTip label="What is working">Personal winners are ranked with the existing age-normalized score, while raw YouTube metrics remain visible for context.</InfoTip></div><p className="detail-meta">Click a card to inspect detail and open the next action</p></div><span className="panel-badge">{ownedSnapshots.length} videos</span></div>{ownedSnapshots.length ? <div className="performance-video-grid">{ownedSnapshots.slice(0, 6).map((snapshot) => <PerformanceVideoCard key={snapshot.id} snapshot={snapshot} filters={filters} channelAverage={averagePerformanceMetric(ownedSnapshots, filters.metric)} onOpen={() => { if (snapshot.videoId) onOpenPerformanceVideo(snapshot.videoId); }} onOpenClip={(clipId) => onCoachAction({ kind: "open_clip", label: "Open in Edit", clipId, videoId: snapshot.videoId || null })} />)}</div> : <div className="empty-state compact"><h3>{getOwnedEmptyState({ clientIdConfigured, youtubeConnected, analyticsScopeGranted, youtubeRefreshablePostCount }).title}</h3><p>{getOwnedEmptyState({ clientIdConfigured, youtubeConnected, analyticsScopeGranted, youtubeRefreshablePostCount }).summary}</p></div>}</section>

      <section className="panel"><div className="panel-header"><div><h2>Content lanes</h2><p className="detail-meta">Games, series, formats, and recurring keyword families</p></div><span className="panel-badge">{lanes.length} lanes</span></div><div className="performance-segmented-control">{(["game", "series", "format", "keyword"] as const).map((dimension) => <button type="button" key={dimension} className={laneDimension === dimension ? "active" : ""} onClick={() => setLaneDimension(dimension)}>{dimension === "game" ? "Games" : dimension === "series" ? "Series" : dimension === "format" ? "Formats" : "Keywords"}</button>)}</div>{lanes.length ? <div className="performance-lane-list">{lanes.slice(0, 12).map((lane) => <article className="performance-lane-row" key={lane.id}><div><strong>{lane.label}</strong><p className="detail-meta">{lane.sampleSize} video{lane.sampleSize === 1 ? "" : "s"} · {lane.classificationSource === "inferred" ? "Inferred label" : lane.classificationSource === "metadata" ? "From metadata" : "Source not recorded"}</p></div><span>{formatNumber(lane.averageViews)} avg views</span><span>{lane.averageViewPercentage === null ? "Avg viewed n/a" : `${lane.averageViewPercentage.toFixed(1)}% viewed`}</span><span className={`lane-direction ${lane.recentDirection}`}>{formatDirection(lane.recentDirection)}</span>{lane.strongestVideoId ? <button type="button" className="secondary-button compact-button" onClick={() => onOpenPerformanceVideo(lane.strongestVideoId!)}>View winner</button> : null}</article>)}</div> : <p className="muted">Add explicit game or series metadata, or import more history, to compare content lanes.</p>}</section>

      <section className="panel"><div className="panel-header"><div><h2>Needs attention</h2><p className="detail-meta">Diagnostic signals to investigate, not automatic explanations</p></div></div><div className="performance-diagnostic-grid"><DiagnosticCard title="Weakest comparable videos" summary={ownedSnapshots.length ? `Review ${ownedSnapshots.slice(-3).map((snapshot) => `“${snapshot.title}”`).join(", ")}. Compare opening, packaging, and format against a winner.` : "Not enough data"} /><DiagnosticCard title="Declining lanes" summary={(dashboard?.laneBreakdowns ?? []).filter((lane) => lane.recentDirection === "down").slice(0, 2).map((lane) => `${lane.label} (${lane.sampleSize} videos)`).join(", ") || "No lane has enough recent movement to call a decline."} /><DiagnosticCard title="Retention and engagement" summary={ownedSnapshots.some((snapshot) => snapshot.averageViewPercentage !== null) ? "Open a video card to inspect retention on demand and compare average viewed against the channel baseline." : "Retention is unavailable until Analytics access and video-level data are loaded."} /><DiagnosticCard title="Publishing gaps" summary={ownedSnapshots.length > 1 ? "Use the publishing timeline to spot quiet stretches before treating cadence as a performance cause." : "Publish more comparable videos before diagnosing cadence."} /></div></section>

      <section className="panel"><div className="panel-header"><div><h2>Audience and discovery</h2><p className="detail-meta">Cached separately from owned video metrics because YouTube Analytics dimensions have compatibility constraints.</p></div><span className="panel-badge">{dashboard?.trafficSources?.length ? "Loaded" : "Not loaded"}</span></div>{dashboard?.trafficSources?.length || dashboard?.devices?.length || dashboard?.subscriberStatus?.length ? <div className="performance-breakdown-grid"><BreakdownList title="Traffic source" entries={(dashboard.trafficSources ?? []).map((entry) => ({ label: entry.sourceType, views: entry.views, shareOfViews: entry.shareOfViews }))} /><BreakdownList title="Device" entries={dashboard.devices ?? []} /><BreakdownList title="Subscriber status" entries={dashboard.subscriberStatus ?? []} /></div> : <p className="muted">Audience breakdowns appear after a successful Analytics refresh with the read-only scope.</p>}</section>

      <section className="panel performance-coach-panel"><div className="panel-header"><div><div className="title-with-tip"><h2>AI Performance Coach</h2><InfoTip label="AI Performance Coach">Local-only, evidence-grounded coaching. It separates observation from interpretation, respects sample size, and never saves metadata or thumbnails automatically.</InfoTip></div><p className="detail-meta">{activePerformanceCoachProfileLabel ?? "No active performance coach profile"} · review-first</p></div><button type="button" className="primary-button compact-button" onClick={() => onGeneratePerformanceCoach("overview")} disabled={!dashboard || performanceCoachBusy}>{performanceCoachBusy ? "Analysing..." : "Analyse my channel"}</button></div>{performanceCoachResult ? <><div className={`info-banner ${performanceCoachResult.executionMode === "ai" ? "success-banner" : "warning-banner"}`}><strong>{performanceCoachResult.executionMode === "ai" ? "Local AI analysis complete" : "Fallback analysis used"}</strong><p className="muted">{performanceCoachResult.summary}</p>{performanceCoachResult.issueSummary ? <p className="detail-meta">Issue: {performanceCoachResult.issueSummary}</p> : null}</div>{performanceCoachResult.limitations.length ? <p className="detail-meta">Limits: {performanceCoachResult.limitations.join(" · ")}</p> : null}<div className="performance-coach-insights">{performanceCoachResult.insights.map((insight) => <article className={`performance-coach-insight ${insight.type}`} key={insight.id}><div className="performance-row-header"><span className="status-pill">{insight.type}</span><span className="detail-meta">{insight.confidence} confidence</span></div><h3>{insight.title}</h3><p className="muted">{insight.explanation}</p>{insight.evidence.length ? <p className="performance-evidence">Evidence: {insight.evidence.map((item) => item.label).join(" · ")}</p> : null}{insight.action ? <CoachActionButton action={insight.action} onAction={onCoachAction} /> : null}</article>)}</div></> : <p className="muted">Ask the coach for one grounded summary and three to five evidence-linked insights. If local AI is unavailable, the clearly labelled deterministic fallback remains review-only.</p>}</section>

      <section className="performance-history-card"><div><div className="title-with-tip"><strong>Historical channel import</strong><InfoTip label="Historical channel import">Import your own uploads into the local cockpit. Legacy records without channel IDs are preserved and treated as unscoped until they are reimported.</InfoTip></div><p className="detail-meta">Local cache · manual import · cap {dashboard?.historicalImportVideoLimit ?? 0} videos</p></div><div className="performance-history-controls"><label className="editor-field"><span>Import from</span><input className="editor-input" type="date" value={draftHistoryImportStartDate} onChange={(event) => setDraftHistoryImportStartDate(event.target.value)} /></label><button type="button" className="secondary-button compact-button" onClick={() => onImportHistory(draftHistoryImportStartDate)} disabled={!dashboard?.youtubeConnected || !dashboard.analyticsScopeGranted || importingHistory}>{importingHistory ? "Importing..." : "Import Channel History"}</button></div><p className="detail-meta">Imported: {dashboard?.historicalImportedVideoCount ?? 0} · Last import: {formatTimestamp(dashboard?.historicalImportLastFetchedAt ?? null)}</p></section>

      </>}

      {selectedVideoDetail || selectedVideoDetailLoading || selectedVideoDetailError ? <VideoDetailDrawer detail={selectedVideoDetail} loading={selectedVideoDetailLoading} error={selectedVideoDetailError} onClose={onClosePerformanceVideoDetail} onGenerateCoach={(videoId) => onGeneratePerformanceCoach("video", videoId)} onCoachAction={onCoachAction} /> : null}
    </>
  );
}

function ChannelTotal({ label, value }: { label: string; value: number | null }): JSX.Element { return <div><span className="performance-stat-label">{label}</span><strong>{formatNumber(value)}</strong></div>; }

function PerformanceVideoCard({ snapshot, filters, channelAverage, onOpen, onOpenClip }: { snapshot: PerformanceDashboardResult["ownedSnapshots"][number]; filters: PerformanceDashboardFilters; channelAverage: number | null; onOpen: () => void; onOpenClip: (clipId: string) => void }): JSX.Element {
  return (
    <Card className="performance-video-card">
      <button type="button" className="performance-video-open" onClick={onOpen} disabled={!snapshot.videoId}>
        <div className="performance-video-thumb">
          {snapshot.thumbnailUrl ? <img src={snapshot.thumbnailUrl} alt="" /> : <span>{snapshot.format === "shorts" ? "SHORT" : "VIDEO"}</span>}
        </div>
        <div className="performance-video-card-body">
          <PanelHeader className="performance-row-header">
            <strong>{snapshot.title}</strong>
            <StatusBadge className="status-pill" tone={snapshot.source === "channel_import" ? "info" : "muted"}>
              {snapshot.source === "channel_import" ? "Imported" : snapshot.format}
            </StatusBadge>
          </PanelHeader>
          <p className="detail-meta">{snapshot.gameTitle || "No game"} · {snapshot.seriesKey || "No series"}{snapshot.classificationSource === "inferred" ? " · inferred" : ""}</p>
          <div className="performance-mini-grid">
            <span>{formatMetricLabel(filters.metric, snapshot)}</span>
            <span>{formatMetricComparison(filters.metric, getMetricValue(snapshot, filters.metric), channelAverage)}</span>
            <span>Score {formatPerformanceScore(snapshot.performanceScore)}</span>
          </div>
        </div>
      </button>
      {snapshot.clipId ? <button type="button" className="secondary-button compact-button" onClick={() => onOpenClip(snapshot.clipId!)}>Open in Edit</button> : null}
      {snapshot.source === "channel_import" && snapshot.publishedUrl ? <ButtonLink variant="secondary" compact href={snapshot.publishedUrl} target="_blank" rel="noreferrer">Open on YouTube</ButtonLink> : null}
    </Card>
  );
}

function DiagnosticCard({ title, summary }: { title: string; summary: string }): JSX.Element {
  return (
    <Card className="performance-diagnostic-card">
      <span className="eyebrow">{title}</span>
      <p>{summary}</p>
    </Card>
  );
}

function BreakdownList({ title, entries }: { title: string; entries: Array<{ label: string; views: number | null; shareOfViews: number | null }> }): JSX.Element {
  return (
    <Card className="performance-list-card">
      <h3>{title}</h3>
      {entries.length ? (
        <div className="performance-breakdown-list">
          {entries.slice(0, 8).map((entry) => (
            <div key={entry.label} className="performance-breakdown-entry">
              <PanelHeader className="performance-row-header">
                <span>{entry.label}</span>
                <strong>{formatNumber(entry.views)}</strong>
              </PanelHeader>
              <div className="performance-breakdown-track">
                <span style={{ width: `${Math.min(100, Math.max(0, (entry.shareOfViews ?? 0) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : <p className="muted">Not available</p>}
    </Card>
  );
}

function CoachActionButton({ action, onAction }: { action: PerformanceCoachAction; onAction: (action: PerformanceCoachAction) => void }): JSX.Element { return action.kind === "open_video" && action.videoId ? <ButtonLink variant="secondary" compact href={`https://www.youtube.com/watch?v=${action.videoId}`} target="_blank" rel="noreferrer">{action.label}</ButtonLink> : <button type="button" className="secondary-button compact-button" onClick={() => onAction(action)} disabled={!action.clipId}>{action.label}</button>; }

function VideoDetailDrawer({ detail, loading, error, onClose, onGenerateCoach, onCoachAction }: { detail: PerformanceVideoDetail | null; loading: boolean; error: string | null; onClose: () => void; onGenerateCoach: (videoId: string) => void; onCoachAction: (action: PerformanceCoachAction) => void }): JSX.Element {
  const snapshot = detail?.snapshot;
  return (
    <aside className="performance-detail-drawer">
      <PanelHeader className="panel-header">
        <div>
          <p className="eyebrow">Selected video</p>
          <h2>{snapshot?.title ?? (loading ? "Loading video detail…" : "Video detail")}</h2>
        </div>
        <IconButton type="button" className="icon-button" onClick={onClose} aria-label="Close video detail" title="Close video detail">×</IconButton>
      </PanelHeader>
      {error ? <div className="info-banner warning-banner"><strong>Detail unavailable</strong><p className="muted">{error}</p></div> : null}
      {loading ? <p className="muted">Loading Analytics breakdowns and retention on demand…</p> : null}
      {snapshot ? (
        <>
          <div className="performance-detail-summary">
            <span>Views {formatNumber(snapshot.views)}</span>
            <span>Engaged {formatNumber(snapshot.engagedViews)}</span>
            <span>Avg viewed {snapshot.averageViewPercentage === null ? "n/a" : `${snapshot.averageViewPercentage.toFixed(1)}%`}</span>
            <span>Likes {formatNumber(snapshot.likes)}</span>
            <span>Comments {formatNumber(snapshot.comments)}</span>
          </div>
          <p className="detail-meta">Channel baseline: {detail?.channelBaseline.averageViewPercentage === null ? "Avg viewed not available" : `${detail?.channelBaseline.averageViewPercentage.toFixed(1)}% average viewed`} · {snapshot.classificationSource === "inferred" ? "classification inferred" : "classification from workspace metadata"}</p>
          <p className="detail-meta">Tags: {snapshot.tags.length ? snapshot.tags.join(", ") : "No tags recorded"}</p>
          <div className="detail-actions">
            {snapshot.clipId ? <button type="button" className="primary-button compact-button" onClick={() => onCoachAction({ kind: "open_clip", label: "Open in Edit", clipId: snapshot.clipId, videoId: snapshot.videoId || null })}>Open in Edit</button> : null}
            {snapshot.publishedUrl ? <ButtonLink variant="secondary" compact href={snapshot.publishedUrl} target="_blank" rel="noreferrer">Open on YouTube</ButtonLink> : null}
            <button type="button" className="secondary-button compact-button" onClick={() => onGenerateCoach(snapshot.videoId)}>Coach this video</button>
          </div>
          <RetentionChart points={detail?.retention ?? []} />
          <div className="performance-breakdown-grid">
            <BreakdownList title="Traffic source" entries={(detail?.trafficSources ?? []).map((entry) => ({ label: entry.sourceType, views: entry.views, shareOfViews: entry.shareOfViews }))} />
            <BreakdownList title="Devices" entries={detail?.devices ?? []} />
            <BreakdownList title="Subscriber status" entries={detail?.subscriberStatus ?? []} />
          </div>
          {detail?.dataLimitations.length ? <p className="detail-meta">Limits: {detail.dataLimitations.join(" · ")}</p> : null}
        </>
      ) : null}
    </aside>
  );
}

function RetentionChart({ points }: { points: PerformanceVideoDetail["retention"] }): JSX.Element { if (!points.length) return <div className="performance-retention-chart"><h3>Audience retention</h3><p className="muted">Loaded on demand when YouTube returns retention data.</p></div>; return <div className="performance-retention-chart"><h3>Audience retention</h3><div className="performance-retention-bars">{points.map((point) => <div key={point.elapsedVideoTimeRatio} className="performance-retention-point" title={`${Math.round(point.elapsedVideoTimeRatio * 100)}% through video`}><span style={{ height: `${Math.max(5, Math.min(100, (point.audienceWatchRatio ?? 0) * 100))}%` }} /></div>)}</div><div className="performance-row-header"><span>Start</span><span>End</span></div></div>; }

function overviewMetricCards(overview: NonNullable<PerformanceDashboardResult["overview"]>): Array<{ id: string; label: string; value: string; change: number | null; note: string }> { return [{ id: "views", label: "Views", value: formatNumber(overview.views), change: overview.changes.views ?? null, note: "Raw views in the selected period" }, { id: "engaged", label: "Engaged views", value: formatNumber(overview.engagedViews), change: overview.changes.engagedViews ?? null, note: "Use alongside retention and format" }, { id: "watch", label: "Minutes watched", value: formatNumber(overview.estimatedMinutesWatched), change: overview.changes.estimatedMinutesWatched ?? null, note: "Estimated watch time" }, { id: "duration", label: "Avg view duration", value: overview.averageViewDuration === null ? "Not enough data" : formatDuration(overview.averageViewDuration), change: overview.changes.averageViewDuration ?? null, note: "Average seconds watched" }, { id: "percentage", label: "Avg percentage viewed", value: overview.averageViewPercentage === null ? "Not enough data" : `${overview.averageViewPercentage.toFixed(1)}%`, change: overview.changes.averageViewPercentage ?? null, note: "Not CTR" }, { id: "engagement", label: "Likes / comments / shares", value: `${formatNumber(overview.likes)} / ${formatNumber(overview.comments)} / ${formatNumber(overview.shares)}`, change: null, note: "Engagement totals" }, { id: "subscribers", label: "Subscribers gained / lost", value: `${formatNumber(overview.subscribersGained)} / ${formatNumber(overview.subscribersLost)}`, change: null, note: "Analytics values where available" }, { id: "published", label: "Published videos", value: String(overview.publishedVideoCount), change: overview.changes.publishedVideoCount ?? null, note: `${calculatePublishingCadence(overview)} publishing cadence` }]; }

function calculatePublishingCadence(overview: NonNullable<PerformanceDashboardResult["overview"]>): string { if (overview.publishedVideoCount === 0) return "Local video sample unavailable"; const start = Date.parse(`${overview.startDate}T00:00:00.000Z`); const end = Date.parse(`${overview.endDate}T00:00:00.000Z`); const weeks = Math.max(1, (end - start) / (7 * 86_400_000)); return `${(overview.publishedVideoCount / weeks).toFixed(1)} videos/week`; }

function formatChange(value: number | null): string { return value === null || !Number.isFinite(value) ? "Not enough data" : `${value >= 0 ? "+" : ""}${Math.round(value)}% vs previous period`; }
function formatDuration(value: number): string { const minutes = Math.floor(value / 60); const seconds = Math.round(value % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }
function formatShortDate(value: string): string { const date = new Date(`${value}T00:00:00.000Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function averagePerformanceMetric(snapshots: PerformanceDashboardResult["ownedSnapshots"], metric: PerformanceMetric): number | null { const values = snapshots.map((snapshot) => getMetricValue(snapshot, metric)).filter((value): value is number => value !== null); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function formatMetricComparison(_metric: PerformanceMetric, value: number | null, average: number | null): string { if (value === null || average === null || average === 0) return "vs avg unavailable"; const change = ((value - average) / Math.abs(average)) * 100; return `${change >= 0 ? "+" : ""}${Math.round(change)}% vs avg`; }
function formatMetricLabel(metric: PerformanceMetric, snapshot: PerformanceDashboardResult["ownedSnapshots"][number]): string { const value = getMetricValue(snapshot, metric); return metric === "average_view_percentage" ? value === null ? "Avg viewed unavailable" : `Avg viewed ${value.toFixed(1)}%` : `${metric === "engaged_views" ? "Engaged views" : metric[0].toUpperCase() + metric.slice(1)} ${formatNumber(value)}`; }
function getMetricValue(snapshot: PerformanceDashboardResult["ownedSnapshots"][number], metric: PerformanceMetric): number | null { switch (metric) { case "engaged_views": return snapshot.engagedViews; case "views": return snapshot.views; case "average_view_percentage": return snapshot.averageViewPercentage; case "likes": return snapshot.likes; case "comments": return snapshot.comments; } }
function formatPerformanceScore(value: number): string { return value > 0 ? Math.round(value).toLocaleString() : "0"; }
function formatNumber(value: number | null | undefined): string { return value === null || value === undefined ? "Unavailable" : Math.round(value).toLocaleString(); }
function formatTimestamp(value: string | null): string { return value ? new Date(value).toLocaleString() : "Not refreshed yet"; }
function formatDirection(value: "up" | "down" | "flat" | "unknown"): string { return value === "unknown" ? "Need more data" : value === "up" ? "Rising" : value === "down" ? "Declining" : "Flat"; }

interface PerformanceDashboardAction { kind: "settings" | "workspace"; label: string; }
interface PerformanceReadinessItem { id: string; title: string; summary: string; statusLabel: string; tone: "readiness-ready" | "readiness-warning" | "readiness-default"; complete: boolean; action: PerformanceDashboardAction | null; }
function buildReadinessItems(input: { clientIdConfigured: boolean; youtubeConnected: boolean; analyticsScopeGranted: boolean; youtubeRefreshablePostCount: number }): PerformanceReadinessItem[] { return [{ id: "credentials", title: "Save a Google OAuth desktop client ID", summary: input.clientIdConfigured ? "OAuth credentials are configured." : "Open Settings and save the Google OAuth desktop client ID.", statusLabel: input.clientIdConfigured ? "Ready" : "Required", tone: input.clientIdConfigured ? "readiness-ready" : "readiness-warning", complete: input.clientIdConfigured, action: input.clientIdConfigured ? null : { kind: "settings", label: "Open Settings" } }, { id: "connection", title: "Connect YouTube with Analytics access", summary: input.youtubeConnected && input.analyticsScopeGranted ? "Connected channel identity and Analytics scope are ready." : input.youtubeConnected ? "Reconnect YouTube so Google grants Analytics access." : "Connect YouTube in Settings to scope the cockpit to a channel.", statusLabel: input.youtubeConnected && input.analyticsScopeGranted ? "Ready" : input.youtubeConnected ? "Reconnect" : "Next", tone: input.youtubeConnected && input.analyticsScopeGranted ? "readiness-ready" : "readiness-warning", complete: input.youtubeConnected && input.analyticsScopeGranted, action: input.youtubeConnected && input.analyticsScopeGranted ? null : { kind: "settings", label: "Open Settings" } }, { id: "workspace", title: "Add owned evidence", summary: input.youtubeRefreshablePostCount > 0 ? "Workspace has uploaded YouTube posts to refresh." : "Import channel history or post a YouTube clip from Edit.", statusLabel: input.youtubeRefreshablePostCount > 0 ? "Ready" : "Next", tone: input.youtubeRefreshablePostCount > 0 ? "readiness-ready" : "readiness-default", complete: input.youtubeRefreshablePostCount > 0, action: input.youtubeRefreshablePostCount > 0 ? null : { kind: "workspace", label: "Open Edit" } }]; }
function getOwnedEmptyState(input: { clientIdConfigured: boolean; youtubeConnected: boolean; analyticsScopeGranted: boolean; youtubeRefreshablePostCount: number }): { title: string; summary: string } { if (!input.clientIdConfigured) return { title: "Finish YouTube setup in Settings", summary: "Save OAuth credentials, connect YouTube, and then refresh or import channel history." }; if (!input.youtubeConnected) return { title: "Connect YouTube to unlock owned analytics", summary: "This cockpit is intentionally scoped to the connected channel." }; if (!input.analyticsScopeGranted) return { title: "Reconnect YouTube for Analytics access", summary: "The current connection can upload, but Analytics scope is required for personal performance detail." }; if (input.youtubeRefreshablePostCount === 0) return { title: "Import history or post a YouTube clip", summary: "Add owned videos so the cockpit can compare your games, formats, series, and publishing cadence." }; return { title: "No videos match these filters", summary: "Widen the date range or clear the game, series, and format filters." }; }
