# Plugins

A **plugin** is a bundle of capabilities you install as one unit: a set of
skills, the sources they need, and a short standing instruction for the agent.
Where a skill is one job and a source is one connection, a plugin is the
combination — "everything needed to do equity research" rather than the four
separate things that happen to add up to it.

## Invoking one

Type `/` and pick the plugin, or type `/name`:

```
/investment-analyst value Tesla against its peers
```

The plugin becomes **active for the session**. That means three things happen
from that point on, on every turn, without you repeating yourself:

- its sources are switched on, so the tools it contributes are available
- its standing instruction is added to the conversation's context
- the agent is told which skills it brought, and reads one when it needs it

Only one plugin is active at a time. Invoking another replaces the first
silently — the badge next to the permission mode always shows which one is
current, and its **×** turns it off.

## What is in a plugin

```
~/.phaneris/workspaces/{workspaceId}/plugins/{name}/
  plugin.json          required — the manifest
  skills/{slug}/       SKILL.md files, one folder per skill
  mcp.json             MCP servers the plugin needs
  phaneris/sources.json  API and local-folder sources
  PROMPT.md            standing instruction, added while the plugin is active
  data/                the plugin's own storage, kept across reinstalls
```

A plugin must contribute at least one skill or one source. A folder with only a
manifest is not a plugin.

## Installing one

**You do not need a special install screen — ask the agent.** Point it at the
package directory (or hand it a `.tar` / `.tar.gz` archive) and say what you
want. Before writing anything it shows you:

- **what will be replaced.** Plugins overwrite rather than merge, so if an
  installed plugin already provides `code-review`, installing another one that
  also provides it will replace it. The list names each conflict.
- **the exact command any bundled server will run.** A plugin's `mcp.json` can
  start a local process; that command is shown verbatim, as the package author
  wrote it, so you are approving the real thing rather than a summary.

Nothing is written until you agree. Once installed, the plugin's skills live in
your workspace's `skills/` and its sources in `sources/` — ordinary resources
from then on, editable and disable-able like anything you made by hand.

## Editing one

Plugins are files, and the agent edits them conversationally: "give the
investment-analyst plugin a new skill for comparable-company analysis", or
"change the prompt so it always cites sources". The `PROMPT.md` text, a skill's
`SKILL.md`, and the manifest are all fair game. Changes take effect on the next
message — no restart, no reinstall.

Reinstalling over an existing plugin replaces its files but **keeps its `data/`
directory**, so anything the plugin has stored survives an upgrade.

## Removing one

Ask the agent to remove it, or use the row menu in the **Plugins** section of the
sidebar. The confirmation separates two cases, because they are genuinely
different:

- **Removed** — resources only this plugin provided. They are deleted.
- **Kept** — resources another installed plugin also provides. Deleting them
  would break the plugin that still needs them, so they stay.

If a plugin is removed while a session has it active, the session simply stops
receiving its context. Reinstall it and the session picks it up again.

## Plugins are workspace-scoped

A plugin belongs to one workspace, like skills and sources. Two workspaces can
hold different versions of the same plugin, or one can have it and the other not.
The `Plugins` section lists what the current workspace has.

## Troubleshooting

**`/name` does not appear.** Check the plugin actually installed — it should be
listed in the sidebar's Plugins section. A bundle that fails to load shows there
as a broken entry with the reason, rather than disappearing.

**It is active but its tools are missing.** Its sources are enabled but not
*usable* — usually they need a credential. A source that requires authentication
is inert until you connect it; the Plugins section shows which sources each
plugin contributes.

**Its skills were not used.** The active plugin tells the agent which skills it
brought; it does not force-read them. If the agent is not picking one up, say so
directly — `@skill-name` names it exactly.

**A reinstall lost my edits.** Installing over a plugin replaces its files by
design. Put anything you want to survive in `data/`, or make the plugin's own
files part of the package you reinstall from.

**Symbolic links are refused.** A plugin containing a symlink will not install or
load. Workspace backups cannot represent them, so the refusal is deliberate and
not a bug to work around.

## Next steps

- [Skills](phaneris://docs/skills/overview) — what a plugin bundles.
- [Sources](phaneris://docs/sources/overview) — what a plugin connects.
- [Workspaces](phaneris://docs/go-further/workspaces) — where plugins live.
