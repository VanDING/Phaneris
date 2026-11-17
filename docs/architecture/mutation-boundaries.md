# Mutation acknowledgement and recovery

Status: accepted

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
artifact hashes. Task publication uses the recovery boundary described below.

Resident identity and settings use metadata intents. They never load the product
timeline or request a message snapshot. A setting is serialized by the existing
product write queue, atomically replaces the JSONL header, and only then updates
Host state and emits the metadata event. Encoded message rows are streamed without
decoding; this still requires copying the file body. Renderer metadata updates
preserve loaded messages and their independent load marker. Unknown header counts
remain unknown. The legacy assistant GET/SET bridge methods continue reading the
complete snapshot, including diagnostic fields, for existing clients.


## Task publication

`getWorkspaceTaskPublisher(workspaceId)` owns fresh creation, explicit attachment,
optional draft adoption, slug allocation, planning preflight and setup. RPC parses
YAML and supplies a target; Agent tools supply capture intent and their invoking
project. Production callers do not save a spec separately or pass `save:false`.
The previously exported creation/setup helpers keep their compatibility contracts.

Each attempt records versioned facts under `tasks/.publications`. The record binds
its spec digest, target, prepared planning, original live/header values and receipt.
A data-free SQLite transaction holds only this workspace's publication lock through
the existing Bun/Electron adapter. It does not lock the execution database. Process
exit releases the OS lock without stale PID reclamation.

Fresh Session headers carry a Host-owned `taskPublicationId`; RPC creation options
cannot set it and imports remove it. Recovery locates that identity even if the
caller died before receiving the new Session. Startup resumes pending records;
changed spec bytes or conflicting target values are retained and reported rather
than overwritten. Live defaults and actual header values have separate baselines.
Already-complete retries do not reapply metadata changed by a later user edit.

The normal client sends one operation ID per intent, and a durable Agent tool uses
its existing tool operation ID. Legacy requests without an ID reuse matching
pending/completed receipts while their spec is still current. Changed intent cannot
reuse an explicit ID. Legacy nullable task fields remain accepted on the wire.
The editor retains a committed request after a run refusal; editing that task keeps
its original slug and Session while assigning the changed intent a new ID.

Label/source problems remain warnings. A later source selection is retained during
recovery. A successful publication waits for queued product writes before recording
its completion receipt; the editor displays setup warnings after closing.

## Input and planning

The Host receives a `SessionInputIntent` and trusted `InputOrigin`. Callers choose
`accepted` after durable receipt or `finished` after execution. RPC no longer owns
a separate acknowledgement/error state machine. Imports, automations, tasks and
runtime continuations retain their sources; a new management grant requires an
explicit direct-user origin. Existing local history remains readable evidence.

Workspace planning reads one Session snapshot and validates the complete edit before
changing title, project, status, column or schedule. Internal edits exclude derived
conversation IDs. Null clears optional scalar values and omission retains them.
The old calendar projection keeps its titles/long previews and deletion clears only
the schedule; work-item deletion removes the Session and has a void result port.

## Project removal and writer lifetime

`getWorkspaceProjects(workspaceId).remove(slug)` releases Session and Page references
before deleting the project. Each durable release updates Host metadata and emits
its change; a later failure retains the project for retry. Sessions created outside
the running Host are included. A queued conditional header edit preserves a different
external project assignment and synchronizes the cached value without loading history.
The shared storage helpers remain available to offline and external callers.
Missing-project removal still returns void. A failed final notification cannot turn
an already committed deletion into an RPC failure.

Assistant service writers and task publication use the same small runtime OS-lease
primitive with distinct resource files. The assistant retains its legacy PID/nonce
lease for older Hosts and archives stale ownership evidence only under the OS lease.
Invalid or unknown-version evidence is retained. Closing the service or losing the
process releases the SQLite lock; transient locks are excluded from workspace backups.
Bun and Node interoperability is verified with real local subprocesses.

WS shutdown still invokes disconnect callbacks and rejects pending requests, but late
close events do not recreate reconnect buffers or their retention timers.

Complete Session snapshot reads queue per RPC client until their read lease closes.
Rapid navigation and foreground consumers share this boundary rather than duplicating
server-budget knowledge. Different clients progress independently; decoding, request
failure and disconnect release the next reader. The server's existing read limits and
the complete-history legacy fallback remain intact.

Initial navigation restoration waits for both ordinary metadata and resident identity.
The latest explicit navigation queued during that wait takes precedence over the
default assistant presentation. Ordinary auto-selection does not close an assistant
opened earlier in the same commit. Explicit deep links keep their previous behavior.

Product snapshots and header edits open exclusive temporary files under the Session's
existing export-excluded `tmp/` directory. Independent queue owners cannot overwrite
each other's in-progress transcript. Failed attempts retain their private evidence;
the prior complete snapshot remains intact. Local queue order remains authoritative;
independent Hosts do not share a metadata transaction. Cold readers share the exact
loading promise through completion so a later status edit cannot overtake an earlier
edit merely because synchronous hydration already set the loaded flag.
