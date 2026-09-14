# Phaneris CLI Guide

`phaneris` manages workspace config domains such as labels, sources, skills, and automations. When the Phaneris CLI feature is enabled, guarded agent file operations are blocked: use the corresponding CLI command. This includes reads under `labels/` and writes to labels, source config, skill instructions, and automations. When disabled, use available configuration tools within the current permission mode.

## Usage

```bash
phaneris <entity> <action> [args] [--flags] [--json '<json>'] [--stdin]
```

### Global flags
- `phaneris --help`
- `phaneris --version`
- `phaneris --discover`

### Input modes
- Flat flags for simple values
- `--json` for structured inputs
- `--stdin` for piped JSON object input

---

<!-- cli:label:start -->
## Label

Manage workspace labels stored under `labels/`.

### Commands
- `phaneris label list`
- `phaneris label get <id>`
- `phaneris label create --name "<name>" [--color "<color>"] [--parent-id <id|root>] [--value-type string|number|date]`
- `phaneris label update <id> [--name "<name>"] [--color "<color>"] [--value-type string|number|date|none] [--clear-value-type]`
- `phaneris label delete <id>`
- `phaneris label move <id> --parent <id|root>`
- `phaneris label reorder [--parent <id|root>] <ordered-id-1> <ordered-id-2> ...`
- `phaneris label auto-rule-list <id>`
- `phaneris label auto-rule-add <id> --pattern "<regex>" [--flags "gi"] [--value-template "$1"] [--description "..."]`
- `phaneris label auto-rule-remove <id> --index <n>`
- `phaneris label auto-rule-clear <id>`
- `phaneris label auto-rule-validate <id>`

### Examples

```bash
phaneris label list
phaneris label get bug
phaneris label create --name "Bug" --color "accent"
phaneris label create --name "Priority" --value-type number
phaneris label update bug --json '{"name":"Bug Report","color":"destructive"}'
phaneris label update priority --value-type none
phaneris label move bug --parent root
phaneris label reorder --parent root development content bug
phaneris label auto-rule-add linear-issue --pattern "\\b([A-Z]{2,5}-\\d+)\\b" --value-template "$1"
phaneris label auto-rule-list linear-issue
phaneris label auto-rule-validate linear-issue
```

### Notes
- Use `--json` / `--stdin` for nested or bulk updates.
- IDs are stable slugs generated from name on create.
- Use `--value-type none` or `--clear-value-type` to remove a label value type.
<!-- cli:label:end -->

---

<!-- cli:source:start -->
## Source

Manage workspace sources stored under `sources/{slug}/`.

### Commands
- `phaneris source list`
- `phaneris source get <slug>`
- `phaneris source create` (see flags below)
- `phaneris source update <slug> --json '{...}'`
- `phaneris source delete <slug>`
- `phaneris source validate <slug>`
- `phaneris source test <slug>`
- `phaneris source init-guide <slug> [--template generic|mcp|api|local]`
- `phaneris source init-permissions <slug> [--mode read-only]`
- `phaneris source auth-help <slug>`

### Flags for `source create`

| Flag | Description |
|------|-------------|
| `--name "<name>"` | **(required)** Source display name |
| `--provider "<provider>"` | **(required)** Provider identifier (e.g., `linear`, `github`) |
| `--type mcp\|api\|local` | **(required)** Source type |
| `--enabled true\|false` | Enable/disable source (default: `true`) |
| `--icon "<url-or-emoji>"` | Icon URL (auto-downloaded) or emoji |
| **MCP-specific** | |
| `--url "<url>"` | MCP server URL |
| `--transport http\|stdio` | MCP transport type |
| `--auth-type oauth\|bearer\|none` | MCP authentication type |
| **API-specific** | |
| `--base-url "<url>"` | **(required for api)** API base URL (must have trailing slash) |
| `--auth-type bearer\|header\|query\|basic\|none` | **(required for api)** API auth type |
| **Local-specific** | |
| `--path "<path>"` | **(required for local)** Filesystem path |

### Examples

```bash
phaneris source list
phaneris source get linear
# MCP source with flat flags
phaneris source create --name "Linear" --provider "linear" --type mcp --url "https://mcp.linear.app/sse" --auth-type oauth
# MCP source with --json for nested config
phaneris source create --name "Linear" --provider "linear" --type mcp --json '{"mcp":{"transport":"http","url":"https://mcp.linear.app/sse","authType":"oauth"}}'
# API source
phaneris source create --name "Exa" --provider "exa" --type api --base-url "https://api.exa.ai/" --auth-type header
# Local source
phaneris source create --name "Docs Folder" --provider "filesystem" --type local --path "~/Documents"
phaneris source update linear --json '{"enabled":false}'
phaneris source validate linear
phaneris source test linear
phaneris source init-guide linear --template mcp
phaneris source init-permissions linear --mode read-only
phaneris source auth-help linear
```

