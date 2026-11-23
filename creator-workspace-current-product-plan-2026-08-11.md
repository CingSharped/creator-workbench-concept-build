# Creator Workbench Current Product Plan And MVP Closure

Status: Historical product and invited-beta plan.

**November 2026 concept closeout.** Creator Workbench is preserved as a portfolio proof of concept. The build demonstrates the local recording-to-reviewed-YouTube-clip workflow. The invited beta, local image generation, burned-in subtitles, and remaining release gates below describe the earlier plan. A future Creator Workbench 2.0 would be scoped and developed separately.

Last reconciled: 2026-09-21 (documentation and source review; release acceptance remains open)

This plan reconciled the September 2026 implementation with the earlier roadmaps, workflow specifications, UI plans, and ADRs.

This document is the current product baseline. Newer accepted ADRs override the specific decisions they supersede; reconcile this baseline in the same change. Implementation references describe observed behavior, not permission to change accepted scope. Archived plans and research do not override the baseline or accepted ADRs. See [documentation reconciliation](docs/documentation-reconciliation.md) for known gaps and pending decisions.

## 1. Product Baseline

Creator Workbench is a Windows-first, single-user, local-first desktop application for turning long-form and existing local video into reviewed, publishable YouTube content.

The core product promise is:

`Make a clip -> Edit and package it -> Review performance and improve the next one.`

The primary navigation is intentionally small:

1. `Make`: import long-form sources, find reviewable clip moments, and approve or reject proposals.
2. `Edit`: review clips, correct transcripts and speakers, generate metadata, save packages, and schedule or publish.
3. `Performance`: inspect owned YouTube results and local AI takeaways.
4. `Settings`: configure folders, local runtimes and models, AI profiles, people, and YouTube access.

Product principles:

- Local-first for media, transcription, rendering, AI models, and cached performance data.
- Review-first for clip selection, metadata, and publishing.
- Original media is never overwritten by a trim, vertical export, or proposal decision.
- AI must show whether it succeeded, fell back, or was blocked by Strict AI mode.
- External platform pulls are explicit user actions, not timers.
- YouTube is the only first-class external publishing target in the current MVP.

## 1.1 Deferred TikTok Scheduling And Fulfilment Plan

This is a future plan only. It does not change the current TikTok behavior: today Creator Workbench stores a local TikTok draft-handoff record and does not run a timer, send an OS notification, upload media, or publish automatically.

### Product modes

1. **TikTok draft handoff**: at a user-triggered action, or later through a local scheduled handoff, upload the approved video to the user's TikTok inbox. The user then opens TikTok, completes any editing and posting steps, and remains the final publisher. The UI must call this `TikTok draft handoff`, not `scheduled post`, because the app cannot guarantee publication.
2. **TikTok direct-post scheduled**: after the user has explicitly enabled Direct Post, granted `video.publish`, reviewed creator-specific settings, and consented to the exact post, initialize and upload through TikTok's Direct Post API. The UI may call this `TikTok direct-post scheduled` only when the app has a durable local schedule and a supported fulfilment path; it must not imply unattended publication without the required configuration.

TikTok's official [Content Posting API overview](https://developers.tiktok.com/products/content-posting-api) describes both direct posting and uploading a draft for the creator to finish in TikTok. The official [Upload Video reference](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video) requires `video.upload`, returns a `publish_id` for status tracking, and says the creator must use the TikTok inbox notification to continue the editing flow. The official [Direct Post guide](https://developers.tiktok.com/doc/content-posting-api-get-started) requires Content Posting API Direct Post configuration and the `video.publish` scope; unaudited clients are restricted to private visibility until audit. The [Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post?enter_method=left_navigation) also requires querying creator information and collecting the necessary metadata and explicit consent before initialization.

### Local scheduling and fulfilment architecture

