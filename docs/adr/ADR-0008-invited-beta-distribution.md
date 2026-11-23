# ADR-0008: Invited Beta With Regular Updates

- Status: Accepted
- Date: 2026-09-23
- Scope: Delivery milestone and distribution access

## Decision

The next milestone is an invited Windows beta with regular application updates. The owner personally shares the installer link. Download and update access do not require authentication. Links can be forwarded; invitation is a distribution practice, not enforced access control. Source repository visibility is a separate choice and remains unchanged.

## Consequences

- No application accounts, invitation-token service or private-download authentication are required for this milestone. YouTube OAuth remains independently required for YouTube features.
- The installer and update feed may be served over public HTTPS. Do not embed repository credentials in the app.
- Hosting provider, signing arrangement and update UX remain implementation/design choices to settle; this decision does not provision services or publish a release.
- Recommended delivery design: one Beta channel, signed releases, automated build/check/package preparation, owner-approved publication and safe restart installation.
- Proposed beta acceptance: a clean installation and an installed version A-to-B upgrade preserve workspace data, models and credentials, with active-job and unsaved-edit protection. Retain existing hardening gates.

## Affected Documents

- [Product baseline](../../creator-workspace-current-product-plan-2026-08-11.md)
- [Release rollout](../../creator-workspace-release-rollout-plan.txt)
- [Reconciliation](../documentation-reconciliation.md)

This changes the release plan's previous Stable-first recommendation to Beta-first. Stable can be introduced when public release becomes the next milestone.
