# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Assistant reads original conversations** — The workspace assistant can inspect ordinary Session originals, including tool outcomes and errors, without an existing memory entry. Reads use bounded snapshots and retain forgetting and Source revocation rules.

- **Manage existing Workers** — Inspect, pause, resume, supplement, retry unfinished work, and adjust execution settings or planning through attributed commands. Commands preserve the original Session, authorization and completed effects, including context handoffs and restart recovery.

## Improvements

- **Separate assistant duties from Worker authorization** — Host-provided capabilities describe the assistant's reading and management role independently from the user's Worker execution ceiling. Existing Explore settings remain effective.

- **Task controls and original evidence** — Task details include management receipts, recent originals and execution settings. Read-only Source contracts can explicitly identify an exact POST query operation without allowing general POST writes.

## Bug Fixes

- **Recover existing assistant history** — Rebuild old and partially refreshed history indexes without duplicate-message conflicts, preserving memories, forgetting records and extraction checkpoints.
- **Restore learning in older workspaces** — Recognize registered legacy workspace identities, share one identity for new workspaces, and distinguish paused learning from invalid configuration and explicit-only learning.
- **Read long assistant conversations reliably** — Assistant opening and execution-setting changes use the existing chunked Session protocol. Source inspection pages long originals with version checks instead of returning an oversized response.

## Breaking Changes
