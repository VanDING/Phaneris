# Telegram

Telegram is the most capable of the supported platforms, and the one to pick if
you are choosing. It supports a workspace-level **supergroup**, and forum topics
inside it, which is what makes messaging usable for more than one stream of work
at a time.

## Connecting

1. Create a bot with **@BotFather** and copy its token.
2. In the app, open a session's connect-messaging menu and choose Telegram.
3. Paste the token. The app connects and shows a pairing code.
4. Send `/pair <code>` to the bot from the chat you want to bind.

The code is single-use and rate-limited, so a wrong guess costs the guesser
budget rather than being free to retry.

## Two levels of pairing

This is the part that differs from the other platforms:

**A chat binds to a session.** That is the simple case: one conversation, one
chat.

**A supergroup binds to the workspace.** Pair a supergroup and the workspace can
route sessions into **forum topics** within it — one topic per stream of work,
each with its own session.

To do the second, pair the supergroup itself. Pairing it registers it at the
workspace level rather than binding a single session.

## Topics and automations

Once a supergroup is paired, an automation can declare a topic to route the
sessions it spawns into. Without that, automated sessions land wherever the last
message went, and a busy supergroup becomes unreadable.

This is the setup worth building if you want messaging to be more than a remote
control: one group, a topic per recurring job, each with its own session and its
own history.

## Commands

| Command | Effect |
|---|---|
| `/new [name]` | Create a session and bind this chat to it |
| `/bind` | List recent sessions; bind one by id or index |
| `/pair <code>` | Finish a pairing |
| `/unbind` | Disconnect this chat |
| `/status` | Show the current binding |
| `/stop` | Abort the current run |
| `/help` | List the commands |

## Access

Telegram bots are discoverable. Keep the platform in **owner-only** mode unless
you have a reason not to: with `open`, anyone who finds the bot can start a
session on your machine. Messages from people who are not owners are recorded as
pending rather than silently dropped, and you approve or reject them from the
app.

## Troubleshooting

**The bot does not respond.** Check the token has not been revoked in BotFather,
and that the platform is enabled for the workspace.

**`/pair` says the code is invalid.** Codes expire. Generate a new one from the
app rather than retrying the old one — repeated attempts consume the rate-limit
budget.

**A supergroup pairing did not stick.** The bot must be an administrator in the
group for topic management to work.

## Next steps

- [Messaging](phaneris://docs/messaging/overview) — the shared model: pairing, access, and limits.
- [Automations](phaneris://docs/automations/overview) — routing spawned sessions into topics.
