# Creator Workbench

Creator Workbench is a Windows desktop proof of concept for turning a long recording into a reviewed, schedulable YouTube clip in one app. It transcribes footage locally, suggests moments to clip, and lets the creator check the cut, correct the transcript, and review draft metadata before scheduling the post. Exports preserve the original footage.

The build demonstrated that those steps can work together in one local-first workflow while keeping publishing decisions with the creator. This repository preserves the finished concept build as a portfolio project. The Windows download is a demo of this build. Creator Workbench 2.0 will be developed separately.

## Try it on Windows

[Download the portable Windows x64 demo](https://github.com/CingSharped/creator-workbench-concept-build/releases/tag/v0.1.0-concept).

1. Download the Windows x64 ZIP listed under Assets.
2. Extract the entire ZIP to a folder, then open `creator-workspace.exe` from that folder.
3. Import a local clip. Use **Settings** to configure media tools and local models. To try YouTube features, provide your own Google OAuth desktop client and connect your channel.

The packaged app runs without Node.js or a source checkout. To build from source, see the setup instructions below.

## What the concept build left open

- **Local thumbnail generation** was not built. The concept can suggest existing images or sampled frames. Generating new images locally and accepting a custom prompt are candidates for version two.
- **Burned-in subtitles** were not built. The concept supports transcript editing, SRT files, and YouTube captions. Rendering subtitles into the video itself is a candidate for version two.
- **Owned-video editing and local AI setup** were partially built. The concept has drafts, single and bulk metadata edits, hardware detection, and a model catalogue. Better conflict and retry handling, richer AI context, and model recommendations and readiness checks for each task are candidates for version two.

The Windows ZIP is an unsigned portfolio demo. A signed installer and an update service were not part of the build. I use the current build to post Shorts to my own YouTube channel and plan to keep using it until the next build is ready to replace it. First-time YouTube setup from the demo ZIP with a new Google Cloud project has yet to be verified. Any distribution plans for version two will be decided separately.

## Planning History

The [decision log](decision-log.md) records how the design evolved during the concept build.

Local desktop app for:

- importing existing clips
- local transcription
- transcript speaker review with creator/collaborator voice samples
- metadata generation
- YouTube scheduling and publishing workflows, with broader platform handoff planning

Performance is scoped to the user's owned YouTube account, channel history, and local workspace evidence; public YouTube trend discovery is not part of the current product.

## Planning References

- [Documentation reconciliation and pending decisions](docs/documentation-reconciliation.md)
- [Current architecture and data flow](docs/architecture/creator-workspace-data-flow-and-erd.md)
- [Current architecture diagrams and source evidence](docs/architecture/creator-workbench-architecture.md)

- [Historical product plan](creator-workspace-current-product-plan-2026-08-11.md)
- [Decision log](decision-log.md)
- [Architecture decision records](docs/adr/README.md)
- [Component-first UI design notes](creator-workspace-component-first-ui-rebuild-plan-2026-08-08.md)
- [Archived planning documents](docs/archive/README.md)
- [Supporting research](docs/research/README.md)

## Implemented Foundation

This repository currently includes:

- Electron main/preload/renderer split
- React + TypeScript + Vite renderer
- local JSON-backed workspace storage
- clip import flow
- local transcription plus in-app transcript and `SRT` editing
- speaker assignment, creator/collaborator voice samples, and low-confidence review filters
- local metadata generation with review-first candidate selection
- metadata prompt assembly grounded in corrected transcript state and collaborator presence context
- environment detection for `ffprobe`, `ffmpeg`, and `whisper.cpp`

## Local Prerequisites

- Node.js and npm
- FFmpeg / `ffprobe` for richer media inspection and transcript audio extraction
- `whisper.cpp` / `whisper-cli` plus a Whisper `.bin` model for local transcription

## Toolchain Setup

This repo is pinned to:

- Node.js `24.18.0`
- npm `11.16.0`

Toolchain pinning lives in:

- [package.json](package.json) via `engines` and `packageManager`
- [mise.toml](mise.toml) for `mise`
- [.node-version](.node-version) as a lightweight fallback version file

Recommended manager:

- `mise`

If you prefer not to use a version manager, install Node.js `24.18.0` manually and ensure npm resolves to `11.16.0`.

Note:

- This machine does not currently have `winget` available.
- While checking install options on 2026-07-19, I found that Volta's upstream repo now marks the project as unmaintained, so this repo no longer treats Volta as the default recommendation.
- If you are still on Node 18, upgrade before running the app. Node 18 is end-of-life and below the version range we want to standardize on for this project.

## Commands

After installing dependencies:

```bash
npm install
npm run dev
```

## Local Runtime Layout

The app now supports a workspace-local runtime layout and will auto-detect these folders before falling back to PATH:

- `.local-tools/ffmpeg`
- `.local-tools/whisper.cpp`
- `.local-models/whisper`

That means portable binaries can live inside the repo without requiring a machine-wide install.

## Notes

- This repo now pins its Node/npm toolchain so local development is repeatable across machines.
- The app still falls back to basic file metadata when richer media inspection is unavailable.
- Workspace data is currently stored in a local JSON file so the MVP stays portable and avoids native database setup friction on Windows.
- The local transcription flow is now implemented end to end: audio extraction, `whisper.cpp` execution, transcript persistence, and SRT export.
