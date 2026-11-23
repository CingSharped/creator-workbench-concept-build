# Video Platform Upload And Scheduling API Review

As of 2026-07-18.

This document reviews the current state of official APIs for uploading and scheduling video content across major creator platforms. It is focused on what can be built with public or semi-public developer surfaces today, what requires app registration or approval, and where scheduling is native versus something your own system must implement.

## Reading Notes

- `Confirmed` means the capability is explicitly described in current official docs or official platform-maintained Postman workspaces.
- `Inferred` means the docs describe the publish flow, but I did not find an explicit scheduler field or explicit support statement, so the conclusion is based on what is present and absent in the current public documentation.
- `App-side scheduling` means your system stores the schedule and calls the platform's publish endpoint at runtime.
- `Native scheduling` means the platform accepts a future publish time or equivalent scheduled state directly in its API.

## Executive Summary

- `YouTube` is the clearest fit for true native scheduled publishing of prerecorded videos.
- `TikTok`, `Instagram`, `Threads`, `Pinterest`, `LinkedIn`, `X`, and `Bluesky` all support posting video in some form, but current public docs do not show a first-class future publish timestamp for standard organic posts. For these, scheduling is generally your responsibility.
- `Facebook Pages / Reels` looks better than most non-YouTube platforms for native scheduling, because Meta's official Facebook Postman collection exposes Reel publishing states including `SCHEDULED`. However, I did not confirm the exact timestamp parameter from the sources I found.
- `Snapchat Public Profile API` supports official posting workflows for Public Profiles, including media upload and content management, but access is allowlist-only and more operationally involved than most platforms.
- `Twitch` and `Kick` remain live-first from a creator tooling perspective. Twitch supports stream scheduling, clips, and VOD management, but not a general prerecorded upload flow for creators. I did not find a public prerecorded upload/publish API for Kick.

## Capability Matrix

| Platform | Organic video upload API | Native future scheduling | Requirements to use | Notes |
| --- | --- | --- | --- | --- |
| YouTube | Yes | Yes, confirmed | Google Cloud project, YouTube Data API, OAuth 2.0 | Best official scheduler for standard uploaded video |
| TikTok | Yes | No public scheduler field found, inferred | TikTok app, Content Posting API product, OAuth, `video.publish` or `video.upload`, audit for public posting | Direct post is tightly governed; draft/upload flow also available |
| Instagram | Yes | No public scheduler field found, inferred | Meta app, IG Professional account; either Facebook Login or Instagram Login; publish scopes | Business/Creator only, not consumer accounts |
| Facebook Pages / Reels | Yes | Partial yes, confirmed at state level | Meta app, Page access token, Page permissions/tasks | Official collection shows `DRAFT`, `SCHEDULED`, `PUBLISHED` for Reels |
| Snapchat Public Profiles | Yes | No public scheduler field found, inferred | Snap business setup, OAuth app, allowlisting for Public Profile API | Strong posting surface, but gated |
| Threads | Yes | No public scheduler field found, inferred | Meta app with Threads use case, OAuth, `threads_content_publish` | Container expires if not published within 24 hours |
| Pinterest | Yes | No public scheduler field found, inferred | Pinterest app, Trial or Standard access, OAuth scopes | Good video Pin support; scheduling is app-side |
| X | Yes | No public scheduler field found, inferred | Approved developer account, Project/App, OAuth user tokens | Video upload exists; scheduling appears app-side |
| LinkedIn | Yes | No public scheduler field found, inferred | LinkedIn app, auth product/scopes, possibly Community Management review for org use | Good for business repurposing, not a strong scheduler |
| Bluesky | Yes | No public scheduler field found, inferred | Bluesky account auth via session/app password today; OAuth direction is evolving | Video upload works; scheduling is app-side |
| Twitch | No general prerecorded creator upload found | Yes for live stream schedule only | Twitch app, OAuth scopes such as `channel:manage:schedule` | Useful for live scheduling, not standard VOD publishing |
| Kick | I did not find one | I did not find one | Kick developer account/app | Public docs currently look live/chat/moderation oriented |

## Platform Reviews

### YouTube

Status:
- `Confirmed`: standard video upload via `videos.insert`
- `Confirmed`: native scheduled publish via `status.publishAt`
- `Confirmed`: live events can be scheduled separately via `liveBroadcasts.insert` and `snippet.scheduledStartTime`

What works now:
- Upload a video with metadata.
- Keep it private.
- Set `status.publishAt` to a future ISO 8601 timestamp.
- Poll video status and processing details with `videos.list`.

Requirements:
- Create a Google Cloud project.
- Enable the YouTube Data API.
- Use OAuth 2.0 for channel authorization.

