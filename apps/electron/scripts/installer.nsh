; electron-builder NSIS hook file (`nsis.include` in electron-builder.yml).
;
; electron-builder splices this file into its generated installer.nsi as part of
; the script *header*: after StdUtils.nsh and the nsis-resources !addplugindir,
; and before the installer.nsi template body. That position is what makes the
; whole arrangement work, and it is worth spelling out because two of the three
; consequences are easy to get backwards:
;
;   * the !macro definitions below are the first thing the template can see, so
;     every hook electron-builder tests with `!ifmacrodef` -- customWelcomePage,
;     customFinishPage, customPageAfterChangeDir, customInstallMode, customInit,
;     customInstall, customUnInstall -- takes over the flow. They must stay at
;     the top level of this file for exactly that reason;
;   * ${isUpdated}, ${isForCurrentUser}, ${StdUtils.*}, ${APP_EXECUTABLE_FILENAME}
;     and StartApp are all declared above this point or above customHeader, so
;     the page code can use them. They are only ever *evaluated* inside function
;     bodies, never at include time;
;   * the language table does not exist yet -- addLangs runs later in the
;     template -- which is why the LangStrings are wrapped in a macro and
;     emitted from customHeader instead of being included here directly.
;
; What the hooks change, and what they deliberately do not:
;
;   * The install *engine* is untouched. electron-builder's own install section
;     still runs, so --updated, --force-run, --keep-shortcuts, /allusers,
;     /currentuser and silent install all behave as before -- which is what
;     electron-updater's quitAndInstall() depends on. Nothing here may break
;     that; if a future change needs to, it belongs upstream, not in a skin.
;
;   * The interactive pages are ours: welcome -> progress -> finish. Welcome and
;     finish are ordinary NSIS pages built by installer-pages.nsh; the progress
;     page is NSIS's own InstFiles page, hidden and covered by the plugin's
;     overlay. The install-mode page is skipped, because a single-user install
;     has no mode to choose.
;
;   * allowToChangeInstallationDirectory stays false so electron-builder does not
;     add its own directory page; the welcome page's own path row sets $INSTDIR.

; --- Paths -------------------------------------------------------------------
; ${__FILEDIR__} is this file's real directory (NSIS 3+), and electron-builder
; includes this file by absolute path without copying it, so these resolve to the
; checkout. Absolute paths matter: makensis runs with its CWD set to the NSIS
; templates directory, so a relative `File` source would resolve there instead.
;
; The names are prefixed `installer-` for a hard reason, not tidiness: NSIS's own
; `Contrib\Modern UI 2\MUI2.nsh` does `!include "Pages.nsh"`, and Windows path
; resolution is case-insensitive -- a file called `pages.nsh` anywhere on the
; include search path (which includes the CWD) is silently substituted for MUI2's
; `Pages.nsh`, and MUI2 then fails with an error inside your file. Same hazard for
; `strings.nsh`. Keep these names distinctive.
!define PHANERIS_INSTALLER_DIR  "${__FILEDIR__}\..\installer"
; The staged name lives in exactly ONE place. It used to be written out at each
; call site, and installer-pages.nsh spelled it `window-frame.dll` while the File
; command below staged `windowframe.dll` -- so every page-side plugin call asked
; for a file that did not exist, LoadLibrary failed, and the installer fell back
; to the stock NSIS wizard while reporting success. Nothing caught it because a
; missing file and a refused call both arrive as an empty result.
!define PHANERIS_PLUGIN_NAME    "windowframe.dll"
!define PHANERIS_PLUGIN_DLL     "${__FILEDIR__}\..\installer-ui\${PHANERIS_PLUGIN_NAME}"
!define PHANERIS_BRAND_DIR      "${PHANERIS_INSTALLER_DIR}\assets"
!define PHANERIS_LICENSE_FILE   "${__FILEDIR__}\..\..\..\LICENSE"
!define PHANERIS_STRINGS_NSH    "${PHANERIS_INSTALLER_DIR}\installer-strings.nsh"
!define PHANERIS_PAGES_NSH      "${PHANERIS_INSTALLER_DIR}\installer-pages.nsh"

!addplugindir /x86-unicode "${__FILEDIR__}\..\installer-ui"

; Standard includes only. LogicLib and FileFunc are pure preprocessor; nsDialogs
; and WinMessages are the control macros and window-message constants the page
; file is written against. None of them carries a plugin, so all four are safe
; to pull in at a point where electron-builder's plugin directories do not exist
; yet.
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

; Without this the installer process is DPI-unaware and Windows bitmap-stretches
; the whole window on a scaled display, blurring the 600x600 surface.
ManifestDPIAware true

; MUI reads this when it builds the interface, which happens where the first
; MUI_PAGE_* macro is inserted -- inside assistedInstaller.nsh, above the point
; where customHeader is expanded. NSIS resolves the forward reference to
; InstallerGuiInit at the end of the compilation, so the order is fine.
!ifndef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_GUIINIT InstallerGuiInit
!endif

