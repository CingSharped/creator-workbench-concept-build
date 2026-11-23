# Creator Workspace User Stories And Tasks

As of 2026-07-19.

> **Historical backlog.** Use [creator-workspace-current-product-plan-2026-08-11.md](../../creator-workspace-current-product-plan-2026-08-11.md) for current MVP scope and sequencing. This document retains the original user-story and acceptance-task detail but is not the authority for current platform or technology scope.

Stack reference:

- see [creator-workspace-stack-recommendation-2026-07-19.md](creator-workspace-stack-recommendation-2026-07-19.md)

Workflow reference:

- see [creator-workspace-workflows-and-target-state-2026-07-25.md](creator-workspace-workflows-and-target-state-2026-07-25.md)

This document turns the MVP plan into a build-ready backlog with:

- epics
- user stories
- acceptance criteria
- implementation tasks

It is intentionally focused on the agreed first scope:

- existing clips first
- local transcription
- metadata generation
- YouTube and TikTok scheduling/planning in MVP
- AI clip suggestions and learning in the first major update

## Recommended Build Order

1. Foundation and local app shell
2. Clip library and import
3. Local transcription and `SRT`
4. Transcript speaker review and local voice profiles
5. Metadata generation
6. YouTube metadata QA
7. Scheduling and publish queue
8. YouTube scheduling path
9. TikTok scheduling path
10. Update 1: AI clip suggestions and learning

## MVP Epics

### Epic 1: Foundation And Local App Shell

Goal:

- establish the local app, storage, and job-running foundation

#### US-001: Default local workspace

As a creator, I want the app to open into a ready-to-use local workspace so I can start without setup friction.

Acceptance criteria:

- first launch creates a default local workspace
- the app opens to a usable home screen
- the workspace persists between launches

Implementation tasks:

- [ ] scaffold the Electron desktop app shell
- [ ] scaffold React + TypeScript + Vite in the renderer
- [ ] add a secure preload bridge and IPC contract
- [ ] create the local app data directory structure
- [ ] create the SQLite database bootstrap
- [ ] add a default workspace seed path
- [ ] add a settings store for local configuration

#### US-002: Local job runner

As a creator, I want background jobs to run without blocking the UI so imports, transcription, and later scheduling stay reliable.

Acceptance criteria:

- jobs can be queued and executed in the background
- the UI can show queued, running, completed, and failed states
- failed jobs keep enough detail for retry and debugging

Implementation tasks:

- [ ] define a local job model
- [ ] implement a local queue runner in the Node-side runtime
- [ ] add job status persistence
- [ ] add structured error logging
- [ ] add a retry mechanism for retryable jobs

### Epic 2: Clip Library And Import

Goal:

- make existing clips usable inside the app

#### US-003: Import local clips

As a creator, I want to import existing clips from disk so I can manage my current backlog inside the app.

Acceptance criteria:

- user can select one or more local video clips
- imported clips appear in the library
- each clip stores filename, duration, resolution, size, and import timestamp

Implementation tasks:

- [ ] add file picker flow for video import
- [ ] define supported file types for MVP
- [ ] inspect imported media with FFmpeg or equivalent
- [ ] persist clip records locally
- [ ] add basic library list UI

#### US-004: Avoid messy duplicate imports

As a creator, I want duplicate clip imports to be detected or warned about so my library stays clean.

Acceptance criteria:

- duplicate imports are flagged before creating a second record
- the app can still allow intentional duplicate import if explicitly confirmed

Implementation tasks:

- [ ] define duplicate detection strategy
- [ ] add file fingerprint or hash logic
- [ ] add duplicate warning UI

#### US-005: Track clip state

As a creator, I want each clip to show workflow status so I can see what still needs work.

Acceptance criteria:

- each clip shows a current status
- status updates as work completes or fails

Implementation tasks:

- [ ] define MVP clip statuses
- [ ] add status field to clip records
- [ ] surface statuses in library UI

