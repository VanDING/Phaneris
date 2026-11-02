# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Conversation image sharing** — Select questions and completed answers independently, preview a fixed light template and export 1440px-wide PNGs with automatic splitting for long content. Copy keeps images in memory; Save retains deduplicated images in the session's exports/shares directory. Available in the desktop client from the header and each answer card.

## Improvements

- **Conversation header** — Click the left-aligned title to rename it in place. Use the existing preview-style More, paper-airplane Share and Close buttons; closing the last conversation view preserves its session and draft.

- Combine startup feedback into a white character background, reveal the Phaneris mark only after the application is ready, and transition directly into the workspace.
- Add a centered, gently breathing LOADING word to the startup character grid, with a deeper violet color and a smooth handoff to the Phaneris mark.

## Bug Fixes

- **Persistent conversation titles** — Flush renamed titles before notifying directory watchers, and use the latest title when sharing a previously rendered answer.

- Make desktop API connection checks use the selected runtime and allow the complete server-side probe time budget.

## Breaking Changes
