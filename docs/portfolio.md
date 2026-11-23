# Creator Workbench

I built Creator Workbench to test whether a Windows desktop app could take a creator from a long recording to a reviewed, schedulable YouTube clip. The goal was to reduce the handoffs between transcription, editing, metadata preparation, and scheduling.

## What I built

The app transcribes recordings locally with whisper.cpp and suggests clip ranges from the transcript. The creator can preview and trim a suggestion, correct the transcript and speaker assignments, and export a separate video with FFmpeg. The app also drafts YouTube metadata, supports scheduling, and shows performance for the creator’s own channel.

## A design choice

I put review at the points where a suggestion becomes a decision. A suggested moment becomes a clip only after approval. Draft metadata can be edited before scheduling. That gives the creator a chance to catch a poor cut or misleading title before it goes live.

## What the build demonstrated

The prototype brought local media processing, AI assistance, and YouTube scheduling into one desktop workflow. This version is preserved as a proof of concept for the portfolio. The earlier invited beta remains part of the project history, and any future 2.0 would be a separate build.

**Stack** — Electron, React, TypeScript, FFmpeg, and whisper.cpp.
