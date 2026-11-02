# Session image sharing — implementation and verification

Approved scope: Electron client only. Inline session rename; left aligned title;
native preview-header buttons for More, Share and Close; Lucide Send; per-message
selection; fixed light 720 CSS px / 1440 output px template. Preview and clipboard
operations do not create files. Explicit Save retains PNGs in the owning
session's exports/shares directory.

The exporter uses the same local DOM-to-PNG path proven by the approved HTML
prototype. It embeds the fonts and images needed by the selected snapshot.
No model call, hosted publication, or automatic attachment is involved.

## Failure cases and acceptance evidence

Written before implementation. Verification is an E2E workflow using production
components and a native Electron boundary exercise, with screenshots, PNGs and a
machine-readable report saved by the verification artifact harness.

| Boundary | Failure to exercise |
| --- | --- |
| Rename | Empty name; unchanged name; Escape; Enter during IME composition; blur followed by a single click on Share; server rejection |
| Header | Existing menu items lost; duplicated close control; another page's title alignment changes; focus disappears |
| Selection | Empty selection; current answer shortcut; questions and answers selected independently; nonconsecutive messages; history outside mounted rows; in-progress answer |
| Session state | Draft or scroll position lost; session switch reuses an old snapshot; background generation mutates the preview |
| Pagination | Long response; heading orphaned at a break; oversized paragraph/list item; code block; table with repeated header; wide table; indivisible block taller than a page |
| Rendering | Chinese and Latin fonts; math; diagram; image load failure; cross-origin image failure; hidden buttons or clipped scroll contents; theme changes |
| Export | No selection; single long image above pixel budget; multiple PNGs in order; repeated Copy/Save; cancellation/unmount; missing asset error |
| Clipboard | Invalid PNG; clipboard rejection; no persistent image file created |
| Storage | Unknown session; wrong workspace; remote-owned session; malformed/oversized PNG; path traversal; symlink escape; duplicate export; write failure; explicit save only |
| Hosts | No image-share entry or native calls in WebUI/Viewer; shared TurnCard remains usable when onShare is absent |

## Persistence

Saved batches use a content-derived directory and stable numbered filenames.
Saving the same rendered batch reuses it. Exports are not added as messages or
attachments. Previews and PNG buffers are released on exit. Existing session
bundling retains explicitly saved exports; transient previews never enter it.

## Verified implementation

The browser workflow uses the production title, header, response controls and
share surface. The native client workflow boots the built main process,
preload and business renderer with a disposable persisted session. No provider
request is needed.

| Evidence | Result | Local artifact directory |
| --- | --- | --- |
| Browser selection, rich rendering, history, pagination, 600 code lines, visible-page copy, branch menu, dark theme, resource errors | 10/10 | `.cache/verification/session-image-sharing-ecwGJm` |
| Actual Windows Electron clipboard, save/dedup, invalid payloads, ownership, symlink/write failures, font scope | 7/7 | `.cache/verification/session-image-sharing-native-XRJJaW` |
| Production client: inline rename and disk persistence, latest share title, answer/header entries, file-font PNG, retained draft/focus, single-view close/reopen | 6/6 | `.cache/verification/session-image-sharing-client-A1njZ4` |

Each workflow writes a JSON report, source/runtime manifest and repeatable
artifacts. Browser and production-client runs include screenshots and a
Playwright trace; exports are actual PNGs.

Reproduce after building the client with `bun run electron:build:main`,
`bun run electron:build:preload` and `bun run electron:build:renderer`:

```sh
bun run scripts/verification/session-image-sharing-workflow.ts
bun run scripts/verification/session-image-sharing-native-workflow.ts
bun run scripts/verification/session-image-sharing-client-workflow.ts
```

`typecheck:all`, `lint`, all four i18n gates, font/identity/version checks and
the six existing cold-session metadata checks passed. The finish reviewer
scored visible-page copy, single-session Close, and persistent/latest rename
resolved. DESIGN.md records the approved component and export-document rules.

The host run exposed two integration gaps beyond the isolated components:
rename notified the directory watcher before flushing its new name, and a
memoized answer retained an old share callback. The implementation now flushes
before notification and reads the latest share context from a stable callback.
Closing the last foreground view uses navigation's existing skip-auto-select
option, preserving the session instead of immediately reopening it.

Not exercised: macOS/Linux, installer packaging, physical IME hardware, or
every failure candidate above. Browser output timings vary with resource warmth
and concurrent builds; reports contain measured values, not a speed guarantee.

One early native verification attempt incorrectly tried to write clipboard-read
items back directly. That harness error replaced the original clipboard content
with its test PNG; the original content could not be recovered. The harness now
reconstructs writable ClipboardItems and the successful run verified restoration.
