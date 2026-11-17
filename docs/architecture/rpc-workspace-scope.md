# Session and task RPC workspace scope

Status: accepted

The server token grants access to the server. A client's claimed workspace is
the current routing scope, not an account authorization boundary. Unbound legacy
clients retain explicit workspace access. Changing that deployment model requires
server-owned authorization, rather than trusting a handshake field.

| Operation | Scope and compatibility |
| --- | --- |
| `sessions:get` | Current connection/window workspace; unbound legacy clients retain the existing aggregate listing. |
| `sessions:getUnreadSummary` | Global summary; intentionally includes all managed workspaces. |
| `sessions:searchContent`, `sessions:markAllRead` | Current connection/window workspace. Legacy positional workspace arguments remain accepted but must agree with a bound scope. Unbound clients may supply an explicit target. |
| `tasks:getOutput` | Output's indexed session owns the workspace. Check the expected connection/window scope before reading a file or consuming the result. Unbound clients retain access by task ID. |
| Session commands and reads taking a session ID | Existing session ownership check against the claimed workspace, plus session ID validation; unbound clients retain existing access. Includes message/history/recovery reads, reconciliation, send/delete/cancel, kill shell, permission/credential/question responses, file watches, notes, commands, plan and permission-mode state. |
| `sessions:export`, `sessions:exportRemoteTransfer` | Existing session ownership check and current workspace context required by export. |
| `sessions:create` | Explicit target workspace, retained for existing callers. |
| `sessions:import`, `sessions:importRemoteTransfer` | Explicit target workspace. Cross-workspace import is an intentional operation and remains available from a bound connection. Chunked import uses the same handler. |
| `sessions:unwatchFiles` | Calling client's own subscription, independent of current workspace. |
| `tasks:validate` | Pure validation; no workspace resource read or write. |
| `tasks:create`, `tasks:generate`, `tasks:run`, `tasks:pause`, `tasks:resume`, `tasks:stop`, `tasks:get`, `tasks:list`, `tasks:getResults` | Explicit workspace as currently shipped. Publication additionally validates referenced cards/drafts against the target workspace before writing a specification. These commands are not account isolation controls. |

`workspace-scope-workflow.ts` exercises authenticated A/B and unbound clients,
rejection without consuming output or unread state, owner retrieval, global
summary, explicit cross-workspace import and connection workspace switching.
`task-publish-boundary-workflow.ts` covers target ownership and precommit failure.
