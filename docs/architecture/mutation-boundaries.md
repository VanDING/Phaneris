# Mutation acknowledgement and recovery

## Permissions

Ask classification and the privileged approval broker share the exact simple-command
policy in `@phaneris/shared/agent/privileged-command`. Supported administrator
operations are Homebrew cask install/upgrade and `installer -pkg … -target /`.
Compound commands, redirection, expansion and unsupported operands cannot receive
that capability. macOS wraps parsed, shell-quoted arguments rather than raw input.

The Host checks the permission request's session before consuming it. The broker
also verifies session, command hash and expiry. A response is successful only when
the live provider confirms delivery; an unknown or already-consumed request returns
false. Legacy providers returning void remain source-compatible but cannot confirm
delivery. The existing four-argument RPC remains available; optional remembering
accepts integer minutes from 1 to the existing 60-minute maximum. Remembered admin
approval is stored only after successful delivery and is scoped by session/hash.

## Workspace images

RPC handlers resolve the workspace, then call a resource-owned read/write operation.
Paths must remain within the workspace after resolving links, including dangling
ancestors. Conversion finishes before publication. The destination is rechecked
after asynchronous processing, and a uniquely created file is published in the
same directory. Rejected content does not remove the previous icon. Only a root
`icon.*` replacement cleans other known root image formats; nested thumbnails do
not clean root icons. Missing optional images return null.

The Windows workflow covers directory junctions and replacement during conversion.
POSIX links and native macOS processing require their platforms. Portable Node path
operations do not claim handle-relative isolation from an arbitrary local process
racing individual filesystem syscalls.

## Messaging settings

Binding/config stores compute a candidate snapshot, atomically write it, then publish
memory and notify observers. Failed writes propagate to RPC without changing the
committed snapshot. Returned objects are independent snapshots. Binding IDs, creation
times, channel/thread fields and JSON migration rules remain unchanged.

Workspace lockdown commits all affected open bindings to `inherit` once, then writes
the platform policy. If the first commit fails, the platform remains unchanged. If
the second fails, the error reports the effective platform policy and the completed
binding step. An identical retry completes the remaining step. Each successful store
commit emits one settings notification; observer failure is logged after commit.

## Remote session transfer

The desktop submits workspace, bundle, mode and progress to `importSessionRemotely`.
The transport owns encoding, size threshold, chunking and chunk retries. Existing
wire strings and fields are unchanged.

Each chunk index reserves its decoded byte count and content hash before writing.
Identical replays share the write acknowledgement; conflicting replays fail. A failed
write releases its reservation. Commit takes exclusive ownership before reading and
awaits pending chunk writes. Concurrent/repeated commits share the same result,
retained for the existing transfer TTL. Abort and expiry cannot remove a running
commit. Two explicitly started transfers remain two independent operations.

The dispatch guarantee is limited to a live server process and a retained transfer
ID. The old fork protocol has no durable request ID across restarts. Missing final
confirmation is reported as unconfirmed and never triggers an automatic second fork.
File/SQLite import recovery is a separate domain responsibility.

Repeatable workflows are in `scripts/verification`: `permission-boundary`,
`workspace-image`, `workspace-scope`, `messaging-persistence`, `transfer-retry`, and
`task-publish-boundary`. Each workflow writes a source identity, scenario results and
artifact hashes. Task publication currently has precommit target/date protection;
its complete multi-store publication/recovery migration remains pending.

Resident identity and settings use metadata intents. They never load the product
timeline or request a message snapshot. A setting is serialized by the existing
product write queue, atomically replaces the JSONL header, and only then updates
Host state and emits the metadata event. Encoded message rows are streamed without
decoding; this still requires copying the file body. Renderer metadata updates
preserve loaded messages and their independent load marker. Unknown header counts
remain unknown. The legacy assistant GET/SET bridge methods continue reading the
complete snapshot, including diagnostic fields, for existing clients.
