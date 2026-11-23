# ADR Guide

As of 2026-07-29.

This folder stores Architecture Decision Records for the Creator Workspace repo.

## File Naming

Use this format:

- `ADR-0001-short-kebab-case-title.md`

Keep the number stable forever. If a decision changes later, add a new ADR instead of renumbering old ones.

## Suggested ADR Shape

Each ADR should usually contain:

1. Title
2. Status
3. Date
4. Context
5. Decision to make
6. Options considered
7. Recommendation
8. Consequences
9. Follow-up questions or implementation implications

## Status Definitions

- `Proposed`: documented for review, not accepted yet
- `Accepted`: approved and safe to implement against
- `Superseded`: replaced by a newer ADR
- `Rejected`: intentionally not chosen

## Repo Convention

For this repo:

- product and workflow decisions can live in ADRs, not only low-level architecture choices
- decisions should prefer local-first, review-first, and inspectable behavior unless there is a strong reason otherwise
- external API and policy constraints should be cited when they materially limit product behavior

## Index

See the repo-level [decision-log.md](../../decision-log.md) for the current ADR index.
