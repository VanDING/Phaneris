# Deep Links

Phaneris registers a URL scheme, so anything that can open a link can open the
app at a specific place: a browser bookmark, a script, another application, a
link in a document.

```
phaneris://<route>
```

## Destinations

| Link | Opens |
|---|---|
| `phaneris://allSessions` | The session list |
| `phaneris://allSessions/session/{id}` | One conversation |
| `phaneris://flagged` | Flagged sessions |
| `phaneris://state/{statusId}` | Sessions in a status |
| `phaneris://sources` | Sources |
| `phaneris://sources/source/{slug}` | One source |
| `phaneris://skills` | Skills |
| `phaneris://automations` | Automations |
| `phaneris://projects` | Projects |
| `phaneris://projects/board` | A project's board |
| `phaneris://projects/calendar` | A project's calendar |
| `phaneris://settings` | Settings |
| `phaneris://settings/{subpage}` | A settings page |
| `phaneris://docs` | The documentation |
| `phaneris://docs/{slug}` | One documentation page |

## Opening a new window

Append `?window=focused` to open the destination in its own window rather than
navigating the current one:

```
phaneris://allSessions/session/abc123?window=focused
```

`focused` gives a compact window; `full` gives a normal one. This is how you keep
a conversation open beside your work instead of switching to it.

## Actions

Some links do something rather than navigate:

```
phaneris://action/new-chat?input=Summarize%20this%20repository&send=true
phaneris://action/flag-session/{sessionId}
phaneris://action/unflag-session/{sessionId}
```

`new-chat` accepts `input`, `name`, and `send`. With `send=true` and an `input`,
the message is sent immediately rather than sitting in the composer — which is
what makes this form usable as a launcher.

Links can target a specific workspace by putting it before the route:

```
phaneris://workspace/{workspaceId}/allSessions/session/{sessionId}
```

## Using them

**As a launcher.** A shortcut or an Alfred/Raycast command that opens a new chat
with a standing prompt pre-filled is a genuinely useful thing to have.

**From scripts.** The same links work from a terminal, so a script can hand you a
conversation it just created.

**Between windows.** `?window=focused` on a session is how you park a long-running
conversation somewhere visible while you work elsewhere.

## Limits worth knowing

**Only a small set of parameters is forwarded.** For action links, the
destination receives `send` and the path id — anything else in the query string is
dropped. This is deliberate: an arbitrary parameter that flows into the renderer
is an injection surface, and the app's own links do not need one.

**Deep links are not a public API.** They are internal routes that happen to be
addressable, and their shape follows the app's navigation. A bookmark to a route
may need updating after an upgrade; a link to a *session* will not, which is the
kind worth saving.

## Next steps

- [Installation](phaneris://docs/getting-started/installation) — where the scheme is registered.
- [Conversations](phaneris://docs/core-concepts/conversations) — the session ids these links take.
