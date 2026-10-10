# Bundle hygiene and the automation event surface — evidence

Baseline commit: `61970997` (with batches A–C uncommitted on top).
Date: 2026-10-11.

Requirements: [bundle hygiene and event surface failure matrix](../../bundle-hygiene-and-event-surface-failure-matrix.md).
Plan: [system cleanup and optimization plan](../../../process/system-cleanup-optimization-plan-2026-10-10.md) batches D and E.

## Batch D — bundle hygiene

| Change | File |
| --- | --- |
| `playground.html` is no longer a packaging input | `apps/electron/vite.config.ts` |
| `main.cjs` budget 25 MB → **21.5 MB ratchet** | `scripts/bundle-report.ts` |
| The 15 MB goal is recorded as unmet, not achieved | `docs/process/performance-implementation-2026-09-10.md` |

Measured effect of removing the playground entry:

| Metric | Before | After |
| --- | --- | --- |
| `dist/renderer` total | 104 MB | **101 MB** |
| Playground artifacts shipped | 752 KB JS + 1.8 MB map + 4 KB CSS | none |
| Renderer initial graph | 4.12 MB raw, 89 chunks | **4.08 MB raw, 71 chunks** |

The initial-graph change was not the goal and was not obvious in advance: while
`playground` was an entry, shared dependencies were factored into chunks that
`index.html` also preloaded. Removing the entry removed 18 chunks from the startup
graph as well. Every verification script loads the playground from the dev server
(`localhost:5173`, served from `src/renderer`), so nothing regressed.

The ratchet sits 246,719 bytes above today's `main.cjs`; `PHANERIS_MAX_MAIN_BYTES=1000000`
was used to confirm it actually fails. The old 25 MB ceiling had allowed ~1.4 MB of
growth with no gate noticing.

**katex: evaluated, deliberately not changed.** The only eager path is the static
`rehype-katex` import in `packages/ui/src/components/markdown/Markdown.tsx:3`; the
component that imports `katex` directly is already `React.lazy`. Moving it out of the
initial graph means making the markdown plugin list asynchronous, which changes the
render path and needs its own before/after startup measurement — a rendering change,
not bundle hygiene.

## Batch E — the automation event surface

`AGENT_EVENTS` lists 13 events; only **5** had an emitter:

| Status | Events |
| --- | --- |
| Emitted | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `Stop` |
| No emitter | `Notification`, `PermissionRequest`, `PreCompact`, `SessionEnd`, `SessionStart`, `Setup`, `SubagentStart`, `SubagentStop` |

Changes:

| Change | File |
| --- | --- |
| `UNEMITTED_AGENT_EVENTS` / `EMITTED_AGENT_EVENTS`, generated from the emission sites | `packages/shared/src/automations/emitted-events.ts` |
| A user configuring an unemitted event is told it **will never run**, instead of the old "match conditions only" | `packages/shared/src/automations/validation.ts` |
| Gate wired into `lint` and `test:critical` | `scripts/check-automation-events.ts`, `package.json`, `scripts/test-critical.ts` |
| Baseline ledger | `scripts/automation-events-baseline.json` |

The gate scans real `emitAutomationEvent(...)` call sites, resolving a local identifier
back to the literals assigned to it — `pi-agent.ts:1439` passes a ternary
(`PostToolUse` / `PostToolUseFailure`) and both are correctly counted. The product
constant and the scan must agree, so an emitter added without updating the warning list
fails, and a vocabulary member added without an emitter fails immediately.

**Not done, and why:** the eight unemitted events stay in the vocabulary. Emitting them
is Pi lifecycle-hook work (a feature), and deleting them is a product decision that would
break existing user configs. What changed is that the gap is no longer silent.

## Files here

| File | Contents |
| --- | --- |
| `event-gate.json` | Gate output: vocabulary size, emitted vs unemitted, failures |
| `validation-tests.log` | `validation.test.ts` — 33 pass, 0 fail |
| `critical.log` | `test:critical` run for this batch |
| `README.md` | This file |

## Reproduce

```sh
bun run electron:build:renderer && bun run bundle:report --check
ls apps/electron/dist/renderer/playground.html   # expected: absent
bun run lint:automation-events
(cd packages/shared && bun test src/automations/validation.test.ts)
```

## Coverage limits

- `vite dev` was not started in this environment, so the playground was verified as
  *removed from packaging*, not as *still served in dev*. The dev server serves
  `src/renderer` directly, so the input list does not affect it.
- Startup time was not measured; the 89 → 71 chunk change is a byte and request count
  observation only.
- The event gate covers agent events only. App events (`LabelAdd`, `SchedulerTick`, …)
  are produced through the scheduler, label and status paths and were not audited.
- `validate:ci` passes in full, including `test:doc-tools`.
