# Source activation settlement regression

Written before implementation. Scope: the source-test restart, late model settlement,
and the visibility of a failed automatic resend. Existing workspace changes are retained.

## Observed evidence

Read-only inspection of session `261016-steady-glade` found this sequence in the
workspace Runtime ledger (2026-10-16, Asia/Shanghai):

| Time | Event | Sequence |
| --- | --- | --- |
| 10:30:53.147 | `source_test` outcome committed | 148167 |
| 10:30:53.210 | next model dispatch committed | 148169 |
| 10:30:53.214 | run parked as an unsettled model request | 148170 |
| 10:30:53.233 | that model's `aborted` outcome and usage committed | 148171–148172 |
| 10:30:53.488 | SDK `agent_settled`, aborted | 148174 |
| 11:38:27.487 | interrupted terminal record, after restart | 149669 |

The 19 ms late outcome restores the durable checkpoint, but the foreground slot
retains its cached blocked result. The automatic retry claims its deduplication
slot before checking recovery and its rejection only reaches the log.

## Failure matrix

| ID | Failure mode / boundary | Required result |
| --- | --- | --- |
| A01 | Activation races a dispatched provider request; delay its real T2 beyond 100 ms | No restart event or terminal settlement until T2 and subprocess stop acknowledgement; one hidden resend; new source tool works |
| A02 | Parallel source tests complete in the same tool batch | All sibling results retained; one restart; no unsettled tools |
| A03 | Cancellation happens before the next provider call | Known cancellation can settle; no invented provider completion |
| A04 | Automatic resend races a legacy duplicate | One hidden input; attachments and steering context retained |
| R01 | A stopped run parks, then receives its real model T2 | Next send refreshes recovery and succeeds without application restart |
| R02 | Provider outcome remains absent | New input stays blocked; no automatic abandon or fabricated usage |
| R03 | A sibling tool effect remains unknown after model T2 | New input stays blocked; no replay of an unknown effect |
| E01 | Automatic resend rejects | Persist and broadcast a visible localized error; clear failed dedup slot |
| E02 | Pi exits before stop acknowledgement | Bounded visible failure; no automatic resend |
| E03 | Stop acknowledgement never arrives | Bounded visible failure; pending waiter cleaned up; no automatic resend |
| E04 | User explicitly stops while activation is draining | Stop wins; do not schedule activation resend |

## Verification

Use `bun run scripts/verification/source-activation-settlement-workflow.ts` after
`bun run server:build:subprocess`. The workflow uses an isolated config/workspace,
real Pi subprocess, real SQLite, real source-test/API proxy tools and loopback
inference. It writes a manifest, assertions and event evidence to its output
directory. Provider timing and transport fault injection are explicit in evidence.
No production session files or database are modified.
