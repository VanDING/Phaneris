# What changed

<!-- One paragraph. What the user can now do, or no longer sees wrong. -->

## Verification

<!-- The commands you ran and their result, not the intent. -->

```bash
bun run typecheck:all
bun run lint
```

## UI changes

Delete this section when the change does not touch a rendered surface.

- [ ] **Primitive or layout change** — attached screenshots at **1280 / 1536 /
      1920** in **light and dark**, before and after. A primitive change moves
      every consumer; three widths and both modes is the cheap half of finding
      out which.
- [ ] **Computed result checked, not just class names** — the 2026-10-21 audit
      found `cn()` silently dropping font-size tiers while every class string
      looked correct. `bun run test:ui:primitives` and `bun run test:ui:chrome`
      assert what the browser paints; run them when a control, a panel or a
      chrome row moves.
- [ ] **Both modes and the built-in palettes** — `bun run check:contrast-floor`
      covers Default, Geek, Cyberpunk 2077 and Ink. A hard-coded colour instead
      of a role token fails that gate or, worse, passes it and breaks the other
      three themes.
- [ ] **Long session** — `bun run test:long-session-budget` when the transcript
      render path changes (an append must touch one row).

## Release notes

- [ ] User-visible behaviour appended to
      `apps/electron/resources/release-notes/next.md`. Never create a versioned
      file in a feature PR.