### Epic 3: Local Transcription And Caption Export

Goal:

- make each imported clip searchable and caption-ready

#### US-006: Transcribe a clip locally

As a creator, I want imported clips transcribed locally so I can avoid recurring AI API cost.

Acceptance criteria:

- a clip can be queued for transcription
- transcript text is saved locally
- transcript job states are visible

Implementation tasks:

- [ ] choose the initial local transcription engine
- [ ] package or locate the `whisper.cpp` runtime for local use
- [ ] implement audio extraction flow
- [ ] implement transcription job pipeline
- [ ] store transcript text and timing data
- [ ] connect transcription state to the UI

#### US-007: Review the transcript in-app

As a creator, I want to read a transcript in the app so I can check quality before using it for metadata.

Acceptance criteria:

- transcript view opens from a clip
- transcript text is readable and associated with the correct clip
- missing or failed transcript states are visible

Implementation tasks:

- [ ] design transcript viewer UI
- [ ] map transcript segments to display rows
- [ ] add empty, loading, and failed states

#### US-008: Export `SRT`

As a creator, I want to export `SRT` captions so I can use them in platform workflows that support subtitles.

Acceptance criteria:

- an `SRT` file can be generated from a clip transcript
- exported file is saved locally and can be opened from the app

Implementation tasks:

- [ ] implement `SRT` formatter
- [ ] write caption export records locally
- [ ] add export action in the clip view
- [ ] add export success/failure UI

### Epic 3B: Speaker Review And Local Voice Profiles

Goal:

- turn transcripts into a reusable speaker-aware review layer

#### US-008A: Review transcript speakers in-app

As a creator, I want transcript segments assigned to `You` or collaborators so speaker-aware review becomes part of the clip workflow.

Acceptance criteria:

- transcript segments can be assigned to `You` or saved collaborators
- speaker colors are persistent
- manual assignments are distinguishable from automated ones

Implementation tasks:

- [ ] persist speaker assignment source on transcript segments
- [ ] show manual vs automated speaker states in the UI
- [ ] add segment filtering for all, needs-review, and unassigned states

#### US-008B: Save creator and collaborator voice samples

As a creator, I want to save clean voice samples from transcript segments so the app can label recurring speakers faster over time.

Acceptance criteria:

- creator voice samples can be saved locally
- collaborator voice samples can be saved locally
- saved samples are visible and removable in Settings

Implementation tasks:

- [ ] store creator voice samples locally
- [ ] store collaborator voice samples on collaborator profiles
- [ ] surface saved sample counts and sample management UI

#### US-008C: Auto-assign transcript speakers with confidence review

As a creator, I want the app to auto-label transcript segments and isolate low-confidence matches so I only review the uncertain cases.

Acceptance criteria:

- the app can auto-assign speaker labels from saved voice samples
- high-confidence and low-confidence assignments are visually distinct
- low-confidence segments can be reviewed in isolation

Implementation tasks:

- [ ] define confidence thresholds for auto speaker assignment
- [ ] show confidence badges in the transcript UI
- [ ] add `review low-confidence only` workflow
- [ ] later evaluate whether a stronger local diarization model is justified

### Deferred Epic 3C: High-Accuracy Local Diarisation And Enrolled Speaker Profiles

Status: deferred. Do not start this epic until current clip-proposal quality and other workflow priorities are addressed.

#### US-008D: Produce local speaker regions

As a creator, I want high-accuracy local diarisation to determine who spoke when so the transcript can be reviewed by speaker region rather than relying only on transcript-segment heuristics.

Acceptance criteria:

- diarisation runs locally alongside the existing Whisper transcript flow
- speaker regions are timestamped and can be aligned to transcript segments
- diarisation does not claim a real-world identity by itself
- processing status, model/runtime, confidence, and failure state are visible

Proposed implementation direction:

- evaluate a local `pyannote Community-1`-style pipeline
- preserve Whisper text and canonical timing as the transcript source
- keep original media untouched and make retries safe

