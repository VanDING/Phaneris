# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

## Improvements

- **Harness capabilities and evidence** — Discover product tools by family and receive their guidance in the next model request. Keep file ranges, original evidence, images and structured tool values traceable through durable recovery. Skill/source recommendations appear as optional advice without delaying work; message delivery follows the connection's steer/queue preference. Long-task handoffs preserve copied user requirements and task criteria.

- **Default appearance** — Keep one product theme with light, dark and system modes. Align the default palette with Run, retain readable semantic colors without unnecessary dark mixing, and use one color policy for startup, runtime and contrast checks. Previous theme selections fall back to Default while mode, font and user-owned files are preserved.

- **Thinking activities** — Model thinking appears in chronological order alongside tool activities as a single line. Click it to read the full content in the existing full-screen viewer.

## Bug Fixes

- **Conversation feedback** — Forward thinking updates while a model is reasoning, retain received thinking when a response is stopped, and release short paused responses after the display buffer deadline.
- **Browser cancellation** — Stop waiting indefinitely for browser captures, preserve completed batch output on cancellation, and settle observed tool errors returned after a stop.
- **Custom connections** — Preserve DeepSeek thinking settings on recognized custom endpoints and avoid selecting an unrelated utility model from the connection's authentication label.

## Breaking Changes
