# Icons

Phaneris shows a small icon beside most entities — sources, skills, statuses,
tool calls — and most of them can be yours.

Icons are a scanning aid. A list where every row has the same generic glyph is a
list you read; a list with distinct marks is a list you glance at. That is the
entire argument for spending five minutes on them.

## Where icons come from

| Behaviour | Effect |
|---|---|
| **Automatic** | A source connected to a known service gets that service's mark, downloaded once and cached locally |
| **Chosen** | Skills, statuses, and tool icons take a value you provide |
| **Fallback** | Anything unrecognised gets a neutral glyph rather than a wrong logo |

Automatic lookup happens when a source is created, not on every render: the icon
is fetched once and stored with the source. A service the app has never heard of,
or a local endpoint, gets the neutral mark.

## Providing one

An icon value is one of:

- **A built-in name** — the app's own icon set.
- **An absolute file path** — an image on your machine, `.svg`, `.png`, `.jpg`,
  `.jpeg`, `.ico`, `.webp`, or `.gif`.
- **An emoji** — a single character, often the fastest way to make a row
  distinguishable.
- **An `http(s)` URL** — fetched once and cached locally with the entity.

Two forms are rejected on purpose: **inline SVG** and **relative paths**. Both
keep configuration readable and portable — a config that embeds markup, or that
only resolves from one directory, is a config that breaks when you copy it.

Model providers and document formats are matched by brand where the app knows
them; custom endpoints deliberately do not guess, because showing the wrong
company's logo is worse than showing none.

## Choosing well

**Distinct beats pretty.** The icon's job is to be recognised at a glance in a
list, not to look good on its own. Two blue circles are the same as no icons.

**Small means simple.** These render at around sixteen pixels. Detail disappears;
silhouette and color survive.

**Do not encode meaning you will want to change.** An icon that means "urgent"
is harder to update than a label that says urgent.

**Emoji are legitimate.** A single character with a distinct color is a better
icon than a detailed SVG nobody can make out.

## Tool icons

Individual tool calls can be given an icon of their own, which is what
distinguishes a `git` call from a `curl` call in a long transcript. The bundled
guide for this is installed with the app at `~/.phaneris/docs/tool-icons.md`, and
the agent can configure it for you.

## Next steps

- [Colors](phaneris://docs/customisation/colors) — the other half of making a list scannable.
- [Sources](phaneris://docs/sources/overview) — where automatic icons come from.