- Persist a durable local job record containing platform, mode, post ID, clip path, immutable metadata snapshot, intended local publish time, timezone/offset, token/session reference (never the token itself), and audit timestamps.
- On startup, recover queued jobs and apply an explicit missed-job policy: show `missed`, `ready to retry`, or `expired` rather than silently posting. A job must verify that the source/export file still exists, the metadata snapshot is complete, and the OAuth token is valid before doing external work.
- While offline or rate-limited, retry with bounded exponential backoff and a visible attempt history. Do not retry indefinitely or create duplicate uploads; persist remote `publish_id`/video ID before continuing.
- Notify through an in-app toast/activity entry and, if enabled, a Windows notification that opens the relevant post. Notification delivery is a reminder, not proof that TikTok accepted or published the post.
- Keep the first version app-running-only. A Windows Task Scheduler/helper process could support fulfilment while the app is closed, but it adds installation, ownership, credential, update, and shutdown complexity and must be a deliberate later choice. No unattended post is allowed unless the user has explicitly enabled a configured Direct Post mode.
- Poll TikTok status using the returned publish ID where the selected mode supports it; add webhook handling only if TikTok provides an appropriate supported callback path for the approved integration. Persist `uploaded`, `inbox_pending`, `posted`, `private`, `failed`, `expired`, and `needs_user_action` separately from the local schedule state.

### Phased recommendation

**Phase 1: draft handoff.** Add TikTok OAuth/account connection, file upload, durable `publish_id`, status fetch, and a clear `Open TikTok to finish` action. Acceptance: the app never claims the post is published; restart, offline retry, token expiry, missing file, and upload failure are recoverable and visible; the user can find the draft in TikTok's inbox.

**Phase 2: direct-post readiness.** Add creator-info/query before the consent screen, privacy and interaction settings, explicit consent showing the exact video/metadata/account, `video.publish` authorization, and an audit-safe private-only test mode. Acceptance: a user cannot invoke Direct Post without the required scope and settings; unaudited/private restrictions are visible; remote status is persisted and duplicate initialization is prevented.

**Phase 3: scheduled direct post.** Add the local durable queue, startup recovery, missed-job policy, bounded retry/backoff, notification deep-link, and app-running-only execution. Revisit Task Scheduler/helper support only after real-life testing. Acceptance: the app never silently posts after a missed or ambiguous job, every external attempt has an audit record, timezones are shown explicitly, and failed/expired/token/file errors have a user action.

Operational details to preserve in every phase: local timestamps plus original timezone/offset, token expiry and reconnect state, source/export file availability, a frozen metadata snapshot, remote IDs, retry count/backoff, error reason, user consent, and a human-readable audit log. Use the official [media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide) for chunk/file limits and the [Content Posting API guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/) for audit, privacy, and content-sharing constraints.

## 2. Current Workflow

### Make

1. Select or import a long-form source from the separate source library.
2. Prepare or re-run a canonical timed transcript with visible phase, progress, ETA basis, cancellation, and recovery state.
3. Review transcript text and speaker assignments, including saved creator/collaborator voice samples.
4. Generate transcript-led clip proposals with the assigned Clip Discovery profile.
5. Enrich the strongest proposals with audio, scene, and sampled-frame visual evidence when the app-owned VLM pair is available.
6. Open a proposal directly into the shared player, preview its range, correct transcript text/timing, trim non-destructively, and choose source or stacked vertical output.
7. Approve or reject with optional reason. Approval renders a new file into the existing clip library and preserves source/time-range lineage. Rejection renders nothing and can be reopened.

The VLM path analyses extracted timestamped frames plus narrow transcript context. It does not send raw video to a model or claim full video understanding.

### Edit

1. Select an indexed clip from the clip library.
2. Review the shared video player in source view, with transcript and speaker review beside it.
3. Re-run transcription when needed; edit text, timing, and speakers through the canonical transcript save path, which regenerates SRT.
4. Generate grouped YouTube metadata candidates: title, description, and one consolidated tag set.
5. Select or edit candidates, review the YouTube readiness score, and save one metadata package.
6. Schedule or publish to YouTube using the saved package, optional playlists, and YouTube native `publishAt` scheduling.

### Performance

1. Adjust local filters without contacting YouTube.
2. Explicitly refresh owned YouTube performance data.
3. Explicitly import owned channel history from a selected date, currently defaulting to 2025-01-01.
4. Review cached provenance, stale state, and API errors before using the data.
5. Review owned-video metadata suggestions and single or bulk updates, and generate/select thumbnail candidates. These are accepted version-one scope; current thumbnail tooling does not yet provide actual image generation. Connected-account acceptance remains required.

