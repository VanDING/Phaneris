# Skills Configuration Guide

This guide explains how to create and configure skills in Craft Agent.

> **Configuration workflow:** Use `craft-agent skill ...` commands instead of editing `SKILL.md` files directly.
> - `craft-agent skill --help`
> - Canonical command reference: [craft-cli.md](./craft-cli.md)
> When the Craft CLI feature is enabled, direct agent writes to this managed configuration are blocked; use the CLI. The JSON/YAML examples below describe stored content, not permission to bypass that routing. If CLI is disabled, follow the available tools and current permission mode.

## What Are Skills?

Skills are specialized instructions that extend the active agent for specific tasks. Craft uses a Claude Code-compatible `SKILL.md` structure while adding workspace scope, source requirements, permission hints, icons, and UI management.

**Key points:**
- Skills are invoked via slash commands (e.g., `/commit`, `/review-pr`)
- `globs` is retained as compatibility metadata; the current Craft activation path does not implement automatic file-pattern activation
- `alwaysAllow` is retained as compatibility metadata; it does not change the current Craft permission checks
- Existing Claude Code-style skills can usually be imported; always validate Craft-specific metadata after import

## Claude Code-compatible format

Craft Agent deliberately preserves the familiar frontmatter-plus-Markdown shape:

1. **Portable structure**: a Markdown instruction body with YAML frontmatter
2. **Shared core fields**: `name` and `description`, plus supported optional Craft fields such as `globs`, `alwaysAllow`, and `requiredSources`
3. **Agent-neutral instructions**: write for the active agent unless a skill intentionally targets one model or provider

**What Craft Agent adds:**
- **Visual icons**: Display custom icons in the UI for each skill
- **Workspace organization**: Skills are scoped to workspaces
- **UI management**: Browse, edit, and validate skills through the interface

## Skill Precedence

When a skill is invoked (e.g., `/commit`):

1. **Project**: `{projectRoot}/.agents/skills/{slug}/SKILL.md`
2. **Workspace**: `~/.craft-agent/workspaces/{id}/skills/{slug}/SKILL.md`
3. **Global**: `~/.agents/skills/{slug}/SKILL.md`

The highest-priority matching slug wins: project > workspace > global. Use `craft-agent skill where <slug> --project-root <path>` when CLI is available to inspect the resolved path. Do not assume a separate SDK-bundled fallback.

This allows you to:
- Override a global skill in a workspace or project without modifying the global file
- Reuse a skill pattern with project-specific instructions
- Create new skills at the appropriate scope

## Skill Storage

Skills are stored as folders:
```
~/.craft-agent/workspaces/{workspaceId}/skills/{slug}/
├── SKILL.md          # Required: YAML frontmatter + Markdown instructions
├── icon.svg          # Recommended: Skill icon for UI display
├── icon.png          # Alternative: PNG icon
└── (other files)     # Optional: Additional resources
```

## SKILL.md Format

The supported structure is:

```yaml
---
name: "Skill Display Name"
description: "Brief description shown in skill list"
globs: ["*.ts", "*.tsx"]     # Optional compatibility metadata; does not auto-activate
alwaysAllow: ["Bash"]        # Optional compatibility metadata; does not grant permissions
requiredSources:             # Optional: sources to auto-enable on invocation
  - linear
---

# Skill Instructions

Your skill content goes here. Craft resolves an invoked skill and instructs the
agent to read its SKILL.md before acting; metadata alone is not the instruction body.

## Guidelines

- Specific instructions for the agent
- Best practices to follow
- Things to avoid

## Examples

Show the agent how to perform the task correctly.
```

## Metadata Fields

### name (required)
Display name for the skill. Shown in the UI and skill list.

### description (required)
Brief description (1-2 sentences) explaining what the skill does.

### globs (optional)
Compatibility metadata containing file patterns. Craft currently parses and stores this field but does not use it to automatically activate a skill. Invoke the skill explicitly when it is needed.

```yaml
globs:
  - "*.test.ts"           # Test files
  - "*.spec.tsx"          # React test files
  - "**/__tests__/**"     # Test directories
```

### alwaysAllow (optional)
Compatibility metadata containing tool names. Craft currently parses and stores this field but does not use it to grant tool permissions. A skill cannot override Explore mode, approval requirements, or other runtime policy.

```yaml
alwaysAllow:
  - "Bash"                # Metadata only; does not grant Bash access
  - "Write"               # Metadata only; does not grant write access
```

### requiredSources (optional)
Array of source slugs to auto-enable when this skill is invoked.
When a user mentions the skill, the listed sources are enabled for the session
before the agent starts — so tools from those sources are available from the first turn.

Sources must exist in the workspace and be authenticated. Unauthenticated or
missing sources are silently skipped (the existing runtime auto-enable handles them
as a fallback).

```yaml
requiredSources:
  - linear               # Auto-enable Linear source
  - github               # Auto-enable GitHub source
```

## Creating a Skill

### 1. Create through the available configuration route

With CLI enabled, use `craft-agent skill create --name "Code Review" --description "Review changes" --slug code-review --body "..."`, then `craft-agent skill update code-review --json '{"body":"..."}'`. The body below is example content for those arguments. When CLI is disabled and file editing is allowed, create the folder and SKILL.md at the intended scope.

