# Examples and Recipes

What browser-driven work looks like in practice, and where the seams are.

## Reading a page you can name

The simplest case, and the one that most often does not need a source:

> Open the status page at status.example.com and tell me whether anything is
> degraded right now.

The agent navigates, reads the page, and answers. No integration, no token, no
configuration. If this is the only thing you need from that site, a source would
have cost you an hour to save you nothing.

## Watching network traffic

Point the browser at a web app and let it make requests; the agent can see them
and read the shapes.

> Open the admin panel, go to the invoices page, and show me the API call it
> makes to list them.

This is the fastest route to an API source you did not have documentation for.
See [API discovery](phaneris://docs/browser/api-discovery).

## Anywhere with canvas

Some applications draw their content instead of putting it in the page —
spreadsheets, document editors, chart tools. There are no elements to click
because there are no elements; everything is pixels.

The agent has patterns for this: navigate by a stable control (a name box, a
search field, a keyboard shortcut) rather than by the thing you want to affect,
and drive it with keys. It is slower and more fragile than a normal page, and it
is the reason "open Google Sheets and update A1" works at all.

## Following a flow that requires login

A browser session carries its own cookies, so you can log in once and have the
agent continue. This is genuinely useful — and it is the case where the browser's
lack of a boundary matters most, because the session is authenticated as you.

Two habits make it safer:

- **Do the consequential step yourself.** Let the agent fill the form and land on
  the confirmation, then click submit. Nothing is lost and the last mile is
  yours.
- **Review the request log after.** A browser turn records what was sent. Reading
  it takes seconds and catches the case where the agent's click did more than
  either of you intended.

## Batch work that stays visible

For a repetitive task across many pages, the agent's browser work happens in the
pane while you watch. That is the point of doing it here rather than in a script:
the first few iterations are reviewable, and you can stop it when the pattern is
clearly wrong rather than when the batch finishes.

## What browser work is bad at

**Repeating exactly.** A click is a click; the page can change between runs. If
the task matters, promote it to a source once you understand the calls.

**Running unattended.** The browser needs the app open, and the work is visible
by design. Scheduled, headless work belongs to
[automations](phaneris://docs/automations/overview) with a source behind them.

**Anything with a stable API.** If an endpoint exists and does what you need, use
it: it is faster, cheaper, and reviewable as a request rather than as a sequence
of clicks.

## Next steps

- [Browser](phaneris://docs/browser/overview) — what it is and how it is bounded.
- [Sources](phaneris://docs/sources/overview) — promoting a working recipe into an integration.
