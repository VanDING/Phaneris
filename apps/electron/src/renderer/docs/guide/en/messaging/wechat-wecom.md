# WeChat and WeCom

Two platforms, two audiences. **WeChat** is the consumer app and connects by QR
code. **WeCom** (企业微信) is the organisation product, and it is the stronger of
the two integrations — it is one of only two platforms here with a real access
model.

They are separate integrations: connecting one does not connect the other.

## WeChat

Connect by scanning a QR code from the phone. Like WhatsApp, this is a
device-style link rather than a bot account: it behaves as a session of yours,
and it can be invalidated by the platform or from the phone.

The session state is persisted under the app's configuration directory, which is
what lets a restart resume rather than asking you to scan again.

**Use it for:** reaching your own agent from the app you already have open.

**Expect the weakest access model of the five.** WeChat has no owner list here,
so nothing in the app bounds who can reach it. Use it for personal access only,
not for anything a team depends on.

## WeCom

WeCom connects as an **intelligent bot** over a long connection. You supply:

| Field | Notes |
|---|---|
| **Bot ID** | From the WeCom admin console |
| **Secret** | The bot's secret |
| **WebSocket URL** | Optional; must be `wss://` if you set it |

Two things distinguish it:

**It has a real access model.** WeCom is one of only two platforms where access
mode and owner lists are available — the other is Telegram. You can lock it to
named owners, unlock it, and approve or reject unknown senders from the app.

**Only one long connection per bot.** WeCom allows a single active connection for
a given Bot ID, and the app enforces that: connecting the same bot from a second
workspace is rejected rather than silently stealing the connection. If a bot
stops responding, check whether another instance has claimed it.

**Use it for:** a team-visible assistant in an environment where the organisation
administers the account.

**Scope beyond messaging is separate.** Documents, drive, calendar, and mail are
not part of this integration — they need the official WeCom CLI or MCP installed
and configured as a [source](phaneris://docs/sources/overview). The messaging bot
is messaging only.

## What is the same

Pairing commands are shared across every platform:

| Command | Effect |
|---|---|
| `/new [name]` | Create a session and bind this chat |
| `/pair <code>` | Finish a pairing started in the app |
| `/unbind` | Disconnect |
| `/status` | Show the current binding |
| `/stop` | Abort the current run |
| `/help` | List the commands |

Long replies are rendered into each platform's own format. Neither supports
tables well, so tabular output reaches you as text. In WeCom group chats, a
leading `@BotName` on your message is stripped before the agent sees it, so you
can address the bot the way the platform expects.

## Choosing between them

**Personal use:** WeChat, if it is the app you live in — accepting that it has no
access controls.

**Anything shared:** WeCom. It has an account model an organisation administers
and the only real access controls outside Telegram.

**If either is optional:** Telegram remains the most capable platform here — it
is the only one with workspace supergroups and forum topics, which is what lets a
single connection carry several streams of work. See
[Telegram](phaneris://docs/messaging/telegram).

## Troubleshooting

**WeChat disconnects after a while.** The session expired — reconnect by
scanning again. Keeping the phone online reduces how often this happens.

**"Bot ID is already connected".** Another workspace, or another running
instance, holds the single WeCom connection. Disconnect it there first.

**WeCom is silent.** Check the bot's permissions in the admin console: it needs
to be able to receive messages in the conversation, not just be a member of it.
A malformed credential set reports itself — the Bot ID and Secret are both
required, and a `ws://` URL is refused.

**Messages send but nothing comes back.** For both platforms this is usually a
receiving-permission problem rather than a sending one.

## Next steps

- [Messaging](phaneris://docs/messaging/overview) — the shared model.
- [Telegram](phaneris://docs/messaging/telegram) — the most capable platform.
- [Sources](phaneris://docs/sources/overview) — adding WeCom's non-messaging capabilities.
