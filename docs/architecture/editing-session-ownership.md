# Editing-session ownership

Implemented 2026-10-21.

`useEditingSession` tracks an asset visit, local draft revisions and superseding
requests. Returning from A to B to A creates a new visit even though the final ID
matches. Disposal prevents unmounted controllers/panels from updating their parent.
Its lifecycle supports the application's React StrictMode effect replay.

Edit metadata/transcript commands and Make source commands capture tickets before
awaiting work. A completion can update presentation only when the visit, revision
and request still match. Busy cleanup checks the latest request independently of
local edits so an invalidated result does not leave its own busy flag stuck or
clear a newer operation's flag.

Metadata generation/save, transcription, transcript saves, speaker assignment,
voice-sample messages, source discovery/recovery and stale errors use these guards.
The real timed transcript panel also guards its local draft, save callback and
busy/error state. Old callbacks cannot update a new asset visit.

Workspace refreshes reject abandoned clip/source selections. Metadata/transcript
background adoption also respects dirty draft state. A successful current save or
explicit record adoption clears that state; a superseded save completion leaves
newer edits protected against a later poll reading the earlier saved record.

The API call still receives the asset and draft captured by the initiating
handler. These are presentation guards: they do not cancel ongoing jobs, roll back
persistence or provide transactional version checks for concurrent backend writes.
Progress notifications remain asset-scoped. Publishing now has its own
[handoff and queue guards](publishing-workflow.md); broader workspace polling
policy remains in the shell.

Verification: real React StrictMode fixtures exercise twenty Edit cases, sixteen
Make cases and four timed-panel interaction cases. Deferred responses cover clip
switching, A/B/A visits, edits during saves/generation/assignment, stale failures,
unmount, captured save inputs and newer busy state. User testing was reported
successful; not every deferred-response race was manually reproduced.
