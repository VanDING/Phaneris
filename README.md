<div align="center">

<img src="docs/assets/readme/banner.png" alt="Phaneris — a local-first agent workspace with durable execution and inspectable runs" width="100%" />

<br />

# Phaneris

### A local-first agent workspace with durable execution and inspectable runs.

Run capable AI agents across your files, tools, services, and documents — with a desktop workspace that makes every important action reviewable.

[![Version](https://img.shields.io/badge/version-0.2.0-6d5bd0?style=flat-square)](apps/electron/resources/release-notes/0.2.0.md)
[![Pi SDK](https://img.shields.io/badge/Pi%20SDK-0.85.1-5b7cfa?style=flat-square)](docs/pi-kernel.md)
[![Bun](https://img.shields.io/badge/Bun-1.4.2-f9f1e1?style=flat-square&logo=bun&logoColor=000)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-Apache--2.0-2f80ed?style=flat-square)](LICENSE)
[![中文](https://img.shields.io/badge/README-中文-2f855a?style=flat-square)](README.zh-CN.md)

</div>

Phaneris is an open-source desktop and server workspace for serious agent work. It combines persistent sessions, a multi-panel workbench, connected tools, automation, file artifacts, and a single Pi-powered agent runtime.

The defining difference is trust: a run is not just a stream of prose. Phaneris records execution boundaries, tool outcomes, context growth, token usage, cost, and recovery state so you can understand what happened and decide what should happen next.

## A workspace, not a chat window

The desktop app is organized around durable work rather than disposable conversations. Sessions, projects, files, sources, and automations share one workbench, and the side panels switch between terminal, files, review, and previews without losing the conversation.

<img src="docs/assets/readme/workspace-overview.png" alt="Phaneris desktop workbench with navigation, session list, conversation, and a terminal panel" width="100%" />

| Capability | What it gives you |
| --- | --- |
| **Persistent multi-session workspace** | Sessions, projects, labels, statuses, calendar, board, and background work remain available across restarts. |
| **Content Workbench** | Open chat, review, files, previews, artifacts, context, Run views, and browser surfaces side by side. |
| **Sources and skills** | Connect MCP servers, REST APIs, local folders, and reusable `SKILL.md` instructions without hard-coding services into the agent. |
| **Permissions and recovery** | Explore, Ask to Edit, and Auto modes combine with durable execution evidence and explicit recovery decisions. |
| **Automations and messaging** | Schedule work, react to events, and reach agents through supported messaging gateways. |
| **Headless and CLI operation** | Keep long-running sessions on a remote server while using the desktop app, Web UI, or `phaneris` as clients. |

## Work that stays inspectable

Agent work should not disappear behind a spinner. Every session carries a Run workspace with four complementary views that reconstruct what actually happened. Select any view to open it full size.

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/assets/readme/run-overview.png"><img src="docs/assets/readme/run-overview.png" width="100%" alt="Run Overview with duration, tokens, tool outcomes, run shape, and context growth" /></a></td>
    <td width="50%" valign="top"><a href="docs/assets/readme/run-trajectory.png"><img src="docs/assets/readme/run-trajectory.png" width="100%" alt="Run Trajectory with turn lanes, requests, tool calls, and errors" /></a></td>
  </tr>
  <tr>
    <td valign="top"><strong>Overview</strong><br />Duration, time to first token, tokens, cost, tool outcomes, context growth, and everything needing attention — including failed and slow tool calls.</td>
    <td valign="top"><strong>Trajectory</strong><br />Turns, model responses, tool calls, failures, compaction, and timing reconstructed as an inspectable execution ledger.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/assets/readme/run-context.png"><img src="docs/assets/readme/run-context.png" width="100%" alt="Run Context showing how a single model request was assembled" /></a></td>
    <td width="50%" valign="top"><a href="docs/assets/readme/run-map.png"><img src="docs/assets/readme/run-map.png" width="100%" alt="Run Map with related sessions, tool branches, and sub-tasks" /></a></td>
  </tr>
  <tr>
    <td valign="top"><strong>Context</strong><br />How each model request was assembled — system prompt, user messages, assistant history, tool results, and injected context, with per-request deltas.</td>
    <td valign="top"><strong>Map</strong><br />Related sessions, tool branches, and sub-tasks as an explorable graph, each node carrying its own recorded history.</td>
  </tr>
</table>

Underneath the UI, a workspace-local SQLite/WAL runtime records model and tool effects across explicit T1/T2 boundaries. Ambiguous effects are parked as unknown instead of being silently replayed or presented as completed.

## Files become reviewable artifacts

Phaneris treats generated and modified files as deliverables with a lifecycle, not opaque attachments. Every file a session touches lands in the workbench's Changed view with its own diff footprint, so accepting a change is a deliberate decision rather than a side effect of reading an answer.

<img src="docs/assets/readme/workbench-changed-files.png" alt="Changed view listing every file touched by the session with diff line counts" width="100%" />

Artifact revisions carry validation results and provenance, can be previewed safely when supported, and remain pending until you accept or discard them.

The shared format registry covers text and source files, Markdown, structured data, images, PDF, Office and OpenDocument formats, media, archives, and unknown binaries. Existing document tools continue to do the actual editing and conversion, while Artifact provides one consistent review boundary.

Native image generation follows the same path: one tool call produces a validated image Artifact with provider, model, connection, prompt, parameters, and revision metadata attached.

## Personal by design

Profile and appearance are local product surfaces, not account requirements. The profile summarizes local activity without including message content, and keeps user-authored preferences separate from observed usage. The semantic theme engine controls color, surfaces, depth, borders, typography, icon weight, and density, with app-level defaults and per-workspace overrides.

<img src="docs/assets/readme/local-profile.png" alt="Local profile with a private activity summary, activity insights, and basic info" width="100%" />

## One runtime, many providers

Every provider uses the same Pi agent backend, event contract, tool registry, permissions, and session lifecycle. The Pi runtime runs in an isolated subprocess so provider or agent failures do not become a second desktop execution path.

```text
Electron Desktop  ·  Web UI  ·  phaneris CLI
                    │
          server-core / Runtime Host
      sessions · permissions · sources · artifacts
                    │
            JSONL subprocess boundary
                    │
          Pi SDK · provider APIs · tools
```

The connection layer supports major hosted providers, OAuth-backed products, cloud platforms, and OpenAI-/Anthropic-compatible custom endpoints. Models and thinking levels are resolved from provider capabilities instead of a project-specific second backend.

### Current foundation

| Layer | Baseline |
| --- | --- |
| Agent kernel | Pi SDK `0.85.1` |
| Desktop | Electron `44.2`, React `19.2` |
| Runtime and tooling | Bun `1.4.2`, TypeScript `7`, Vite `8.2` |
| Integrations | MCP SDK `1.30`, native REST/local/browser tools |
| Storage | Local session data plus workspace-local SQLite/WAL durable runtime |

## Quick start

### Requirements

- [Bun](https://bun.sh/) at the version pinned by `package.json` (`1.4.2`)
- Credentials for at least one supported model provider
- macOS, Windows, or Linux

```bash
git clone git@github.com:VanDING/Phaneris.git
cd phaneris
bun install --frozen-lockfile
bun run electron:start
```

On first launch, add an AI connection, create a workspace, and optionally connect sources or local folders. Use **Shift+Tab** in a session to cycle through Explore, Ask to Edit, and Auto permission modes.

### Headless server and CLI

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
bun run apps/cli/src/index.ts run "Summarize this repository"
```

See the [CLI reference](docs/cli.md) for remote connections, TLS, scripting, and validation.

## Development

```bash
bun run electron:dev       # Desktop development with renderer HMR
bun run typecheck:all      # Type-check every workspace package
bun run validate:dev       # Type checks plus focused runtime/document tests
bun run validate:ci        # CI validation plus i18n parity and coverage
```

Use Bun for this repository's dependency installation and local tools (`bun run eslint`,
`bun run vite`, `bun run electron-builder`). Commit `bun.lock` with dependency changes;
do not generate a second lockfile with npm, Yarn, or pnpm. The npm registry remains the
package source. Node.js is still used by Electron tooling and the WhatsApp worker.
See [the September dependency upgrade](docs/dependency-upgrade-2026-09.md) for migration details and exceptions.

Start with the [documentation index](docs/README.md), [contribution guide](CONTRIBUTING.md), and [Pi kernel maintenance baseline](docs/pi-kernel.md).

## Built on Craft, with gratitude

Phaneris is an independent project built on the open-source codebase of [`craft-ai-agents/craft-agents-oss`](https://github.com/craft-ai-agents/craft-agents-oss), originally created by the [Craft](https://www.craft.do/) team and its contributors. Their open-source work made this project possible, and we are deeply grateful for that foundation.

The project keeps the original attribution, license, and NOTICE while pursuing its own runtime, auditability, workspace, Artifact, Profile, and theme direction. It is developed and released from [`VanDING/Phaneris`](https://github.com/VanDING/Phaneris) as a standalone repository, not a GitHub fork of the upstream project. It is not endorsed by or affiliated with Craft Docs Limited. See [NOTICE](NOTICE) and [TRADEMARK.md](TRADEMARK.md) for attribution and naming details.

## License

Licensed under [Apache License 2.0](LICENSE).
