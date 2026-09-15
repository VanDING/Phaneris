# Custom Endpoints

A custom endpoint connection points Phaneris at any API that speaks the OpenAI
Chat Completions protocol or the Anthropic Messages protocol. Ollama, vLLM,
DashScope, a self-hosted gateway, a relay, a corporate proxy in front of a hosted
model — anything compatible.

Use it when the service has no built-in provider entry, or when you reach a
provider through a URL of your own.

## What you supply

| Field | Notes |
|---|---|
| **Base URL** | Where the API lives, e.g. `https://api.example.com/v1` |
| **Protocol** | `openai-completions` or `anthropic-messages` — which streaming adapter to use |
| **API key** | Or none, for a local server |
| **Model ids** | The exact ids the endpoint accepts |

Everything is explicit by design. The app does not guess a custom endpoint's
capabilities from its URL: an unrecognised host gets a neutral brand mark, and a
model it has never heard of is not assumed to support images or extended
thinking.

## Protocol, not brand

The protocol field describes **how to talk to the endpoint**, not whose model is
behind it. A DeepSeek model served through an OpenAI-compatible relay uses the
OpenAI protocol; that says nothing about the model's brand, and the app keeps the
two separate. Pick the protocol the endpoint actually implements — if requests
hang or return unparseable streams, this is the first thing to check.

## Model capabilities

For a model the app knows, capabilities come from its catalogue entry. For one it
does not, they come from what you declare:

- **Image input** is an explicit per-model setting. An endpoint-level default
  applies to its models, and a per-model override wins — including overriding a
  global "supports images" back to *no* for the one model that cannot take them.
- **Thinking levels** offered in the picker are filtered to what the model claims
  to support.

Getting these wrong is not fatal but is visible: a model told it accepts images
will be sent them and will fail, and a model that supports thinking but is not
declared as such will not offer the setting.

## Things that need a new connection

Some settings cannot be changed inside a running conversation. Provider, auth
kind, and slug are part of how the backend process was started, so changing them
restarts it; model, base URL, and the model list can be changed in place. If a
setting appears not to take effect on the current session, start a new one rather
than re-saving.

## Troubleshooting

**404 on every call.** Base URL and path are joined. A base URL that already ends
in `/v1` combined with an API path that adds `/v1` produces `/v1/v1`.

**"Stream ended without finish_reason".** The endpoint's streaming format does
not match the protocol you selected, or it is emitting tool-call deltas in a
shape the SDK does not merge. Try the other protocol; if it is a relay, check
whether it rewrites the stream.

**The model answers but tools never fire.** The endpoint is returning
tool-calling payloads in a form the adapter does not recognise. Some relays need
a compatibility flag on their side.

**Images fail on one model.** Declare `supportsImages: false` for that model
rather than turning it off for the whole endpoint.

## Next steps

- [LLM connections](phaneris://docs/reference/llm-connections) — connections to known providers, and mid-stream behaviour.
- [Credentials](phaneris://docs/reference/credentials) — where the key is stored.
- [Network proxy](phaneris://docs/reference/network-proxy) — if the endpoint is only reachable through a proxy.
