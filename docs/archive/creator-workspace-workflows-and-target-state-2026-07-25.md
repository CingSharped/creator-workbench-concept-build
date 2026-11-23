# Creator Workspace Workflows And Target State

As of 2026-07-25.

> **Supporting workflow reference with historical state claims.** The current Make -> Edit -> Performance baseline and MVP exit gate are maintained in [creator-workspace-current-product-plan-2026-08-11.md](../../creator-workspace-current-product-plan-2026-08-11.md). Use this document for detailed target-state requirements, not as the final authority on what is already implemented.

This document is the working workflow reference for the app.

Diagram reference:

- see [creator-workspace-workflow-diagrams-2026-07-25.md](creator-workspace-workflow-diagrams-2026-07-25.md)

Feature spec references:

- see [creator-workspace-transcript-and-speaker-workflow-spec-2026-07-25.md](creator-workspace-transcript-and-speaker-workflow-spec-2026-07-25.md)
- see [creator-workspace-metadata-packaging-and-review-spec-2026-07-25.md](creator-workspace-metadata-packaging-and-review-spec-2026-07-25.md)

Current branch implementation plan:

- see [creator-workspace-core-ai-quality-implementation-plan-2026-07-25.md](creator-workspace-core-ai-quality-implementation-plan-2026-07-25.md)

Use it to keep three things aligned:

- what the app can do today
- what the end-state workflow should become
- what requirements and sequencing we should plan next

## How To Read This

For each workflow below:

- `Current state` means what is implemented in the local app now
- `End goal` means the intended product workflow
- `Next requirements` means the most important gaps to close in planned order

## Workflow 0: Long-Form To Clip Review Front Stage

### Current state

- the app can import and transcribe ready-made clips locally
- there is no dedicated `2-4 hour` source-video intake, candidate queue, in-app timeline review, or caption burn-in workflow yet
- the existing transcript, speaker, metadata, scheduling, publishing, and performance workflows are the downstream destination for approved clips

### End goal

- select and validate a separate long-form source-library folder in Settings
- import a long-form source without blocking the app
- prepare transcription, timed transcript, lightweight preview media, and timeline state in resumable background jobs
- propose transcript-led candidate clips with reason and confidence
- let the creator preview, trim, correct matching captions, choose a simple readable style, export, and approve or reject each candidate
- save approved exports into the existing short-clip library folder with source asset and source time-range lineage
- promote approved candidates into the existing short-clip workflow unchanged

### Staged requirements

1. transcript-led suggestions, manual trim, caption preview/correction, burn-in export, and approve/reject
2. audio, scene, and sampled-frame signals to improve ranking and explanations
3. local personalisation from approvals, rejections, trims, caption edits, and later performance feedback

The system must never autonomously publish a suggested clip. Visual understanding is based on extracted or sampled frames sent to a VLM, not a raw-video model call.

### Operational requirements

- resumable background jobs with progress, cancellation, and recoverable errors
- lightweight proxies/previews with safe cleanup rules
- explicit source, derived-file, and storage management
- deterministic, retryable rendering
- folder setup validation and clear missing-folder guidance in Settings

## Workflow 1: Clip Intake And Workspace Indexing

### Current state

- the app imports clips from local disk
- the clip library can point at a selected folder
- import is non-recursive for the selected library folder
- imported clips are indexed into a local JSON-backed workspace store
- clip records keep source path, file size, duration, resolution, import time, and workflow status
- indexed clips can be removed from the workspace without deleting source files

### End goal

- one clean local intake workflow for clips, batches, and later long-form source videos
- reliable workspace indexing, duplicate handling, and safe re-sync
- clip state should make it obvious what still needs work before publishing

### Next requirements

1. add stronger duplicate detection and warnings
2. add batch labels or project grouping for imported clips
3. add source-video ingest as a separate path from ready-made short clips

## Workflow 2: Local Transcription And Transcript Editing

### Current state

