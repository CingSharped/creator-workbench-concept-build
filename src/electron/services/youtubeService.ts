import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { safeStorage, shell } from "electron";
import type {
  ClipMetadataPackageRecord,
  ClipRecord,
  ScheduledPostRecord,
  ScheduledPostStatus,
  TranscriptRecord,
  YouTubeCaptionStatus,
  YouTubeConnectionStatus,
  YouTubeManagedVideoRecord,
  YouTubeMetadataPatch,
  YouTubePlaylistRecord,
  PerformanceChannelProfile
} from "../../shared/contracts";
import { isValidTimedSrtContent } from "../../shared/transcriptSegments";
import { clearAppSetting, getAppSetting, setAppSetting } from "./settingsRepository";
import {
  clearAllSavedYouTubeCredentials,
  clearSavedYouTubeClientSecret,
  clearStoredYouTubeSession as clearPersistedYouTubeSession,
  persistSavedYouTubeClientId,
  persistSavedYouTubeClientSecret,
  persistStoredYouTubeSession,
  readSavedYouTubeClientId,
  readSavedYouTubeClientSecret,
  readStoredYouTubeSession,
  type StoredYouTubeSession
} from "./youtubeCredentialStore";

const YOUTUBE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const YOUTUBE_CAPTIONS_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_CAPTIONS_SCOPE
];
const YOUTUBE_CALLBACK_PATH = "/oauth/youtube/callback";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_YOUTUBE_ANALYTICS_START_DATE = "2025-01-01";
const MAX_YOUTUBE_CHANNEL_HISTORY_RESULTS = 150;
const MAX_YOUTUBE_ANALYTICS_VIDEO_IDS_PER_REQUEST = 25;

// `viewerPercentage` is only supported by YouTube's viewer-demographics
// report, which requires ageGroup/gender dimensions. It cannot be requested
// from a video-level report, so leave it nullable on the snapshot model until
// a dedicated demographics query is added.
export const YOUTUBE_VIDEO_PERFORMANCE_METRICS = [
  "engagedViews",
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost"
] as const;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface YouTubeChannelListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      customUrl?: string;
      thumbnails?: {
        default?: { url?: string };
        medium?: { url?: string };
        high?: { url?: string };
      };
    };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
    };
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string;
      };
    };
  }>;
}

interface YouTubePlaylistListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
    };
    contentDetails?: {
      itemCount?: number;
    };
  }>;
  nextPageToken?: string;
}

interface YouTubePlaylistItemListResponse {
  items?: Array<{
    contentDetails?: {
      videoId?: string;
      videoPublishedAt?: string;
    };
    snippet?: {
      publishedAt?: string;
    };
  }>;
  nextPageToken?: string;
}

interface YouTubeVideoInsertResponse {
  id?: string;
}

interface YouTubeCaptionListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      language?: string;
      name?: string;
    };
  }>;
}

interface YouTubeAnalyticsReportResponse {
  columnHeaders?: Array<{
    name?: string;
  }>;
  rows?: Array<Array<number | string>>;
}

interface YouTubeVideoCategoryListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      assignable?: boolean;
    };
  }>;
}

