# Phaneris (RE) documentation

This index is the only entry point to `docs/`. Everything here is reachable from this page; `bun run check:docs` enforces that, along with link validity and the status rules below.

Documents are filed by **kind and lifecycle**: `process/` holds open plans and current references, `archive/` holds landed one-off records, dated assessments and retired material. A plan that lands moves to `archive/` in the same change that records its outcome (maintenance rule 3).

| Directory | Holds |
| --- | --- |
| [`architecture/`](architecture/) | ADRs and current technical baselines |
| [`guides/`](guides/) | Current, stable reference for users and maintainers |
| [`dependencies/`](dependencies/) | Dependency audits, upgrade records, and the dependency graph |
| [`design/`](design/) | Product and feature design records |
| [`verification/`](verification/) | Pre-implementation failure matrices, acceptance procedures, and recorded results |
| [`process/`](process/) | Open plans and current references (landed records are archived) |
| [`research/`](research/) | Exploration and feasibility research |
| [`archive/`](archive/) | Landed one-off records, dated assessments and retired material; bulky media was pruned on 2026-10-13 (see the [verification index](verification/README.md#档案裁剪)) |

---

## Start here

| Document | Status | Purpose |
| --- | --- | --- |
| [Project README](../README.md) / [中文](../README.zh-CN.md) | Current | Product introduction, capabilities, screenshots, setup, and positioning. |
| [Architecture overview](architecture/overview.md) | Current baseline | Repository topology, layering, process and protocol boundaries, request path, client matrix, persistence, build, invariants, and known drift. **Start here for a structural map.** Current measurements and the next governance work are in the [2026-10-11 governance plan](process/architecture-code-governance-implementation-plan-2026-10-11.md). |
| [Electron app](../apps/electron/README.md) | Current | Desktop runtime, build, event contract, and diagnostics. |
| [Contributing](../CONTRIBUTING.md) | Current | Local setup, validation, and contribution workflow. |
| [Security](../SECURITY.md) | Current | Supported versions and private vulnerability reporting. |
| [Release readiness checklist](release-readiness.md) | **Proposed** release gate — 15 items open | Identity, recovery, signing, checksum, SBOM, and privacy items required before public binaries. |
| [CLI reference](guides/cli.md) | Current | Headless server client, commands, TLS, and scripting. |
| [Pi kernel baseline](guides/pi-kernel.md) | Current | Single-backend runtime contract, lifecycle, tool synchronization, and upgrade checks. |

| [Governance ownership inventory](process/governance-ownership-inventory-2026-10-11.md) | Accepted | All configuration ports, original SessionManager members, dependencies, cycles and presentation storage decisions. |

## Architecture

| Document | Status | Scope |
| --- | --- | --- |
| [Chat popout card failure matrix](verification/markdown-popout-card-failure-matrix-2026-10-12.md) | Written before implementation; browser verified | Restore centered cards and Markdown source mode; 18 browser scenes and archived before/after evidence. [Results](verification/results/markdown-popout-card-2026-10-12/README.md). |
| [Governance domain ownership](architecture/governance-domain-ownership.md) | Accepted | Configuration, protocol, Pi and product assembly ownership. |
| [Architecture overview](architecture/overview.md) | Current baseline | Structural map; §10 lists the known drift and tech debt without owners. |
| [Durable Agent Runtime ADR](architecture/durable-agent-runtime.md) | Accepted, implemented incrementally | Runtime Host authority, T1/T2 effects, recovery, projections. Two workstreams stay open: read-model cutover after measured parity, and automatic bounded continuation. |
| [Authentication and process lifecycle](architecture/authentication-process-lifecycle.md) | Accepted, implemented | Persistent cookie revocation scope, exact Origin/proxy trust, fail-closed storage and bounded global-failure shutdown. Native-platform limits are explicit. |
| [Durable Runtime boundary redesign](architecture/durable-runtime-boundary.md) | Implemented — B0–B5 | Runtime Kernel/Host ownership, restricted APIs, external adapters, resolved dependency gate and independent Pi/crash verification. Replaces the earlier nine-service split; evidence and coverage limits are linked from the document. |
| [Durable Runtime target architecture](architecture/durable-agent-runtime-target-architecture.md) | **Deferred** | Seven target components (batch entity, admission controller, effect registry, workspace checkpoints, fenced leases, continuation supervisor, observability). None exists in code. Activation criteria are stated in the document; each activation additionally needs an ADR, failure-injection tests, a reversible migration, and a rollback path. |
| [Session snapshot storage and bounded reads](architecture/session-snapshot-reads.md) | Accepted | Immutable snapshots, 512 KiB chunked reads, lease limits, and the compact snapshot-reference format. |
| [Capability adoption and operating conventions](architecture/capability-adoption-2026-10.md) | Accepted | What was adopted from upstream 0.14.0 and Pi 1.0.2, plus four deliberate deferrals with the evidence each needs before re-evaluation. |
| [Phase A identity freeze](architecture/phaneris-phase-a-identity-freeze.md) | Completed stage record | Frozen identity list and drift-check machinery. Namespace availability was only partly verified — unverified items are listed in-file. |
| [Phase B brand identity](architecture/phaneris-phase-b-brand-identity.md) | Completed stage record | Package, environment, and data-path renames plus the one-off user-data migration. **Does not permit external release**: services and release channels still point upstream (phase D). |

## Guides

| Document | Status | Purpose |
| --- | --- | --- |
| [CLI reference](guides/cli.md) | Current | Commands, remote connections, TLS, scripting, and validation. |
| [Pi kernel baseline](guides/pi-kernel.md) | Current | Kernel version, run chain, lifecycle constraints, tools and sources, model discovery, prompt cache. |
| [Theme authoring prompt](guides/theme-authoring-prompt.md) | Current | Copy-paste prompt encoding the 39-token field set, schema limits, and the Shiki theme whitelist. |
| [Graphite theme](guides/graphite-theme.md) | Implemented | A deliberately colourless theme: token choices, the density decision, and its verification measurements. |

## Dependencies

| Document | Status | Scope |
| --- | --- | --- |
| [Dependency relationship analysis](dependencies/dependency-graph-2026-10-06.md) | Analysis; **§8 recommendations not applied** | Internal graph, external ownership, duplication, phantom dependencies, and a quantified reduction list. |
| [Full dependency audit](dependencies/dependency-audit-2026-10-03.md) | Dated audit (2026-10-03) | Per-item version and security assessment across 186 direct controls, with evidence CSVs. |
| [September 2026 dependency upgrade](dependencies/dependency-upgrade-2026-09.md) | Point-in-time record | Direct-package versions, Python pins, and the exceptions kept. |
| [October 2026 dependency upgrade](dependencies/dependency-upgrade-2026-10-03.md) | Implemented (batches A–F) | Execution record for the audit above; §11 hands three decisions back (renderer budget, `@rollup/rollup-win32-arm64-msvc`, `scripts/fix-lockfile.cjs`). |

## Design records

| Document | Status | Scope |
| --- | --- | --- |
| [AI settings replan](design/ai-settings-replan.md) | Implemented | Connections → Conversation → Advanced structure, verified by 20 acceptance scenarios. |
| [Decision assistance and Run](design/decision-assistance-run-plan.md) | Implemented | Configuration responsibilities, session decisions, application evidence and accounting; current results in verification. |
| [Default redesign](design/default-redesign/README.md) | Implemented | The built-in Default theme (light/dark palettes, canonical JSON, static styles) with preview assets. |
| [Plugin bundles design](design/plugin-bundles-design.md) | Implemented | Aggregating skills, sources, and a prompt fragment into an Agent Plugins 1.0.0 package. |
| [Plugin bundles decision register](design/plugin-bundles-decisions.md) | 0 open / 0 REC | The decisions the plugin-bundle implementation rests on, with the alternative each rejected. |
| [Theme engine design](design/theme-engine-design.md) | Implemented | Semantic theme engine decisions and implementation history. Current fields live in [`theme.ts`](../packages/shared/src/config/theme.ts). |
| [Generated theme contract](design/theme-contract.generated.md) | Accepted / generated | Current fields, four built-ins, runtime validation and motion parity. |
| [Theme hosts and rollout](design/theme-hosts-and-rollout.md) | Accepted | Host/content ownership, visual debt and rollback boundaries. |
| [New-session hero design](design/new-session-hero-design.md) | Implemented | Design record for the empty-session landing. |
| [Profile and preferences](design/profile-preferences-plan.md) | Baseline implemented | Local profile and preferences. Summary copy, image/Markdown export, and private/public links are **not** implemented. |

## Verification

Reproducible browser and packaged-client checks live in [`scripts/verification/`](../scripts/verification/); recorded JSON results live in [`verification/results/`](verification/results/). See the [verification index](verification/README.md) for commands and platform notes.

| Document | Status | Scope |
| --- | --- | --- |
| [Theme and frontend visual audit failure matrix](verification/frontend-theme-visual-audit-failure-matrix-2026-10-12.md) | Written before audit probes; audit evidence recorded | Independent theme/CSS/interaction checks and remaining real-host E2E. [Reproduction evidence](verification/results/frontend-theme-visual-audit-2026-10-12/README.md). |
| [Theme contract failure matrix](verification/theme-contract-failure-matrix-2026-10-12.md) | Written before W2–W5 implementation | Validation, roles, domains, adapters and governance mutation gates. |
| [Governance completion failure matrix](verification/governance-completion-failure-matrix.md) | Written before implementation | G3–G8 failure cases and actual workflow acceptance. |
| [Verification index](verification/README.md) | Maintained | Commands, platform notes, and result locations. |
| [Governance first wave failure matrix](verification/governance-first-wave-failure-matrix.md) | Written before implementation; locally verified | G1 evidence isolation, CI/coverage/warning canaries, Babel type-import detection, plugin transactions and Runtime branch lifecycle. [Evidence](verification/results/governance-first-wave-2026-10-11/README.md). |
| [Governance authentication/lifecycle failure matrix](verification/governance-auth-lifecycle-failure-matrix.md) | Written before corresponding fixes; locally verified | Real process restart/logout, canonical JWT replay, Origin/proxy/body limits, fatal exits, Runtime quiesce and cleanup ownership. [Evidence](verification/results/governance-second-wave-2026-10-11/README.md). |
| [Durable Runtime boundary failure matrix](verification/durable-runtime-boundary-failure-matrix.md) | Written before implementation; coverage recorded | Independent Host/Pi execution, real T1/T2 process crashes, delivery, settlement, adapters and lifecycle. Links repeatable evidence and explicitly untested combinations. |
| [Theme and architecture gate failure matrix](verification/theme-and-architecture-gate-failure-matrix.md) | Written before implementation; coverage recorded (19 mutations) | Failure modes for the theme-declaration invariant (FA01–FA12) and the architecture gate (FB01–FB11). §1 records the pre-implementation facts, including that CI was red on `main`; §4 records what was and was not verified, and the sandbox limit on `test:doc-tools`. |
| [Dependency and declaration cleanup failure matrix](verification/dependency-declaration-cleanup-failure-matrix.md) | Written before implementation; coverage recorded | Failure modes for batch C (FC01–FC15): the local replacement for `incr-regex-package`, which declarations are genuinely dead versus peer providers, lockfile consistency, and the 26 undeclared cross-package subpaths. §4 records what was and was not verified, including that the lock's orphaned entries were **not** pruned. |
| [Bundle hygiene and event surface failure matrix](verification/bundle-hygiene-and-event-surface-failure-matrix.md) | Written before implementation; coverage recorded | Batch D (FD01–FD05): removing the playground packaging input, the `main.cjs` ratchet, and the katex evaluation. Batch E (FE01–FE04): the automation-event emitter gate. §4 records that the initial graph also shrank 89 → 71 chunks, and that the eight unemitted events stay in the vocabulary on purpose. |
| [Server security hardening failure matrix](verification/server-security-hardening-failure-matrix.md) | Written before implementation; coverage recorded | Batch F (FF01–FF13): the failure-only rate limiter, opt-in token printing, request-body ceiling, cookie rename with legacy read, and trusted-proxy peer check. §4 lists what remains open — JWT revocation persistence, Origin validation, secret rotation. |
| [Motion audit](verification/motion-audit.md) | Implemented | Coverage map, confirmed issues (M01–M16), design differences, and deferred risks (V01–V08). |
| [Motion specification](verification/motion-specification.md) | Landed as the implementation baseline | Shared motion semantics, parameters, states, and lifecycle contract. |
| [Motion validation matrix](verification/motion-validation.md) | **Partially closed** | Per-path acceptance for normal, reverse, interrupt, a11y and performance. **26 rows are pure `P`** (full-product verification outstanding) and a further 7 are partially verified with a remaining `P` — see §9 of the implementation status. |
| [Motion implementation status](verification/motion-implementation-status.md) | Implemented; §9 lists the remainder | Item-by-item status, files, and results for M01–M16, V01–V08, plus two issues found during implementation. |
| [AI settings structure](verification/ai-settings-structure.md) | Implemented | Acceptance for the Connections → Conversation → Advanced structure. |
| [Session decisions](verification/session-decisions.md) | Implemented | Session, browser and isolated Electron acceptance, scope and accounting evidence. |
| [Decision Run failure matrix](verification/decision-run-failure-matrix.md) | Written before implementation | Failure cases for session ownership, real application, costs, persistence and UI. |
| [AI settings structure failure matrix](verification/ai-settings-structure-failure-matrix.md) | Written before implementation | Failure scenarios recorded before product code changed. |
| [AI settings runtime refinement](verification/ai-settings-runtime-refinement.md) | Implemented | Default theme and script-runtime verification. |
| [AI settings runtime failure matrix](verification/ai-settings-runtime-failure-matrix.md) | Written before implementation | Acceptance conditions recorded before product code changed. |
| [Default theme application](verification/default-theme-application.md) | Implemented | Built-in Default replacement, local packaged client, macOS x64. |
| [Default theme application failure matrix](verification/default-theme-application-failure-matrix.md) | Written before implementation | Failure conditions for the built-in Default swap. |
| [Default purple sidebar](verification/default-purple-sidebar.md) | Implemented | Exact Default purple restoration and New Session surface. |
| [Default purple sidebar failure matrix](verification/default-purple-sidebar-failure-matrix.md) | Written before implementation | Acceptance conditions for the Default purple restoration. |
| [Installer skin refinement](verification/installer-skin-refinement.md) | Procedure; **no recorded result in `results/`** | Acceptance checks and native capture commands for the branded NSIS skin. |
| [UI refinement failure matrix](verification/ui-refinement-failure-matrix.md) | Written before implementation | Scope and failure conditions for the Twilight/Gantt/installer work. |

## Process — plans (not finished)

| Document | Status | What remains |
| --- | --- | --- |
| [Theme engine and frontend visual governance plan](process/theme-engine-frontend-governance-plan-2026-10-12.md) | **In progress; W1 browser verified** | F01/F02/F03 and reconnect recovery implemented with 101 browser scenes. [W1 evidence](verification/results/theme-foundation-w1-2026-10-12/README.md). W2–W5 closeout and native release matrices remain open; popout-card restoration is retained (F20). |
| [Product development directions](process/product-development-directions-2026-09-19.md) | Discussion draft; partial | Removing the allow-all fallback and the completion-rate metric are outstanding; other directions not started. |
| [Agentic interception design](process/agentic-interception-design.md) | Design settled; **implementation not started** | First slice is `tool_call` blocking. Records three live defects: agentic automations execute no action, docs advertise a no-op, and 8 of 13 events have no emitter. |
| [Calendar and Gantt optimization plan](process/calendar-gantt-optimization-plan.md) | Phase 0 done; phases 1–3 open | Roughly 10–16 person-days. `GanttView` is still read-only. |
| [Phaneris fork plan](process/phaneris-fork-plan.md) | In progress | Phases C–F pending. **Phase D blocks public release** (release/update channel, trademark). |
| [Plugin system review and roadmap](process/plugin-system-review-and-roadmap.md) | Historical phased plan; G2a residuals locally verified | Three P0s shipped in `c89614a5`; this wave fixes pre-commit backup recovery, post-commit cleanup, credential timing and stale derived index reads. F04/F06, the remaining F07 validation surface, F10 and Phase E remain open; F08 stays deferred. See the governance ledger. |

## Process — records (landed)

| Document | Status |
| --- | --- |
| [Architecture and code governance implementation plan](process/architecture-code-governance-implementation-plan-2026-10-11.md) | **G0–G8 implemented locally**; historical baseline and acceptance rules, with external platform limits in the completion ledger. |
| [Architecture and code governance completion](process/governance-completion-2026-10-11.md) | **Implemented; local acceptance and explicit external limits**. Config/protocol/dependency/Pi/Session/client/distribution owners, real fault fixes, regression and evidence. |
| [Governance G3–G8 evidence](verification/results/governance-completion-2026-10-11/README.md) | **Pre-audit snapshot**. Original manifests, explicit archive selection and standalone SHA verification; preserved as historical evidence. |
| [Governance audit closeout evidence](verification/results/governance-closeout-2026-10-11/README.md) | **Locally verified**. Audit fixes, 235 workflow scenes, full regression, three unchanged-budget performance runs and standalone archive/source verification. |
| [Bundled in-app docs build record](process/phaneris-local-docs.md) | T2 pipeline and T3 content (46/46 pages) done |
| [Artifact files and native image generation](process/artifact-files-native-image-generation-plan.md) | Current implementation baseline |

## Process — dated assessments

| Document | Date | Scope |
| --- | --- | --- |
| [Pi SDK 1.0.2 upgrade and convergence](process/pi-sdk-1.0.2-upgrade-and-convergence-assessment.md) | 2026-10-04 | Three default paths are **not** switched (native MCP, native classifier, virtual-model routing); the first-nav budget (3,119 ms vs 3,000 ms) is still open. |
| [Pi SDK native capabilities gap analysis](process/pi-sdk-native-capabilities-gap-analysis.md) | 2026-09-20 | Capability gaps for Pi 0.86.0; revalidate against current code. |
| [System prompt per-turn analysis](process/system-prompt-per-turn-analysis.md) | 2026-09 | S/A recommendations; the opposite choice was later made deliberately. Treat as revisitable, not backlog. |

## Research

| Document | Status | Scope |
| --- | --- | --- |
| [GPUIX profile](research/gpuix-profile.md) | Research annex (2026-09-11) | Source-level evidence for the migration assessment. |
| [gpui-kit profile](research/gpui-kit-profile.md) | Research annex (2026-09-12) | Source-level evidence. |
| [GPUI ecosystem and gaps](research/gpui-ecosystem-and-gaps.md) | Research annex (2026-09-12) | Six conditional spikes, none run. |
| [Renderer capability inventory](research/craft-renderer-inventory.md) | Research annex | Raw measurements and per-file motion candidates. |
| [Memory system design](research/memory-system-design.md) | Research placeholder — no approved architecture | Survey of 13 agent-memory projects, an 11-way comparison, and 7 ecosystem commonalities usable as design constraints. |
| [Cross-ecosystem plugin porting](research/cross-ecosystem-plugin-porting-assessment.md) | Exploratory; partially absorbed | Batch B's design landed in the plugin-bundles work; the rest stays exploratory. |
| [Unreal Agent design analysis](research/unreal-agent-design-analysis.md) | Research (external project) | What `unreallabsai/unreal-agent` does about consistency under retries and long tool calls; no Phaneris plan. |

## Archive — superseded or retired

These preserve decisions and evidence. Their paths, line numbers, versions, and gap lists may describe the repository at the date recorded rather than today.

| Document | Why archived |
| --- | --- |
| [Original code audit](archive/code-audit-2026-08-01.md) | Historical snapshot. **~26 findings still marked OPEN** and require revalidation against current code. |
| [Right-panel audit](archive/right-panel-audit-report.md) | Superseded by later Workbench and Run redesigns; its P2 list is explicitly not a backlog. |
| [Trajectory vs VanDSH comparison](archive/trajectory-vs-vandsh-comparison.md) | Superseded by the current Overview / Trajectory / Context / Map Run workspace. One item remains open: `pi-agent-server` has no `text_start` marker, so TTFT and decode-time metrics are missing. |
| [Univer and Workbench integration plan](archive/univer-native-workbench-integration-plan.md) | Univer was retired on 2026-08-30 with no migrator. The Artifact/Workbench foundation it describes is still valid; only the Univer chapters are dead. |
| [Native Design Layer](archive/native-design-layer-architecture-plan.md) | Deferred archive (96–148 engineering weeks estimated); not an implementation baseline. |
| [Pi SDK 1.1.0 and upstream 0.14.1 plan](archive/pi-sdk-1.1.0-upstream-0.14.1-plan.md) | 已归档（2026-10-13）：**Implemented and verified on Windows** — Approved scope, frozen baselines, adoption decisions and deliberate deferrals. |
| [Pi 1.1.0 / Craft 0.14.1 implementation](archive/pi-sdk-1.1.0-upstream-0.14.1-implementation.md) | 已归档（2026-10-13）：Complete; performance scope is limited — B0–B5 results, 6,289 passing tests, final package evidence, same-drive smoke, earlier failures and reproduction commands. |
| [Pi 1.1.0 implementation failure matrix](archive/pi-110-implementation-failure-matrix.md) | 已归档（2026-10-13）：Written before implementation — Failure conditions and acceptance boundaries for B0–B5. |
| [Pi 1.1.0 / Craft 0.14.1 handoff](archive/pi-sdk-1.1.0-upstream-0.14.1-handoff.md) | 已归档（2026-10-13）：Historical checkpoint — B0–B3 completed; B4/B5 continuation details recorded before work resumed. |
| [Governance first wave ledger](archive/governance-first-wave-2026-10-11.md) | 已归档（2026-10-13）：Historical G0/G1/G2a acceptance snapshot — Original source adjudication and evidence; current execution results are in the completion ledger. |
| [Governance second wave ledger](archive/governance-second-wave-2026-10-11.md) | 已归档（2026-10-13）：Historical G2b/G2c acceptance snapshot — Cookie/Origin/cleanup evidence at that wave; later native acceptance is in the completion ledger. |
| [System cleanup and optimization plan](archive/system-cleanup-optimization-plan-2026-10-10.md) | 已归档（2026-10-13）：Batches **A–H implemented**; G continued through governance G3/G5 — The landed cleanup and its corrected findings are recorded in §7–8. Batch G's config/storage and Pi entry boundaries were implemented through G3/G5 in the governance completion; the existing automation vocabulary and deliberately deferred security/rendering work remain explicitly limited. |
| [Workstream sequencing](archive/workstream-sequencing-2026-10-06.md) | 已归档（2026-10-13）：Dated sequencing record; step 5 superseded by implemented boundary; step 1 since landed — Original six-step plan and decisions. The Runtime boundary implementation replaces its nine-service / pure-move approach; its step 1 race is fixed (see the system cleanup plan §2.6), its remaining ownership cuts were continued in governance G3–G7, with deliberate deferrals recorded in the completion ledger. |
| [Project assessment and roadmap](archive/project-assessment-and-roadmap-2026-08-31.md) | 已归档（2026-10-13）：Historical roadmap; governance continued through G0–G8 — Feature ideas retain their original deferrals; current architecture and code ownership adjudication is in the completion ledger. |
| [Upstream 0.13.4 absorption](archive/upstream-0.13.4-absorption.md) | 已归档（2026-10-13）：Implemented; item 6 deliberately not adopted |
| [Upstream 0.13.5–0.13.6 absorption](archive/upstream-0.13.5-0.13.6-absorption.md) | 已归档（2026-10-13）：Implemented (batches B0–B5) |
| [Upstream 0.14.0 absorption](archive/upstream-0.14.0-absorption.md) | 已归档（2026-10-13）：Implemented; delivery is now in `main` (verified 2026-10-06) |
| [Upstream 0.14.0 B4–B5](archive/upstream-0.14.0-b4-b5.md) | 已归档（2026-10-13）：Implemented; delivery is now in `main` (verified 2026-10-06) |
| [Upstream 0.14.0 bridge cleanup](archive/upstream-0.14.0-bridge-cleanup.md) | 已归档（2026-10-13）：Applied |
| [Capability integration](archive/capability-integration-2026-10-03.md) | 已归档（2026-10-13）：First mechanism batch; superseded by the completion record |
| [Capability completion](archive/capability-completion-2026-10-04.md) | 已归档（2026-10-13）：Seven work packages closed; full migration deliberately deferred |
| [Calendar and Gantt implementation status](archive/calendar-gantt-implementation-status.md) | 已归档（2026-10-13）：Implemented; §4 records that two of three P3 gate items have since landed |
| [Performance optimization plan](archive/performance-optimization-plan-2026-09-01.md) | 已归档（2026-10-13）：Implemented (first round) |
| [Performance implementation](archive/performance-implementation-2026-09-10.md) | 已归档（2026-10-13）：Implemented; `main.cjs` remains above the 15 MB target |
| [Repository cleanup](archive/repository-cleanup-2026-09-27.md) | 已归档（2026-10-13）：Executed |
| [Durable runtime implementation handoff](archive/craftagent-durable-runtime-handoff.md) | 已归档（2026-10-13）：Historical handoff; superseded operationally by the accepted ADR |
| [Native file preview implementation](archive/native-file-preview-implementation.md) | 已归档（2026-10-13）：Implemented on `codex/native-file-preview` |
| [Project deep analysis](archive/Phaneris_Project_Deep_Analysis.md) | 已归档（2026-10-13）：2026-10-04 — Whole-project assessment and roadmap (§21). Not an owned plan; some findings have since been fixed. |
| [Upstream 0.14.0 assessment](archive/upstream-0.14.0-assessment.md) | 已归档（2026-10-13）：2026-10-03 — Pre-approval snapshot; batches B1–B5 have since landed. |
| [Calendar/Gantt library replacement](archive/calendar-gantt-library-replacement-assessment.md) | 已归档（2026-10-13）：2026-09 — Calendar replaced (FullCalendar); Gantt deferred with stated triggers. |
| [Pi SDK 1.0.0 upgrade assessment](archive/pi-sdk-1.0.0-upgrade-assessment.md) | 已归档（2026-10-13）：2026-09-21 — Upgrade snapshot. P1 items are now in code; P2/P3 remain open. |
| [GPUIX / gpui-kit migration assessment](research/native-frontend-migration-gpuix-assessment.md) | 已归档（2026-10-13）：Exploratory; no route adopted — ProseMirror/Tiptap is an isolated lazy chunk and the dev-only playground production input has been removed. A language-neutral RPC schema remains deferred to contract governance. See the [system cleanup plan](archive/system-cleanup-optimization-plan-2026-10-10.md) §2.3. |

## Release history

- Versioned user-visible history lives in [`apps/electron/resources/release-notes/`](../apps/electron/resources/release-notes/).
- The unreleased changelog is [`next.md`](../apps/electron/resources/release-notes/next.md).
- Release notes are immutable history after release; do not rewrite older entries to match current architecture.

## Documentation maintenance rules

1. Current guides describe observable behavior, not the development story that produced it.
2. Architecture documents must declare one of: `proposed`, `accepted`, `deferred`, `superseded`, or `historical` — on an explicit `Status:` line. `bun run check:docs` enforces this.
3. A completed plan is a decision record: it moves to `archive/` with an archival note and a status that points to the current source of truth. **Documents are filed by kind and lifecycle** — `process/` keeps open plans and living references; `archive/` keeps landed one-off records, dated assessments and retired material. Media inside archived evidence is pruned rather than kept as galleries (see the [verification index](verification/README.md#档案裁剪)).
4. User-visible changes update `release-notes/next.md` in the same change.
5. README screenshots live in `docs/assets/readme/`; use descriptive filenames and remove superseded assets rather than accumulating galleries.

### The gate

`bun run check:docs` (wired into `validate:ci`) fails on:

- a relative link that does not resolve, or a machine-specific absolute path (`E:/…`, `/Users/…`);
- an architecture document without a rule-2 `Status:` line;
- a document not reachable from this index (directly, or through a subdirectory README).

Fix current documents. A missing frozen artifact may only use an [exact source/target SHA exception](../scripts/doc-artifact-exceptions.json) with owner and recovery condition; the warning remains visible and does not certify the missing evidence. Newly broken links still fail.
