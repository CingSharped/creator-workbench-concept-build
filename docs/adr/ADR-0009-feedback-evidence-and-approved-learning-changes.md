# ADR-0009: Automatic Feedback Evidence, Approved Configuration Changes

- Status: Accepted
- Date: 2026-09-23
- Clarifies: ADR-0004; its other supervision requirements remain in force

## Decision

Automatically use relevant feedback as evidence for generation and recommendations. Require explicit user approval before changing saved prompts, model/task assignments or scoring rules, including scoring weights.

Feedback may be selected and summarized into a request's evidence context without approving each retrieval. This permission does not authorize rewriting persistent instructions or configuration, or treating feedback text as instructions to perform actions. Proposal approval, publishing and external-data access retain their existing review/manual boundaries.

## Implementation acceptance criteria

- Evidence use does not mutate saved prompts, model/task assignments or scoring configuration.
- Suggested configuration changes show the proposed difference and supporting evidence; rejection leaves configuration unchanged, and application requires explicit approval.
- Record approved configuration changes and their prior values for audit and recovery.
- Test that generation using feedback cannot silently change protected configuration.

Evidence relevance, profile isolation, cross-profile sharing and duplicate-feedback handling need implementation design and verification. This decision does not declare the existing global feedback aggregation acceptable or fully implemented.

## References

- [Original governance decision](ADR-0004-learning-autonomy-and-governance.md)
- [Product baseline](../../creator-workspace-current-product-plan-2026-08-11.md)
- [Reconciliation](../documentation-reconciliation.md)
