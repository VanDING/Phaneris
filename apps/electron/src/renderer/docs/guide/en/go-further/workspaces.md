# Workspaces

A **workspace** is a fully isolated configuration. It has its own sources,
skills, statuses, labels, automations, projects, pages, and sessions — and its own
directory on disk.

Use one workspace for work and another for personal projects, and neither can see
the other's credentials, sessions, or files. That isolation is the whole point:
it is the difference between "the agent has access to my GitHub" and "the agent
has access to my work GitHub while I am doing personal work".

## What is inside one

```
~/.phaneris/workspaces/{workspaceId}/
  config.json        workspace settings (name, root path, defaults)
  sessions/          one directory per conversation
  sources/           connections to external services
  skills/            workspace-scoped skills
  statuses/          the workflow states for this workspace
  labels/            the label tree
  automations.json   scheduled and event-driven rules
  projects/ pages/ work-items/   project and page data
  artifacts/         files the agent produced for you
```

The workspace's **root path** is where its work happens by default — the
directory a new session starts in unless you point it elsewhere.

## Switching

The workspace switcher in the top bar changes the whole context: sidebar,
sessions, sources. Each window remembers its own workspace, so you can keep a
work window and a personal window open side by side.

Unread counts are tracked per workspace and shown in the switcher, which is how
you notice that an automation in another workspace did something.

## Moving work between workspaces

A session can be sent to another workspace. The receiving workspace gets a copy
with its own sources and permissions applied — which is the interesting part: a
session that used a work credential arrives without it, and will ask for the
equivalent in the destination rather than carrying access across the boundary.

This is the intended way to move a piece of work from personal to work or the
reverse. Copying the directory by hand skips the credential handling and is not
recommended.

## Remote workspaces

A workspace can live on a remote server rather than on this machine. The desktop
app then talks to it over the network, and the same workspace can be reached from
the browser client or the CLI at the same time.

Session handoff between a local and a remote workspace carries a summary of the
conversation as one-shot context on the destination's first turn, so the agent
there knows what was already decided without replaying the whole transcript.

## Choosing how many to have

**One per context that needs different credentials.** This is the real axis. If
two kinds of work authenticate as different people, they want different
workspaces.

**Not one per project.** Projects are entities inside a workspace; making a
workspace per project multiplies configuration without adding isolation you
needed.

**Two is a fine number.** Most people need a work one and a personal one, and
nothing else. Adding a third is worth doing when you can say what it isolates.

## Next steps

- [Sources](phaneris://docs/sources/overview) — the connections a workspace owns.
- [Skills](phaneris://docs/skills/overview) — and how they resolve across scopes.
- [App Settings](phaneris://docs/reference/config-file) — the workspace list and app-wide defaults.
