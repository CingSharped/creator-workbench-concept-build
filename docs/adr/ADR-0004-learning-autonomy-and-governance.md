# ADR-0004: Learning Should Remain Supervised And Local Before Any Automatic Tuning

- Status: `Accepted`
- Date: `2026-07-29`

## Accepted Selection

Clarified on 2026-09-23 by [ADR-0009](ADR-0009-feedback-evidence-and-approved-learning-changes.md): relevant feedback may be used automatically as evidence; changes to saved prompts, model/task assignments and scoring rules require explicit approval. Historical rationale below is retained.

- `Option A: Supervised local learning`

## Context

> Implementation note, reconciled 2026-09-23: feedback-derived evidence is permitted under ADR-0009. Profile-scoped relevance, change proposals, revision history and rollback still require implementation verification; policy acceptance does not close these gaps.

The app is explicitly review-first in its current design:

- generated outputs are reviewed before use
- metadata feedback is stored as product data
- transcript and speaker context are corrected locally
- the user wants AI profiles that can be enriched and improved over time

The user also said they are not primarily interested in an internal "AI rating" system. They care more about:

- assigning the right AI profile to the right task
- giving that profile the right context and data
- improving its usefulness over time without losing control

That points toward governed learning rather than free-form auto-mutation.

## Decision To Make

How much freedom should the learning system have to change behavior automatically?

## Options Considered

### Option A: Supervised local learning

Definition:

- the app collects evidence and proposes prompt, retrieval, and weighting improvements
- the user accepts or rejects meaningful behavior changes

Pros:

- strongest fit for the review-first product
- easiest to trust
- behavior changes stay inspectable

Cons:

- slower adaptation
- more approval surfaces to design

### Option B: Semi-automatic bounded tuning

Definition:

- the app can automatically adjust limited weights or retrieval priorities inside narrow guardrails

Pros:

- faster iteration
- still more controllable than free-form auto-tuning

Cons:

- requires good observability to prevent silent drift
- harder to explain than fully supervised updates

### Option C: Aggressive automatic tuning

Definition:

- the app can rewrite prompts and learning weights broadly from outcomes

Pros:

- maximum adaptation speed if it works

Cons:

- highest drift risk
- weakest trust model
- poor fit for the current product philosophy

## Recommendation

Choose `Option A: Supervised local learning` for the first serious learning system.

## What The App Should Be Allowed To Do Automatically

Safe automatic behavior:

- collect evidence
- refresh allowed data sources
- compute score deltas and outcome summaries
- propose better examples and highlight candidate prompt updates
- maintain audit history of what changed and why

Behavior that should require explicit approval at first:

- changing worker prompts
- changing profile routing
- changing the set of trusted outside-creator packs
- changing major scoring weights

## What This Unlocks

This model gives us:

- explainable profile evolution
- clearer rollback if a profile gets worse
- a stable way to compare manual edits against AI suggestions
- safer reuse of the same system for later clip suggestion and planning workers

## Consequences

If accepted:

- the implementation should include change history and profile versioning from the start
- "learning" UI should show proposed changes, not just hidden internal updates
- future bounded automation can still be added after the system proves stable

If rejected in favor of aggressive tuning:

- we will need a much stronger evaluation and rollback framework before trust is likely to hold

## Follow-Up Questions

- What kinds of changes should be auto-applied even in a supervised model, if any?
- Should profile changes be accepted one by one or in batches?
- Should the app keep a "last known good" version for each profile?