Key restrictions:
- `Confirmed`: videos uploaded by unverified API projects created after July 28, 2020 are private-only until the project passes audit.

Assessment:
- Best official surface for a true scheduler for prerecorded video.

### TikTok

Status:
- `Confirmed`: video draft upload flow via `video.upload`
- `Confirmed`: direct post flow via `video.publish`
- `Inferred`: no public future-publish field in the current Direct Post request schema

What works now:
- Direct post to TikTok with creator-chosen metadata and privacy options.
- Upload without posting, so the creator finishes in TikTok's inbox flow.
- Fetch creator posting options with `creator_info/query`.
- Track post status with `publish/status/fetch` or webhooks.

Requirements:
- Register a TikTok developer app.
- Add the Content Posting API product.
- Use TikTok OAuth v2 for user authorization.
- Request `video.publish` for direct posting or `video.upload` for draft delivery.
- Expect audit if you need public posting behavior at scale.

Key restrictions:
- `Confirmed`: unaudited direct-post clients are private-only and capped.
- `Confirmed`: TikTok's content sharing guidelines say a utility tool used only to upload to accounts you or your team manage is not an acceptable intended use for approval.
- `Confirmed`: `FILE_UPLOAD` upload URLs are valid for one hour.
- `Confirmed`: if you already host media server-side, TikTok expects `PULL_FROM_URL` and verified URL ownership.

Assessment:
- Good official post surface, but not a friendly platform for a private internal scheduler.
- For most products, treat TikTok as `app-side scheduling` or `draft handoff`, not `platform-native scheduling`.

### Instagram

Status:
- `Confirmed`: video publishing exists for Professional accounts
- `Confirmed`: Reels publishing is documented in Meta's official Instagram workspace
- `Inferred`: no public future-publish field found in current organic publishing docs

What works now:
- Create an IG media container and publish it.
- Publish Reels from a public `video_url`.
- Publish content for Business and Creator accounts.
- Use either Facebook-linked or Instagram-native login paths depending your app setup.

Requirements:
- Meta app.
- Instagram Professional account.
- For `Instagram API with Facebook Login`: linked Facebook Page, Page/user tokens, scopes such as `instagram_content_publish`, `instagram_basic`, `pages_show_list`, `pages_read_engagement`.
- For `Instagram API with Instagram Login`: use the newer `instagram_business_*` scopes.

Key restrictions:
- `Confirmed`: no consumer-account support.
- `Confirmed`: Stories publishing is only available to business accounts.
- `Confirmed`: the newer Instagram Login path does not require a linked Facebook Page.
- `Confirmed`: old `business_*` scope values were deprecated on January 27, 2025 in favor of `instagram_business_*`.

Assessment:
- Strong publish surface for creator/business accounts.
- Scheduling should be treated as `app-side scheduling` unless Meta documents a future-publish field for your exact publishing path.

### Facebook Pages / Reels

Status:
- `Confirmed`: Reel upload and publish flow exists for Facebook Pages
- `Confirmed`: official Meta Facebook collection exposes `video_state` values `DRAFT`, `SCHEDULED`, and `PUBLISHED`
- `Inferred`: exact timestamp parameter for scheduled publication was not confirmed from the sources I found

What works now:
- Start a Reel upload session.
- Upload from local binary or hosted URL.
- Poll status.
- Finish publish with state controls.

Requirements:
- Meta app.
- User access token to fetch the Page access token.
- Page access token with appropriate Page tasks/permissions.

Key restrictions:
- Public docs surfaced through the official Postman workspace are less explicit than YouTube about exact scheduling mechanics.
- This is likely a platform that needs a proof-of-concept before you commit product behavior around exact publish times.

Assessment:
- More promising for native scheduling than Instagram proper.
- Worth considering if Facebook Pages are important to your workflow.

### Snapchat Public Profile API

Status:
- `Confirmed`: content management includes posting content on behalf of brands/creators
- `Confirmed`: media upload flow exists
- `Inferred`: no public future-publish scheduler found

What works now:
- Upload encrypted media containers.
- Manage Public Profile assets for Stories and Spotlights.
- Use authorized endpoints for profile-owned content management.

Requirements:
- Snap business account and organization setup.
- OAuth app created through Snap business flows.
- `Confirmed`: the Public Profile API is allowlist-only.
- `Confirmed`: Snap instructs developers not to create the OAuth app for this API in the generic Developer Portal; use Business Dashboard flow instead.

Key restrictions:
- More operational setup than most platforms.
- Media handling is heavier than most platforms because the media upload flow includes encryption and chunking details.
- Public Profile media objects stay active for 24 hours after creation.

