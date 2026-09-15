# Interactions

Most of the time you type and the agent works. Occasionally it needs something
from you before it can continue — permission to act, a secret it cannot invent, or
your agreement to a plan. Those moments are **interactions**, and they replace the
composer until you answer.

They are the mechanism that makes unattended work safe to allow: the agent stops
at the boundary instead of guessing.

## The three kinds

### Permission requests

The agent wants to do something the current mode does not permit silently —
usually a write, a command, or a network call in **Ask to Edit**. You get the
specific action, not a generic "allow?", and you approve or deny it.

Approving is per-action. Nothing is remembered by default, so approving one edit
does not pre-approve the next. If you find yourself approving the same thing
repeatedly, that is the signal to change the mode or widen a rule in
Settings → Permissions — not to keep clicking.

A denied request is not an error the agent retries. It is told no, and it should
adjust. If it keeps asking for the same denied thing, the instruction was
ambiguous rather than the permission being wrong.

### Credential requests

The agent needs a secret — an API token, a password, an OAuth consent. It raises
a **secure input** rather than a chat message, and what you type goes into the
encrypted credential vault, not into the transcript.

This is deliberate: a secret typed into the conversation would be in the session
file, in every subsequent prompt, and in any transcript you later look at. The
credential prompt exists so that never happens.

The agent can tell you *which* credential it needs and why. It cannot read the
value back.

### Plan submission

In **Explore** or **Ask to Edit**, substantial work often starts with a plan. The
agent writes it as a document and stops. You then choose:

| Action | Effect |
|---|---|
| **Accept** | Approves the plan and lets the agent proceed. |
| **Accept & send follow-ups** | Approves it with your annotations attached as additional instructions. |

On the plan document you can annotate specific passages before accepting. That is
the useful path: rather than explaining in prose which part you disagree with,
you mark it, and the agent receives your comments attached to the exact lines
they concern.

Once a plan is accepted, the session typically moves to the mode that lets the
work happen. That transition is worth watching — it is the moment autonomy
increases.

## Where they appear

In the app, in the session that raised them. A permission prompt from a session
you reached over [messaging](phaneris://docs/messaging/overview) still surfaces
here rather than in the chat, which means an unattended session in Ask to Edit
simply waits for you.

That is a feature with a cost: if you expect work to continue while you are away,
either run that session in Execute or expect to come back and answer prompts.

## Answering well

**Read the action, not the label.** A permission request names the exact command
or path. "Allow write?" and "allow this `rm -rf` in this directory" are very
different questions that both render as a button.

**Deny and explain.** If you deny, say why in one line. The agent carries that
into its next attempt, which is usually enough to get a proposal you will accept.

**Do not treat approval as a mode change.** Repeatedly approving is the slow way
to do what changing the mode does directly — and it hides how much autonomy you
have actually granted.

## Next steps

- [Permissions](phaneris://docs/core-concepts/permissions) — the modes these interactions sit on top of.
- [Conversations](phaneris://docs/core-concepts/conversations) — the transcript every interaction is recorded in.