### 2. Write SKILL.md

```markdown
---
name: "Code Review"
description: "Review code changes for quality, security, and best practices"
globs: ["*.ts", "*.tsx", "*.js", "*.jsx"]
---

# Code Review Skill

When reviewing code, focus on:

## Quality Checks
- Consistent code style
- Clear naming conventions
- Appropriate abstractions

## Security Checks
- Input validation
- Authentication/authorization
- Sensitive data handling

## Best Practices
- Error handling
- Performance considerations
- Test coverage
```

### 3. Add an icon (IMPORTANT)

Every skill should have a visually relevant icon. This helps users quickly identify skills in the UI.

**Icon requirements:**
- **Filename**: Must be `icon.svg`, `icon.png`, `icon.jpg`, or `icon.jpeg`
- **Format**: SVG preferred (scalable, crisp at all sizes)
- **Size**: For PNG/JPG, use at least 64x64 pixels

**How to get an icon:**

1. **Search online icon libraries:**
   - [Heroicons](https://heroicons.com/) - MIT licensed
   - [Feather Icons](https://feathericons.com/) - MIT licensed
   - [Simple Icons](https://simpleicons.org/) - Brand icons (git, npm, etc.)

2. **Use WebFetch to download:**
   ```
   # Find an appropriate icon URL and download it
   WebFetch to get SVG content, then save to icon.svg
   ```

3. **Match the skill's purpose:**
   - Git/commit skill → git icon or commit icon
   - Test skill → checkmark or test tube icon
   - Deploy skill → rocket or cloud icon
   - Review skill → magnifying glass or eye icon

### 4. Validate the skill

**IMPORTANT**: Always validate after creating or editing a skill:

```
skill_validate({ skillSlug: "my-skill" })
```

This validates:
- Slug format (lowercase, alphanumeric, hyphens only)
- SKILL.md exists and is readable
- YAML frontmatter is valid
- Required fields present (name, description)
- Content is non-empty
- Icon format (if present)

## Example Skills

### Commit Message Skill

```yaml
---
name: "Commit"
description: "Create well-formatted git commit messages"
alwaysAllow: ["Bash"]
---

# Commit Message Guidelines

When creating commits:

1. **Format**: Use conventional commits
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `refactor:` Code refactoring
   - `test:` Adding tests

2. **Style**:
   - Keep subject line under 72 characters
   - Use imperative mood ("Add feature" not "Added feature")
   - Explain why, not what (the diff shows what)

3. **Attribution**:
   Follow the repository's contribution policy. Do not invent a human or model co-author identity.
```

**Recommended icon**: Git commit icon from Heroicons or Simple Icons

### Team Standards Skill

```yaml
---
name: "Team Standards"
description: "Enforce team coding conventions and patterns"
globs: ["src/**/*.ts", "src/**/*.tsx"]
---

# Team Coding Standards

## File Organization
- One component per file
- Co-locate tests with source files
- Use barrel exports (index.ts)

## Naming Conventions
- Components: PascalCase
- Hooks: camelCase with `use` prefix
- Constants: SCREAMING_SNAKE_CASE

## Import Order
1. External packages
2. Internal packages (@company/*)
3. Relative imports
```

**Recommended icon**: Clipboard list or checklist icon

### Skill with Required Sources

```yaml
---
name: "Linear Triage"
description: "Triage and prioritize Linear issues"
requiredSources:
  - linear
---

# Linear Triage

When triaging issues:
1. List unassigned issues from the current sprint
2. Categorize by severity
3. Suggest assignees based on expertise
```

**Recommended icon**: Kanban board or list icon

When this skill is invoked, the `linear` source is automatically enabled for the
session — no manual toggle needed.

## Overriding a Skill by Scope

To customize a global skill such as `commit`, create a workspace skill with the same slug through the available configuration route, supply its instruction body and optional icon, then validate it. A project skill with that slug takes precedence over both. Inspect the resolved path before editing; do not assume an SDK-bundled skill exists.

This is useful for:
- Adding team-specific commit message formats
- Enforcing project-specific coding standards
- Customizing review criteria for your codebase

## Best Practices

1. **Be specific**: Give the agent clear, actionable instructions
2. **Include examples**: Show the expected output format
3. **Set boundaries**: Explain what NOT to do
4. **Keep focused**: One skill = one specific task or domain
5. **Add a relevant icon**: Makes skills easily identifiable in the UI
6. **Always validate**: Run `skill_validate` after creating or editing

## Troubleshooting

**Skill not loading:**
- Check slug format (lowercase, alphanumeric, hyphens only)
- Verify SKILL.md exists and is readable
- Run `skill_validate` for detailed errors

**Skill not activating:**
- Invoke it explicitly; `globs` does not automatically activate it in the current runtime
- Check project/workspace/global resolution and whether a higher-priority skill has the same slug
- Verify the resolved SKILL.md was successfully read

**Icon not showing:**
- Use supported formats: svg, png, jpg, jpeg
- File must be named `icon.{ext}` (not `my-icon.svg`)
- Check icon file is not corrupted
- For SVG, ensure valid XML structure
