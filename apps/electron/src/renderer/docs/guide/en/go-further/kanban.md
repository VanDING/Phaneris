# Kanban Board

The board is where work that is not a conversation lives. A **work item** is a
card: something to be done, with a place on the board, optionally a date, and
optionally the sessions that are doing it.

Conversations are where work happens. The board is where it is tracked. A card
can exist before any session does, and collecting the sessions onto it afterwards
is what keeps "what am I doing about this" answerable.

## Columns

Columns belong to the **project**, not the app, so two projects can have
different workflows without either compromising. Each column can declare:

- **A name** — shown verbatim, never translated. It is your word.
- **An accent color** — a hex value for the column header.
- **A drop status** — the session status applied automatically to sessions on a
  card dropped into this column.

That last one is the part worth setting up. It is what keeps the board and the
inbox from disagreeing: moving a card to Done moves its work to Done, instead of
leaving you to update the same fact in two places and eventually stop updating
one of them.

A project with no custom columns gets the default three.

## Views

The same items, three ways:

| View | For |
|---|---|
| **Board** | Moving things. The default. |
| **List** | Scanning and filtering, especially when there are more cards than fit on a screen. |
| **Calendar** | Anything with a date — seeing what lands when, and what collides. |

## Cards and sessions

A card can be linked to one or more sessions. The link is what makes a card
evidence rather than intention: from the board you can see whether anything is
actually happening, and from a session you can see what it is part of.

Cards created by the agent's task flow are backed by a specification — the tile
knows its task, and opening it opens the task rather than a blank editor.

## Keeping a board useful

**One board per project, and a project per outcome.** A board shared by unrelated
work becomes a list nobody trusts.

**Set the drop statuses early.** Retro-fitting them means reconciling months of
drift between the board and the inbox.

**Let the agent create cards.** "Track this" is a reasonable thing to say in a
conversation, and the resulting card is linked to the conversation that produced
it — which is more context than you would have written by hand.

**Archive rather than delete.** A card records why something was done, and that
is worth more six months later than the space it takes.

## Next steps

- [Projects](phaneris://docs/core-concepts/projects) — where columns and their drop statuses are configured.
- [Statuses](phaneris://docs/statuses/overview) — the states a drop status applies.
