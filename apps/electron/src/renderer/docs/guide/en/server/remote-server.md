# Remote Server

Phaneris can run on a machine you are not sitting in front of. The server holds
the workspaces; the desktop app, a browser, and the CLI are clients of it. The
same workspace is then reachable from wherever you are, with one set of sessions
rather than a copy per machine.

This is what makes "work from anywhere" more than a slogan: the agent runs where
your files and credentials are, and you drive it from wherever you happen to be.

## Running one

```bash
PHANERIS_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

The token is required and not optional. Without one the server refuses
connections rather than exposing your workspaces to whatever can reach the port.
Treat it as the credential it is — the same value goes to every client.

For a machine you are setting up from scratch, `scripts/install-server.sh` checks
for Bun, installs dependencies, generates a token, and prints the command to run.
There is a `Dockerfile.server` if you would rather deploy a container.

## TLS

A server reachable over a network should speak TLS. Supply a certificate and key,
and clients connect with `wss://` instead of `ws://`:

| Setting | Purpose |
|---|---|
| Certificate and key | The server's identity |
| CA | What clients use to verify a self-signed certificate |

Clients accept a custom CA via `--tls-ca` or `PHANERIS_TLS_CA`; the equivalent
server-side setting is `PHANERIS_RPC_TLS_CA`.

Self-signed is a reasonable choice on a private network as long as every client
is given the CA. What is not reasonable is disabling verification — the app does
not offer a way to.

## What the server is not

**It is not a multi-tenant service.** One server, one user's workspaces. The
token is a single shared secret, not an account system, and there is no notion of
two people sharing a server with separated data.

**It does not add a permission layer.** Sessions still run under their own
permission modes, on a machine you may not be watching. If anything, a remote
server raises the stakes on choosing Execute deliberately.

## Connecting the desktop app

Point the app at the server's URL with its token. The workspace then appears
alongside local ones, and its sessions behave as sessions do — with one
difference worth knowing: a session can be **handed off** between a local and a
remote workspace. The destination receives a summary of the conversation as
one-shot context on its first turn, so the agent there knows what was decided
without replaying the whole transcript.

## Headless and the browser client

`PHANERIS_HEADLESS` runs the server without a UI. The browser client is a
separate build that talks to the same server, so you can reach a workspace from a
machine where you cannot install anything.

Running a server, a desktop client, and a browser client against the same
workspaces at once is the intended configuration, not a workaround.

## Operating it

- **Health.** `PHANERIS_HEALTH_PORT` exposes an endpoint suitable for a
  supervisor or a container check.
- **Logs.** The server writes to the same logs directory as the desktop app.
- **Token rotation.** Changing the token disconnects every client until they are
  updated. There is no grace period, so rotate at a moment you can update them.

## Next steps

- [CLI reference](phaneris://docs/reference/cli-reference) — driving a remote server from a terminal.
- [Environment variables](phaneris://docs/reference/environment-variables) — the server settings with no UI.
- [Workspaces](phaneris://docs/go-further/workspaces) — what a server is serving.
