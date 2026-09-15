# Network Proxy

If your machine reaches the internet through a proxy, Phaneris needs to know —
otherwise model requests and source calls fail with connection errors that look
like the service is down.

Settings → Network holds the configuration:

| Field | Meaning |
|---|---|
| **Enabled** | Whether the proxy settings apply at all |
| **HTTP proxy** | Proxy for `http://` requests |
| **HTTPS proxy** | Proxy for `https://` requests — the one that matters for model APIs |
| **No proxy** | Comma-separated hosts that must be reached directly |

## What goes through it

Everything the app makes a network request for: model API calls, source
requests, favicon lookups, and the OAuth flows. One setting, rather than a
per-feature configuration that drifts.

Your `noProxy` list is the part worth thinking about. Put local addresses and
anything on your own network there — a `localhost` Ollama server, an internal
API, a self-hosted model. Without it, requests to a local service are sent to the
proxy, which cannot reach it, and the error will look like the local service is
broken.

`localhost`, `127.0.0.1`, and `::1` are the entries people forget.

## Where it is stored

`~/.phaneris/config.json`, as a `networkProxy` object with `enabled`, `httpProxy`,
`httpsProxy`, and `noProxy`. See
[App settings](phaneris://docs/reference/config-file).

## Corporate proxies

Two things commonly need more than a URL:

**Authentication.** A proxy that requires credentials usually accepts them
inline in the URL (`http://user:pass@proxy.example.com:8080`). Those credentials
end up in `config.json` in plain text — that file is not the credential vault. If
that matters for your environment, use a proxy that authenticates by network
position or client certificate instead.

**TLS interception.** A proxy that terminates and re-signs TLS traffic will make
every model API call fail certificate validation. The fix is to trust the
organisation's CA at the OS level, not to disable verification — the app does not
offer a way to skip certificate checks, deliberately.

## Troubleshooting

**Everything fails after enabling the proxy.** Check the scheme. An `https://`
proxy URL and an `http://` proxy URL are not interchangeable; most proxies are
addressed as `http://proxy.example.com:8080` even when they proxy HTTPS traffic.

**The proxy works for the browser but not the app.** Browsers often read system
proxy settings automatically; this app reads its own configuration. Set it here
rather than assuming it is inherited.

**Only local services break.** Add them to `noProxy`.

## Next steps

- [App settings](phaneris://docs/reference/config-file) — the rest of the configuration file.
- [Environment variables](phaneris://docs/reference/environment-variables) — the settings that only exist as environment variables.
