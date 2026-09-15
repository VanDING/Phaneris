# Performance

Two things cost real money and real time in an agent app: the tokens you send to
the model, and the work the agent does before it understands the task. Both are
mostly decided by how a conversation is set up, not by a setting.

## What actually costs

**Conversation length.** Every turn re-sends the conversation so far. A session
that has been running for hours costs more per message than one that started a
minute ago, regardless of what you type.

**Context blocks.** The agent is given per-turn context — date and time, session
state, available sources — on top of the transcript, and project details on top
of that. This is why a project's `details` field should be a paragraph, not a
page: it is billed on every turn.

**Tool output.** A single command that prints ten thousand lines stays in the
transcript and is re-sent thereafter. Asking for `--quiet`, a count, or a head is
worth doing.

**The model you chose.** A frontier model doing mechanical work is the most
common avoidable expense.

## The levers

| Lever | Effect |
|---|---|
| **Working directory** | A session pointed at the right place spends fewer turns finding it |
| **Sources** | A configured source answers a question in one call; browsing answers it in twenty |
| **Skills** | Loaded only when invoked, unlike project details |
| **Thinking level** | Lower it for mechanical work; raise it for design |
| **Utility model** | Used for titles and small classifications — keep it small and cheap |
| **Extended prompt cache** | Longer-lived caching. Cheaper repeated turns, a slower first one. |

## Compaction

Long conversations eventually approach the model's context limit. When they do,
the older part of the transcript is summarised and replaced with the summary, and
the conversation continues.

This is lossy, and the app treats it that way: the summary is not a silent
rewrite of your history. It happens at a defined boundary, and the agent is told
it happened so it does not assume it still remembers something it no longer has.

If you are about to rely on a detail from early in a long session, the honest move
is a new session with that detail restated — or a project whose `details` records
it. Both are cheaper than fighting compaction.

## Starting a new session is usually the optimisation

The instinct is to keep one long conversation going for a topic. In practice:

- A fresh session with a clear first message is cheaper than turn forty of a long
  one, and often better, because the agent is not carrying decisions that no longer
  apply.
- What you lose is continuity, and that is what projects and skills are for:
  durable context that does not have to be re-sent as transcript.

## Measuring

The transcript records token usage per turn. That is the honest way to find out
what is expensive in your usage rather than in general — the answer is usually one
tool that produces a lot of output, not the model.

## Next steps

- [Projects](phaneris://docs/core-concepts/projects) — durable context that is cheaper than transcript.
- [Skills](phaneris://docs/skills/overview) — instructions loaded only when needed.
- [Conversations](phaneris://docs/core-concepts/conversations) — when to start a new one.