interface YouTubeVideoListResponse {
  etag?: string;
  items?: Array<{
    id?: string;
    etag?: string;
    snippet?: {
      channelId?: string;
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      tags?: string[];
      categoryId?: string;
      thumbnails?: {
        default?: { url?: string };
        medium?: { url?: string };
        high?: { url?: string };
      };
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    contentDetails?: {
      duration?: string;
    };
    status?: {
      uploadStatus?: string;
      privacyStatus?: string;
      publishAt?: string;
      rejectionReason?: string;
    };
  }>;
}

interface PublishClipToYouTubeInput {
  clip: ClipRecord;
  metadata: ClipMetadataPackageRecord;
  publishAt: string;
  playlistIds: string[];
  transcriptLanguage?: string | null;
}

export interface PublishClipToYouTubeResult {
  videoId: string;
  videoUrl: string;
  status: ScheduledPostStatus;
}

export interface YouTubeCaptionUploadResult {
  status: Exclude<YouTubeCaptionStatus, "pending" | "not_applicable">;
  remoteCaptionId: string | null;
  language: string | null;
  name: string | null;
  errorMessage: string | null;
}

export interface YouTubeVideoPerformanceSnapshot {
  videoId: string;
  views: number | null;
  engagedViews: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
  viewerPercentage: number | null;
}

export interface YouTubeAnalyticsReport {
  columnHeaders: string[];
  rows: Array<Array<number | string>>;
}

export interface YouTubeAnalyticsReportRequest {
  startDate: string;
  endDate: string;
  dimensions: string;
  metrics: string[];
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export interface YouTubeVideoCategory {
  id: string;
  title: string;
  assignable: boolean;
}

export interface YouTubeOwnedChannelVideoRecord {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  tags: string[];
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export interface ListOwnedYouTubeChannelVideosResult {
  videos: YouTubeOwnedChannelVideoRecord[];
  cappedByLimit: boolean;
}

export interface YouTubeScheduledPostStatusRefreshResult {
  updates: Array<{
    postId: string;
    status: ScheduledPostStatus;
  }>;
  checkedCount: number;
  skippedCount: number;
  unavailableCount: number;
}

export async function refreshYouTubeScheduledPostStatuses(
  posts: ScheduledPostRecord[]
): Promise<YouTubeScheduledPostStatusRefreshResult> {
  const candidates = posts.filter(
    (post) => post.platform === "youtube" && Boolean(post.remotePostId?.trim())
  );
  const skippedCount = posts.length - candidates.length;
  const updates: YouTubeScheduledPostStatusRefreshResult["updates"] = [];
  let checkedCount = 0;
  let unavailableCount = 0;

  for (const postChunk of chunkValues(candidates, 50)) {
    const videoIds = postChunk
      .map((post) => post.remotePostId?.trim())
      .filter((videoId): videoId is string => Boolean(videoId));
    if (videoIds.length === 0) {
      continue;
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "status");
    url.searchParams.set("id", videoIds.join(","));
    url.searchParams.set("maxResults", String(videoIds.length));

    const response = await fetchYouTubeJson<YouTubeVideoListResponse>(url);
    const videosById = new Map((response.items ?? []).map((item) => [item.id, item]));

    for (const post of postChunk) {
      const remotePostId = post.remotePostId?.trim();
      if (!remotePostId) {
        continue;
      }

      const video = videosById.get(remotePostId);
      if (!video?.status) {
        unavailableCount += 1;
        continue;
      }

      checkedCount += 1;
      const nextStatus = getScheduledPostStatusFromYouTube(video.status);
      if (nextStatus !== post.status) {
        updates.push({ postId: post.id, status: nextStatus });
      }
    }
  }

  return { updates, checkedCount, skippedCount, unavailableCount };
}

export async function readYouTubeSchedule(channelId: string) {
  const playlistId = await fetchOwnedUploadsPlaylistId(channelId);
  const videos = new Map<string, { status: ScheduledPostStatus; publishAt?: string }>();
  let pageToken: string | undefined;
  do {
    const page = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    page.searchParams.set("part", "contentDetails");
    page.searchParams.set("playlistId", playlistId);
    page.searchParams.set("maxResults", "50");
    if (pageToken) page.searchParams.set("pageToken", pageToken);
    const response = await fetchYouTubeJson<YouTubePlaylistItemListResponse>(page);
    const ids = (response.items ?? []).flatMap(item => item.contentDetails?.videoId ?? []);
    if (ids.length) {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("part", "status");
      url.searchParams.set("id", ids.join(","));
      const details = await fetchYouTubeJson<YouTubeVideoListResponse>(url);
      for (const item of details.items ?? []) {
        if (!item.id || !item.status) continue;
        const status = getScheduledPostStatusFromYouTube(item.status);
        videos.set(item.id, { status, publishAt: status === "scheduled" ? item.status.publishAt : undefined });
      }
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
  return videos;
}

export function getYouTubeConnectionStatus(): YouTubeConnectionStatus {
  const clientId = getSavedYouTubeClientId();
  const session = getStoredYouTubeSession();

  return {
    clientId,
    clientIdConfigured: clientId.length > 0,
    clientSecretConfigured: getSavedYouTubeClientSecret() !== null,
    connected: session !== null,
    analyticsScopeGranted: session ? hasRequiredAnalyticsScope(session.scopes) : false,
    captionsScopeGranted: session ? hasRequiredCaptionsScope(session.scopes) : false,
    channelId: session?.channelId ?? null,
    channelTitle: session?.channelTitle ?? null,
    connectedAt: session?.connectedAt ?? null
  };
}

export async function fetchYouTubeChannelProfile(): Promise<PerformanceChannelProfile> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("mine", "true");

  const response = await fetchYouTubeJson<YouTubeChannelListResponse>(url);
  const channel = response.items?.[0];
  if (!channel) {
    throw new Error("No YouTube channel was returned for the connected Google account.");
  }
  const channelId = channel?.id?.trim();
  if (!channelId) {
    throw new Error("No YouTube channel was returned for the connected Google account.");
  }

  const customUrl = channel.snippet?.customUrl?.trim() || null;
  return {
    channelId,
    title: channel.snippet?.title?.trim() || "Connected YouTube channel",
    description: channel.snippet?.description?.trim() || null,
    customUrl,
    thumbnailUrl:
      channel.snippet?.thumbnails?.high?.url?.trim() ||
      channel.snippet?.thumbnails?.medium?.url?.trim() ||
      channel.snippet?.thumbnails?.default?.url?.trim() ||
      null,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    subscriberCount: parseYouTubeCount(channel.statistics?.subscriberCount),
    viewCount: parseYouTubeCount(channel.statistics?.viewCount),
    videoCount: parseYouTubeCount(channel.statistics?.videoCount),
    fetchedAt: new Date().toISOString()
  };
}

export async function fetchYouTubeAnalyticsReport(
  input: YouTubeAnalyticsReportRequest
): Promise<YouTubeAnalyticsReport> {
  ensureYouTubeAnalyticsScope();
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", normalizePublishedAfterDate(input.startDate));
  url.searchParams.set("endDate", normalizePublishedAfterDate(input.endDate));
  url.searchParams.set("dimensions", input.dimensions);
  url.searchParams.set("metrics", input.metrics.join(","));
  if (input.filters?.trim()) {
    url.searchParams.set("filters", input.filters.trim());
  }
  if (input.sort?.trim()) {
    url.searchParams.set("sort", input.sort.trim());
  }
  if (input.maxResults !== undefined) {
    url.searchParams.set("maxResults", String(Math.max(1, Math.floor(input.maxResults))));
  }

  const response = await fetchYouTubeJson<YouTubeAnalyticsReportResponse>(url);
  return {
    columnHeaders: (response.columnHeaders ?? [])
      .map((header) => header.name?.trim() ?? "")
      .filter(Boolean),
    rows: response.rows ?? []
  };
}

export function saveYouTubeCredentials(clientId: string, clientSecret: string): YouTubeConnectionStatus {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) {
    throw new Error("Add your Google OAuth client ID before saving YouTube settings.");
  }

  const previousClientId = getSavedYouTubeClientId();
  persistSavedYouTubeClientId(getYouTubeSettingsStore(), normalizedClientId);

  const normalizedClientSecret = clientSecret.trim();
  if (normalizedClientSecret) {
    persistSavedYouTubeClientSecret(
      getYouTubeSettingsStore(),
      safeStorage,
      normalizedClientSecret
    );
  } else if (previousClientId !== normalizedClientId || !getSavedYouTubeClientSecret()) {
    clearSavedYouTubeClientSecret(getYouTubeSettingsStore());
  }

  if (previousClientId !== normalizedClientId) {
    clearStoredYouTubeSession();
  }

  return getYouTubeConnectionStatus();
}

export function clearYouTubeCredentials(): YouTubeConnectionStatus {
  clearAllSavedYouTubeCredentials(getYouTubeSettingsStore());
  return getYouTubeConnectionStatus();
}

export function disconnectYouTube(): YouTubeConnectionStatus {
  clearStoredYouTubeSession();
  return getYouTubeConnectionStatus();
}

export async function connectYouTube(): Promise<YouTubeConnectionStatus> {
  const clientId = getSavedYouTubeClientId();
  if (!clientId) {
    throw new Error("Save your Google OAuth client ID in Settings before connecting YouTube.");
  }

  const clientSecret = getSavedYouTubeClientSecret();
  const state = randomBytes(24).toString("hex");
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const callbackReceiver = await createOAuthCallbackReceiver(state);

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackReceiver.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", YOUTUBE_OAUTH_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  await shell.openExternal(authorizationUrl.toString());

  const authorizationCode = await callbackReceiver.waitForCode;
  const tokenResponse = await exchangeAuthorizationCode({
    authorizationCode,
    clientId,
    clientSecret,
    redirectUri: callbackReceiver.redirectUri,
    codeVerifier
  });

  const accessToken = tokenResponse.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google did not return an access token for the YouTube connection.");
  }

