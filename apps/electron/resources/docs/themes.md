# Appearance and Default Theme

Phaneris currently offers one product theme: **Default**, with light and dark variants. Choose **System**, **Light**, or **Dark** in Settings → Appearance. Font preferences remain independent.

Default uses white paper, cool neutral surfaces and violet emphasis in light mode; dark mode uses graphite surfaces and softer violet. Amber means attention, green means success, and red means failure. The Run views use the same visual family, with distinct colors for context categories.

## Existing configurations

Previous color-theme selections (including Geek, Cyberpunk 2077, Ink and user themes) resolve to Default. Workspace color overrides are inactive. Changing mode or font persists Default through the normal atomic preferences API. These changes do not delete or overwrite files under `~/.phaneris/themes/`, or rewrite workspace files when reading them.

Workspace avatar colors and project colors still identify workspaces and projects; they do not change the application palette.

## Color responsibilities

| Token | Purpose |
| --- | --- |
| `--accent`, `--info`, `--success`, `--destructive` | Original colors for icons, borders and fills |
| `--*-text` | Readable semantic text on shared surfaces and status washes |
| `--on-*` | Text on the matching solid semantic fill |
| `--foreground`, `--muted-foreground` | Primary and secondary text |

Readable original colors are retained. Text is adjusted only when contrast is insufficient, using the shared color policy. Each solid fill has its own black or white on-color. The same algorithm generates startup CSS and runtime snapshots.

## Engineering contract

`packages/shared/src/config/theme.ts` owns Default. `theme-color-policy.ts` owns derivation and contrast thresholds. Generated CSS, bundled JSON and contract documentation must be regenerated together with `bun run theme:generate`; `bun run check:themes` rejects drift. `bun run check:contrast-floor` checks text at 4.5:1 and meaningful graphics at 3:1.

The existing file schema, browser compiler, validation diagnostics and internal theme tools remain available for engineering use and future development. They do not add selectable product themes. User-authored HTML, PDFs, terminal ANSI output and vendor logos retain their own colors.
