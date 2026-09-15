# Browser

Phaneris has a real browser built in, and the agent can drive it: navigate, read
a page, click, fill a form, take a screenshot, and inspect the network traffic it
produced.

It is the fallback that makes "connect to anything" true. When a service has no
MCP server and no usable API, the agent can still work with it — the same way you
would.

## What it is

A separate browser pane inside the app, with its own tabs and its own session.
It is not a webview of the page you are reading; it is a browser the agent
operates, visible while it happens.

Because it is visible, it is reviewable. You can watch a form being filled in
rather than discovering afterwards what was submitted.

## When to use it

**One-off tasks.** "Look up the current price of X" does not need an integration.

**UI-driven work.** Some things genuinely have no API — an internal admin panel,
a legacy tool, a report that only exists as a rendered page.

**When a source is brittle.** Some services' authentication is painful enough
that a browser session is more reliable than a token you will be re-authorizing
monthly.

**To discover an API.** Point the browser at a web app and watch the network
traffic; the requests it makes are the API you would otherwise have had to find
in documentation. See [API discovery](phaneris://docs/browser/api-discovery).

## When not to use it

**Anything recurring.** A browser session re-derives the interaction every time,
and re-derives it wrong occasionally. If you will do this weekly, build a source.

**Anything where the exact request matters.** A click is a click; a source names
the endpoint, the method, and the parameters. On anything consequential, the
explicit form is worth the setup.

**Background work.** A browser session needs the app open. An automation with a
source does not.

## Permissions — read this part

Whether the agent may drive the browser at all is a setting
(`browserToolEnabled`). Remote agents are constrained further: running arbitrary
script inside a page is separately gated, because that is the step that turns
"read this page" into "execute code in a logged-in session".

**Explore mode does not block browser interactions.** The browser tool is
available in Explore, and the runtime does not classify its commands as
read-only or mutating — a click that submits a form is the same kind of command
as a click that opens a menu. What bounds it in Explore is an instruction to the
agent: inspect only, do not use clicks, typing, paste, uploads, or script to edit
external records, send messages, or submit a form that creates a commitment. In
the execution modes, the agent is told to present consequential actions for
confirmation first.

That is a real difference from file writes, where Explore mode refuses the
operation outright. **Treat Explore as a strong default rather than a hard
boundary for browser work.** If you want a hard boundary, the lever is the
setting, not the mode: turn the browser off, and use a
[source](phaneris://docs/sources/overview) whose reach you can name.

## Reviewing what it did

A browser turn records the navigation, the actions, and the network requests. If
something unexpected happened, the request log is usually the explanation — a
POST you did not expect is easier to spot there than in a screenshot.

## Next steps

- [Examples and recipes](phaneris://docs/browser/examples) — what this looks like in practice.
- [API discovery](phaneris://docs/browser/api-discovery) — turning a UI into a source.
- [Permissions](phaneris://docs/core-concepts/permissions) — what Explore mode allows here.