  const refreshToken = tokenResponse.refresh_token?.trim() || getStoredYouTubeSession()?.refreshToken;
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Remove the existing connection in your Google account permissions and try again."
    );
  }

  const scopes = normalizeScopes(tokenResponse.scope, YOUTUBE_OAUTH_SCOPES);
  const channel = await fetchPrimaryYouTubeChannel(accessToken);
  setStoredYouTubeSession({
    accessToken,
    refreshToken,
    expiresAt: getAccessTokenExpiryTimestamp(tokenResponse.expires_in),
    channelId: channel.id,
    channelTitle: channel.title,
    connectedAt: new Date().toISOString(),
    scopes
  });

  return getYouTubeConnectionStatus();
}

export async function listYouTubePlaylists(): Promise<YouTubePlaylistRecord[]> {
  const playlists: YouTubePlaylistRecord[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetchYouTubeJson<YouTubePlaylistListResponse>(url);
    for (const playlist of response.items ?? []) {
      if (!playlist.id || !playlist.snippet?.title) {
        continue;
      }

      playlists.push({
        id: playlist.id,
        title: playlist.snippet.title,
        description: playlist.snippet.description ?? "",
        itemCount: playlist.contentDetails?.itemCount ?? 0
      });
    }

    pageToken = response.nextPageToken ?? null;
  } while (pageToken);

  return playlists.sort((left, right) => left.title.localeCompare(right.title));
}

export async function publishClipToYouTube(
  input: PublishClipToYouTubeInput
): Promise<PublishClipToYouTubeResult> {
  const publishDate = new Date(input.publishAt);
  if (Number.isNaN(publishDate.getTime())) {
    throw new Error("The scheduled YouTube publish time is invalid.");
  }

  const fileStats = await stat(input.clip.sourcePath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error(`The selected clip file is unavailable for upload: ${input.clip.sourcePath}`);
  }

  const uploadStatus = buildYouTubeUploadStatus(publishDate);
  const uploadUrl = await createYouTubeResumableUploadSession({
    title: input.metadata.title,
    description: input.metadata.description,
    tags: input.metadata.platformTags,
    language: normalizeCaptionLanguage(input.transcriptLanguage ?? null),
    publishStatus: uploadStatus,
    filePath: input.clip.sourcePath,
    fileSizeBytes: fileStats.size
  });

  const uploadResponse = await uploadBinaryToYouTube(uploadUrl, input.clip.sourcePath, fileStats.size);
  const videoId = uploadResponse.id?.trim();
  if (!videoId) {
    throw new Error("YouTube did not return a video ID after the upload completed.");
  }

  for (const playlistId of input.playlistIds) {
    await addVideoToYouTubePlaylist(videoId, playlistId);
  }

  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    status: publishDate.getTime() > Date.now() ? "scheduled" : "posted"
  };
}

export async function uploadYouTubeCaptions(input: {
  videoId: string;
  transcript: TranscriptRecord | null;
  existingCaptionRemoteId?: string | null;
}): Promise<YouTubeCaptionUploadResult> {
  const captionName = "Creator Workbench transcript";
  const transcript = input.transcript;
  if (
    !transcript ||
    transcript.assetType !== "clip" ||
    transcript.status === "incomplete" ||
    !isValidTimedSrtContent(transcript.srtContent)
  ) {
    return {
      status: "unavailable",
      remoteCaptionId: null,
      language: null,
      name: captionName,
      errorMessage: "The video was uploaded without captions because no complete, valid timed SRT was available."
    };
  }

  const language = normalizeCaptionLanguage(transcript.language);
  if (input.existingCaptionRemoteId?.trim()) {
    return {
      status: "uploaded",
      remoteCaptionId: input.existingCaptionRemoteId.trim(),
      language,
      name: captionName,
      errorMessage: null
    };
  }

  const session = getStoredYouTubeSession();
  if (!session || !hasRequiredCaptionsScope(session.scopes)) {
    return {
      status: "reconnect_required",
      remoteCaptionId: null,
      language,
      name: captionName,
      errorMessage: "Reconnect YouTube in Settings to grant caption upload permission, then retry captions."
    };
  }

  try {
    const existingCaptionId = await findExistingYouTubeCaption(input.videoId, language, captionName);
    if (existingCaptionId) {
      return {
        status: "uploaded",
        remoteCaptionId: existingCaptionId,
        language,
        name: captionName,
        errorMessage: null
      };
    }

    const remoteCaptionId = await insertYouTubeCaption({
      videoId: input.videoId,
      language,
      name: captionName,
      srtContent: transcript.srtContent
    });
    return {
      status: "uploaded",
      remoteCaptionId,
      language,
      name: captionName,
      errorMessage: null
    };
  } catch (error) {
    const sessionAfterFailure = getStoredYouTubeSession();
    const reconnectRequired = !sessionAfterFailure || !hasRequiredCaptionsScope(sessionAfterFailure.scopes);
    return {
      status: reconnectRequired ? "reconnect_required" : "failed",
      remoteCaptionId: null,
      language,
      name: captionName,
      errorMessage: reconnectRequired
        ? "Reconnect YouTube in Settings to grant caption upload permission, then retry captions."
        : error instanceof Error
          ? `The video uploaded, but captions could not be added: ${error.message}`
          : "The video uploaded, but captions could not be added."
    };
  }
}

