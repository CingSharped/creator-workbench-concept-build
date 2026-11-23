# Creator Workspace Stack Recommendation

As of 2026-07-19.

> **Historical stack recommendation.** The implemented stack and current migration boundaries are recorded in [creator-workspace-current-product-plan-2026-08-11.md](../../creator-workspace-current-product-plan-2026-08-11.md). Electron/React/Vite, JSON persistence, and app-owned llama.cpp are the current baseline; Tauri, SQLite, and Ollama-first language below are not current decisions.

This document defines the recommended technical stack for the first build of the local creator workspace.

Implementation note as of July 19, 2026:

- the live repo currently uses a JSON-backed local store for MVP portability on Windows
- this is a pragmatic implementation choice to avoid native module/toolchain friction during early feature work
- SQLite remains a reasonable later upgrade once the creator workflow surface is stable

It is optimized for the current agreed shape:

- Windows-first
- local desktop app
- single-user in v1
- existing clips first
- local transcription
- metadata generation
- YouTube and TikTok planning/scheduling in MVP

## Decision Summary

For v1, the recommended stack is:

- `Desktop shell`: Electron
- `Frontend`: React + TypeScript + Vite
- `UI styling`: Tailwind CSS
- `Desktop architecture`: Electron main/preload/renderer split with secure IPC
- `Local database`: SQLite
- `Database access`: `better-sqlite3`
- `Schema and migrations`: SQL migration files plus a thin repository layer
- `Background jobs`: Node worker threads and child processes
- `Media tooling`: FFmpeg
- `Transcription`: `whisper.cpp`
- `Local metadata generation`: Ollama, behind a provider abstraction
- `Validation`: Zod at IPC and domain boundaries
- `Packaging`: Electron Forge
- `JS toolchain management`: `mise` plus pinned project Node/npm versions

## Locked Decisions

These should be treated as the default unless we find a concrete blocker.

### 1. Use Electron for v1

Decision:

- build the app as an Electron desktop application

Why:

- this app needs strong local process orchestration
- spawning FFmpeg, `whisper.cpp`, and later scheduling/publishing workers is straightforward in Node
- local file-system workflows are simpler in Electron than in a Rust-first desktop stack
- YouTube/TikTok adapters, OAuth flows, and future vidIQ integration are easier to implement from a Node-based app
- Windows-first developer experience is pragmatic

Tradeoff:

- larger binaries and higher memory usage than Tauri

Conclusion:

- for this project, development speed and integration simplicity matter more than app size in v1

### 2. Use React + TypeScript + Vite for the UI

Decision:

- build the UI with React, TypeScript, and Vite

Why:

- fast iteration
- strong ecosystem
- easy pairing with Electron
- good fit for a tool with list/detail views, queue UIs, transcript views, and scheduling workflows

### 3. Keep Node out of the renderer

Decision:

- use Electron's secure split:
  - `main` process for privileged operations
  - `preload` for a typed safe bridge
  - `renderer` for UI only

Why:

- reduces security risk
- keeps app boundaries clearer
- makes the codebase easier to reason about as the app grows

### 4. Use SQLite locally

Decision:

- store local app data in SQLite

Why:

- no separate server dependency
- strong fit for single-user local workflows
- durable, inspectable, and easy to back up
- enough for the expected MVP workload

### 5. Use `better-sqlite3` instead of an ORM-first approach

Decision:

- use `better-sqlite3` directly with a thin repository layer and SQL migrations

Why:

- strong Node + SQLite fit
- lower packaging complexity than shipping a heavier ORM engine setup in a desktop app
- good performance and simplicity for a local single-user product

Why not Prisma as the default:

- Prisma with SQLite is viable, but it adds more moving parts than we need for the first build
- the MVP data model is small enough that hand-owned SQL and repositories are realistic

Revisit later if:

- the schema becomes much larger
- relationship-heavy query complexity starts slowing us down

### 6. Use FFmpeg for media inspection and media transforms

Decision:

- standardize on FFmpeg for:
  - clip inspection
  - audio extraction
  - later clip export
  - later caption burn-in

Why:

- mature and battle-tested
- works well in local desktop workflows
- already aligns with the planned future feature set

### 7. Use `whisper.cpp` for local transcription

Decision:

- default to `whisper.cpp` for local speech-to-text

Why:

- offline
- fast enough to be practical on local hardware
- works on Windows
- easier to ship as a local binary tool than a Python-heavy transcription stack

### 8. Use Ollama for local text generation in v1

Decision:

- use Ollama as the first local metadata-generation provider

Use cases:

- title generation
- description generation
- tag suggestion
- later rationale generation for clip candidates

Why:

- local-first with no per-call API billing
- official JavaScript/TypeScript support
- simple local HTTP API
- model management is much easier than embedding everything ourselves on day one

Tradeoff:

- this introduces a local runtime dependency outside the app

Mitigation:

- design a provider interface so we can later support:
  - embedded `llama.cpp`
  - optional cloud fallback
  - other local runtimes

### 9. Use Electron Forge for packaging

Decision:

- use Electron Forge as the first packaging/distribution path

Why:

- strong official Electron alignment
- adequate for development and early packaging
- good enough before we optimize installer/update complexity further

### 10. Pin the JavaScript toolchain with `mise`

Decision:

