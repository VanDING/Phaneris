# Architecture implementation record

Status: accepted

The reviewed baseline is `555ddd7822577e7299f7b84a642311faa39a1abe`.
The original audit and the two independent implementation ledgers are local,
Git-ignored evidence at `E:\Phaneris\.verify\architecture-audit-2026-11-14`.
The ledgers track all 13 issues and all 126 areas, including unchanged areas.
Implementation and the first review of all 126 areas have been carried out.
The local ledger records the exact reviewed revision, subsequent fixes, final
validation results and platform limits.

Completed local batches cover workspace images, task publication preflight,
privileged command/permission integrity, request workspace scope, gateway
persistence, transfer retry ownership, recoverable imports, duplicate bridges
and rules, Viewer decoding, the work-item deletion result, resident metadata,
source credential selection, Pages mutations, client request exchange, the
published Copilot compatibility path, unused component parameters, Host input
intent/provenance, workspace planning commands, task publication/recovery and
typed RPC registration. Real production editor flows cover response loss, adopted
draft run refusal and subsequent editing without a second card.
Further batches cover assistant writer races, retryable project removal with live
cache consistency, and WebSocket shutdown without retained reconnect timers.

Compatibility decisions confirmed by the project owner:

- Bound connections search, mark read, and consume task output in their current
  workspace. Unbound explicit targets, explicit import and global summaries remain.
- New imports remain readable and searchable but cannot establish direct-user
  assertions or new management authority. Existing local history/memory remain readable.
- Legacy sources missing `authType` keep their different Pages/session credential
  lookup policies. Neither gains a new authentication header; explicit `none` wins.
- Only the seven reviewed private duplicate/forwarding files were deleted.

Published compatibility surfaces remain: the old resident GET/SET bridge returns
complete history and snapshots; calendar deletion clears scheduling; public UI
`isPending`, `CopyButton.label`, the tree helper and Island markers are retained.
The restored Copilot subpath preserves its old callbacks and read-only model
discovery. Product login continues using the native Pi SDK.

Repeatable new workflows under `scripts/verification` write source identities,
scenario results and hashed artifacts. Their output paths and before/after failures
are linked from the local implementation ledger. At this checkpoint full type
checking and lint pass; Electron main/preload and production WebUI build pass.
Native macOS approval, other-platform filesystem semantics, external accounts,
signed installers and the complete client-version matrix remain unverified.
The standalone server assembly script rejects Windows explicitly; its smoke-suite
failure is retained in the evidence, not counted as a successful server build.

Broader list/mention/preview workflows and cold-start navigation now have browser
evidence. The project-wide review also found and fixed shared temporary-file
corruption, cold-load edit ordering, remaining fixture callers and documentation
registration. Its inventory and per-area decisions include all unchanged areas.
Backend implementation now continues in `E:\Phaneris-architecture-impl`, on
`codex/architecture-implementation`; the original workspace and its frontend branch
remain independent. The ignored evidence still lives at the original absolute path. No aggregate pass rate is computed from overlapping suites.