export async function fetchYouTubePerformanceSnapshot(
  videoId: string
): Promise<YouTubeVideoPerformanceSnapshot> {
  ensureYouTubeAnalyticsScope();

  const snapshotsByVideoId = await fetchYouTubePerformanceSnapshotMap(
    [videoId],
    DEFAULT_YOUTUBE_ANALYTICS_START_DATE
  );
  return (
    snapshotsByVideoId.get(videoId) ?? {
      videoId,
      views: null,
      engagedViews: null,
      estimatedMinutesWatched: null,
      averageViewDuration: null,
      averageViewPercentage: null,
      likes: null,
      comments: null,
      shares: null,
      subscribersGained: null,
      subscribersLost: null,
      viewerPercentage: null
    }
  );
}

export async function listYouTubeVideoCategories(regionCode: string): Promise<YouTubeVideoCategory[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videoCategories");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("regionCode", regionCode.toUpperCase());

  const response = await fetchYouTubeJson<YouTubeVideoCategoryListResponse>(url);
  return (response.items ?? [])
    .map((item) => {
      const id = item.id?.trim();
      const title = item.snippet?.title?.trim();
      if (!id || !title) {
        return null;
      }

      return {
        id,
        title,
        assignable: item.snippet?.assignable !== false
      };
    })
    .filter((item): item is YouTubeVideoCategory => item !== null)
    .sort((left, right) => left.title.localeCompare(right.title));
}

export async function listManagedYouTubeVideos(input: {
  publishedAfter: string;
  maxResults?: number;
}): Promise<YouTubeManagedVideoRecord[]> {
  const summary = await listOwnedYouTubeChannelVideos(input);
  const videoIds = summary.videos.map((video) => video.videoId);
  if (videoIds.length === 0) {
    return [];
  }

  const records: YouTubeManagedVideoRecord[] = [];
  for (const videoIdChunk of chunkStrings(videoIds, 50)) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics,contentDetails,status");
    url.searchParams.set("id", videoIdChunk.join(","));
    url.searchParams.set("maxResults", String(videoIdChunk.length));
    const response = await fetchYouTubeJson<YouTubeVideoListResponse>(url);
    records.push(...normalizeManagedYouTubeVideoRecords(response.items ?? [], response.etag ?? null));
  }

  return records;
}

export async function fetchManagedYouTubeVideo(videoId: string): Promise<YouTubeManagedVideoRecord | null> {
  const normalizedVideoId = videoId.trim();
  if (!normalizedVideoId) {
    return null;
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,statistics,contentDetails,status");
  url.searchParams.set("id", normalizedVideoId);
  const response = await fetchYouTubeJson<YouTubeVideoListResponse>(url);
  return normalizeManagedYouTubeVideoRecords(response.items ?? [], response.etag ?? null)[0] ?? null;
}

export async function updateYouTubeVideoMetadata(input: {
  videoId: string;
  current: YouTubeManagedVideoRecord;
  patch: YouTubeMetadataPatch;
}): Promise<YouTubeManagedVideoRecord> {
  const title = input.patch.title ?? input.current.title;
  const description = input.patch.description ?? input.current.description;
  const tags = input.patch.tags ?? input.current.tags;
  const categoryId = input.patch.categoryId ?? input.current.categoryId;
  if (!title.trim() || !categoryId.trim()) {
    throw new Error("YouTube metadata updates require a title and category.");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  await fetchYouTube(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      id: input.videoId,
      snippet: {
        title: title.trim(),
        description,
        tags,
        categoryId: categoryId.trim()
      }
    })
  });

  const updated = await fetchManagedYouTubeVideo(input.videoId);
  if (!updated) {
    throw new Error("YouTube accepted the metadata update but did not return the video afterward.");
  }
  return updated;
}

export async function uploadYouTubeThumbnail(input: {
  videoId: string;
  filePath: string;
}): Promise<YouTubeManagedVideoRecord> {
  const fileStats = await stat(input.filePath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("The selected thumbnail file is unavailable.");
  }
  if (fileStats.size > 2 * 1024 * 1024) {
    throw new Error("YouTube thumbnails must be 2 MB or smaller when uploaded through the API.");
  }

  const extension = path.extname(input.filePath).toLowerCase();
  const contentType = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
  if (!contentType) {
    throw new Error("Thumbnail files must be JPEG or PNG images.");
  }

  const url = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
  url.searchParams.set("videoId", input.videoId);
  await fetchYouTube(url, {
    method: "POST",
    headers: {
      "Content-Length": String(fileStats.size),
      "Content-Type": contentType
    },
    body: createReadStream(input.filePath),
    duplex: "half"
  } as RequestInit & { duplex: "half" });

  const updated = await fetchManagedYouTubeVideo(input.videoId);
  if (!updated) {
    throw new Error("YouTube accepted the thumbnail but did not return the video afterward.");
  }
  return updated;
}

