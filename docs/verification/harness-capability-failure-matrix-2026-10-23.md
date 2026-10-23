# Harness capability implementation: pre-implementation failures

Status: accepted — failure cases written before production changes; applicable local scenarios passed on 2026-10-24. See the [implementation record](../process/harness-capability-implementation-2026-10-23.md) and [machine evidence](results/harness-capability-2026-10-24/index.json).

Scope: implement the [approved design](../architecture/harness-design-proposal-2026-10-23.md) on `codex/harness-capability-implementation`. Preserve Pi ownership, T1/T2, authorization, explicit skills and unknown-effect recovery.

| ID | Failure | Required outcome |
| --- | --- | --- |
| HC01 | SDK Read already paginated | Preserve exact SDK content, offset and truncation; no semantic second pass |
| HC02 | Unbounded tool text and mixed image blocks | Save exact return; deterministic head/tail with hash/range; retain ordered media and structured value |
| HC03 | Spill failure | Report incomplete delivery without fictional saved path or replaying effects |
| HC04 | Summary/partial/unknown read claims full | Typed coverage rejects that claim; legacy summaries never clear prerequisites |
| HC05 | Range reads span changed versions | Merge only identical versions; compaction invalidates current visibility |
| HC06 | Chinese discovery misses English labels, directory paging | Family/aliases, exact name and namespace remain reachable; directory never activates tools |
| HC07 | Family activated in an inner Pi loop | Next provider request contains matching schema and guidance; no extra user message required |
| HC08 | Unsupported isolation capability | Directory explains unsupported platform, never weakens isolation |
| HC09 | Late suggestions and mid-turn classifiers | User delivery policy wins; optional suggestions never delay the main request or create new inference |
| HC10 | Batch results exceed remaining context | Deterministic reservation; immutable committed views; no semantic evidence filtering |
| HC11 | T2 failure/restart | Existing recovery holds; no duplicate effects; canonical result can reproduce its view |
| HC12 | Skills after compaction | Preserve explicit selection, invalidate consumed content; no auto skill roster |
| HC13 | Prompt slimming discards workflow | Every prior workflow has an owner and discoverable path; permissions and user-only actions stay resident |
| HC14 | Auxiliary request context leaks | Independent prompt/tool state and usage; no new privileges |
| HC15 | Task verdict mistaken for acceptance | Classifier cannot close a task or manufacture artifact validation |
| HC16 | Old history/protocol | Missing coverage means unknown; existing history remains readable |

Validation: declare executable scenarios before implementation; extend the existing real Pi/Host/SQLite loopback workflow and add contract integration scenarios. Emit repeatable JSON/manifest artifacts using `verificationWorkflow`. Run applicable type, lint, docs and existing durable/harness regressions. Deterministic provider fixtures verify mechanics only. Live model quality, native cross-platform isolation and release packaging must be reported separately.

Closing coverage (workflow names match the archived manifests):

| ID | Local evidence |
| --- | --- |
| HC01 | `harness-capability` native adapter; `model-harness-pi` exact range and continuation in the next provider request |
| HC02 | `harness-capability` mixed blocks, exact spill and retained structured values |
| HC03 | `harness-capability` forced evidence-storage failure |
| HC04 | `harness-capability` derived/unknown text, shell output, literal markers and non-vision notice; `model-harness-pi` failed provider request never acknowledges reading |
| HC05 | `harness-capability` actual SDK range reads, same-hash snapshot aliases and mutation invalidation |
| HC06 | `harness-capability` canonical internal aliases, exact names, directory paging and repeat activation; `model-harness-contract` source discovery |
| HC07 | `model-harness-pi` inspect actual system/developer guidance and tool declarations after inner-loop activation and rebuild |
| HC08 | `harness-capability` Windows unsupported directory entry, never activated |
| HC09 | `harness-input-continuity` held decision, steer/queue preferences, no classifier interception, UI-only and obsolete advice |
| HC10 | `model-harness-pi` concurrent long reads with deterministic reservations and committed bounded ranges; canonical replay in `harness-capability` |
| HC11 | `durable-runtime-crash` eight T1/T2 interruption scenes; `durable-runtime-pi` real process/SQLite; `harness-capability` exact ordered replay |
| HC12 | `harness-capability` explicit selection survives invalidated delivery; `harness-input-continuity` original scope, late input and real successor creation |
| HC13 | `harness-prompt-assembly` seven scenarios including 48 full-corpus baselines; canonical family ownership and resident permissions |
| HC14 | `model-harness-pi` real utility request has an independent prompt, no main tools/history and separate durable usage; main tools survive afterward |
| HC15 | `harness-input-continuity` confident finished classification cannot close an unverified session; `harness-task-context-pi` progress 100 remains product metadata |
| HC16 | Missing typed metadata never establishes full delivery; canonical legacy fallback and new ordered blocks remain readable. Mixed-version process deployment and rollback binaries were not exercised. |

Evidence limits: these are integration and controlled E2E scenarios, not a model-quality benchmark. Handoff child creation/persistence is real; successor admission is held at the existing `sendMessage` seam, while separate Pi workflows cover inference. No remote cursor-expiry service, every possible source schema hot-change, same-name plugin skill collision, non-Windows sandbox or rolling deployment was simulated. Budget checks are conservative text estimates, not a proof for every tokenizer or media payload. Existing task-verifier parsing and unattended task policies remain unchanged; the finished-label test concerns ordinary session closure, not automatic artifact acceptance.