### Notes
- Use flat flags for simple values or `--json` for type-specific nested config fields (`mcp`, `api`, `local`).
- `init-guide` scaffolds a practical `guide.md` based on source type.
- `init-permissions` scaffolds read-only `permissions.json` patterns for Explore mode.
- `auth-help` returns the recommended in-session auth tool and mode.
- `test` is lightweight CLI validation; for full in-session auth/connection probing use `source_test` MCP tool.
<!-- cli:source:end -->

---

<!-- cli:skill:start -->
## Skill

Manage workspace skills stored under `skills/{slug}/SKILL.md`.

### Commands
- `phaneris skill list [--workspace-only] [--project-root <path>]`
- `phaneris skill get <slug> [--project-root <path>]`
- `phaneris skill where <slug> [--project-root <path>]`
- `phaneris skill create` (see flags below)
- `phaneris skill update <slug> --json '{...}' [--project-root <path>]`
- `phaneris skill delete <slug>`
- `phaneris skill validate <slug> [--source workspace|project|global] [--project-root <path>]`

### Flags for `skill create`

| Flag | Description |
|------|-------------|
| `--name "<name>"` | **(required)** Skill display name |
| `--description "<desc>"` | **(required)** Brief description (1-2 sentences) |
| `--slug "<slug>"` | Custom slug (auto-generated from name if omitted) |
| `--body "..."` | Skill content/instructions (markdown body) |
| `--icon "<url>"` | Icon URL (auto-downloaded to `icon.*`) |
| `--globs "*.ts,*.tsx"` | Compatibility metadata only; does not auto-activate skills |
| `--always-allow "Bash,Write"` | Compatibility metadata only; does not grant permissions |
| `--required-sources "linear,github"` | Comma-separated source slugs to auto-enable |

### Examples

```bash
phaneris skill list
phaneris skill list --workspace-only
phaneris skill where commit-helper
phaneris skill create --name "Commit Helper" --description "Generate conventional commits" --slug commit-helper
phaneris skill create --name "Code Review" --description "Review PRs" --globs "*.ts,*.tsx" --always-allow "Bash" --required-sources "github"
phaneris skill update commit-helper --json '{"requiredSources":["github"],"body":"Use concise, imperative commit messages."}'
phaneris skill validate commit-helper
phaneris skill validate commit-helper --source global
phaneris skill delete commit-helper
```

### Notes
- `create` / `update` write `SKILL.md` frontmatter and content body.
- Use `where` to inspect project/workspace/global resolution precedence.
- `--project-root` scopes resolution to a project directory (defaults to cwd).
<!-- cli:skill:end -->

---

<!-- cli:automation:start -->
## Automation

Manage workspace automations stored in `automations.json`.

### Commands
- `phaneris automation list`
- `phaneris automation get <id>`
- `phaneris automation create` (see flags below)
- `phaneris automation update <id>` (same flags as create, all optional)
- `phaneris automation delete <id>`
- `phaneris automation enable <id>`
- `phaneris automation disable <id>`
- `phaneris automation duplicate <id>`
- `phaneris automation history [<id>] [--limit <n>]`
- `phaneris automation last-executed <id>`
- `phaneris automation test <id> [--match "..."]`
- `phaneris automation lint`
- `phaneris automation validate`

### Flags for `automation create` / `update`

| Flag | Description |
|------|-------------|
| `--event <EventName>` | **(required for create)** Event trigger (e.g., `UserPromptSubmit`, `SchedulerTick`, `LabelAdd`) |
| `--name "<name>"` | Display name for the automation |
| `--matcher "<regex>"` | Regex pattern for event matching |
| `--cron "<expression>"` | Cron expression (for `SchedulerTick` events) |
| `--timezone "<tz>"` | IANA timezone (e.g., `Europe/Budapest`) |
| `--permission-mode safe\|ask\|allow-all` | Permission level for created sessions |
| `--enabled true\|false` | Enable/disable the automation |
| `--labels "label1,label2"` | Comma-separated labels for created sessions |
| `--prompt "..."` | Prompt text (creates a prompt action automatically) |
| `--llm-connection "<slug>"` | LLM connection slug for the created session |
| `--model "<model-id>"` | Model ID for the created session |

### Examples

```bash
phaneris automation list
phaneris automation validate
# Simple prompt automation with flat flags
phaneris automation create --event UserPromptSubmit --prompt "Summarize this prompt"
# Scheduled automation with flat flags
phaneris automation create --event SchedulerTick --cron "0 9 * * 1-5" --timezone "Europe/Budapest" --prompt "Give me a morning briefing" --labels "Scheduled" --permission-mode safe
# Complex automation with --json
phaneris automation create --event SchedulerTick --json '{"cron":"0 9 * * 1-5","actions":[{"type":"prompt","prompt":"Daily summary"}]}'
phaneris automation update abc123 --name "Morning Report" --prompt "Updated prompt"
phaneris automation update abc123 --enabled false
phaneris automation enable abc123
phaneris automation duplicate abc123
phaneris automation history abc123 --limit 10
phaneris automation last-executed abc123
phaneris automation test abc123 --match "UserPromptSubmit"
phaneris automation lint
phaneris automation delete abc123
```