export async function listOwnedYouTubeChannelVideos(input: {
  publishedAfter: string;
  maxResults?: number;
}): Promise<ListOwnedYouTubeChannelVideosResult> {
  const publishedAfter = normalizePublishedAfterDate(input.publishedAfter);
  const publishedAfterTimestamp = Date.parse(`${publishedAfter}T00:00:00.000Z`);
  const maxResults = Math.min(
    Math.max(Math.floor(input.maxResults ?? MAX_YOUTUBE_CHANNEL_HISTORY_RESULTS), 1),
    MAX_YOUTUBE_CHANNEL_HISTORY_RESULTS
  );
  const uploadsPlaylistId = await fetchOwnedUploadsPlaylistId();
  const videoIds: string[] = [];
  const seenVideoIds = new Set<string>();
  let nextPageToken: string | null = null;
  let reachedOlderVideos = false;
  let cappedByLimit = false;

  while (!reachedOlderVideos) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails,snippet");
    url.searchParams.set("playlistId", uploadsPlaylistId);
    url.searchParams.set("maxResults", "50");
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetchYouTubeJson<YouTubePlaylistItemListResponse>(url);
    for (const item of response.items ?? []) {
      const videoId = item.contentDetails?.videoId?.trim();
      const publishedAt =
        item.contentDetails?.videoPublishedAt?.trim() ?? item.snippet?.publishedAt?.trim() ?? "";
      if (!videoId || !publishedAt) {
        continue;
      }

      if (Date.parse(publishedAt) < publishedAfterTimestamp) {
        reachedOlderVideos = true;
        continue;
      }

      if (seenVideoIds.has(videoId)) {
        continue;
      }

      seenVideoIds.add(videoId);
      videoIds.push(videoId);
      if (videoIds.length >= maxResults) {
        cappedByLimit = true;
        reachedOlderVideos = true;
        break;
      }
    }

    nextPageToken = response.nextPageToken?.trim() ?? null;
    if (!nextPageToken) {
      break;
    }
  }

  if (videoIds.length === 0) {
    return {
      videos: [],
      cappedByLimit: false
    };
  }

  const videos: YouTubeOwnedChannelVideoRecord[] = [];
  for (const videoIdChunk of chunkStrings(videoIds, 50)) {
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    videosUrl.searchParams.set("id", videoIdChunk.join(","));
    videosUrl.searchParams.set("maxResults", String(videoIdChunk.length));

    const response = await fetchYouTubeJson<YouTubeVideoListResponse>(videosUrl);
    videos.push(...normalizeOwnedChannelVideoRecords(response.items ?? []));
  }

  const videosById = new Map(videos.map((video) => [video.videoId, video]));
  return {
    videos: videoIds.map((videoId) => videosById.get(videoId)).filter((video): video is YouTubeOwnedChannelVideoRecord => video !== undefined),
    cappedByLimit
  };
}

export async function fetchYouTubePerformanceSnapshots(input: {
  videoIds: string[];
  startDate: string;
}): Promise<YouTubeVideoPerformanceSnapshot[]> {
  const snapshotsByVideoId = await fetchYouTubePerformanceSnapshotMap(
    input.videoIds,
    input.startDate
  );
  return input.videoIds
    .map((videoId) => snapshotsByVideoId.get(videoId.trim()))
    .filter((snapshot): snapshot is YouTubeVideoPerformanceSnapshot => snapshot !== undefined);
}

function getScheduledPostStatusFromYouTube(status: {
  uploadStatus?: string;
  privacyStatus?: string;
  publishAt?: string;
  rejectionReason?: string;
}): ScheduledPostStatus {
  if (status.uploadStatus === "failed" || status.rejectionReason) {
    return "failed";
  }

  if (status.privacyStatus === "public" || status.privacyStatus === "unlisted") {
    return "posted";
  }

  return status.privacyStatus === "private" && status.publishAt && !["rejected", "deleted"].includes(status.uploadStatus ?? "") ? "scheduled" : "failed";
}

function getSavedYouTubeClientId(): string {
  return readSavedYouTubeClientId(getYouTubeSettingsStore());
}

function getSavedYouTubeClientSecret(): string | null {
  return readSavedYouTubeClientSecret(getYouTubeSettingsStore(), safeStorage);
}

function getStoredYouTubeSession(): StoredYouTubeSession | null {
  return readStoredYouTubeSession(getYouTubeSettingsStore(), safeStorage);
}

function setStoredYouTubeSession(session: StoredYouTubeSession): void {
  persistStoredYouTubeSession(getYouTubeSettingsStore(), safeStorage, session);
}

function clearStoredYouTubeSession(): void {
  clearPersistedYouTubeSession(getYouTubeSettingsStore());
}

function getYouTubeSettingsStore() {
  return {
    getAppSetting,
    setAppSetting,
    clearAppSetting
  };
}

function hasRequiredAnalyticsScope(scopes: string[]): boolean {
  return scopes.includes(YOUTUBE_ANALYTICS_SCOPE);
}

function hasRequiredCaptionsScope(scopes: string[]): boolean {
  return scopes.includes(YOUTUBE_CAPTIONS_SCOPE);
}

function ensureYouTubeAnalyticsScope(): StoredYouTubeSession {
  const session = getStoredYouTubeSession();
  if (!session) {
    throw new Error("Connect your YouTube account in Settings before trying to refresh performance.");
  }

  if (!hasRequiredAnalyticsScope(session.scopes)) {
    throw new Error(
      "Reconnect YouTube in Settings to grant YouTube Analytics access before refreshing publish performance."
    );
  }

  return session;
}

