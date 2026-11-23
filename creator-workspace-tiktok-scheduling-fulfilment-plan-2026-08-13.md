# Creator Workbench TikTok Scheduling and Fulfilment Plan

Status: deferred product plan. No TikTok behaviour changes are included in this document.

## Confirmed Current State

Creator Workbench currently stores a local TikTok draft/scheduled-post record with the selected clip, metadata snapshot, platform, account label, and requested publish time. It does not currently run a timer, upload to TikTok, publish, poll a remote status, or notify the user when that time arrives. A record should therefore be described as a local TikTok draft or planned handoff, not as a TikTok post that has been scheduled on the platform.

## Product Modes

### Mode A: TikTok draft handoff

At the requested time, or through an explicit user-triggered action, the app uploads the prepared video to TikTok's creator inbox/draft flow where the user completes TikTok's edit and posting steps. This is a handoff, not direct publishing. The UI should use `TikTok draft handoff`, show whether the file and token are ready, and never imply that TikTok will publish unattended.

### Mode B: TikTok direct-post scheduled

This mode requires TikTok Content Posting API product approval and a consented `video.publish` scope. The app must obtain creator information and the allowed posting options before enabling it, show the user exactly what will be posted and whether it is private or public, and require an explicit opt-in for direct posting. Public/non-private publishing needs an audit of product approval, user consent, review/testing restrictions, and any account or region limitations. The app then needs remote status polling or webhook handling so `uploaded`, `processing`, `posted`, and `failed` are not inferred from the local clock.

The two modes must remain separate in copy and settings. A local time alone must never be presented as proof that TikTok has a scheduled post.

## Local Scheduling Design

Use a durable local job record rather than an in-memory timer:

- Persist a unique fulfilment job, platform, mode, post ID, requested local time, UTC instant, timezone identifier, metadata snapshot, source path, file fingerprint, and consent/configuration snapshot.
- On startup, recover queued and running jobs. Mark interrupted work explicitly and apply a documented missed-job policy rather than silently posting late.
- When offline, retry with bounded exponential backoff and a visible next attempt. Do not retry permanent auth, scope, validation, or file errors indefinitely.
- Show a Windows notification/toast for due, waiting, failed, and completed work. Clicking it opens the relevant post and does not publish by itself.
- Prefer app-running fulfilment for the first phase. A Windows Task Scheduler/helper process could support work while the app is closed, but it adds installer, credential, versioning, cancellation, logging, and security responsibilities. It must be a separately consented option, not an implicit background service.
- No unattended TikTok direct post is allowed unless the user has explicitly enabled direct mode, accepted the scope/visibility policy, and configured the required account and consent state.

## Data and Failure Rules

- Store the requested time with both the user's timezone and UTC representation. Handle daylight-saving changes and display the local timezone at scheduling time.
- Treat access-token expiry, missing scopes, revoked consent, creator-info restrictions, upload processing, rate limits, missing files, moved files, and invalid media as separate actionable states.
- Snapshot the approved metadata at handoff/scheduling time so later edits do not silently change a queued post. Show the snapshot when reviewing a queued item.
- Keep remote upload IDs, draft/direct mode, attempts, response codes, retry times, and final status in an audit history.
- Preserve the local source and approved clip. Never overwrite the source during upload or retry.
- Make retry explicit after user-correctable errors. Use idempotency keys or a remote-ID check where the TikTok API supports it, so a network timeout does not create an untracked duplicate.

## Recommended Phased Path

### Phase 1: local fulfilment and draft handoff

Implement the durable queue and startup recovery first. Add a clear `TikTok draft handoff` action that checks file availability, metadata snapshot, auth/token state, and supported media constraints. Acceptance: a queued item survives restart, a missed item is shown for review, offline retries are bounded and visible, and no item is described as posted until a remote result exists.

### Phase 2: TikTok draft upload

After product/API access is confirmed, add the TikTok inbox/draft upload path. Acceptance: the user sees upload progress, remote draft/upload ID, a deep link or clear next action to finish in TikTok, expiry/retry state, and an audit record. The normal local schedule remains distinct from a platform-native TikTok schedule.

### Phase 3: direct-post scheduled mode

Only after Content Posting API approval and a consent UX review, add direct posting. Acceptance: creator info and publish options are checked before scheduling; `video.publish` consent and visibility are explicit; public posting is guarded; remote processing/status is polled or received by webhook; restart, token expiry, duplicate prevention, cancellation limits, and failures are visible and tested.

## Open Decisions

- Whether draft handoff should be user-triggered only or eligible for a local due-time prompt/upload.
- Whether the first background fulfilment version requires the app to remain open or may install a Windows Task Scheduler/helper component.
- Whether direct mode should allow public posting at all in the first release, or require private-only testing until approval and audit are complete.
- Notification wording and the missed-job policy: prompt immediately, reschedule, or mark for review.

## Official References

- [TikTok Content Posting API overview](https://developers.tiktok.com/products/content-posting-api)
- [Content Posting API getting started](https://developers.tiktok.com/doc/content-posting-api-get-started)
- [Upload Video API reference](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video)
- [Direct Post API reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post?enter_method=left_navigation)
- [Media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
- [Content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/)
