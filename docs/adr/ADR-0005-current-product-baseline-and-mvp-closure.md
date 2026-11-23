# ADR-0005: Current Product Baseline And MVP Closure

- Status: `Accepted`
- Date: 2026-08-11

Partial supersession (2026-09-23): [ADR-0010](ADR-0010-version-one-beta-feature-scope.md) replaces the closeout-only scope with owned-video editing, local AI thumbnail generation and burned-in subtitles as required features for the two-tester beta. Other baseline decisions remain in force.

## Context

The repository contains several planning generations. They describe different stack choices, platform priorities, and stages of the long-form workflow. The implementation has now moved beyond the original MVP assumptions, so continuing to treat all dated plans as equally current creates avoidable scope and architecture conflicts.

The current branch has a working local Creator Workbench workflow covering Make, Edit, Performance, and Settings. It also has app-owned local AI runtime/model management, YouTube publishing and analytics, and the review-first long-form clip path.

## Decision

Adopt [Creator Workbench Current Product Plan And MVP Closure](../../creator-workspace-current-product-plan-2026-08-11.md) as the authoritative current product baseline.

The current baseline is:

- Electron + React + TypeScript + Vite.
- JSON-backed local persistence for the current single-user Windows MVP.
- FFmpeg and whisper.cpp for local media/transcription work.
- App-owned llama.cpp and managed GGUF models for local AI.
- YouTube-first external integration with manual-only performance pulls.
- Make -> Edit -> Performance as the primary workflow, with Settings as configuration.
- Review-first AI and user-approved external writes.

The MVP is feature-complete enough for extended real-life testing. The immediate priority is closeout hardening, UI/UX tuning, credential safety, and reliability findings from testing. New stack migrations and broad platform expansion are deferred.

## Consequences

- The old Tauri, SQLite, Ollama-first, and cloud-first suggestions are not current implementation decisions.
- Older documents remain history or feature detail, but must carry a superseded/current-plan pointer when their current-state claims are stale.
- New work should identify which current workflow and app action it extends before implementation.
- A future migration to Tauri or SQLite requires a new decision with data-contract, credential, model, and rollback planning.
- Commercial YouTube integration must be planned around least-privilege OAuth, local-first data handling, consent, revocation, and Google policy requirements.

## Follow-Up

- Complete the credential hardening backlog in the current product plan.
- Run extended real-life testing and record defects against the MVP exit gate.
- Add a new ADR before changing the desktop shell, persistence layer, OAuth scope model, or AI learning autonomy.
