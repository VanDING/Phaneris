# Phaneris (RE) documentation

This index is the only entry point to `docs/`. Everything here is reachable from this page; `bun run check:docs` enforces that, along with link validity and the status rules below.

Documents are filed by **kind and lifecycle**. The [implementation value register](process/implementation-value-register-2026-10-13.md) is the sole current record of implementation decisions and status: R01–R07 and the approved G01–G08 project governance are implemented and locally verified, with explicit verification limits, five evidence-triggered conditions and fifteen public-release gates retained. L01/L02 have local Windows evidence; other release targets remain unverified. `process/` also holds current ownership/implementation references; `archive/` preserves completed, closed, and superseded plans plus dated research. Historical OPEN labels do not create current tasks.

| Directory | Holds |
| --- | --- |
| [`architecture/`](architecture/) | ADRs and current technical baselines |
| [`guides/`](guides/) | Current, stable reference for users and maintainers |
| [`dependencies/`](dependencies/) | Dependency audits, upgrade records, and the dependency graph |
| [`design/`](design/) | Product and feature design records |
| [`verification/`](verification/) | Pre-implementation failure matrices, acceptance procedures, and recorded results |
| [`process/`](process/) | One current implementation queue, current references, and two legacy link redirects |
| [`archive/`](archive/) | Completed/closed plans, dated research and retired material; bulky media was pruned on 2026-10-13 (see the [verification index](verification/README.md#档案裁剪)) |

---

## Start here

本次专项：[防御逻辑与测试精简治理](process/defensive-code-test-cleanup-2026-10-17.md)。

本轮维护：[2026-10-16 全量依赖升级评估](dependencies/dependency-audit-2026-10-16.md)；[CI 修复失败矩阵](verification/ci-repair-failure-matrix-2026-10-16.md)；[CI 修复验证记录](verification/ci-repair-2026-10-16.md)。

升级规划：[2026-10-18 上游 0.15.3 与依赖升级执行规划](dependencies/upgrade-plan-2026-10-18.md) — Codex 已完成评估与目标冻结，交 DSH 执行；实施状态以独立验收记录为准。

升级执行：[失败矩阵](verification/upgrade-2026-10-18-failure-matrix.md)与[实施记录](verification/upgrade-2026-10-18-implementation.md)（DSH，2026-10-18；机器结果 [upgrade-2026-10-18.json](verification/results/upgrade-2026-10-18.json)）— 明确列出已完成、技术阻断与未验证项，diff 保留待复核。

升级复核：[2026-10-19 首轮复核](verification/upgrade-2026-10-19-review.md) — 尚未验收通过；已确认 HEIC 与自定义模型兼容问题，记录四项偏离裁定和 DSH 续做要求。

升级续审：[2026-10-19 第二轮复核](verification/upgrade-2026-10-19-review-2.md) — 尚未验收通过；复现 HEIC 打包解析与 Chat Starters 失败路径，要求修正模型保存、验收计数并定位 critical 挂起。

升级收口：[2026-10-20 实施清单](dependencies/upgrade-closeout-2026-10-20.md) — Codex 直接实施剩余产品修复和验收；按用户要求在独立工作树验收，不包含并行的前端设计与字体迁移。

| Document | Status | Purpose |
| --- | --- | --- |
| [Project README](../README.md) / [中文](../README.zh-CN.md) | Current | Product introduction, capabilities, screenshots, setup, and positioning. |
| [Architecture overview](architecture/overview.md) | Current baseline | Repository topology, ownership, process/protocol boundaries, request path and persistence. Current follow-ups are selected in the [value register](process/implementation-value-register-2026-10-13.md); historical governance plans are archived. |
| [Electron app](../apps/electron/README.md) | Current | Desktop runtime, build, event contract, and diagnostics. |
| [Contributing](../CONTRIBUTING.md) | Current | Local setup, validation, and contribution workflow. |
| [Security](../SECURITY.md) | Current | Supported versions and private vulnerability reporting. |
| [Implementation value register](process/implementation-value-register-2026-10-13.md) | Accepted — current implementation register | R01–R07 implemented and locally verified; explicit closures, five reopening conditions and fifteen release gates, with L01/L02 verified locally on Windows. |
| [CLI reference](guides/cli.md) | Current | Headless server client, commands, TLS, and scripting. |
| [Pi kernel baseline](guides/pi-kernel.md) | Current | Single-backend runtime contract, lifecycle, tool synchronization, and upgrade checks. |

## Architecture

Current upstream work: [0.15.0 / 0.15.1 non-UI implementation](verification/upstream-0.15-non-ui-implementation-2026-10-15.md), with the [pre-implementation failure matrix](verification/upstream-0.15-non-ui-failure-matrix-2026-10-15.md). Authorized on 2026-10-15; the existing Pi 1.2.0 upgrade and visual design remain the baseline.

| Document | Status | Scope |
| --- | --- | --- |
| [Chat popout card failure matrix](verification/markdown-popout-card-failure-matrix-2026-10-12.md) | Written before implementation; browser verified | Restore centered cards and Markdown source mode; 18 browser scenes and archived before/after evidence. [Results](verification/results/markdown-popout-card-2026-10-12/README.md). |
| [Governance domain ownership](architecture/governance-domain-ownership.md) | Accepted | Configuration, protocol, Pi and product assembly ownership. |
| [Architecture overview](architecture/overview.md) | Current baseline | Structural map; §10 lists the known drift and tech debt without owners. |
| [Durable Agent Runtime ADR](architecture/durable-agent-runtime.md) | Accepted, implemented baseline | Runtime Host authority, T1/T2 effects, recovery and projections. Compatibility storage remains; target expansions and read-model retirement are governed by the value register. |
| [Authentication and process lifecycle](architecture/authentication-process-lifecycle.md) | Accepted, implemented | Persistent cookie revocation scope, exact Origin/proxy trust, fail-closed storage and bounded global-failure shutdown. Native-platform limits are explicit. |
| [Durable Runtime boundary redesign](architecture/durable-runtime-boundary.md) | Implemented — B0–B5 | Runtime Kernel/Host ownership, restricted APIs, external adapters, resolved dependency gate and independent Pi/crash verification. Replaces the earlier nine-service split; evidence and coverage limits are linked from the document. |
| [Session snapshot storage and bounded reads](architecture/session-snapshot-reads.md) | Accepted | Immutable snapshots, 512 KiB chunked reads, lease limits, and the compact snapshot-reference format. |
| [Capability adoption and operating conventions](architecture/capability-adoption-2026-10.md) | Accepted | What was adopted from upstream 0.14.0 and Pi 1.0.2, plus four deliberate deferrals with the evidence each needs before re-evaluation. |
| [Phase A identity freeze](architecture/phaneris-phase-a-identity-freeze.md) | Completed stage record | Frozen identity list and drift-check machinery. Namespace availability was only partly verified — unverified items are listed in-file. |
| [Phase B brand identity](architecture/phaneris-phase-b-brand-identity.md) | Completed stage record | Independent package/application/data identity. Optional services are null with no upstream fallback; external ownership, signing and release acceptance remain conditional release work. |
| [OpenUI intelligent UI target architecture](architecture/openui-intelligent-ui.md) | Proposed — documentation only; not approved for implementation | Target architecture, fence contract, security invariants, phased exit criteria and the rejected-design list for optional generated reply blocks. Expands the [design record](design/openui-reply-presentation-plan-2026-10-13.md); measurements live in the [evidence record](verification/openui-adoption-evidence-2026-10-14.md). |

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
| [Dependency relationship analysis](dependencies/dependency-graph-2026-10-06.md) | Historical measurements; cleanup continued through governance | Workspace/subpath declarations, borrowed dependencies and lock ownership have been adjudicated. Current results are in the [governance ledger](process/governance-completion-2026-10-11.md). |
| [Full dependency audit](dependencies/dependency-audit-2026-10-03.md) | Dated audit (2026-10-03) | Per-item version and security assessment across 186 direct controls, with evidence CSVs. |
| [September 2026 dependency upgrade](dependencies/dependency-upgrade-2026-09.md) | Point-in-time record | Direct-package versions, Python pins, and the exceptions kept. |
| [October 2026 dependency upgrade](dependencies/dependency-upgrade-2026-10-03.md) | Implemented (batches A–F), point-in-time record | Upgrade execution and artifact limits. Historical pending dependency/renderer suggestions do not override current source, budgets or ownership decisions. |

## Design records

| Document | Status | Scope |
| --- | --- | --- |
| [OpenUI reply presentation assessment and plan](design/openui-reply-presentation-plan-2026-10-13.md) | Proposed — documentation only; not approved for implementation | Optional generated reply blocks, custom Phaneris components, text fallback, compatibility and evidence gates. Proposal status is recorded in the [value register](process/implementation-value-register-2026-10-13.md); no prototype or dependency installation is authorized. |
| [AI settings replan](design/ai-settings-replan.md) | Implemented | Connections → Conversation → Advanced structure, verified by 20 acceptance scenarios. |
| [Decision assistance and Run](design/decision-assistance-run-plan.md) | Implemented | Configuration responsibilities, session decisions, application evidence and accounting; current results in verification. |
| [Default redesign](design/default-redesign/README.md) | Implemented | The built-in Default theme (light/dark palettes, canonical JSON, static styles) with preview assets. |
| [Plugin bundles design](design/plugin-bundles-design.md) | Implemented | Aggregating skills, sources, and a prompt fragment into an Agent Plugins 1.0.0 package. |
| [Plugin bundles decision register](design/plugin-bundles-decisions.md) | 0 open / 0 REC | The decisions the plugin-bundle implementation rests on, with the alternative each rejected. |
| [Theme engine design](design/theme-engine-design.md) | Implemented | Semantic theme engine decisions and implementation history. Current fields live in [`theme.ts`](../packages/shared/src/config/theme.ts). |
| [Generated theme contract](design/theme-contract.generated.md) | Accepted / generated | Current fields, four built-ins, runtime validation and motion parity. |
| [Theme hosts and rollout](design/theme-hosts-and-rollout.md) | Accepted | Host/content ownership, visual debt and rollback boundaries. |
| [New-session hero design](design/new-session-hero-design.md) | Implemented | Design record for the empty-session landing. |

## Verification

Reproducible browser and packaged-client checks live in [`scripts/verification/`](../scripts/verification/); recorded JSON results live in [`verification/results/`](verification/results/). See the [verification index](verification/README.md) for commands and platform notes.

| Document | Status | Scope |
| --- | --- | --- |
| [Pi SDK 1.2.0 upgrade](verification/pi-sdk-1.2.0-upgrade.md) | Implemented; Windows kernel verification passed; full-suite baseline exceptions recorded | Exact SDK graph, codemode result compatibility, real 1.1.0 history recovery, bundled runtime hashes and verification limits. |
| [Theme and frontend visual audit failure matrix](verification/frontend-theme-visual-audit-failure-matrix-2026-10-12.md) | Written before audit probes; audit evidence recorded | Independent theme/CSS/interaction checks and remaining real-host E2E. [Reproduction evidence](verification/results/frontend-theme-visual-audit-2026-10-12/README.md). |
| [Scale & theme consistency failure matrix](verification/scale-theme-consistency-failure-matrix.md) | Written before implementation; evidence status per row | 20 failure modes for scale tiers, theme radius/density, hairlines, masks, motion collapse, IME and sash guards. |
| [State matrix](verification/state-matrix.md) | Maintained | Five states × ten surfaces; recovery path required for every cell. |
| [Scale & theme system implementation](verification/frontend-scale-contract-implementation-2026-10-17.md) | Implemented; contract and real-app evidence recorded | Four-wave delivery: baseline, DESIGN.md/PRODUCT.md constitution, ESLint scale gate, primitive convergence, optical and motion upgrades. [Screenshots](verification/results/scale-contract-2026-10-17/). |
| [Frontend P2 fixes](verification/frontend-p2-fixes-2026-10-17.md) | Implementation and browser verification | Copy feedback with reduced motion, scroll viewport masks, and runtime high-DPI hairlines. |
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
| [Motion validation matrix](verification/motion-validation.md) | Historical per-path coverage; selected gaps retained | Its P markers record unexecuted checks at that wave. Current key-path verification is R03; supported-platform and physical-device scope is conditional C01 in the value register. |
| [Motion implementation status](verification/motion-implementation-status.md) | Implemented; coverage limits retained | M01–M16/V01–V08 history and known untested paths. Remaining entries are not an independent promise to exhaust the full matrix. |
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
| [OpenUI adoption evidence](verification/openui-adoption-evidence-2026-10-14.md) | Recorded measurements — documentation only; not an implementation authorization | Resolves the unknowns the OpenUI proposal left open: real dependency install and peer compatibility, the `openui-lang` fence contract, measured prompt cost (built-in vs curated library), package/build footprint, telemetry source behaviour, and the tool-execution constraint points. Adds suggested scenes OU19–OU24. Discloses a scratch-directory install outside the authorized scope. |

## Current implementation queue

| Document | Status | Scope |
| --- | --- | --- |
| [Implementation value register](process/implementation-value-register-2026-10-13.md) | Accepted, updated 2026-10-14 | Sole current record of R01–R07 completion, C01–C05, L01–L15, closed proposals, source evidence and exit criteria. |

Twenty-three former plans, placeholders and dated research documents were moved to `archive/`. Their full source list and adjudications are in the [register](process/implementation-value-register-2026-10-13.md). The archive preserves original proposals and historical facts; a historical “next step” does not reopen work.

## Process — current references and evidence

| Document | Status | Scope |
| --- | --- | --- |
| [Second project governance audit and plan](process/project-governance-round2-plan-2026-10-16.md) / [implementation results](verification/project-governance-round2-implementation-2026-10-16.md) | Implemented — local verification, 2026-10-16 | Four bounded fixes; 24 new and 52 existing scenes, full workspace tests, typecheck, lint and current performance budgets pass. Startup/compiler intermittency and the Windows server distribution limit remain explicitly recorded. |
| [Project governance audit and plan](process/project-governance-audit-plan-2026-10-16.md) / [implementation results](verification/project-governance-implementation-2026-10-16.md) | Implemented — local verification, 2026-10-16 | Eight bounded fixes, 19 targeted scenes, 33 existing scenes and full workspace tests passing; cold navigation and Windows server distribution limits remain. Obsolete icon design notes were removed at the user's request; documentation checks now pass. |
| [Governance ownership inventory](process/governance-ownership-inventory-2026-10-11.md) | Accepted reference | Configuration ports, SessionManager ownership, dependencies, cycles and presentation-storage decisions. |
| [Governance completion ledger](process/governance-completion-2026-10-11.md) | Implemented; maintained reference | G0–G8 source adjudication, local acceptance and external verification limits; no separate open implementation queue. |
| [Governance G3–G8 evidence](verification/results/governance-completion-2026-10-11/README.md) | Pre-audit snapshot | Frozen manifests, archive selection and independent SHA verification. |
| [Governance closeout evidence](verification/results/governance-closeout-2026-10-11/README.md) | Locally verified | Audit fixes and original acceptance artifacts; current unfinished work is selected in the register. |
| [Historical governance-plan redirect](process/architecture-code-governance-implementation-plan-2026-10-11.md) | Link compatibility only | Keeps frozen evidence links valid; the full plan is archived. |
| [Historical theme-plan redirect](process/theme-engine-frontend-governance-plan-2026-10-12.md) | Link compatibility only | Keeps frozen evidence links valid; W1–W5 implementation is complete within recorded scope. |

## Archive — superseded or retired

These preserve decisions and evidence. Their paths, line numbers, versions, and gap lists may describe the repository at the date recorded rather than today.

| Document | Why archived |
| --- | --- |
| [Original code audit](archive/code-audit-2026-08-01.md) | Historical snapshot; original OPEN findings require source revalidation and are not an owned current backlog. |
| [Right-panel audit](archive/right-panel-audit-report.md) | Superseded by later Workbench and Run redesigns; its P2 list is explicitly not a backlog. |
| [Trajectory vs VanDSH comparison](archive/trajectory-vs-vandsh-comparison.md) | Superseded by Run Overview/Trajectory/Context/Map. TTFT, generation time and throughput now exist in the event adapter and Inspector; old missing-feature claims retain their historical date. |
| [Univer and Workbench integration plan](archive/univer-native-workbench-integration-plan.md) | Univer was retired on 2026-08-30 with no migrator. The Artifact/Workbench foundation it describes is still valid; only the Univer chapters are dead. |
| [Native Design Layer](archive/native-design-layer-architecture-plan.md) | Closed current proposal; historical target design only. Artifact/image-generation capabilities remain implemented. |
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
| [Calendar and Gantt implementation status](archive/calendar-gantt-implementation-status.md) | Historical multi-wave implementation, including calendar migration, state persistence, task editor and gates. Remaining scope is narrowed to R06/C02 in the value register. |
| [Performance optimization plan](archive/performance-optimization-plan-2026-09-01.md) | 已归档（2026-10-13）：Implemented (first round) |
| [Performance implementation](archive/performance-implementation-2026-09-10.md) | First optimization round implemented. The historical 15 MB main target is closed; current measured build/performance ratchets remain enforced. |
| [Repository cleanup](archive/repository-cleanup-2026-09-27.md) | 已归档（2026-10-13）：Executed |
| [Durable runtime implementation handoff](archive/craftagent-durable-runtime-handoff.md) | 已归档（2026-10-13）：Historical handoff; superseded operationally by the accepted ADR |
| [Native file preview implementation](archive/native-file-preview-implementation.md) | 已归档（2026-10-13）：Implemented on `codex/native-file-preview` |
| [Project deep analysis](archive/Phaneris_Project_Deep_Analysis.md) | 已归档（2026-10-13）：2026-10-04 — Whole-project assessment and roadmap (§21). Not an owned plan; some findings have since been fixed. |
| [Upstream 0.14.0 assessment](archive/upstream-0.14.0-assessment.md) | 已归档（2026-10-13）：2026-10-03 — Pre-approval snapshot; batches B1–B5 have since landed. |
| [Calendar/Gantt library replacement](archive/calendar-gantt-library-replacement-assessment.md) | 已归档（2026-10-13）：2026-09 — Calendar replaced (FullCalendar); Gantt deferred with stated triggers. |
| [Pi SDK 1.0.0 upgrade assessment](archive/pi-sdk-1.0.0-upgrade-assessment.md) | Historical upgrade snapshot; subsequent capability adoption is recorded separately. Old P1/P2/P3 labels are not a current rollout plan. |

## Release history

- Versioned user-visible history lives in [`apps/electron/resources/release-notes/`](../apps/electron/resources/release-notes/).
- The unreleased changelog is [`next.md`](../apps/electron/resources/release-notes/next.md).
- Release notes are immutable history after release; do not rewrite older entries to match current architecture.

## Documentation maintenance rules

1. Current guides describe observable behavior, not the development story that produced it.
2. Architecture documents must declare one of: `proposed`, `accepted`, `deferred`, `superseded`, or `historical` — on an explicit `Status:` line. `bun run check:docs` enforces this.
3. Completed, closed and superseded plans move to `archive/` with an archival note. Unfinished work is maintained only in the [implementation value register](process/implementation-value-register-2026-10-13.md), with evidence, benefit, scope and exit criteria; reopening a closed proposal requires a concrete trigger. Current architecture/guides/ownership references stay in their own categories. Frozen evidence and released notes retain their original bytes; only necessary legacy link redirects remain. Media policy is in the [verification index](verification/README.md#档案裁剪).
4. User-visible changes update `release-notes/next.md` in the same change.
5. README screenshots live in `docs/assets/readme/`; use descriptive filenames and remove superseded assets rather than accumulating galleries.

### The gate

`bun run check:docs` (wired into `validate:ci`) fails on:

- a relative link that does not resolve, or a machine-specific absolute path (`E:/…`, `/Users/…`);
- an architecture document without a rule-2 `Status:` line;
- a document not reachable from this index (directly, or through a subdirectory README).

Fix current documents. A missing frozen artifact may only use an [exact source/target SHA exception](../scripts/doc-artifact-exceptions.json) with owner and recovery condition; the warning remains visible and does not certify the missing evidence. Newly broken links still fail.
