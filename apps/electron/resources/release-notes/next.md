# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Compaction threshold** — Configure an optional context token threshold in AI settings. Keep the SDK default when blank, clamp to the active model, and preserve the original summary budgets, cancellation and durable usage accounting.

- **Project memory and MCP content** — Add an append-only project memory tool and source resource/template/prompt tools. Resource-only MCP servers connect without requiring a tools capability, and binary content is saved with the session.
- **Chat starters** — Workspaces can define up to three prompt chips shown on the new chat screen. A starter sends its prompt verbatim, enables the sources it mentions (waiting until they are enabled before the message goes out), and invokes the skills it mentions; unknown mentions are ignored. Invalid starters (too many, blank, over-long) are rejected when saved rather than rendered.
- **HEIC/HEIF photos** — Photos and screenshots from iOS attach and preview correctly. HEIC/HEIF is transcoded to JPEG once, in a worker that is terminated if it exceeds its deadline, and the stored bytes, MIME type, extension and size always describe the same artifact. AVIF is detected explicitly and never converted.

## Improvements

- **Default accent** — The default theme's accent and focus ring now use the brand purple `#7851A9`. Dark mode uses the same hue lifted to `oklch(0.660 0.160 302.3)`, because the literal value measures 2.97:1 against the graphite canvas and 3.55:1 for black `--on-accent` text; every built-in palette still clears its WCAG floor.
- **Board and column colours** — The board now expresses progress through theme roles instead of four fixed Tailwind hues: neutral columns with a coloured identity dot, `info` for active work, `success` for done, and count chips on a neutral surface. Column headers, count chips and the column body meet the same contrast floor as the rest of the app, and Ink / Cyberpunk 2077 govern the board like every other surface. A finished column starts collapsed once it holds more than a screenful (with an explicit Show/Hide toggle that keeps the count), and an empty column now offers the new-task affordance where the gap is.
- **Panel titles and widths** — Panel titles are 16px and there is exactly one `h1` per screen (the primary surface); navigator, workbench and artifact headers are `h2`. The context workbench is capped at half the row, so the transcript keeps its reading width on wide windows and no longer overflows below 1512px.
- **Navigation and planning surfaces** — Give sidebar icons the same contrast as session menus, restore the previous Pages icon, and clip the Gantt chart to its rounded frame while keeping scrollbars and task menus usable.
- **Activity and icons** — Expand the profile activity heatmap by simplifying its surrounding controls, use Phaneris branding for the bundled tool icon, normalize sidebar and session-menu icons, add colored file-type artwork, and show a blocks-wave animation while thinking.
- **Task reliability** — Pass dependency replies to dependent nodes, accept only the current child turn's output, and use activity-aware deadlines with a moderate thinking level when generating task definitions.
- **Model and source handling** — Prefer provider-specific utility models while preserving explicit choices, isolate project Pi settings, canonicalize labels, and share source sign-in flows across waiting sessions.

- **Pi SDK 1.2.0** — Upgrade the complete kernel package family together and adapt source-tool result declarations to the new codemode format. Preserve full structured results, including arrays and scalar JSON values, while retaining host permissions, durable accounting, and existing session history.

## Bug Fixes

- **Usage and failure diagnostics** — Keep missing provider usage distinct from reported zero and preserve partial usage on errors or cancellation. Show unknown costs separately from SDK estimates, retain canonical tool names in validation failure hooks, and suppress expected PDF repair warnings while keeping real errors.

- **Attachment drafts** — Normalize HEIC files from file selection, drag and drop, and paste before sending. Keep the draft when conversion fails, preserve text typed while storage is pending, and use transferable worker memory for small images in Electron.
- **Workspace editing** — Add rich mentions to chat starter settings, protect settings while their initial read is pending or has failed, and isolate delayed reads and writes when switching workspaces. Keep model catalogs tied to the selected provider while requests are loading or finish out of order.
- **Document editing and PDF resources** — Allow pasted images after an artifact editor finishes its initial validation, and release PDFium documents and render bitmaps on success and failure.
- **Pi interruption recovery** — Return cross-session delivery receipts after the message is durably accepted, without waiting for the receiving agent to finish. Preserve known tool results after cancellation, allow a new turn after a model-only interruption while retaining unknown billing, and save credential-redacted diagnostics for unexpected Pi exits.
- **Model and workspace settings** — Saving a provider connection no longer reverts a model field you did not edit: the default model, the utility model and the stored model list are each kept or updated on their own, and switching provider never carries the previous provider's models along. Workspace chat starters are cleared the moment you switch workspaces, so a slow response for the workspace you left can no longer appear over the one you are in.
- **Workspace and source lifecycle** — Keep Pages, projects and automations on the current workspace when older requests finish late. Share concurrent Page initialization and MCP connections, close connections that are still starting during disconnect, and reuse the first MCP tool catalog response during connection setup.
- **Source activation** — Wait for the current request to settle before automatically continuing with newly activated tools. Recover from late settlement without restarting the app, and show an error if automatic continuation fails.
- **Windows reopening** — Preserve launch requests received while the previous instance is shutting down, recover a running instance with no window, and apply bounded cleanup with persistent lifecycle diagnostics to ordinary quits.
- **Session titles** — Retry unavailable or protocol-incompatible utility models within the configured connection so initial and regenerated titles can use the selected session model without switching to another provider.
- **Source authentication** — Scope credential refresh to each workspace and source; validate HTTP credential headers and reuse refreshable tokens before requesting another sign-in.
- **Browser reliability and privacy** — Make hidden browser input and screenshots reliable, confirm security challenges before requesting user assistance, and hide browser text-entry arguments before persistent history is written.
- **Input and workspace correctness** — Keep drafts when attachments exceed the existing transport limit, prevent Cancel from submitting credential forms, and correct automation timezones, workspace deep links, source failure status, and inherited runtime paths.
- **Provider endpoints and user models** — Point Kimi Coding at its current `/coding/v1` endpoint and route OpenCode through its native provider catalog, so each protocol family uses its own base URL. Connections saved against a retired default keep their protocol, their own model IDs and their per-model settings; only the dead URL is rewritten, and nothing is written back to your configuration.
- **Attachments and verification** — Report the stored artifact's real format for re-encoded images, fall back to the PNG thumbnail when a format cannot render inline, and stop browser-driven verification from stalling on an IPv6-only test listener.

## Breaking Changes