### Settings

- Clip library and long-form source folder selection.
- FFmpeg and Whisper runtime/model selection, including CPU/CUDA status.
- App-owned llama.cpp runtime and GGUF model inventory.
- AI profile task assignments, preferred models, task knowledge, and Strict AI mode.
- Creator/collaborator profiles and voice samples.
- YouTube OAuth connection, playlists, connection status, and credential clearing.

## 3. MVP Status

| Capability | Current status | MVP position |
| --- | --- | --- |
| Local clip import and indexing | Implemented with JSON-backed local persistence and safe source-preserving removal | In |
| Long-form source intake | Implemented with separate source library and lineage-aware proposals | In |
| Local transcription | Implemented with whisper.cpp CPU/CUDA selection, progress, ETA guidance, cancellation, and honest partial recovery | In |
| Transcript and SRT editing | Implemented through a shared timestamped transcript component | In |
| Speaker review and voice samples | Implemented with manual assignment, scoped auto-assignment, confidence, and review states | In |
| Transcript-led clip proposals | Implemented with review-first approval/rejection, trim, preview, and reopen | In |
| Audio/scene/VLM proposal evidence | Implemented as bounded enrichment with explicit unavailable/fallback warnings | In, needs extended quality testing |
| Source and stacked vertical export | Implemented as non-destructive new-file export with saved layout preferences | In |
| YouTube metadata candidates | Implemented as one grouped AI task with explicit AI/fallback/Strict AI reporting | In |
| YouTube readiness and package save | Implemented | In |
| YouTube upload, native scheduling, and automatic canonical SRT captions | Implemented with non-blocking caption status/retry handling; needs extended real-account testing | In, needs extended testing |
| YouTube performance and owned-channel analytics | Implemented with manual-only refresh and local cache | In |
| Historical YouTube import | Implemented with a selected start date and bounded import | In |
| Owned-video library and post-publish metadata editing | Core workflow implemented; reliability, context grounding and connected-account acceptance pending | Required for two-tester beta |
| Local AI thumbnail generation and YouTube application | Candidate storage/application exist; actual image generation and custom prompt missing | Required for two-tester beta |
| Burned-in subtitle export | Planned; implementation and packaged FFmpeg acceptance pending | Required for two-tester beta |
| AI profiles and task assignments | Implemented for metadata, thumbnail, performance coach, and clip discovery | In |
| App action catalogue | Implemented for core Make, Edit, Performance, and scheduling actions | In, expand only when a real function is wired |
| OAuth credential protection | Implemented with Windows user-level safeStorage encryption and plaintext migration cleanup | In, security hardening remains |
| Final UI/UX polish | Active tuning and extended real-life testing | Release-candidate work |

The earlier baseline supported extended real-life testing. The accepted version-one scope now requires the three feature areas below to reach a working, verified state before the two-tester beta. Feature completion and production hardening are separate claims.

### 3.1 Final version-one features for the two-tester beta

Accepted 2026-09-23; see [ADR-0010](docs/adr/ADR-0010-version-one-beta-feature-scope.md). These are the final feature additions/completion work before the invited beta, alongside release-critical fixes. Electron remains the desktop shell. Version one names the product milestone; the package version and release tag are still to be selected.

#### Owned-video editing

The existing feature set broadly matches the intended product: AI suggestions for titles, descriptions and other supported editable YouTube metadata, local reviewable drafts, and single/bulk changes. Finish gaps rather than redesign this section. Current editable fields are title, description, tags and category ID; audit any additional requested API-editable fields explicitly rather than claiming all metadata is supported.

Current implementation includes cached discovery/filtering, draft persistence, single updates, bulk preview/confirmation, and per-video processing with revision comparisons. AI generation currently receives remote title/description/tags rather than the richer local transcript, performance and feedback context. Bulk changes support shared field changes and tag replacement/addition/removal.

