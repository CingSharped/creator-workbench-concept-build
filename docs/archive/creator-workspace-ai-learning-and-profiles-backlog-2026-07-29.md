# Creator Workspace AI Learning And Profiles Backlog

As of 2026-07-29.

This backlog turns the accepted AI decisions into an execution order for the current product.

Accepted decision set:

- [ADR-0001](../adr/ADR-0001-ai-learning-loop-strategy.md): retrieval plus local calibration
- [ADR-0002](../adr/ADR-0002-external-creator-data-scope.md): public signals plus manual notes and curated packs
- [ADR-0003](../adr/ADR-0003-ai-profile-architecture.md): hybrid cookbook profiles
- [ADR-0004](../adr/ADR-0004-learning-autonomy-and-governance.md): supervised local learning

## Summary

The next phase should make the existing profile foundation useful for more than one task, then connect that profile system to stronger owned-history retrieval, curated outside-creator packs, and supervised learning proposals.

The order below is meant to keep the system:

- local-first
- review-first
- explainable
- compatible with the current YouTube workflow

## Priority 1: Stabilize The New AI Profile Foundation

Goal:

- make the first shipped profile system safe and inspectable before we add more workers

Tasks:

1. show the active profile name and model consistently anywhere metadata generation runs
2. preserve profile version history when prompts or model preferences change
3. add reset-to-default behavior for built-in profiles
4. add validation rules for profile names, prompts, and preferred model fields
5. add tests for IPC, persistence, and generation-profile selection

Definition of done:

- the user can tell which profile ran
- built-in and custom profiles behave predictably
- profile edits are durable and reversible

## Priority 2: Add The Next Two Real Workers

Goal:

- move from one task to a small worker library

Workers to add:

1. `Trend Research Assistant`
2. `Historical Performance Analyst`

Tasks:

1. add new task types to the AI profile model and assignments
2. give each worker its own prompt contract and model preference
3. keep orchestration in app code rather than worker-to-worker autonomous calling
4. show worker-specific results in the Performance tab

Definition of done:

- at least three task workers exist in the app
- each task can use a different preferred model and prompt

## Priority 3: Owned-History Learning Into Metadata

Goal:

- make the imported YouTube history improve generation, not just the dashboard

Tasks:

1. connect imported owned-channel history into retrieval for metadata generation
2. rank examples by same-series first, then same-game, then channel-wide fallback
3. include actual performance-derived retrieval signals, not just snapshot existence
4. surface which examples were used for the current generation
5. add tests proving imported history can influence selected examples

Definition of done:

- historical imports materially change metadata retrieval
- the used evidence is inspectable in the UI or debug output

## Priority 4: Local Calibration Layer

Goal:

- turn outcomes into better weighting without moving to model fine-tuning

Tasks:

1. define a feature layer for:
   - approved vs edited vs rejected variants
   - engaged views
   - average viewed
   - likes and comments relative to reach where possible
   - series, game, and trend-match context
2. compute local calibration summaries per task and later per lane
3. let scoring and retrieval consume those calibration summaries
4. keep the first calibration layer read-only and inspectable

Definition of done:

- the app can explain why one example or warning was weighted more heavily than another
- no hidden prompt mutation is required to get better results

## Priority 5: Curated Outside-Creator Packs

Goal:

- let the app learn from other creators without depending on brittle or policy-grey ingestion

Tasks:

1. add a curated outside-creator pack model
2. store public metadata separately from user-authored notes
3. allow notes such as:
   - why this title worked
   - lane or audience
   - hook type
   - task relevance
4. attach packs to AI profiles as evidence sources
5. add refresh or staleness indicators for public API-backed records

Definition of done:

- outside-creator examples can inform workers
- the app makes clear what came from YouTube API data versus manual notes

## Priority 6: Supervised Learning Proposals

Goal:

- improve the system over time without silent drift

Tasks:

1. add profile change proposals instead of automatic prompt mutation
2. propose:
   - better retrieval packs
   - better worker prompts
   - better weighting rules
3. record proposal reason, supporting evidence, and accepted or rejected outcome
4. keep a last-known-good profile version

Definition of done:

- the user can review and approve meaningful AI behavior changes
- rollback is straightforward

## Suggested Execution Order

1. finish profile hardening around the shipped metadata worker
2. add `Trend Research Assistant`
3. add `Historical Performance Analyst`
4. connect owned history into metadata retrieval
5. add the first calibration layer
6. add curated outside-creator packs
7. add supervised learning proposal flows

## Explicit Non-Goals For This Phase

- model fine-tuning
- automatic prompt rewriting without approval
- mass outside-creator caption ingestion
- multi-agent autonomous profile orchestration
