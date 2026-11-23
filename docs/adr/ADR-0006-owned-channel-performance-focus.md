# ADR-0006: Owned-Channel Performance Focus

- Status: `Superseded by ADR-0007`
- Date: 2026-09-07
- Supersedes: public-trend portions of earlier Performance and AI profile decisions

## Context

Performance is used to understand and improve the creator's own YouTube channel. Public trend discovery added a second purpose, extra filters, separate network calls, and a trend-research profile that could make account analysis harder to understand and harder to operate safely.

## Decision

Retire public YouTube trend research from the active product surface. Performance refreshes and the Performance Coach use owned channel data, imported owned history, local workspace evidence, transcripts, speaker context, and saved creator knowledge only.

The original compatibility approach in this ADR was intentionally temporary. It was superseded by ADR-0007, which removes the public-trend collection, deprecated filter fields, trend provenance fields, and stored trend-research profiles through the schema 4 cleanup migration.

YouTube category lookup and owned-video metadata editing remain active. This decision does not remove channel analytics, publishing history, the owned channel library, metadata generation, or performance coaching.

## Consequences

- Performance has one clear purpose: account-focused analysis and improvement.
- Opening or refreshing Performance does not make public-trend network requests.
- Databases are migrated one way: owned records remain available, while public-trend data is removed from the persisted store.
- Older builds should not be used to open a database after the cleanup migration has run.
- Any future discovery feature requires a separate product decision, isolated service boundary, explicit user-facing purpose, and dedicated privacy/network review.