Assessment:
- Real publishing surface, but not lightweight.
- Good candidate only if Snapchat Public Profiles are strategically important.

### Threads

Status:
- `Confirmed`: create text/image/video containers and publish them
- `Inferred`: no native future scheduling field found

What works now:
- Create a video container with a public `video_url`.
- Publish it with `threads_publish`.
- Poll container state.

Requirements:
- Meta app with the Threads use case.
- OAuth 2.0.
- Scope such as `threads_content_publish`.

Key restrictions:
- `Confirmed`: the video must be hosted on a public server because Threads fetches it from your URL.
- `Confirmed`: containers expire if not published within 24 hours.

Assessment:
- Good cross-post target.
- Scheduling belongs in your own queueing system.

### Pinterest

Status:
- `Confirmed`: image and video Pins can be created
- `Inferred`: no native future scheduling field found

What works now:
- Register a media upload.
- Upload the video to the Pinterest media bucket.
- Poll media processing.
- Create a video Pin using the resulting `media_id` plus a `cover_image_url`.

Requirements:
- Pinterest business account.
- Register an app and request Trial access.
- OAuth scopes such as `boards:read`, `boards:write`, `pins:read`, `pins:write`.
- Upgrade to Standard access for production-grade behavior.

Key restrictions:
- `Confirmed`: Trial access-created Pins are visible only to the creator.
- `Confirmed`: Pinterest requires a demo video to upgrade to Standard access, even for single-user apps.
- `Confirmed`: a valid `cover_image_url` is required for video Pin creation.

Assessment:
- Better than many teams expect for evergreen video distribution.
- Scheduling is `app-side scheduling`.

### X

Status:
- `Confirmed`: create posts with media
- `Confirmed`: video upload is supported through media flows, especially chunked upload
- `Inferred`: no public future scheduling field found in current Manage Posts docs

What works now:
- Upload media.
- Attach media IDs to a new post.
- Use chunked upload for video and larger media.

Requirements:
- Approved X developer account.
- Project and App in the developer console.
- User access token via OAuth 2.0 PKCE or 3-legged OAuth.

Key restrictions:
- X's current docs are oriented around immediate posting, not first-class scheduling.
- Good for teaser clips and distribution, not usually a primary long-form video destination.

Assessment:
- Fine as a secondary cross-post target.
- Scheduling is `app-side scheduling`.

### LinkedIn

Status:
- `Confirmed`: upload video via Videos API
- `Confirmed`: create organic posts that reference uploaded videos
- `Inferred`: no public future publish field found for organic posts

What works now:
- Initialize upload with `rest/videos?action=initializeUpload`.
- Upload the video.
- Create a post referencing the returned video URN.

Requirements:
- LinkedIn app.
- Appropriate products/scopes:
  - `w_member_social` for member posting.
  - `w_organization_social` for organization posting.
- For broader Community Management use, expect app review and tiered access.

Key restrictions:
- `Confirmed`: current organic post examples use `lifecycleState: PUBLISHED`.
- `Confirmed`: Community Management app review requires verified organization details and approved use case.

Assessment:
- Good for B2B and brand repurposing.
- Not a native organic scheduler from the public docs I found.

### Bluesky

Status:
- `Confirmed`: create posts through AT Protocol APIs
- `Confirmed`: upload video is supported
- `Inferred`: no native scheduling surface

What works now:
- Create a session and post records directly.
- Upload video either as a blob or through the dedicated video service.
- Poll video processing if using the recommended video service flow.

Requirements:
- Bluesky account credentials today.
- `Confirmed`: current getting-started docs still document `createSession`.
- `Confirmed`: OAuth for AT Protocol is the stated direction of travel.

Key restrictions:
- `Confirmed`: Bluesky-hosted accounts must have verified email before uploading video.
- `Confirmed`: account-level limits exist for number of video posts per day.

Assessment:
- Useful if you want coverage on an emerging network with open-ish infrastructure.
- Scheduling is entirely app-side.

### Twitch

Status:
- `Confirmed`: stream schedule APIs exist
- `Confirmed`: clip APIs and VOD management exist
- `Inferred`: no general prerecorded creator upload API found

What works now:
- Manage channel stream schedule.
- Create clips, including from VODs.
- Read and delete videos.

Requirements:
- Twitch developer app.
- OAuth scopes like `channel:manage:schedule` or `channel:manage:clips` depending the workflow.

Key restrictions:
- Twitch is optimized for live broadcasting and clips, not cross-platform scheduled prerecorded uploads.

Assessment:
- Treat as a separate live-content workflow, not part of the same abstraction as YouTube/TikTok/Instagram uploads.

### Kick

