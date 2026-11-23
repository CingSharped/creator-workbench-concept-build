# Creator Workbench Data-Flow Improvement Checklist

Status: In progress
Last reviewed: 2026-08-15

This checklist improves the current local-first data flow incrementally. It preserves the Electron/React stack, preload contracts, JSON database, local AI runtime, manual-only platform refreshes, and compatibility IPC routes. Changes remain unstaged until user testing.

## Completed

- [x] Safety baseline: current dirty worktree preserved and nothing staged.
- [x] Baseline `npm.cmd run check` passed.
- [x] Baseline `npm.cmd run build` passed.
- [x] Baseline `npm.cmd test` passed with 99 tests.
- [x] Publishing records now persist operation and remote-outcome state.
- [x] Interrupted `posting` records become `reconciliation_required` on startup/shutdown.
- [x] Uncertain YouTube uploads never trigger an automatic re-upload.
- [x] Canonical `scheduled_posts.reconcile` action and preload method added.
- [x] Queued posts show a visible reconciliation warning and `Check YouTube` action.
- [x] Publishing migration and reconciliation regression coverage passes.
- [x] Post-slice `check`, `build`, and full 103-test suite pass.
- [x] Long-form cancel, partial-save/discard, proposal cancel/reopen, and layout preference writes route through canonical actions.
- [x] Data-health reports malformed clip/source/job records as protected review findings.
- [x] Data-health reports approved proposals whose approved clip relationship is missing.
- [x] Post-action-boundary `check`, `build`, and full 101-test suite pass.
- [x] Metadata variants and feedback retain local AI task/profile/model and input-record provenance.
- [x] Clip proposals and decision feedback retain local AI task/profile/model and source/transcript provenance.
- [x] Provenance excludes secrets, raw media, and prompt text.
- [x] Provenance regression coverage passes.
- [x] Renderer selection reconciliation keeps valid clip/source IDs and clears stale proposal context after refresh.
- [x] Renderer selection reconciliation regression coverage passes.
- [x] Background refresh observes current long-form source/proposal selection instead of clearing it from a stale interval closure.
- [x] Database rejects invalid present collection shapes instead of silently treating them as empty.
- [x] Invalid persisted-shape regression coverage passes while omitted legacy collections still migrate.
- [x] Source fingerprints are captured from normalized path, file size, media duration, and modified time.
- [x] Legacy clip and long-form records migrate with nullable fingerprint defaults.
- [x] Re-importing a compatible archived file reactivates its existing record.
- [x] Re-importing a changed file creates a new record instead of attaching old history silently.

## Next

- [ ] Complete the canonical action boundary for remaining mutation IPC routes (settings, credentials, exports, and legacy cleanup compatibility remain).
- [x] Add typed action request/operation context and redacted diagnostics.
- [x] Add runtime persistence validation and non-destructive invalid-record reporting.
- [x] Add source fingerprints for safe re-import identity.
- [ ] Complete cross-entity relationship validation and recovery reporting.
- [ ] Finish renderer workflow-session extraction and stale-state prevention.
- [x] Add a shared selection reconciler and integrate it into workspace/background refresh paths.
- [x] Add AI generation-input and feedback provenance.
- [ ] Run final Make → Edit → YouTube → captions → Performance smoke verification.
- [ ] Verify restart during long operations, credential safety, manual-only refreshes, and shared Ollama preservation.

## Publishing Recovery Policy

- A known remote video ID is checked directly through YouTube.
- A missing remote video ID remains manual-recovery-required; the app does not guess or re-upload.
- Caption retry remains separate and does not change video upload status.
- TikTok draft-handoff behavior is unchanged.
