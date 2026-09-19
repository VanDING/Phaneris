# App Settings

App-wide settings live in a single JSON file:

```
~/.phaneris/config.json
```

Most of it you will never edit by hand — Settings writes it for you. But it is a
plain file, it is meant to be readable, and knowing what is in it explains most
of the app's behaviour.

## What is in it

**Behaviour toggles**

| Key | Meaning |
|---|---|
| `notificationsEnabled` | Desktop notifications when a session finishes |
| `sendMessageKey` | `enter` or `cmd-enter` — whether Enter sends or inserts a newline |
| `autoCapitalisation` | Capitalise the first letter of messages |
| `spellCheck` | Underline misspellings in the composer |
| `keepAwakeWhileRunning` | Prevent the display from sleeping while the agent works |
| `richToolDescriptions` | Give the agent fuller tool documentation (more context, better choices) |
| `extendedPromptCache` | Long-lived prompt caching where supported (Anthropic 1h, OpenAI-compatible extended retention) — cheaper repeated turns, slower first one |
| `browserToolEnabled` | Whether the agent may drive the in-app browser |
| `allowRemoteEvaluate` | Whether a *remote* agent may run `browser_tool evaluate`. Off means the local dispatcher refuses it outright |

**Appearance** — `colorTheme`, `themeMode`, `themeFont`. See
[Themes](phaneris://docs/customisation/themes); `config.json` is the
authoritative store, and the renderer's cached copy exists only to avoid a flash
of the wrong theme at startup.

**Workspaces** — the workspace list and app-level defaults inherited by new
workspaces.

## A file that is deliberately boring

Two properties are worth knowing because they make direct editing safe:

- **Writes are atomic.** The file is replaced, never edited in place, so an
  interrupted write cannot leave you with a truncated config.
- **Dated backups are kept.** Before a change, the previous contents are copied
  to a `config.json.bak-<date>` alongside it. If an edit goes wrong, the previous
  version is right there.

The file is written with owner-only permissions (`0600`), because the workspace
list and connection settings describe your machine.

## `config-defaults.json` is not yours

A second file sits next to it:

```
~/.phaneris/config-defaults.json
```

It carries the defaults the app ships with, and it is **rewritten from the
bundled copy on every launch**. Editing it has no lasting effect — change the
setting in the app instead, which writes `config.json`.

The defaults that matter for how a session starts:

| Setting | Default |
|---|---|
| Default permission mode | Explore (read-only) |
| Default thinking level | Medium |
| Modes reachable by cycling | Explore and Execute — `Ask to Edit` is skipped by default, because cycling past the mode that asks you to confirm is the one you least want to do by accident |

Both the default mode and the cycle set are per workspace, so a workspace you
trust can start in Execute while the rest of the app stays in Explore.

## When to edit by hand

Almost never. The exceptions are the ones where the app has no UI:

- Turning off `browserToolEnabled` or `allowRemoteEvaluate` for a restricted
  environment.
- Setting `spellCheck` on a machine where the UI toggle is awkward to reach.
- Scripting a machine setup, where writing the file is the point.

If you do edit it while the app is running, the change is picked up — the config
file is watched. A file that fails to parse is ignored rather than acted on, so a
typo leaves the previous settings in force.

## Next steps

- [Preferences](phaneris://docs/reference/preferences) — the personal details the agent knows about you.
- [Workspaces](phaneris://docs/go-further/workspaces) — the per-workspace settings that override these.
