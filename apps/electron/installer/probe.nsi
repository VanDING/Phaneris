; Syntax probe for the installer skin's NSIS half.
;
; This is NOT shipped and NOT a build input. It exists so `makensis` can chew on
; installer-strings.nsh + installer-pages.nsh + scripts/installer.nsh without
; electron-builder's generated script around them, which turns a mistake in the
; page plumbing into a one-second compile error instead of a five-minute
; packaging run.
;
; Run it with `bun run probe:installer-nsh`, which finds makensis, finds
; electron-builder's plugin bundle, generates the two custom-message includes
; exactly as electron-builder does, and compiles this file TWICE: once plainly
; and once with -DBUILD_UNINSTALLER, because electron-builder compiles the script
; twice and the second pass is where installer-only code becomes unreferenced
; (NSIS warning 6010, fatal under electron-builder's -WX). A probe that only ran
; the first pass missed exactly that.
;
; It runs makensis with -WX, the same flag electron-builder uses, so a warning
; here is a failed packaging run there. Keeping those two in step is the whole
; value of the probe: twice now it has been the difference between "the probe
; passes" and "the build works".
;
; NOTHING FROM electron-builder IS STUBBED, and as little as possible is
; rewritten. The page wiring is electron-builder's own assistedInstaller.nsh, the
; conditions are the macros NsisScriptGenerator.flags() emits, and the message
; tables come from addCustomMessageFileInclude. What this file writes itself is:
;
;   * the -D symbols electron-builder passes on the makensis command line
;     (NsisTarget.js builds `defines`; common.nsh defines the rest);
;   * the ${isXxx} condition macros, copied character for character from the
;     generator's output, because they are emitted as script text rather than
;     living in a file;
;   * a synthetic install section, because electron-builder's own
;     installSection.nsh extracts a packaged application a syntax probe does not
;     have.
;
; Two bugs were hidden by stubs here before that rule was adopted.

; Relative to this file's directory (apps/electron/installer), which is also the
; CWD this probe is run from: installer -> electron -> apps -> repo root.
;
; Two include directories, because electron-builder's NSIS tree is split in two:
; `include/` holds the shared macro files (StdUtils.nsh, UAC.nsh), and the parent
; holds the template bodies (common.nsh, assistedInstaller.nsh) and their own
; multiUser.nsh / multiUserUi.nsh. The parent entry is what makes
; `!include multiUserUi.nsh` resolve at all -- NSIS's own Include directory has
; no such file.
;
; It is NOT enough for multiUser.nsh, and that is worth knowing before trusting
; an include path again: makensis searches $NSISDIR\Include before the added
; directories, and that directory ships a *different* MultiUser.nsh. Windows
; resolves the name case-insensitively, so a bare `!include "multiUser.nsh"` --
; which is exactly what the real installer.nsi template writes -- picks up NSIS's
; stock MultiUser instead (variables named $MultiUser.*, plus a warning that
; MULTIUSER_EXECUTIONLEVEL is unset, which -WX turns into a failed build). The
; real build never sees this because makensis runs with its CWD set to the
; templates directory; the probe cannot, so it addresses electron-builder's file
; by path instead. Same file, same declarations, no collision.
!addincludedir "..\..\..\node_modules\app-builder-lib\templates\nsis\include"
!addincludedir "..\..\..\node_modules\app-builder-lib\templates\nsis"

; Electron-builder's NSIS plugin bundle (nsis7z, StdUtils, UAC, ...) lives in a
; per-machine cache, so the runner passes it in rather than this file guessing.
; It must be registered before StdUtils.nsh is *used*, because the macros that
; file defines carry live StdUtils:: plugin calls.
!ifdef PHANERIS_NSIS_PLUGIN_DIR
  !addplugindir /x86-unicode "${PHANERIS_NSIS_PLUGIN_DIR}"
!else
  !warning "PHANERIS_NSIS_PLUGIN_DIR is not defined; run: bun run probe:installer-nsh"
!endif

; --- electron-builder symbols the skin files consume -------------------------
; NsisTarget.js defines these by name; the values here only have to be shaped
; right, because the probe never runs. APP_EXECUTABLE_FILENAME and
; UNINSTALL_FILENAME are deliberately absent: common.nsh defines them below, and
; a duplicate !define is a warning, which -WX turns into a failure.
!define PRODUCT_NAME "Phaneris"
!define PRODUCT_FILENAME "Phaneris"
!define APP_FILENAME "Phaneris"
!define SHORTCUT_NAME "Phaneris"
!define VERSION "0.0.0"
!define INSTALL_REGISTRY_KEY "Software\phaneris"
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\phaneris"
!define INSTALL_SECTION_ID "install"
; electron-builder defines this for every assisted installer
; (`if (!oneClick || perMachine)`, NsisTarget.js), and multiUser.nsh only defines
; setInstallModePerAllUsers when it is set -- which multiUserUi.nsh then calls.
!define INSTALL_MODE_PER_ALL_USERS_REQUIRED
; Used by the disk-space preflight. Real builds get the packaged app's size.
!define APP_64_UNPACKED_SIZE 520000

; Must match the real build: electron-builder always emits `Unicode true` and
; passes `-INPUTCHARSET UTF8`. Without both, the Chinese LangStrings and the
; punctuation in these comments fail to decode.
Unicode true

!ifdef BUILD_UNINSTALLER
  OutFile "probe-uninstaller.exe"
  SilentInstall silent
!else
  OutFile "probe-installer-nsh.exe"
  RequestExecutionLevel user
!endif

; --- the generated header prefix --------------------------------------------
; electron-builder prepends, in this order: StdUtils.nsh, the nsis-resources
; !addplugindir, the ${isXxx} flag macros, the custom-message includes, and
; finally the project's own include -- which is scripts/installer.nsh. Reproduced
; in that order, so anything the skin references is in scope exactly where it is
; in a real build and nowhere earlier.
!include "StdUtils.nsh"
!include "UAC.nsh"

; Verbatim from NsisScriptGenerator.flags(). ${isUpdated}, ${isForAllUsers} and
; ${isForCurrentUser} are the ones the page code uses; the rest are here because
; the same generated block defines them.
!macro _isUpdated _a _b _t _f
  ${StdUtils.TestParameter} $R9 "updated"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isUpdated `"" isUpdated ""`

!macro _isForceRun _a _b _t _f
  ${StdUtils.TestParameter} $R9 "force-run"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isForceRun `"" isForceRun ""`

!macro _isKeepShortcuts _a _b _t _f
  ${StdUtils.TestParameter} $R9 "keep-shortcuts"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isKeepShortcuts `"" isKeepShortcuts ""`

!macro _isNoDesktopShortcut _a _b _t _f
  ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isNoDesktopShortcut `"" isNoDesktopShortcut ""`

!macro _isDeleteAppData _a _b _t _f
  ${StdUtils.TestParameter} $R9 "delete-app-data"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isDeleteAppData `"" isDeleteAppData ""`

!macro _isForAllUsers _a _b _t _f
  ${StdUtils.TestParameter} $R9 "allusers"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isForAllUsers `"" isForAllUsers ""`

!macro _isForCurrentUser _a _b _t _f
  ${StdUtils.TestParameter} $R9 "currentuser"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend
!define isForCurrentUser `"" isForCurrentUser ""`

; electron-builder generates these two from messages.yml and assistedMessages.yml
; and includes them right here; the runner generates them the same way, with the
; same generator, into a temporary directory it passes in. They are a flat
; `LangString <key> <lcid> "..."` table, so they need no language table to exist
; yet -- which is why electron-builder can emit them this early at all.
;
; Leaving them out is not an option: the install-mode page function renders
; $(chooseInstallationOptions) and friends, and a missing key is warning 6040,
; fatal under -WX.
!ifdef PHANERIS_NSIS_MESSAGES_DIR
  !include "${PHANERIS_NSIS_MESSAGES_DIR}\messages.nsh"
  !include "${PHANERIS_NSIS_MESSAGES_DIR}\assistedMessages.nsh"
!else
  !warning "PHANERIS_NSIS_MESSAGES_DIR is not defined; run: bun run probe:installer-nsh"
!endif

; --- the project's own include, at the same point the real script has it -----
!include "..\scripts\installer.nsh"

; --- the installer.nsi template body ----------------------------------------
; common.nsh, MUI2 and multiUser.nsh in the template's own order, then the page
; wiring itself -- assistedInstaller.nsh, unmodified. That file decides which
; pages exist, and it is the only place customWelcomePage, customFinishPage and
; customPageAfterChangeDir are consulted, so hand-writing an equivalent here
; would be exactly the kind of stub that hides bugs.
!include "common.nsh"
!include "MUI2.nsh"
!include "..\..\..\node_modules\app-builder-lib\templates\nsis\multiUser.nsh"
!include "assistedInstaller.nsh"

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

; Mirror the real build's ordering exactly: electron-builder runs
; `!insertmacro addLangs` and then immediately invokes `customHeader`. Getting
; this wrong is invisible here but files every Chinese string under English, so
; the probe must exercise the same order or it would validate the bug.
!insertmacro customHeader

!ifdef BUILD_UNINSTALLER
  ; ---- Uninstaller pass -----------------------------------------------------
  ; electron-builder's uninstaller.nsh is not included (it deletes a real
  ; installation), so the section below carries the one thing that pass needs
  ; from installer.nsi: WriteUninstaller. NSIS refuses a script with no install
  ; section, and it warns 6020 -- fatal under -WX -- when uninstaller code exists
  ; with no WriteUninstaller anywhere.
  Section "install"
    WriteUninstaller "$TEMP\phaneris-probe-uninstaller.exe"
  SectionEnd

  Section "Uninstall"
    !insertmacro customUnInstall
  SectionEnd
!else
  ; ---- Installer pass -------------------------------------------------------
  ; .onInit in the template's order: electron-builder's initMultiUser, then our
  ; customInit. Both are the real macros; the few lines around them in
  ; installer.nsi (LogSet, check64BitAndSetRegView, the single-instance guard)
  ; touch nothing the skin is written against.
  Function .onInit
    SetOutPath $INSTDIR
    !insertmacro initMultiUser
    !insertmacro customInit
  FunctionEnd

  ; electron-builder's own install section is installSection.nsh, which extracts
  ; a packaged application this probe does not have. The skin's hooks are what
  ; matter here, and both of them are expanded below exactly where the real
  ; section expands them.
  Section "install"
    WriteUninstaller "$TEMP\phaneris-probe-uninstaller.exe"
    !insertmacro customInstall
  SectionEnd

  Section "Uninstall"
    !insertmacro customUnInstall
  SectionEnd
!endif
