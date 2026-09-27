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

## Reproduction

```powershell
bun run installer:brand
bun run installer:plugin
bun run probe:installer-nsh --preview
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme light -PreviewLanguage 2052 -OutDir .cache/verification/installer-skin/zh-light
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme dark -PreviewLanguage 2052 -OutDir .cache/verification/installer-skin/zh-dark
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -InstallerPath apps/electron/installer/probe-installer-nsh.exe -Theme light -PreviewLanguage 1033 -OutDir .cache/verification/installer-skin/en-light
```

`--preview` compiles the production pages and plugin with a synthetic progress
section. It exercises the real native controls and page transitions, but does not
validate application extraction, upgrade, shortcuts or app launch. Run the
ordinary syntax probe again before release packaging; it checks both installer
and uninstaller passes with warnings treated as errors.
