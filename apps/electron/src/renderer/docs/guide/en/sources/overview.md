# Sources

A **source** is a connection that gives the agent new capability. Without
sources, the agent can read and write files and run commands in your working
directory. With them, it can also query your issue tracker, search your mail,
read a repository's pull requests, or look things up on the web.

There are exactly three kinds:

| Type | Use it for | Examples |
|---|---|---|
| **MCP server** | Services with an official Model Context Protocol server. The richest option — structured tools, not raw HTTP. | GitHub, Linear, Notion, Sentry |
| **REST API** | Anything with an HTTP API and no MCP server. You describe the endpoints once; the agent calls them. | Internal services, niche SaaS |
| **Local folder** | Directories on your machine the agent should treat as data rather than as code. | An Obsidian vault, a documents folder, a dataset |

## Where they live

Sources are **workspace-scoped**. Each workspace keeps its own:

```
~/.phaneris/workspaces/{workspaceId}/sources/{slug}/
  config.json        connection details (never secrets)
  guide.md           optional: notes the agent reads before using it
```

Secrets are not in `config.json`. They live in the encrypted credential vault
(`~/.phaneris/credentials.enc`) and are referenced by name. That is why a source
you can copy between workspaces may still need re-authorizing.

## Adding one

The intended path is conversational: ask the agent to set something up and it
will research the service, ask what you need, and draft the configuration for
you to approve. That works better than filling in a form because the setup
details differ per service — which authentication flow, which scopes, which
endpoint — and the agent can look them up.

You can also add one from the sidebar's Sources panel, and edit any existing
source's configuration there.

## Find the narrowest access that works

A source is a capability you hand the agent, so scope it deliberately:

- **Read-only where possible.** A source that can only read cannot be talked into
  deleting something.
- **One source per purpose.** "Work GitHub" and "personal GitHub" as two sources
  is safer and easier to reason about than one source with broad scopes.
- **Prefer a source to a browser session** for anything you will do more than
  once: a source is authenticated once, auditable, and repeatable. Use the
  in-app browser for one-off, UI-driven work instead.

## Troubleshooting

**Authentication failed.** Check the credential still exists in Settings and that
its scopes cover the operation. OAuth tokens expire; a source that worked last
month may just need re-authorizing.

**The agent says it has no such tool.** MCP servers expose a fixed tool list at
connect time. If the server added a tool after you connected, reconnect the
source.

**A request is blocked.** In Explore mode nothing writes. In Ask to Edit you
should have seen a prompt — if a call was refused without one, an endpoint or
tool policy denied it, not the mode.

## Next steps

- [MCP Servers](phaneris://docs/sources/mcp-servers)
- [APIs](phaneris://docs/sources/apis)
- [Local Folders](phaneris://docs/sources/local-filesystems)
