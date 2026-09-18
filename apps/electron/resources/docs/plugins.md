# Plugins Configuration Guide

This guide explains how to create, install, modify, and remove plugin bundles in Phaneris.

> **Configuration workflow:** Plugins are files. There is no front-end editor for a package and
> no CLI domain — you create and edit `plugin.json`, `SKILL.md`, `mcp.json`, and `PROMPT.md`
> directly, following this document. The user invokes an installed plugin with `/name`.
> Validate with `config_validate({ target: "plugins" })` after any change.

A plugin bundle follows the [Agent Plugins 1.0.0](https://agent-plugins.org/specification)
package format, so packages written for other clients can be installed here, and packages you
write here can be shared.

---

## What a plugin is

A plugin is a **workspace-owned package** that groups capabilities a user can invoke together:

```
<workspace>/plugins/<name>/
├── plugin.json              # Required. Identity. Agent Plugins 1.0.0 manifest.
├── skills/<slug>/SKILL.md   # Optional. Materialized into <workspace>/skills/<slug>/
├── mcp.json                 # Optional. Materialized into <workspace>/sources/<slug>/
├── PROMPT.md                # Optional. Resident instructions while the plugin is active.
├── phaneris/sources.json    # Optional. api / local sources (Phaneris extension).
└── data/                    # Runtime state owned by the plugin's own server. Never authored.
```

**A plugin must contribute at least one skill or one MCP server.** A package containing only
`plugin.json` does nothing and is rejected.

**Installation copies the skills and MCP servers into the workspace's native locations.** After
that they *are* ordinary skills and sources — same loading, same resolution, same credentials,
same permission checks. Nothing about them is special because a plugin provided them.

---

## Invoking an installed plugin

The user invokes it with a slash command:

```
/投资分析师  analyse this quarter's filing
```

That is **session-resident**: once active, it stays active for the rest of the session, and
activating another plugin silently replaces it. **Only one plugin is active at a time.** There
is no `@` mention for a plugin — `@` refers to an individual skill or source.

While active, the plugin contributes one block to each turn: its `PROMPT.md`, plus a **roster**
of its skills with descriptions and paths. You are not required to read those skills; read one
only when you need its details.

---

## Writing a plugin

### 1. `plugin.json` — the manifest

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "investment-analyst",
  "version": "1.0.0",
  "description": "Earnings analysis, valuation, and comparable-company work",
  "author": { "name": "VanDING" },
  "license": "MIT",
  "keywords": ["finance", "research"]
}
```

**Required:** `$schema` and `name`. `$schema` must be exactly the URL above.

**The `name` must equal the directory name.** So must each skill's frontmatter `name` equal its
own directory name. Install is refused otherwise — this is not a style preference: the
uninstall reference count treats the slug as the resource's identity, and a mismatch would make
it delete the wrong things.

`name` rules: 1–64 characters, lowercase `a-z`, `0-9`, `-`, `.` only, must start and end
alphanumeric, and must not contain `--` or `..`.

Optional: `version`, `description`, `author` (`{name,email,url}` only), `homepage`, `repository`,
`license`, `keywords`, `extensions`. Unknown top-level fields are reported and ignored, not fatal.

### 2. `skills/<slug>/SKILL.md` — a skill

Standard Agent Skills format:

```markdown
---
name: financial-modeling
description: Build three-statement models and derive valuation outputs. Use for financial modelling or forecasting.
---

# Financial Modelling

## Steps
1. ...
```

The `name` must match the directory. `description` is what appears in the roster, so write it to
say both **what** the skill does and **when** to reach for it.

Put long reference material in `references/` next to `SKILL.md` and point at it; keep the main
file focused.

### 3. `mcp.json` — MCP servers

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "sec-edgar": {
      "type": "stdio",
      "command": "${PLUGIN_ROOT}/bin/server",
      "args": ["--data", "${PLUGIN_DATA}"]
    },
    "research-api": {
      "type": "streamable-http",
      "url": "https://research.example.com/mcp"
    }
  }
}
```

