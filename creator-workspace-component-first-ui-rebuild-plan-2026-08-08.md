# Creator Workbench Component-First UI Rebuild Plan

Status: Partially implemented design reference; remaining proposals and acceptance are open
Date: 2026-08-08
Last reconciled: 2026-09-21
Scope: Frontend composition and component architecture only. No code, dependency, runtime, data, or technology migration is included in this document.

## Intent

Shared shell, media/transcript components, styling layers and primitives are implemented. This does not establish full workflow parity, accessibility or visual acceptance. Dirty-draft navigation protection, save-result session guards and screen/domain-state extraction remain open. The migration sequence below is the original proposed sequence, not a record that every step was followed. See [reconciliation status](docs/documentation-reconciliation.md) and the [styling reference](docs/architecture/renderer-styling-system.md).

Rebuild the Creator Workbench frontend around the supplied visual references while keeping the real local-first workflow intact. The references are design direction, not pixel-perfect requirements. Every visible action must remain connected to an existing backend action or be explicitly marked as unavailable until its implementation exists.

The rebuild should preserve:

- local clip and long-form source files and their existing paths
- transcripts, timed segments, SRT exports, speaker assignments, and voice samples
- proposal lineage, approval/rejection state, trim/export outputs, and clip library placement
- metadata candidates, saved packages, scheduling, YouTube publishing, and performance data
- local llama.cpp models/runtime, Whisper/FFmpeg tooling, operation progress, cancellation, and fallback/Strict AI reporting
- the typed `window.creatorApp` preload boundary and the shared action catalogue

## Visual References

Use these supplied images during implementation and review. They are conceptual references and should not be copied as static screens:

- Edit package and publishing reference
- Make Clips review reference
- Settings and Local AI reference
- Performance reference
- SchedulePostComposer reference

## Design Foundation

### Tokens

Define tokens once and consume them through components. Avoid page-specific colors and spacing.

| Token family | Initial direction | Use |
|---|---|---|
| Surfaces | near-black canvas, charcoal panels, slightly lighter controls | app background, shell, cards, inputs |
| Primary | violet to purple gradient, pale lavender text/highlight | primary action, selected navigation, focused controls |
| Semantic | green success, amber warning, red error; restrained and never decorative | operation and validation status only |
| Text | high-contrast white, muted lavender-gray secondary text, subdued tertiary text | hierarchy and explanatory detail |
| Border | low-contrast charcoal, violet selected border, semantic status border | grouping and focus |
| Typography | expressive display/title face paired with a highly legible UI face | screen titles, labels, body, numeric data |
| Spacing | 4px base scale with named gaps for control, card, section, and shell spacing | consistent rhythm across all screens |
| Radius | small control radius, medium card radius, large workspace panel radius | hierarchy without excessive pill styling |
| Elevation | subtle dark shadow and inset border, stronger selected/overlay elevation | panel separation and transient UI |
| Motion | short enter/selection transitions; no motion required to understand status | feedback without slowing work |

Required token states include default, hover, pressed, focused, disabled, selected, loading, success, warning, error, and interrupted. Contrast must remain readable in every state.

### Layout primitives

Build and test these before composing screens:

- `AppShell`: desktop window frame, sidebar, content header, activity access, responsive navigation
- `SidebarNav` and `CompactNav`: primary route and settings sub-route selection
- `PageHeader`: title, subtitle, source/context metadata, status and last-activity slot
- `Panel`, `Card`, `SectionHeader`, `Divider`, `Stack`, `Cluster`, `SplitPane`, and `ScrollRegion`
- `Button`, `IconButton`, `ButtonGroup`, `Select`, `TextInput`, `TextArea`, `TimeInput`, `DateTimeInput`, and `Toggle`
- `Badge`, `StatusBadge`, `ProgressBar`, `ProgressRing`, `EmptyState`, `InlineError`, `Alert`, `Tooltip`, `Popover`, `Modal`, `Toast`, and `ConfirmDialog`

These primitives own padding, focus rings, disabled behavior, keyboard semantics, and responsive rules. Feature screens should compose them rather than restyle native controls independently.

## Component Families

### Shell and navigation

- `AppShell`: keeps route, workflow selection, active operation access, and unsaved-change interception visible.
- `PrimaryNavItem`: Workspace, Make Clips, Performance, Settings with icon, label, selected state, and keyboard focus.
- `SettingsNav`: Workspace, Local AI, Publishing, People, Automation sections.
- `WorkflowStepper`: Import -> Transcript -> Package -> Schedule -> Performance for clips; source intake -> proposals -> review for long-form.
- `ContextHeader`: selected asset, source, duration, resolution, frame rate, timestamps, and current status.

### Cards, status, and operations