- transcription runs locally through `ffmpeg` plus `whisper.cpp`
- the app extracts mono `16 kHz` WAV audio before transcription
- transcript text and `SRT` are saved locally per clip
- transcripts can be reviewed in `Text`, `SRT`, and `Speakers` views
- transcript text and `SRT` can be edited and saved back into the workspace
- `SRT` can be exported locally

### End goal

- transcription should be a stable first-pass content understanding layer for the rest of the product
- transcript edits should be the canonical corrected version used by metadata, captions, speaker review, and later clip suggestion systems
- transcript quality problems should be easy to see and fix before downstream workflows

### Next requirements

1. improve transcript editing ergonomics for larger clips
2. add transcript quality indicators and quick navigation to problematic segments
3. add transcript-linked caption preview and simple burn-in export through the long-form clip review flow; defer advanced caption animation and template systems

## Workflow 3: Speaker Review, Voice Samples, And Identification

### Current state

- transcript segments can be assigned to `You` or saved collaborator profiles
- collaborator profiles already unify:
  - display name
  - social/profile links
  - transcript color
  - saved collaborator voice samples
- creator profile settings now also store `your` saved voice samples
- voice samples are captured from clean subtitle segments inside transcript edit mode
- the app can auto-assign speaker labels from saved creator and collaborator voice samples
- auto-assigned segments now carry:
  - `manual`
  - `auto high confidence`
  - `auto low confidence / needs review`
- the `Speakers` view now supports:
  - confidence badges
  - low-confidence explanation notes
  - `Auto-Assign From Voice Samples`
  - `Review Low-Confidence Only`
  - `Rerun Needs Review Only`
  - review filters for `All`, `Needs Review`, and `Unassigned`

### End goal

- speaker review should become a dependable local identity layer for creator and recurring co-op partners
- voice samples should make speaker labeling faster over time instead of forcing repeated manual work
- low-confidence segments should be isolated quickly so the review workflow stays focused
- later caption rendering and higher-level AI systems should be able to use speaker identity as input

### Next requirements

1. add better confidence explanation in the UI
   - why a segment is marked low-confidence
   - what likely competing speaker it resembles
2. allow creator and collaborator sample quality scoring
   - highlight poor or duplicate samples
   - recommend when more samples are needed
3. support re-running auto-assignment on only unassigned or only low-confidence segments
4. later, evaluate a stronger local diarization or embedding model if the current heuristic approach plateaus

### Deferred high-accuracy speaker identity capability

This is a future capability, not active work. It remains deferred until current clip-proposal quality and other workflow priorities are addressed.

The proposed flow is deliberately two-stage:

1. local diarisation determines **who spoke when** and creates speaker regions alongside the existing Whisper transcript
2. local profile matching compares each region with explicitly consented, enrolled voice profiles and assigns a known person such as `Chris` or a collaborator only above a defined confidence threshold

Unknown or low-confidence regions must remain `Unknown` or `Needs review`; the system must not make automatic identity claims when evidence is weak.

The likely architecture is a local `pyannote Community-1`-style diarisation pipeline alongside Whisper, with locally stored speaker embeddings derived from clean enrolled samples. Embeddings must retain profile, model-version, provenance, and consent metadata. Diarisation boundaries and Whisper timing must be aligned without replacing the canonical transcript text.

The future review UI should allow the creator to rename, merge, split, correct, or leave speaker regions unknown. Corrections become stored profile evidence and calibration data; they do not silently fine-tune or modify the base model. All samples, embeddings, and identity mappings remain local-first, with explicit consent, visible confidence/source labels, retryable processing, and untouched original media.

## Workflow 4: Metadata Packaging And YouTube Readiness Review

### Current state

- metadata is generated locally with Ollama first and heuristic fallback second
- metadata generation now uses the corrected saved transcript plus collaborator presence context when available
- the app generates:
  - multiple title variants
  - multiple description variants
  - public hashtag sets
  - YouTube platform tag sets
