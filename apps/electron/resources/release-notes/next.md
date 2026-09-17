# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

## Improvements

- **The product now names itself consistently as Phaneris.** The system prompt's environment marker is `<phaneris_environment …/>` (and moved to the end of the assembled prompt so an app-version change no longer invalidates the cached prefix), the assistant introduces itself as running "in the Phaneris desktop app", and the bundled agent guides no longer call the product "Craft". Menu, re-authentication and backend labels keep their existing wording.
- **Page authoring uses the `phaneris-pages/v1` bridge envelope.** Pages built from the current scaffold emit the new name and accept both; the host still accepts and emits the legacy `craft-pages/v1` envelope, so pages built before the rename keep working.

## Bug Fixes

## Breaking Changes
