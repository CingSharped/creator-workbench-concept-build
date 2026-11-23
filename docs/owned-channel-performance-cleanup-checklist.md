# Owned-Channel Performance Cleanup Checklist

Status: Automated implementation complete; manual acceptance remaining
Last reviewed: 2026-09-09

This checklist removes public YouTube trend functionality and persisted trend
data. Owned YouTube analytics, channel history, metadata, publishing,
thumbnails, captions, playlists, transcripts, clips, and Performance Coach
data must remain available.

## Tracking Rule

An item is checked only after implementation, focused verification, and the
relevant full checks pass. This is a deliberate one-way database cleanup. A
schema migration removes trend records and older builds may not open the
migrated database.

## Phase 1: Scope and Safety

- [x] Confirm the cleanup scope and baseline checks.
- [x] Inventory active and persisted public-trend references.
- [x] Preserve owned metadata-derived keyword analysis where applicable.
- [x] Preserve YouTube capabilities required by owned workflows.

## Phase 2: Destructive Data Migration

- [x] Add the next database schema version and ordered migration.
- [x] Delete `publicTrendRecords`.
- [x] Remove trend filter fields from saved Performance settings.
- [x] Remove persisted trend AI profiles and assignments.
- [x] Remove historical trend provenance fields.
- [x] Validate migrated data and preserve all non-trend records.
- [x] Add idempotent and failed-migration regression coverage.

## Phase 3: Contracts and Performance

- [x] Remove public-trend contracts and active dashboard fields.
- [x] Remove public-trend service behavior and network paths.
- [x] Simplify Performance state and filters.
- [x] Preserve owned channel panels, library, Analytics, and coaching.

## Phase 4: AI, Actions, and Services

- [x] Remove trend AI task, prompts, assignments, and settings UI.
- [x] Remove trend actions, IPC, preload, repository, and service exports.
- [x] Confirm no public-trend work can execute.

## Phase 5: Visual and Documentation Cleanup

- [x] Remove unused trend CSS and responsive rules.
- [x] Prevent stale compiled trend outputs from surviving Electron builds.
- [x] Update current product, architecture, README, and setup documentation.
- [x] Record the final removal decision without rewriting historical ADRs.

## Phase 6: Final Verification

- [x] Verify old databases migrate with non-trend data intact.
- [x] Verify new databases contain no trend collections or fields.
- [x] Verify Performance makes no public-trend API calls.
- [x] Verify owned YouTube workflows remain functional.
- [x] Run `npm.cmd run check`.
- [x] Run `npm.cmd run build`.
- [x] Run `npm.cmd test`.
- [ ] Complete manual connected, disconnected, refresh, and narrow-layout checks.