- `StatusBadge` and `StatusIcon`: queued, running, completed, warning, failed, cancelled, interrupted.
- `OperationCard`: phase, honest percent/elapsed/ETA basis, message, cancel button only when cancellable, retry/open-result action.
- `ActivityTray` and `ActivityRow`: active and terminal jobs linked to the asset/proposal; no stale running state after shutdown.
- `NextActionCard`: derives one action from actual prerequisites and routes to the same action executor as the main button.
- `ReadinessChecklist`: individual checks with fix/open action and no fake completion.

### Media and source controls

- `SourcePicker`: import existing clips or long-form sources, validate path, show source-library destination, and preserve original files.
- `MediaThumbnail` and `AssetQueueRow`: duration, state chips, indexed/source status, remove action at the edge.
- `VideoPlayer`: source and vertical-preview modes, stable controls, error state, accessible labels, keyboard shortcuts.
- `PlaybackControls`: play/pause, volume, fullscreen, 5-second and 1-second skips, frame step, current time and duration.
- `Timeline`: playhead, selected range, seek click/drag, frame-accurate fields, trim boundaries, and non-destructive loop.
- `TrimControls`: start/end time inputs, step controls, preview loop, reset, and export-to-new-file action.
- `VerticalLayoutEditor`: two crop/focus regions for stacked output, preview-only until export, validation of source dimensions.

### Transcript and speaker review

- `TranscriptPanel`: timestamped scroll region, active line, search, speaker chips, and mode switch.
- `TranscriptSegmentRow`: seek target, text, timestamp, speaker, confidence, review state, and edit affordance.
- `TranscriptEditor`: text/timestamp/speaker edits in one draft; one atomic save updates canonical transcript and derived SRT.
- `SpeakerReviewPanel`: All, Needs review, and Unassigned filters; manual assignment and confidence/reason display.
- `VoiceSampleActions`: auto-assign, scoped rerun, save sample, remove sample, and operation result.
- `UnsavedChangesGuard`: save/discard/cancel before changing asset, mode, or route.

### Proposals and decisions

- `ProposalQueue`: scrollable list, Needs review/Approved/Rejected filters, selected state, count, and source range.
- `ProposalCard`: hook, reason, confidence, AI/fallback state, visual/audio evidence, timestamps, and decision state.
- `ProposalEvidence`: concise transcript, visual limitations, sampled frame timestamps, and audio/scene signals.
- `DecisionBar`: approve, reject with optional reason, reopen decision, open approved clip; prevents duplicate approval requests.
- `LineageSummary`: source file, source time range, derived output path, and clip-library destination before render.

### Metadata and publishing

- `CandidateGroup`: grouped title, description, and tags from one YouTube metadata task; option count and generation status.
- `CandidateOption`: select, edit, reject/feedback, score, source, and selected state.
- `MetadataPackageEditor`: selected package fields, tags, series/game/collaborators, dirty state, and validation.
- `AiExecutionBanner`: profile, model, AI/fallback/strict-AI mode, warning, and recovery action.
- `PublishReadinessCard`: score/checks and targeted fixes.
- `SchedulePostComposer`: a compact horizontal card based on the supplied reference, with three responsive columns separated by subtle vertical rules: `Publish readiness` with short helper text; `YouTube account` with selected channel/avatar, handle, connected state, and account dropdown; and `Publish time` with local date picker, time dropdown, and `Your time (Local)` helper. The scheduling CTA sits immediately below/after this composer, while queued posts remain separate cards. It owns the scheduling draft and validation display, but never schedules implicitly as a side effect of editing or saving unrelated fields.
- `QueuedPostCard`: a title-only collapsed queue item with an accessible disclosure control. Its expanded body reveals the selected clip/video detail, thumbnail or source, platform, status, scheduled time, saved metadata summary, and actionable error state without duplicating platform refresh controls.

### Performance and settings

- `FilterBar` and `FilterChip`: draft owned-channel filters, explicit Apply/Reset, and no platform call on typing.
- `DataFreshnessCard`: cache timestamp, last platform pull, manual-only refresh action.
- `MetricCard` and `PerformanceEvidenceCard`: value, comparison, sparkline, scope, and unavailable/stale states.
- `InsightCard` and `HandoffCard`: owned-channel AI takeaways, selected clip, and one-click handoff.
- `RuntimeHealthCard`, `GpuBackendCard`, `ManagedModelTable`, `ProfileEditor`, and `TaskAssignmentMatrix`: real runtime/model/profile state, dropdown model selection, missing-model recovery, and save/cancel.
- `FolderSetting`, `CredentialSetting`, `PeopleProfile`, and `DangerZone`: path validation, protected credentials, speaker profiles, and explicit non-source-deleting cleanup.

## Screen Composition

### Workspace / Edit

