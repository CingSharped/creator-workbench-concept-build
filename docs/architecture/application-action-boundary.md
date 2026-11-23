# Application action boundary completion

Implemented 2026-10-23. Objective 5 of the architecture improvement plan.

The remaining renderer-requested writes now delegate to the canonical executor.
Native file/directory pickers, cancellation of those pickers, subscriptions, read
handlers and AppInfo formatting remain in IPC. Services retain their existing
persistence, runtime and external-operation implementations.

## Migrated operations

`registerRemainingActions.ts` adds 32 catalogue actions:

| Area | Operations |
| --- | --- |
| Settings | Tool paths, workspace folders, transcription backend, automation and strict AI |
| Profiles | Creator links, collaborator profiles, explicit AI profile/assignment saves, voice capture/record/removal |
| Local AI setup | Asset downloads, recommended setup, runtime/model imports, runtime clearing and download/activity cancellation |
| YouTube | Credential save/clear, connect/disconnect and per-post analytics refresh |
| Workspace/exports | Legacy index archive, stacked clip export, long-form exports and SRT export |

Trimmed clip export now uses its already-existing canonical action.
Public preload method names, arguments and return values remain compatible.
Settings adapters still return AppInfo after a successful write. Cancelled native
pickers return without dispatching a mutation. Recovery, inference and publishing
policies are unchanged.

## Validation and confirmation

`remainingActionSchemas.ts` validates unknown inputs before services run: enum
keys, actual booleans, nested profile/assignment shapes, timed voice segments,
recording bytes, export ranges/layout and output paths. SRT destinations must have
an SRT extension. Setup IDs are checked against the existing asset catalogue;
recommended runtime and model IDs cannot be swapped.

Validation errors expose field paths rather than credentials, prompts or
recording contents. Existing service validation remains responsible for media
availability, account state, safe MP4 rendering and domain-specific constraints.

Export/index actions require confirmation through the generic API. AI profile
saves also require confirmation, preserving ADR-0009's explicit approval rule
for saved prompts and model/task assignments. Compatibility UI adapters supply
confirmation for the user's explicit action as before; no extra dialog is added.

The executor supplies request/operation identifiers. This change does not add a
persistent audit history, transaction rollback, operation deduplication or
automatic retries. ADR-0009's broader durable configuration-history requirement
remains separate work; action confirmation alone does not implement it.

## Verification and limits

TypeScript checks, production builds and all 222 Node tests passed. Ten new
behaviour tests exercise validation before side effects, explicit false values,
watcher refresh, saved profile contents, voice ownership/bytes, setup cancellation,
real failure propagation, credential-safe errors, confirmation, export ownership
and IPC adapter results/picker cancellation.

Architecture checks cover the new adapters and prevent IPC from importing
write-service functions again. The runtime tests use mocked services and IPC:
they do not perform OAuth, downloads, real recording analysis or media rendering.

A full Electron restart is required before live acceptance. Check a deliberate
Settings save, cancellation of a file picker, voice sample handling and a local
export. YouTube reconnection and downloads remain optional explicit live actions.
