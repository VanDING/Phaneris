# Themes

Phaneris currently offers **Default** as its only product theme, with light and dark palettes. In **Settings → Appearance**, choose **System**, **Light** or **Dark**. Font preferences remain independent.

Default combines white paper, cool neutral surfaces and violet emphasis in light mode; dark mode uses graphite surfaces and softer violet. Amber, green and red mean attention, success and failure. Run shares this visual family and adds categorical data colors for context inspection.

## Existing preferences

Previous selections of Geek, Cyberpunk 2077, Ink and user themes resolve to Default. Workspace theme overrides are inactive. Mode and font preferences are preserved. Workspace avatars, project identity and kanban colors remain separately configurable.

Phaneris does not delete or overwrite files in `~/.phaneris/themes/`. These files are no longer selectable product themes. Reading workspace settings does not rewrite the original file.

## Color and readability

Icons, borders and fills use original semantic colors. Text has separate contrast-safe colors; text on solid fills uses the matching fill's own on-color. Readable original colors are retained, with text adjusted only when needed. Status washes and hover states participate in the same checks.

Startup CSS, runtime snapshots and fallback colors share one derivation policy. Text requires 4.5:1 contrast and meaningful graphics 3:1. User-authored HTML, PDFs, terminal ANSI output and vendor marks retain their own colors.

## Configuration and troubleshooting

`themeMode`, `colorTheme` and `themeFont` in `config.json` are authoritative preferences. The product color theme resolves to `default`. The renderer cache only assists startup.

If the mode is unexpected, check whether Appearance follows the operating system. If an individual control looks wrong, report the control and its state. The internal theme schema, compiler diagnostics and contrast gates remain available for engineering verification and future work.

## Next steps

- [Colors](phaneris://docs/customisation/colors)
- [App settings](phaneris://docs/reference/config-file)
- [Workspaces](phaneris://docs/go-further/workspaces)
