# Note IINA

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface is local HTML/CSS/JavaScript hosted by IINA's macOS WebViews. This is an IINA plugin, not a website, mobile app, or separate note-taking application.

## Users

The user studies courses by watching local lecture videos in IINA. Their desk is small, making a physical notebook inconvenient.

## Product Purpose

Keep the learning benefit of pausing, understanding an idea, and rewriting it in the user's own words. Replace the physical notebook with persistent notes accessible while watching and while reviewing a course.

## Operating Context

- The current habit is pause video, write in a paper notebook, then resume.
- The user usually remembers the folder containing a course and reopens its videos.
- Review has two entry points: notes for a reopened video, and reading notes across a course to recall a topic.
- The selected approach is a plugin within IINA, not an independent companion app.
- The interface follows IINA/macOS conventions; it is not a simulated video player.
- Runtime compatibility was checked with IINA 1.5.0, build 180.

## Confirmed Capabilities and Constraints

- A panel for manually written notes beside a lecture.
- Notes associated with the correct lecture and a timestamp captured automatically when starting a note.
- Clicking a timestamp returns to the relevant segment.
- Course-level reading and searching the written notes.
- Pressing the unmodified N key in the player opens the panel and focuses writing. Typing n inside an editor must remain ordinary text input.
- Keep the experience inside IINA.
- Project-local design tooling is optional development tooling, not a runtime dependency or redistributed component.
- Avoid AI-slop. Preserve IINA/macOS conventions and minimize visual distraction.

## Approved Implementation Choices

The approved implementation uses:

- Plain JavaScript and HTML/CSS, without a frontend framework or network service.
- A course-level `.iina-notes.json` file within the selected course folder, with relative video paths.
- A native IINA-owned window for course reading, rather than replacing IINA's video surface.
- Explicit note save using a button or Command-Enter, with a separately preserved draft.

Implemented in version 1.0.1. The user confirmed the plugin works after the course-activation fix. See README for the exercised paths and remaining verification boundaries.

## Product Principles

1. The user's act of writing is part of learning; do not replace it with AI-generated notes.
2. Keep the path from noticing an idea to writing it short.
3. Saved notes must remain findable by video and by course.
4. Do not claim a note is saved until its durable write succeeds.
5. Respect host application keyboard, window, and sidebar behavior; verify integration in IINA itself.

## Deliberate Non-Goals

AI summaries, transcription, cloud accounts, synchronization, an independent application, a replacement video player, and a general-purpose knowledge-management system are not part of the agreed request.