async function createOAuthCallbackReceiver(expectedState: string): Promise<{
  redirectUri: string;
  waitForCode: Promise<string>;
}> {
  let resolveCode: ((value: string) => void) | null = null;
  let rejectCode: ((reason?: unknown) => void) | null = null;

  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== YOUTUBE_CALLBACK_PATH) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }

    const returnedState = requestUrl.searchParams.get("state");
    const returnedError = requestUrl.searchParams.get("error");
    const returnedCode = requestUrl.searchParams.get("code");

    response.statusCode = 200;
    response.setHeader("Content-Type", "text/html; charset=utf-8");

    if (returnedError) {
      response.end("<html><body><h1>YouTube connection cancelled</h1><p>You can close this tab.</p></body></html>");
      rejectCode?.(new Error(`Google OAuth returned: ${returnedError}`));
      void closeServer(server);
      return;
    }

    if (!returnedCode || returnedState !== expectedState) {
      response.end("<html><body><h1>YouTube connection failed</h1><p>You can close this tab and return to the app.</p></body></html>");
      rejectCode?.(new Error("The YouTube OAuth callback was invalid or did not match the current sign-in request."));
      void closeServer(server);
      return;
    }

    response.end("<html><body><h1>YouTube connected</h1><p>You can close this tab and return to Creator Workspace.</p></body></html>");
    resolveCode?.(returnedCode);
    void closeServer(server);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    void closeServer(server);
    throw new Error("Failed to open a local OAuth callback port for YouTube sign-in.");
  }

  const redirectUri = `http://127.0.0.1:${(address as AddressInfo).port}${YOUTUBE_CALLBACK_PATH}`;
  return {
    redirectUri,
    waitForCode: withTimeout(waitForCode, OAUTH_TIMEOUT_MS, async () => {
      await closeServer(server);
    })
  };
}

async function exchangeAuthorizationCode(input: {
  authorizationCode: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: input.authorizationCode,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri
  });

  if (input.clientSecret) {
    body.set("client_secret", input.clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(await buildGoogleApiError(response, "Google rejected the YouTube OAuth exchange"));
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function fetchPrimaryYouTubeChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await buildGoogleApiError(response, "Failed to read the connected YouTube channel"));
  }

  const data = (await response.json()) as YouTubeChannelListResponse;
  const channel = data.items?.[0];
  const channelId = channel?.id?.trim();
  const channelTitle = channel?.snippet?.title?.trim();
  if (!channelId || !channelTitle) {
    throw new Error("No YouTube channel was returned for the connected Google account.");
  }

  return {
    id: channelId,
    title: channelTitle
  };
}

async function fetchOwnedUploadsPlaylistId(expectedChannelId?: string): Promise<string> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("mine", "true");

  const response = await fetchYouTubeJson<YouTubeChannelListResponse>(url);
  if (expectedChannelId && response.items?.[0]?.id !== expectedChannelId) throw new Error("The connected YouTube channel changed. Refresh again.");
  const playlistId = response.items?.[0]?.contentDetails?.relatedPlaylists?.uploads?.trim();
  if (!playlistId) {
    throw new Error("The connected YouTube channel did not return an uploads playlist.");
  }

  return playlistId;
}

async function fetchYouTubeJson<T>(url: URL): Promise<T> {
  const response = await fetchYouTube(url, {
    headers: {
      Accept: "application/json"
    }
  });

  return (await response.json()) as T;
}

async function findExistingYouTubeCaption(
  videoId: string,
  language: string,
  name: string
): Promise<string | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/captions");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("videoId", videoId);
  const response = await fetchYouTubeJson<YouTubeCaptionListResponse>(url);
  return (
    response.items
      ?.find((item) => item.id && item.snippet?.language === language && item.snippet?.name === name)
      ?.id?.trim() ?? null
  );
}

async function insertYouTubeCaption(input: {
  videoId: string;
  language: string;
  name: string;
  srtContent: string;
}): Promise<string> {
  const captionBody = Buffer.from(`${input.srtContent.trim()}\n`, "utf8");
  const metadata = JSON.stringify({
    snippet: {
      videoId: input.videoId,
      language: input.language,
      name: input.name,
      isDraft: false
    }
  });
  const sessionUrl = new URL("https://www.googleapis.com/upload/youtube/v3/captions");
  sessionUrl.searchParams.set("part", "snippet");
  sessionUrl.searchParams.set("uploadType", "resumable");
  const sessionResponse = await fetchYouTube(sessionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(captionBody.byteLength),
      "X-Upload-Content-Type": "text/xml",
      Accept: "application/json"
    },
    body: metadata
  });

  const uploadUrl = sessionResponse.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return a caption upload URL.");
  }

  const response = await fetchYouTube(new URL(uploadUrl), {
    method: "PUT",
    headers: {
      "Content-Length": String(captionBody.byteLength),
      "Content-Type": "text/xml; charset=UTF-8"
    },
    body: captionBody as unknown as string
  });
  const result = (await response.json()) as { id?: string };
  const captionId = result.id?.trim();
  if (!captionId) {
    throw new Error("YouTube did not return a caption track ID.");
  }

  return captionId;
}

function normalizeCaptionLanguage(language: string | null): string {
  const normalized = language?.trim() ?? "";
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(normalized) ? normalized : "en";
}

