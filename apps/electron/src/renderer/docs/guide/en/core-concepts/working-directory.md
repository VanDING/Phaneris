# Working Directory

The working directory is where a session's commands run and where relative paths
resolve. It is the single most consequential setting on a session, because it is
what "here" means to the agent.

It is shown as a badge in the composer and can be changed at any point without
starting a new conversation.

## What it affects

- **Shell commands** run there. `ls` lists it, `git status` reports on the
  repository that contains it, a build script runs in it.
- **Relative paths** resolve against it, both in tool calls and in what you write.
- **File writes** land there unless the agent names an absolute path.
- **The agent's framing** follows from it: opening a session in a repository
  makes the agent behave like a developer in that repository, because that is
  what it can see.

## What it does not affect

- **Permissions.** The mode decides what may be written, not the directory. A
  session in Execute mode can still write outside its working directory if a rule
  allows it.
- **Sources.** A [local folder source](phaneris://docs/sources/local-filesystems)
  is a separate, read-only-or-not capability. Pointing a session at a folder does
  not grant a source, and adding a source does not change the working directory.

## Where the default comes from

In order of precedence:

1. **The session's own setting**, if you have changed it.
2. **The project's working directory**, if the session is bound to a project.
3. **The workspace root**, otherwise.

A session created inside a project inherits the project's directory. Changing the
project later does not move existing sessions — their directories are already
set.

## Choosing one

**Point at the thing you want changed, not at its parent.** A session whose
working directory is a monorepo root spends its first turns discovering which
package matters. A session pointed at the package starts working.

**Separate directories mean separate sessions.** If you want to change two
repositories, that is two sessions — the agent's context is built around one
place, and a session that keeps switching directories accumulates confusion about
which one "the project" is.

**Home is a real option.** For work that is not about a codebase — research,
writing, organizing files — your home directory or a documents folder is the
honest answer.

## Windows

The Claude-backed SDK shells out through a bash implementation. On Windows, the
path to Git's bash is configurable in Settings; without it, the SDK falls back to
searching the default install location, which fails on machines where Git is
installed elsewhere. Set it once if commands fail with a shell-not-found error.

## Next steps

- [Permissions](phaneris://docs/core-concepts/permissions) — the other half of "what may happen here".
- [Projects](phaneris://docs/core-concepts/projects) — setting a default directory for related sessions.
- [Conversations](phaneris://docs/core-concepts/conversations) — the session this directory belongs to.
