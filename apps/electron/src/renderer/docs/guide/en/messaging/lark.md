# Lark / Feishu

Lark and Feishu are the same product in two deployments, and connecting is
almost identical — you choose which one, then supply the application's
credentials.

## Connecting

You need a **custom app** in the Lark or Feishu developer console:

1. Create an app and note its **App ID** and **App Secret**.
2. Grant it the messaging permissions it needs — at minimum, receiving messages
   and sending them.
3. In the app, choose Lark or Feishu and paste the two values.

Picking the wrong deployment is the most common failure: they are separate
services with separate credentials, and an app created on one will not
authenticate against the other.

## Getting messages to the bot

Unlike Telegram, where the bot finds your chat, Lark/Feishu apps receive events
through the platform's event subscription. Depending on your setup that means
either a long-connection (websocket) subscription, which needs no public
address, or a webhook, which does.

If you are running Phaneris on a machine you reach from elsewhere, the
long-connection mode is the one to use — it avoids exposing anything.

## Commands

The same command set as the other platforms:

| Command | Effect |
|---|---|
| `/new [name]` | Create a session and bind this chat |
| `/pair <code>` | Finish a pairing started in the app |
| `/unbind` | Disconnect |
| `/status` | Show the current binding |
| `/stop` | Abort the current run |
| `/help` | List the commands |

Replies are rendered using Lark's rich-post format, which is noticeably richer
than WhatsApp — headings, links, and emphasis survive.

## Access

Lark/Feishu does **not** have an owner list in this build — access mode and
owners are only available on Telegram and WeCom. Anyone the app can receive from
is someone who can reach the agent, so control it in the Lark developer console
by scoping which conversations the app is installed in.

That is worth being deliberate about. An app in a shared organisation workspace
can be messaged by anyone in that organisation, which is a much wider audience
than you may expect when you test it alone.

## Troubleshooting

**"Invalid app credentials".** Check the App ID belongs to the deployment you
selected. Copying an ID from Feishu into a Lark configuration is the usual cause.

**The bot receives nothing.** The event subscription is the problem, not the
credentials — the app can send while being unable to receive. Verify the
subscription is enabled and, if you chose webhook mode, that the URL is reachable
from the platform.

**Messages send but commands are ignored.** The app needs permission to read
message content, which is a separate scope from sending.

## Next steps

- [Messaging](phaneris://docs/messaging/overview) — pairing and access, in general.
- [WeChat and WeCom](phaneris://docs/messaging/wechat-wecom) — the other two platforms.
