# Statuses

A **status** is a session's place in your workflow. Where labels say what a
conversation *is about*, statuses say where it *is* — and unlike labels they
drive the inbox, because every status belongs to either the open set or the
closed set.

The app ships with five:

| Status | Category | Notes |
|---|---|---|
| Backlog | open | Default for a new session you are not starting yet |
| Todo | open | Committed to doing |
| Needs Review | open | Work is done; it needs your eyes |
| Done | closed | Fixed — moves out of the inbox |
| Cancelled | closed | Deliberately not doing it |

Statuses are **per workspace**, so "Done" can mean something different in a
personal workspace than in a client one.

## Why bother

An inbox with no state is a list you re-read to remember. A status turns it into
a queue you can act on: filter to open items to see what is actually
outstanding, and to a single status when you sit down to do one kind of work.

`Needs Review` is the one worth adopting even if you ignore the rest. It is the
difference between "the agent finished" and "I have checked that it finished
correctly", and those are not the same event.

## Customizing

Statuses live in the workspace:

```
~/.phaneris/workspaces/{id}/statuses/
  config.json      the status list
  icons/           optional icons
```

You can edit them in Settings → Statuses, or ask the agent to change them. A
status entry has an id, a label, an optional color, and a category:

- **id** — stable, lowercase, hyphenated. Renaming the label does not break
  anything; changing the id does, because sessions reference it.
- **color** — either a system color that adapts to light and dark
  (`accent`, `info`, `success`, `destructive`, `foreground`, optionally with an
  opacity suffix like `info/80`) or an explicit color.
- **category** — `open` or `closed`. This is what decides membership in the
  inbox versus the archive.

`Backlog`, `Needs Review` and `Cancelled` are labeled *default* in the config,
meaning the app created them and you can remove them. `Todo` and `Done` are
*fixed*: they are part of the workflow's mechanics and cannot be deleted, though
their labels and colors can change.

## Designing a set that stays useful

**Keep it around five.** Every status is a decision you make on every
conversation. Past six or seven, you start guessing which one applies, and a
guessed status is worse than no status.

**Have exactly one "waiting on someone else" state.** Whether you call it
Needs Review or Blocked, one state for "not mine right now" is what keeps the
open list honest.

**Do not encode priority in a status.** Priority changes; a status change is a
workflow event. Use a label for priority and let the two vary independently.

## Next steps

- [Labels](phaneris://docs/labels/overview) — the other axis: what a session is about.
- [Automations](phaneris://docs/automations/overview) — react to status changes.