#### US-008E: Match diarised regions to enrolled profiles

As a creator, I want consented voice profiles to identify recurring speakers locally while leaving uncertain regions as `Unknown`.

Acceptance criteria:

- enrollment requires explicit consent and clean local voice samples
- speaker embeddings are stored locally with profile, provenance, consent, and model-version metadata
- known identities such as `Chris` or collaborators are assigned only above defined confidence thresholds
- low-confidence matches remain `Unknown` or `Needs review`
- review supports rename, merge, split, correction, and leaving a region unresolved
- manual corrections are authoritative and improve stored profile evidence, not base-model weights

### Epic 4: Metadata Generation

Goal:

- give each clip a reusable metadata package

Reference:

- see `splempy-youtube-shorts-review-and-ai-heuristics-2026-07-19.md` for the first channel-informed local AI heuristics set

#### US-009: Generate title candidates

As a creator, I want multiple title ideas for a clip so I can choose a stronger publishing option faster.

Acceptance criteria:

- the app can generate multiple title candidates
- generated titles are tied to the correct clip
- user can choose one as the current working title

Implementation tasks:

- [ ] define metadata package schema
- [ ] define the local metadata provider interface
- [ ] implement title generation flow through the local provider
- [ ] generate at least three title angles per clip: specific-fail, panic-or-tension, and absurd-or-social-chaos
- [ ] persist multiple title variants
- [ ] add title selection UI

#### US-010: Generate descriptions

As a creator, I want description drafts generated for a clip so I can avoid starting from a blank box.

Acceptance criteria:

- one or more description drafts can be generated
- the user can edit the chosen description before scheduling

Implementation tasks:

- [ ] implement description generation flow through the local provider
- [ ] bias Shorts descriptions toward one short lead line plus one short support line
- [ ] assemble descriptions from reusable blocks instead of one large freeform paragraph
- [ ] support an optional creator-link block in the description output
- [ ] support an optional collaborator-attribution block when partners are present in the clip
- [ ] persist description variants
- [ ] add description editing UI

#### US-011: Generate tag candidates

As a creator, I want relevant tag suggestions so I can package YouTube videos more effectively.

Acceptance criteria:

- the app generates a candidate tag set for a clip
- the selected tag set is saved with the metadata package
- public hashtags can be managed separately from platform-specific tag fields

Implementation tasks:

- [ ] implement tag generation flow through the local provider
- [ ] prefer narrow, series-aware tags over generic gaming tag padding
- [ ] separate public hashtags from platform-specific internal tag fields
- [ ] persist tag variants or selected tag set
- [ ] add tag editing UI

#### US-011A: Reuse creator and collaborator profiles

As a creator, I want reusable profile links and collaborator records so the app can add the right links and attributions when co-op partners appear in a clip.

Acceptance criteria:

- my own profile links can be stored once and reused across generated descriptions
- collaborator profiles can be stored once with platform-specific handles or links
- a clip can mark which collaborators are present
- generated descriptions can include only the relevant collaborators for that clip

Implementation tasks:

- [ ] define a local creator-profile model for reusable platform links
- [ ] define a collaborator profile model with optional platform handles and links
- [ ] allow clips to reference zero or more collaborators
- [ ] add settings UI for managing creator and collaborator profiles
- [ ] add clip-level UI for marking which collaborators are present
- [ ] add description rendering rules for conditional creator and collaborator link blocks

### Epic 5: YouTube Metadata QA

Goal:

- make YouTube packaging measurably better before scheduling

Reference:

- see `youtube-performance-rubric-and-app-guidance-2026-07-19.md` for the official-guidance-based YouTube readiness rubric

#### US-012: Score YouTube titles

As a creator, I want title quality feedback so I can pick stronger YouTube titles before publishing.

Acceptance criteria:

- the app can score title candidates or fetch title scoring
- scores are visible next to candidate titles
- the user can select the preferred title after review

Implementation tasks:

