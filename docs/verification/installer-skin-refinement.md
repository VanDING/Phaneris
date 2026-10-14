# Windows installer visual verification

Scope: refine the branded NSIS skin introduced in `9169aea`. Keep the native
welcome / progress / finish page lifecycle and the existing installation engine.

## Acceptance checks

Record these before changing the skin; the native capture run is the verification
artifact, rather than unit tests of drawing coordinates.

- The brand stays in the same position across all three pages, in both themes.
- Chinese and English text use clear sans-serif UI faces, without clipping.
- The primary action remains readable at rest, on hover and while pressed
  (white text contrast at least 4.5:1). Disabled and keyboard focus are distinct.
- The location row accommodates a long path. An invalid path displays an error
  without colliding with the action; restoring the path clears the error.
- Completion has a separate title and supporting sentence. The launch checkbox
  remains operable and its keyboard focus is visible.
- Progress advances, its numeric reading has a stable position, and its overlay
  disappears when the finish page appears.
- Preview verification does not replace an installed app, write uninstall
  registration, start the app, or stop unrelated processes.

## October 2026 typography and compact layout checks

Failure cases recorded before implementation:

- A requested font silently falls back to a stock bitmap face: record the
  control's LOGFONT and its GDI resolution through a local font clone in each
  captured state (foreign-process HFONTs cannot be selected into a probe DC).
- Small Chinese captions lose stroke definition: use native ClearType and verify
  the requested quality, resolved face, and screenshots in Chinese and English.
- A smaller window clips caption buttons, path editing, errors, or completion:
  check every visible control against the client area and keep all three pages
  at the same 520x480 logical size.
- The progress canvas or brand asset retains the old 600px geometry: capture
  welcome, progress, and finish and compare their brand position and bounds.
- Loading icons shift during animation or vanish with reduced motion: capture
  the shared spinner at small UI sizes and with reduced motion enabled.
- The simpler Pages icon diverges between collapsed and expanded navigation:
  exercise both modes with the production sidebar and preserve its hit target.

## Reproduction

Native window treatment failure cases, recorded before implementation:

- Rounded desktop corners are treated as valid transparency, rather than a
  reason to replace the native window with a square surface.
- A native one-pixel outline is allowed; an inset classic bevel or a wide gray
  band inside the page is not. Verify the interior after activation changes,
  non-client repaint, minimizing/restoring and moving the window.
- Capture a padded area on a controlled background and verify a real shadow
  outside the window, rather than relying only on the requested DWM attributes.
- Both forms of non-client sizing retain the full client area. The window stays
  fixed-size and the caption still drags through Windows' native move loop.
- One layout definition supplies NSIS controls, the progress renderer, font
  creation and bitmap geometry. Welcome/finish brand positions must agree with
  the progress page at every verified scale.
- Theme changes affect the native outline as well as the page contents. Check
  Chinese/English light/dark variants and a scaled layout without changing the
  user's display settings.

```powershell
bun run installer:brand
bun run installer:plugin
bun run probe:installer-nsh --preview
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme light -PreviewLanguage 2052 -OutDir .cache/verification/installer-skin/zh-light
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme dark -PreviewLanguage 2052 -OutDir .cache/verification/installer-skin/zh-dark
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme light -PreviewLanguage 1033 -OutDir .cache/verification/installer-skin/en-light
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme dark -PreviewLanguage 1033 -OutDir .cache/verification/installer-skin/en-dark
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme light -PreviewLanguage 2052 -PreviewDpi 144 -OutDir .cache/verification/installer-skin/zh-light-144
pwsh -File scripts/verification/installer-frame-workflow.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme light -OutDir .cache/verification/installer-skin/frame-light
pwsh -File scripts/verification/installer-frame-workflow.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme dark -OutDir .cache/verification/installer-skin/frame-dark

$env:PHANERIS_TEST_BROWSER_CHANNEL = 'msedge' # Installed-browser fallback on Windows.
bun run scripts/verification/ui-indicators-workflow.ts
```

`--preview` compiles the production pages and plugin with a synthetic progress
section. It exercises the real native controls and page transitions, but does not
validate application extraction, upgrade, shortcuts or app launch. Run the
ordinary syntax probe again before release packaging; it checks both installer
and uninstaller passes with warnings treated as errors.

`-PreviewDpi` exercises the production layout and font scaling without changing
the monitor configuration. It is a fixture override compiled only into the
preview. Its captures report both layout DPI and the actual window DPI; they do
not establish behavior on a physical display at that scaling.

Add `-WithoutPointer` when the desktop is being used during a capture run. It
omits the two hover screenshots and never moves or restores the cursor; native
press, focus, disabled, path editing, progress and completion checks still run.
The normal mode moves from outside a control and waits for its real hot state.
Actual input during that run can advance a page, so a disrupted run is not
accepted as evidence.

## Shared native implementation

`apps/electron/installer/layout.json` supplies the 520x480 design grid and UI
font roles. `generate-installer-layout.cjs` validates the definition and emits
the NSIS and C++ includes during the plugin build. The brand asset generator
reads the same definition. The primary action is 160x44, and the three pages
share brand placement, caption buttons and font creation. The generator writes
only changed output; rebuilding identical input is deterministic.

