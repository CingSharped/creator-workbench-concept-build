# AI activity sidebar

Implemented 2026-10-17.

AI Activity lives below navigation and stays mounted across Make, Edit, Performance
and Settings. The expanded sidebar shows task/asset labels, status, next-turn queue
position, stage detail, expandable model/timing information, and recent outcomes.
The collapsed sidebar shows an AI activity count and expands when clicked. Its
scrolling area keeps the existing Settings controls accessible.

## Ownership and updates

The canonical action executor tracks clip discovery, clip/video metadata generation,
thumbnail candidates and performance coaching. `aiActivityService` uses async context
to group each action's runtime requests into one user-facing task. The runtime
scheduler owns FIFO positions and active-turn transitions. Text and vision requests
share those events; no second execution queue is introduced.

States are preparing, waiting, loading, generating, processing, cancelling and the
terminal completed/failed/cancelled outcomes. Clip search reports transcript-window
and media-review stages. A task can yield between AI turns. Its displayed queue
position therefore describes its next AI request, not a promise about workflow
completion order. Concurrent visual requests remain grouped under the same task;
the active request's detail takes precedence over queued requests' details.

Main-process snapshots are versioned. The preload bridge exposes initial snapshot,
subscription and cancellation methods. The renderer subscribes before requesting the
initial snapshot and ignores older revisions. Snapshots contain presentation data,
not prompts or model responses. Failed observers cannot interrupt runtime work.

Find Clips cancellation invokes its existing workflow AbortController, which also
cancels its queued runtime requests and media analysis. Other actions expose no
Cancel button until workflow-wide cancellation is supported; the UI explains this
in Details. Terminal history is session-only, bounded to twenty records in memory;
the sidebar shows the five most recent. Existing persistent job recovery is unchanged.

## Validation

`test/aiActivity.test.cjs` covers workflow grouping, queue-position changes,
cancellation isolation, multi-request visual review, warnings/errors, snapshot
ownership and bounded history. Existing scheduler tests cover real runtime-adapter
integration. Build Electron before running tests because tests import `dist`.

The isolated fixture at `test/fixtures/aiActivityPreview.cjs` launches a temporary
profile and local Vite preview of the actual sidebar with fixture tasks. It touches
no workspace database, models or user media. Its controls verify expansion, details,
navigation persistence and cancellation UI. It does not establish live model or
connected-account acceptance.
