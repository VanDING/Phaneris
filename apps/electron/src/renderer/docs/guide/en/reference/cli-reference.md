# CLI Reference

The `phaneris` command is a client for a running server. It is not a second
implementation of the app: it connects to the same backend over the same channel
the desktop app uses, so a session you start from the terminal is the same
session you can open in the window.

The full command reference ships with the source tree at `docs/cli.md`. This page
covers the shape of it and the parts worth knowing before you start.

## When to use it

- **Scripting.** Anything you can do in the app can be driven from a script.
- **A remote or headless server.** Install the server on a machine, drive it from
  your laptop or from CI.
- **Automation without a window.** A cron job that asks a question and writes the
  answer somewhere.

For interactive work, the desktop app is the better tool: the CLI has no document
view, no diff review, and no inline approvals.

## Connecting

| Flag | Environment variable | Meaning |
|---|---|---|
| `--url <ws[s]://…>` | `PHANERIS_SERVER_URL` | Server WebSocket URL |
| `--token <secret>` | `PHANERIS_SERVER_TOKEN` | Authentication token |
| `--tls-ca <path>` | `PHANERIS_TLS_CA` | Custom CA certificate, for self-signed TLS |

Flags win over environment variables, so a script can carry its own connection
details without disturbing the shell's.

## Command groups

| Group | What it does |
|---|---|
| **Info and health** | Version, server status, capability discovery |
| **Resource listing** | Sessions, sources, skills, labels, statuses, automations |
| **Session operations** | Create, inspect, message, stop, archive |
| **Send message** | Streams a reply to stdout — the one to use in a pipe |
| **Run** | Self-contained: sends a prompt and prints the result without managing a session |
| **Validate** | Checks a server configuration end to end |

Resource management is where the CLI is genuinely better than the app for some
work: `phaneris source`, `phaneris skill`, `phaneris label`, and
`phaneris automation` create and validate configuration, and they are the
supported way to do it. When the CLI feature is enabled, the agent is blocked
from writing those configuration files directly and routed through the same
commands — so both you and the agent go through validation.

## Scripting

Two things make it usable in a pipeline:

- **`--json`** prints machine-readable output instead of formatted text.
- **Exit codes** are meaningful, and errors carry stable codes (`AUTH_FAILED`,
  and so on) so a script can branch on the failure rather than parsing prose.

`--tls-ca` sets `NODE_EXTRA_CA_CERTS` before connecting; the server side accepts
`PHANERIS_RPC_TLS_CA` for the equivalent setting.

## Running a server

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

The token is required — a server without one refuses connections rather than
exposing your workspaces. Treat it like the credential it is.

## Troubleshooting

**`AUTH_FAILED`.** The token does not match the server's. They are not persisted
for you; pass the same value to both.

**Connection refused on a server that is running.** Check the URL scheme: a
TLS-enabled server needs `wss://`, not `ws://`.

**Commands work locally but not against a remote server.** Paths in arguments
resolve on the server, not on your machine. A file path that exists for you may
not exist there.

## Next steps

- [Installation](phaneris://docs/getting-started/installation) — running a server from source.
- [Environment variables](phaneris://docs/reference/environment-variables) — the settings with no UI.
