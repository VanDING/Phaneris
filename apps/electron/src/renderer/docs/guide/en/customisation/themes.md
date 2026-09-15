# Themes

A theme is a JSON file that redefines the app's visual tokens. There is exactly
one built-in theme — `default` — and it cannot be edited. Everything else is
yours.

## How a theme is chosen

Four layers, most specific wins:

1. **App selection** — Settings → Appearance → Default Theme.
2. **Workspace selection** — Settings → Appearance → Workspace Themes. A
   workspace without a selection inherits the app's.
3. **The built-in `default`** — the reserved baseline.
4. **User theme files** — `~/.phaneris/themes/{id}.json`.

A user theme file may be **partial**. Anything it does not define is inherited
from `default`, which means a theme can be twenty lines long and still be
correct — you override the tokens you care about and leave the rest alone.

## Where themes live

```
~/.phaneris/themes/{id}.json
```

The id is the filename without the extension, and it is what a workspace stores
as its selection. Renaming the file changes the id, so a workspace pointing at
the old one falls back to the app default — rename from inside the app.

The directory is user-owned. Phaneris never seeds it, overwrites it, resets it,
or cleans it: files you (or an older version) put there stay there and keep
working as ordinary themes.

A single legacy case is migrated once: if a `~/.phaneris/theme.json` exists, its
contents are copied to `themes/migrated-custom.json` and the original is left in
place but no longer participates in rendering.

## Light and dark

Theming is not "one palette per theme". A theme describes both modes, and
`themeMode` picks between them (light, dark, or follow the system). System colors
are the reason a theme rarely needs two full palettes: they resolve to the right
value per mode, so `foreground/50` is read as light-grey text in dark mode and
dark-grey in light mode without you writing either.

App-level selection is stored in `~/.phaneris/config.json` as `themeMode`,
`colorTheme`, and `themeFont`. A versioned renderer cache exists only to avoid a
flash of the wrong theme at startup; `config.json` is authoritative, so editing it
directly is safe.

## Scenic backgrounds

A theme can define a background image or gradient behind the content area. This
is the main visual difference between themes that otherwise share a palette. Keep
the image low-contrast — the app overlays text on top of it, and a busy
background makes the transcript hard to read in exactly the situation you need it
most.

## Writing one

Start from an existing theme, change the smallest number of tokens that produces
the look you want, and check both modes before using it for real. The tokens are
semantic rather than literal — `accent`, `success`, `destructive`, surface and
text levels — so a theme that overrides only those stays consistent with
components you have never seen.

Ask the agent to build one if you would rather describe the result than the
tokens: it can write the file, apply it, and iterate on the result with you.

## Troubleshooting

**My theme does not appear.** The filename is the id, and it must be `.json` and
valid JSON. A file that fails to parse is skipped rather than breaking the app.

**Half the app changed and half did not.** That is the partial-inheritance
behaviour, and it usually means a token you expected to cascade is not the one
the component uses. Override the semantic token (`accent`) rather than a literal
one (`violet-500`).

**The wrong theme flashes at startup.** The renderer cache and `config.json`
disagree — set the theme again from Appearance, which rewrites both.

## Next steps

- [App Settings](phaneris://docs/reference/config-file) — where the selection is stored.
- [Workspaces](phaneris://docs/go-further/workspaces) — per-workspace themes.
