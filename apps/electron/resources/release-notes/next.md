# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Image generation defaults** — Choose a dedicated image connection and model in AI settings, or see the effective automatic choice. Explicit connections never fall back to another account.

## Improvements

- **Decision assistance** — Show per-feature calls, failures, changes, known costs and follow-up observations in AI settings. Reuse decisions during authentication retries, and consider the previous reply and attachment metadata when adjusting thinking within the user's chosen level. Large tool results retain relevant excerpts in their original order with a complete saved file and a safe fallback.

- **Pi SDK 1.1.0** — Upgrade the complete Pi package family together, preserve Azure connection compatibility, persist refreshed OAuth credentials through the host vault, and retain SDK tool durations and cancellation outcomes.

- **Clearer AI settings** — Organize the single page as Connections, Conversation and Advanced. Image generation, decision assistance, and cache/runtime options expand independently. Edit workspace model overrides in Workspace settings; show a single inheritance link in AI settings. Identify subscription and API-key connections accurately, guide image setup to compatible providers, and preserve selected accounts and settings when saves fail.

- **Default theme** — Replace Default with pure white settings surfaces, ink text, neutral gray user messages and a graphite dark palette, keeping the original Default purple in both modes. Give New Session the same card surface as settings, with subtle hover elevation. Use platform fonts, fine borders and readable monochrome provider icons in dark mode. Keep the stable Default selection and read-only Geek, Cyberpunk 2077 and Ink alternatives.
- **Calmer Gantt timelines** — Use faint timeline rules, clearer date headings, lighter dividers and refined task bars. Short summary bars retain readable progress percentages.

## Bug Fixes

- **Reliable first-turn tools** — Wait for complete subprocess initialization and tool synchronization before starting a turn, including concurrent startup requests.
- **Stopping open questions** — Deliver the completed dismissal when Stop closes a question, allowing the live Pi child to finish waiting and report cancellation.

- **Reliable packaged script tools** — Prepare the pinned Python runtime before entering the sandbox and reuse Electron’s Node runtime. Both script tools retain filesystem/network isolation, writable session scratch space and actionable runtime diagnostics.
- **Visible and fail-safe Guarded mode** — Offer a setup entry in permission controls and settings. Availability validates actual credentials and endpoints. Failed, missing or timed-out risk checks require confirmation; unattended guarded mutations are blocked.

- **Clean Windows installer edges** — Prevent native non-client repainting from adding a beveled border when the installer loses focus, regains focus or recalculates its frame.

## Breaking Changes
