# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Decision model (Jev)** — an optional second model surface for the agent. The new `decide` tool asks a decision model typed questions about text or JSON (classify, route, score, yes/no) and answers with probabilities and confidence instead of prose: one item per call, or a batch of up to 200 with results in input order. It is **off by default**; enable it under **Settings → AI → Decision model (Jev)** and pick a provider (TypeSafe, OpenRouter, Vercel AI Gateway, a local `laya-serve`, or a custom endpoint), reusing the key of an existing OpenRouter / Vercel AI Gateway connection if you have one. The API key is stored only in the encrypted credential vault and is never returned to the UI, and every call appends one audit line to `~/.phaneris/logs/decisions.jsonl` recording the SHA-256 and byte count of the submitted state — never the state text. An answer is advice, not permission: no code path turns a decision into an approval.

## Improvements

## Bug Fixes

## Breaking Changes
