# Auto-Apply Rules

An auto-apply rule watches your messages for a pattern and applies a label with
the value it captured. Say `CRA-123` in a message and the session acquires
`linear-issue::CRA-123` without you tagging anything.

This is the feature that decides whether a label set survives. A label you apply
by hand every time is a label you stop applying within a month.

## What a rule looks like

Rules live on the label they apply, in
`~/.phaneris/workspaces/{id}/labels/config.json`:

```json
{
  "id": "linear-issue",
  "name": "Linear Issue",
  "valueType": "string",
  "autoRules": [
    {
      "pattern": "linear\\.app/[\\w-]+/issue/([A-Z]+-\\d+)",
      "valueTemplate": "$1",
      "description": "Matches Linear issue URLs"
    },
    {
      "pattern": "\\b([A-Z]{2,5}-\\d+)\\b",
      "valueTemplate": "$1",
      "description": "Matches bare issue keys like CRA-123"
    }
  ]
}
```

| Property | Meaning |
|---|---|
| `pattern` | **Required.** A JavaScript regular expression with capture groups. |
| `flags` | Defaults to `gi`; the `g` flag is always enforced, so every occurrence is found. |
| `valueTemplate` | Builds the value from captures — `$1`, `$2`, or something like `$1#$2`. Omit it and the first capture group is used. |
| `description` | For your own benefit when reading the config later. |

Multiple rules on one label are all evaluated, and all matches are collected.

## When rules run

- **On messages you send** — both fresh and queued ones.
- **Never on the agent's output** or on tool results. A rule that matched a model
  quoting an issue key would tag sessions for reasons you did not cause.
- **After code is stripped.** Fenced blocks and inline code are removed first, so
  a rule does not fire on an example in a snippet you pasted.

Matching is deduplicated per label and value, and capped at **ten matches per
message** — a defensive limit that stops one pasted log file from applying
hundreds of labels.

Patterns are validated when the configuration is saved: an invalid regex, or one
that looks like a catastrophic-backtracking risk, is rejected rather than
accepted and then misbehaving at runtime.

## Typed values

Captures are normalized to the label's `valueType`:

| Type | Capture | Stored as |
|---|---|---|
| `string` | `CRA-123` | `CRA-123` |
| `number` | `$45,000` | `45000` |
| `number` | `1.5M` | `1500000` |
| `number` | `50k` | `50000` |
| `date` | `2026-01-30` | `2026-01-30` |

The number normalization is what makes a money or volume label worth having:
without it, `$45,000` and `45000` are different values and neither sorts.

## Writing rules that stay quiet

**Anchor on something distinctive.** `\b([A-Z]{2,5}-\d+)\b` is a good pattern
because a key that shape is almost always an issue key. `(\d+)` is a bad one
because it matches every number you will ever type.

**Prefer a URL form plus a bare form.** The URL rule fires when you paste a link;
the bare-key rule fires when you refer to it from memory.

**Give every rule a description.** Reading a config of five regexes six months
later, the descriptions are the only part that explains intent.

**Watch the first week.** Auto-applied labels are visible on the session. If a
rule is producing noise, delete it then — a rule you keep meaning to fix is
costing you attention every day.

## Next steps

- [Labels](phaneris://docs/labels/overview) — hierarchies, typed values, and how many to have.
- [Automations](phaneris://docs/automations/overview) — reacting to a label being applied.
