# Phaneris (RE) documentation

This index separates current product and architecture documentation from historical audits, implementation handoffs, and deferred design work. A historical document remains useful evidence, but it is not a current product contract unless its status says otherwise.

## Start here

| Document | Status | Purpose |
| --- | --- | --- |
| [Project README](../README.md) / [中文](../README.zh-CN.md) | Current | Product introduction, capabilities, screenshots, setup, and project positioning. |
| [Electron app](../apps/electron/README.md) | Current | Desktop runtime, build, event contract, and diagnostics. |
| [CLI reference](cli.md) | Current | Headless server client, commands, TLS, and scripting. |
| [Pi kernel baseline](pi-kernel.md) | Current | Single-backend runtime contract, lifecycle, tool synchronization, and upgrade checks. |
| [Bundled user and agent guides](../apps/electron/resources/docs/) | Current | Sources, skills, permissions, automation, themes, previews, and built-in tools. These files ship with the app. |
| [Contributing](../CONTRIBUTING.md) | Current | Local setup, validation, and contribution workflow. |
| [Security](../SECURITY.md) | Current | Supported versions and private vulnerability reporting. |

## Current architecture and implementation baselines

| Document | Status | Scope |
| --- | --- | --- |
| [Durable Agent Runtime ADR](architecture/durable-agent-runtime.md) | Accepted, implemented incrementally | Runtime Host authority, T1/T2 effects, recovery, projections, and compatibility boundaries. |
| [Durable Runtime target architecture](architecture/durable-agent-runtime-target-architecture.md) | Deferred | Larger distributed end state; activate only when its stated criteria are met. |
| [Session snapshot storage and bounded reads](architecture/session-snapshot-reads.md) | Current | Immutable snapshots, 512 KiB chunked reads, lease limits, and the compact snapshot-reference format. |
| [Artifact files and native image generation](artifact-files-native-image-generation-plan.md) | Implemented baseline | File-format registry, Artifact lifecycle, native image generation, and the clean removal of Univer. |
| [Theme engine design](theme-engine-design.md) | Implemented | Semantic token layers, user-owned themes, app defaults, and workspace overrides. |
| [Theme authoring prompt](theme-authoring-prompt.md) | Current | Copy-paste generation prompt that encodes the full 39-token field set, schema limits, light/dark inheritance rules, and the Shiki theme whitelist for producing valid theme files. |
| [Graphite theme](graphite-theme.md) | Implemented | A deliberately colourless theme: its token choices, the density decision, and the measurements behind its verification. |
| [New-session hero](new-session-hero-design.md) | Implemented (2026-09-16) | The empty-session landing: brand symbol, slogan, and the layout rules that keep the composer the only primary action. |
| [Profile and preferences](profile-preferences-plan.md) | Implemented baseline | Local profile, activity summary, identity, location, and preferences; optional sharing remains deferred. |
| [Performance implementation (2026-09-10)](performance-implementation-2026-09-10.md) | Implemented | Renderer, server, persistence, WebSocket, and durable-runtime cost reductions, with measurements, baselines, and stop rules. |
| [September 2026 dependency upgrade](dependency-upgrade-2026-09.md) | Point-in-time record (2026-09-08) | Direct-package versions across all workspace manifests, the Python pins, and the exceptions that were kept. |

## Project planning

| Document | Status | Purpose |
| --- | --- | --- |
| [Phaneris fork independence plan](architecture/phaneris-fork-plan.md) | Stages A and B implemented; stage D (services, update chain, release) pending | Naming decision and rationale, frozen identity list, and the phased work required to make the fork independent in brand, OS application identity, data, and release chain. |
| [Phase A identity freeze](architecture/phaneris-phase-a-identity-freeze.md) | Completed stage record | The frozen identity list, the generator and drift-check machinery, and the namespace checks that remain unverified. |
| [Phase B brand identity](architecture/phaneris-phase-b-brand-identity.md) | Completed stage record | Package, environment, and data-path renames, the one-off user-data migration, and what still points upstream. |
| [Plugin bundles design](plugin-bundles-design.md) | Implemented | Aggregate skills, sources, and a prompt fragment into an Agent Plugins 1.0.0 package; `/name` invocation, session-resident, no lifecycle. Paired with [its decision register](plugin-bundles-decisions.md). |
| [Plugin bundles decision register](plugin-bundles-decisions.md) | Implemented; 61 decisions closed, 0 open | The decisions the implementation rests on (D1–D12) with the alternative each rejected, plus the four P9 acceptance tests and where they landed. |
| [Release readiness checklist](release-readiness.md) | Proposed release gate | Identity, recovery, signing, checksum, SBOM, and privacy items required before public binaries. |
| [Project assessment and development roadmap](project-assessment-and-roadmap-2026-08-31.md) | Point-in-time assessment (2026-08-31); several roadmap items have since shipped | Point-in-time assessment of product, architecture, quality, release, security, and governance, followed by a phased convergence and development roadmap. Read its status claims against current code. |
| [Impact-first performance optimization plan](performance-optimization-plan-2026-09-01.md) | Implemented baseline; follow-up items tracked in the 2026-09-10 implementation note | Lean plan that fixes the highest-impact renderer startup and long-session streaming costs first, then stops or continues according to measured user impact. |

