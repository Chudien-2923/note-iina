# Changelog

## [Unreleased]

## [1.0.1] — 2026-11-05

First public release. Install `note-iina-1.0.1.iinaplgz` from GitHub Releases.

### Fixed

- Reproduced course selection hanging in actual Apple JavaScriptCore: reading an absent course returned, but a reentrant request to create it stranded Promise work across the player/global contexts.
- Dispatch player RPC on a fresh native main-loop turn, matching deferred response delivery.
- Hand all queued drafts, including delayed input for a nonselected lesson, directly to the global writer before player unregister. Forward pending matching-revision draft clears before unregister as well.
- Preserve existing NFD draft paths during canonicalization; converging Unicode identities remain separate recovery choices instead of blocking all course draft operations.
- Added a Swift/JavaScriptCore regression running actual entry scripts against temporary files: create course, save note, finish acknowledgement, switch lessons and retain late original-lesson text on immediate close.
- Full suite: 60 tests passed, including the actual-engine regression. The user subsequently confirmed the plugin works in IINA after the update; no automated desktop control was used for this fix.

### Documentation and distribution

- Public README with installation, shortcuts, storage/backup, development and verification boundaries.
- MIT license, Semantic Versioning policy and GitHub Releases installation packages.

## 1.0.0 — internal implementation candidate, 2026-11-05

### Implemented

- IINA sidebar for manually written multiline timestamped notes; N entry and Command-Enter save.
- Course-level portable JSON sidecar, relative video paths, serialized atomic replacement and revision-aware durable drafts.
- IINA-owned course notebook with lesson navigation, text search, edit/delete and timestamp navigation.
- Host-issued editor contexts prevent delayed input/save from crossing lesson ownership; stale navigation guards and versioned course updates protect multi-player state.
- Local restrained light/dark interface with Vietnamese text support and no runtime third-party dependencies.
- IINA 1.5 runtime compatibility corrections: listener registration after WebView load; deferred owner-routed global replies; Promise-shaped folder chooser; distinction between decoded status paths and encoded load-event URLs.
- Argument-safe ZIP packaging with archive root metadata/resources.
- Canonical Unicode path identity for macOS NFC/NFD Vietnamese course and lesson paths.

### Verified

- 57 behavioral tests pass, including a failing-before/passing-after Vietnamese path regression; actual archive generated.
- Independent GPT-6.1 sol source review and scoped re-review addressed the reported correctness defects.
- Actual IINA 1.5.0 build 180: N/sidebar/editor/plain-n input, Vietnamese multiline entry, restored draft after plugin reload; corrected reload did not repeat the earlier observed initializer-response crash.
- Actual archive installation and replacement accepted by IINA; final corrected archive reinstalled.

### Not yet certified

At the time of this internal candidate: end-to-end native course-selection/save, reader/search/seek, multiple players, course movement, appearance/fullscreen coverage and actual Vietnamese IME composition were not yet certified. The subsequent user confirmation is recorded under 1.0.1; it is not a certification of every scenario. See README for current evidence boundaries and storage precautions.

[Unreleased]: https://github.com/Chudien-2923/note-iina/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/Chudien-2923/note-iina/releases/tag/v1.0.1
