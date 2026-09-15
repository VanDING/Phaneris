# Environment Variables

Almost everything is configurable in the app. These are the exceptions — settings
that exist only as environment variables, mostly because they have to be decided
before the app has read any configuration.

Every variable uses the `PHANERIS_` prefix.

## Configuration

| Variable | Effect |
|---|---|
| `PHANERIS_CONFIG_DIR` | Use a different data directory instead of `~/.phaneris`. Needed to run two instances side by side. |
| `PHANERIS_APP_NAME` | Override the application name |
| `PHANERIS_DEBUG=1` | Enable the development/debug runtime |
| `PHANERIS_LOCAL_MCP_ENABLED` | Whether local (stdio) MCP servers may be started |

The upstream `CRAFT_CONFIG_DIR` is deliberately **not** read. Honouring it would
inherit a data directory belonging to a different application, which is exactly
the kind of accidental cross-contamination the fork exists to avoid — set
`PHANERIS_CONFIG_DIR` if you want to point somewhere specific.

## Feature flags

| Variable | Default | Effect |
|---|---|---|
| `PHANERIS_FEATURE_SESSION_SHARING` | off | Uploading conversations to a hosted viewer |
| `PHANERIS_FEATURE_PAGES_SHARING` | off | Publishing Pages to a hosted worker |
| `PHANERIS_FEATURE_AGENTS_CLI` | off | CLI guidance and guardrails for the agent |
| `PHANERIS_FEATURE_EMBEDDED_SERVER` | off | Embedded server settings page |
| `PHANERIS_FEATURE_DEVELOPER_FEEDBACK` | on in dev | The agent's developer-feedback tool |
| `PHANERIS_PAGES_SHARE_API_URL` | — | Point Page publishing at a different endpoint (local development) |

Values accept `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`. An explicit value
always wins over the default.

**Both sharing flags default to off, and the code treats that as the contract
rather than the current setting.** Enabling them is an opt-in to sending your
content to a service this build does not own. Note that unpublishing stays
available either way — withdrawing something you published must never depend on
the feature that published it.

## Telemetry

| Variable | Effect |
|---|---|
| `PHANERIS_TELEMETRY_ENABLED=1` | Consent to crash reporting |
| `SENTRY_ELECTRON_INGEST_URL` | Where to send it |

Crash reporting is inert unless **both** are set. A configured destination is not
consent, so the ingest URL alone does nothing. When it is on, the payload is
scrubbed of request headers and sensitive keys before it leaves the process.

## Server and CLI

| Variable | Effect |
|---|---|
| `PHANERIS_SERVER_TOKEN` | Authentication token — required by the server |
| `PHANERIS_SERVER_URL` | Server WebSocket URL for the CLI |
| `PHANERIS_TLS_CA` | Custom CA certificate for self-signed TLS |
| `PHANERIS_RPC_HOST` / `PHANERIS_RPC_PORT` | Bind address and port |
| `PHANERIS_RPC_TLS_CERT` / `_KEY` / `_CA` | TLS material for the RPC listener |
| `PHANERIS_HEADLESS` | Run without a UI |
| `PHANERIS_HEALTH_PORT` | Expose a health endpoint |

See [CLI reference](phaneris://docs/reference/cli-reference).

## Messaging

| Variable | Effect |
|---|---|
| `PHANERIS_DISABLE_MESSAGING` | Turn the messaging gateway off entirely |
| `PHANERIS_MESSAGING_WA_WORKER` | Path to the WhatsApp worker binary |
| `PHANERIS_MESSAGING_NODE_BIN` | Node binary the worker runs under |

## What is not here

Subprocess-level variables — `PHANERIS_SESSION_ID`, `PHANERIS_WORKSPACE_PATH`,
and the many others the app sets for the agent and for automation scripts — are
**set by the app, not by you**. They describe the running context to a child
process. Setting them yourself changes what a script believes about its
environment without changing anything real.

## Next steps

- [App settings](phaneris://docs/reference/config-file) — the settings that live in a file.
- [Network proxy](phaneris://docs/reference/network-proxy) — also in the config file, not the environment.
