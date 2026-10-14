# Credentials

Provider keys, source tokens, OAuth tokens and messaging bot credentials managed
by Phaneris use its encrypted vault under the configured profile directory:

```
~/.phaneris/
  credentials.enc     the encrypted vault
  credentials.key     a protected key, when the configured provider uses one
```

Use the app's credential prompts and connection settings to manage these files.
Do not edit or publish them. Plugins, external tools and providers can maintain
their own credentials outside this vault.

## Why there are two files

The desktop can install an Electron `safeStorage` key provider: the vault key
is then protected by the available operating-system backend. The exact
protection depends on that backend and host identity; safeStorage does not
imply Chromium app-bound encryption on every installation.

Headless deployments can supply a high-entropy `PHANERIS_CREDENTIAL_KEY`
(16–64 bytes, hex or base64). Compatibility environments without an installed
provider can use machine-id derivation, with different recovery and protection
properties. A protected key that cannot be unlocked is preserved and the error
is reported; it must not be silently replaced.

## What that means for moving a profile

Copying the encrypted files alone does not guarantee access on a new machine,
account or installation. Recovery depends on the original key provider and
whether it can still unlock that vault.

The workspace backup command does not include global credentials or the key
provider. Profile migration tools can intentionally omit these files. Plan to
re-authorize connections after a move, or use the deployment's supported key
recovery procedure. Keep the original profile until recovery is verified.

## How secrets are used

- **Credential prompts** in a conversation write straight into the vault. The
  value never enters the transcript — the agent can tell you *which* credential it
  needs. A secret entered into an ordinary chat message instead can become part
  of its transcript, so use the dedicated credential prompt.
- **Sources** reference a credential by name; the secret is attached at request
  time. Prefer credential references over literal secrets in configuration.
  Inspect source configs, plugin environment values and headers before sharing:
  manually entered values can still contain sensitive data.
- **OAuth tokens** are refreshed automatically where the provider supports it, and
  the refreshed token is written back to the vault. Authentication failures can
  also require renewed consent or repair of the host's key provider.

## Rotating and revoking

Use the relevant connection or source controls to remove stored credentials.
Do not delete vault files as a troubleshooting shortcut: losing the vault or its
key can require re-authorizing every stored connection.

If you believe a secret has leaked, revoke it at the provider first — that is the
only step that actually invalidates it. Deleting it locally changes what this app
can do, not what the secret can.

## Next steps

- [LLM connections](phaneris://docs/reference/llm-connections) — the credentials most people configure first.
- [Sources](phaneris://docs/sources/overview) — where the rest come from.
