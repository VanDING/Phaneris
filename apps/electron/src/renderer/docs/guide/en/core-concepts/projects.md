# Projects

A **project** groups related sessions around one outcome. It is a lighter thing
than a [workspace](phaneris://docs/go-further/workspaces): a workspace isolates
configuration, a project organizes work inside one.

Where a workspace answers "whose credentials and which sources", a project answers
"what is this collection of conversations about".

## What a project holds

```
~/.phaneris/workspaces/{workspaceId}/projects/{slug}/
  config.json     name, description, defaults, board columns
  assets/         files you attached to the project
```

The parts that actually change behaviour:

| Field | Effect |
|---|---|
| **Working directory** | New sessions in this project start there unless you point them elsewhere. |
| **Details** | Free-form text injected into the system prompt as project context — read on *every* turn in a bound session. |
| **Accent color** | Tints bound sessions in the session list, so a project's work is visible at a glance. |
| **Color theme** | Gives the project its own visual theme, overriding the app default while you are in it. |
| **Board columns** | The Kanban column set for this project, with an optional status auto-applied when a card is dropped in a column. |

Sessions bind to a project; a project with no sessions is a folder with a name.

## Details is the field worth writing

Everything else here is organization. `details` changes what the agent knows, on
every turn, without you repeating yourself:

- **Standing constraints**: *"This codebase is on a release freeze until the 20th; do not bump versions."*
- **Where things are**: *"The API lives in `services/api`; the migration history is in `db/migrations`."*
- **Who it is for**: *"The audience is a non-technical stakeholder; keep summaries free of jargon."*

Write it like a brief for a contractor joining the project today. Two cautions:

**It is paid for on every turn.** A paragraph is context; a page is overhead.

**It goes stale.** Unlike a conversation, a project's details do not update
themselves. When the freeze ends, edit them — an agent confidently following an
expired constraint is worse than one that was never told.

## When to use one

**Use a project when several conversations serve one outcome.** A migration, a
client engagement, a research question — if you would eventually want to read the
whole history together, it is a project.

**Do not use one as a folder per task.** If the sessions do not share context,
labels already organize them without adding a container.

**A project can have a working directory; a workspace has a root path.** If you
are unsure which you need, you probably need a project.

## The board

Every project gets a Kanban board. Its columns are per-project, and a column can
declare a status that is applied automatically when a card is dropped into it —
which is how the board and the inbox stay in agreement instead of drifting.

Cards on the board are work items, and an item can be tied to the sessions that
implement it. See the task and board pages under Go Further for how work flows
through it.

## Archiving

Archiving a project hides it from the sidebar without deleting anything on disk.
Its sessions stay where they are and keep their binding, so un-archiving restores
the whole arrangement.

## Next steps

- [Workspaces](phaneris://docs/go-further/workspaces) — the isolation layer above projects.
- [Working directory](phaneris://docs/core-concepts/working-directory) — what a project can set by default.
- [Conversations](phaneris://docs/core-concepts/conversations) — the sessions a project collects.
