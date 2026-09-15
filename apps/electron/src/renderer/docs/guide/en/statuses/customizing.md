# Customizing Statuses

Statuses are per workspace, and editing them is a normal thing to do — the five
the app ships with are a starting point, not a schema.

## What an entry has

An entry in `~/.phaneris/workspaces/{id}/statuses/config.json`:

| Field | Notes |
|---|---|
| **id** | Stable, lowercase, hyphenated. Sessions reference this. |
| **label** | What you see. Rename freely — it is display only. |
| **color** | Optional. A semantic name, optionally with `/opacity`. |
| **category** | `open` or `closed`. Decides the inbox/archive split. |

The rule that matters: **rename the label, never the id.** Changing an id
orphans every session that was in that status, and there is no migration for it.

## Fixed versus removable

| Status | Can you delete it? |
|---|---|
| `backlog`, `needs-review`, `cancelled` | Yes — the app created them |
| `todo`, `done` | No — the workflow's mechanics depend on them |

The fixed two keep their ids and their categories; their labels and colors are
yours to change. Renaming `done` to "Shipped" is fine; making it `open` is not,
because it is the state that takes work out of the inbox.

## Icons

A status can have its own icon, from `statuses/icons/`. Same rules as
[anywhere else](phaneris://docs/customisation/icons): a built-in name, an
absolute path, an emoji, or an https URL — not inline SVG, not a relative path.

## A worked example

A support workflow, starting from the defaults:

| id | label | category | why |
|---|---|---|---|
| `todo` | Todo | open | Keep. New request, not started. |
| `waiting` | Waiting on Customer | open | **New.** The state that stops you re-reading the same ticket. |
| `needs-review` | Ready to Send | open | Renamed. The work is done; it needs a second look before it goes out. |
| `done` | Resolved | closed | Renamed only. |
| `cancelled` | Won't Fix | closed | Renamed. |

Three renames, one addition. That is usually the shape of it — the categories
were already right, and only the vocabulary needed to match how you actually talk
about the work.

## Next steps

- [Statuses](phaneris://docs/statuses/overview) — what they are for, and how many to have.
- [Automations](phaneris://docs/automations/overview) — reacting to a status change.
- [Kanban board](phaneris://docs/go-further/kanban) — column drop statuses, which write statuses for you.