function parseYouTubeCount(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchYouTube(url: URL, init: RequestInit, forceRefresh = false): Promise<Response> {
  const accessToken = await getValidYouTubeAccessToken(forceRefresh);
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (response.status === 401 && !forceRefresh) {
    return fetchYouTube(url, init, true);
  }

  if (!response.ok) {
    throw new Error(await buildGoogleApiError(response, "A YouTube API request failed"));
  }

  return response;
}

async function fetchYouTubePerformanceSnapshotMap(
  videoIds: string[],
  startDate: string
): Promise<Map<string, YouTubeVideoPerformanceSnapshot>> {
  const normalizedVideoIds = [...new Set(videoIds.map((videoId) => videoId.trim()).filter(Boolean))];
  const result = new Map<string, YouTubeVideoPerformanceSnapshot>();
  if (normalizedVideoIds.length === 0) {
    return result;
  }

  ensureYouTubeAnalyticsScope();

  for (const videoIdChunk of chunkStrings(normalizedVideoIds, MAX_YOUTUBE_ANALYTICS_VIDEO_IDS_PER_REQUEST)) {
    const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("metrics", YOUTUBE_VIDEO_PERFORMANCE_METRICS.join(","));
    url.searchParams.set("dimensions", "video");
    url.searchParams.set("filters", `video==${videoIdChunk.join(",")}`);
    url.searchParams.set("maxResults", String(videoIdChunk.length));
    url.searchParams.set("startDate", normalizePublishedAfterDate(startDate));
    url.searchParams.set("endDate", new Date().toISOString().slice(0, 10));

    const response = await fetchYouTubeJson<YouTubeAnalyticsReportResponse>(url);
    const metricIndexByName = buildAnalyticsIndexMap(response);
    for (const row of response.rows ?? []) {
      const rowVideoId = readStringAnalyticsMetric(row, metricIndexByName, "video");
      if (!rowVideoId) {
        continue;
      }

      result.set(rowVideoId, {
        videoId: rowVideoId,
        views: readNumericAnalyticsMetric(row, metricIndexByName, "views"),
        engagedViews: readNumericAnalyticsMetric(row, metricIndexByName, "engagedViews"),
        estimatedMinutesWatched: readNumericAnalyticsMetric(row, metricIndexByName, "estimatedMinutesWatched"),
        averageViewDuration: readNumericAnalyticsMetric(row, metricIndexByName, "averageViewDuration"),
        averageViewPercentage: readNumericAnalyticsMetric(row, metricIndexByName, "averageViewPercentage"),
        likes: readNumericAnalyticsMetric(row, metricIndexByName, "likes"),
        comments: readNumericAnalyticsMetric(row, metricIndexByName, "comments"),
        shares: readNumericAnalyticsMetric(row, metricIndexByName, "shares"),
        subscribersGained: readNumericAnalyticsMetric(row, metricIndexByName, "subscribersGained"),
        subscribersLost: readNumericAnalyticsMetric(row, metricIndexByName, "subscribersLost"),
        viewerPercentage: readNumericAnalyticsMetric(row, metricIndexByName, "viewerPercentage")
      });
    }
  }

  return result;
}

async function getValidYouTubeAccessToken(forceRefresh = false): Promise<string> {
  const session = getStoredYouTubeSession();
  if (!session?.refreshToken) {
    throw new Error("Connect your YouTube account in Settings before trying to publish.");
  }

  if (
    !forceRefresh &&
    session.accessToken &&
    session.expiresAt &&
    Date.parse(session.expiresAt) - 60_000 > Date.now()
  ) {
    return session.accessToken;
  }

  const refreshedTokenResponse = await refreshYouTubeAccessToken(session.refreshToken);
  const accessToken = refreshedTokenResponse.access_token?.trim();
  if (!accessToken) {
    throw new Error("Google returned an invalid access token while refreshing the YouTube session.");
  }

  setStoredYouTubeSession({
    ...session,
    accessToken,
    refreshToken: refreshedTokenResponse.refresh_token?.trim() || session.refreshToken,
    expiresAt: getAccessTokenExpiryTimestamp(refreshedTokenResponse.expires_in),
    scopes: normalizeScopes(refreshedTokenResponse.scope, session.scopes)
  });

  return accessToken;
}

async function refreshYouTubeAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId = getSavedYouTubeClientId();
  if (!clientId) {
    throw new Error("The saved Google OAuth client ID is missing.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const clientSecret = getSavedYouTubeClientSecret();
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    clearStoredYouTubeSession();
    throw new Error(
      await buildGoogleApiError(response, "Google rejected the saved YouTube refresh token")
    );
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function createYouTubeResumableUploadSession(input: {
  title: string;
  description: string;
  tags: string[];
  language: string;
  publishStatus: Record<string, string>;
  filePath: string;
  fileSizeBytes: number;
}): Promise<string> {
  const url = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet,status");

  const response = await fetchYouTube(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(input.fileSizeBytes),
      "X-Upload-Content-Type": guessMimeType(input.filePath)
    },
    body: JSON.stringify({
      snippet: {
        title: input.title,
        description: input.description,
        tags: input.tags.length > 0 ? input.tags : undefined,
        defaultLanguage: input.language,
        defaultAudioLanguage: input.language
      },
      status: input.publishStatus
    })
  });

  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return a resumable upload URL.");
  }

  return uploadUrl;
}

async function uploadBinaryToYouTube(
  uploadUrl: string,
  filePath: string,
  fileSizeBytes: number
): Promise<YouTubeVideoInsertResponse> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(fileSizeBytes),
      "Content-Type": guessMimeType(filePath)
    },
    body: createReadStream(filePath),
    duplex: "half"
  } as RequestInit & { duplex: "half" });

  if (!response.ok) {
    throw new Error(await buildGoogleApiError(response, "YouTube rejected the video upload"));
  }

  return (await response.json()) as YouTubeVideoInsertResponse;
}

async function addVideoToYouTubePlaylist(videoId: string, playlistId: string): Promise<void> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");

  await fetchYouTube(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId
        }
      }
    })
  });
}

function buildYouTubeUploadStatus(publishDate: Date): Record<string, string> {
  if (publishDate.getTime() > Date.now()) {
    return {
      privacyStatus: "private",
      publishAt: publishDate.toISOString()
    };
  }

  return {
    privacyStatus: "public"
  };
}

function guessMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".webm":
      return "video/webm";
    case ".m4v":
      return "video/x-m4v";
    default:
      return "video/mp4";
  }
}