; Included at the top level so the macro name exists before customHeader needs
; it; the strings themselves are emitted from inside customHeader.
!include "${PHANERIS_STRINGS_NSH}"

; --- Header ---------------------------------------------------------------
; Expanded immediately after electron-builder's addLangs, which is the first
; point at which the language table exists and the first point at which the
; page file may safely reference $(INSTALLER_*).
;
; The page file is included HERE rather than at the top of this file on purpose.
; Anything it compiles -- the ${isUpdated} tests, ${StdUtils.ExecShellAsUser},
; ${APP_EXECUTABLE_FILENAME} -- has to be in scope when its function bodies are
; parsed, and that is this point and not the top of the header.
;
; InstallerCheckAppRunning is defined here too, because it is the one installer
; callback that has to see the final $INSTDIR and the staged plugin, and because
; a stray Function in the uninstaller pass is NSIS warning 6010 -- fatal under
; electron-builder's -WX.
!macro customHeader
  !insertmacro PhanerisInstallerLangStrings
  !ifndef BUILD_UNINSTALLER
    !include "${PHANERIS_PAGES_NSH}"

    Function InstallerCheckAppRunning
      System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerFindProcess(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}") i.s ?c'
      Pop $R0
      ; 0 while running, 1 when absent, -1 when the process list could not be
      ; read at all -- which is a different problem with a different message.
      ${If} $R0 < 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_UI_ERROR)" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      ${If} $R0 == 0
        ${If} ${isUpdated}
          ; An update is launched by a running instance that is about to exit;
          ; give it ten seconds before treating it as a refusal.
          StrCpy $R1 0
          ${DoWhile} $R0 == 0
            Sleep 250
            System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerFindProcess(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}") i.s ?c'
            Pop $R0
            IntOp $R1 $R1 + 1
            ${If} $R1 >= 40
              ${ExitDo}
            ${EndIf}
          ${Loop}
        ${EndIf}
        ${If} $R0 == 0
          ; Replacing a running installation's files is how half-upgraded
          ; installs happen, so this stops rather than trying.
          MessageBox MB_OK|MB_ICONINFORMATION "$(INSTALLER_RUNNING)" /SD IDOK
          SetErrorLevel 2
          Quit
        ${EndIf}
      ${EndIf}
    FunctionEnd
  !endif
!macroend

; --- Install mode ------------------------------------------------------------
; A per-user product: pin the mode, then skip the mode page outright. `Abort`
; from the page's PRE callback is how a page is skipped, and the mode and shell
; context are already set by customInit, so this only has to make sure the page
; never appears.
!macro customInstallMode
  StrCpy $installMode CurrentUser
  SetShellVarContext current
  Abort
!macroend

; --- Init --------------------------------------------------------------------
; Runs from .onInit, after electron-builder's initMultiUser and before any page.
; This is the only point at which the install folder, the theme and the staged
; resources can still be chosen freely.
!macro customInit
  ; Refuse the two situations a per-user installer cannot serve, rather than
  ; installing somewhere the user did not ask for and failing halfway.
  ${If} ${isForAllUsers}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_PER_USER)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_PER_USER)" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}

  !insertmacro setInstallModePerUser
  StrCpy $hasPerMachineInstallation 0
  StrCpy $hasPerUserInstallation 1

  ; electron-builder derives its default from the *package* name, and falls back
  ; to the sanitised name whenever the product filename is not plain ASCII; for
  ; a scoped npm package that lands a user-visible "@scope" segment in the path.
  ; ${APP_FILENAME} and ${PRODUCT_FILENAME} agree today ("Phaneris"), and this
  ; line is what keeps them agreeing if that ever stops being true.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCT_FILENAME}"
  StrCpy $InstallerPath $INSTDIR

  StrCpy $InstallerTheme "auto"
  ${GetParameters} $0
  ${GetOptions} $0 "/THEME=" $1
  ${IfNot} ${Errors}
    ${If} $1 == "light"
    ${OrIf} $1 == "dark"
    ${OrIf} $1 == "auto"
      StrCpy $InstallerTheme $1
    ${Else}
      ; Not a user-facing switch: it exists so a test run can force a theme. A
      ; typo should fail loudly rather than produce an installer that looks
      ; wrong for reasons nobody can see.
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_THEME_ERROR)" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
  Call InstallerResolveTheme

  ; $PLUGINSDIR is deleted when the installer exits, which is exactly the
  ; lifetime these want. Never stage them into $INSTDIR.
  InitPluginsDir
  File "/oname=$PLUGINSDIR\brand.bmp" "${PHANERIS_BRAND_DIR}\brand.bmp"
  File "/oname=$PLUGINSDIR\brand-2x.bmp" "${PHANERIS_BRAND_DIR}\brand-2x.bmp"
  File "/oname=$PLUGINSDIR\brand-dark.bmp" "${PHANERIS_BRAND_DIR}\brand-dark.bmp"
  File "/oname=$PLUGINSDIR\brand-dark-2x.bmp" "${PHANERIS_BRAND_DIR}\brand-dark-2x.bmp"
  File "/oname=$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}" "${PHANERIS_PLUGIN_DLL}"
  ; The licence is opened by the welcome page's link; it is never parsed here.
  File "/oname=$PLUGINSDIR\LICENSE.txt" "${PHANERIS_LICENSE_FILE}"

  ; Load the plugin here, once, and KEEP the outcome. Splitting this out of the
  ; call sites is what makes a later failure legible: "the DLL was never
  ; extracted", "the DLL could not be loaded" and "the DLL loaded and refused to
  ; build its window" are three different bugs that all surface the same way, as
  ; an empty result where a window handle was expected.
  ;
  ; The path is passed as a LoadLibraryW ARGUMENT rather than as the
  ; `module::function` part of a System::Call, so it stays quoted; that form is
  ; the only one that survives a $PLUGINSDIR under a user profile with a space in
  ; it, which is exactly why the probe is worth having even though the call sites
  ; use the unquoted form.
  ;
  ; LoadLibraryW is a genuine stdcall API, so there is no ?c here -- the ?c on our
  ; own exports is what tells System::Call those are cdecl.
  System::Call 'kernel32::LoadLibraryW(w "$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}") p.s'
  Pop $PhanerisLoadResult
  ${If} $PhanerisLoadResult == "0"
    System::Call 'kernel32::GetLastError() i.s'
    Pop $PhanerisLoadError
  ${Else}
    StrCpy $PhanerisLoadError "0"
  ${EndIf}
