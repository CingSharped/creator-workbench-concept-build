# Creator Workspace MVP Plan And Backlog

As of 2026-07-19.

> **Historical MVP planning.** The current MVP baseline and closure gate are maintained in [creator-workspace-current-product-plan-2026-08-11.md](../../creator-workspace-current-product-plan-2026-08-11.md). This document remains useful for the original backlog and acceptance rationale; its platform sequencing and pre-long-form scope are no longer authoritative.

Technical stack recommendation:

- see [creator-workspace-stack-recommendation-2026-07-19.md](creator-workspace-stack-recommendation-2026-07-19.md)

Workflow reference:

- see [creator-workspace-workflows-and-target-state-2026-07-25.md](creator-workspace-workflows-and-target-state-2026-07-25.md)

## Product Goal

Build a `local creator workspace` that helps turn existing clips into platform-ready posts with minimal recurring AI cost.

The first useful version should help with:

- organizing clips you already have
- transcribing them locally
- reviewing transcript speakers and capturing voice samples locally
- generating metadata
- scoring YouTube metadata quality
- planning and scheduling uploads/posts for YouTube and TikTok

The first major update should add:

- AI clip suggestions from longer source videos
- a review loop that helps the suggestion system improve from approved and rejected clips

## Working Product Shape

This app is:

- a `local desktop tool`
- `single-user` in v1
- `one local workspace on one machine` in v1
- `local AI by default`
- `review-first`, not autonomous

This app is not:

- a full video editor
- a replacement for OBS
- a team collaboration suite
- a generic enterprise social scheduler

## Working Assumptions

- `Windows-first` in v1
- `existing local clips` are the primary input for MVP
- `YouTube` and `TikTok` are the minimum platform targets in MVP
- the scheduling model is designed for multiple platforms, even if full publishing adapters arrive later
- scheduled actions in MVP run while the app or local background worker is available on your machine

## Product Principles

1. `Local-first heavy work`
   - transcription, media inspection, rendering, and clip analysis should run locally where practical
2. `Human review stays in the loop`
   - no auto-publishing without approval
3. `Metadata is part of the product, not an afterthought`
   - titles, descriptions, tags, and platform packaging are core capabilities
4. `One workflow, not disconnected tools`
   - clips, transcripts, metadata, schedules, and publishing state should live in one system
5. `Ship the narrowest thing that is useful weekly`
   - useful beats broad

## MVP Definition

### MVP Outcome

Take an existing clip from disk and move it through:

1. import
2. local transcription
3. transcript speaker review and voice sample capture
4. metadata generation
5. YouTube metadata QA
6. scheduling for YouTube or TikTok

### MVP Core User Story

"I already have clips. I want one place to import them, generate titles/descriptions/tags, check whether the YouTube metadata looks strong, and schedule them to YouTube and TikTok so I can publish consistently."

### MVP Scope

#### 1. Clip Library

- import existing video clips from local folders
- store clip metadata locally
- organize by project, folder, or batch
- track clip status:
  - `imported`
  - `transcribed`
  - `metadata_ready`
  - `scheduled`
  - `posted`
  - `failed`

#### 2. Local Transcription

- transcribe imported clips locally
- show transcript text in-app
- allow transcript correction in-app
- allow speaker assignment to `You` and collaborators
- allow saving creator and collaborator voice samples from transcript segments
- allow confidence-based auto-assignment plus low-confidence review
- export `SRT`
- support retry on failed jobs

#### 3. Metadata Generation

- generate multiple title candidates
- generate one or more description drafts
- generate YouTube tag candidates
- allow manual edits before scheduling

#### 4. YouTube Metadata QA

- score title candidates
- research tag quality
- show a recommended final metadata package

Working rule for tags:

- prefer tags with vidIQ keyword scores of `60+`
- warn if too few strong tags are available
- do not block publish solely because every tag is not `60+`

Reason:

- YouTube's own guidance treats title, thumbnail, and description as more important than tags
- tags should still be useful in the workflow, but they should not dominate the optimization model

#### 5. Scheduling Workspace

- create a scheduled post from an imported clip
- attach one selected metadata package
- set target platform, target account, and publish time
- show scheduled items in a calendar or queue view
- track status:
  - `draft`
  - `review`
  - `scheduled`
  - `posting`
  - `posted`
  - `failed`

Execution model in MVP:

