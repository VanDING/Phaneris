# Tasks

A **task** decomposes a goal into a graph of subtasks and runs them. It is the
machinery for work that is too big for one conversation and too structured to
leave to improvisation: a migration, a survey across many repositories, a
generation job with a review gate.

A task is not a long prompt. It is a specification — a small DAG of nodes, each
with its own prompt, model, permissions, inputs, and outputs — that can be read,
edited, validated, and run more than once.

## What a task is made of

```
~/.phaneris/workspaces/{workspaceId}/tasks/{slug}/
  task.yaml                  the editable specification
  runs/{runId}/
    run-log.jsonl            append-only record of what happened
    nodes/{id}.json          each node's output
```

The task also owns an **orchestrator session** — a conversation that authored the
specification and that you use to talk about the task as a whole. Its subtask
sessions are grouped with it under a reserved label, so the whole family can be
found together.

## Creating one

Two ways, and they differ in what you get:

**Ask for it.** Describe the goal and let the orchestrator author the
specification. It writes a `task.yaml`, which is validated immediately; if it
fails validation the agent is told exactly what was wrong and asked to correct
it. This is the fast path, and the result is a draft you should read.

**Write it.** Edit the YAML directly in the task editor. This is the path when
the structure matters more than the speed — a fan-out over twenty known inputs,
say, where describing it to an agent is more work than typing it.

**Creating a task does not run it.** It lands in the to-do state and waits. That
separation is deliberate: the specification is the thing worth reviewing, and
reviewing it is much cheaper than interrupting a run.

## What a node can express

Each node in the graph is one session, and it can specify:

| | |
|---|---|
| **What** | A prompt, a title, and a model or connection of its own |
| **Permissions** | A permission mode for this node — a read-only survey node and a writing node can coexist in one task |
| **Inputs** | Values passed from earlier nodes, or from the task's own parameters |
| **Outputs** | Named results declared up front, so later nodes can reference them |
| **Conditions** | `when` for gating, and a trigger rule for how the node fires |
| **Fan-out** | `replicas` to run a node over many inputs, and an aggregation mode to combine the results |
| **Iteration** | `loop` with an `until` condition and a maximum |
| **Resilience** | `retry` with backoff, and a `timeout` |
| **Caching** | Whether a node's result may be reused across runs |
| **Approval** | Whether the node pauses for you before proceeding |

That last one is where tasks earn their keep on anything sensitive: a survey
node can run unattended, and the single node that writes to production can
require your approval.

## Running and resuming

Starting a run executes the graph, respecting dependencies. You watch it in the
trajectory view — which node is running, what each has produced so far, and where
it stopped.

A run is durable. If the app closes mid-run, the run resumes rather than
restarting, and the run log is written as it goes so the record survives.
Resuming a finished or failed run continues from the state it reached.

**The specification can change; a run's history does not.** Editing `task.yaml`
changes what the next run does. A completed run keeps the spec it actually ran
against, because a run log that silently rewrites itself to match a later edit is
not a record of anything.

## Writing a good one

**Make each node independently checkable.** A node whose output you cannot judge
in isolation will produce a run you cannot review.

**Use permissions per node, not per task.** The most restrictive mode that lets
each node do its job is the whole benefit of having a graph.

**Gate the irreversible step.** A node that deletes, publishes, or deploys should
have `approval: true`. Everything before it can then run unattended.

**Keep it small.** A dozen nodes is a large task. If it needs forty, it is
probably two tasks, and splitting them makes each one reviewable.

## Next steps

- [Kanban board](phaneris://docs/go-further/kanban) — where task cards live.
- [Permissions](phaneris://docs/core-concepts/permissions) — the modes a node can be given.
- [Automations](phaneris://docs/automations/overview) — starting a run on a schedule.