Use the Edit reference as a three-zone package screen:

- left navigation and asset context
- center candidate groups plus selected title/description/tags editor
- right readiness, AI profile/model state, Save Package, and Schedule Post

Functional requirements:

- selecting a candidate updates the real metadata draft, not only visual selection
- title, description, and tags remain one task and save as one package
- Save Package must complete before Schedule Post is enabled
- Fix actions modify the draft or open the relevant editor; they do not silently schedule
- fallback/Strict AI status remains adjacent to generation results
- `SchedulePostComposer` uses existing validation and publishing IPC. Its primary CTA is disabled until the required saved package, account, and platform prerequisites exist, and loading/error states identify whether save or scheduling is in progress.
- The composer collapses to a clearly ordered vertical layout at narrower widths without changing field semantics. The selected YouTube account and connection state are real data, not decorative avatar content; an unavailable account exposes the existing Settings recovery path.
- `QueuedPostCard` is collapsed by default to keep the queue scannable. A real `<button>` disclosure control exposes `aria-expanded` and `aria-controls`; Enter and Space toggle the body, focus remains on the disclosure control, and the expanded region has a predictable heading/label for screen readers.
- Queue variants cover loading, empty, collapsed, expanded, scheduled, publishing, published, failed, and unavailable/removed-clip states. Failures remain visible in the card and do not trigger a retry or publish action without an explicit user click.
- Scheduling and publishing are never silent: no card expansion, metadata save, navigation, or background status refresh may initiate an upload or schedule operation. The user must activate the clearly labelled CTA in `SchedulePostComposer`.
- The Edit queue may show last-known performance/status timestamps and a contextual `Open Performance` navigation action, but it must not contain a duplicate performance refresh button.

### Make Clips

Use the Make reference as the main long-form review composition:

- left scrollable proposal queue with filters and decision status
- center player, source/vertical toggle, timeline, trim, and vertical layout controls
- right transcript/speaker review mode switch with timestamped rows and voice matching actions

There are no misleading separate Trim or Vertical Layout pages. Transcript text, timing, and speaker corrections are reviewed in the right panel; SRT is regenerated from the canonical timed transcript. Approve/reject remains review-first, preserves the source, and moves the next pending proposal only after a successful decision.

### Performance

Use the Performance reference as a filter-first owned-channel dashboard:

- top filter bar with date range, format, game, series, metric, Apply, and Reset
- `DataFreshnessCard` owns the single canonical `Refresh Performance` action and reports cache timestamp, last platform pull, loading, success, stale, empty, missing-scope, and API-error states
- metric cards, owned-video evidence, and channel-library summaries
- owned-channel AI takeaways, one-click handoff, and readiness checklist

Filters remain draft state until Apply. No timer or typing-triggered platform pull is allowed. Cards must distinguish cached, stale, unavailable, API error, and empty states. Edit and publishing components may link to Performance or display last-refreshed provenance, but they do not independently initiate the same platform pull. If a future source-specific sync is needed, it must use a distinct name and state its narrower scope, rather than reusing `Refresh Performance`.

### Settings / Local AI

Use the Settings reference as a structured settings shell:

- settings sub-navigation on the left
- runtime health, GPU/backend, Strict AI, and managed model inventory at the top
- AI profile cards with preferred-model dropdown, task assignment, instructions, knowledge entries, and save/cancel
- publishing, people, automation, folder, credential, and danger-zone sections behind their own navigation items

The UI must distinguish AI task profiles from human speaker profiles. Model rows represent actual app-managed files and health, not a decorative inventory.

## States and Accessibility

Every operation-capable component must define these states before screen composition:

- idle and ready
- queued and running
- measured progress or honest indeterminate progress
- cancellable and non-cancellable
- completed with result
- failed with actionable error
- cancelled or interrupted with recovery wording
- stale, missing prerequisite, empty, and unavailable

Interaction rules:

- operation buttons become the same-operation Cancel button only when cancellation is real
- destructive actions use explicit confirmation and explain what is not deleted
- disabled controls explain the missing prerequisite through visible text or tooltip
- every icon-only action has an accessible name and visible focus ring
- all controls are keyboard reachable with logical tab order and Escape dismissal for overlays
- transcript rows, timeline handles, crop regions, and proposal cards expose keyboard equivalents
- color is never the only status signal; pair it with text/icon
- toast messages are announced and remain long enough to read; persistent failures stay inline

## Responsive and Window Rules

The references assume a wide desktop window, but the app must remain usable when resized:

- wide mode: three-column Make Clips and center/right Edit layout
- medium mode: collapse the left queue to a drawer and keep player plus transcript visible
- compact mode: transform the sidebar into icon-plus-tooltip navigation; stack panels in workflow order
- list regions scroll internally rather than expanding the whole page indefinitely
- player controls remain inside the player and trim fields remain beside trim actions
- preserve minimum hit targets, readable labels, and visible operation status at every width

