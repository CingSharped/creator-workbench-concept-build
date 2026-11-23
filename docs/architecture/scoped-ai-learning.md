# Scoped AI learning and context

Implemented 2026-10-21; live acceptance pending.

Relevant feedback remains automatic evidence under ADR-0009. Learning context
builders are read-only and do not rewrite saved prompts, model/task assignments,
learning settings or scoring weights.

`aiLearningScope.ts` selects feedback by its recorded originating task and profile.
It does not infer origin from whichever profile is currently assigned. Records
without usable provenance remain stored but are excluded from automatic scoped
learning. Cross-profile sharing is not enabled.

Metadata decisions are deduplicated by variant; clip decisions by proposal.
Newest timestamps win, with later append order breaking ties. Deduplication occurs
before scoping so an older decision cannot be revived accidentally. Reopening a
proposal removes its earlier approval/rejection from the current learning sample.
Approved/rejected inclusion flags are respected.

Metadata approved/rejected/high-performing example selection also requires matching
selected-variant provenance for every populated package field. Manual packages,
missing variants and packages combining profiles are conservatively excluded.
This closes a separate cross-profile path through current saved clip packages.
Series preference and owned performance ordering still operate within that scope.

## Context limits

- Up to 100 recent deduplicated feedback records per task/profile sample.
- At most the configured knowledge-entry count, capped at 50; titles, tags and
  content are individually bounded, with a 6,000-character knowledge-text budget.
- At most 9,000 characters in the assembled profile-learning prompt.
- Up to five quoted rejection notes of 240 characters each.
- Up to three metadata examples per category, with bounded title, description,
  context and tag fields.

These are learning-context limits; current transcript evidence and other
feature-specific input limits retain their existing policies. Current clip
evidence remains authoritative over style examples and profile guidance.

`buildAiProfileLearningContext` returns the prompt plus versioned provenance
containing selected knowledge and feedback IDs. Metadata variants and clip
proposals store this optional manifest alongside existing example/source IDs.
Discovery snapshots its learning context once for the transcript windows and
visual review, so the recorded identifiers match that request's context.
No prompt text or secrets are added to the manifest.

Existing scoring formulas and saved weights are unchanged. Scoped example
selection can affect scores that already depend on available evidence counts;
that is an evidence-input change, not an automatic scoring-rule rewrite.

Nine focused tests cover task/profile isolation, unknown provenance, repeated
decisions/timestamp ties, reopening, flags/modes, context bounds, package ownership,
read-only construction and persisted manifest IDs. TypeScript checks, production
builds and all 210 Node tests passed.

Live acceptance: after a full Electron restart, generate metadata and Find Clips
normally; confirm that profile settings remain as saved. Model-output quality and
precise profile isolation rely on the deterministic fixtures as well as live use.
