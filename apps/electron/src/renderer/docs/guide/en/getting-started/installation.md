# Installation

## Requirements

- **[Bun](https://bun.sh/) 1.4.2** — the version pinned in `package.json`. Bun
  installs dependencies and runs the repository's tooling.
- **Credentials for at least one model provider.** Phaneris drives a model; it
  does not include one.
- **macOS, Windows, or Linux.**

## Running from source

```bash
git clone git@github.com:VanDING/craft-agents-rebuild.git
cd craft-agents-rebuild
bun install --frozen-lockfile
bun run electron:start
```

Use Bun for dependency installation and for the repository's tools. `bun.lock` is
the lockfile — do not generate a second one with npm, Yarn, or pnpm.

For development with renderer hot-reload, `bun run electron:dev` is the faster
loop.

## Packaged installers

**The prebuilt installers are not usable for Phaneris yet.** `scripts/install-app.sh`
and `scripts/install-app.ps1` download their payload from the upstream release
feed, so running them installs upstream Craft Agents rather than this build.
Rebuilding that pipeline is deliberately deferred work; until it lands, build
from source or package locally.

## First launch

Three things, in order:

1. **Add an AI connection** — Settings → AI. You can sign in to a provider
   account or point at any OpenAI-compatible endpoint. See
   [LLM connections](phaneris://docs/reference/llm-connections).
2. **Create a workspace** — a workspace is the isolated configuration everything
   else lives in. One is enough to start; see
   [Workspaces](phaneris://docs/go-further/workspaces).
3. **Connect a source, or point at a folder** — optional, but it is what turns the
   agent from "can edit files" into "can work with your tools". See
   [Sources](phaneris://docs/sources/overview).

## Where your data goes

Everything Phaneris owns lives under `~/.phaneris/` (`%USERPROFILE%\.phaneris\`
on Windows). It is created on first launch and is the only thing you need to back
up. Nothing is written into the repository you cloned.

## Updating

Pull the branch and reinstall:

```bash
git pull
bun install --frozen-lockfile
```

The in-app updater is part of the same deferred release-pipeline work as the
installers, so it will report that no update is available rather than fetching
one from upstream.

## Headless use

The same codebase runs as a server with a CLI client:

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
bun run apps/cli/src/index.ts run "Summarize this repository"
```

`docs/cli.md` in the repository covers remote connections, TLS, and scripting.

## Next steps

- [Introduction](phaneris://docs/getting-started/introduction) — how the pieces fit together.
- [Permissions](phaneris://docs/core-concepts/permissions) — decide how much the agent may do before you give it real work.
