# ADR-0003: AI Profiles Should Use a Hybrid Cookbook Model

- Status: `Accepted`
- Date: `2026-07-29`

> Public-trend workers and overlays below are superseded by [ADR-0007](ADR-0007-full-public-trends-removal.md). The remaining hybrid cookbook direction is accepted design, not a claim that composable overlays, revision history or rollback are implemented. The Context section describes the original decision date. See [current reconciliation](../documentation-reconciliation.md).

## Accepted Selection

- `Option C: Hybrid cookbook`

## Context

The user wants something closer to a "cookbook" system:

- choose which AI handles a task
- customize prompting
- assign specific work to specialized profiles
- enrich those profiles with useful data over time

The current app does not have that structure yet.

Today, the metadata workflow is closer to:

- one main generation path
- one preferred Ollama model-selection list
- one review workflow
- a shared local scoring layer

At the same time, the app already has a strong profile pattern on the human side:

- creator links
- collaborator profiles
- creator and collaborator voice samples
- shared reusable context across workflows

That makes a profile-based AI system a natural next step.

## Decision To Make

What should the main unit of AI customization be?

## Options Considered

### Option A: Task-first workers

Definition:

- profiles are workers like `Title Packager`, `Description Refiner`, `Trend Researcher`, and `Historical Analyst`

Pros:

- clear routing
- easy debugging
- maps well to existing workflows

Cons:

- style and audience fit become secondary overlays, not first-class organizing concepts

### Option B: Persona-first profiles

Definition:

- profiles are creator-style or brand-style identities first, then reused across tasks

Pros:

- intuitive
- good for creative experimentation

Cons:

- task behavior and style behavior get mixed together
- harder to know what actually caused quality changes

### Option C: Hybrid cookbook

Definition:

- create task workers as the stable base
- let them attach optional overlays for creator style, lane, audience, game, series, and evidence packs

Pros:

- strongest long-term fit
- keeps routing clear while still allowing strong specialization
- matches the user's stated goal best

Cons:

- more schema and UI work than a single-profile system

## Recommendation

Choose `Option C: Hybrid cookbook`.

## Proposed Model Shape

### Base worker profile

A base worker should define:

- task kind
- preferred model or provider order
- system prompt
- input requirements
- output contract
- evaluation rubric
- allowed evidence sources

### Optional overlays

Overlays should be composable and narrow. Examples:

- creator voice overlay
- gaming overlay
- specific game overlay
- series overlay
- trend research overlay
- outside-creator pattern pack

### Why this shape is useful

It lets us say:

- use the `YouTube Shorts Title Packager`
- with the `Splempy gaming` overlay
- plus the `Gears of War` overlay
- plus the `NPC series` overlay
- plus the `outside creator title pack A`

That is much clearer than one giant persona blob.

## Suggested First Worker Set

Reasonable first workers:

- `YouTube Shorts Title Packager`
- `YouTube Description Refiner`
- `YouTube Tag and Hashtag Builder`
- `Trend Research Assistant`
- `Historical Performance Analyst`

Later workers:

- `Clip Ranker`
- `Hook Risk Reviewer`
- `Series Planner`

## Product Implications

If accepted, the app should eventually expose:

- profile list and status
- task assignment rules
- prompt editing
- attached evidence packs
- change history
- profile-level evaluation notes

The first UI version does not need all of that at once.

## Consequences

If accepted:

- the current single metadata-generation path should evolve into a provider and worker routing layer
- learning data should attach to workers and overlays, not only to a single global metadata system
- future features like clip suggestion and planning can reuse the same profile pattern

If rejected in favor of persona-first profiles:

- the system will be easier to explain creatively, but harder to reason about technically

## Follow-Up Questions

- Should overlays be stackable in arbitrary combinations or only in approved bundles?
- Should a profile own its own evaluation rubric, or share a task-level default rubric?
- Should one profile be able to call another, or should orchestration stay in app code?
