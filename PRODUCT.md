# Phaneris — Product Context

Phaneris is a local-first agent workspace. One window holds many parallel
sessions, the files and data those sessions work on, and the tools that connect
them. Everything runs on this machine unless a source you configured sends data
elsewhere.

This document is the product constitution. It names the objects a user meets and
explains them in plain language. UI copy, onboarding and settings should use these
terms consistently. The visual constitution lives in `DESIGN.md`; the scale
values it pins are enforced by `bun run check:scale-contract`.

## The object model

```
Workspace
├── Projects          a grouping of sessions, tasks and files for one effort
├── Sessions          one conversation + its agent run, tool calls and artifacts
│   ├── Turns         one user request and the agent's response
│   ├── Activities    tool calls, file edits, commands, approvals
│   └── Artifacts     files or previews produced during the session
├── Sources           external data the agent may read (MCP, REST, local folders)
├── Skills            reusable instructions that teach the agent a behavior
├── Plugins           installable bundles of skills/tools/commands
├── Pages             shareable read-only documents created by the agent
├── Automations       scheduled or webhook-triggered agent runs
└── Settings          app, AI, appearance, input, workspace, permissions, labels,
                      messaging, server, shortcuts, preferences
```

## Terms in plain language

| Term | What it means to a user |
| --- | --- |
| **Workspace** | The whole local installation: your sessions, sources and settings. Different workspaces keep separate histories and configurations. |
| **Session** | One conversation with the agent. It remembers the turns above it and can run tools. "New chat" creates a session. |
| **Turn** | One request from you plus everything the agent did in response. Turns are the unit of history pagination and collapse. |
| **Activity** | A single step inside a turn: a tool call, a file read, a terminal command, a permission request. Activities can be collapsed; failures stay visible. |
| **Artifact** | A file or preview the agent produced or changed, such as a document, diff, table, HTML page or image. |
| **Trajectory** | The inspection view of what the agent actually saw and did: model context, tool calls, token usage and timing. It is diagnostic, not a chat surface. |
| **Source** | A connection that lets the agent read external data. Three kinds: MCP server, REST API, local folder. Sources can require credentials or authentication. |
| **Skill** | A reusable set of instructions that teaches the agent a specialized behavior. Skills can be managed by a project. |
| **Plugin** | A bundle that adds skills, tools or commands to the agent. Plugins are installed and enabled per workspace. |
| **Page** | A read-only document the agent creates. Pages can be shared publicly as a copy; the local data stays local unless included. |
| **Automation** | A saved prompt that runs on a schedule or is triggered by a webhook. Runs can be inspected and retried. |
| **Project** | A grouping of sessions, tasks and files that belong to one effort. Projects can own skills, tasks and status columns. |
| **Task** | A unit of planned work inside a project's board, with status, assignees and subtasks. |
| **Kanban / Schedule** | Alternative views of project work: board columns, calendar and timeline. |
| **Workbench** | The right-hand area that hosts tabs: sessions, kanban, calendar, files, terminal, trajectory, preview, artifacts, browser and pages. |
| **Panel** | A resizable column of the shell: sidebar, navigator, main content. |
| **Follow-up** | A queued message the agent will receive after its current turn finishes. |
| **Handoff** | Continuing a session's work in a new session while keeping the context summary. |
| **Permission mode** | How much the agent may do without asking. Requests are approved per action; "always allow" remembers the decision for the session. |
| **Scenic mode** | An appearance mode that places a background image behind translucent panels. |
| **Density** | How tightly rows and controls pack: compact, comfortable or spacious. It changes spacing, not text size. |

## Core flows

1. **Start a session.** Pick a workspace, then start from the sidebar, the
   landing screen, or a project. The composer accepts text, attachments, `@`
   mentions of files/skills and `/` commands.
2. **Work with the agent.** The agent streams its response, shows activities as
   they happen, and asks for permission before risky actions. You can stop,
   queue follow-ups, or branch the conversation.
3. **Inspect and keep the result.** Tool output opens in previews; produced files
   become artifacts. The trajectory view shows exactly what the agent used.
4. **Connect what matters.** Add sources for external data, skills for repeated
   behavior, and automations for recurring work.
5. **Organize.** Sessions can be grouped by date, project, status or unread
   state; labeled, flagged, archived, and moved between projects or workspaces.

## Product principles

- **Local first.** Files, sessions and credentials stay on the machine. Remote
  access is an explicit choice (a configured source or a published page).
- **The agent asks before it acts.** Permission prompts name the action and the
  risk (deletes data, sends data, spends money, changes the system). Approvals
  are scoped to the session unless configured otherwise.
- **Nothing is hidden.** Every tool call, file change and token count is
  inspectable in the trajectory surface.
- **One window, many surfaces.** Sessions, files, boards and documents share a
  single resizable shell instead of separate windows.

## Terminology rules for UI copy

- Say **session**, not "chat thread" or "conversation", in navigation and
  settings. "Chat" is acceptable in the landing screen and composer placeholder.
- Say **source**, not "connection" or "integration", for MCP/REST/folder data.
- Say **skill** and **plugin** for the two extension kinds; do not use "tool" for
  either. "Tool" means a capability the agent invokes during a turn.
- Say **activity** for one step of a turn; say **turn** for the whole exchange.
- Say **automation** for scheduled/webhook runs; "workflow" is not a product term.
- Say **artifact** for produced files and previews; "output" is too vague.
- Permission labels stay verbs: **Allow**, **Always allow**, **Deny**.