- [ ] integrate title scoring flow
- [ ] store score results with title candidates
- [ ] display scores and simple reasoning in UI
- [ ] add a specificity score for concrete nouns, verbs, and event clarity
- [ ] add a generic-reaction penalty when a title relies on vague reaction phrasing
- [ ] add a duplicate-title penalty against recent titles in the same series or batch

#### US-012A: Score YouTube readiness before scheduling

As a creator, I want a pre-publish YouTube readiness score so I can tell whether a clip is strong enough to publish as-is or should be improved first.

Acceptance criteria:

- the app produces a YouTube readiness score for a clip
- the score is broken down into visible sub-scores
- the app highlights the weakest parts of the package before scheduling

Implementation tasks:

- [ ] define the first rule-based YouTube readiness rubric
- [ ] add sub-scores for audience/topic fit, packaging clarity, hook strength, retention/payoff structure, search clarity, session/channel connection, and metadata hygiene
- [ ] store score results with the selected metadata package
- [ ] display sub-score reasoning in the metadata workflow
- [ ] add warning states for low-score clips before scheduling

#### US-012B: Flag hook and retention risk

As a creator, I want the app to warn me when a Short likely starts too slowly or delays its payoff so I can avoid wasting uploads on weak openings.

Acceptance criteria:

- the app can surface hook-risk warnings for a clip
- the app can surface delayed-payoff or filler-risk warnings
- warnings are shown before the clip is scheduled

Implementation tasks:

- [ ] define first-pass hook-risk heuristics for Shorts
- [ ] define first-pass delayed-payoff and filler-risk heuristics
- [ ] add warning states in the metadata and scheduling flow
- [ ] store warning results with the clip record for later learning

#### US-013: Refine descriptions with vidIQ-assisted support

As a creator, I want description suggestions and refinement support so my YouTube description is stronger and easier to finalize.

Acceptance criteria:

- the app can generate or refine a description with vidIQ-assisted guidance
- the final chosen description remains editable by the user

Implementation tasks:

- [ ] define how vidIQ-assisted description guidance is represented
- [ ] integrate description suggestion/refinement step
- [ ] display suggested description output in the metadata view
- [ ] surface when a weak title should trigger title regeneration instead of more description work

#### US-014: Prefer strong YouTube tags

As a creator, I want the app to identify stronger tag opportunities so I can favor tags with better keyword potential.

Acceptance criteria:

- tag research or scoring is shown for candidate tags
- tags with `60+` scores are visually preferred
- the app warns when not enough strong tags are available
- the app does not hard-block scheduling based only on tag score

Implementation tasks:

- [ ] integrate keyword research or tag scoring
- [ ] map score bands into UI states
- [ ] add preferred-tag selection behavior
- [ ] add warning state when few `60+` tags exist
- [ ] favor tags and hashtags that reinforce the current game, series, or content lane

#### US-014A: Learn from creator feedback and publish outcomes

As a creator, I want the local AI to improve based on what I keep, reject, edit heavily, and what later performs well, so metadata gets more useful over time.

Acceptance criteria:

- the app stores whether a generated draft was approved, rejected, or materially edited
- the app can store lightweight post-publish performance snapshots for clips managed in the workspace
- future generations can use prior approved or high-performing examples as context

Implementation tasks:

- [ ] define a local feedback record for approved, rejected, and edited metadata drafts
- [ ] capture when a saved draft differs materially from the generated draft
- [ ] store lightweight publish performance snapshots for connected platforms where data is available
- [ ] retrieve relevant approved and high-performing examples during generation
- [ ] keep retrieval series-aware where possible

#### US-014B: Learn from YouTube performance signals

As a creator, I want the app to compare pre-publish scores with post-publish YouTube outcomes so the local heuristics become more honest over time.

Acceptance criteria:

- the app can store YouTube performance snapshots for published clips
- post-publish data can be compared against pre-publish readiness scores
- the app can identify recurring mismatches between predicted and actual performance

