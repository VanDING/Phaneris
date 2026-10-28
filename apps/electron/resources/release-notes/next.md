# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

## Improvements

- **Responsive startup and maintenance** — Run full database verification and backup work outside the main thread, and prepare scheduled backups after workspace initialization. Keep corrupt database recovery and unknown-action protection.

## Bug Fixes

- **Cancellation accounting** — Drain pending model preparation and observed results before clearing cancellation receipts, preserving known zero usage when a request never reached the provider.
- **Cache warming limits** — Preserve the explicit one-token output limit when a custom endpoint inherits options from an ordinary conversation request.

- **AI connection validation** — Give disposable Pi probes an existing temporary working directory, fixing Bun ENOENT when adding a provider. Release the subprocess, temporary credentials and directory on completion or timeout.
- **Stopped answers** — Preserve interrupted streaming text as intermediate content instead of presenting it as a final answer.
- **Compaction settings** — Reject non-finite token thresholds before JSON transport can silently treat them as the default setting.

## Breaking Changes
