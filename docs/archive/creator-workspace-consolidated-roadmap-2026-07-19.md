# Creator Workspace Consolidated Roadmap

As of 2026-07-19.

> **Historical planning document.** The authoritative current baseline is [creator-workspace-current-product-plan-2026-08-11.md](../../creator-workspace-current-product-plan-2026-08-11.md). This roadmap preserves the earlier product reasoning; its dated stack, sequencing, and current-state claims are superseded where they conflict with the current plan.

This roadmap consolidates the existing planning from earlier CreatorAI documents and adapts it for this project.

Source documents reviewed:

- `clipforge-business-plan.md`
- `clipforge-technical-design.md`
- `clipforge-database-schema.md`
- `decision-log.md`
- `docs/adr/ADR-0001` through `ADR-0005`

Current workflow reference:

- see [creator-workspace-workflows-and-target-state-2026-07-25.md](creator-workspace-workflows-and-target-state-2026-07-25.md)

## Purpose

The existing `ClipForge` planning is thoughtful and coherent, but it was optimized for a phased path from founder tool to hybrid SaaS product.

For this repo, the stronger near-term direction is:

- a `local desktop creator workspace`
- with `local AI as the default`
- that helps turn source media into publishable assets
- and handles `multi-platform packaging, scheduling, and posting` in line with each platform's real API capabilities

That means we should reuse the strong workflow and data-model thinking from `ClipForge`, while changing the product framing and build order.

## What To Keep

These are the parts of the existing plan that still look right.

### 1. Local-first heavy media processing

Keep this.

Reasons:

- It matches the goal of avoiding ongoing AI cost.
- It keeps raw media, transcription, rendering, and clip generation off recurring cloud compute.
- It is the most sensible posture for large video files.

Working rule:

- raw media stays local by default
- intermediate processing stays local
- cloud should be optional later, not required for v1

### 2. Review-first AI

Keep this.

The current planning is correct that this should not be an autonomous content bot. Human review should remain mandatory for:

- clip approval
- metadata approval
- publish approval

That keeps quality under control and avoids overpromising on AI.

### 3. The core workflow model

Keep the core content pipeline:

1. ingest source media
2. generate transcript/captions
3. derive clips or platform variants
4. package metadata per platform
5. schedule or publish
6. track result

This is the right product center. The app should not be a pile of unrelated tools.

### 4. Explicit stateful jobs

Keep the job/state model.

The existing plan is right to model things like:

- queued
- processing
- ready for review
- completed
- failed

The same principle should apply to publishing:

- draft
- review
- scheduled
- posting
- posted
- failed

### 5. Shared domain model

Keep the shape of the data model, especially these concepts:

- `Workspace`
- `UploadedVideo`
- `TranscriptRevision`
- `TranscriptSegment`
- `CaptionExport`
- later `Clip`
- later `MetadataVariant`
- later `PublishTarget`
- later `PublishJob`

Even if we do not keep the exact ORM or deployment assumptions, the object model is strong.

### 6. â€œNot a full editorâ€ constraint

Keep this.

This project should not start by trying to replace:

- Premiere
- CapCut
- OBS
- Resolve

It should be a workflow workspace with targeted media tooling, not a full nonlinear editor.

## What To Change

These are the main changes I recommend for this repo.

### 1. Change the product framing from hybrid SaaS to local app first

The biggest shift is architectural and product-level:

- `ClipForge plan`: founder-local first, then hybrid SaaS with required helper
- `Recommended here`: local desktop app as the primary product, with optional cloud augmentation later

Why:

- your stated goal is local AI and avoiding AI cost
- this repo is not starting from an active SaaS codebase
- a local app is the cleanest way to own media access, jobs, exports, and scheduling behavior

Implication:

- do not anchor early architecture on `Next.js + Render + Supabase`
- instead anchor it on `desktop shell + local DB + local worker + platform adapters`

### 2. Change the target from gaming-only to creator-workspace-first

The `ClipForge` docs are heavily optimized for gaming streamers. That is a valid early user profile, but I would not hardcode the product identity around it yet.

Recommended framing:

- primary workflow: long-form to short-form repurposing
- primary user: solo creator or streamer with recurring source media
- likely early use cases: gaming, commentary, podcast, reaction, educational, talking-head

Implication:

- keep the workflow optimized for streams and VODs
- avoid naming, schema, and UI assumptions that lock the product too tightly to gaming

### 3. Move scheduling and publishing earlier in the roadmap

This is the most important roadmap shift.

`ClipForge` placed scheduling and publishing in Phase 5, after captions, clip rendering, and AI clip assistance.

For this project, scheduling should move earlier because:

- it is one of your clearest stated priorities
- we already know platform capability differences are material
- publishing workflow creates structure around the rest of the system

Recommended change:

- captions remain early
- but `multi-platform composer + scheduling engine` should happen before or alongside advanced AI clip assistance

### 4. Separate â€œlocal AIâ€ from â€œcloud plumbingâ€

Avoid treating all non-local infrastructure as the same category.

The cost problem is mostly:

- transcription cost
- metadata generation cost
- clip ranking cost
- rendering cost

Those are good candidates for local execution.

But some cloud-like functions are much smaller and may still be useful later:

- OAuth callback handling
- webhook endpoints
- remote schedule reliability when the PC is asleep

Implication:

- keep AI local by default
- allow for a tiny optional relay/service later if platform reliability demands it

### 5. Change the first technical slice

The `ClipForge` first slice was:

- upload video
- transcribe
- preview transcript
- export `SRT`

That is still a valid subsystem test, but for this product I would widen the first vertical slice slightly:

1. import local media
2. persist asset in local database
3. generate transcript
4. create a platform-ready asset record
5. attach metadata draft
6. schedule one post target

That gives us a truer test of the actual workspace.

## What To Defer

These are good ideas, but they should not lead the project.

### 1. Full automatic AI clip selection

Defer strong autonomy claims.

Good early version:

- suggest candidate moments
- let the user approve or reject

The long-form-to-clip capability is still in scope as a review-first front stage. What remains deferred is autonomous selection without review and any automatic publishing.

Bad early version:

- auto-generate the whole content calendar from one stream

### 2. Full social suite behavior

Defer:

- inbox management
- comment moderation
- full analytics warehouse
- team approvals
- enterprise collaboration

Those are different products.

### 3. Cloud sync as a default requirement

Defer mandatory cloud sync.

Useful later:

- optional backup
- remote job visibility
- cross-device continuity

Not necessary to prove value in v1.

### 4. Deep multi-user workspace complexity

Defer:

- permissions matrix
- teams
- shared editorial workflows
- billing complexity

The current project should optimize for one creator on one machine first.

### 5. Broad platform coverage at launch

Defer the long tail.

Do not launch by trying to support everything at once.

## Recommended Product Shape

The app should revolve around five primary object types:

1. `Source Asset`
   - long-form recording, imported video, stream export, finished clip, or other media input
2. `Derived Asset`
   - transcript, caption file, trimmed clip, reformatted export, thumbnail, cover frame
3. `Metadata Package`
   - title, caption, description, hashtags, notes, platform-specific packaging
4. `Publish Target`
   - YouTube channel, TikTok account, Instagram account, Threads account, etc.
5. `Publish Job`
   - draft, review, scheduled, posted, failed, with per-platform timing and outcomes

This structure gives us a coherent workspace instead of separate caption, clip, and scheduler tools.

## Long-Form To Clip Front Stage

Long-form processing is a new first stage before the existing short-clip workflow. It does not replace the current clip, transcript, metadata, scheduling, publishing, or performance flows.

Target flow:

1. import a `2-4 hour` stream or long-form source into a distinct source library
2. run background intake, transcription, proxy generation, and timeline preparation
3. propose candidate short clips from transcript-led moments
4. show each candidate's reason and confidence
5. let the creator preview the video, review the timed transcript, and trim start and end points
6. preview and correct simple captions, choose a readable style, and burn captions into an export
7. approve or reject the candidate
8. save approved exports into the existing short-clip library folder, preserving source-stream and timestamp lineage
9. continue through the existing transcript/speaker review, metadata, scheduling, publishing, and performance workflow

The system must remain review-first. Candidate generation may run automatically after a user starts a job, but no candidate may be published without explicit approval.

### Implementation Recommendation

#### Stage 1: Transcript-led review and export

Include:

- source-video records separate from ordinary short-clip library intake
- resumable background intake, transcription, proxy/preview generation, and timeline preparation
- transcript-led candidate windows with a short rationale and confidence
- in-app video preview with timeline and manual start/end trim
- matching transcript/SRT selection for each candidate
- caption text/timing correction, simple readable style selection, preview, and reliable burn-in export
- explicit approve/reject
- approved export copied into the existing clip library with source asset ID and source time range lineage

Acceptance criteria:

- a `2-4 hour` source can be imported without blocking the UI
- interrupted intake or rendering can resume or show a recoverable error
- each candidate is tied to source timestamps, transcript evidence, and a rationale
- the creator can trim, correct captions, preview the result, export it, and approve it
- an approved result becomes a normal clip without duplicating downstream metadata or publishing logic

#### Stage 2: Richer candidate ranking

Add audio energy and silence, scene boundaries, sampled visual frames, and optional local VLM analysis to improve ranking and explanations. Video understanding means extracting or sampling frames and passing those frames to a vision-language model; it is not one raw-video model call.

Acceptance criteria:

- ranking can show which transcript, audio, scene, or sampled-frame signals influenced a candidate
- heavier analysis is queued separately from lightweight intake and can be retried
- the user can still review and override every recommendation

#### Stage 3: Personalised ranking

Use approved, rejected, trimmed, and later published-performance outcomes to adjust ranking locally. Keep the first version inspectable and supervised; do not silently rewrite prompts or publish decisions.

Acceptance criteria:

- ranking changes can be traced to recorded review and performance evidence
- repeated approval/rejection patterns measurably affect later ordering
- the creator can inspect, reset, or ignore learned preferences

### Operational Requirements

- long-running work must use resumable background jobs with progress, cancellation, and clear failure states
- proxies and preview files should be lightweight and disposable without deleting the original source
- source, proxy, transcript, candidate, caption, and export paths need explicit ownership and cleanup rules
- rendering must be deterministic enough to retry and verify the output file
- storage estimates and available-space warnings should appear before large intake or export jobs

### Open Choices

- default proxy resolution and whether proxies are generated immediately or on demand
- initial candidate duration bounds and maximum candidates per source
- whether Stage 2 visual analysis uses the existing local VLM pair first or remains opt-in until performance is measured
- caption font/style defaults and which export formats are supported first
- whether the first review queue is source-centric or presents candidates across multiple sources

## Recommended Capability Backlog

This is the capability list I would plan around.

### Foundation

- local media library
- project/session organization
- local SQLite database
- background job runner
- settings and model/runtime management
- watch folders
- file validation and media inspection

### Local AI and language layer

- local transcription
- caption segmentation
- subtitle export
- transcript editing
- transcript search
- semantic search across media
- title and metadata suggestions using local models where practical
- **Deferred:** high-accuracy local speaker diarisation plus consented enrolled voice-profile matching; see the transcript/speaker workflow spec for the proposed local architecture and review safeguards

### Asset production

- manual clip trim
- vertical/square/horizontal export presets
- caption burn-in
- thumbnail or cover-frame selection
- safe-zone-aware reframing

### Publishing workspace

- platform account connections
- per-platform metadata packages
- publish states and review queue
- content calendar
- upload and scheduling engine
- retry and failure logs
- published URL tracking

### AI assistance

- clip candidate detection
- ranking and rationale
- metadata suggestions
- â€œturn this source into a packaging planâ€
- reuse recommendations from past content

### Feedback loop

- publish outcome tracking
- lightweight analytics sync where APIs allow
- local pattern library of good titles/hooks/topics

## Recommended Platform Strategy

Use three execution modes per platform:

1. `Native scheduling`
   - platform accepts a future publish time directly
2. `App-side scheduling`
   - our app stores the schedule and calls publish at runtime
3. `Draft handoff`
   - our app prepares or uploads content, but the final publish happens in the platform UI or a limited API flow

Recommended early platform priorities:

1. `YouTube`
   - strongest native scheduling support
2. `TikTok`
   - important target, but direct posting and approval policy constraints mean this needs careful adapter design
3. `Instagram / Facebook Reels`
   - important repurposing targets
4. `Threads`
   - straightforward add-on target

Second wave:

5. `Pinterest`
6. `LinkedIn`
7. `X`
8. `Bluesky`

Later or separate:

9. `Snapchat`
10. `Twitch` live workflow
11. `Kick` live workflow

## Revised Phasing For This Project

