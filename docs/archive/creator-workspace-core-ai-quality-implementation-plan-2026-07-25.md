# Creator Workspace Core AI Quality Implementation Plan

As of 2026-07-25.

> **Completed branch plan / supporting reference.** The current baseline and remaining closeout work are in [creator-workspace-current-product-plan-2026-08-11.md](../../creator-workspace-current-product-plan-2026-08-11.md). This document records the earlier AI-quality slice and should not be read as a current branch restriction on scheduling or publishing.

This document defines the `current branch plan` for the creator workspace.

It intentionally focuses on:

- transcript quality
- speaker review quality
- voice sample quality
- metadata generation quality
- metadata scoring, feedback, and retrieval quality

It intentionally does `not` include scheduling and publishing hardening work.

That work should move to a separate branch later.

Related references:

- [workflow reference](creator-workspace-workflows-and-target-state-2026-07-25.md)
- [workflow diagrams](creator-workspace-workflow-diagrams-2026-07-25.md)
- [transcript and speaker workflow spec](creator-workspace-transcript-and-speaker-workflow-spec-2026-07-25.md)
- [metadata packaging and review spec](creator-workspace-metadata-packaging-and-review-spec-2026-07-25.md)

## Branch Goal

Make the app reliably good at `understanding clips` and `packaging clips` before we spend more time on platform execution.

In practical terms, this branch should improve:

- whether the transcript is trustworthy
- whether the app understands who is speaking
- whether review effort is focused on uncertain segments
- whether metadata feels grounded in the real clip
- whether metadata review gives useful reasons instead of vague output
- whether later generations start improving from local decisions and local results

## Why This Comes Before Scheduling

Scheduling matters, but it should not be the next quality bottleneck.

If the app publishes weakly understood clips with weak metadata faster, we do not actually improve the workflow much.

The stronger order for this branch is:

1. improve content understanding
2. improve packaging quality
3. improve local feedback and retrieval
4. move scheduling and publishing hardening into a separate branch

## Branch Boundary

### In scope

- transcript review ergonomics
- transcript issue indicators
- speaker confidence explanation
- voice sample quality guidance
- selective speaker reruns
- stronger transcript and speaker context flowing into metadata generation
- clearer metadata scoring explanation
- clearer metadata variant comparison and history
- better retrieval from approved and high-performing examples
- stronger metadata hygiene rules
- stronger local learning loop for metadata

### Out of scope

- YouTube publishing hardening
- TikTok handoff improvements
- queue and calendar UI
- retry/recovery logic for publishing
- platform adapter expansion
- background publishing orchestration

## Current Baseline

Already implemented:

- local transcription
- transcript and `SRT` editing
- speaker assignment to `You` and collaborators
- creator and collaborator voice sample capture
- auto-assignment with confidence badges
- low-confidence and unassigned review filters
- local metadata generation with variants
- YouTube-first metadata scoring
- metadata feedback persistence
- on-demand YouTube performance refresh

This means the current branch is not starting from zero.

The right next step is `quality hardening`, not more surface area.

## Success Criteria For This Branch

This branch is successful if:

1. the corrected transcript is clearly the canonical input for metadata generation
2. the speaker workflow explains uncertainty instead of only labeling it
3. saving good voice samples becomes easier and saving bad ones becomes harder
4. metadata generation uses real clip context better than it does now
5. metadata review explains weak scores clearly enough to guide edits
6. the app starts feeling more tailored from local feedback and local history

## Priority Order

## Priority 1: Canonical Transcript Context Into Metadata

Why first:

- almost every later metadata improvement depends on this
- if metadata still uses weak or stale context, better scoring alone will not fix quality

Deliverables:

- metadata prompt assembly always uses corrected transcript state
- metadata prompt assembly includes `gameTitle`, `seriesKey`, and collaborator presence explicitly
- metadata prompt assembly can distinguish `You` from collaborator context where relevant
- description generation uses structured creator and collaborator blocks from saved profile data

Implementation tasks:

1. trace the current metadata input path and confirm where transcript data enters generation
2. ensure corrected transcript content is the only transcript source for metadata generation
3. pass speaker-aware collaborator presence into metadata context assembly
4. add tests for transcript-to-metadata context normalization
5. make debug logging or inspection good enough to verify what context was sent

Definition of done:

- a corrected transcript materially changes the generation context
- collaborator-aware clips produce better attribution context consistently
- metadata generation can be reasoned about from saved clip state

## Priority 2: Speaker Review Explainability And Review Speed

Why second:

- the speaker workflow already works, but it is still somewhat opaque
- the fastest quality gain now is helping the user understand and correct uncertainty quickly

Deliverables:

- low-confidence segments explain why they are low confidence
- likely competing speaker is visible when available
- rerun actions can target only `Needs Review` or only `Unassigned`

Implementation tasks:

1. surface confidence explanation in the segment UI
2. store enough matching detail to explain competing or near-match speakers
3. add `rerun low-confidence only` action
4. add `rerun unassigned only` action
5. preserve manual assignments during targeted reruns

Definition of done:

- the user can tell why a segment needs review
- reruns do not force a full transcript-wide pass when only a few segments are uncertain

## Priority 3: Voice Sample Quality Controls

Why third:

- better speaker automation depends on sample quality more than on UI polish alone
- this is one of the easiest places to stop bad data from polluting later work

Deliverables:

- duplicate or near-duplicate sample warnings
- weak or noisy sample warnings
- guidance on when more samples are needed

Implementation tasks:

1. define local heuristics for weak samples
   - too short
   - too quiet
   - too noisy
   - too similar to an existing sample
2. show sample quality warnings before or after saving
3. mark existing saved samples with quality status where possible
4. add simple guidance such as `needs more clean examples`

Definition of done:

- the user gets warned before building a poor voice library
- speaker matching quality becomes more stable as samples accumulate

## Priority 4: Metadata Review Explainability

Why fourth:

- the app already scores metadata, but the score needs to become more useful as a review tool
- this is the step that turns scoring from â€œinterestingâ€ into â€œactionableâ€

Deliverables:

- clearer per-score explanations
- targeted fix suggestions by field
- clearer indication of what made a package weak

Implementation tasks:

1. attach explanation text to each major rubric category
2. show which title or description traits triggered a penalty
3. show the most important fix first instead of a flat warning list
4. make saved vs generated vs edited state visually obvious
5. test that low-score packages warn without blocking save

Definition of done:

- the user can look at a weak package and know what to change first
- score output helps decision-making instead of just decorating the UI

## Priority 5: Variant History, Feedback, And Retrieval

Why fifth:

- once context and explainability are stronger, the next leverage is learning from local usage
- this is where the app starts becoming tailored instead of generic

Deliverables:

- clearer approved / edited / rejected history
- retrieval from same-series approved examples first
- retrieval from same-series high-performing examples second
- channel-wide fallback retrieval when the same series is thin

Implementation tasks:

1. make selected vs edited vs rejected variant state easier to inspect
2. define retrieval ordering and caps for same-series and channel-wide examples
3. integrate retrieval context into prompt assembly
4. keep retrieval deterministic and inspectable enough to debug
5. ensure performance snapshots can influence retrieval weighting later without changing branch scope

Definition of done:

- metadata generation uses real local history in a visible, predictable way
- the user can see that review decisions are becoming part of app memory

## Priority 6: Metadata Hygiene And Packaging Polish

Why sixth:

- once the earlier priorities land, we can harden consistency and reduce noisy output

Deliverables:

- stronger separation of public hashtags vs platform tags
- penalties for generic tag padding
- better description block consistency
- collaborator attribution completeness checks

Implementation tasks:

1. audit current tag and hashtag normalization
2. penalize broad low-signal filler tags
3. improve description block construction for Shorts
4. check collaborator attribution completeness when collaborators are present
5. verify creator and collaborator link blocks stay structured and optional

Definition of done:

- metadata output is cleaner, more consistent, and less padded
- descriptions feel intentional and repeatable across batches

## Suggested Build Sequence

This is the order I would actually code in.

1. `Priority 1`
   - canonical transcript and collaborator context into metadata
2. `Priority 2`
   - speaker explainability and targeted reruns
3. `Priority 3`
   - voice sample quality controls
4. `Priority 4`
   - metadata score explanations and fix suggestions
5. `Priority 5`
   - feedback history and retrieval
6. `Priority 6`
   - metadata hygiene polish

## Dependency Notes

Important dependency rules:

1. `Priority 1` should land before serious prompt tuning
   - otherwise we improve prompts around weak context
2. `Priority 2` and `Priority 3` strengthen the quality of the speaker data feeding `Priority 1`
3. `Priority 4` is more useful after `Priority 1`, because better context makes the explanations more truthful
4. `Priority 5` should not ship as a black box
   - retrieval must stay inspectable
5. `Priority 6` is best after the core explanation and retrieval behavior is stable

## Work Explicitly Deferred To The Scheduling Branch

Do not expand this branch into:

- YouTube publish retries
- TikTok queueing or clearer handoff
- scheduled-post lifecycle redesign
- posting failure recovery
- queue or calendar surfaces
- broader platform adapter work

Those deserve their own focused branch because they bring different risks:

- API behavior
- state transitions
- reliability concerns
- recovery logic
- UI around queue visibility

## Recommended Next Coding Slice

If we want the next implementation slice to be small and high value, start here:

1. wire corrected transcript plus collaborator presence into metadata generation
2. show why a speaker segment is low confidence
3. add `rerun needs review only`
4. add first-pass metadata score explanations

That would give us a clear quality jump without branching the project into publishing work.
