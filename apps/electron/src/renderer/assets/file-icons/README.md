Material Icon Theme SVG subset, from Iconify's `material-icon-theme` collection.

- Upstream: https://github.com/material-extensions/vscode-material-icon-theme
- Collection: https://github.com/iconify/icon-sets/blob/master/json/material-icon-theme.json
- Imported: 2026-10-15. 91 original SVGs, no artwork changes.
- Local source snapshot SHA-256: `0e3d14f138f6c467a1acc735cdcdf6092067d1855774970a3f55c722d0d3b286`
- License: MIT; see LICENSE and the packaged resources/licenses/material-icon-theme-LICENSE.

Associations live in `components/icons/FileTypeIcon.tsx`. Every SVG is bundled by Vite;
no external URL is fetched when browsing files.

Preserve each icon's `left`, `top`, `width`, and `height`. Iconify's omitted dimensions
default to 16; some Material glyphs use a negative vertical origin (for example JSON).
