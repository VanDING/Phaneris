# Session snapshot storage and bounded reads

Session message reads keep the complete `Session` contract used by Chat, Map and Trajectory. The transport no longer requires the complete session to fit in one WebSocket envelope.

- `sessions:readMessages(sessionId, cursor?)` captures an immutable snapshot on the first call. Later calls pull up to 512 KiB of UTF-8 JSONL bytes using the returned read ID and offset. Binary RPC encoding keeps each envelope below the existing 16 MiB limit, even for a single message larger than that limit.
- The first record contains session metadata and the message count. Following records contain messages. The client validates offsets, lengths, UTF-8 and message count, expands snapshot references, and publishes only the complete result.
- Read leases belong to one client, workspace and session. They expire after 120 seconds of inactivity and close on completion, read failure or client disconnect. Limits are two reads per client, sixteen globally, 512 MiB per compact snapshot and 1 GiB of total reserved snapshot bytes. Temporary files use owner-only permissions. Process crashes can leave temporary files in the OS temp directory.
- This bounds transport messages, not the complete frontend history. Oversized snapshots fail explicitly; there is no silent truncation. Ordinary oversized RPC replies return `PAYLOAD_TOO_LARGE` without closing a healthy connection. Queue pressure protections remain in place.

## Snapshot references

Both synchronous JSONL writes and the persistence queue use a stream-local dictionary for `promptSnapshot` and `contextSnapshot.tools`. The first occurrence stays inline with a versioned `__craftSnapshotRefs` marker; subsequent identical values carry only references. SHA-256 keys include the snapshot kind. Changing prompts or tool definitions create new entries. Other message and context fields remain intact.

The decoder accepts existing full records and the compact format, restores all public fields, and shares duplicate tool arrays. Missing, conflicting or unsupported references fail the read instead of silently dropping evidence. Existing portable session paths still expand when a session moves.

Existing session files are not bulk-migrated. They become compact on their next normal atomic save. Old application binaries do not understand compact references; use this version to read or export newly saved sessions. The legacy RPC response remains expanded for older clients, subject to its size limit. New clients fall back to that RPC only when connected to an older server without the bounded-read channel.

During a multi-chunk read, renderer hydration merges historical messages with newer live messages by ID, including when the active turn finishes before loading completes.
