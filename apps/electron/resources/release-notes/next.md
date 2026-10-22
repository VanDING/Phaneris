# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

## Improvements

- **Workbench width** — The divider between the transcript and the workbench now reflects what is actually painted. The transcript keeps a 380px reading floor, the workbench takes the rest, and the divider can be dragged past half the window: the ceiling is measured from the row, so the drag stops where the workbench would fall below its own minimum instead of at a fixed 600px. Opening the workbench no longer starts wide and shrinks into place; it grows into position.
- **Board** — The board returns to its earlier presentation: coloured column headers with a matching body tint, card footers with their rule, and no collapse toggle or render cap. The colour identities keep theme awareness (they follow Ink and Cyberpunk), so the board still matches the rest of the app.

## Bug Fixes

- **Sending clears immediately** — The composer used to keep the text until the send was acknowledged, so an already-sent message sat in the field for about half a second (longer with attachments, which store before the send). The field now clears when you send and the draft comes back only if the send is refused.

- **Injected context colour** — The Run context bar and its legend drew "Injected context" with a colour that produced no CSS at all, so both the segment and its dot were invisible. It now uses a registered colour and stays visible in light and dark.
- **Column header contrast** — A user-chosen column colour picked its text colour from the fill's luminance instead of assuming white, so an amber column no longer renders white text at 2.15:1.

## Breaking Changes