### Notes
- Use flat flags for simple automations or `--json` for complex matchers with multiple `actions`.
- `--prompt` is a shortcut that auto-wraps the text as a prompt action. Use `--json` with `actions` for multi-action automations.
- `lint` provides quick matcher/action hygiene checks (regex validity, missing actions, oversized prompt mention sets).
- `history` and `last-executed` read from `automations-history.jsonl` when present.
- `validate` runs full schema and semantic checks.
<!-- cli:automation:end -->

---

<!-- cli:permission:start -->
## Permission

Manage Explore mode permissions stored in `permissions.json` (workspace-level and per-source).

### Commands
- `phaneris permission list`
- `phaneris permission get [--source <slug>]`
- `phaneris permission set [--source <slug>] --json '{...}'`
- `phaneris permission add-mcp-pattern "<pattern>" [--comment "..."] [--source <slug>]`
- `phaneris permission add-api-endpoint --method GET|POST|... --path "<regex>" [--comment "..."] [--source <slug>]`
- `phaneris permission add-bash-pattern "<pattern>" [--comment "..."] [--source <slug>]`
- `phaneris permission add-write-path "<glob>" [--source <slug>]`
- `phaneris permission remove <index> --type mcp|api|bash|write-path|blocked [--source <slug>]`
- `phaneris permission validate [--source <slug>]`
- `phaneris permission reset [--source <slug>]`

### Scope

Without `--source`: operates on workspace-level `permissions.json` (global rules).
With `--source <slug>`: operates on that source's `permissions.json` (auto-scoped).

### Examples

```bash
# List all permissions files (workspace + sources)
phaneris permission list
# Get workspace permissions
phaneris permission get
# Get source-specific permissions
phaneris permission get --source linear
# Add read-only MCP patterns for a source
phaneris permission add-mcp-pattern "list" --comment "List operations" --source linear
phaneris permission add-mcp-pattern "get" --comment "Get operations" --source linear
phaneris permission add-mcp-pattern "search" --comment "Search operations" --source linear
# Add API endpoint rules
phaneris permission add-api-endpoint --method GET --path ".*" --comment "All GET requests" --source stripe
# Add bash patterns
phaneris permission add-bash-pattern "^ls\\s" --comment "Allow ls"
# Add write path globs
phaneris permission add-write-path "/tmp/**"
# Remove a rule by index and type
phaneris permission remove 1 --type mcp --source linear
# Replace entire config
phaneris permission set --source github --json '{"allowedMcpPatterns":[{"pattern":"list","comment":"List ops"}]}'
# Validate all permissions
phaneris permission validate
# Validate source-specific
phaneris permission validate --source linear
# Delete permissions file (revert to defaults)
phaneris permission reset --source linear
```

### Notes
- Source-level MCP patterns are auto-scoped at runtime (e.g., `list` becomes `mcp__<slug>__.*list`).
- `remove` uses 0-based index within the specified rule type array. Use `get` to see indices.
- `validate` runs schema + regex validation. Without `--source`, validates workspace + all sources.
- `reset` deletes the permissions file, reverting to defaults.
<!-- cli:permission:end -->

---

<!-- cli:theme:start -->
## Theme

Manage app-level and workspace-level theme settings.

### Commands
- `phaneris theme get`
- `phaneris theme validate [--preset <id>]`
- `phaneris theme list-presets`
- `phaneris theme get-preset <id>`
- `phaneris theme set-color-theme <id>`
- `phaneris theme set-workspace-color-theme <id|default>`

### Examples

```bash
# Inspect current theme state
phaneris theme get

# Validate all user theme files
phaneris theme validate

# Validate one preset file
phaneris theme validate --preset nord

# List available presets
phaneris theme list-presets

# Inspect a specific preset
phaneris theme get-preset dracula

# Set app default preset
phaneris theme set-color-theme nord

# Set workspace override
phaneris theme set-workspace-color-theme dracula

# Clear workspace override (inherit app default)
phaneris theme set-workspace-color-theme default
```

### Notes
- `default` is the only built-in theme and its ID is reserved.
- All other themes are user-owned JSON files in `~/.phaneris/themes/`.
- `set-color-theme` and `set-workspace-color-theme` require an existing user theme ID (`default` is always valid).
- Workspace override is stored in `workspace/config.json` under `defaults.colorTheme`.
- The deprecated `~/.phaneris/theme.json` override is migrated once and is not part of runtime resolution.
<!-- cli:theme:end -->

---

## Output contract

All commands return a single JSON envelope on stdout.

### Success
```json
{ "ok": true, "data": {}, "warnings": [] }
```

### Error
```json
{
  "ok": false,
  "error": {
    "code": "USAGE_ERROR",
    "message": "...",
    "suggestion": "..."
  },
  "warnings": []
}
```

Exit codes:
- `0` success
- `1` execution/internal failure
- `2` usage/validation/input failure
