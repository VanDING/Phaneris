# LLM Connections

An **LLM connection** is how Phaneris reaches a model. You can have several, and a
session picks one; the choice lives in the session, so different conversations can
run on different models.

## One runtime, many providers

Every connection runs on the same backend. What differs is **which provider
account** it authenticates as:

- **A known provider** — you sign in or paste a key for a service the app knows
  (Anthropic, OpenAI, GitHub Copilot, Google, OpenRouter, DeepSeek, Groq,
  Cerebras, Z.ai, Kimi, MiniMax, Mistral, Bedrock, Azure, Hugging Face, Vercel,
  Ollama, and others). The app knows the endpoints, the model catalogue, and the
  brand mark for each.
- **Your own endpoint** — any OpenAI-compatible or Anthropic-compatible API. You
  supply the base URL, the key, and the model ids. See
  [Custom endpoints](phaneris://docs/reference/custom-endpoint).

A connection that names a provider gets its model list from that provider's
catalogue; a custom endpoint gets the list you give it. Nothing is inferred about
an unknown endpoint — an unrecognised brand shows a neutral mark, and a model it
does not know is not assumed to support anything.

## Authentication

| Kind | Use it for |
|---|---|
| **API key** | Most providers. One field. |
| **API key + endpoint** | A compatible API at a URL you choose |
| **OAuth** | Signing in with a provider account rather than a key — including subscription plans such as ChatGPT Plus/Pro and GitHub Copilot |
| **Bearer token** | Services that use an `Authorization: Bearer` header rather than a key header |
| **IAM credentials** | AWS-style access key, secret, and region (Bedrock) |
| **Service account file** | A GCP JSON key file (Vertex) |
| **Environment** | Pick credentials up from the process environment |
| **None** | Local models — Ollama, a self-hosted server |

Secrets go into the encrypted credential vault, never into `config.json`. See
[Credentials](phaneris://docs/reference/credentials).

## Mid-stream messages

While the agent is working, you can still type. What happens next is per
connection:

- **Steer** — your message is injected into the turn already running, and the
  agent adjusts course. The default for Pi-backed connections.
- **Queue** — the running turn finishes first, then your message is replayed as
  the next turn. The default for Anthropic connections, where steering mid-stream
  would interrupt and restart work in progress.

Neither is wrong; they suit different work. Steering is faster for corrections
("no, the other file"), queueing is safer for long tool runs you do not want
interrupted.

## Model list

Each connection keeps its own list of models and a default. That list is synced
from the provider, and you can restrict it — a connection configured with three
models gives you a three-item model picker rather than the provider's whole
catalogue, which is usually what you want when a provider ships forty.

The default model is chosen from the connection's list, and new sessions use the
workspace's default connection unless you pick another.

## Utility model

Small jobs — generating a session title, classifying something — run on a
*utility* model rather than the one you are talking to. This is deliberate: paying
frontier-model rates to name a conversation is waste. The utility model is
resolved from the connection, and changes to it do not disturb the running
conversation.

## Where connections are stored

`~/.phaneris/config.json` holds the connection definitions — provider, model list,
defaults. Their secrets live in the vault. Because of that split, copying
`config.json` between machines moves the *shape* of your setup but not the ability
to use it; see [Credentials](phaneris://docs/reference/credentials) for why that
is not something the app can paper over.

## Troubleshooting

**"Connection failed" on a key that worked before.** Keys expire and get revoked.
Re-enter it.

**Models missing from the picker.** The list is per connection — refresh it in
Settings → AI, or check that the connection's model list was not restricted.

**A model works in one session but not another.** The session is pinned to its
connection; switching the connection applies to that session only.

## Next steps

- [Custom endpoints](phaneris://docs/reference/custom-endpoint) — pointing at your own API.
- [Credentials](phaneris://docs/reference/credentials) — where the secrets actually live.
- [App settings](phaneris://docs/reference/config-file) — the rest of `config.json`.