function getAccessTokenExpiryTimestamp(expiresInSeconds: number | undefined): string | null {
  if (!expiresInSeconds || !Number.isFinite(expiresInSeconds)) {
    return null;
  }

  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function normalizeScopes(scopeValue: string | undefined, fallbackScopes: string[]): string[] {
  const parsedScopes = (scopeValue ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (parsedScopes.length > 0) {
    return [...new Set(parsedScopes)];
  }

  return [...new Set(fallbackScopes)];
}

function normalizeOwnedChannelVideoRecords(
  items: NonNullable<YouTubeVideoListResponse["items"]>
): YouTubeOwnedChannelVideoRecord[] {
  return items
    .map((item) => {
      const videoId = item.id?.trim();
      const title = item.snippet?.title?.trim();
      const channelTitle = item.snippet?.channelTitle?.trim();
      const publishedAt = item.snippet?.publishedAt?.trim();
      if (!videoId || !title || !channelTitle || !publishedAt) {
        return null;
      }

      return {
        videoId,
        title,
        channelTitle,
        publishedAt,
        durationSeconds: parseIsoDurationSeconds(item.contentDetails?.duration ?? null),
        thumbnailUrl:
          item.snippet?.thumbnails?.high?.url?.trim() ??
          item.snippet?.thumbnails?.medium?.url?.trim() ??
          item.snippet?.thumbnails?.default?.url?.trim() ??
          null,
        tags: Array.isArray(item.snippet?.tags)
          ? item.snippet.tags.map((tag) => tag.trim()).filter(Boolean)
          : [],
        viewCount: readNumericString(item.statistics?.viewCount),
        likeCount: readNumericString(item.statistics?.likeCount),
        commentCount: readNumericString(item.statistics?.commentCount)
      };
    })
    .filter((item): item is YouTubeOwnedChannelVideoRecord => item !== null);
}

function normalizeManagedYouTubeVideoRecords(
  items: NonNullable<YouTubeVideoListResponse["items"]>,
  responseRevision: string | null
): YouTubeManagedVideoRecord[] {
  return items
    .map((item) => {
      const videoId = item.id?.trim();
      const title = item.snippet?.title?.trim();
      const channelTitle = item.snippet?.channelTitle?.trim();
      const publishedAt = item.snippet?.publishedAt?.trim();
      if (!videoId || !title || !channelTitle || !publishedAt) {
        return null;
      }

      const tags = Array.isArray(item.snippet?.tags)
        ? item.snippet.tags.map((tag) => tag.trim()).filter(Boolean)
        : [];
      const categoryId = item.snippet?.categoryId?.trim() ?? "";
      const privacyStatus = item.status?.privacyStatus === "public" || item.status?.privacyStatus === "unlisted"
        ? item.status.privacyStatus
        : "private";
      const remoteRevision = item.etag?.trim() ?? responseRevision ?? buildManagedVideoRevision({
        videoId,
        title,
        description: item.snippet?.description?.trim() ?? "",
        tags,
        categoryId,
        privacyStatus,
        publishAt: item.status?.publishAt?.trim() ?? null
      });

      const normalized: YouTubeManagedVideoRecord = {
        videoId,
        channelId: item.snippet?.channelId?.trim() ?? null,
        channelTitle,
        title,
        description: item.snippet?.description?.trim() ?? "",
        tags,
        categoryId,
        publishedAt,
        privacyStatus,
        publishAt: item.status?.publishAt?.trim() ?? null,
        durationSeconds: parseIsoDurationSeconds(item.contentDetails?.duration ?? null),
        thumbnailUrl:
          item.snippet?.thumbnails?.high?.url?.trim() ??
          item.snippet?.thumbnails?.medium?.url?.trim() ??
          item.snippet?.thumbnails?.default?.url?.trim() ??
          null,
        viewCount: readNumericString(item.statistics?.viewCount),
        likeCount: readNumericString(item.statistics?.likeCount),
        commentCount: readNumericString(item.statistics?.commentCount),
        linkedClipId: null,
        linkedScheduledPostId: null,
        fetchedAt: new Date().toISOString(),
        remoteRevision
      };
      return normalized;
    })
    .filter((item): item is YouTubeManagedVideoRecord => item !== null);
}

function buildManagedVideoRevision(input: {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: string;
  publishAt: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function buildAnalyticsIndexMap(response: YouTubeAnalyticsReportResponse): Map<string, number> {
  const metricIndexByName = new Map<string, number>();
  for (const [index, header] of (response.columnHeaders ?? []).entries()) {
    if (header.name) {
      metricIndexByName.set(header.name, index);
    }
  }

  return metricIndexByName;
}

function readNumericString(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseIsoDurationSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/i.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function readStringAnalyticsMetric(
  row: Array<number | string>,
  metricIndexByName: Map<string, number>,
  metricName: string
): string | null {
  const index = metricIndexByName.get(metricName);
  if (index === undefined) {
    return null;
  }

  const value = row[index];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumericAnalyticsMetric(
  row: Array<number | string>,
  metricIndexByName: Map<string, number>,
  metricName: string
): number | null {
  const index = metricIndexByName.get(metricName);
  if (index === undefined) {
    return null;
  }

  const value = row[index];
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
}

function normalizePublishedAfterDate(value: string): string {
  const normalizedValue = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? normalizedValue
    : DEFAULT_YOUTUBE_ANALYTICS_START_DATE;
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function buildGoogleApiError(response: Response, fallbackMessage: string): Promise<string> {
  const responseBody = await response.text();
  const rawBody = responseBody.trim();

  try {
    const json = JSON.parse(rawBody) as {
      error?: {
        message?: string;
        errors?: Array<{
          reason?: string;
          message?: string;
        }>;
      };
    };

    const detail = json.error?.message?.trim();
    const reason = json.error?.errors
      ?.map((item) => item.reason?.trim())
      .find((value): value is string => Boolean(value));
    if (detail) {
      return `${fallbackMessage}: ${detail}${reason ? ` (${reason})` : ""}`;
    }

    if (reason) {
      return `${fallbackMessage}: ${reason}`;
    }
  } catch {
    if (rawBody) {
      return `${fallbackMessage}: ${rawBody}`;
    }
  }

  return `${fallbackMessage}: ${response.status} ${response.statusText}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<void>
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(async () => {
          await onTimeout();
          reject(new Error("Timed out waiting for the YouTube sign-in to finish."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
