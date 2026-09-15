# API Discovery

When a service has no documented API and no MCP server, its own web app is the
specification. Point the browser at it, use it, and read the requests it makes.

This is how an undocumented internal tool becomes something the agent can call
directly — and it is usually an hour of work instead of a week of guessing.

## The loop

1. **Open the app in the browser pane** and log in.
2. **Perform the action you care about** — or ask the agent to, while you watch.
3. **Read the network requests** that action produced: the method, the URL, the
   headers, and the body.
4. **Turn that into an [API source](phaneris://docs/sources/apis)** with the
   endpoint, the authentication the app itself uses, and the parameters you saw.
5. **Test the source** and compare its output against what the UI showed.

Step 5 is the one people skip, and it is the one that catches the difference
between "the request looked right" and "the request returns the right thing".

## What to look for

**The authentication header.** This is the crux. If the app sends a session
cookie, you cannot reproduce that in a source — cookies belong to the browser
session. Look instead for:

- A bearer token or API key in a header, which is portable and is what you want.
- A CSRF token or a signed request, which means the endpoint is deliberately not
  callable outside the app. Stop here; use the browser.
- A cookie-only auth, which usually means an unauthenticated or separately
  documented path exists, or that this is not meant to be automated.

**Whether it is really an API.** Some pages are server-rendered and make no
useful requests at all. If the HTML *is* the data, a source is the wrong shape —
ask the agent to read the page instead.

**Pagination and filtering.** A list endpoint you found by loading page one tells
you nothing about how to get page two. Perform the pagination in the UI and watch
what changes.

## Turning it into a source

Describe only the endpoints you actually need, with the narrowest authentication
that works. An API source is a contract you maintain; a discovered endpoint is
undocumented, which means it can change without notice, so do not describe more
of it than you use.

Where the service offers a real documented API, prefer it — even if the internal
one is simpler. The internal one has no compatibility promise.

## When to stop

**If reproducing the request needs a browser session, stop.** A source that
replays a session cookie is a source that breaks silently and often. Keep the
browser task instead, or ask whether the vendor has a supported API.

**If the endpoint is actually a GraphQL gateway**, a source can still call it,
but you are now maintaining query strings. Ask whether the service's documented
API covers the same ground first.

**If the discovered endpoint writes**, be explicit about it. A write endpoint
found by watching your own click is being called with permissions you granted
interactively; a source calls it on every turn, forever.

## Next steps

- [APIs](phaneris://docs/sources/apis) — building the source.
- [Browser](phaneris://docs/browser/overview) — how the request log is exposed.
