# Automations

An **automation** is a rule: *when this happens, do that.* It is how the app
keeps working while you are not looking — a nightly triage, a notification when a
long job finishes, a webhook to your team's chat when a session reaches review.

Automations are configured per workspace in
`~/.phaneris/workspaces/{workspaceId}/automations.json`.

## The shape of a rule

Every automation has three parts:

1. **A trigger** — an event, optionally with conditions, or a schedule.
2. **A matcher** — what the event must look like for the rule to fire.
3. **An action** — what happens when it does.

### Triggers

**On a schedule.** A cron expression, matched internally — five-minute
granularity is the floor.

**On an event.** Two families:

| App events | Agent events |
|---|---|
| `LabelAdd`, `LabelRemove`, `LabelConfigChange` | `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| `PermissionModeChange`, `FlagChange` | `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop` |
| `SessionStatusChange` | `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup` |

`SchedulerTick` is the internal event a cron matcher is evaluated against; you
do not subscribe to it directly.

### Actions

| Action | What it does |
|---|---|
| **prompt** | Starts an agent session with a prompt. The usual choice. |
| **webhook** | Sends an HTTP request — Slack, Discord, your own service. |
| **script** | Runs a script inside the workspace. The most powerful and the one to be most careful with. |

A `script` action executes a workspace-local script directly, without a shell,
with a restricted environment containing only `PHANERIS_*` variables. It still
runs as you, on your machine. Grant it the same trust you would grant a script
you run by hand, and keep script paths inside the workspace — a path that escapes
the workspace is refused.

## Writing rules that do not become noise

**Match narrowly.** A rule keyed on `SessionStatusChange` alone fires for every
session. Add the condition that makes it *your* event — a specific status, a
specific label, a specific project.

**Prefer a prompt to a script.** A prompt action goes through the normal agent
loop, so it appears in the transcript, respects the session's permission mode,
and can be reviewed afterwards. A script action is invisible unless you go
looking.

**Make it idempotent.** A rule that runs twice should not produce two invoices.
Scheduled rules can overlap; overlapping ticks are skipped and recorded in the
history rather than queued, but a rule that assumes a clean previous run is
fragile in ways that only show up later.

**Test before enabling.** An automation has a test action that runs it against a
sample match and shows what would happen. Use it — a mis-scoped rule that posts
to a team channel is discovered by the team.

## History and control

Every workspace keeps an execution history: what fired, when, and what it did.
An automation can be enabled and disabled without deleting it, and the history
survives both.

If an automation seems to have stopped firing, check the history before the
configuration — an overlapping or rate-limited tick is recorded as skipped, which
looks identical to "broken" if you only read the config.

## Next steps

- [Statuses](phaneris://docs/statuses/overview) and [Labels](phaneris://docs/labels/overview) — the usual things to trigger on.
- [Permissions](phaneris://docs/core-concepts/permissions) — the modes an automation-spawned session runs under.