- `YouTube`: support native scheduling where available through the YouTube upload/publish flow
- `TikTok`: support planning plus app-side scheduling behavior
- for TikTok, the scheduler should be designed so the final execution path can be:
  - direct publish when approved scopes and account eligibility allow it
  - draft handoff when direct posting is not available or not desirable

#### 6. Platform Scope In MVP

- `YouTube`: first-class support
  - title, description, and tag generation
  - vidIQ-assisted title/tag quality checks
  - vidIQ-assisted description suggestions and refinement support
  - description review and editing in the publish workflow
  - scheduling workflow
  - first real publish target in MVP
- `TikTok`: first-class support
  - clip planning and scheduling workflow
  - platform-specific metadata packaging
  - app-side scheduling model
  - execution path designed for either direct publish or draft handoff depending API approval and account capability
- `Other platforms`: model support only at first, unless they fit without blowing up MVP scope
  - keep the data model adapter-friendly
  - do not promise full posting integrations in the first build unless we explicitly choose them

### MVP Non-Goals

- no AI clip discovery yet
- no source-long-video ingest complexity beyond what is needed later
- no advanced video rendering pipeline
- no team features
- no billing
- no broad analytics dashboard
- no guaranteed cloud-based scheduler reliability when the machine is off

## First Update Definition

### Update 1 Outcome

Add AI-assisted clip suggestion from longer source videos and start building a learning loop from review decisions.

### Update 1 Core User Story

"I want the app to suggest good clip moments from longer videos, and I want it to get better over time based on what I approve or reject."

### Update 1 Scope

#### 1. Source Video Ingest

- import `2-4 hour` source videos into a separate source library, not the ordinary short-clip library
- provide a Settings folder selector with path validation and a clear missing/unavailable-folder state
- run intake, transcription, proxy generation, and timeline preparation as resumable background work
- align candidate suggestions to the corrected timed transcript
- keep original sources separate from disposable proxies and derived exports

#### 2. AI Clip Suggestion Pipeline

- detect transcript-led candidate windows
- show each candidate's reason, confidence, source timestamps, and evidence
- provide lightweight video preview, timeline review, and manual start/end trim
- let the user:
  - approve
  - reject
  - trim
  - preview and correct matching captions
  - choose a simple readable caption style and burn captions into an export
  - save approved exports into the existing short-clip library folder with source/time-range lineage
  - send approved candidates into the same transcript/speaker, metadata, scheduling, publishing, and performance workflow used by existing clips

#### 3. Review And Export Reliability

- keep candidate generation, rendering, and caption burn-in off the UI thread
- persist progress, cancellation, resume, and error states
- warn about storage requirements before creating proxies or exports
- never publish a candidate automatically

#### 4. Learning From Review Decisions

Store at least:

- approved vs rejected
- amount of trimming
- rejection reason

Recommended rejection reasons:

- weak hook
- weak payoff
- too long
- repetitive
- bad audio
- bad framing
- duplicate topic
- off-brand

#### 5. Improvement Loop

Use review data to improve future ranking by:

- reducing repeated weak patterns
- promoting candidate shapes that get approved
- learning per-creator preferences over time

The first version of "learning" should be:

- ranking adjustment from saved review signals

not:

- full custom model training

### Long-Form To Clip Implementation Recommendation

This capability is the front stage for the existing workflow, not a replacement for it.

#### Stage 1: Transcript-led candidate review

Ship source-folder setup and validation, resumable intake/transcription, proxies, transcript-led candidates, rationale/confidence, in-app preview, manual trim, matching timed captions, simple caption correction/style/burn-in export, and explicit approve/reject.

Stage 1 is complete when a `2-4 hour` source can produce a reviewable candidate, the creator can trim and correct it, export it reliably, and the approved export is saved into the existing short-clip library with source asset and time-range lineage.

#### Stage 2: Richer ranking signals

Add audio energy/silence, scene boundaries, and sampled visual frames. Optional local VLM analysis should receive extracted frames, not raw video, and should explain which signals affected ranking.

Stage 2 is complete when richer signals improve ordering without hiding evidence or removing manual override.

#### Stage 3: Personalised ranking

Use approval, rejection, trim, caption edits, and later performance feedback to adjust ranking locally. Keep changes inspectable, resettable, and supervised.

Stage 3 is complete when repeated user decisions change later ordering in a measurable and explainable way.