Status:
- `Confirmed`: public developer program and docs exist
- `Inferred`: I did not find public prerecorded upload or scheduling endpoints in current public docs

What works now:
- Public API and developer agreement are live.
- Current docs and roadmap material appear centered on livestream, community, chat, moderation, events, and related integrations.

Requirements:
- Kick developer account/app registration.

Key restrictions:
- Based on current public materials, Kick does not yet look like a standard prerecorded social publishing API target.

Assessment:
- Keep on the watchlist, but do not design an MVP around Kick prerecorded publishing yet.

## Recommended Product Model

If you build a cross-platform scheduler, model each platform adapter as one of these modes:

1. `NATIVE_SCHEDULED_PUBLISH`
   - Example: YouTube
2. `APP_SIDE_PUBLISH_AT_RUNTIME`
   - Examples: TikTok, Instagram, Threads, Pinterest, X, LinkedIn, Bluesky
3. `DRAFT_HANDOFF`
   - Example: TikTok `video.upload`
4. `LIVE_SCHEDULE_ONLY`
   - Example: Twitch
5. `NOT_CURRENTLY_SUPPORTED`
   - Example: Kick prerecorded publishing, based on current public docs

This matters because token refresh, upload timing, retry behavior, and UX guarantees differ significantly across these modes.

## Best Platforms To Prioritize First

If the goal is a practical multi-platform scheduler in 2026, the strongest initial stack is:

1. `YouTube`
2. `TikTok`
3. `Instagram`
4. `Facebook Pages / Reels`
5. `Threads`
6. `Pinterest`

Then add:

7. `LinkedIn`
8. `X`
9. `Bluesky`

Keep separate:

10. `Snapchat` because access/setup is heavier
11. `Twitch` because it is live-first
12. `Kick` until prerecorded publishing surfaces exist

## References

### YouTube

- https://developers.google.com/youtube/v3/guides/uploading_a_video
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/docs/videos/update
- https://developers.google.com/youtube/v3/docs/videos/list
- https://developers.google.com/youtube/v3/live/docs/liveBroadcasts
- https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert

### TikTok

- https://developers.tiktok.com/products/content-posting-api/
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info/
- https://developers.tiktok.com/doc/content-sharing-guidelines/
- https://developers.tiktok.com/doc/oauth-user-access-token-management
- https://developers.tiktok.com/doc/login-kit-overview
- https://developers.tiktok.com/doc/webhooks-overview

### Instagram

- https://developers.facebook.com/docs/instagram-api/
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
- https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- https://www.postman.com/meta/instagram/request/23987686-299b176b-90aa-4d8a-b6cf-e6028fc69de5

### Facebook

- https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api
- https://www.postman.com/meta/facebook/request/juhnm3q/4-publish-reel

### Threads

- https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
- https://www.postman.com/meta/threads/request/mev9xf8/1-3-create-video-container
- https://www.postman.com/meta/threads/request/34203612-72c20362-5b0c-4f14-b9cd-4315ff91cd85

### Snapchat

- https://developers.snap.com/marketing-api/Public-Profile-API/Introduction
- https://developers.snap.com/marketing-api/Public-Profile-API/GetStarted
- https://developers.snap.com/marketing-api/Public-Profile-API/ProfileAssetManagement
- https://developers.snap.com/marketing-api/Public-Profile-API/Profiles

### Pinterest

- https://developer.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/
- https://developer.pinterest.com/docs/getting-started/connect-app/
- https://developer.pinterest.com/docs/key-concepts/access-tiers/
- https://developer.pinterest.com/docs/developer-tools/sandbox/
- https://developer.pinterest.com/docs/faqs/faqs/

### X

- https://docs.x.com/x-api/posts/manage-tweets/introduction
- https://docs.x.com/x-api/posts/manage-tweets/quickstart
- https://docs.x.com/x-api/media/introduction
- https://docs.x.com/x-api/media/upload-media
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked

### LinkedIn

- https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- https://learn.microsoft.com/de-at/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2

### Bluesky

- https://docs.bsky.app/docs/get-started
- https://docs.bsky.app/docs/tutorials/creating-a-post
- https://docs.bsky.app/docs/tutorials/video
- https://docs.bsky.app/blog/oauth-atproto

### Twitch

- https://dev.twitch.tv/docs/api/reference
- https://dev.twitch.tv/docs/api/videos
- https://dev.twitch.tv/docs/api/schedule
- https://dev.twitch.tv/docs/api/clips

### Kick

- https://help.kick.com/en/articles/8159966-kick-dev
- https://dev.kick.com/
- https://docs.kick.com
- https://github.com/KickEngineering/KickDevDocs

