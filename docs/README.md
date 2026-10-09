# Phaneris (RE) documentation

This index is the only entry point to `docs/`. Everything here is reachable from this page; `bun run check:docs` enforces that, along with link validity and the status rules below.

Documentation is filed by **what kind of document it is**, not by how finished the work is — a completed plan stays where it is and changes its status (maintenance rule 3).

| Directory | Holds |
| --- | --- |
| [`architecture/`](architecture/) | ADRs and current technical baselines |
| [`guides/`](guides/) | Current, stable reference for users and maintainers |
| [`dependencies/`](dependencies/) | Dependency audits, upgrade records, and the dependency graph |
| [`design/`](design/) | Product and feature design records |
| [`verification/`](verification/) | Pre-implementation failure matrices, acceptance procedures, and recorded results |
| [`process/`](process/) | Plans, implementation records, and dated assessments of how the project was built |
| [`research/`](research/) | Exploration and feasibility research |
| [`archive/`](archive/) | Superseded or retired material, kept as evidence |

---

## Start here

| Document | Status | Purpose |
| --- | --- | --- |
| [Project README](../README.md) / [中文](../README.zh-CN.md) | Current | Product introduction, capabilities, screenshots, setup, and positioning. |
| [Architecture overview](architecture/overview.md) | Current baseline | Repository topology, layering, process and protocol boundaries, request path, client matrix, persistence, build, invariants, and known drift. **Start here for a structural map.** |
| [Electron app](../apps/electron/README.md) | Current | Desktop runtime, build, event contract, and diagnostics. |
| [Contributing](../CONTRIBUTING.md) | Current | Local setup, validation, and contribution workflow. |
| [Security](../SECURITY.md) | Current | Supported versions and private vulnerability reporting. |
| [Release readiness checklist](release-readiness.md) | **Proposed** release gate — 17 items open | Identity, recovery, signing, checksum, SBOM, and privacy items required before public binaries. |
| [CLI reference](guides/cli.md) | Current | Headless server client, commands, TLS, and scripting. |
| [Pi kernel baseline](guides/pi-kernel.md) | Current | Single-backend runtime contract, lifecycle, tool synchronization, and upgrade checks. |

## Architecture

| Document | Status | Scope |
| --- | --- | --- |
| [Architecture overview](architecture/overview.md) | Current baseline | Structural map; §10 lists the known drift and tech debt without owners. |
| [Durable Agent Runtime ADR](architecture/durable-agent-runtime.md) | Accepted, implemented incrementally | Runtime Host authority, T1/T2 effects, recovery, projections. Two workstreams stay open: read-model cutover after measured parity, and automatic bounded continuation. |
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
| [New-session hero design](design/new-session-hero-design.md) | Implemented | Design record for the empty-session landing. |
| [Profile and preferences](design/profile-preferences-plan.md) | Baseline implemented | Local profile and preferences. Summary copy, image/Markdown export, and private/public links are **not** implemented. |

## Verification

Reproducible browser and packaged-client checks live in [`scripts/verification/`](../scripts/verification/); recorded JSON results live in [`verification/results/`](verification/results/). See the [verification index](verification/README.md) for commands and platform notes.

| Document | Status | Scope |
| --- | --- | --- |
| [Verification index](verification/README.md) | Maintained | Commands, platform notes, and result locations. |
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
| [Pi SDK 1.1.0 and upstream 0.14.1 plan](process/pi-sdk-1.1.0-upstream-0.14.1-plan.md) | **Implemented and verified on Windows** | Approved scope, frozen baselines, adoption decisions and deliberate deferrals. |
| [Pi 1.1.0 / Craft 0.14.1 implementation](process/pi-sdk-1.1.0-upstream-0.14.1-implementation.md) | Complete; performance scope is limited | B0–B5 results, 6,289 passing tests, final package evidence, same-drive smoke, earlier failures and reproduction commands. |
| [Pi 1.1.0 implementation failure matrix](process/pi-110-implementation-failure-matrix.md) | Written before implementation | Failure conditions and acceptance boundaries for B0–B5. |
| [Pi 1.1.0 / Craft 0.14.1 handoff](process/pi-sdk-1.1.0-upstream-0.14.1-handoff.md) | Historical checkpoint | B0–B3 completed; B4/B5 continuation details recorded before work resumed. |
| [Workstream sequencing](process/workstream-sequencing-2026-10-06.md) | **Decided; not started** | Six ordered steps across four workstreams. Zero code changed. |
| [Project assessment and roadmap](process/project-assessment-and-roadmap-2026-08-31.md) | **Proposed; not started** | Five-phase roadmap. Its top risks (SessionManager as bottleneck, WebUI reuse fragility) are still present. |
| [Product development directions](process/product-development-directions-2026-09-19.md) | Discussion draft; partial | Removing the allow-all fallback and the completion-rate metric are outstanding; other directions not started. |
| [Agentic interception design](process/agentic-interception-design.md) | Design settled; **implementation not started** | First slice is `tool_call` blocking. Records three live defects: agentic automations execute no action, docs advertise a no-op, and 8 of 13 events have no emitter. |
| [Calendar and Gantt optimization plan](process/calendar-gantt-optimization-plan.md) | Phase 0 done; phases 1–3 open | Roughly 10–16 person-days. `GanttView` is still read-only. |
| [Phaneris fork plan](process/phaneris-fork-plan.md) | In progress | Phases C–F pending. **Phase D blocks public release** (release/update channel, trademark). |
| [Plugin system review and roadmap](process/plugin-system-review-and-roadmap.md) | Phased plan; **P0 defects open** | Three P0s: install rollback damages existing resources, MCP keys have no path-boundary validation, and reference counting keeps a source while deleting its dependency. |

