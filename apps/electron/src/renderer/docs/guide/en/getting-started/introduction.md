# Introduction

Phaneris is a desktop app that gives an AI agent access to your actual working
context — your files, your repositories, your issue tracker, your mail — and
keeps a reviewable record of everything it did. You describe an outcome in a
conversation; the agent reads, runs, and writes on your machine under the
permission mode you chose.

It is a fork of [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss),
independently built and renamed. This documentation ships inside the app rather
than on a website, so it always describes the version you are running.

## What makes this build different

If you have used upstream Craft Agents, three things are deliberately not the
same here:

- **Nothing is published to a third-party service.** Sharing a conversation to a
  hosted viewer and publishing a Page to a Cloudflare worker are both disabled,
  and no code path uploads your conversations. There is currently no replacement
  for "send this conversation to someone" — see
  [Pages](phaneris://docs/go-further/pages) for what does stay local.
- **The app does not send you to upstream documentation.** Every help link in
  the interface opens the page you are reading.
- **Crash reporting is off unless you turn it on.** Error tracking is compiled in
  but inert: it needs both an ingest URL and `PHANERIS_TELEMETRY_ENABLED=1` in
  the environment before a single event can be sent, and the payload is scrubbed
  of request headers and sensitive keys first. A DSN alone is not consent.

## How it is put together

One conversation at a time, but several at once in practice. Each conversation
is a **session** with a status, labels, and a durable transcript.

| Concept | What it is |
|---|---|
| **Session** | One conversation. Persisted to disk, resumable, organizable. |
| **Source** | A connection that gives the agent new capability — an MCP server, a REST API, or a local folder. |
| **Skill** | A reusable instruction set, invoked with `@mention`. |
| **Status** | A workflow state (Backlog, Todo, Needs Review, Done…). |
| **Label** | A colored tag, optionally hierarchical and typed. |
| **Automation** | Something that runs on a schedule or in response to an event. |
| **Workspace** | A fully isolated configuration: its own sources, skills, statuses, sessions. |
| **Page** | A persistent mini-app stored in a workspace. |
| **Permission mode** | How much the agent may do without asking. |

## Where your data lives

Everything Phaneris owns lives under a single directory — `~/.phaneris/` on
macOS and Linux, `%USERPROFILE%\.phaneris\` on Windows:

```
~/.phaneris/
  config.json          app settings (default model, theme, workspace list)
  preferences.json     your name, timezone, language, free-form notes
  credentials.enc      encrypted secrets for sources and connections
  workspaces/          one directory per workspace
  docs/                these guides, for the agent to read
  themes/              your themes
  logs/                runtime logs
```

You can move, back up, or delete this directory. Nothing important is stored
anywhere else.

## Reading the agent's work

The agent is not a black box. Before it changes anything you get to see the
plan; while it works you get every tool call and its output in the transcript;
and each turn is kept as a reviewable record you can come back to.

- In **Explore** mode it can read but never write.
- In **Ask to Edit** it proposes each change and waits.
- In **Execute** it works without interruption.

Start in Explore. Escalate when you have seen enough to trust the plan. See
[Permissions](phaneris://docs/core-concepts/permissions).

## Next steps

- [Sources](phaneris://docs/sources/overview) — connect the agent to your tools.
- [Permissions](phaneris://docs/core-concepts/permissions) — decide how much it may do alone.
- [Workspaces](phaneris://docs/go-further/workspaces) — keep work and personal contexts apart.