Implementation tasks:

- [ ] define a YouTube performance snapshot model for Shorts and videos
- [ ] store engaged views when available
- [ ] store likes, comments, and key retention-style data when available
- [ ] compare publish outcomes with pre-publish readiness sub-scores
- [ ] surface calibration findings for local heuristic refinement

### Epic 6: Scheduling Workspace

Goal:

- turn clips and metadata into an actionable publishing queue

#### US-015: Create a scheduled post

As a creator, I want to schedule a clip against a platform and account so I can manage a posting calendar in one place.

Acceptance criteria:

- a scheduled post can be created from a clip
- it includes platform, account, publish time, and selected metadata package
- scheduled posts appear in a queue or calendar view

Implementation tasks:

- [ ] define `PublishTarget` and `PublishJob` models
- [ ] implement scheduled post creation flow
- [ ] add publish queue UI
- [ ] add calendar or time-ordered list UI

#### US-016: Track publish state

As a creator, I want scheduled posts to show their current state so I can see what is ready, posted, or failed.

Acceptance criteria:

- publish jobs move through explicit states
- failure states are visible and retryable where appropriate

Implementation tasks:

- [ ] define MVP publish states
- [ ] persist state transitions
- [ ] add publish failure details UI
- [ ] add retry action hooks

### Epic 7: YouTube Scheduling Path

Goal:

- support real YouTube scheduling behavior in MVP

#### US-017: Schedule a YouTube post

As a creator, I want to schedule a clip for YouTube so the app supports a real publishing workflow, not only planning.

Acceptance criteria:

- a clip can be assigned to a YouTube publish target
- the scheduling model supports YouTube-native scheduled publishing
- the app records the planned publish time and final outcome

Implementation tasks:

- [ ] define YouTube adapter boundary
- [ ] map YouTube metadata fields into local models
- [ ] implement YouTube-specific scheduling request model
- [ ] add YouTube target/account configuration UI
- [ ] persist YouTube publish outcome fields

### Epic 8: TikTok Scheduling Path

Goal:

- support TikTok as a real MVP target without pretending its behavior matches YouTube

#### US-018: Plan and schedule a TikTok post

As a creator, I want to schedule a clip for TikTok so I can manage my short-form posting backlog in the same workspace.

Acceptance criteria:

- a clip can be assigned to a TikTok publish target
- TikTok jobs can be scheduled in the same queue/calendar
- the job records whether it is intended for direct publish or draft handoff

Implementation tasks:

- [ ] define TikTok adapter boundary
- [ ] define TikTok-specific metadata package fields if needed
- [ ] add TikTok target/account configuration UI
- [ ] add execution mode field for `direct_publish` vs `draft_handoff`
- [ ] persist TikTok scheduling records and outcomes

#### US-019: Distinguish TikTok execution behavior

As a creator, I want TikTok scheduling to reflect real platform constraints so I do not mistake a planned post for a guaranteed native scheduled publish.

Acceptance criteria:

- the UI clearly indicates TikTok execution mode
- app-side scheduled jobs are visually distinct from native scheduled jobs
- failure or approval limitations are visible

Implementation tasks:

- [ ] define platform capability flags
- [ ] add execution-mode labeling in scheduling UI
- [ ] add explanatory states for TikTok limitations

## Update 1 Epics

### Epic 9: Long-Form Source Ingest

Goal:

- prepare the system to suggest clips from longer videos

#### US-020: Import source videos

As a creator, I want to import longer source videos so the app can suggest clips from them later.

Acceptance criteria:

- long-form videos can be imported separately from ready-made clips
- `2-4 hour` sources can enter a background, resumable intake/transcription job
- transcripts, lightweight previews, and timeline state can be linked to source timing
- source and disposable derived-file storage is visible and recoverable after errors

Implementation tasks:

- [ ] define source-video record type
- [ ] reuse import/transcription pipeline for long-form assets
- [ ] add source-video library view

### Epic 10: AI Clip Suggestions