- pin the project to a known Node.js and npm version using `mise`, with `package.json` engines as a second layer of guardrails

Recommended versions:

- Node.js `24.18.0`
- npm `11.16.0`

Why:

- avoids "works on my machine" drift across Node/npm releases
- gives us a simple per-project setup story on Windows
- keeps Electron, Vite, and local tooling aligned on one supported runtime
- reduces accidental time loss from debugging environment mismatches

Why not Volta as the default anymore:

- as of 2026-07-19, Volta's upstream repository now marks the project as unmaintained and recommends migrating to `mise`

Implementation note:

- record the pinned versions in `mise.toml`
- keep `package.json` `engines` and `packageManager` aligned with the same versions
- keep a `.node-version` file as a lightweight fallback for tools that read idiomatic version files

## Recommended Layering

### Desktop Layer

Responsibilities:

- app lifecycle
- native window creation
- secure IPC
- OAuth callback handling
- scheduler lifecycle
- sidecar process management

Main technologies:

- Electron main process
- preload bridge
- child processes / worker threads

### UI Layer

Responsibilities:

- clip library
- transcript viewer
- metadata editor
- scheduling queue and calendar
- candidate review queue later

Main technologies:

- React
- TypeScript
- Vite
- Tailwind CSS

### Local Data Layer

Responsibilities:

- clip records
- transcripts
- caption exports
- metadata packages
- publish jobs
- later source videos, candidate clips, and review decisions

Main technologies:

- SQLite
- `better-sqlite3`
- SQL migrations
- repository modules

### Local AI / Media Layer

Responsibilities:

- media inspection
- audio extraction
- transcription
- later caption burn-in and clip render
- metadata generation

Main technologies:

- FFmpeg
- `whisper.cpp`
- Ollama

### Integration Layer

Responsibilities:

- YouTube account connection
- TikTok account connection
- vidIQ enrichment where justified

Main technologies:

- official platform APIs
- adapter modules by platform
- credential storage in OS-backed secure storage

## External Integration Strategy

### YouTube

Recommended v1 path:

- official YouTube upload/scheduling integration

Architecture note:

- keep YouTube in its own adapter module

### TikTok

Recommended v1 path:

- official TikTok Content Posting integration where available
- app-side scheduling behavior in our product model

Architecture note:

- TikTok must support more than one execution mode:
  - `direct_publish`
  - `draft_handoff`

### vidIQ

Recommended approach:

- do not build v1 around scraping the browser extension
- if we need programmatic integration, prefer the official vidIQ MCP path with OAuth 2.0
- if that is too much for MVP, keep vidIQ as a manual or optional enrichment step until integration is proven

Why:

- this keeps the product on more defensible ground than extension scraping
- it also matches vidIQ's current official developer direction better

## Why Not Tauri For v1

Tauri is appealing because:

- smaller binaries
- stronger default security posture
- good Rust-native foundation

But for this project, Tauri is not the best first choice because:

- we would spend more time bridging local tooling and backend logic
- FFmpeg, transcription, scheduler, OAuth, and local AI orchestration are easier in a Node-first runtime
- the app's value is in workflow and integrations, not in minimizing binary size at launch

Recommended stance:

- choose Electron now
- revisit Tauri only if app size, startup time, or memory use become material product problems

## Why Not A Cloud-First Web App

Not recommended for v1 because:

- the product's value depends heavily on local media access
- local transcription and local generation are core requirements
- a web-first shape pushes us toward helpers, sidecars, and more coordination too early

## Open Decisions

These still need follow-up, but they do not block locking the stack direction.

1. Which local model should be the default Ollama model for metadata generation?
2. Do we want to require Ollama install for v1, or ship metadata generation behind a feature flag until that setup is smooth?
3. Should the scheduler run entirely in the Electron main process or in a dedicated local worker process?
4. Which secure credential storage package or approach should we standardize on?
5. Do we want a simple list-based schedule first, or a full calendar component in MVP?

## Recommendation For Sprint 1

Sprint 1 should assume this stack and aim to prove these pieces together:

- Electron app shell
- React + TypeScript renderer
- secure preload bridge
- SQLite initialization
- `better-sqlite3` connection and repository pattern
- clip import
- FFmpeg metadata inspection
- `whisper.cpp` transcription job

That will validate the most important local architecture choices before we invest in deeper metadata and scheduling work.

## Sources

- Tauri official docs: https://tauri.app/start/
- Electron docs: https://www.electronjs.org/docs/latest
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- `whisper.cpp` README: https://github.com/ggml-org/whisper.cpp/blob/master/README.md
- FFmpeg docs: https://ffmpeg.org/documentation.html
- Prisma SQLite docs: https://docs.prisma.io/docs/orm/v6/overview/databases/sqlite
- Prisma SQLite quickstart: https://www.prisma.io/docs/prisma-orm/quickstart/sqlite
- `better-sqlite3` README: https://github.com/WiseLibs/better-sqlite3
- Ollama docs: https://docs.ollama.com/
- `mise` getting started: https://mise.jdx.dev/getting-started
- `mise` install guide: https://mise.jdx.dev/installing-mise.html
- Volta repository notice: https://github.com/volta-cli/volta
- vidIQ MCP help article: https://support.vidiq.com/en/articles/15082430-vidiq-mcp
