# Preferences

Preferences are the small set of facts about you that the agent is told at the
start of a conversation: your name, your timezone, where you are, and anything
you want it to know. They are what makes a reply say "this afternoon" instead of
"15:00 UTC" and sign off in your language.

```
~/.phaneris/preferences.json
```

## What is stored

| Field | Used for |
|---|---|
| `name` | How the agent addresses you |
| `timezone` | Interpreting and phrasing times — deadlines, schedules, "tomorrow" |
| `location` | Locale-aware context: holidays, units, regional conventions |
| `notes` | Free text the agent reads on every turn |
| `diffViewer` | Display only: `unified` or `split`, and whether changed lines get a background tint |
| `avatar` | A local image for the UI. **Never** included in the agent prompt. |
| `uiLanguage` | Internal. Mirrors Appearance → Language and is written only by that control. |

Not everything here is prompt material. The avatar is a UI convenience and stays
out of the model's context entirely; the diff viewer settings are pure display
preferences.

## Notes are the useful part

`notes` is the only free-form field, and it is the one worth spending time on. It
is included in the agent's context on every turn, so it is the right place for
things that are true about you in general:

- How you like answers: *"Prefer prose over bullet lists unless I ask for a list."*
- Standing context: *"I maintain the `billing` service; `ledger` is legacy."*
- Conventions: *"Dates in writing are ISO. In code, follow the repository."*
- Things to stop doing: *"Don't add summary sections to documents I didn't ask you to summarise."*

### What not to put there

**Anything that changes.** A note saying "this week I'm working on X" is wrong by
next week and the agent has no way to know. Put that in the conversation.

**Secrets.** Notes are stored in plain JSON, not the encrypted vault, and they go
into every prompt. A token here is a token in every request.

**Long procedures.** A multi-step workflow belongs in a [skill](phaneris://docs/skills/overview),
which is loaded only when it is invoked. Notes are paid for on every single turn.

## Editing

Settings → Preferences is the normal path, and the agent can also update
preferences when you tell it something durable about yourself in conversation —
that is the intended way for this file to grow.

`uiLanguage` is the exception: the Appearance → Language control is its only
writer, and the agent cannot set it. Language affects date and number formatting
throughout the UI, so it has exactly one owner.

## Next steps

- [Skills](phaneris://docs/skills/overview) — for instructions that should load only sometimes.
- [Themes](phaneris://docs/customisation/themes) — appearance, including the language control.