!macroend

; --- Pages -------------------------------------------------------------------
; The `--updated` skip lives inside InstallerWelcome as an `Abort`, not in
; electron-builder's skipPageIfUpdated: that macro only sets a PRE hook, which a
; raw `Page custom` does not consult.
!macro customWelcomePage
  Page custom InstallerWelcome InstallerWelcomeLeave
!macroend

; The only insertion point between electron-builder's optional directory page
; and MUI_PAGE_INSTFILES, so this is where the InstFiles page gets its PRE and
; SHOW hooks. Defined here rather than in installer-pages.nsh because MUI_PAGE_*
; macros only mean anything at the exact point the page macro is expanded.
;
; PRE  -- SetAutoClose, the path preflight, and the running-app check;
; SHOW -- hide the stock page and hand the plugin its progress bar.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE InstallerBeforeInstall
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstallerProgressShow
!macroend

; A real branded finish page. electron-builder's assisted installer only
; auto-launches the app for `--force-run` + silent runs, so without this page an
; ordinary interactive install would end with nothing happening; and launching
; without asking is the wrong default for someone who only wanted to stage the
; app. The page carries the launch decision as a checkbox, defaulted on.
!macro customFinishPage
  Page custom InstallerFinish InstallerFinishLeave
!macroend

; --- Install -----------------------------------------------------------------
; Installation work publishes stage changes without disturbing the NSIS caller.
; The stage property is read by the overlay's 16 ms timer; the Store/Store pair
; is what keeps $0 -- and with it the error flag this macro is preserving --
; intact across a plugin call made from NSIS's worker thread.
!macro InstallerPublishStage Stage
  Push $0
  StrCpy $0 0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  System::Store /NOUNLOAD "S"
  System::Call /NOUNLOAD 'user32::SetPropW(p $HWNDPARENT, w "Phaneris.Stage", p ${Stage})'
  System::Store "L"
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend

!macro customInstall
  Push $0
  StrCpy $0 0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ; Files, shortcuts and the uninstall entry are already written by the time
  ; this macro runs, so what is left is bookkeeping: the caption says so.
  !insertmacro InstallerPublishStage 4
  ; The template records the install path only under its own private registry
  ; key, leaving the standard `InstallLocation` value empty -- which is what
  ; inventory tools, "Open file location" and the Apps list read. The preflight
  ; on the next run reads this value back to tell an upgrade from a fresh
  ; install, so it is load-bearing here, not cosmetic.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend

; No launch here: it runs on NSIS's worker thread while the window belongs to
; the UI thread, and the decision belongs to the finish page's checkbox anyway.
; Advancing the InstFiles page is not this macro's job either -- SetAutoClose in
; the page's PRE callback does it, and it does it by moving to the next page
; rather than by closing the installer.

; Uninstall keeps electron-builder's stock behaviour -- a native-surfaced data
; prompt is a separate, larger change (it needs its own surface, not a skin),
; and getting it wrong risks deleting a user's sessions.
!macro customUnInstall
!macroend