## Component API and Testing Approach

Each reusable component should expose stable data-oriented props rather than app-specific state setters. Typical contracts should include:

- `value`, `onChange`, `disabled`, `busy`, `status`, and `error` for controls
- `items`, `selectedId`, `onSelect`, and `renderItem` for lists
- `operation`, `onCancel`, `onRetry`, and `onOpenResult` for operations
- `ariaLabel`, keyboard handlers, and focus management for media/timeline controls

Component isolation should cover visual states and keyboard behavior before screen integration. Use a local component showcase or equivalent test fixtures for tokens, buttons, cards, status states, timeline/trim states, transcript rows, proposal decisions, model states, and empty/error states. Add interaction tests around save/discard, cancel, filter Apply, proposal approval idempotency, and transcript/SRT atomic save. Keep existing backend action/service tests as the source of truth for side effects.

## Migration and Dependency Order

1. Freeze contracts: capture the current `CreatorAppApi`, `WorkflowSelection`, `OperationUpdate`, `JobRecord`, transcript, proposal, metadata, schedule, and performance fixtures. Add import/export backup checks before changing renderer composition.
2. Define tokens and primitives: build the shell-independent component foundation, accessibility states, and isolated demos without changing backend calls.
3. Build media and operation components: player, controls, timeline, trim, status, progress, alerts, and activity tray. Reuse the current `creator-media` URL bridge and operation subscription.
4. Build transcript/proposal components: canonical transcript editor, speaker review, proposal queue/cards, evidence, and decision controls. Keep existing action IDs and IPC payloads.
5. Compose Make Clips: replace the current stacked layout with the three-zone composition, then verify selection, playback, transcript editing, trim/export, approval, rejection, and lineage.
6. Compose Edit: replace metadata/package/schedule presentation while preserving grouped generation, package persistence, validation, and publish actions.
7. Compose Performance and Settings: use filter/freshness, manual-only refresh, local AI, model, profile, folder, credential, and people components.
8. Add migration guardrails: feature-flag the new renderer composition, keep the old route available during testing, and compare action results and persisted records against fixtures.
9. Only after workflow parity is proven, remove duplicated renderer layout/state. Do not combine this UI rebuild with a shell, database, AI runtime, or file-storage migration.

## Architecture Boundaries to Preserve

The frontend rebuild should call the existing boundaries rather than move privileged work into the renderer:

- `src/electron/main.ts`: app lifecycle, window, media protocol, and shutdown cleanup
- `src/electron/preload.ts`: typed safe API exposed as `window.creatorApp`
- `src/electron/ipc/registerHandlers.ts`: IPC and operation update wiring
- `src/shared/contracts.ts`: domain and UI data contracts
- `src/shared/appActions.ts` and action executor: action catalogue, prerequisites, side effects, and cancellation metadata
- service/repository layer: JSON persistence, jobs, local AI, transcription, FFmpeg/media, YouTube, proposals, metadata, and performance

The current renderer has useful feature components but a large stateful `App.tsx` and many individual busy flags. The rebuild should extract presentation and session state incrementally; it must not assume that a new visual component can replace a backend action or that moving a button changes its side effects.

## Unresolved Decisions for Review

- Keep React/Vite inside Electron for the safest rebuild, or separately evaluate a web/Next.js control plane plus local helper later?
- Should the first component showcase be an in-app development route or a test-only fixture harness?
- Which typography family is acceptable for the shipped app, subject to local licensing and readability?
- Should the wide Make Clips layout use a fixed minimum window size or allow the queue/transcript to collapse sooner?
- Should the activity tray be always visible in the shell or opened from a status indicator?
- Should candidate cards show full evidence inline or use a details drawer to protect review density?
- Which keyboard shortcuts are reserved for playback/frame stepping, and how should they avoid conflicts with text editing?
- Should the Edit screen use a single long package page as shown, or a compact staged layout when window height is limited?

## Acceptance Criteria

- The four reference compositions are recognizable as the same design system without copying static mockup content.
- Components have documented variants and real loading, empty, error, disabled, selected, and success states.
- Make Clips remains a working long-form proposal, transcript/speaker review, trim, approval, rejection, and export workflow.
- Edit remains a working metadata, package-save, readiness, scheduling, and publishing workflow.
- Performance remains manual-refresh and filter-driven; Settings remains connected to real runtime, model, profile, credential, folder, and people state.
- No source media, JSON records, local AI models, or credentials are moved or rewritten by the frontend rebuild.
- Keyboard/focus behavior, accessible labels, internal scrolling, and status text are verified before visual polish is considered complete.
