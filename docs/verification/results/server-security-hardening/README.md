# Server security hardening — evidence

Baseline commit: `61970997` (with batches A–D uncommitted on top).
Date: 2026-10-11.

Requirements: [server security hardening failure matrix](../../server-security-hardening-failure-matrix.md).
Plan: [system cleanup and optimization plan](../../../process/system-cleanup-optimization-plan-2026-10-10.md) batch F.

## What changed

| Issue | Fix | File |
| --- | --- | --- |
| 21 unauthenticated `POST /api/auth` per minute returned 429 to **everyone**, and success consumed the same budget | `check(ip)` split into `canAttempt` (read-only) / `recordFailure` / `recordSuccess`; only failures consume budget, and the decision happens before `verifyPassword` | `packages/server-core/src/webui/auth.ts`, `webui/http-server.ts` |
| Server token printed to stdout on every start | Opt-in via `PHANERIS_PRINT_SERVER_TOKEN=1` | `packages/server/src/index.ts`, `apps/electron/src/main/index.ts` |
| Unauthenticated routes buffered request bodies with no ceiling | 256 KB ceiling: rejected on the declared length before reading, and enforced *while* reading in the adapter so a chunked request cannot bypass it | `webui/http-server.ts`, `webui/node-adapter.ts` |
| Session cookie still named after the upstream product | Renamed to `phaneris_session`; the old name is still **accepted on read** so the rename does not sign everyone out | `webui/auth.ts` |
| `trustedProxies` trusted forwarded headers whenever the list was non-empty | Forwarded headers are honoured only when the direct peer is itself trusted | `webui/http-server.ts` |
| Dead CLI branch implying a dependency on the echoed token | Removed; the CLI injects the token into the child environment | `apps/cli/src/server-spawner.ts` |

## Files here

| File | Contents |
| --- | --- |
| `webui-auth.log` | `http-server.isolated.ts` — 15 pass, 0 fail (9 pre-existing + 6 new) |
| `critical.log` | `test:critical` run for this batch |
| `README.md` | This file |

## The new regressions

| ID | Assertion |
| --- | --- |
| FF01 | The first five wrong passwords are 401, the next are 429, and a *correct* password is then refused as 429 — never as 401 |
| FF02 | 30 consecutive successful logins all return 200: success never consumes budget |
| FF09 | A cookie under the pre-rename name `craft_session` still authenticates |
| FF10 | With no trusted proxy, forging `X-Forwarded-For` does not buy a fresh budget |
| FF11 | With a trusted direct peer, the forwarded address is used |
| FF07 | A 300 KB body to `/api/auth` returns 413 |

## Reproduce

```sh
cd packages/server-core && bun test ./src/webui/__tests__/http-server.isolated.ts
bun run test:critical
PHANERIS_PRINT_SERVER_TOKEN=1 bun run server:start   # token visible only with the flag
```

## Coverage limits

- Everything here is verified against a locally started server on loopback, not a
  network-exposed deployment. No exploitation was attempted; the findings were
  code-level and the fixes are asserted behaviourally.
- The global failure cap still exists and still blocks everyone once tripped — that is
  its purpose as the backstop for a trusted-proxy deployment where per-IP keys can be
  spoofed. It now counts only failures, so ordinary traffic and successful logins cannot
  trip it, but a sustained failed-login flood can still throttle legitimate users. That
  trade-off is inherent to a global cap and is left in place deliberately.
- `Trusted proxy` is unreachable in-tree today (nothing sets the option); the fix makes it
  correct for whoever enables it, and FF10/FF11 cover both directions.
- Origin validation on the WebSocket upgrade and JWT revocation persistence were in the
  audit's list and are **not** addressed here; JWT revocation remains in-process, so a
  restart within 24h revives a replayed cookie.
- Secret rotation and cookie `__Host-` prefixing are not implemented.
- `validate:ci` passes in full, including `test:doc-tools`.
