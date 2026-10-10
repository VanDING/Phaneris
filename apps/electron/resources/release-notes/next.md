# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- Run now includes session-bound Decisions with feature and turn filters, actual handling, request details, and costs from the existing session ledger.

## Improvements

- Decision assistance settings now focus on configuration and connection tests. Runtime statistics moved to Run; Permissions no longer includes the redundant Guarded configuration redirect.
- Run → Decisions was rebuilt on the components the other Run tabs already use: a status row, four equal-weight tiles (decision points, actual changes, fallbacks, decision cost — cost is no longer a hero), a feature comparison matrix with a totals row, a 30px-row record table, and a detail drawer. Wide panels get a right-hand drawer that leaves the list usable; narrow panels collapse the matrix and degrade both tables to rows/cards, with a bottom sheet for the detail.
- Run → Overview's decision summary now uses the Overview's own section and card shapes, and presents cost as known cost plus a separate unknown-request tag.

## Bug Fixes

- Decision records whose recommendation was applied without changing the baseline no longer print the raw i18n key `trajectory.decisions.status.applied` — the key did not exist, and the i18n gates skip dynamic keys, so nothing caught it.
- Records whose only evidence was a failed, timed-out or cancelled request are now badged failed or cancelled instead of "unconfirmed"; `application.status` cannot express either, so filtering by failure returned rows labelled unconfirmed.
- Model attempt and feature counts use plural forms, so English no longer shows "1 model attempts" or "1 points · 0 changes".
- Decision detail renders the trigger source as key/value rows instead of dumping raw JSON, with the raw record behind a disclosure.

## Breaking Changes
