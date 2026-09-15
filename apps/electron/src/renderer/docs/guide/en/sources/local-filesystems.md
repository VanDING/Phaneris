# Local Folders

A **local folder** source points the agent at a directory on your machine and
treats it as data to work with rather than as a codebase to build in.

The distinction matters. When the agent works in a session's working directory it
reads and writes source files, runs builds, and expects to change things. A local
folder source is for the other case: an Obsidian vault, a folder of contracts, a
dataset, a notes directory — material you want searched, summarised, and
occasionally added to, but not "developed".

## Adding one

Choose the Local Folders type when adding a source, then pick the directory. The
path is stored in the source's `config.json`; nothing is copied or moved.

## Read-only or read-write

Set this deliberately. A read-only local folder cannot be modified even in
Execute mode, which makes it safe to point at something irreplaceable — a photo
library, an archive, a synced folder whose conflicts you do not want to debug.

If you want the agent to file notes back into the folder, grant write access to a
**subdirectory** rather than the whole thing. `vault/inbox/` as a writable source
and `vault/` as a read-only one is a combination that stays useful for a long
time.

## Large folders

Indexing is what costs time, so point the source at the part you actually use.
A source covering a 200 GB directory makes every search slow and every listing
huge; a source covering the three subdirectories you care about does not.

Where the folder is very large, prefer having the agent search it with the
command-line tools (`rg`, `fd`) in a session whose working directory is the
folder, instead of indexing the whole tree as a source.

## Relationships to the rest of the app

- **Working directory.** A session's working directory is where commands run and
  where writes are expected. A local folder source does not change it.
- **Skills.** A skill can declare required sources, so a "vault triage" skill can
  refuse to run unless your vault source is connected.
- **Permissions.** Access still follows the active mode; a read-write source in
  Explore mode stays read-only.

## Troubleshooting

**The folder does not appear.** Check the path is absolute and that the app can
read it — on macOS, a folder under `~/Documents` or `~/Desktop` may need the app
to be granted access in System Settings → Privacy & Security → Files and Folders.

**Changes are not visible.** If the folder is synced by another tool, the files
may not be on disk yet. Most sync clients have a "make available offline" option
for directories you use with the agent.

**Writes are refused.** The source is read-only, or the session is in Explore
mode. Both are reported as permission errors rather than failing silently.

## Next steps

- [Sources](phaneris://docs/sources/overview)
- [Permissions](phaneris://docs/core-concepts/permissions)
