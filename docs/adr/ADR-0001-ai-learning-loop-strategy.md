# ADR-0001: AI Learning Should Use Retrieval Plus Local Calibration

- Status: `Accepted`
- Date: `2026-07-29`

## Accepted Selection

- `Option B: Retrieval plus local calibration`

## Context

The app already has the building blocks for a learning loop:

- local metadata generation with Ollama first and heuristic fallback second
- review-first metadata approval and rejection signals
- saved transcript, speaker, series, and game context
- owned YouTube performance snapshots
- historical YouTube import for older channel posts

The workflow docs already point toward stronger retrieval and later score calibration rather than a jump to model training:

- [creator-workspace-workflows-and-target-state-2026-07-25.md](../archive/creator-workspace-workflows-and-target-state-2026-07-25.md)
- [creator-workspace-core-ai-quality-implementation-plan-2026-07-25.md](../archive/creator-workspace-core-ai-quality-implementation-plan-2026-07-25.md)
- [creator-workspace-metadata-packaging-and-review-spec-2026-07-25.md](../archive/creator-workspace-metadata-packaging-and-review-spec-2026-07-25.md)

The user goal is not just to score outputs. It is to create AI workers that:

- do specific tasks well
- improve from the creator's own outcomes
- optionally learn from curated outside-creator patterns
- remain controllable and understandable over time

## Decision To Make

What should "learning" mean in the first serious version of the system?

## Options Considered

### Option A: Retrieval only

Definition:

- the AI improves only because it sees better examples and better prompt context

Pros:

- easiest to implement
- easiest to inspect and debug
- fits the current branch direction
- low risk of behavior drift

Cons:

- weak at adapting scoring and prioritization
- does not learn much from outcomes beyond example selection
- can plateau once prompt quality stabilizes

### Option B: Retrieval plus local calibration

Definition:

- keep retrieval as the main mechanism
- add a local calibration layer that learns from outcomes and adjusts ranking, weighting, warnings, and example selection

Pros:

- strongest fit for the current app architecture
- still explainable and reviewable
- uses the data we can realistically collect now
- avoids the operational cost and complexity of fine-tuning

Cons:

- requires a clean feature model for outcomes
- needs explicit data lineage so we know what influenced a recommendation
- still requires careful UI to explain why behavior changed

### Option C: Fine-tuning or local weight training

Definition:

- train model weights or LoRA-style adapters on creator history

Pros:

- highest theoretical customization ceiling
- could eventually capture creator-specific language patterns more deeply

Cons:

- high implementation and maintenance cost
- poor inspectability compared with retrieval and scoring rules
- requires more data volume and stronger evaluation harnesses
- not a strong fit for the current local-first desktop workflow

## Data That Makes This Viable

High-value learning inputs we either already have or can add without changing the product shape:

- approved, edited, and rejected metadata variants
- final saved metadata packages
- transcript and speaker-corrected clip context
- series and game labels
- owned YouTube analytics such as `engagedViews`, `averageViewPercentage`, `likes`, `comments`, and `estimatedMinutesWatched`
- historical owned-channel imports since 2025
- selected public trend cards and outside-creator example packs

Useful future additions:

- `shares`
- `subscribersGained` and `subscribersLost`
- richer reach and thumbnail performance data such as impressions and CTR

Official references:

- [YouTube Analytics metrics](https://developers.google.com/youtube/analytics/metrics)
- [YouTube Analytics reports.query](https://developers.google.com/youtube/analytics/reference/reports/query)
- [YouTube Reporting API channel reports](https://developers.google.com/youtube/reporting/v1/reports/channel_reports)

## Recommendation

Choose `Option B: Retrieval plus local calibration`.

In practice, that means:

1. Retrieval remains the first-class learning mechanism.
2. The app ranks examples using creator outcomes, not just recency.
3. The readiness scorer becomes partially outcome-calibrated over time.
4. The system can propose prompt and weighting improvements without changing model weights.

## Consequences

If accepted:

- the next AI learning milestone should focus on example quality, feature extraction, and calibration logic
- "training" should mean evidence enrichment and local adaptation, not model fine-tuning
- we should build evaluation views that show which examples and signals were used

If rejected in favor of fine-tuning:

- we will need a much heavier data pipeline, evaluation harness, and model lifecycle plan

## Follow-Up Questions

- Should the calibration layer be per task only, or task plus series plus game?
- How much of the calibration state should be editable by the user?
- When two signals conflict, should the app favor recent outcomes or larger sample size?
