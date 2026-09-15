# Labels

A **label** is a colored tag on a session. Statuses say where a conversation is;
labels say what it is about.

Unlike statuses, there are no built-in labels — a fresh workspace has none, and
you create whatever you need. The one exception is the reserved `Task` root that
the task board uses; see the note at the end.

## What makes them more than tags

**They nest.** A label can have children, and filtering by a parent includes
everything beneath it. `client/acme` and `client/globex` under a `client` root
means one click shows every client conversation, and two more narrow it. This is
the feature that keeps a label set from sprawling: you add depth instead of
adding another flat name.

**They can carry a value.** A label can be typed — `string`, `number`, `date`, or
`link` — so `invoice::2026-03` and `ticket::PROJ-1183` stay structured rather
than becoming free text you have to grep. Links are displayed without their
scheme; numbers and dates sort as numbers and dates.

**They can apply themselves.** An **auto-apply rule** watches incoming messages
for a pattern — typically a regular expression — and applies the label with the
captured value. This is how a label stays accurate without you maintaining it:
match the order number in a confirmation email and the session is filed before
you read it.

## Where they live

```
~/.phaneris/workspaces/{id}/labels/config.json
```

You can edit labels in Settings → Labels, or ask the agent. Because labels are
referenced by sessions, changing a label's **id** orphans the sessions carrying
it — rename the label, not the id.

## A set that survives contact with reality

**One hierarchy, one meaning.** Nest by whatever you actually filter on — client,
project, area — and pick one. Two overlapping hierarchies produce labels that are
each half-right, and filters that miss things.

**Value types earn their keep.** Give a label a type when you will want to sort
or group by it later. A date label that is really a string sorts alphabetically,
which is to say wrongly.

**Let rules do the boring part.** A label you apply by hand every time is a label
you will stop applying. If a message reliably contains the string you would
recognise it by, that is an auto-apply rule.

**Fewer than you think.** Ten labels, used consistently, beat forty used
occasionally. The filter list is a menu you read every time you open it.

## The reserved Task label

The task board maintains its own label family under a root label named `Task`,
with one child per task (named `TASK-<slug>-<n>`). These are managed by the app:
they are how a task's orchestrator and its subtasks stay grouped. Do not rename
or restructure them by hand — create your own root if you want a `Task`-like
label for something else, and the app will adopt it as-is rather than fight you
for the name.

## Next steps

- [Statuses](phaneris://docs/statuses/overview) — the workflow axis.
- [Automations](phaneris://docs/automations/overview) — react to a label being applied.
