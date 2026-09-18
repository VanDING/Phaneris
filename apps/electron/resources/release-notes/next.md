# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Plugin bundles: install a whole capability set, invoke it with `/name`.** A workspace can hold plugins — directories under `plugins/` following the Agent Plugins 1.0.0 package format (`plugin.json`, plus any of `skills/`, `mcp.json`, `PROMPT.md`, and a `phaneris/sources.json` extension). Installing one materializes its skills into `skills/` and its sources into `sources/`, so from then on they are ordinary workspace resources you can edit or disable yourself. Typing `/` now lists installed plugins alongside the permission modes; picking one makes it resident for the session — one at a time, so `/B` replaces `/A` — pre-enables the sources it contributes, and adds its `PROMPT.md` and a roster of its skills to every turn. The skills themselves are not force-fed: the agent reads one when it needs it, which is what keeps a plugin's per-turn cost flat. Ask the agent to install, edit, or remove a plugin and it walks you through the overwrite list and the exact commands a package will run before anything is written. The new Plugins section in the sidebar shows what is installed, what each bundle contributes, and what an uninstall would remove versus keep.

## Improvements

- **The product now names itself consistently as Phaneris.** The system prompt's environment marker is `<phaneris_environment …/>` (and moved to the end of the assembled prompt so an app-version change no longer invalidates the cached prefix), the assistant introduces itself as running "in the Phaneris desktop app", and the bundled agent guides no longer call the product "Craft". Menu, re-authentication and backend labels keep their existing wording.
- **Page authoring uses the `phaneris-pages/v1` bridge envelope.** Pages built from the current scaffold emit the new name and accept both; the host still accepts and emits the legacy `craft-pages/v1` envelope, so pages built before the rename keep working.

## Bug Fixes

## Breaking Changes
