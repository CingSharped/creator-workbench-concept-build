# Decision Log

Last reconciled: 2026-09-21.

November 2026 closeout. The repository preserves Creator Workbench as a
portfolio proof of concept. The invited-beta delivery and feature decisions
below remain as historical context. Any future 2.0 will be scoped separately.

This file is the repo-level index for major product and technical decisions.

Use this log when we need a durable answer to questions like:

- what decision was made
- why it was made
- what options were considered
- what evidence and constraints shaped it
- whether it is still current

## Status Meanings

- `Proposed`: ready for review, not locked yet
- `Accepted`: current direction
- `Superseded`: replaced by a newer decision
- `Rejected`: considered and intentionally not chosen

## Current Decision Set

| ID | Title | Status | Date | Summary |
| --- | --- | --- | --- | --- |
| [ADR-0001](docs/adr/ADR-0001-ai-learning-loop-strategy.md) | AI learning should use retrieval plus local calibration | Accepted | 2026-07-29 | Improve the app from outcomes without jumping to model fine-tuning. |
| [ADR-0002](docs/adr/ADR-0002-external-creator-data-scope.md) | External creator learning should use public signals plus manual notes | Accepted | 2026-07-29 | Learn from other creators safely without depending on brittle or policy-grey ingestion. |
| [ADR-0003](docs/adr/ADR-0003-ai-profile-architecture.md) | AI profiles should use a hybrid cookbook model | Accepted | 2026-07-29 | Combine task workers with creator, lane, and evidence overlays. |
| [ADR-0004](docs/adr/ADR-0004-learning-autonomy-and-governance.md) | Learning should remain supervised and local before any automatic tuning | Accepted | 2026-07-29 | Keep profile evolution inspectable and under user control. |
| [ADR-0005](docs/adr/ADR-0005-current-product-baseline-and-mvp-closure.md) | Current product baseline and MVP closure | Accepted | 2026-08-11 | Treat the built Electron/local-first YouTube workflow as the current baseline and focus next work on closeout hardening and extended testing. |
| [ADR-0006](docs/adr/ADR-0006-owned-channel-performance-focus.md) | Owned-channel performance focus | Superseded | 2026-09-07 | Retired public trends from active UI and services, initially with a temporary compatibility window. |
| [ADR-0007](docs/adr/ADR-0007-full-public-trends-removal.md) | Full public YouTube trends removal | Accepted | 2026-09-09 | Remove public-trend code and persisted data so Performance is exclusively focused on the creator's owned channel. |

## Operating Rules

Accepted 2026-09-23: [ADR-0010](docs/adr/ADR-0010-version-one-beta-feature-scope.md) makes owned-video editing, actual local AI thumbnail generation and burned-in subtitles the final feature scope before version one reaches two invited testers. It supersedes only ADR-0005's closeout-only scope; implementation and release acceptance remain open.

Accepted 2026-09-23: [ADR-0009](docs/adr/ADR-0009-feedback-evidence-and-approved-learning-changes.md) permits automatic relevant feedback evidence; saved prompt, model/task assignment and scoring-rule changes require explicit approval. It clarifies ADR-0004 without declaring implementation complete.

Accepted 2026-09-23: [ADR-0008](docs/adr/ADR-0008-invited-beta-distribution.md) sets an invited beta with regular updates and personally shared downloads without authentication. Hosting and signing choices remain open.

1. Every major decision should be recorded before implementation spreads across multiple files or workflows.
2. New decisions should link back to the planning docs they affect.
3. When a decision changes, do not overwrite history. Add a new ADR and mark the old one `Superseded`.
4. If implementation intentionally departs from an accepted ADR, the ADR must be updated or superseded in the same branch.
5. Newer accepted ADRs override only the decisions they explicitly supersede. Update affected baseline sections and add supersession notices to older ADRs in the same change.
6. Implementation, automated verification, manual acceptance and release readiness are distinct statuses. Source code alone does not accept a product decision.

The accepted beta feature, milestone and learning decisions are tracked in [documentation reconciliation](docs/documentation-reconciliation.md). Open implementation recommendations are not accepted decisions.

## Related Planning Docs

- [Current product plan and MVP closure](creator-workspace-current-product-plan-2026-08-11.md)
- [Active component-first UI plan](creator-workspace-component-first-ui-rebuild-plan-2026-08-08.md)
- [Archived planning documents](docs/archive/README.md)
