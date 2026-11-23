# Publishing workflow ownership

Implemented 2026-10-22. Objective 4 of the architecture improvement plan.

`usePublishingWorkflow` owns the composer, scheduled posts, recurring settings,
next-slot reads, queue status refresh, caption retries and uncertain-upload
reconciliation. `useYouTubePlaylists` owns the connected account's catalogue and
the current clip's selected playlists. Both use narrow, injectable preload APIs.

The shell retains navigation, clip/source selection and lists, connection/OAuth,
data management and the background polling policy. Its post-list reads go through
a captured acceptance callback; they cannot overwrite a subsequent publishing
mutation. Cleanup is disabled while publishing or recovery is active.

## Reviewed handoff

Edit's `captureReviewedMetadata()` produces a copied package with an explicit
clip ID and guarded save acknowledgement. Publishing snapshots that package,
playlists, platform, account and time before awaiting work. It does not read a
different clip's draft later or reselect the original clip after completion.

A current save acknowledgement advances Edit's revision, invalidating polls that
started during the save. Acknowledgement and workspace refresh are ignored if the
user has edited again or left that clip visit. Metadata generation superseded by
the handoff cannot subsequently replace the reviewed draft.

The existing backend actions still save metadata and create the scheduled post.
YouTube creation uploads immediately and hands scheduling to YouTube when
supported; TikTok retains its local draft handoff. No new automatic publishing,
retry, rollback or cross-process transaction is introduced.

## Queue and connection guards

- Synchronous locks prevent duplicate create requests and overlapping recovery
  actions for the same post.
- Queue revisions reject obsolete background snapshots. Per-post versions stop
  an older status refresh overwriting completed caption or reconciliation work.
- Recovery updates its original post independently of the selected Edit clip.
  Failed mutations reload persisted queue state without repeating the upload.
- Account changes during preparation stop the external creation stage. Playlist
  responses require the same account visit/request, including A/B/A transitions.
- Playlist refresh prunes the latest choices only for the initiating clip visit;
  it preserves a different clip's choices.
- Initial settings reads cannot replace an explicit subsequent save. Failed
  next-slot reads do not turn a successful settings save into a reported failure.
- Disposal prevents presentation updates and starting a later upload stage.
  It does not cancel a backend action already dispatched.

These renderer guards do not replace backend uncertain-upload reconciliation,
confirmation checks or persistence safeguards. Connections can still change after
an upload has been dispatched; the main process owns that operation's outcome.

## Verification

TypeScript checks, production renderer/main builds and all 211 Node tests passed.
The publishing suite contains 17 real React scenarios in isolated hidden Electron,
plus two new Edit handoff scenarios (22 total). Deferred responses exercise
selection/account changes, captured inputs, duplicate requests, older snapshots,
recovery failure, settings races and unmount. APIs are mocked: no YouTube upload,
real account switch or live publishing acceptance occurred in these tests.

Live checks: schedule a deliberately chosen clip, switch clips during the
operation, and verify the new draft/selection remains intact and the original
post appears in the queue. Verify playlist refresh, recurring settings and
available caption/reconciliation actions. Real uploads remain explicit user
actions.
