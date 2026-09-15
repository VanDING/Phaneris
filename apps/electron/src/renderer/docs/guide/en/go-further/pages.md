# Pages

A **page** is a small app that lives inside a workspace. It has its own HTML,
its own private data store, and — optionally — a script that refreshes it on a
schedule. A dashboard of your open pull requests, a reading list your agent
maintains, a tracker for something that has no tracker.

Pages are the answer to "the agent produces this every week and I keep asking for
it". Build it once; come back to a page instead of a conversation.

## What a page is made of

```
~/.phaneris/workspaces/{workspaceId}/pages/{slug}/
  page.json        configuration: title, refresh schedule, grants
  index.html       the content
  data/            the page's own storage
    store.sqlite     script-private state
    snapshot.json    the one thing the page actually reads
  thumbnail.jpg    cached preview image
```

The split between `store.sqlite` and `snapshot.json` is deliberate: the script
owns the database and does whatever bookkeeping it needs, then publishes a
snapshot. The page reads only the snapshot, so a refresh that fails halfway
leaves the last good snapshot in place rather than a half-written view.

## Refreshing

A page's refresh spec is a cron expression. The floor is five minutes — faster
than that is polling, and polling a third-party API is how you get rate-limited.

The refresh runs a script inside the workspace, which is what makes a page more
than a static document: the script can query a source, transform the result, and
write the snapshot the page renders.

`page.json` is written **last** in a refresh run. That ordering is what tells the
app the run finished and the new content is safe to show.

## Approving actions

A page is a web page, and by default it cannot reach your sources — a page's
JavaScript never calls an API source directly. Anything a page wants to do beyond
reading its snapshot goes through an **action grant**:

- A grant is bound to the page's current content, so changing the page
  invalidates its approvals rather than silently extending them.
- Grants expire.
- Every decision is written to an audit log.

If a page asks for something and you approve it, you are approving *that* page
content doing *that* thing. Editing the page afterwards revokes the approval,
which is intentional: the thing you approved is no longer the thing that exists.

A page with a **script** grant cannot be published at all, even a stale one — the
remedy is to remove the grant, never to bypass the check.

## Sharing is disabled in this build

Upstream can publish a page to a hosted worker so it has a public URL. **This
build does not.** Publishing is off, the publish controls are absent, and nothing
about a page leaves your machine. Unpublishing still works, so a page published by
an older version can be withdrawn.

That also means a page is only reachable from inside the app, in the workspace
that owns it. There is no public URL to send anyone — if you need to share the
result, export the underlying data instead.

## Keeping pages honest

**One question per page.** A page should answer something specific at a glance.
A page that needs scrolling to interpret has become a document.

**Make the refresh cheap and idempotent.** A scheduled script that runs twice
should produce the same snapshot, not two entries.

**Prefer the snapshot to live queries.** A page that calls out while rendering is
slow and fails when the network does. Fetch on a schedule, render from the
snapshot.

**Delete pages you stopped reading.** A stale dashboard is worse than none,
because it looks authoritative.

## Next steps

- [Automations](phaneris://docs/automations/overview) — the other way to run work on a schedule.
- [Sources](phaneris://docs/sources/overview) — what a refresh script can query.
