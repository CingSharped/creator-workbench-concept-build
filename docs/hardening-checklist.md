# Creator Workbench Hardening Checklist

Status: In progress
Last reviewed: 2026-09-16

An item is checked only after focused verification and the relevant full checks pass. Existing unrelated work in the working tree is preserved and is not implied by this checklist.

## Completed

- [x] Confirm branch and preserve dirty worktree.
- [x] Run `npm run check`.
- [x] Run `npm run build`.
- [x] Run the full test command.
- [x] Inventory the action catalogue, preload API, IPC handlers, persistence collections, and major UI entry points.
- [x] Identify duplicate action/legacy IPC boundaries and compatibility paths.
- [x] D1: Create and verify the data-flow and ERD architecture record.
- [x] H1: Add a complete test command and action/preload contract coverage.
- [x] H2: Add schema version `1`, migration normalization, atomic JSON writes, recovery-file handling, and regression tests.
- [x] H3: Route the covered legacy mutation channels through the canonical action executor and verify the adapters.
- [x] H4: Add explicit job ownership and approved-clip lineage validation, preserving compatibility aliases.
- [x] Recovery slice: protect terminal job states from late callbacks, cover queued/running shutdown interruption, and verify idempotent publishing reconciliation.

## In Progress

- [x] H5 slice: Extract renderer workflow selectors, formatting, the Clip Library status pill, and review selection derivation without changing visible behavior.

## Next

- [ ] Recover or interrupt general queued/running jobs on startup after forced termination; distinguish this from verified orderly-shutdown handling.
- [ ] Add dirty-draft save/discard/cancel navigation and session identity guards for metadata/transcript save responses.
- [ ] Preserve imported outputs when proposal approval fails after library adoption, or roll back file and records consistently.
- [ ] Preserve and report an existing empty/whitespace database as a recovery condition instead of silently replacing it.
- [ ] Resolve AI learning governance and evidence scope before extending adaptive behavior; track the decision in the reconciliation record.

- [ ] H5: Extract remaining screen containers and domain state modules from `App.tsx`.
- [ ] H6: Remove only individually proven dead code after static, dynamic, persistence, test, and smoke verification.
- [ ] V1: Run final type-check, build, full workflow smoke, shutdown, refresh, credential-safety, and shared-Ollama checks.

### H6 audit note

The standalone `src/electron/services/ollamaRuntimeService.ts` has no static import, preload exposure, IPC registration, dynamic reference, test reference, or active documentation reference. It is nevertheless an untracked file with no Git provenance in this worktree, so it was deliberately not deleted. The current app-owned runtime only contains compatibility logic for reading the Ollama model store; this audit does not prove that the untracked file is safe to remove.

## Verification Record

2026-09-21 design review: type-check passed; Electron compilation and Vite production build passed into temporary output; all 150 tests passed against freshly compiled Electron/shared code. This was not installer, live YouTube, crash-restart or visual acceptance. The records below describe earlier slices. `npm test` imports `dist`, so a fresh Electron build must precede it.

- `npm.cmd run check`: passed after the recovery hardening slice.
- `npm.cmd run build`: passed after the recovery hardening slice.
- `npm.cmd test`: passed, 149 tests, latest run 2026-09-16.
- H4 focused tests: passed, 11 tests covering migration, archive/re-import, job ownership, lineage validation, cleanup, and shutdown job state.
- H5 focused presentation and selection tests: passed as part of the full 149-test suite; `npm.cmd run check` and `npm.cmd run build` passed after extraction.
- Recovery focused tests: passed, covering queued and running interruption, repeated interruption marking, terminal-state protection from late status/progress callbacks, and idempotent scheduled-post reconciliation.
