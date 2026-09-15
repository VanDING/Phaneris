# Connect to Anything

There are four ways to give the agent access to something, and choosing well
matters more than any of the individual configuration details.

| Way | Use it when |
|---|---|
| **MCP server** | The service publishes one. Structured tools, maintained by someone else. |
| **API source** | No MCP server, but a stable HTTP API. You describe the operations once. |
| **Local folder** | The data is files on your machine. Nothing to authenticate. |
| **In-app browser** | The work is UI-driven, one-off, or the API is unusable. |

## The decision, in order

**1. Is there an MCP server?** Use it. Someone else maintains the tool
descriptions, and you get structured operations rather than screen-scraping.

**2. Will you do this more than once?** If yes, build a source. The first time
costs more than browsing; the third time has already paid for itself.

**3. Is it one lookup?** Use the browser. Building a source for a single question
is a poor trade, and the agent can drive a UI perfectly well.

**4. Is the API unstable or undocumented?** Prefer the browser, or ask for a
[Page](phaneris://docs/go-further/pages) that calls the service the way you
actually need. An API source around a moving target becomes maintenance you did
not sign up for.

## Why this ordering

Sources and browser differ in a way that is easy to miss:

- **A source is auditable.** It is a file you can read, it names the endpoints it
  can reach, and a permission rule can target it. When you ask later "what can
  this agent touch?", there is an answer.
- **A browser session is not.** It can go anywhere the browser can, which is
  anywhere. It is the most capable option and the least bounded one.

Neither is wrong. But "I could not be bothered to configure a source" and "the
API genuinely does not support this" look identical in a transcript and are very
different decisions.

## Bounding what you connect

**Read-only unless you need otherwise.** Most integrations only need to read. A
source that cannot write cannot be persuaded to.

**One source per purpose.** Work and personal accounts as separate sources is
easier to reason about than one broad source, and it shows up in the permission
rules.

**Local folders: point at the part you use.** A source over a 200 GB directory
makes every search slow. A source over the three folders you actually work in
does not.

**Prefer a source over a browser session for anything recurring.** A source
authenticates once and produces the same call every time; a browser session
re-derives the interaction on every run, and re-derives it wrong occasionally.

## When it does not work

**Authentication is the usual failure.** OAuth flows that need a redirect URI
registered somewhere, tokens with the wrong scopes, a service that requires
interactive login each time. Each of these argues for the browser path.

**Rate limits are the second.** A source that queries on every turn can exhaust a
free tier. Cache the result in a Page, or fetch on a schedule with an
[automation](phaneris://docs/automations/overview) instead.

## Next steps

- [Sources](phaneris://docs/sources/overview) — the three source kinds in detail.
- [Browser](phaneris://docs/browser/overview) — the UI-driven path.
- [Pages](phaneris://docs/go-further/pages) — when the answer should be a small app.
