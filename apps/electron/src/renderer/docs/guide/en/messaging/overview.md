# Messaging

Messaging connects a session to a chat platform, so you can talk to your agent
from your phone instead of from the app. The conversation is the same one: a
message you send from Telegram lands in the session's transcript, and the agent's
reply arrives in the chat.

Five platforms are supported:

| Platform | Notes |
|---|---|
| **Telegram** | The most capable. Supports a workspace supergroup, and routing automations into forum topics. |
| **WhatsApp** | Includes a self-chat mode, so you can use your own "Message yourself" thread as the interface. |
| **Lark / Feishu** | Pick the domain (`lark` or `feishu`) when you connect; the two deployments are separate. |
| **WeChat** | Connect by QR code. |
| **WeCom** | WeCom (企业微信) bots, for organisation accounts. |

## Pairing

There are two directions, and both end in the same place — a chat channel bound
to a session.

**From the chat:** send `/pair <code>` with the code the app shows you. The app
generates a short-lived six-digit code when you start pairing from a session.

**From the app:** start pairing from a session, then send the code from the chat.
The code is single-use and rate-limited, so a wrong guess costs the guesser
budget rather than being free to retry.

Once bound, the available commands are:

| Command | Effect |
|---|---|
| `/new [name]` | Create a session and bind this chat to it |
| `/bind` | List recent sessions and bind one by id or index |
| `/pair <code>` | Finish a session-initiated pairing |
| `/unbind` | Disconnect this chat |
| `/status` | Show the current binding |
| `/stop` | Abort the current run |
| `/help` | List the commands |

## Who may talk to your agent

A messaging bot is reachable by anyone who finds it, so access is controlled
explicitly — **but only on Telegram and WeCom.** On those two platforms a
workspace has:

- **Access mode** — `owner-only` (only listed owners) or `open`.
- **Owners** — the accounts allowed to use the bot.
- **Pending senders** — someone who messages the bot without being an owner is
  recorded as pending rather than silently ignored. You approve or reject them
  from the app; approving adds them as an owner.

WhatsApp, WeChat, and Lark/Feishu do not expose an owner list in this build. That
makes *who else can reach the bot* a question you answer in the platform's own
console, not here. If that matters — and in a shared workspace it usually does —
prefer Telegram or WeCom.

Keep the setting at `owner-only` unless you have a reason not to. With `open`,
anyone who can find the bot can start a session on your machine.

## Telegram supergroups and topics

A workspace can pair a Telegram supergroup. Sessions bound in that group get one
forum topic each, and an automation can declare a `telegramTopic` so the sessions
it spawns land in a predictable topic rather than wherever the last message went.

This is the setup that makes messaging genuinely useful for more than one thing
at a time: one group, one topic per stream of work, each with its own session.

## Practical notes

**Messaging does not bypass permissions.** A session reached from chat still runs
in the permission mode it has in the app. A prompt that needs approval surfaces
in the app, not in the chat — which is deliberate, but means an unattended
`Ask to Edit` session will simply wait.

**Long output is summarised for the platform.** Chat platforms have message
limits and no tables; what you get in the chat is a rendering of the reply, not
the raw transcript.

**Disconnecting is per channel.** `/unbind` affects the chat it is sent from. The
session and its history are untouched.

## Next steps

- [Automations](phaneris://docs/automations/overview) — spawn sessions into a chat, on a schedule.
- [Permissions](phaneris://docs/core-concepts/permissions) — what an unattended session may do.
