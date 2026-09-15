# WhatsApp

WhatsApp is the platform most people already have open. It supports two ways of
working: a dedicated chat for the bot, or **self-chat** — using your own "Message
yourself" thread as the interface.

Self-chat is the useful one. There is no second account, no contact to add, and
the conversation is somewhere you already look.

## Connecting

Connecting opens a QR code. On your phone: **WhatsApp → Settings → Linked
devices → Link a device**, then scan.

This is a linked-device session, not a bot account. It behaves like WhatsApp Web:
your phone must have been online recently for the link to stay alive, and
unlinking from your phone disconnects it here.

## Self-chat

After connecting, open your own WhatsApp self-chat and type `/new` to start a
session, or `/pair <code>` to bind a session you started in the app.

Everything else works as it does in any other chat: the session's replies arrive
there, and `/stop` aborts a run in progress.

## What to expect

**A worker process.** WhatsApp support runs a separate Node worker. If messaging
fails to start with the rest of the app, check that the worker binary is where
the app expects it — and that Node is available on the machine.

**More fragility than Telegram.** A linked-device session can be logged out from
your phone, by WhatsApp itself, or by a period offline. When that happens the
platform reports it and needs reconnecting; the sessions and their history are
unaffected.

**Media is supported, with limits.** Images and documents come through, and long
replies are rendered into the shape the platform accepts. WhatsApp has no tables
and no rich formatting, so what you receive is a rendering of the reply rather
than the reply's source.

## Access

WhatsApp does **not** have an owner list in this build — access mode and owners
exist only on Telegram and WeCom. With self-chat that is mostly moot, since there
is nobody else in the conversation. If you connect a normal chat instead, the
platform's own contact controls are what bound who can reach the bot.

## Commands

| Command | Effect |
|---|---|
| `/new [name]` | Create a session and bind this chat |
| `/pair <code>` | Finish a pairing started in the app |
| `/unbind` | Disconnect |
| `/status` | Show the current binding |
| `/stop` | Abort the current run |
| `/help` | List the commands |

## Troubleshooting

**The QR code expires before you scan it.** Reopen the dialog for a fresh one.

**"WhatsApp logged out".** Unlink and reconnect. This is the platform expiring
the session, not a bug.

**Messages arrive but replies do not.** The phone has been offline long enough
for the link to go stale; reconnect from the dialog.

## Next steps

- [Messaging](phaneris://docs/messaging/overview) — pairing and access, in general.
- [Telegram](phaneris://docs/messaging/telegram) — the platform with topic support.
