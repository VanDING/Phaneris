# Resident assistant follow-up — 2026-11-05

This implementation follows the packaged-client investigation and the user's refined scope: an assistant-only floating overview, directly openable deliverables, and messaging through the existing gateway. Memory and context are excluded from this panel. Only bound channels remain visible; other platforms appear in a transient connection picker.

## Behavior

- More opens the overview in one click. It is non-modal, stays open during chat/file inspection, supports horizontal resizing and keyboard control, and hides as soon as the assistant closes. Opening the assistant again restores workspace-local presentation.
- The overview uses existing PanelHeader, header controls, file-type icons, semantic statuses and contract typography. Pending decisions appear only when present. Task and artifact lists share compact hierarchy; the panel follows its content height.
- Work titles come from original attributed inputs. Runtime attempts and observed activity describe execution; cancellation, later direct user activity and result review remain separate facts. Expanded result content survives ordinary refreshes.
- Error summaries retain bounded original execution details and source references. A retry button submits a new explicit request to the resident conversation, preserving current user authorization and allowing the assistant to inspect existing effects before continuing.
- Existing ordinary-session channel setup and pairing bind to the resident singleton. Telegram, WeCom and Lark setup can open inside the assistant flow; WeChat/WhatsApp reuse the existing global connect host. Pairing requests validate workspace ownership. Configuration secrets remain in existing credential flows.
- Deliverables are registered through existing Artifact storage from successful observed tool outputs and verified current files. Scope, original owner, revision review and acceptance remain with Artifact storage. Recent settled assignments reconcile existing outputs at startup; unchanged files do not rewrite metadata. Windows path normalization prevents duplicate registrations.

## Dispatch and history fixes

- Model IDs with a `pi/` prefix use the same canonical identity on both sides of catalog validation.
- Provider-reported supported endpoints are retained and checked against the selected connection protocol. Unknown compatibility remains unknown. The role prompt defaults to the working connection/model and no longer equates catalog membership with protocol support.
- Explicit history session queries prioritize that session within the existing eight-session budget. The assistant contract describes query-driven indexing, extraction and memory as separate mechanisms.
- Work read projections never assign later user work or a subsequent delegation's errors to an older input.

## Verification

Failure cases were specified before implementation in the [failure matrix](../verification/resident-assistant-followup-failure-matrix-2026-11-05.md). Existing real Runtime/SQLite/loopback-provider and Electron workflows were extended; no new post-implementation unit tests were added. Existing messaging and Artifact regressions were run separately.

The Windows packaged client passed all 28 UI scenes with `app.isPackaged === true` and no captured UI errors. Its verification manifest, scene results, light/dark screenshots, execution evidence and Playwright trace are retained together in `.cache/verification/resident-followup-packaged-v3-2026-11-05`. Generated runs remain local as required by the repository's verification policy.

| Validation | Result |
| --- | --- |
| Delegation, model compatibility and original execution details | 52 scenarios passed |
| Scoped history indexing | 22 scenarios passed |
| Context and authorization regression | 36 scenarios passed |
| Native Pi subprocess memory regression | 7 scenarios passed |
| File registration, replay and scope boundaries | 3 scenarios passed |
| Windows packaged Electron UI | 28 scenarios passed |
| Existing messaging and artifact tests | 50 passed |
| Existing custom endpoint model tests | 14 passed |
| Full type checks, lint, i18n gates, identity and version checks | Passed |

All six final workflow manifests passed hash verification. Backend evidence remains in `.cache/verification/resident-followup-{delegation-reviewed,history-pass2,context,native,deliverables-final}-2026-11-05`; the packaged UI evidence is retained in the local run directory above. The unpacked review build is `.cache/resident-assistant-client-2026-11-05/win-unpacked/Phaneris.exe`; no installed client was replaced and no signed installer was produced.

Manifest SHA-256 identities for those complete local runs:

```text
delegation-reviewed  11eb7f654223718455f9af2ba61f6767bfe2c927e32a855b9bef9e34193ddc09
history-pass2        0a9e345a615c96a0a0073fa270925ac4dd500f56c704940082fb523b37345603
context              16c6716ae13b7569ecc7c761b57c60ebc00a26be3f2a7140f85d28d3f526746c
native               de5ca6defb7e46a40b8b8a099b0822fe5946e31b32b42a17d7d4618d955cffba
deliverables-final   97512c00f06b62ccc64ec3279ee0ec2d97d7da956d31fbc08437fe87b9644ac0
packaged-v3          faf4e8f0e21bebdeb81f2ade8f8b3554076e929255842677dc280e316610bea2
```

Earlier fixture failures were retained in separate output directories. The opening/closing animation check now samples renderer animation frames across the actual click instead of depending on IPC snapshot timing. The loopback provider recognizes a later explicit continuation even when canonical replay merges consecutive user inputs. The final scenario still verifies that the original cancelled assignment stays cancelled while its later result is separately reviewable.

Reproduce with new output directories:

```sh
bun run scripts/verification/resident-assistant-delegation-workflow.ts --output-dir=<new-directory>
bun run scripts/verification/resident-assistant-history-workflow.ts --output-dir=<new-directory>
bun run scripts/verification/resident-assistant-context-workflow.ts --output-dir=<new-directory>
bun run scripts/verification/resident-assistant-deliverables-workflow.ts --output-dir=<new-directory>
bun run scripts/verification/resident-assistant-ui-workflow.ts --output-dir=<new-directory>
```

Set `PHANERIS_VERIFICATION_EXECUTABLE` to an unpacked client executable to run the same UI workflow against a packaged distribution. It asserts `app.isPackaged`, uses fresh application/workspace state and a loopback provider, and retains screenshots, execution evidence and a Playwright trace. The live user's installation and data are not used by this workflow.

Each verification workflow emits a manifest with hashes; recheck it with `bun run scripts/verification/verification-artifacts.ts --verify=<directory>`.

Real external messaging accounts, paid model quality, physical touch hardware and signed installer distribution remain separate validation boundaries. The loopback running-state scenario verifies an actual accepted model attempt; it does not claim to prove all providers emit live reasoning deltas. The thinking label is shown only when the host has received such an event.
