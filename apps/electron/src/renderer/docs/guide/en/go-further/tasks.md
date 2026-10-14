# Tasks

A Task describes a goal as a DAG of child sessions in `task.yaml`. Ask the
orchestrator to author a draft, or edit the YAML yourself. Creating a definition
does not start a run: review the goal, permissions, inputs, scope and acceptance
criteria first.

```text
<workspace>/tasks/<slug>/
  task.yaml
  runs/<runId>/
    run-log.jsonl
    nodes/<id>.json
```

For new runs, Runtime facts are authoritative. The JSONL log and node files are
compatibility/export projections, not a second execution authority.

## What executes today

The runner executes `kind: session` nodes with dependencies, input references,
model/connection overrides, explicit permissions, existing Token budgets and
bounded error retries. An orchestrator can grade the result and drive a bounded
repair cycle.

Historical YAML can retain other fields for readability, but parsing is not
execution support. Approval nodes, general loops, routes, maps, replicas and
other unsupported control semantics are refused before dispatch. In particular,
`approval: true` cannot serve as an implemented approval gate.

## Permissions and file scopes

Every node needs an explicit `permissionMode`, either on the node or inherited
from `defaults.permissionMode`. A node overrides the default. If any node has no
declared mode, the whole task refuses before creating children, including on
resume. Explicit `allow-all` remains a user choice; omitted values never grant it.

```yaml
id: report
title: Prepare report
goal: Inspect the material and draft a report
defaults:
  permissionMode: safe
cwd: /absolute/path/to/material
max_parallel: 2
nodes:
  - id: inspect
    prompt: Read the inputs and summarize the findings
    file_scope:
      read: [inputs]
      write: []
  - id: draft
    permissionMode: ask
    prompt: Draft the report using ${nodes.inspect.output}
    depends_on: [inspect]
    file_scope:
      read: [inputs]
      write: [report.md]
```

Scopes use literal file/directory paths relative to the task cwd, not globs.
Overlapping writes and readers serialize; explicit read-only or disjoint scopes
may run in parallel. Omitted scopes conservatively claim writable cwd. Path
comparison accounts for ancestors, Windows case and resolvable link aliases.

This coordinates TaskRunner nodes within one Host; it is not an OS sandbox,
cross-process lock, or a guarantee against agents violating their declarations.
The ordinary tool permission rules still apply. A run freezes its declarations
and resolved cwd; changing them requires a new run rather than resuming around
a conflict.

## Budgets, review and recovery

Run exposes outputs, terminal facts, unsettled T1 effects and available task
Token budget observations. `max_no_progress` bounds failed acceptance cycles;
it does not establish general tool-loop detection.

After restart, known completed nodes with available outputs can be reused.
In-flight nodes and unknown external outcomes require reconciliation, never
blind replay. Editing a task affects future runs without rewriting history.
Runtime completion is distinct from user acceptance of its deliverables.

## Next steps

- [Permissions](phaneris://docs/core-concepts/permissions)
- [Kanban Board](phaneris://docs/go-further/kanban)
- [Conversations](phaneris://docs/core-concepts/conversations)