Completion criteria:
- Ground suggestions in relevant available local clip/context evidence, with provenance and missing-context behavior visible; retain review before applying remote changes.
- Protect unsaved drafts during navigation and guard asynchronous responses against changing the wrong selected video/session.
- Reconcile persisted drafts after successful updates; show per-video success, failure, conflict and skipped outcomes for bulk operations.
- Handle remote-write success followed by refresh failure without inviting blind duplicate retries. Preserve useful operation history/reconciliation evidence; remote revision checks are not an atomic concurrency guarantee.
- Verify supported fields, permissions, conflicts, partial failure and retry behavior on a connected owned channel. No autonomous metadata publishing.

#### Local AI thumbnail generation

Required experience: generate several genuinely different images locally, show candidate previews, allow selection, and explicitly apply the chosen image through the YouTube API where supported. Also make the selected JPEG available locally. Generation or selection alone must never change a remote thumbnail.

Add an optional custom description prompt. Its explicit creative intent has highest priority. Relevant local context, canonical clip/transcript information, current video metadata and sampled video frames support that intent, especially for videos created in the app. Without a custom prompt, derive candidates from the available evidence. Context/feedback is evidence, not authority to override the user's creative request. The thumbnail AI profile supplies reusable thumbnail guidance and consistent output constraints. Saved profile/prompt/model changes still require approval under ADR-0009.

JPEG is the accepted output format. Default candidate count remains open (three proposed). YouTube guidance checked 2026-09-23 recommends 3840 x 2160 / 16:9 for videos and 2160 x 3840 / 9:16 for Shorts, minimum width/height respectively 640 pixels, JPG or PNG, and a desktop upload limit of 50 MB. The thumbnails.set API also documents a 50 MB maximum. This corrects the earlier 1280 x 720 proposal. Recommend format-aware JPEG export at these dimensions, with generation resolution/upscaling chosen for hardware and quality; this recommendation is not yet an accepted fixed generation resolution. Enforce encoding, dimensions and file validation after generation rather than trusting a model instruction. Explain incompatible requests or unavailable capabilities rather than silently discarding the prompt.

