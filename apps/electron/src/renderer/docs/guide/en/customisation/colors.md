# Colors

Color in Phaneris is semantic, not literal. You do not choose "purple" — you
choose *accent*, and the theme decides what accent looks like in light mode, in
dark mode, and under a different theme.

That is what makes a theme twenty lines long, and what lets a custom color work
across every surface without you checking each one.

## The vocabulary

Named colors resolve through the active theme and adapt to light and dark
automatically:

| Name | Typically |
|---|---|
| `accent` | The brand color |
| `info` | Blue or amber — neutral emphasis |
| `success` | Green |
| `warning` | Amber or orange |
| `destructive` | Red — for the thing that deletes |
| `foreground` | The text color, for a muted or neutral marker |

Add `/` and an opacity to soften one: `foreground/50` is the text color at half
strength, and it resolves correctly in both modes. This is the usual way to
express "quieter than normal" without picking a grey that only works in one theme.

## Where you use them

- **Labels** — the chip color in the session list and filters.
- **Statuses** — the state color in the status menu and badges.
- **Projects** — an accent that tints bound sessions, so a project's work is
  visible at a glance.
- **Board columns** — the header accent, which is a hex value rather than a
  semantic name, because column identity is per-project and user-authored.

## Custom colors

Where a semantic name is not specific enough, a custom color is available. It is
stored as a light/dark pair, because a color that reads well on white almost
never reads well on near-black.

Prefer the semantic names. A custom color is a promise that you will check it in
both modes and against every surface it appears on; the semantic ones have
already made that promise.

## Why opacity beats a lighter shade

`info/80` and a hand-picked pale blue look similar on your current background and
behave differently everywhere else. The opacity form is computed against whatever
is behind it, so it stays correct on a card, in a panel, and over a scenic
background. The literal one does not.

## Next steps

- [Themes](phaneris://docs/customisation/themes) — redefining what the names resolve to.
- [Labels](phaneris://docs/labels/overview) and [Statuses](phaneris://docs/statuses/overview) — where you choose them most often.
