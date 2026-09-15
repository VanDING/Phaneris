# Skills

A **skill** is a reusable instruction set. It is a folder containing a `SKILL.md`
— YAML frontmatter plus a Markdown body — that teaches the agent how to do one
thing your way: review a diff with your conventions, write a release note in your
format, triage your inbox by your rules.

## Invoking one

Mention it in a message with `@`:

```
@code-review look at the changes on this branch
```

Typing `@` opens an autocomplete listing your workspace's skills alongside
sources and files. The skill's instructions are added to that turn's context; the
rest of the conversation is unaffected.

`/slash` commands are a different mechanism — they switch permission modes, open
features, and pick folders. A skill is not a slash command.

## What a skill looks like

```
~/.phaneris/workspaces/{workspaceId}/skills/{slug}/
  SKILL.md      required: YAML frontmatter + Markdown instructions
  icon.png      optional: shown in the list
```

The frontmatter carries `name` and `description`; the description is what the
agent uses to decide a skill is relevant, so write it as a sentence about when to
use the skill, not a restatement of its name. The body is the instruction — write
it in the second person, as if briefing a competent colleague who has not seen
your project.

## Three scopes, one resolution order

A skill slug resolves to the most specific matching definition:

| Priority | Location |
|---|---|
| 1 — highest | `{projectRoot}/.agents/skills/{slug}/SKILL.md` |
| 2 | `~/.phaneris/workspaces/{id}/skills/{slug}/SKILL.md` |
| 3 | `~/.agents/skills/{slug}/SKILL.md` |

This is what makes a skill genuinely reusable: keep the general version globally,
override it in a workspace, and override that again in one repository — without
copying anything.

## Keeping them useful

**One skill, one job.** A skill that does five things is invoked for one of them
and drags the other four into context.

**State the outcome, not the steps.** "Produce a changelog entry in the format
below" survives a refactor of the repository; "run `npm run build` then edit
`CHANGELOG.md` line 3" does not.

**Let the body reference files.** A skill can point at a checklist, a template,
or a style guide inside its own folder. That keeps the invocable skill short and
the detail maintained in one place.

**Skills can require sources.** Declaring a required source means the skill
refuses to run unless that source is connected, instead of silently producing a
worse answer.

## Troubleshooting

**The skill did not run.** Check the slug matches exactly — the mention resolves
against the skill list, and an unmatched mention is passed through as literal
text. The autocomplete is the reliable way to pick one.

**It ran but ignored your conventions.** The instructions are in the body, not
the description. Open the skill and check the body actually says what you think
it says.

**A skill from another tool does not behave as documented.** `globs` and
`alwaysAllow` are accepted for compatibility but do not drive activation or
permission decisions here. Validate imported skills rather than assuming their
Claude Code behaviour carries over.

## Next steps

- [Sources](phaneris://docs/sources/overview) — skills can require them.
- [Workspaces](phaneris://docs/go-further/workspaces) — where skills are scoped.