- metadata is reviewed in a guided workflow instead of a single save form
- the app stores a selected metadata package per clip
- YouTube readiness scoring is already built into the workflow
- descriptions can append:
  - `More from me:`
  - `Featuring:`
  - `Check out the crew:`

### End goal

- metadata packaging should become a reusable review system rather than one-off text generation
- clip context, transcript, collaborator context, and later publish performance should all influence packaging quality
- the final saved package should be clearly separated from generated candidates and feedback history

### Next requirements

1. improve score explanations and fix suggestions in the UI
2. make transcript and speaker context more visible inside metadata generation prompts and review
3. add clearer variant comparison and selection history
4. later, connect performance feedback into retrieval and scoring calibration

## Workflow 5: Scheduling And Platform Publishing

### Current state

- the app can create scheduled posts from saved clips and saved metadata packages
- YouTube is the primary real publish path
- TikTok is currently modeled as planning plus handoff-oriented scheduling behavior
- YouTube playlist selection and performance refresh already exist in the app
- platform metadata is stored per scheduled post

### End goal

- clips should move from reviewed transcript and metadata into a real publish queue cleanly
- platform differences should be explicit rather than hidden behind a fake common abstraction
- the user should always know whether a post is:
  - draft
  - scheduled
  - posting
  - posted
  - failed

### Next requirements

1. harden the YouTube publishing path and failure recovery
2. improve TikTok scheduling and handoff clarity
3. add a stronger queue/calendar review surface
4. later expand adapters to more platforms only when the workflow stays coherent

## Workflow 6: Performance Feedback And Learning

### Current state

- metadata feedback is already stored for generated variants
- YouTube performance snapshots can be refreshed for workspace-managed uploads
- current learning is still mostly retrieval, heuristics, and manual review-driven

### End goal

- performance and approval signals should improve later metadata generation and clip ranking
- the app should learn from:
  - approved vs edited vs rejected metadata
  - publish outcomes
  - later clip approval and rejection decisions

### Next requirements

1. show performance and metadata feedback more directly in the workflow UI
2. use stronger retrieval from approved/high-performing workspace examples
3. later connect clip suggestion approval/rejection into the same learning loop

## Workflow 7: Runtime And Workspace Settings

### Current state

- runtime tool configuration lives in Settings
- workspace folders and automation options are separated from the main clip workspace
- creator links, creator voice samples, collaborator profiles, and collaborator voice samples are now all managed from Settings

### End goal

- settings should stay out of the way during day-to-day clip work
- configuration should feel stable, local, and understandable
- the app should make it obvious what is missing when a workflow cannot run

### Next requirements

1. add richer health/status reporting for local runtime dependencies
2. add import/export or backup support for local settings and profile data
3. add a validated long-form source-library folder selector without changing the existing short-clip library folder
4. document recommended local runtime layouts and migration paths

## Recommended Sequencing

This is the workflow-first order I would use from here.

1. stabilize `transcription + speaker review + voice samples`
   - improve confidence explanation
   - improve low-confidence review speed
2. harden `metadata packaging`
   - clearer review decisions
   - stronger transcript/context usage
3. harden `YouTube publishing and scheduling`
   - better queue behavior
   - better failure handling
4. improve `TikTok planning / handoff`
5. improve `performance feedback loop`
6. add the Stage 1 `long-form to clip` review front stage
7. add richer ranking signals and supervised personalisation after the review flow is reliable

## Immediate Planning Implication

The app is no longer just:

- import
- transcribe
- generate metadata
- schedule

It is now:

- import
- transcribe
- correct transcript
- label speakers
- capture voice samples
- auto-assign and review low-confidence speaker segments
- generate metadata
- review metadata
- schedule / publish

The planned front stage is now:

- select a separate long-form source folder
- import a long-form source and prepare transcript, timeline, and preview in the background
- propose and review candidate clips
- trim, correct captions, export, and approve

Approved exports enter the existing short-clip library and continue through the workflow above.

That richer workflow should be treated as the real product spine in the roadmap, backlog, and future design docs.
