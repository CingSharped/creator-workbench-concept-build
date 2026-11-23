# ADR-0007: Full Public YouTube Trends Removal

- Status: `Accepted`
- Date: 2026-09-09
- Supersedes: public-trend portions of ADR-0002, ADR-0003, and ADR-0006

## Context

Creator Workbench is focused on the creator's own media, YouTube account,
publishing history, and owned-channel performance. Public YouTube trend
discovery added unrelated filters, network requests, UI panels, AI profile
assignments, and persisted cache data. Keeping those paths would leave the
product and its data model split between creator workflows and public research.

## Decision

Remove public YouTube trend functionality completely from the active product.
Performance uses owned YouTube analytics, imported owned history, local
workspace evidence, transcripts, speaker context, and saved creator knowledge.
The schema 4 migration removes `publicTrendRecords`, public-trend filter
values, trend-research profiles and assignments, and historical trend
provenance fields. The migration preserves all non-trend records and is
idempotent.

Trend-specific actions, preload contracts, services, prompts, settings, and
renderer panels are removed or retired without any network fallback. YouTube
category lookup, the owned channel library, metadata editing, publishing,
captions, thumbnails, and Performance Coach remain active.

## Consequences

- Performance has one clear purpose: understand and improve the user's owned channel.
- Opening or refreshing Performance cannot make a public-trend API request.
- A database migrated to schema 4 must not be opened by an older build that expects the removed collection or fields.
- Future external research requires a separate product decision, isolated service boundary, explicit user-facing purpose, and dedicated privacy/network review.