Goal:

- reduce manual clip hunting

#### US-021: Generate candidate clips

As a creator, I want suggested clip windows from a source video so I can review promising moments faster.

Acceptance criteria:

- candidate windows are generated from a source video
- each candidate includes source timing, transcript evidence, a reason, and confidence
- the review queue can play a lightweight preview without loading the full source unnecessarily

Implementation tasks:

- [ ] define candidate clip model
- [ ] implement heuristic candidate generation
- [ ] implement candidate ranking pass
- [ ] attach rationale text to candidates

#### US-022: Review candidate clips

As a creator, I want to approve, reject, or trim candidate clips so only worthwhile suggestions move forward.

Acceptance criteria:

- candidate review queue exists
- candidates can be approved or rejected
- candidates can be trimmed at the start and end in the review workspace
- the matching timed transcript/SRT can be previewed and corrected
- a simple readable caption style can be selected and burned into a reliable export
- approved exports are saved into the existing short-clip library with source asset and time-range lineage
- approved candidates can enter the existing transcript/speaker/metadata/scheduling workflow

Implementation tasks:

- [ ] build review queue UI
- [ ] implement approve/reject actions
- [ ] implement candidate-to-clip promotion flow

#### US-022A: Review captions for an approved candidate

As a creator, I want to verify captions against the clip timeline so an exported short is readable before it enters metadata and publishing.

Acceptance criteria:

- the app automatically selects the transcript segments overlapping the approved clip window
- caption text and timing can be corrected without changing the source transcript unexpectedly
- the user can choose a simple readable style and preview it on the video
- caption burn-in/export has explicit progress, failure, and retry states

Implementation tasks:

- [ ] derive a clip-local timed transcript from the source transcript
- [ ] add caption preview and text/timing correction state
- [ ] add a small initial style set
- [ ] implement deterministic caption burn-in/export

### Epic 11: Learning From Approvals And Rejections

Goal:

- make suggestions improve from your own decisions over time

#### US-023: Save review decisions

As a creator, I want my clip review choices saved so the system can learn what I consider a good clip.

Acceptance criteria:

- every candidate review action is recorded
- decisions are linked to the candidate and source video

Implementation tasks:

- [ ] define `ReviewDecision` model
- [ ] persist approve/reject/trim actions
- [ ] capture timestamps and actor context

#### US-024: Save rejection reasons

As a creator, I want to specify why I rejected a suggestion so the system can improve more intelligently.

Acceptance criteria:

- rejection reasons can be selected from a standard list
- rejection reasons are stored with the review decision

Implementation tasks:

- [ ] define rejection reason taxonomy
- [ ] add rejection reason picker UI
- [ ] store reasons in review decision records

#### US-025: Improve future ranking from past decisions

As a creator, I want future suggestions to better match my preferences so I spend less time rejecting weak clips.

Acceptance criteria:

- later rankings incorporate prior review history
- the system can prefer candidate patterns that were previously approved
- the system can down-rank patterns that were repeatedly rejected

Implementation tasks:

- [ ] define first-pass ranking adjustment rules
- [ ] incorporate approval/rejection history into ranking
- [ ] add simple evaluation metrics for improvement over time

## Stories To Explicitly Defer

Do not treat these as MVP work:

- [ ] full video editing timeline
- [ ] animated word-by-word captions, speaker colours, keyword highlighting, and template packs
- [ ] automatic posting to every platform
- [ ] team permissions and collaboration
- [ ] billing and subscriptions
- [ ] deep analytics warehouse
- [ ] cloud-first rewrite

## Suggested First Sprint Cut

If we want the cleanest starting point, Sprint 1 should cover:

- US-001 default local workspace
- US-002 local job runner
- US-003 import local clips
- US-005 track clip state
- US-006 transcribe a clip locally
- US-007 review the transcript in-app
- US-008 export `SRT`

That would give us a usable local media/transcript base before we build metadata and scheduling on top.