Each key becomes a workspace source slug. Three transports: `stdio`, `streamable-http`, `sse`
(`sse` is the deprecated HTTP+SSE transport).

### 4. `PROMPT.md` — resident instructions

Free-form markdown injected while the plugin is active. Keep it to **instructions**, not
knowledge — reference material belongs in a skill body, which is loaded only when needed.

### 5. `phaneris/sources.json` — api and local sources

Agent Plugins 1.0.0 has no portable way to declare these, so Phaneris uses a client extension
namespace named `phaneris`:

```json
[
  { "slug": "yfinance", "type": "api" },
  { "slug": "research-notes", "type": "local" }
]
```

`type` may be `api` or `local` only. `mcp` belongs in `mcp.json`, and there is no `cli` type —
CLI tools are skills that drive the executable through Bash.

---

## Constraints and traps

Each of these is a source of silent failure. Read them before authoring.

1. **Minimum content.** At least one skill or one MCP server. Metadata alone is rejected.

2. **Names must match directories.** The plugin directory name equals `plugin.json`'s `name`;
   each `skills/<slug>/` directory name equals that skill's frontmatter `name`. Mismatches are
   refused (`P2-2`, `P2-3`).

3. **No symbolic links anywhere in the package.** A symlink makes the *entire workspace backup*
   fail, because the backup walks every file and refuses anything that is not a directory or a
   regular file. This includes links the plugin's own server creates inside `data/` (`D11`).

4. **A server's relative paths resolve from the plugin root.** Both `command` and any relative
   path the server itself uses. Pass directories explicitly rather than relying on a working
   directory.

5. **`cwd` is not supported.** A server always runs from its plugin root, which keeps its
   relative-path view inside the package. A `cwd` that is not rooted at `${PLUGIN_ROOT}`
   (including `./data` or `${PLUGIN_DATA}`) makes that server entry invalid and it is skipped.
   Pass the data directory as an argument instead:
   `"args": ["--data", "${PLUGIN_DATA}"]` (`§5.4.1`).

6. **`command` must not be a bare name.** `node` or `npx` is rejected; use `./bin/server` or
   `${PLUGIN_ROOT}/bin/server`. Conforming plugins must not depend on `PATH` behaviour, and the
   pre-flight check cannot judge a relative command reliably (`§5.4.6`).

7. **`command`, `args`, and `env` support two placeholders** — `${PLUGIN_ROOT}` and
   `${PLUGIN_DATA}` (which is `<pluginRoot>/data`). They are resolved when the source is loaded,
   not at install time, so both the workspace and the package stay movable (`§5.4`).

8. **`data/` is persistent; everything else is replaced.** Reinstalling replaces the package and
   its materialized resources wholesale, but `data/` is carried across so a server's state
   survives. Anything you want to keep across versions belongs there — nothing else does.

9. **Never put credentials in the package.** `mcp.json` headers are visible package data. An
   api source declared by a plugin arrives with no endpoints and no credentials; the user
   configures and authenticates it after install through the normal source flow (`P6-5`).

10. **A plugin's api source still needs a `guide.md`.** Every source is gated on reading its
    guide before first use, and a plugin-provided source is no exception (`P6-6`).

11. **One active plugin per session.** Activating another replaces it silently. Resources are
    removed only when no other installed plugin still claims them, so sharing a skill between
    two plugins is safe (`D10`, `D12`).

---

## Installing

Installation is conversational — there is no import dialog. Follow this process.

### 1. Obtain the package

- **Already on disk:** the user placed a directory somewhere, or it came from another machine.
- **An archive:** `.tar`, `.tar.gz`, or `.tgz`. Zip is not supported.
- **A URL:** a direct link to one of those archive formats.

### 2. Validate before writing anything

Load the package and confirm:

- `plugin.json` parses, declares the 1.0.0 `$schema`, and has a valid `name`.
- The directory name, the manifest `name`, and every skill's `name` agree.
- It contributes at least one skill or MCP server.
- It contains no symbolic links.

