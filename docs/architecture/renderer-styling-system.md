# Renderer Styling System

## Purpose

The Creator Workbench renderer uses one global stylesheet, `src/renderer/styles.css`, and a small set of shared React primitives. This document records the safe styling boundary for incremental cleanup. It is intentionally a compatibility-first system: existing workflow classes remain valid while screens move to shared contracts one group at a time.

## Layer Order

`styles.css` declares the following cascade order:

1. `reset`: box sizing and other document-wide normalization.
2. `tokens`: the `--cw-*` colour, type, spacing, radius, and shadow vocabulary.
3. `primitives`: reusable panel, card, button, input, tab, status, disclosure, field, and scroll contracts.
4. `components`: compatibility aliases and component-owned styling. The historical renderer rules currently live in this layer so their effective cascade is preserved during migration.
5. `views`: screen and workflow composition such as Make, Edit, Performance, and Settings layouts.
6. `responsive`: breakpoint-specific layout changes.
7. `utilities`: intentionally small opt-in helpers, including visually-hidden content and reduced-motion adjustments.

The layer order is declared at the top of the stylesheet. New rules must be placed in the layer that owns them rather than appended as unlayered overrides.

## Ownership

- `main.tsx` is the only stylesheet entry point.
- `WorkbenchPrimitives.tsx` owns structural markup and the `.cw-*` contracts.
- `SettingsPrimitives.tsx` preserves its existing exports while composing the shared `Panel`, `Card`, `Disclosure`, `StatusBadge`, and `ScrollArea` primitives.
- View components own workflow-specific layout and state classes. They should not create component-local stylesheets or CSS-in-JS.
- `--cw-*` tokens belong in the token layer. A token is added only when a repeated value has a meaningful shared role; one-off runtime values stay local to the component.
- Runtime geometry and state-dependent values remain typed inline CSS custom properties or narrowly scoped inline styles. Examples include crop positions, aspect ratios, chart dimensions, progress widths, score angles, and speaker accent colours.

## Compatibility Rules

Existing names such as `.panel`, `.primary-button`, `.secondary-button`, `.icon-button`, `.status-pill`, `.editor-input`, and Settings-specific classes remain supported while active components migrate. A compatibility alias may be removed only after static imports, JSX class names, dynamic class expressions, tests, documentation, and runtime registration paths have been checked.

The historical stylesheet rules are not considered dead merely because a rule is hidden or overridden. Deletion requires evidence that the owning markup and any compatibility path are unused, followed by type-check, build, tests, and an affected-screen smoke test.

## Dynamic Style Allowlist

The following renderer values are legitimate runtime styling exceptions and should not be replaced with hard-coded CSS:

- speaker profile accent colours and speaker-card borders/backgrounds;
- metadata score gauge angles;
- local AI progress widths;
- transcript and video crop geometry, including aspect ratio and transforms;
- Performance chart heights, track widths, and retention bars;
- stacked video preview layout values.

Stable declarations around these values belong in `styles.css`. When a value is passed as a custom property, use a descriptive typed name such as `--speaker-accent`, `--bar-height`, `--crop-left`, or `--score-angle`.

## Legacy Cleanup Evidence

- Removed the earliest `.panel`/`.hero-panel` base block after confirming its border, radius, background, and shadow declarations were all superseded by later compatibility rules.
- Removed the earlier `.panel { padding: 24px; }` declaration after confirming later `.panel` padding declarations own the effective value.
- Reduced the later shared `.panel`/`.hero-panel` block to its unique `border-color` declaration; its radius, background, and shadow values were already owned by the final compatibility block.
- Centralized repeated renderer palette literals through semantic `--cw-*` tokens, including shared surfaces, neutral overlays, information accents, violet accents, and common status colours. Exact values were preserved; one-off chart treatments and runtime speaker colours remain intentional exceptions.
- The cleanup was followed by type-check, production build, and the full test suite; no renderer or runtime behaviour was changed.

## Migration Sequence

The safe order is shell and controls, Settings, Make, Edit, Performance, then dialogs and data-management surfaces. Each group should be visually checked before its replaced declarations are removed. Responsive rules should be consolidated only after the owning component has moved to its shared contract.

## Baseline

Before this styling slice, the worktree passed:

- `npm.cmd run check`
- `npm.cmd run build`
- `npm.cmd test` with 140 passing tests

The stylesheet audit found one CSS entry point, repeated historical selectors, multiple responsive blocks, and a small set of runtime inline styles. The first implementation slice adds the explicit layer boundary, shared primitives, token declarations for previously missing variables, and Settings composition without changing IPC, persistence, or backend behaviour.

## Verification Contract

`test/rendererStyling.test.cjs` checks the layer declaration, token references, stylesheet entry point, primitive selector uniqueness, and the known dynamic-style allowlist. These checks are intentionally static and should run with the normal Node test suite.

## Latest Verified Slice

The Settings scheduling, Local AI setup, voice-sample, Make proposal, speaker-context, and setup call-to-action controls now compose the shared `Button` or `IconButton` primitives while retaining their compatibility class aliases. The posting schedule day-toggle CSS is scoped to `.posting-schedule-day` rather than every descendant button.

After this slice:

- `npm.cmd run check` passes.
- `npm.cmd test` passes with 146 tests.
- `npm.cmd run build` passes for the renderer and Electron targets.
- No IPC, preload, persistence, schema, or backend files were changed by this slice.

## Progress

- [x] Baseline `check`, `build`, and `test` results recorded.
- [x] One stylesheet entry point verified.
- [x] Explicit layer order established.
- [x] Missing tokens and legacy variable fallbacks normalized.
- [x] Shared renderer primitives added.
- [x] Settings primitives and the shared refresh control moved onto shared contracts.
- [x] Clip status pills and confirmation dialog surfaces moved onto shared contracts.
- [x] Make proposal, transcript, review, trim, video preview, decision, and setup surfaces moved onto shared contracts.
- [x] Edit scheduling, queued posts, playlists, and metadata/publish-queue shells moved onto shared contracts.
- [x] Performance cockpit shell, channel workspace tabs, and channel library grid moved onto shared contracts.
- [x] Performance video, diagnostic, breakdown, thumbnail, and detail-drawer cards moved onto shared contracts.
- [x] Data-management panel, action cards, and protected-details disclosure moved onto shared contracts.
- [x] Settings scheduling, Local AI setup, and voice-sample actions moved onto shared button contracts while retaining compatibility aliases.
- [x] Settings scheduling day toggles now use a named component selector instead of styling every descendant button.
- [x] Long-form proposal and transcript action controls moved onto shared button contracts; specialized seek rows and tabs remain component-owned.
- [x] Confirmed-hidden duplicate elapsed-time markup removed from the long-form transcription status surface.
- [x] First proven duplicate panel declarations removed after cascade verification.
- [x] Static styling guardrails added and passing.
- [x] Repeated core palette literals moved into the global token layer with a regression guard.
- [ ] Screen-by-screen Make, Edit, Performance, dialog, and responsive migration.
- [ ] Removal of confirmed-dead legacy rules with per-screen evidence.
- [ ] Manual visual comparison against captured screen baselines.