`InstallerCreateFont` creates TrueType/ClearType GDI fonts for native controls
and the progress wordmark. Only the logo is rasterized, at both 1x and 2x.

The frame retains `WS_THICKFRAME`, requests Windows 11 rounded corners and the
system outline, and extends the DWM frame by one pixel to preserve the system
shadow. Windows 10 uses the appearance its compositor supports. Returning a
full client area for both `WM_NCCALCSIZE` forms and suppressing the legacy NSIS
non-client bevel prevents a gray band inside the page. This is verified after
activation messages, non-client repaint, restore and movement. The page's
caption continues to enter the existing native move loop.

## 2026-10-14 native window results

| Verification | Result | Evidence |
| --- | --- | --- |
| Chinese light/dark and English light/dark at 96 layout DPI | 54 states passed; full page transitions and native font/control checks | `.cache/verification/installer-native-window-2026-10-14/{zh-light,zh-dark-passive,en-light,en-dark}` |
| Chinese/light at 120, 144 and 192 layout DPI | 39 states passed; 125/150/200% geometry, typography, progress and completion | `.cache/verification/installer-native-window-2026-10-14/{zh-light-120-complete,zh-light-144,zh-light-192}` |
| Native frame, light/dark | 16 checks passed; both non-client sizing forms and six screenshots per theme with real shadow, rounded corners and flat interior | `.cache/verification/installer-native-window-2026-10-14/{light-verified,dark-verified}` |
| Shared layout generator, tooling typecheck and focused ESLint | Passed; generated includes are deterministic | `apps/electron/scripts/generate-installer-layout.cjs` |
| Native plugin, preview and ordinary NSIS compilation | Passed; installer and uninstaller passes compiled with warnings treated as errors | Preview SHA-256: `160d2d892b3fec6a09df8317708422677c10a257bd7931c5f6e076f0871ba0f7`; plugin SHA-256: `d2669ec5d58e7820a736b77ae3603dfe244f79e71c26eebce04c9769efda01c0` |

The final native manifest contains 93 accepted page states, 16 frame checks,
the executable/plugin/layout fingerprints, and SHA-256 hashes for 221 evidence
files: `.cache/verification/installer-native-window-2026-10-14/manifest.json`.
The Chinese/light 96-DPI run includes actual hover evidence (15 states). The
remaining six variants use `-WithoutPointer` (13 states each); hover evidence
is not inferred for those variants. Runs disrupted by pointer input or an
unpainted screenshot are excluded from the final manifest. The capture runner
waits for the actual action surface and presents each screenshot target again
without activation, so later NSIS show calls cannot invalidate its z-order.

These captures ran on Windows 11 build 26300. The actual desktop/window DPI was
96 in all seven variants; the higher DPI cases use the preview-only layout
override. The preserved executable is a synthetic UI preview, not a release
installer or proof of extraction/upgrade behavior.

## 2026-10-14 initial typography and indicator results

| Verification | Result | Evidence |
| --- | --- | --- |
| Sidebar and shared spinner at 100/125/150/200% | 12 scenes passed; navigation, size utilities, animation, reduced motion and loading names | `.cache/verification/ui-indicators-IgwXMt/manifest.json` |
| Chinese/English, light/dark, 96 layout DPI | 60 states passed; control bounds, font resolution, text height, path editing and page transitions | `.cache/verification/ui-refinement-2026-10-14-final/{zh-light,zh-dark,en-light,en-dark}` |
| Chinese/light, 144 layout DPI | 15 states passed; actual monitor DPI remained 96 | `.cache/verification/ui-refinement-2026-10-14-final/zh-light-144-ready` |
| Electron/UI/tooling typechecks, targeted ESLint, production renderer build | Passed | Renderer output: `.cache/verification/ui-refinement-renderer` |
| Native plugin, preview and ordinary installer/uninstaller compilation | Passed with NSIS warnings treated as errors | Preview SHA-256: `74f7c28781fa7d3acfdbdceebb1064e7b5fc920c18f16130ead47de679ed2f79`; plugin SHA-256: `6d44ea32db6fe0b65b85a764692d2a5d46bb0f3a9f9700a698ca13e33b3956bb` |

The native screenshot runner waits for the actual welcome action before
presenting the window; the outer NSIS dialog can exist before high-DPI assets
and controls are ready. Every successful state has a controls JSON and a
typography/layout report alongside its screenshot.

Font creation requests TrueType and ClearType with an explicit charset, as
documented by [Microsoft's CreateFontW reference](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createfontw).
The brand name is native text, rather than pixels baked into a resized bitmap.

That first pass covered typography configuration, geometry and interaction.
Its square-edge contract did not establish native corners or shadow. The
subsequent frame checks use a padded screenshot on a controlled gray backdrop;
they allow the system's thin outline and corner transparency while requiring
a flat page interior and an observed external shadow.

Release extraction, upgrade, signing and physical multi-monitor DPI transitions
are outside this UI preview.
