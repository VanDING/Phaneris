# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- Added independent decision features for Guarded permissions, risk badges, adaptive thinking, skill/source suggestions, large-result previews, mid-turn delivery, turn outcomes, smart titles, automation conditions, and targeted task repairs. The new switches default to off.
- Added deferred MCP discovery and managed codemode with per-call permissions, structured results, durable nested identities, and model access disabled.
- Added lossless Markdown Artifact editing, OpenRouter image generation through Pi, and explicit linked text-only recovery for oversized image histories.

## Improvements

- Completed semantic label evaluation and task verdict inference, preserving regex rules, explicit verdicts, task budgets, and manual edits.
- Preserve separate acknowledged messages and durable input records when queued continuations share one model turn. Remote decision settings and credentials use the target server.

- Upgraded the Pi SDK from 0.87.1 to 1.0.0, updating the model catalog and provider handling for tool calls, reasoning, retries, and usage costs.
- Updated all Pi SDK packages to 1.0.2, including upstream MCP project overrides, CIMD OAuth support, Clef classifier models, and thinking-level sampling defaults. Native MCP, classifier, and automatic routing migrations remain conditional on the host contracts and verification.
- Added linked decision outcomes and follow-ups, cancellation reporting, and a local decision usage report.
- Account for session-owned decisions and image generation in the durable usage ledger; distinguish unknown and estimated costs in Run overview and include auxiliary tokens in task budgets across restarts.
- Preserve native model image limits, prompt-cache metadata, and cost tiers; remove the injected DeepSeek catalog replacement.
- Load the rich Markdown editor on demand to reduce initial renderer bytes without changing bundle budgets.
- Share concurrent workspace icon reads and discoveries, and use host-resolved skill metadata to avoid probing missing icons during startup.
- Show saved and SDK reception states separately, preserving the identity of identical messages and updating late receipts without restarting completed runs.
- Require RTK 0.44.0 or newer for token optimization, with update guidance and re-checking for outdated installations.

## Bug Fixes

- Tightened Explore checks for MCP write actions and shell commands with write or execution flags. Always Allow now remembers scoped commands, folders, API endpoints, and hosts; child sessions cannot exceed their parent's permissions.
- Re-check permissions after source activation, deny requests without an approval handler, and discard activation results after Stop.
- Prevent automation loops, preserve source retry attachments and corrections without duplicating the visible user message, and avoid notifications from untracked background tasks.
- Refresh missing source-test credentials, avoid unnecessary pending-plan writes, snapshot completion listeners, and normalize new label identifiers.
- Confirm mid-turn input at SDK reception, retain unknown delivery for review, and avoid replaying unconfirmed input.
- Block deterministic workspace tool-call rules before execution; show legacy AgentEvent actions as unsupported rather than successful.
- Preserve local drafts on CAS failure and snapshot external checkout edits when a new Artifact edit lease starts.
- Prevent initial read-only Markdown normalization from overwriting source drafts containing comments, formulas, Mermaid, tables, links, images, or task lists.
- Give each stateless MCP HTTP request its own protocol instance, preserving structured results and source ownership across repeated and concurrent calls.

## Breaking Changes
