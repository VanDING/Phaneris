Pi interruption and message delivery repair — failure matrix (written before implementation)

Scope: message admission receipts, known late proxy results, model-only interruption recovery, and persistent unexpected-child-exit diagnostics. Project context and compression policy are excluded.

| Scenario | Required behavior / failure to prevent |
|---|---|
| Idle target takes longer than the caller's tool deadline | Return after the input is durably admitted; do not wait for target completion. |
| Busy target | Persist the input before returning queued; retain existing steer/queue semantics. |
| Caller repeats the same durable delivery identity | Return the original receipt; no duplicate user input or target run. Reject reuse with different message content. |
| Target missing, blocked by unknown tool, or persistence fails | Reject before claiming successful delivery. |
| Context handoff forwards to a successor | Preserve the original receipt boundary and the existing whole-turn wait contract. |
| Existing sendMessage callers / task execution | Continue waiting for whole-turn completion; do not silently change their contract. |
| Target fails after successful admission | Keep delivery successful, report target execution failure independently; no unhandled rejected promises. |
| Proxy invocation cancelled, host later returns an actual result | Commit known T2 using the original durable identity even if the child no longer awaits it. Never turn an AbortError into definite failure. |
| Old child/turn settles after a replacement exists | Persist only against the original run/tool identity; do not send its response to a new child. |
| Host restart loses a send tool result after durable target admission | Reconcile from the target's exact operation-linked receipt before admitting a new turn. Missing or ambiguous legacy receipts must remain blocked. |
| Model stream child exits without T2, no unknown tools | Preserve explicit interruption/reconciliation and unknown billing, allow a subsequent new user input, never replay the interrupted request. |
| Restart with an already parked model-only run | Same recovery policy after reopening SQLite. |
| Model and unknown external tool coexist | Keep the session blocked; model recovery cannot waive an unknown tool effect. |
| Read-only reliability projection | Do not report an abandoned model as pending forever; unknown cost remains unknown. |
| Unexpected child exit | Persist bounded, credential-redacted stderr and PID/code/signal/runtime/last-request metadata; capture final stderr at stream close. |
| Expected shutdown / diagnostic-write failure | Do not emit false crash evidence on expected shutdown; a diagnostic-write failure must not suppress cleanup. |

Verification: real SessionManager admission/persistence, real SQLite/Runtime Host, real Pi subprocess and local streamed inference, plus controlled child termination. Produce a manifest with checksummed artifacts under .cache/verification. Existing crash/recovery/runtime-boundary workflows remain regression gates. Original user session databases are not test fixtures.