## Historical, research, and deferred records

These documents preserve decisions and evidence. Their paths, line numbers, branch names, screenshots, dependency versions, and gap lists may describe the repository at the date recorded rather than today.

| Document | Classification |
| --- | --- |
| [Durable Runtime implementation handoff](craftagent-durable-runtime-handoff.md) | Historical implementation record; superseded operationally by the accepted ADR and current code. |
| [Right-panel audit](right-panel-audit-report.md) | Historical audit and remediation record; later Workbench and Run redesigns supersede its remaining-gap list. |
| [Trajectory vs VanDSH comparison](trajectory-vs-vandsh-comparison.md) | Historical comparison; superseded by the current Overview / Trajectory / Context / Map Run workspace. |
| [Univer and Workbench integration plan](univer-native-workbench-integration-plan.md) | Historical plan; Univer was removed without a migrator or compatibility path. |
| [Native Design Layer](native-design-layer-architecture-plan.md) | Deferred archive; not an implementation baseline. |
| [Cross-ecosystem plugin assessment](cross-ecosystem-plugin-porting-assessment.md) | Exploratory research; implementation requires a separate current plan. |
| [Memory system design](memory-system-design.md) | Research placeholder; no memory architecture is approved by this document. |
| [System-prompt per-turn analysis](system-prompt-per-turn-analysis.md) | Point-in-time analysis and evidence record. |
| [Pi SDK native capabilities gap analysis](pi-sdk-native-capabilities-gap-analysis.md) | Point-in-time capability gap analysis for Pi SDK 0.85.1; revalidate before integration. |
| [Original code audit](../AUDIT_REPORT.md) | Historical security and quality snapshot; findings must be revalidated against current code. |
| [GPUIX / gpui-kit migration assessment](native-frontend-migration-gpuix-assessment.md) | Exploratory assessment (2026-09-12); no product code was changed and no route was adopted. |
| [GPUIX profile](research/gpuix-profile.md) · [gpui-kit profile](research/gpui-kit-profile.md) · [GPUI ecosystem and gaps](research/gpui-ecosystem-and-gaps.md) · [Renderer capability inventory](research/craft-renderer-inventory.md) | Research annexes behind the migration assessment; the inventory holds the raw measurements, the profiles the source-level evidence. |
| [Bundled in-app docs build record](architecture/phaneris-local-docs.md) | Shipped build record for the in-app guide set; its API names and page counts predate the shipped `getDocSlug` / `openDocs` surface. |
| [Theme engine demo](theme-engine-demo-5-themes.html) · [New-session hero demo](new-session-hero-demo.html) | Self-contained HTML design prototypes; kept as design evidence, not shipped with the app. |

## Release history

- Versioned user-visible history lives in [`apps/electron/resources/release-notes/`](../apps/electron/resources/release-notes/).
- The unreleased changelog is [`next.md`](../apps/electron/resources/release-notes/next.md).
- Release notes are immutable history after release; do not rewrite older entries to match current architecture.

## Documentation maintenance rules

1. Current guides describe observable behavior, not the development story that produced it.
2. Architecture documents must declare one of: proposed, accepted, deferred, superseded, or historical.
3. A completed plan may remain as a decision record, but its status must point to the current source of truth.
4. User-visible changes update `release-notes/next.md` in the same change.
5. README screenshots live in `docs/assets/readme/`; use descriptive filenames and remove superseded assets rather than accumulating galleries.
