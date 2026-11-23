# ADR-0010: Final Version-One Feature Scope for Two-Testers Beta

- Status: Accepted
- Date: 2026-09-23
- Supersedes: ADR-0005's closeout-only scope, only where it excludes the feature completion below
- Complements: ADR-0008 distribution and ADR-0009 learning governance

## Decision

Before releasing version one to two invited testers, bring owned-video editing, actual local AI thumbnail generation and burned-in subtitle export to a working, verified state. Retain Electron. These are the final feature areas before beta; release-critical hardening remains required.

Owned-video editing largely has the desired functionality: AI metadata suggestions and reviewed single/bulk updates. Close reliability and evidence-grounding gaps and verify the supported API field matrix.

Thumbnails require local image synthesis, multiple candidates, user selection and explicit application through the YouTube API where supported. An optional custom description prompt has highest creative priority; local context and video frames support it. The AI profile supplies reusable thumbnail guidance and output constraints. JPEG is accepted; dimensions, default candidate count and backend/model remain open. Copying frames or existing thumbnails is not completion of this feature.

Burned-in subtitles use the existing review/transcript/speaker/trim/export workflow and produce a separate video copy. Carry forward minimal placement/size controls, speaker-profile colours and source preservation. Follow-up accepted 2026-09-23: clips only for beta; direct long-form subtitle export is deferred.

Follow-up accepted 2026-09-23: Settings Local AI Setup must scan hardware and recommend suitable AI options for app processes from public providers such as Hugging Face/GGUF repositories. Its existing fixed catalogue/hardware thresholds are a partial foundation. Task-specific suitability and the local image-generation setup path must be completed before beta. Model/task assignment changes remain user-approved. Backend choice and curated catalogue versus live discovery details remain implementation decisions.

## Consequences

The earlier feature-complete-enough baseline is not sufficient for this beta. The [product plan](../../creator-workspace-current-product-plan-2026-08-11.md) owns detailed behavior, current gaps and acceptance criteria. The [release plan](../../creator-workspace-release-rollout-plan.txt) owns installation, signing, updates, recovery and tester readiness.

Version one is a milestone name, not an approved package version. Acceptance of this design does not assert implementation, successful live API tests, or authorization to publish. Automatic feedback evidence must not silently change saved prompts, model/task assignments or scoring rules.