Sources: [YouTube thumbnail guidance](https://support.google.com/youtube/answer/72431?co=GENIE.Platform%3DDesktop&hl=en), [API upload constraints](https://developers.google.com/youtube/v3/docs/thumbnails/set). Studio support for custom Shorts thumbnails does not establish API acceptance; retain the connected-account verification gate.

Current gap: the service produces a short vision-model treatment brief and copies sampled frames or the existing remote thumbnail into candidate files. It does not synthesize images, compose a designed thumbnail, or reliably produce distinct candidates. It labels output PNG/640 x 360 without consistently encoding/resizing the source to match. The custom prompt, full supporting context and a dedicated local image-generation backend are missing. Existing candidate records, provenance, selection and API-application paths can be retained after verification. The current upload code's 2 MB cap is an implementation limit, not an assertion of the current API maximum.

Completion criteria:
- Select a local image backend/model after confirming both testers' hardware, download/storage requirements, model licensing and frame-reference support. The existing text/vision runtime is not itself an image generator.
- Use existing typed action/preload/service boundaries, explicit setup/downloads, progress/cancellation, actionable errors and owned runtime/resource management. Do not silently substitute frame copies when image generation fails.
- Preserve user prompt, supporting-input lineage, profile/model/settings and actual image properties with each candidate; retain local review before upload.
- Validate distinct candidates, JPEG decoding/dimensions/size, missing local media, generation failure/cancellation and API permission/format/rate-limit failures. Confirm channel/video-format eligibility, including Shorts, before advertising direct application as universal.
- Prove the full prompt/context -> local generation -> review -> selected JPEG -> confirmed API application flow on the packaged beta.

#### Burned-in subtitles

Complete the previously planned review-first subtitle export: visible subtitles rendered into an exported video copy, using the existing transcript, speaker profiles, preview, trim and export boundaries. Keep editing minimal: placement and size presets, speaker-profile colours and a neutral fallback for unresolved speakers. This is not a full subtitle editor.

Proposed implementation retains the earlier ASS/libass approach: intersect/clamp transcript segments to the selected trim and shift timings; resolve speaker colours; escape subtitle text; render once after final composition (including after stacked-video composition). Accepted 2026-09-23: clips only for beta, including approved clips derived from long-form sources. Direct long-form subtitle export is deferred; keep the service reusable without adding that UI to beta.

Completion criteria:
- Preview placement/size and speaker colours before explicit export; show progress, cancellation and failures.
- Verify bundled FFmpeg supports ASS/libass, and provide an actionable setup failure when unavailable.
- Export a separate MP4 without replacing source media or mutating canonical transcripts. Keep plain SRT export and YouTube caption upload separate; do not automatically publish or replace a scheduled asset.
- Validate timing across trims, multiline/special-character text, speaker fallback and final horizontal/vertical compositions. Preserve source/time-range lineage and clean temporary files safely.
- Persist only last-used preferences in existing versioned app settings; no word-by-word animation, freeform timeline editor or AI transcript rewriting is required for this beta.

### 3.2 Remaining decisions and release acceptance

Open implementation decisions: local image backend/model and supported hardware policy; thumbnail output/generation resolution and default candidate count; the explicit metadata field matrix. Subtitle scope is accepted as clips only. Earlier subtitle preferences are carried forward, not evidence of completed implementation.

#### Required before beta: hardware-aware Local AI Setup

Accepted 2026-09-23: the Settings Local AI Setup component owns hardware scanning and suggestions of suitable AI options for app processes from public model providers such as Hugging Face/GGUF repositories. Users should not need to supply their hardware manually to obtain recommendations. Complete this capability before beta alongside the three feature areas.

Current source evidence: setupEnvironmentService detects CPU cores, RAM, GPU/vendor and available VRAM information; LocalAiSetupPanel shows a hardware-based runtime/model suggestion and a curated public Hugging Face catalogue. localAiSetup.ts chooses one recommendation through fixed memory thresholds. This is a partial foundation, not task-specific model discovery or proven suitability for every process, and it lacks a thumbnail image-generation recommendation path.

Acceptance: scan/refresh hardware; show suitable options per AI process and explain speed/quality/memory tradeoffs; verify model architecture, quantization, runtime/backend and any companion files; identify unsupported or unknown hardware honestly; offer explicit, licensed/integrity-checked downloads with storage estimates and cancellation; run a task-appropriate readiness check. GGUF packaging alone does not establish image-generation or vision compatibility. Recommend image models only when the chosen image backend supports them. Suggestions must not silently change saved task/model assignments (ADR-0009). A maintained compatible catalogue is the proposed beta approach; unrestricted live provider search is not yet an accepted requirement.

Release acceptance remains separate: clean signed Windows installation, explicit local-model setup, credential/data protection, connected-account tests, restart/recovery and data-preserving upgrades. Keep the invited download flow without authentication, with regular owner-approved updates. Signing provider, hosting and package identity/versioning remain open; company identity validation is deferred for the owner to complete. See the [release plan](creator-workspace-release-rollout-plan.txt). Do not expand the beta into new platforms, broader research or a general editor while these gates remain open.

Status vocabulary: **implemented** means a source path exists; **automatically verified** identifies a dated check and its scope; **manually verified** requires a recorded user workflow; **release-ready** requires the release gates. None implies the next. General crash-startup job recovery, dirty-draft navigation protection, save-result session guards, adopted-output recovery, and damaged-database handling remain open; see the [hardening checklist](docs/hardening-checklist.md).

## 4. MVP Exit Gate

Next delivery milestone (accepted 2026-09-23): invited Windows beta with regular updates. The owner shares download links personally; download/update authentication is not required. See [ADR-0008](docs/adr/ADR-0008-invited-beta-distribution.md). Hosting and signing selections remain open; this milestone does not imply completed release verification.

Before calling the basic MVP ready for sustained use, complete these focused checks:

1. Run a representative Make -> Edit -> YouTube publish -> Performance loop using real footage, including a long-form source.
2. Confirm restart and shutdown behavior for transcription, local AI, exports, and uploads.
3. Confirm all external calls remain manual and all fallback/Strict AI states are visible.
4. Confirm transcript, proposal decision, metadata, lineage, and output files survive restart without overwriting originals.
5. Complete the credential hardening work in Section 6.
6. Capture user-facing failures and remaining workflow friction during extended testing before adding new capability.

## 5. Actual Technical Baseline

The current implementation is:

- Electron main/preload/React renderer with TypeScript and Vite.
- Secure typed IPC through `window.creatorApp`.
- JSON-backed local workspace persistence, not SQLite.
- FFmpeg for media inspection, extraction, sampled frames, and rendering.
- whisper.cpp with CPU fallback and app-managed CUDA runtime/model selection where available.
- App-owned llama.cpp `llama-server.exe` with managed GGUF text and vision model locations.
- Local AI profiles with model selection, task knowledge, learning settings, fallback reporting, and Strict AI mode.
- Local job/progress state and an explicit action catalogue for core operations.
- YouTube Data API v3, YouTube Analytics API, and Google OAuth for the current external integration.

The following are not current implementation decisions:

- Tauri is not the active desktop shell.
- SQLite is not the current persistence layer.
- Ollama is not the current primary app-owned runtime direction. Older service names and metadata source labels may still contain compatibility wording and should not be treated as the product architecture.
- A cloud-first Next.js/Supabase control plane is not required for the MVP.
- TikTok direct publishing is not a current first-class tested workflow.

Any future stack migration must preserve local data, media paths, IPC/domain contracts, model inventory, transcript records, proposals, metadata packages, schedules, and credential lifecycle before it is considered.

## 6. Google Permissions And Commercial Use

### Current integration

The app uses a desktop OAuth flow with PKCE, a state-checked loopback callback, offline access, and these current scopes:

| Scope | Current or possible use | Position |
| --- | --- | --- |
| `youtube` | Broad YouTube account management | Current but broader than ideal; audit and reduce |
| `youtube.upload` | Upload and manage videos | Current publishing path |
| `yt-analytics.readonly` | Owned performance reports | Current Performance and history paths |
| `youtube.force-ssl` | Requested by the current connection flow; used for caption authorization checks | Current, requested together with the other scopes; incremental authorization remains backlog |

Potential future scopes:

| Scope | Possible feature | Guardrail |
| --- | --- | --- |
| `youtube.readonly` | Read-only channel/library reconciliation | Prefer for read-only sync where endpoint coverage is sufficient |
| `yt-analytics-monetary.readonly` | Revenue and ROI analysis | Optional, sensitive, and not needed for MVP |
| `youtube.channel-memberships.creator` | Membership-aware planning | Deferred and unrelated to the basic workflow |
| `youtubepartner` or `youtubepartner-channel-audit` | MCN/CMS asset management or audit | Not applicable to the current single-channel user |

The official scope catalogue and method-specific requirements are the authority:

- [Google OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [YouTube video upload authorization](https://developers.google.com/youtube/v3/docs/videos/insert)
- [YouTube playlist item authorization](https://developers.google.com/youtube/v3/docs/playlistItems/insert)

### Commercial-use considerations

These are planning requirements, not legal advice:

- Keep Google data local by default and do not send it to third-party AI services without explicit user choice and a documented purpose.
- Treat raw Google data and derived/aggregated performance signals as covered by Google API Services policies.
- Maintain a privacy notice describing data accessed, local retention, AI use, deletion, and revocation.
- Request the narrowest scopes needed and prefer incremental authorization at the moment a feature needs additional access.
- Keep separate development and production OAuth projects if the app is distributed.
- If the app is distributed beyond personal/testing use, review Google OAuth verification, consent-screen branding, privacy-policy, support-contact, and scope-justification requirements.
- Do not commit client secrets, access tokens, refresh tokens, or user data to Git, logs, crash reports, or distributable bundles.

References:

- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google OAuth verification requirements](https://support.google.com/cloud/answer/13464321)

### Security hardening backlog

Current credential clearing and disconnect remove local credentials/session state; they do not revoke remote Google access. This reconciliation records local implementation, not a fresh review of external policy or API requirements.

1. Use Electron's asynchronous `safeStorage` API and surface the detected OS-protection state.
2. Add a separate `Revoke Google access and clear local credentials` action using Google's token revocation endpoint.
3. Move client ID editing to an Advanced/Developer area; do not pretend that hiding it makes it secret.
4. Remove the client secret from the normal desktop setup while retaining compatibility migration for existing local values.
5. Split OAuth requests incrementally by capability and verify the granted scopes against each feature.
6. Add secret redaction tests, storage-file checks, Git secret scanning, and secure backup guidance.

## 7. Post-MVP Roadmap

### Phase A: MVP closeout

- UI/UX consistency and workflow navigation polish.
- YouTube credential and permission hardening.
- Extended real-life tests with long-form transcription, proposals, exports, upload, and restart/recovery.
- Failure-state and retry improvements found during testing.

### Phase B: Evidence-driven AI improvement

Current foundation: proposal decision history, metadata feedback, generation provenance, knowledge entries and feedback-derived prompt guidance already exist. The work below is completion and governance, not a wholly unbuilt phase. [ADR-0009](docs/adr/ADR-0009-feedback-evidence-and-approved-learning-changes.md), accepted 2026-09-23, permits automatic use of relevant feedback as evidence but requires explicit approval for changes to saved prompts, model/task assignments or scoring rules. Evidence relevance and profile scope, approval handling and change history remain implementation work; acceptance of the policy is not verification of current behavior.

- Preserve proposal decisions, rejection reasons, trims, and edits as durable feedback history.
- Feed approved/rejected metadata and owned YouTube outcomes into AI profile retrieval.
- Add local calibration for ranking, not model-weight fine-tuning.
- Keep profile knowledge, examples, and calibration inspectable and user-controlled.

### Phase C: Optional YouTube depth

- Owned-video editing, thumbnail generation and burned-in subtitles are now required pre-beta work in Section 3.1, not optional post-MVP features.
- User-approved caption synchronisation.
- Further YouTube capabilities beyond the accepted beta field/feature matrix require a separate scope decision.
- Optional revenue/ROI analytics.
- Comment research with manual response approval only.

### Phase D: Deferred intelligence

- Higher-accuracy local speaker diarisation and enrolled voice-profile matching.
- Stronger audio/visual clip ranking and personalised candidate ordering.
- Any future external research or outside-creator ingestion requires a separate decision under ADR-0007; historical public-trend plans are not authorization to restore it.
- No automatic publishing or raw-video model claims.

### Phase E: Broader platform support

- Add another platform only after its official API, OAuth, scheduling, storage, and policy constraints are documented and implemented as a real action.
- TikTok remains a planning/handoff target until direct publishing is proven and worth the compliance/maintenance cost.

## 8. Explicitly Deferred Or Out Of Scope

- Tauri migration during this MVP cycle.
- SQLite migration before a data-preserving migration plan is approved.
- Full nonlinear editing, reframing suite, or replacement for Resolve/CapCut/Premiere.
- Autonomous clip approval, autonomous publishing, or autonomous comment replies.
- General conversational assistant/orchestrator before the action catalogue and session context are stable.
- Fine-tuning model weights or automatic unrestricted prompt evolution.
- Mass ingestion of third-party creator analytics or captions.
- Multi-user collaboration, cloud sync, billing, and enterprise operations.

## 9. Planning Authority

Use this document for current product scope, MVP status, sequencing, and commercial integration considerations.

See [documentation reconciliation](docs/documentation-reconciliation.md) for the document ownership map, current evidence, outstanding decisions, and reconciliation progress. Preserve historical verification records rather than replacing them with undated completion claims.

Use the following as supporting references:

- `creator-workspace-component-first-ui-rebuild-plan-2026-08-08.md` for component-first UI detail.
- `docs/archive/creator-workspace-transcript-and-speaker-workflow-spec-2026-07-25.md` for historical transcript and speaker detail.
- `docs/archive/creator-workspace-metadata-packaging-and-review-spec-2026-07-25.md` for historical metadata detail.
- `docs/archive/creator-workspace-ai-learning-and-profiles-backlog-2026-07-29.md` and ADR-0001 through ADR-0004 for accepted AI learning/profile decisions.
- `docs/research/video-platform-upload-and-scheduling-api-review-2026-07-18.md` for platform research, not current implementation scope.

The dated roadmap, MVP, stack, workflow, diagram, and user-story documents are historical planning material. Their current-state or technology claims are superseded by this baseline unless explicitly brought forward here.