Operational acceptance applies to every stage: jobs are backgrounded and resumable, source files are preserved, proxies can be cleaned safely, and rendering failures are visible and retryable.

## Later Phases

### Update 2

- advanced caption presentation such as animated word-by-word timing, speaker colours, keyword highlighting, and template packs
- vertical/square packaging tools
- thumbnail or cover-frame helper
- more platform adapters

### Update 3

- publish result tracking
- lightweight performance feedback
- use publish performance to refine metadata suggestions

### Later, If Earned

- optional remote scheduler/helper relay
- cross-device sync
- collaboration
- richer analytics

## Capability Backlog

### P0: MVP Must-Haves

#### Foundation

- local app shell
- local SQLite database
- local job runner
- settings for media and model paths

#### Clip Library

- import local clips
- deduplicate or warn on duplicate imports
- clip list with status
- basic search/filter

#### Transcription

- local transcription pipeline
- transcript viewer
- `SRT` export
- retry / failure states

#### Metadata

- generate title candidates
- generate description drafts
- generate tag candidates
- manual metadata editing
- save selected metadata package

#### YouTube QA

- title scoring
- tag research / scoring
- mark preferred `60+` tags
- final review summary before scheduling

#### Scheduling

- create scheduled post records
- assign publish time
- queue/calendar view
- publish status updates
- YouTube scheduling support
- TikTok scheduling/planning support

### P1: First Update

#### Source Analysis

- import long-form source videos
- transcript-timestamp alignment

#### Clip Suggestions

- candidate generation
- candidate ranking
- review queue
- approve / reject / trim

#### Learning

- save review decisions
- save rejection reasons
- adjust ranking based on prior review history

### P2: Later

- advanced animated captions, speaker colours, keyword highlighting, and template packs
- reframing helpers
- thumbnail tooling
- performance feedback loop
- additional publish adapters
- optional cloud relay for scheduling reliability

## Recommended Vertical Slices

Build in this order.

### Slice 1: Clip Import + Local DB

Goal:

- one imported clip saved locally with inspectable metadata

### Slice 2: Transcription + Transcript View + `SRT`

Goal:

- one imported clip can be transcribed and exported as `SRT`

### Slice 3: Metadata Package Generation

Goal:

- one imported clip gets title, description, and tags saved as an editable metadata package

### Slice 4: YouTube Metadata QA

Goal:

- title options and tags can be reviewed with vidIQ-assisted scoring

### Slice 5: Scheduling Workflow

Goal:

- one clip with one selected metadata package can be scheduled and tracked for YouTube or TikTok

### Slice 6: Suggestion Review Loop

Goal:

- one longer source video produces candidate clips that can be approved or rejected

## Minimal Data Model

These are the core records we should expect even in a lean first version:

- `Workspace`
- `Clip`
- `Transcript`
- `TranscriptSegment`
- `CaptionExport`
- `MetadataPackage`
- `PublishTarget`
- `PublishJob`

Added in Update 1:

- `SourceVideo`
- `CandidateClip`
- `ReviewDecision`
- `RejectionReason`

Added later:

- `PerformanceSnapshot`

## Recommended Platform Strategy

### MVP

- `YouTube` and `TikTok` first

Why:

- YouTube is the strongest scheduling and metadata QA target
- TikTok is too important to defer out of the first useful version
- the app should prove a multi-platform scheduling model from the start

### Next

- `Instagram / Facebook Reels`
- `Threads`

### Later

- `Pinterest`
- `LinkedIn`
- `X`
- `Bluesky`

## Concrete Acceptance Criteria

The MVP is successful when:

1. you can import a batch of existing clips
2. each clip can be transcribed locally
3. each clip can get title, description, and tag suggestions
4. the app can show which YouTube tags are `60+` via vidIQ-style scoring or research
5. you can schedule clips for YouTube and TikTok in a usable queue/calendar
6. the system is good enough to manage a real posting backlog without spreadsheets

The first update is successful when:

1. a longer source video can produce candidate clips
2. you can approve or reject candidates quickly
3. the app remembers those review decisions
4. later candidate rankings become visibly more aligned with your choices

## Recommended Next Build Step

Start with `Slice 1` through `Slice 3` as the initial implementation target:

- import local clips
- save them locally
- transcribe them
- show transcript
- generate metadata package

That is the narrowest slice that proves the workspace idea without jumping too early into adapter and scheduling complexity.
