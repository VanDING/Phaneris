# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Project memory and MCP content** — Add an append-only project memory tool and source resource/template/prompt tools. Resource-only MCP servers connect without requiring a tools capability, and binary content is saved with the session.

## Improvements

- **Activity and icons** — Expand the profile activity heatmap by simplifying its surrounding controls, use Phaneris branding for the bundled tool icon, normalize sidebar and session-menu icons, add colored file-type artwork, and show a blocks-wave animation while thinking.
- **Task reliability** — Pass dependency replies to dependent nodes, accept only the current child turn's output, and use activity-aware deadlines with a moderate thinking level when generating task definitions.
- **Model and source handling** — Prefer provider-specific utility models while preserving explicit choices, isolate project Pi settings, canonicalize labels, and share source sign-in flows across waiting sessions.

- **Pi SDK 1.2.0** — Upgrade the complete kernel package family together and adapt source-tool result declarations to the new codemode format. Preserve full structured results, including arrays and scalar JSON values, while retaining host permissions, durable accounting, and existing session history.

## Bug Fixes

- **Session titles** — Retry unavailable or protocol-incompatible utility models within the configured connection so initial and regenerated titles can use the selected session model without switching to another provider.
- **Source authentication** — Scope credential refresh to each workspace and source; validate HTTP credential headers and reuse refreshable tokens before requesting another sign-in.
- **Browser reliability and privacy** — Make hidden browser input and screenshots reliable, confirm security challenges before requesting user assistance, and hide browser text-entry arguments before persistent history is written.
- **Input and workspace correctness** — Keep drafts when attachments exceed the existing transport limit, prevent Cancel from submitting credential forms, and correct automation timezones, workspace deep links, source failure status, and inherited runtime paths.

## Breaking Changes
