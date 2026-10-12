# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- Run now includes session-bound Decisions with feature and turn filters, actual handling, request details, and costs from the existing session ledger.

## Improvements

- Desktop navigation uses a tighter row and icon scale, a narrower default sidebar and collapsed rail, and a shared first-row alignment with panel headers. Default light gains neutral borders and clearer soft shadows; macOS panel corners adapt to the native window while Windows and authored theme shapes retain their own geometry.
- Collapsed navigation keeps small square controls with more space around them; expanded navigation uses tighter text rows. Startup waits for persisted theme geometry and fonts before revealing the shell, so a cached size does not flash before the final layout.
- Theme values, derived colors, shape and icon rules now share one source across desktop, WebUI and Viewer. Controls and feature surfaces use explicit roles, with separate UI/reading scales, aligned transcript/composer edges and complete touch targets.
- Standalone browser toolbar and empty state follow persisted workspace themes; Viewer keeps an explicit light/dark choice when the OS theme changes. Theme file and scenic image edits update only affected selections, including after reconnect.

- Decision assistance settings now focus on configuration and connection tests. Runtime statistics moved to Run; Permissions no longer includes the redundant Guarded configuration redirect.
- Run → Decisions was rebuilt on the components the other Run tabs already use: a status row, four equal-weight tiles (decision points, actual changes, fallbacks, decision cost — cost is no longer a hero), a feature comparison matrix with a totals row, a 30px-row record table, and a detail drawer. Wide panels get a right-hand drawer that leaves the list usable; narrow panels collapse the matrix and degrade both tables to rows/cards, with a bottom sheet for the detail.
- Run → Overview's decision summary now uses the Overview's own section and card shapes, and presents cost as known cost plus a separate unknown-request tag.

## Bug Fixes

- Invalid CSS values, variable cycles, translucent opaque surfaces, missing scenic images and unsupported Shiki names now produce diagnostics and a Default fallback. Built-in text/status colors, code overlays and memoized Viewer highlights stay readable when themes change.
- Nested portal menus and tooltips render above their parent dialogs/fullscreen views; keyboard escape and focus restoration remain ordered. Native controls retain visible focus, and touch users can reach hover actions.

- Decision records whose recommendation was applied without changing the baseline no longer print the raw i18n key `trajectory.decisions.status.applied` — the key did not exist, and the i18n gates skip dynamic keys, so nothing caught it.
- Records whose only evidence was a failed, timed-out or cancelled request are now badged failed or cancelled instead of "unconfirmed"; `application.status` cannot express either, so filtering by failure returned rows labelled unconfirmed.
- Model attempt and feature counts use plural forms, so English no longer shows "1 model attempts" or "1 points · 0 changes".
- Decision detail renders the trigger source as key/value rows instead of dumping raw JSON, with the raw record behind a disclosure.

## Breaking Changes
