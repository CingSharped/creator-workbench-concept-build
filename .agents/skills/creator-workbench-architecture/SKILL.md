---
name: creator-workbench-architecture
description: Inspect Creator Workbench source and show or refresh its current architecture diagrams, data flow and entity reference after implementation changes.
---

# Creator Workbench architecture

Work in the requested Creator Workbench checkout. Read repository instructions and
the dirty worktree first. This workflow inspects code and edits architecture
documentation; it does not authorize app changes, commits, model execution,
downloads, account access or publishing.

## Inspect and reconcile

Run `node <skill>/scripts/architecture-audit.cjs inspect <repo>` for the current
source inventory, workflow controllers, action registrations, JSON collections
and shared AI callers. This helper reads source without importing application
modules. It requires the checkout's existing TypeScript dev dependency.

Use that inventory to read the relevant implementations, not just filenames or
old diagrams. Follow renderer -> preload -> IPC -> canonical actions -> feature
services -> repositories/external systems. Check main-process startup/recovery,
runtime queue ownership, cancellation, media playback and persisted entities.
After later changes, `check` lists changed source paths to focus inspection.

Keep these distinctions visible when the source supports them:
- App navigation/selection/polling versus focused workflow controllers.
- The AI Activity presentation versus durable jobs versus the inference scheduler.
- Shared text/vision inference versus Whisper/FFmpeg and actual image synthesis.
- A reviewed draft handoff versus saved data and an external publishing action.
- Exported SRT versus canonical transcript, YouTube captions and burned subtitles.
- Direct references or nested settings versus real persisted collections.

Do not describe planned abilities as implemented. In particular, inspect thumbnail
output creation: copied frames with a vision brief are not image synthesis.
Separate current limitations from proposed improvements. Do not claim all
acceptance tests passed based on source inspection or earlier test counts.

## Output and show

Maintain `docs/architecture/creator-workbench-architecture.md` as the concise
current overview with Mermaid diagrams and an evidence table. Use a table row
`| \`src/path.ts\` | \`SourceSymbol\` | responsibility |` for each key boundary;
the audit checks those paths and symbol occurrences.

Reconcile affected statements and the entity diagram in
`docs/architecture/creator-workspace-data-flow-and-erd.md`. Link focused existing
architecture documents instead of duplicating their full details. Retain useful
history. Date source verification separately from automated and live acceptance.
Update the architecture plan only to reflect work actually completed.

Show a readable overview Mermaid diagram in the final answer, plus a clickable
absolute link to the full reference. Group details into additional diagrams in
the document if a single graph would be crowded.

## Verify and record

Run `node <skill>/scripts/architecture-audit.cjs snapshot <repo>` after source
inspection and documentation edits, then
`node <skill>/scripts/architecture-audit.cjs check <repo>`.
The snapshot lives at `docs/architecture/architecture-source-snapshot.json`.
These commands verify action registration coverage and evidence references, and
record hashes of source/configuration plus the overview and entity document.
A stale snapshot means reinspection is needed; do not refresh it just to silence
the check. The helper cannot prove diagram semantics or live app behaviour.

Finish when diagrams match inspected source, references and registrations check,
the snapshot is current, and the diagram has been shown to the user.
