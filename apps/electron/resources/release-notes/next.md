# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- Added independent decision features for Guarded permissions, risk badges, adaptive thinking, skill/source suggestions, large-result previews, mid-turn delivery, turn outcomes, smart titles, automation conditions, and targeted task repairs. The new switches default to off.

## Improvements

- Completed semantic label evaluation and task verdict inference, preserving regex rules, explicit verdicts, task budgets, and manual edits.
- Preserve separate acknowledged messages and durable input records when queued continuations share one model turn. Remote decision settings and credentials use the target server.

- Upgraded the Pi SDK from 0.87.1 to 1.0.0, updating the model catalog and provider handling for tool calls, reasoning, retries, and usage costs.
- Added linked decision outcomes and follow-ups, cancellation reporting, and a local decision usage report.
- Require RTK 0.44.0 or newer for token optimization, with update guidance and re-checking for outdated installations.

## Bug Fixes

- Tightened Explore checks for MCP write actions and shell commands with write or execution flags. Always Allow now remembers scoped commands, folders, API endpoints, and hosts; child sessions cannot exceed their parent's permissions.
- Re-check permissions after source activation, deny requests without an approval handler, and discard activation results after Stop.
- Prevent automation loops, preserve source retry attachments and corrections without duplicating the visible user message, and avoid notifications from untracked background tasks.
- Refresh missing source-test credentials, avoid unnecessary pending-plan writes, snapshot completion listeners, and normalize new label identifiers.

## Breaking Changes
