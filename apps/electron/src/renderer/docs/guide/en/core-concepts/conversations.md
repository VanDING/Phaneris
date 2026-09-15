# Conversations

A conversation — a **session** — is the unit of work in Phaneris. It is a
persistent, named, resumable exchange with the agent that outlives the window you
opened it in.

Sessions are organized like an inbox rather than a chat log. Each one has a
status, optional labels, a title, and a durable transcript, and you are expected
to have several in flight.

## Starting one

`Cmd/Ctrl+N`, or the new-chat control in the top bar. A new session starts in
your default permission mode and in the active workspace's context.

The first message matters more than the rest: it is what the title is generated
from, and it is the only turn where the agent has no accumulated understanding of
what you want. A first message that states the outcome and the constraint gets a
better plan than one that states a topic.

## Organizing them

| Control | What it does |
|---|---|
| **Status** | Where the work is — Backlog, Todo, Needs Review, Done. Drives the inbox. |
| **Labels** | What it is about. Hierarchical, filterable, optionally typed. |
| **Flag** | A quick pin, for "come back to this" without inventing a status. |
| **Archive** | Removes it from the inbox without deleting it. |

See [Statuses](phaneris://docs/statuses/overview) and
[Labels](phaneris://docs/labels/overview) for choosing a scheme that stays
useful.

## What is in a transcript

Everything the agent did, not just what it said: each turn records the tool calls
and their results, file reads and writes, commands and their output, and any
prompt it raised for permission. That is the point of the app — a session is a
reviewable record rather than a claim about what happened.

Long responses and plans open in a full-screen document view. Files the agent
produced become artifacts you can open directly.

## Several at once

Sessions run independently. Starting a second one does not interrupt the first,
and a long task can keep running while you work elsewhere. A session that is
working shows it in the list; one that has finished and needs your attention
shows that instead.

Nothing is lost by leaving a session: the transcript is written to disk as it
happens, so closing the window or restarting the app resumes exactly where it
stopped.

## Resuming, branching, and moving

- **Resume** — open it. The agent gets the transcript back, so it already knows
  what was decided.
- **Branch** — fork a session from a particular message to try a different
  direction without losing the original.
- **Send to another workspace** — move a session to a different workspace, where
  its sources and permissions are re-applied rather than carried over. See
  [Workspaces](phaneris://docs/go-further/workspaces).
- **Connect to messaging** — bind a session to a chat platform and continue it
  from your phone. See [Messaging](phaneris://docs/messaging/overview).

## Deleting

Deleting removes the session, its transcript, and its attachments from disk. It
cannot be undone from inside the app, so archive rather than delete unless you
are sure. Sharing a conversation with anyone is not available in this build —
see [Pages](phaneris://docs/go-further/pages) for what stays local.

## Next steps

- [Working directory](phaneris://docs/core-concepts/working-directory) — where a session's commands run.
- [Interactions](phaneris://docs/core-concepts/interactions) — the prompts a session raises, and what they mean.
- [Projects](phaneris://docs/core-concepts/projects) — grouping related sessions around an outcome.
