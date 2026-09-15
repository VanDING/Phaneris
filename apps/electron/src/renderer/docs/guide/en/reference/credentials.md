# Credentials

Every secret Phaneris stores — provider keys, source tokens, OAuth tokens,
messaging bot credentials — lives in one encrypted vault:

```
~/.phaneris/
  credentials.enc     the encrypted vault
  credentials.key     the key that unlocks it
```

Neither file is human-readable, and neither is meant to be edited. They are
written only through the app's credential paths, which is why there is no
"import a key file" flow.

## Why there are two files

`credentials.enc` is encrypted with a key in `credentials.key`, and that key is
itself protected by the operating system — DPAPI on Windows, Keychain on macOS,
libsecret on Linux. The app asks the OS to unwrap it at startup and keeps the
plaintext in memory for the session.

The important consequence: **the key is protected on behalf of the application
that created it, not on behalf of your user account alone.** On Windows the blob
is bound to the writing executable through Chromium's app-bound encryption, so a
different binary cannot unwrap it even on the same machine and the same account.

## What that means for moving a profile

Copying `~/.phaneris/` to another machine, or carrying it across a rename or a
re-signing of the app, **does not carry the credentials across**. The vault comes
along; the ability to open it does not.

Phaneris does not try to hide this or work around it:

- The migration tooling **deliberately excludes** both files. Copying them would
  guarantee that the new app can never unwrap the key — and, worse, can never
  create a fresh one, because the failing file is already there. That exact
  failure is what made a renamed build start with no window at all before it was
  understood.
- On first launch with no key, a new one is created and the vault starts empty.
  Every connection and source is still configured; each one needs its secret
  re-entered once.

Budget for re-authorizing once after a move. It is not a bug, and there is no
supported way around it short of not moving.

## How secrets are used

- **Credential prompts** in a conversation write straight into the vault. The
  value never enters the transcript — the agent can tell you *which* credential it
  needs, and cannot read it back.
- **Sources** reference a credential by name; the secret is attached at request
  time. Source `config.json` files are safe to read, copy, and inspect because
  they contain no secrets.
- **OAuth tokens** are refreshed automatically where the provider supports it, and
  the refreshed token is written back to the vault. A source that worked last
  month and fails today is usually a token that was revoked upstream rather than
  a storage problem.

## Rotating and revoking

Removing a connection or a source removes its credential from the vault. Deleting
the vault files outright is the blunt version: everything needs re-authorizing,
including things you had forgotten were configured.

If you believe a secret has leaked, revoke it at the provider first — that is the
only step that actually invalidates it. Deleting it locally changes what this app
can do, not what the secret can.

## Next steps

- [LLM connections](phaneris://docs/reference/llm-connections) — the credentials most people configure first.
- [Sources](phaneris://docs/sources/overview) — where the rest come from.
