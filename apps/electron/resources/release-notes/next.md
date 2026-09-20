# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

## Improvements

- Pi-native request fingerprints and selected response headers now accompany durable model outcomes. Active-run lifecycle observations and SDK usage snapshots support auditing, with model outcome/ledger parity checks that distinguish unresolved requests from zero-cost completion.
- The Pi SDK is upgraded to 0.86.0. Provider requests now carry the SDK's normalized transcript, so instruction and tool changes are delivered as in-place prompt deltas that keep the cached prefix, and the Phaneris system prompt is projected as the leading system message. Built-in file/shell tools use strict-preferred JSON-schema arguments where the provider supports it, and agent-level retry backoff is capped at 60 seconds. Pi 0.86.0 also enables prompt-cache warming by default — background re-sends that bill as a full-context cache read during long tool runs — and Phaneris keeps it off, because those refreshes bypass the durable ledger and would spend outside accounting. Background spend therefore stays exactly where it was.

## Bug Fixes

- **Provider connections are classified by endpoint protocol, not by the presence
  of a URL.** Every built-in provider (DeepSeek, Minimax, Groq, …) has its own
  endpoint, and the setup presets prefilled it, so those connections were stored
  as custom endpoints. Pi then neither routed them to the provider nor registered
  them as endpoints, image input was treated as unsupported, the thinking-level
  selector was disabled, and model refresh always failed. Existing connections in
  that state are repaired on startup. The model picker lists every connection in
  one flat list — it no longer splits the single Pi backend into "Pi" and
  "Phaneris Backend" sections.

## Breaking Changes
