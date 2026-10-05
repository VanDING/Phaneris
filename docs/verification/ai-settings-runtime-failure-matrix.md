# AI settings, permissions and Default theme acceptance

Recorded before implementation on 2026-10-05. Run workflows with an isolated
`PHANERIS_CONFIG_DIR`; never use production credentials or paid providers.

## Runtime failures and required outcomes

| Failure / boundary | Required behavior | Evidence |
| --- | --- | --- |
| Clean packaged installation, no system Python/Node | Managed exact Python is prepared before isolation; embedded Electron Node executes without PATH fallback | Runtime source, version, stdout, output file |
| Only older uv Python exists | Never execute the older patch; prepare the pinned patch in the app runtime directory | Exact `sys.version_info` |
| uv writes its installation scratch in the home directory | Script execution never invokes uv inside the sandbox; preparation owns its explicit install directory | Runtime command and unchanged legacy install directory |
| Prepared Python, network unavailable | Both tools work offline without reinstalling/downloading | Second execution with `UV_OFFLINE=1` |
| Preparation download fails or times out | Clear runtime-not-ready error; no execution or permission relaxation; a later attempt can retry | Error + absent script output |
| Concurrent first requests | Share one preparation; all successful callers receive the verified interpreter | Concurrent result records |
| Packaged Node missing from vendor directory | Use explicit host-supplied Electron executable in Node mode; do not run Bun as Node | `process.versions.node`, runtime source |
| Node script uses CommonJS or ES modules inside a workspace with a conflicting package type | Both script styles execute independently of workspace package metadata | Actual `require` and `import` executions |
| Network access from a script | Denied in all permission modes | Failed request + enforced isolation |
| Writes outside allowed directories | Denied, including symlink escape; legitimate output and scratch remain writable | Sentinel remains absent |
| macOS `/tmp` and `/private/tmp` refer to the same directory | Canonical containment accepts real descendants and still rejects escaping symlinks | Actual diagnostic and transform via the OS temp alias |
| Script spawns children or never exits | Timeout terminates the process group and returns promptly | Timeout record |
| Linux runtime stored outside system mounts | Read-only runtime paths are visible; data directory is writable | Linux workflow |
| Platform lacks an isolation backend | Explicit unavailable result; never claim an isolated success | Platform status |

## Guarded failures and required outcomes

| Failure / boundary | Required behavior |
| --- | --- |
| Decision layer off, feature off, missing key, missing connection or invalid endpoint | Backend reports a distinct unavailable reason; UI keeps a visible configuration entry |
| Credential removed after selection | Refresh status; current Guarded session remains visible and falls back to confirmation |
| Risk classifier times out, returns no answer, throws, or returns malformed risk values | Guardable mutations require confirmation; no automatic execution |
| No interactive client | Required confirmation blocks/parks unattended work through the existing permission pipeline |
| Read-only operation, ordinary project-local file edit | Preserve the existing documented policy |
| Outside-project edit | Always request confirmation, including symlink escape |
| User cancels or changes mode during inference | No late prompt or stale authorization |
| Source withdrawal / administrator block | Classifier cannot loosen existing restrictions |

## Settings and image-routing failures

- One scrolling page matches the other settings pages. All settings remain accessible, with optional model configuration collapsed and effective summaries visible.
- Empty connection list has a direct setup action. Connection errors persist until a new test/edit.
- Workspace rows show effective values and inheritance; connection changes clear incompatible model overrides atomically.
- Context is one selection: compact, handoff or manual; saving errors restore the previous value. Reuse the right-side settings menu, with labels and descriptions on the left; check layout, menu descriptions and keyboard selection.
- Disabled decisions show a concise setup entry; provider details and feature switches appear on demand.
- Image defaults persist through RPC and reload. Automatic mode reports the resolved connection/model.
- Explicit image connection with missing credentials, removed connection, unsupported provider or invalid model fails without choosing another account.
- Image-input capability does not authorize image generation. Image model options are filtered for the actual provider.
- Titles and summaries share the existing utility model; no per-feature model settings are introduced.
- Runtime/model/decision credentials never cross the status RPC boundary.
- The actual packaged application starts with an isolated data/profile directory, renders the full app shell and opens AI/permission settings without a first-render exception; new RPC controls work through the packaged transport.

## Default theme failures

- Built-in display name is Default; stable `default` ID and `twilight` alias survive reload and workspace overrides.
- App-inherited theme and an explicit Default workspace theme remain distinct.
- Static CSS, runtime tokens, packaged resources, native window background and syntax highlighting agree.
- Text, focus, selection, errors, warnings and disabled controls remain readable in light and dark modes.
- Cards stay restrained; menus and dialogs have visible elevation without neon/glass styling.
- Screenshots cover Chinese long labels, narrow settings, menus, dialogs and keyboard focus.
- Theme and contrast changes do not rewrite user-authored themes.

## Repeatable artifacts

`scripts/verification/runtime-refinement-workflow.ts` runs actual tool handlers in
the packaged Electron Node host and saves JSON plus generated data files.
`scripts/verification/ai-settings-refinement-workflow.ts` exercises the rendered
settings pages with loopback fixtures, saves screenshots and a JSON report.
`scripts/verification/guarded-refinement-workflow.ts` exercises real permission
and HTTP decision paths with isolated configuration and saves a JSON report.
Reports live under `.cache/ai-settings-refinement/`; summarized evidence belongs
under `docs/verification/results/` after final validation.
