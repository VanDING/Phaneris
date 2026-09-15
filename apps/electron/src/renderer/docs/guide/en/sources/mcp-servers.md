# MCP Servers

The [Model Context Protocol](https://modelcontextprotocol.io) is an open standard
for exposing tools to an AI agent. A service that ships an MCP server has already
done the work of describing its operations, so connecting one gives the agent
structured tools rather than screen-scraping or hand-written HTTP.

Prefer MCP over a hand-built API source whenever the service offers it.

## What connecting gives you

An MCP server publishes a list of tools — `search_issues`, `create_pull_request`,
`list_channels`, and so on. Phaneris namespaces each one as
`mcp__<source-slug>__<tool-name>` so two servers exposing the same tool name
cannot collide, and so a permission rule can target one server precisely.

The tool list is read **once, when the source connects**. Tools the server adds
later do not appear until you reconnect.

## Two shapes of server

**Remote** — the service hosts it and you connect over HTTP. Usually the simplest
option, and the only one available for hosted products.

**Local (stdio)** — a command run on your machine that speaks MCP over standard
input and output. Common for filesystem access, database bridges, and
developer tooling. You choose the command and its arguments.

A local server runs with your privileges. Treat installing one the way you would
treat installing any executable: know what it does and where it came from.

## Authentication

Three cases, in increasing order of setup work:

1. **No authentication.** The server is public or local.
2. **A token or API key.** You paste it once; it is stored in the encrypted
   credential vault, not in the source's `config.json`.
3. **OAuth.** The source opens a browser window, you authorize, and the token is
   stored — and refreshed — automatically for you.

For OAuth, the redirect has to come back to something. Some services require you
to register a redirect URI in their developer console before the flow will work;
the agent will tell you which value to use when it sets the source up.

## Writing your own

If a service has an MCP server but it is not one of the well-known ones, the
source form accepts any command or URL. If it has no MCP server at all, build an
[API source](phaneris://docs/sources/apis) instead — that is less work than
writing a server.

## Troubleshooting

**Connection refused or timed out.** For a remote server, check the URL and that
the process can reach it — a corporate proxy is the usual culprit (see the
network proxy reference under Settings). For a local server, run the command by
hand and see what it prints.

**Tools are missing.** Reconnect the source: the tool list is fetched at connect
time.

**Calls fail with an authorization error.** The token is present but
insufficient. Check the scopes in the service's own console; some servers
request a broad scope at connect and specific ones per tool.

## Next steps

- [Sources](phaneris://docs/sources/overview) — the other two kinds, and how to scope them.
- [Permissions](phaneris://docs/core-concepts/permissions) — bounding what a source may do without asking.