This is the main roadmap shift from the original `ClipForge` sequence.

### Phase 0: Product foundation

Goal:

- define the local app architecture and shared object model

Deliverables:

- local database schema
- source asset model
- job model
- publish model
- supported-platform capability matrix
- platform-adapter interface

### Phase 1: Local library and transcript workspace

Goal:

- make the app useful as a media and transcript workspace

Deliverables:

- import local videos
- inspect metadata
- transcribe locally
- review transcript
- export `SRT`
- search transcript text

### Phase 2: Multi-platform composer and scheduling foundation

Goal:

- make the app useful even before AI clip automation is strong

Deliverables:

- metadata package model
- publish targets
- publish jobs
- content calendar
- manual scheduling workflow
- adapter for at least one platform with true upload support

### Phase 3: Long-form intake and review-first clip production

Goal:

- turn long-form sources into reviewable, caption-ready short clips

Deliverables:

- separate long-form source library and Settings folder selector
- `2-4 hour` source intake with validation, background jobs, and resumability
- transcript-led candidate suggestions with lightweight previews
- manual trim, timed transcript review, and simple caption preview/correction/burn-in export
- approved export into the existing short-clip library with source/time-range lineage

### Phase 4: Richer AI clip assistant

Goal:

- improve candidate ranking without removing creator review

Deliverables:

- audio, scene, and sampled-frame signals
- optional local VLM analysis of sampled frames
- candidate rationale and confidence
- review decisions and manual trims captured as learning evidence

### Phase 5: Publish automation and feedback loop

Goal:

- make the publishing layer reliable and self-improving

Deliverables:

- more platform adapters
- publish retries and diagnostics
- result tracking
- analytics feedback where available

### Deferred speaker identity capability

This capability is intentionally deferred until current clip-proposal quality and other workflow priorities are addressed. It is a later enhancement to the existing transcript and speaker workflow, not a replacement for the current manual assignment and voice-sample path.

Proposed deliverables:

- local high-accuracy diarisation, with a `pyannote Community-1`-style pipeline evaluated alongside Whisper
- clear separation between diarisation (`who spoke when`) and profile matching (assigning known identities such as `Chris`, otherwise `Unknown`)
- explicit consent and local enrollment of clean voice samples
- locally stored speaker embeddings with profile, provenance, consent, and model-version metadata
- confidence thresholds, `Unknown` fallback, and no automatic identity claim at low confidence
- review UI for rename, merge, split, correction, and unresolved speaker regions
- corrections improving stored profile evidence and calibration, without base-model fine-tuning

The capability is not considered ready for implementation or model download until privacy, confidence, local storage, and review behavior can be verified end to end.

## Suggested MVP Definition

For this repo, I would define the first meaningful MVP as:

- local desktop app
- local media import
- local transcription
- transcript review and `SRT` export
- metadata package editing
- publish target creation
- scheduling workflow for at least one platform

That is more ambitious than the original caption-only MVP, but it better matches the product direction you described.

## Recommended Technical Direction

High level only, not locked yet:

- `Desktop app`: Tauri + React + TypeScript
- `Local database`: SQLite
- `Job runner`: local background worker
- `Media tooling`: FFmpeg
- `Transcription`: `whisper.cpp` or `faster-whisper`, benchmarked on your machine
- `Local model layer`: pluggable, so we can swap transcription and text-generation backends later
- `Secrets`: OS keychain or encrypted local credential store
- `Platform adapters`: isolated modules by destination platform

Not recommended as the default v1 shape:

- cloud-first Next.js app
- mandatory Supabase dependency
- mandatory remote queue
- central raw-media storage

## Important Open Decisions

Before we code, we should lock these:

1. Is this app `Windows-first` only in v1?
2. Is the primary input `local exported media`, `stream VOD links`, or both?
3. Do we want v1 scheduling to require the app to be open at publish time?
4. Which platforms are in the first adapter set?
5. Are we building for `solo use only` at first?
6. Do we want local-only text generation initially, or allow optional cloud LLM fallback for metadata?

## Immediate Recommendation

If we continue planning from here, the next document should be a `product and architecture brief` for this repo with:

- vision
- non-goals
- core objects
- phase plan
- platform strategy
- local runtime architecture
- MVP cut

That would give us a clean source of truth before implementation starts.
