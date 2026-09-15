# Permissions

Every session runs in one of three permission modes. The mode decides what the
agent may do without stopping to ask you, and it is the main safety control in
the app.

| Mode | Behaviour | Use it when |
|---|---|---|
| **Explore** | Read-only. Writes are blocked outright, and it never prompts — a blocked action fails rather than nagging. | You want research, analysis, or a plan before anything changes. |
| **Ask to Edit** | Every write, command, or network call that needs approval prompts first. | You are working on something you care about and want to review each step. |
| **Execute** | Full autonomy. No prompts. | The plan is agreed and the work is mechanical. |

The mode is per session, shown in the input toolbar, and switchable at any time
mid-conversation. Changing it is itself recorded, and the agent is told when the
mode changed so it does not assume a permission it no longer has.

## The modes in practice

**Explore** is not "the agent politely declines". The write path is refused
before execution, so an instruction to edit a file in Explore mode fails with a
permission error that both you and the agent can see. Two exceptions are
deliberate: writing a plan document, and writing to data a Page owns — both are
the intended output of "investigate and propose".

One boundary is softer than the rest, and it is worth knowing about: **the
in-app browser is not blocked in Explore.** Its commands are not classified as
read-only or mutating, so Explore bounds browser work through an instruction to
the agent rather than an enforced refusal. See
[Browser](phaneris://docs/browser/overview) for what that does and does not
guarantee.

**Ask to Edit** prompts on a per-action basis and remembers nothing by default;
approving one edit does not pre-approve the next. If a prompt is for something
you will approve repeatedly, that is the signal to move the session to Execute
or to widen the rule in Settings → Permissions rather than clicking through.

**Execute** is the mode to be deliberate about. It is appropriate for tasks
whose blast radius you have already bounded — a repository with tests, a scratch
directory, a service you can undo against.

## Rules, and how they layer

The mode is the coarse control. Underneath it, the permission engine evaluates
rules that can allow or deny specific tools, paths, and endpoints. Rules cascade
from the app level down to the workspace and then to the individual source:

```
app  →  workspace  →  source
```

A narrower scope can tighten what a broader one allowed. The built-in rules ship
in `~/.phaneris/permissions/` and are rewritten on every launch from the
versions bundled with the app — treat them as read-only and put your own rules
in the workspace scope, which is yours.

## What the agent can never do silently

Some operations are gated regardless of mode, because their consequences are not
recoverable by reviewing a transcript afterwards:

- Publishing a Page (disabled entirely in this build — see [Pages](phaneris://docs/go-further/pages)).
- Deleting a session or a workspace.
- Writing to guarded configuration paths — the agent edits configuration through
  the CLI-backed tooling, which validates changes, rather than by rewriting files
  directly.

## Changing the mode

Use the permission selector in the chat input toolbar. It is available in every
session, including while the agent is working; taking autonomy away mid-turn
takes effect for the next action, not the one already executing.

## Next steps

- [Sources](phaneris://docs/sources/overview) — what the agent can reach, and how to bound it.
- [Automations](phaneris://docs/automations/overview) — the same modes apply to work that runs without you.
