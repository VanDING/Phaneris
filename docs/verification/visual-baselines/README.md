# Visual baselines (2026-10-20)

Status: **maintained**. Six frozen cells of one stable component page. A change
here is a change to what the product looks like.

```bash
bun run test:visual-baselines --update   # re-freeze (commit the PNGs + index.json)
bun run test:visual-baselines            # compare; fails on any byte difference
```

## What is frozen

`scripts/verification/fixtures/visual-baseline.tsx` renders eight specimens with
fixed copy and no data:

| Specimen | Catches |
| --- | --- |
| `type` | every contract tier from micro to display: a 0.5px font change, a tier mapped to the wrong value |
| `controls` | Button primary/outline/ghost/icon, Input, and the composite search shell: height tiers, radius, the field focus ring's resting state |
| `status` | the five status roles as chips: a hue drifting back to a palette colour, or a `*-text` mix changing |
| `file` | `FileKindIcon` for code/document/folder plus a status glyph: icon stroke weight and the shared mono set |
| `message` | the user bubble: role shape, neutral fill, reading tier |
| `empty` | the empty state: icon size, label/meta tiers, hairline border |
| `density` | settings / plain / menu rows: the only place the density axis is observable |
| `loading` | the spinner ring: its stroke and size |

Cells: `default` × light × comfortable, `default` × dark × comfortable, `default`
× light × compact, `ink` × light, `geek` × dark, `cyberpunk-2077` × dark.

## Why byte comparison

A baseline that tolerates "1% difference" hides exactly the regressions this wave
cares about — a 0.5px type change, a hue drifting back to a palette colour, an
icon stroke moving by 0.15. The comparison is therefore exact: identical bytes,
or it is a drift. An intentional change is one `--update` and shows up in review
as a new PNG.

## Why it is not in `lint`

Baselines are valid for the platform and font rasterisation that produced them.
The workflow records `platform` and the browser version in its run manifest, and
runs with `deviceScaleFactor: 1`, `reducedMotion: reduce` and
`animations: disabled`. Wiring it into the cross-platform gate would produce
noise on every OS that is not the freezing one.

## Known limit, found while freezing

The first freeze made the compact cell byte-identical to the comfortable one:
none of the original specimens consumed the density tokens, so the density axis
was invisible and a density regression would have passed. The `density` specimen
exists because of that. It is a good example of why a baseline needs the review
of "does this fixture actually distinguish what it claims to".

`scripts/verification/visual-baseline-workflow.ts` also waits for the
`--theme-density` token to reach its target value before screenshotting, rather
than sleeping a fixed number of frames; a one-frame-late style swap otherwise
records the previous cell and looks exactly like random flakiness.
