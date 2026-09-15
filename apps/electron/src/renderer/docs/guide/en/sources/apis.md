# APIs

An **API source** connects the agent to any HTTP service that does not offer an
MCP server. You describe the service once — base URL, authentication, and the
operations that matter — and the agent calls those operations as tools.

It is more work to set up than an MCP server and less work than writing one.

## What you are describing

Each API source is a small, explicit contract:

| Part | What it says |
|---|---|
| **Base URL** | Where the service lives, e.g. `https://api.example.com/v1` |
| **Authentication** | How a request proves who it is — bearer token, API key in a header, or OAuth |
| **Endpoints** | The specific operations the agent may call: method, path, parameters |

Only the endpoints you describe are reachable. That is the point: an API source is
deliberately not "the agent may call anything on this host".

## Authentication

- **Bearer token / API key** — stored in the encrypted credential vault and
  attached to each request. Never written into `config.json`.
- **OAuth** — a browser flow, with the token refreshed automatically.
- **Renew endpoint** — some services issue a short-lived token that you exchange
  at a dedicated endpoint. Point the source at that endpoint and the app will
  refresh the access token before it expires.

## Endpoint and tool policy

Two policy layers decide whether a call proceeds:

- **Endpoint policy** is evaluated for API sources. It can restrict which hosts
  and paths are reachable regardless of what the source describes.
- **Tool policy** applies to MCP tools.

Both are consulted before execution, in every permission mode. In Ask to Edit a
denied call is refused outright rather than prompting you — the prompt is for
"may I do this?", not for "policy said no, override it?".

## When not to use an API source

**If the service has an MCP server, use it.** You get maintained tool
descriptions instead of a contract you have to keep current.

**If you need it once, use the browser.** Building a source is an investment in
repeatability. For a single lookup, ask the agent to browse instead.

**If the API is unstable or undocumented**, an API source becomes a maintenance
burden. Prefer the browser path, or ask the agent to build a Page that calls the
service the way you actually need.

## Troubleshooting

**401 / 403.** The credential is present but not accepted. Confirm it has not
expired, and that the account behind it can see the resource you asked for.

**404 on a path that looks right.** Base URL and path are concatenated; a base
URL that already ends in `/v1` combined with a path that starts with `/v1` gives
`/v1/v1`. This is the most common configuration mistake.

**The call was refused without a prompt.** An endpoint policy denied it. Check
the source's allowed hosts and the workspace's permission rules.

## Next steps

- [Sources](phaneris://docs/sources/overview)
- [MCP Servers](phaneris://docs/sources/mcp-servers) — usually the better choice when available.
