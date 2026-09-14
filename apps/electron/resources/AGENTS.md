# Bundled Resources

This folder contains assets bundled with the Electron app. Most configurable
assets are synced to `~/.craft-agent/`; exceptions are documented below.

## How It Works

1. **Build time**: `scripts/copy-assets.ts` copies this folder to `dist/resources/`
2. **Package time**: electron-builder includes `dist/resources/` in the app bundle
3. **Runtime**: `getBundledAssetsDir()` resolves paths to these bundled assets
4. **Launch**: Sync-enabled asset types update the user's home directory

## Asset Types

| Folder/File | Synced To | Sync Behavior |
|-------------|-----------|---------------|
| `docs/` | `~/.craft-agent/docs/` | Always overwrite on launch |
| `permissions/` | `~/.craft-agent/permissions/` | Always overwrite on launch |
| `tool-icons/` | `~/.craft-agent/tool-icons/` | Always overwrite on launch |
| `release-notes/` | `~/.craft-agent/release-notes/` | Always overwrite on launch |
| `config-defaults.json` | `~/.craft-agent/config-defaults.json` | Always overwrite on launch |

## Why Sync-Enabled Assets on Every Launch?

- Ensures users always have the latest defaults/docs when the app updates
- Consistent behavior between debug and release builds
- No stale configuration causing confusion

## Other Files (Not Synced)

These files are used by electron-builder or the app directly, not synced to user home:

| File | Purpose |
|------|---------|
| `icon.svg` | **Artwork source of truth** — the transparent Phaneris mark (1000x1000). Edit this, then regenerate. |
| `icon-app.svg` | Generated: square full-bleed app icon (white rounded square + mark). |
| `icon.png` / `icon.ico` / `icon.icns` | Generated platform icons (Linux/Windows/macOS). |
| `icon.icon/` | Generated macOS 26+ Liquid Glass asset catalog input. |
| `Assets.car` | macOS compiled asset catalog (compiled with `actool` on macOS, committed). |
| `dmg-background.*` | DMG installer background |
| `phaneris-logos/` | Generated brand raster assets (app icon light/dark, mark black/white). |
| `source.png` | Default source icon |
| `generate-icons.sh` | Legacy macOS-only icon script (`sips`/`iconutil`). Superseded — see below. |
| `bridge-mcp-server/` | Bundled MCP server for Codex/Copilot API source bridge |
| `pi-agent-server/` | Bundled Pi agent server for Pi SDK sessions (#5b in build-win.ps1) |
| `themes/default.json` | Immutable built-in Default theme; never copied into the user-owned themes directory |

## Icon generation

`bun run scripts/generate-icons.ts` (repo root) regenerates every icon artifact
above from `icon.svg`. It is cross-platform, needs no network and no dependency
beyond the already-installed `sharp`. Never hand-edit a generated icon file, and
never substitute a web-only image for a platform icon asset.

## Single Source of Truth

The files in this folder are the **source of truth** for bundled defaults:
- Edit `config-defaults.json` here to change default settings
- Edit files in `docs/` to update documentation
- Edit `themes/default.json` together with the canonical `DEFAULT_THEME_FILE`
  snapshot to update the one built-in theme; a test prevents them from drifting

`~/.craft-agent/themes/*.json` is user-owned. Never seed, overwrite, reset, or
delete files in that directory. The application only ensures the directory exists.

The Default theme has a canonical TypeScript snapshot used at runtime and a
matching JSON resource for packaging/documentation. Keep them identical; the
theme test enforces the invariant.

## Release Notes Authoring

**Never create `{version}.md` files in feature commits.** Versioned files in `release-notes/` are owned by the release skill — it consolidates pending entries into `{version}.md` at release-prep time and resets the scratch file.

For PRs that add user-visible behavior, append a bullet to the relevant section in [`release-notes/next.md`](release-notes/next.md). Match the tone and depth of recent versioned files (e.g. `0.9.0.md`): bold short title — detailed paragraph — issue reference — commit hash.

**Why this exists:** during v0.9.0 prep, two feature commits had pre-emptively written `0.8.14.md` and `0.8.15.md` (guessing patch releases), but the changes ended up rolled into a minor. Both files had to be deleted and folded back in — without that cleanup, they would have surfaced as ghost versions in the in-app release-notes panel.
