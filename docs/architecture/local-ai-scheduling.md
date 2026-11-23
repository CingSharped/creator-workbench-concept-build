# Local AI runtime ownership

Implemented 2026-10-07.

Text and vision generation share a FIFO scheduler. One request owns model discovery,
model/projector selection, startup, inference, response-body consumption and failure
cleanup. Compatible requests reuse the loaded process but execute sequentially.
The configuration identity uses the resolved model and projector paths.

Runtime installation/removal and model installation use the same queue, so they
cannot replace files or stop the process during an active generation. Status reads
remain independent. Existing model preferences and visible fallback notices remain
in effect; this change does not introduce additional model providers.

Cancelling a queued request rejects it promptly and skips its work. Cancelling an
active generation aborts its request and stops the app-owned process before the
next request runs, since closing an HTTP connection alone does not prove inference
has stopped. Timeouts cover the response body as well as the initial fetch. Failed
requests release ownership; a failed request does not poison the queue.

Disposal rejects new work, cancels pending/active requests, waits for their cleanup,
and stops the owned runtime. Nothing controls or terminates an external Ollama
process. The in-memory queue is not resumed after an application restart.

Validation uses delayed process/HTTP adapters and temporary model fixtures in
`test/localAiScheduling.test.cjs`. It checks serialization, model/projector identity,
process reuse, queued/active cancellation, runtime removal, startup disposal and
body timeouts. Existing runtime tests check startup failures and fallback attempts.
These tests do not measure real-model GPU performance.