## Process — records (landed)

| Document | Status |
| --- | --- |
| [Upstream 0.13.4 absorption](process/upstream-0.13.4-absorption.md) | Implemented; item 6 deliberately not adopted |
| [Upstream 0.13.5–0.13.6 absorption](process/upstream-0.13.5-0.13.6-absorption.md) | Implemented (batches B0–B5) |
| [Upstream 0.14.0 absorption](process/upstream-0.14.0-absorption.md) | Implemented; delivery is now in `main` (verified 2026-10-06) |
| [Upstream 0.14.0 B4–B5](process/upstream-0.14.0-b4-b5.md) | Implemented; delivery is now in `main` (verified 2026-10-06) |
| [Upstream 0.14.0 bridge cleanup](process/upstream-0.14.0-bridge-cleanup.md) | Applied |
| [Capability integration](process/capability-integration-2026-10-03.md) | First mechanism batch; superseded by the completion record |
| [Capability completion](process/capability-completion-2026-10-04.md) | Seven work packages closed; full migration deliberately deferred |
| [Calendar and Gantt implementation status](process/calendar-gantt-implementation-status.md) | Implemented; §4 records that two of three P3 gate items have since landed |
| [Performance optimization plan](process/performance-optimization-plan-2026-09-01.md) | Implemented (first round) |
| [Performance implementation](process/performance-implementation-2026-09-10.md) | Implemented; `main.cjs` remains above the 15 MB target |
| [Repository cleanup](process/repository-cleanup-2026-09-27.md) | Executed |
| [Bundled in-app docs build record](process/phaneris-local-docs.md) | T2 pipeline and T3 content (46/46 pages) done |
| [Artifact files and native image generation](process/artifact-files-native-image-generation-plan.md) | Current implementation baseline |
| [Durable runtime implementation handoff](process/craftagent-durable-runtime-handoff.md) | Historical handoff; superseded operationally by the accepted ADR |
| [Native file preview implementation](process/native-file-preview-implementation.md) | Implemented on `codex/native-file-preview` |

## Process — dated assessments

| Document | Date | Scope |
| --- | --- | --- |
| [Project deep analysis](process/Phaneris_Project_Deep_Analysis.md) | 2026-10-04 | Whole-project assessment and roadmap (§21). Not an owned plan; some findings have since been fixed. |
| [Upstream 0.14.0 assessment](process/upstream-0.14.0-assessment.md) | 2026-10-03 | Pre-approval snapshot; batches B1–B5 have since landed. |
| [Calendar/Gantt library replacement](process/calendar-gantt-library-replacement-assessment.md) | 2026-09 | Calendar replaced (FullCalendar); Gantt deferred with stated triggers. |
| [Pi SDK 1.0.0 upgrade assessment](process/pi-sdk-1.0.0-upgrade-assessment.md) | 2026-09-21 | Upgrade snapshot. P1 items are now in code; P2/P3 remain open. |
| [Pi SDK 1.0.2 upgrade and convergence](process/pi-sdk-1.0.2-upgrade-and-convergence-assessment.md) | 2026-10-04 | Three default paths are **not** switched (native MCP, native classifier, virtual-model routing); the first-nav budget (3,119 ms vs 3,000 ms) is still open. |
| [Pi SDK native capabilities gap analysis](process/pi-sdk-native-capabilities-gap-analysis.md) | 2026-09-20 | Capability gaps for Pi 0.86.0; revalidate against current code. |
| [System prompt per-turn analysis](process/system-prompt-per-turn-analysis.md) | 2026-09 | S/A recommendations; the opposite choice was later made deliberately. Treat as revisitable, not backlog. |

## Research

| Document | Status | Scope |
| --- | --- | --- |
| [GPUIX / gpui-kit migration assessment](research/native-frontend-migration-gpuix-assessment.md) | Exploratory; no route adopted | Two zero-risk items remain undone: dropping ~683 KB of dead ProseMirror/Tiptap from the production chunk, and exporting the RPC contract as a language-neutral schema. |
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

## Release history

- Versioned user-visible history lives in [`apps/electron/resources/release-notes/`](../apps/electron/resources/release-notes/).
- The unreleased changelog is [`next.md`](../apps/electron/resources/release-notes/next.md).
- Release notes are immutable history after release; do not rewrite older entries to match current architecture.

## Documentation maintenance rules

1. Current guides describe observable behavior, not the development story that produced it.
2. Architecture documents must declare one of: `proposed`, `accepted`, `deferred`, `superseded`, or `historical` — on an explicit `Status:` line. `bun run check:docs` enforces this.
3. A completed plan may remain as a decision record, but its status must point to the current source of truth. **Documents are filed by kind, not by how finished the work is** — a plan that lands changes its status, not its directory.
4. User-visible changes update `release-notes/next.md` in the same change.
5. README screenshots live in `docs/assets/readme/`; use descriptive filenames and remove superseded assets rather than accumulating galleries.

### The gate

`bun run check:docs` (wired into `validate:ci`) fails on:

- a relative link that does not resolve, or a machine-specific absolute path (`E:/…`, `/Users/…`);
- an architecture document without a rule-2 `Status:` line;
- a document not reachable from this index (directly, or through a subdirectory README).

Fix the documents, not the gate.