Report every problem and stop. Do not install a partially valid package.

### 3. Show the user the overwrite list and the exact commands

**This step is required and must not be skipped.** Installing replaces existing resources
without asking again later, so the user approves once, up front, from a concrete list:

```
Installing "investment-analyst" will:

  Replace:
    skill:financial-modeling       (an existing workspace skill)
    source:sec-edgar               (an existing source)

  Create:
    skill:equity-research
    source:research-api

  This package will execute:
    sec-edgar:  ./bin/server --data ${PLUGIN_DATA}
    research-api: (remote, https://research.example.com/mcp)
```

Show stdio commands **verbatim**, including arguments. A hand-configured source is something the
user typed themselves; a package's command is not, so it must be shown in full.

Wait for the user's confirmation before installing.

### 4. Install

Materialization is atomic — a failure part-way leaves the workspace as it was. Report the result:

- skills and sources created
- resources replaced
- anything skipped, and why (one invalid server entry is skipped without sinking the package;
  an invalid skill is skipped without sinking the rest)

A broken entry never silently disappears: the user is told which entry was skipped.

---

## Modifying an installed plugin

Edit the files under `<workspace>/plugins/<name>/`. There is no front-end editor and no separate
store — the package directory is the source of truth.

**Editing a plugin does not change what is already materialized.** Skills and sources were copied
into `<workspace>/skills/` and `<workspace>/sources/` at install time. To make an edit take
effect, reinstall:

1. Edit the package files.
2. Re-run the install flow, including the overwrite list.
3. The changed skills and sources are replaced wholesale.

Two things to know while editing:

- **Reinstalling replaces directories, not individual files.** A file deleted from the package is
  deleted from the workspace. This is deliberate: a file-by-file merge would leave the old
  version's files readable, and the loaders would keep serving them.
- **`data/` is never touched** by a reinstall.

If the user wants a one-off change to an *installed* skill without touching the package, edit
`<workspace>/skills/<slug>/` directly instead, exactly as for any other skill. That diverges
from the package; the next reinstall overwrites it.

---

## Removing a plugin

Uninstalling removes the package and any resource **no other installed plugin still claims**.

```
Uninstalling "investment-analyst" will:

  Remove:
    skill:financial-modeling
    source:sec-edgar

  Keep (still used by another plugin):
    skill:shared-helper
```

Report which resources were removed and which were kept, and say why the kept ones were kept.
The user needs to know that a skill they can still see in the Skills panel is still there by
design, because another plugin depends on it.

Resources that no plugin claims are left alone. A skill the user created by hand is never
deleted by an uninstall.

---

## Validating

```
config_validate({ target: "plugins" })
```

Checks every installed package: manifest schema and name rules, name/directory agreement, the
minimum-content rule, symlinks, and per-entry validity for skills and MCP servers. Run it after
any change to a package.

---

## Troubleshooting

**"manifest name does not match directory name"**
Rename the directory to the manifest `name`, or fix `name` in `plugin.json`. They must be
identical.

**"skill name does not match directory"**
The frontmatter `name` in a `SKILL.md` must equal the directory containing it.

**"contributes nothing"**
The package has no `skills/` entries and no `mcp.json` servers. Add at least one.

**"contains a symbolic link"**
Remove it. Symlinks break workspace backup.

**A server entry was skipped**
Read the reported reason. The usual causes: a bare `command` name, a `cwd` that is not
`${PLUGIN_ROOT}`-rooted, a missing `command`, or an unsupported `transport`. The rest of the
package installs normally.

**The stdio server fails to start**
Check the command path resolves inside the plugin, that `args` passed the server its data
directory (`"${PLUGIN_DATA}"`), and that the server's own relative paths assume the plugin root.

**The plugin is not in the `/` menu**
Check `<workspace>/plugins/<name>/plugin.json` exists and validates. Run the validation above.

**`/name` does nothing**
The plugin may have been uninstalled. Entering a command for a plugin that no longer exists is
ignored rather than an error.
