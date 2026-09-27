; Branded installer pages.
;
; ARCHITECTURE, AND WHY IT CHANGED
;
;   The installer has exactly ONE top-level window: NSIS's own outer dialog,
;   $HWNDPARENT. Nothing here creates a page window.
;
;   That is a deliberate reversal. The previous version of this file drove three
;   owner-drawn plugin windows -- a welcome surface, a progress surface and a
;   finish surface -- and none of them was tied to the page it was covering. When
;   the install finished, the progress surface was still visible on top of a
;   finish page that had already been built underneath it, still painting
;   "cleaning temporary files... 98%", and nothing in the script had a reason to
;   destroy it. A window with no page to belong to cannot be cleaned up by page
;   transitions, because page transitions do not know it exists.
;
;   So the welcome and finish pages are ordinary NSIS pages here, built from
;   native controls with nsDialogs (${NSD_CreateLabel}, ${NSD_CreateButton},
;   ${NSD_CreateBitmap}, ${NSD_CreateText}, ${NSD_CreateCheckbox}). A real page
;   cannot outlive itself, cannot be advanced by anything except NSIS, and gets
;   its control colours, keyboard handling and accessibility for free. The
;   plugin is left with the one job that genuinely needs a window: covering the
;   stock InstFiles page with a branded progress surface while the install
;   section runs, and being destroyed on the next line of the script that made
;   it (see InstallerFinish below -- that DestroyWindow is the fix, not a
;   detail).
;
;   InstallerCreate is shared by both interactive pages and switches on
;   $InstallerPhase; InstallerRender shows and hides controls per phase. The page
;   is advanced by the primary button's click handler, in InstallerStart.
;
; WHERE THIS FILE IS INCLUDED FROM
;
;   From inside !macro customHeader in apps/electron/scripts/installer.nsh, which
;   electron-builder expands *after* it has emitted StdUtils.nsh, the
;   nsis-resources !addplugindir, and the generated installer.nsi template up to
;   its addLangs call. That placement is load-bearing for three separate things:
;
;     * the language table exists, so the $(INSTALLER_*) references below resolve
;       to real strings rather than to the raw token;
;     * ${isUpdated}, ${isForCurrentUser} and ${StdUtils.*} resolve, because
;       both the plugin directory and StdUtils.nsh were emitted above this point
;       (they are evaluated inside function bodies, never at include time);
;     * ${APP_EXECUTABLE_FILENAME} and StartApp exist, because common.nsh was
;       included before the template body reached customHeader.
;
;   The one thing that must NOT move into customHeader is the !macro definitions
;   in scripts/installer.nsh: electron-builder's assistedInstaller.nsh tests them
;   with !ifmacrodef *before* customHeader is expanded, so they stay top-level.
;
; SYSTEM::CALL, THE RULES THAT COST US BUILDS
;
;   * Result capture uses `.s` followed by `Pop`. There is not a single register
;     destination (`.rN` / `.RN`) in this file. An earlier note here claimed the
;     register form silently captures nothing, and every call site was rewritten
;     around that. The claim was wrong: it came from writing `.r0` and then
;     reading $R0, which are different variables. Measured on this machine with a
;     throwaway silent installer, `.r0` writes $0, `.R0` writes $R0, and both
;     work. The push form is kept anyway because it is what the DLL's call sites
;     were built and tested against, and one rule is worth more than four saved
;     instructions.
;   * Several outputs from one System::Call are fine: `i .s, p .s, i .s` pushes
;     three values that come back from three Pops in argument order. That is what
;     the NMCUSTOMDRAW reads below rely on.
;   * Module paths are handed to LoadLibrary raw, so they cannot be quoted:
;     `System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::Name(...)'`.
;   * Our own exports are __cdecl, so every call to them carries the `?c` flag.
;     Genuine Win32 APIs are stdcall and must NOT have it.
;   * A call whose result is not wanted still needs `.s` and a throwaway `Pop`,
;     or the value accumulates on the stack.
;
; One more constraint, on this file's own bytes: it is !included, and NSIS reads
; included files with the system code page unless they carry a UTF-8 BOM --
; -INPUTCHARSET UTF8 covers only the top-level script. This file is therefore
; plain ASCII, and every non-ASCII glyph it needs (the caption buttons) lives in
; installer-strings.nsh, which does carry a BOM. Run
; `python scripts/normalize-installer-nsh.py` after editing it.

; Everything below is installer-only, and the guard is load-bearing.
;
; electron-builder compiles the script TWICE: once for the installer, once for
; the uninstaller with BUILD_UNINSTALLER defined. In that second pass none of
; these functions is referenced, and NSIS reports every unreferenced function as
; warning 6010 -- which electron-builder's -WX turns into a failed build. The
; templates guard their own installer-only code the same way.
!ifndef BUILD_UNINSTALLER

!ifndef PHANERIS_INSTALLER_PAGES
!define PHANERIS_INSTALLER_PAGES

; Clicking the primary button has to advance the page, and NSIS exposes no
; instruction for "next". 0x408 is WM_USER+8, which the NSIS runtime defines as
; WM_NOTIFY_OUTER_NEXT; wParam 1 is the notification id it expects.
!define WM_NOTIFY_OUTER_NEXT 0x408

; ---------------------------------------------------------------------------
; Layout and palette
; ---------------------------------------------------------------------------
;
; Every coordinate is a 96-dpi logical pixel. InstallerPlace converts them with
; MulDiv at call time, so nothing here has to know the display scale. The
; overlay half of the same grid lives in progress.h, which is the authority for
; the 600x600 window itself and for the brand box.

!define INSTALLER_WINDOW_SIZE 600
!define INSTALLER_BRAND_Y 148
!define INSTALLER_BRAND_HEIGHT 176
!define INSTALLER_FONT "Microsoft YaHei UI"
!define INSTALLER_LATIN_FONT "Segoe UI"
!define INSTALLER_BUTTON_FONT_SIZE 16
!define INSTALLER_STATUS_FONT_SIZE 15
!define INSTALLER_BUTTON_DIAMETER 20
!define INSTALLER_STATUS_Y 524
!define INSTALLER_STATUS_HEIGHT 22
!define INSTALLER_LOCATION_Y 398
!define INSTALLER_LOCATION_HEIGHT 40

; The primary button is the brand accent, in both themes: it is the one element
; on the page that is always the same object, and the accent reads as an action
; against either background. Hover and press deepen the violet so white text
; keeps at least 4.5:1 contrast in every enabled state.
!define INSTALLER_ACCENT 0xFF733DF4
!define INSTALLER_ACCENT_HOVER 0xFF6932E6
!define INSTALLER_ACCENT_PRESSED 0xFF5926C7

; Var declarations belong to the top level of the script; this file is included
; from inside a macro, whose body is emitted at the top level, so they land
; where NSIS needs them.
Var InstallerDialog
Var InstallerPhase
Var InstallerDpi
Var InstallerSize
Var InstallerImage
Var InstallerButton
Var InstallerStatus
Var InstallerTitle
Var InstallerFont
Var InstallerSmallFont
Var InstallerTitleFont
Var InstallerFontFace
Var InstallerChoose
Var InstallerEdit
Var InstallerEditFrame
Var InstallerBrowse
Var InstallerLaunch
Var InstallerExpanded
Var InstallerProgressWindow
; The plugin's staging outcome, filled by the LoadLibraryW probe in customInit
; and printed verbatim by PhanerisPluginFailure. Kept as a variable rather than
; re-probed at each call site so the diagnosis always reports the ONE load that
; the whole run depended on.
Var PhanerisLoadResult
Var PhanerisLoadError
; Which step of the plugin's InstallerApplyFrame refused, read back off the
; dialog. Empty when the call never happened at all.
Var PhanerisFrameError
Var InstallerGdiToken
Var InstallerEditFrameBitmap
Var InstallerPath
Var InstallerError
Var InstallerTheme
Var InstallerBgHex
Var InstallerTextHex
Var InstallerBgArgb
Var InstallerBgColorref
Var InstallerTextColorref
Var InstallerMutedColorref
Var InstallerPrimary
Var InstallerPrimaryHover
Var InstallerPrimaryPressed
Var InstallerControlHover
Var InstallerControlPressed
Var InstallerTrack
Var InstallerButtonText
Var InstallerButtonTextDisabled
Var InstallerDisabledFill
Var InstallerDisabledBorder
Var InstallerBorder

; SetCtlColors accepts only literal colours -- there is no way to hand it a
; runtime value -- so the theme is resolved into two mirrored palettes here and
; the macro picks between them at compile time. Both palettes must stay in step
; with InstallerResolveTheme below and with PaletteFor in progress.h.
;
; "Literals only" is not a stylistic preference, it is the black-bar bug. A
; control used to be coloured with
;
;     SetCtlColors $SomeControl $InstallerMutedColorref $InstallerBgHex
;
; i.e. with the GDI variables. SetCtlColors parses its two arguments as plain
; RRGGBB hex strings; an 0x-prefixed COLORREF does not parse, the call leaves the
; control's colours unset, and the label came up as black text on a black
; background -- a solid 202x23 bar under the primary button. EVERY SetCtlColors
; call in this file passes literals; the COLORREF and ARGB variables exist for
; the GDI and GDI+ calls that really do want them.
!macro InstallerControlColors HANDLE
    ${If} $InstallerTheme == "dark"
        SetCtlColors ${HANDLE} FFFFFF 151517
    ${Else}
        SetCtlColors ${HANDLE} 0F1115 FFFFFF
    ${EndIf}
!macroend

!macro InstallerMutedColors HANDLE
    ${If} $InstallerTheme == "dark"
        SetCtlColors ${HANDLE} A5A5B0 151517
    ${Else}
        SetCtlColors ${HANDLE} 646570 FFFFFF
    ${EndIf}
!macroend

Function InstallerResolveTheme
    ${If} $InstallerTheme == "auto"
        ClearErrors
        ReadRegDWORD $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" "AppsUseLightTheme"
        ${If} ${Errors}
            StrCpy $0 1
        ${EndIf}
        ${If} $0 == 0
            StrCpy $InstallerTheme "dark"
        ${Else}
            StrCpy $InstallerTheme "light"
        ${EndIf}
    ${EndIf}
    ${If} $InstallerTheme == "dark"
        StrCpy $InstallerBgHex "151517"
        StrCpy $InstallerTextHex "FFFFFF"
        StrCpy $InstallerBgArgb 0xFF151517
        StrCpy $InstallerBgColorref 0x171515
        StrCpy $InstallerTextColorref 0xFFFFFF
        StrCpy $InstallerMutedColorref 0xB0A5A5
        StrCpy $InstallerPrimary ${INSTALLER_ACCENT}
        StrCpy $InstallerPrimaryHover ${INSTALLER_ACCENT_HOVER}
        StrCpy $InstallerPrimaryPressed ${INSTALLER_ACCENT_PRESSED}
        StrCpy $InstallerControlHover 0xFF252529
        StrCpy $InstallerControlPressed 0xFF303036
        StrCpy $InstallerTrack 0xFF33333B
        StrCpy $InstallerButtonText 0xFFFFFF
        ; Disabled is a neutral, never a dimmed accent: a grey control reads as
        ; inert at a glance, where a washed-out violet reads as a loading state.
        StrCpy $InstallerDisabledFill 0xFF2A2A2E
        StrCpy $InstallerDisabledBorder 0xFF3A3A3F
        ; COLORREF for GDI text: #6B7280, on the dark page and on the disabled
        ; fill above -- muted enough to read as inert without disappearing into
        ; the fill it sits on.
        StrCpy $InstallerButtonTextDisabled 0x80726B
        StrCpy $InstallerBorder 0xFF45454D
    ${Else}
        StrCpy $InstallerBgHex "FFFFFF"
        StrCpy $InstallerTextHex "0F1115"
        StrCpy $InstallerBgArgb 0xFFFFFFFF
        StrCpy $InstallerBgColorref 0xFFFFFF
        StrCpy $InstallerTextColorref 0x15110F
        StrCpy $InstallerMutedColorref 0x706564
        StrCpy $InstallerPrimary ${INSTALLER_ACCENT}
        StrCpy $InstallerPrimaryHover ${INSTALLER_ACCENT_HOVER}
        StrCpy $InstallerPrimaryPressed ${INSTALLER_ACCENT_PRESSED}
        StrCpy $InstallerControlHover 0xFFF3F3F6
        StrCpy $InstallerControlPressed 0xFFE9E9EF
        StrCpy $InstallerTrack 0xFFE9ECF2
        StrCpy $InstallerButtonText 0xFFFFFF
        StrCpy $InstallerDisabledFill 0xFFE5E7EB
        StrCpy $InstallerDisabledBorder 0xFFD1D5DB
        ; COLORREF for #9CA3AF, the light theme's disabled caption.
        StrCpy $InstallerButtonTextDisabled 0xAFA39C
        StrCpy $InstallerBorder 0xFFC5C7D0
    ${EndIf}
FunctionEnd

; ---------------------------------------------------------------------------
; Drawing helpers
; ---------------------------------------------------------------------------

; Move a control to a logical-pixel box. Clobbers $0-$3.
!macro InstallerPlace HWND X Y W H
    System::Call 'kernel32::MulDiv(i ${X}, i $InstallerDpi, i 96) i.s'
    Pop $0
    System::Call 'kernel32::MulDiv(i ${Y}, i $InstallerDpi, i 96) i.s'
    Pop $1
    System::Call 'kernel32::MulDiv(i ${W}, i $InstallerDpi, i 96) i.s'
    Pop $2
    System::Call 'kernel32::MulDiv(i ${H}, i $InstallerDpi, i 96) i.s'
    Pop $3
    System::Call 'user32::MoveWindow(p ${HWND}, i r0, i r1, i r2, i r3, i 1)'
!macroend

; A GDI font sized in logical pixels, so the copy scales with the display the
; same way the layout does. Grayscale antialiasing (4) avoids colored fringes
; on small Chinese glyphs, including text over the violet action.
!macro InstallerPixelFont HANDLE SIZE WEIGHT
    System::Call 'kernel32::MulDiv(i -${SIZE}, i $InstallerDpi, i 96) i.s'
    Pop $0
    System::Call 'gdi32::CreateFontW(i r0, i 0, i 0, i 0, i ${WEIGHT}, i 0, i 0, i 0, i 1, i 0, i 0, i 4, i 0, w "$InstallerFontFace") p.s'
    Pop ${HANDLE}
!macroend

; Produces a closed rounded rectangle. Inputs and output must not use $0/$1.
!macro InstallerRoundPath PATH WIDTH HEIGHT DIAMETER
    System::Call 'gdiplus::GdipCreatePath(i 0, *p .s)'
    Pop ${PATH}
    IntOp $0 ${WIDTH} - ${DIAMETER}
    IntOp $1 ${HEIGHT} - ${DIAMETER}
    ; System.dll has no float argument type. The arc angles travel as IEEE-754
    ; bit patterns: 0x43340000 is 180.0f, 0x42B40000 is 90.0f, 0x43870000 is
    ; 270.0f. GdipAddPathArcI reads them back as REAL.
    System::Call 'gdiplus::GdipAddPathArcI(p ${PATH}, i 0, i 0, i ${DIAMETER}, i ${DIAMETER}, i 0x43340000, i 0x42B40000)'
    System::Call 'gdiplus::GdipAddPathArcI(p ${PATH}, i r0, i 0, i ${DIAMETER}, i ${DIAMETER}, i 0x43870000, i 0x42B40000)'
    System::Call 'gdiplus::GdipAddPathArcI(p ${PATH}, i r0, i r1, i ${DIAMETER}, i ${DIAMETER}, i 0, i 0x42B40000)'
    System::Call 'gdiplus::GdipAddPathArcI(p ${PATH}, i 0, i r1, i ${DIAMETER}, i ${DIAMETER}, i 0x42B40000, i 0x42B40000)'
    System::Call 'gdiplus::GdipClosePathFigure(p ${PATH})'
!macroend

; The path field is a borderless single-line edit inside a separate rounded
; frame, because an edit control cannot draw its own rounded border. The frame is
; a bitmap static painted once, here, at the measured DPI.
Function InstallerDrawEditFrame
    System::Call 'kernel32::MulDiv(i 384, i $InstallerDpi, i 96) i.s'
    Pop $R7
    System::Call 'kernel32::MulDiv(i ${INSTALLER_LOCATION_HEIGHT}, i $InstallerDpi, i 96) i.s'
    Pop $R8
    System::Call 'kernel32::MulDiv(i 16, i $InstallerDpi, i 96) i.s'
    Pop $R3
    System::Call 'gdiplus::GdipCreateBitmapFromScan0(i R7, i R8, i 0, i 0x26200A, p 0, *p .s)'
    Pop $R5
    System::Call 'gdiplus::GdipGetImageGraphicsContext(p R5, *p .s)'
    Pop $R4
    System::Call 'gdiplus::GdipGraphicsClear(p R4, i $InstallerBgArgb)'
    System::Call 'gdiplus::GdipSetSmoothingMode(p R4, i 4)'
    IntOp $R7 $R7 - 1
    IntOp $R8 $R8 - 1
    !insertmacro InstallerRoundPath $R6 $R7 $R8 $R3
    System::Call 'gdiplus::GdipCreatePen1(i $InstallerBorder, i 0x3F800000, i 2, *p .s)'
    Pop $R1
    System::Call 'gdiplus::GdipDrawPath(p R4, p R1, p R6)'
    System::Call 'gdiplus::GdipCreateHBITMAPFromBitmap(p R5, *p .s, i $InstallerBgArgb)'
    Pop $InstallerEditFrameBitmap
    SendMessage $InstallerEditFrame ${STM_SETIMAGE} ${IMAGE_BITMAP} $InstallerEditFrameBitmap
    System::Call 'gdiplus::GdipDeletePen(p R1)'
    System::Call 'gdiplus::GdipDeletePath(p R6)'
    System::Call 'gdiplus::GdipDeleteGraphics(p R4)'
    System::Call 'gdiplus::GdipDisposeImage(p R5)'
FunctionEnd

; ---------------------------------------------------------------------------
; The page itself -- one implementation, two phases
; ---------------------------------------------------------------------------

Function InstallerCreate
    nsDialogs::Create 1018
    Pop $InstallerDialog
    ${If} $InstallerDialog == error
        Abort
    ${EndIf}
    !insertmacro InstallerPlace $InstallerDialog 0 0 ${INSTALLER_WINDOW_SIZE} ${INSTALLER_WINDOW_SIZE}
    !insertmacro InstallerControlColors $HWNDPARENT
    !insertmacro InstallerControlColors $InstallerDialog
    StrCpy $InstallerFontFace "${INSTALLER_LATIN_FONT}"
    ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
        StrCpy $InstallerFontFace "${INSTALLER_FONT}"
    ${EndIf}
    !insertmacro InstallerPixelFont $InstallerFont ${INSTALLER_BUTTON_FONT_SIZE} 500
    !insertmacro InstallerPixelFont $InstallerSmallFont ${INSTALLER_STATUS_FONT_SIZE} 400
    !insertmacro InstallerPixelFont $InstallerTitleFont 20 500

    ; GdiplusStartupInput is {GdiplusVersion=1, DebugEventCallback=NULL,
    ; SuppressBackgroundThread=FALSE, SuppressExternalCodecs=FALSE}, allocated on
    ; System.dll's heap and handed straight to the call.
    System::Call '*(i 1, p 0, i 0, i 0) p.s'
    Pop $0
    System::Call 'gdiplus::GdiplusStartup(*p .s, p r0, p 0) i.s'
    Pop $2
    Pop $InstallerGdiToken
    System::Free $0
    ${If} $2 != 0
        MessageBox MB_OK|MB_ICONSTOP "$(INSTALLER_UI_ERROR)"
        SetErrorLevel 2
        Quit
    ${EndIf}

    ; The drag region, the two caption buttons, and the brand lockup. The drag
    ; region is a static rather than a bare hittest because it has to sit under
    ; the buttons in the z-order and must not swallow their clicks.
    ${NSD_CreateLabel} 0 0 0 0 ""
    Pop $4
    !insertmacro InstallerPlace $4 0 0 504 48
    ${NSD_AddStyle} $4 ${SS_NOTIFY}
    ${NSD_OnClick} $4 InstallerDrag
    !insertmacro InstallerControlColors $4

    ${NSD_CreateButton} 0 0 0 0 "$(INSTALLER_MINIMIZE)"
    Pop $4
    !insertmacro InstallerPlace $4 504 8 40 32
    SendMessage $4 ${WM_SETFONT} $InstallerSmallFont 1
    ${NSD_OnClick} $4 InstallerMinimize
    ${NSD_OnNotify} $4 InstallerPaintButton

    ${NSD_CreateButton} 0 0 0 0 "$(INSTALLER_CLOSE_GLYPH)"
    Pop $4
    !insertmacro InstallerPlace $4 548 8 40 32
    SendMessage $4 ${WM_SETFONT} $InstallerSmallFont 1
    ${NSD_OnClick} $4 InstallerClose
    ${NSD_OnNotify} $4 InstallerPaintButton

    ${NSD_CreateBitmap} 0 0 0 0 ""
    Pop $4
    !insertmacro InstallerPlace $4 0 ${INSTALLER_BRAND_Y} ${INSTALLER_WINDOW_SIZE} ${INSTALLER_BRAND_HEIGHT}
    StrCpy $5 "brand"
    ${If} $InstallerTheme == "dark"
        StrCpy $5 "brand-dark"
    ${EndIf}
    ${If} $InstallerDpi <= 96
        ${NSD_SetStretchedImage} $4 "$PLUGINSDIR\$5.bmp" $InstallerImage
    ${Else}
        ${NSD_SetStretchedImage} $4 "$PLUGINSDIR\$5-2x.bmp" $InstallerImage
    ${EndIf}

    ; Completion title and supporting copy have independent type hierarchy.
    ${NSD_CreateLabel} 0 0 0 0 "$(INSTALLER_FINISH_TITLE)"
    Pop $InstallerTitle
    !insertmacro InstallerPlace $InstallerTitle 48 336 504 28
    ${NSD_AddStyle} $InstallerTitle ${SS_CENTER}
    SendMessage $InstallerTitle ${WM_SETFONT} $InstallerTitleFont 1
    !insertmacro InstallerControlColors $InstallerTitle

    ; Supporting copy also serves as the inline path error on welcome.
    ${NSD_CreateLabel} 0 0 0 0 ""
    Pop $InstallerStatus
    !insertmacro InstallerPlace $InstallerStatus 48 ${INSTALLER_STATUS_Y} 504 ${INSTALLER_STATUS_HEIGHT}
    ${NSD_AddStyle} $InstallerStatus ${SS_CENTER}
    ; Keep wrapping for longer path validation messages.
    SendMessage $InstallerStatus ${WM_SETFONT} $InstallerSmallFont 1
    !insertmacro InstallerControlColors $InstallerStatus

    ; Collapsed state: one secondary button that reveals the path row.
    ${NSD_CreateButton} 0 0 0 0 "$(INSTALLER_CHOOSE_PATH)"
    Pop $InstallerChoose
    !insertmacro InstallerPlace $InstallerChoose 212 400 176 36
    ; The font the CONTROL carries and the font InstallerPaintButton selects have
    ; to be the same one, or the caption the paint draws is not the caption the
    ; control would have drawn -- a mismatch that only shows up as text sitting
    ; slightly wrong inside a centred rect.
    SendMessage $InstallerChoose ${WM_SETFONT} $InstallerSmallFont 1
    ${NSD_OnClick} $InstallerChoose InstallerExpandPath
    ${NSD_OnNotify} $InstallerChoose InstallerPaintButton

    ; Expanded state: the frame, the edit, and Browse.
    ${NSD_CreateBitmap} 0 0 0 0 ""
    Pop $InstallerEditFrame
    !insertmacro InstallerPlace $InstallerEditFrame 64 ${INSTALLER_LOCATION_Y} 384 ${INSTALLER_LOCATION_HEIGHT}
    Call InstallerDrawEditFrame
    ${NSD_CreateText} 0 0 0 0 "$InstallerPath"
    Pop $InstallerEdit
    ; Remove WS_BORDER; keep native ES_AUTOHSCROLL so long paths stay editable.
    System::Call 'user32::GetWindowLongW(p $InstallerEdit, i -16) i.s'
    Pop $0
    IntOp $0 $0 & 0xFF7FFFFF
    System::Call 'user32::SetWindowLongW(p $InstallerEdit, i -16, i r0)'
    System::Call 'user32::GetWindowLongW(p $InstallerEdit, i -20) i.s'
    Pop $0
    IntOp $0 $0 & 0xFFFFFDFF
    System::Call 'user32::SetWindowLongW(p $InstallerEdit, i -20, i r0)'
    SendMessage $InstallerEdit ${WM_SETFONT} $InstallerSmallFont 1
    ; Centre the single line vertically inside the 40-unit frame by measuring
    ; the font's height once and splitting the remainder.
    System::Call 'user32::GetDC(p $InstallerEdit) p.s'
    Pop $4
    System::Call 'gdi32::SelectObject(p r4, p $InstallerSmallFont) p.s'
    Pop $5
    System::Alloc 60
    Pop $6
    System::Call 'gdi32::GetTextMetricsW(p r4, p r6)'
    System::Call '*$6(i .s)'
    Pop $7
    System::Free $6
    System::Call 'gdi32::SelectObject(p r4, p r5)'
    System::Call 'user32::ReleaseDC(p $InstallerEdit, p r4)'
    System::Call 'kernel32::MulDiv(i 76, i $InstallerDpi, i 96) i.s'
    Pop $0
    System::Call 'kernel32::MulDiv(i ${INSTALLER_LOCATION_Y}, i $InstallerDpi, i 96) i.s'
    Pop $1
    System::Call 'kernel32::MulDiv(i 360, i $InstallerDpi, i 96) i.s'
    Pop $2
    System::Call 'kernel32::MulDiv(i ${INSTALLER_LOCATION_HEIGHT}, i $InstallerDpi, i 96) i.s'
    Pop $3
    IntOp $3 $3 - $7
    IntOp $3 $3 / 2
    IntOp $1 $1 + $3
    System::Call 'user32::MoveWindow(p $InstallerEdit, i r0, i r1, i r2, i r7, i 1)'
    System::Call 'user32::SetWindowPos(p $InstallerEdit, p 0, i 0, i 0, i 0, i 0, i 0x33)'
    SendMessage $InstallerEdit ${EM_SETLIMITTEXT} 180 0
    !insertmacro InstallerControlColors $InstallerEdit
    ${NSD_OnChange} $InstallerEdit InstallerPathChanged

    ${NSD_CreateButton} 0 0 0 0 "$(INSTALLER_BROWSE)"
    Pop $InstallerBrowse
    !insertmacro InstallerPlace $InstallerBrowse 456 ${INSTALLER_LOCATION_Y} 80 ${INSTALLER_LOCATION_HEIGHT}
    SendMessage $InstallerBrowse ${WM_SETFONT} $InstallerSmallFont 1
    ${NSD_OnClick} $InstallerBrowse InstallerBrowsePath
    ${NSD_OnNotify} $InstallerBrowse InstallerPaintButton

    ; Success state: the launch decision. BS_AUTOCHECKBOX keeps its native
    ; state, text, keyboard handling and accessibility role; only the painting
    ; is ours.
    ${NSD_CreateCheckbox} 0 0 0 0 "$(INSTALLER_LAUNCH)"
    Pop $InstallerLaunch
    SendMessage $InstallerLaunch ${WM_SETFONT} $InstallerSmallFont 1
    System::Call 'user32::GetDC(p $InstallerLaunch) p.s'
    Pop $4
    System::Call 'gdi32::SelectObject(p r4, p $InstallerSmallFont) p.s'
    Pop $5
    StrLen $0 "$(INSTALLER_LAUNCH)"
    System::Alloc 8
    Pop $6
    System::Call 'gdi32::GetTextExtentPoint32W(p r4, w "$(INSTALLER_LAUNCH)", i r0, p r6)'
    System::Call '*$6(i .s)'
    Pop $7
    System::Free $6
    System::Call 'gdi32::SelectObject(p r4, p r5)'
    System::Call 'user32::ReleaseDC(p $InstallerLaunch, p r4)'
    System::Call 'kernel32::MulDiv(i 42, i $InstallerDpi, i 96) i.s'
    Pop $2
    IntOp $2 $2 + $7
    IntOp $0 $InstallerSize - $2
    IntOp $0 $0 / 2
    System::Call 'kernel32::MulDiv(i 400, i $InstallerDpi, i 96) i.s'
    Pop $1
    System::Call 'kernel32::MulDiv(i 32, i $InstallerDpi, i 96) i.s'
    Pop $3
    System::Call 'user32::MoveWindow(p $InstallerLaunch, i r0, i r1, i r2, i r3, i 1)'
    !insertmacro InstallerControlColors $InstallerLaunch
    ${NSD_OnNotify} $InstallerLaunch InstallerPaintCheckbox
    ${NSD_Check} $InstallerLaunch

    ; The action stays anchored on both pages. The bottom band is reserved for
    ; path validation, keeping transient errors clear of the controls.

    ${NSD_CreateButton} 0 0 0 0 "$(INSTALLER_INSTALL)"
    Pop $InstallerButton
    !insertmacro InstallerPlace $InstallerButton 188 456 224 48
    SendMessage $InstallerButton ${WM_SETFONT} $InstallerFont 1
    ${NSD_OnClick} $InstallerButton InstallerStart
    ${NSD_OnNotify} $InstallerButton InstallerPaintButton

    Call InstallerRender
    ShowWindow $InstallerDialog 5
    ShowWindow $HWNDPARENT 5
    ${If} $InstallerPhase == "welcome"
        System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerPresentWelcome(p $HWNDPARENT) i.s ?c'
        Pop $0
    ${EndIf}
    nsDialogs::Show
    ${NSD_KillTimer} InstallerValidateEditedPath
    ${NSD_FreeImage} $InstallerImage
    ${NSD_FreeImage} $InstallerEditFrameBitmap
    System::Call 'gdiplus::GdiplusShutdown(p $InstallerGdiToken)'
    System::Call 'gdi32::DeleteObject(p $InstallerFont)'
    System::Call 'gdi32::DeleteObject(p $InstallerSmallFont)'
    System::Call 'gdi32::DeleteObject(p $InstallerTitleFont)'
FunctionEnd

; Everything phase-dependent happens here, so a control can never be left in the
; state the previous page wanted.
Function InstallerRender
    ShowWindow $InstallerChoose 0
    ShowWindow $InstallerEdit 0
    ShowWindow $InstallerEditFrame 0
    ShowWindow $InstallerBrowse 0
    ShowWindow $InstallerLaunch 0
    ShowWindow $InstallerStatus 0
    ShowWindow $InstallerTitle 0
    ${If} $InstallerPhase == "success"
        ${NSD_SetText} $InstallerButton "$(INSTALLER_FINISH)"
        ${NSD_SetText} $InstallerStatus "$(INSTALLER_FINISH_BODY)"
        !insertmacro InstallerPlace $InstallerStatus 48 372 504 22
        !insertmacro InstallerMutedColors $InstallerStatus
        ShowWindow $InstallerTitle 5
        ShowWindow $InstallerStatus 5
        ShowWindow $InstallerLaunch 5
    ${Else}
        ${NSD_SetText} $InstallerButton "$(INSTALLER_INSTALL)"
        ${If} $InstallerExpanded == 1
            ShowWindow $InstallerEditFrame 5
            ShowWindow $InstallerEdit 5
            ShowWindow $InstallerBrowse 5
        ${Else}
            ShowWindow $InstallerChoose 5
        ${EndIf}
    ${EndIf}
FunctionEnd

; The primary button is the only way forward. NSIS's own Next button is hidden
; by InstallerGuiInit, and a sent "next" is what a click on it would have done.
Function InstallerStart
    Pop $0
    SendMessage $HWNDPARENT ${WM_NOTIFY_OUTER_NEXT} 1 0
FunctionEnd

; Leave callbacks also run when Enter activates NSIS's hidden default button, so
; the path is read from the control rather than from whatever the click handler
; happened to leave behind.
Function InstallerWelcomeLeave
    ${NSD_GetText} $InstallerEdit $InstallerPath
    Call InstallerPreflight
    ${If} $InstallerError != ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "$InstallerError"
        Abort
    ${EndIf}
FunctionEnd

Function InstallerExpandPath
    Pop $0
    StrCpy $InstallerExpanded 1
    Call InstallerRender
    SendMessage $InstallerEdit ${EM_SETSEL} 0 0
    System::Call 'user32::SetFocus(p $InstallerEdit)'
FunctionEnd

Function InstallerPathChanged
    Pop $0
    ${NSD_CreateTimer} InstallerValidateEditedPath 450
FunctionEnd

; Validating on every keystroke would run a path walk and a temp-file write per
; character, so the check is debounced and only the message is refreshed.
Function InstallerValidateEditedPath
    ${NSD_KillTimer} InstallerValidateEditedPath
    ${If} $InstallerPhase != "welcome"
        Return
    ${EndIf}
    ${NSD_GetText} $InstallerEdit $InstallerPath
    Call InstallerValidatePath
    ${If} $InstallerError == ""
        ${NSD_SetText} $InstallerStatus ""
        ShowWindow $InstallerStatus 0
        Return
    ${EndIf}
    ; The message takes the bottom band the licence link used to occupy -- it is
    ; the only thing this page ever shows down there now, so it gets the whole
    ; width and two lines rather than being tucked beside a link.
    ${NSD_SetText} $InstallerStatus "$InstallerError"
    !insertmacro InstallerPlace $InstallerStatus 64 ${INSTALLER_STATUS_Y} 472 44
    ${If} $InstallerTheme == "dark"
        SetCtlColors $InstallerStatus F6A6AE 151517
    ${Else}
        SetCtlColors $InstallerStatus A72D40 FFFFFF
    ${EndIf}
    ShowWindow $InstallerStatus 5
FunctionEnd

Function InstallerBrowsePath
    Pop $0
    nsDialogs::SelectFolderDialog "$(INSTALLER_CHOOSE_PATH)" "$InstallerPath"
    Pop $0
    ${If} $0 != "error"
        ${NSD_SetText} $InstallerEdit "$0"
        Call InstallerValidateEditedPath
    ${EndIf}
FunctionEnd

Function InstallerDrag
    Pop $0
    System::Call 'user32::ReleaseCapture()'
    SendMessage $HWNDPARENT ${WM_NCLBUTTONDOWN} 2 0
FunctionEnd

Function InstallerMinimize
    Pop $0
    ShowWindow $HWNDPARENT 6
FunctionEnd

Function InstallerClose
    Pop $0
    System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_CLOSE}, p 0, p 0)'
FunctionEnd

; NM_CUSTOMDRAW keeps native button focus, keyboard input and accessible text;
; only the pixels are ours. The NMCUSTOMDRAW layout below is the x86 one, which
; is also what a 32-bit NSIS sees on x64 Windows: NMHDR (3 fields), dwDrawStage,
; hdc, RECT (4 ints), dwItemSpec, uItemState.
;
; THE RECT IS THE WHOLE POINT OF THIS FUNCTION, AND IT WAS THE BUG.
;
; The previous version read the draw stage, the HDC and the item state out of the
; struct, then allocated a RECT, called GetClientRect into it -- and never read
; anything back out. $R7 and $R8, which InstallerRoundPath takes as its width and
; height, still held whatever the previous call had left in them. So the rounded
; purple surface was built from stale numbers (a fragment in the corner instead
; of the button), the caption was drawn into the real rect but against that
; fragment's edge, and the handler returned CDRF_SKIPDEFAULT anyway -- telling
; Windows "already painted" and suppressing the native button underneath. The
; welcome page's button came up clipped; the finish page's Finish button was
; essentially blank.
;
; So: read the control's REAL client rect, read it into the registers that
; consume it, and use that one rect for the fill, the rounded surface, the border
; and the caption. And if that read cannot be trusted -- an empty result, the
; shape a failed System::Call leaves behind, or a degenerate rectangle -- return
; CDRF_DODEFAULT instead: a plain system button is a far better failure mode than
; a blank one.
;
; THE INTERACTION STATE IS RESOLVED, NOT ASSUMED.
;
;   A button that does not change when the pointer is over it, or while it is
;   held down, is most of what reads as cheap, and this handler used to test two
;   of the four states with a bare mask against one source. It now resolves all
;   four -- disabled, hot, pressed, focused -- into one bit field before anything
;   is drawn, and it takes them from two sources on purpose:
;
;     * the CDIS_* bits in the NM_CUSTOMDRAW the button sent us (CDIS_SELECTED
;       0x01, CDIS_DISABLED 0x04, CDIS_FOCUS 0x10, CDIS_HOT 0x40) -- what
;       comctl32 says about the frame it is asking us to draw;
;     * BM_GETSTATE on the control itself (BST_PUSHED 0x04, BST_FOCUS 0x08,
;       BST_HOT 0x200) -- what the button's own state machine says. Whether
;       comctl32 publishes CDIS_HOT at the pre-paint stage is a comctl32
;       implementation detail, and this is the half that does not depend on it;
;     * IsWindowEnabled settles disabled, the one state that must never be able
;       to look enabled while the control is inert.
;
;   The bits are OR-ed into $4 -- a plain user variable, since every register in
;   this function is spoken for and $R5 in particular becomes the GDI+ Graphics
;   object a few lines later -- rather than compared in place, because
;   CDIS_SELECTED and BST_CHECKED are both 0x01 and CDIS_DISABLED and BST_PUSHED
;   are both 0x04: the two namespaces collide, and only a translation makes them
;   safe to combine.
Function InstallerPaintButton
    Pop $R0
    Pop $R1
    Pop $R2
    ${If} $R1 != -12
        ; Not NM_CUSTOMDRAW. Return nothing rather than a value: the nsDialogs
        ; callback protocol only publishes a return value when ${NSD_Return} ran.
        Return
    ${EndIf}
    System::Call '*$R2(p, p, i, i .s, p .s, i, i, i, i, p, i .s)'
    Pop $R3
    Pop $R4
    Pop $R9
    ${If} $R3 != 1
        ; Only the pre-paint stage draws; the item stages would double-paint.
        Return
    ${EndIf}
    System::Call 'gdi32::SaveDC(p R4)'
    ; The control's client rect, allocated on System.dll's heap. Fields 1 and 2
    ; are left uncaptured -- a client rect always starts at 0,0, and the DC this
    ; paints on is the control's own -- so the two numbers the path builder needs
    ; are the two that are read: right is the width, bottom is the height.
    System::Alloc 16
    Pop $R2
    System::Call 'user32::GetClientRect(p R0, p R2)'
    System::Call '*$R2(i, i, i .s, i .s)'
    Pop $R7
    Pop $R8
    ; A failed call leaves an EMPTY value, not "0", and an empty operand reads as
    ; 0 in the comparison below -- which is why both are tested. The rect itself
    ; is what the fill, the path and the caption all use from here on.
    ${If} $R7 == ""
    ${OrIf} $R8 == ""
    ${OrIf} $R7 <= 0
    ${OrIf} $R8 <= 0
        System::Free $R2
        System::Call 'gdi32::RestoreDC(p R4, i -1)'
        ${NSD_Return} 0
    ${EndIf}

    ; ---- interaction state: 1 disabled, 2 hot, 4 pressed, 8 focused --------
    StrCpy $4 0
    System::Call 'user32::IsWindowEnabled(p R0) i.s'
    Pop $R1
    ${If} $R1 == 0
        IntOp $4 $4 | 1
    ${EndIf}
    IntOp $R1 $R9 & 0x40
    ${If} $R1 != 0
        IntOp $4 $4 | 2
    ${EndIf}
    IntOp $R1 $R9 & 0x01
    ${If} $R1 != 0
        IntOp $4 $4 | 4
    ${EndIf}
    IntOp $R1 $R9 & 0x10
    ${If} $R1 != 0
        IntOp $4 $4 | 8
    ${EndIf}
    ; One message, three bits, read from a single value so the state cannot
    ; change halfway through the test. Measured on this build by reading
    ; BM_GETSTATE from outside the process: WM_LBUTTONDOWN gives 0x006C
    ; (pushed + focus) and the caption's fill follows it to #5C2CD8; a focus
    ; change gives 0x0008; and a REAL pointer move onto the control gives 0x0200
    ; (hot), which paints the hover accent. A synthetic WM_MOUSEMOVE leaves the state at
    ; 0x0000 -- comctl32's button tracks the pointer, not the message -- which is
    ; why the hover evidence is photographed with a real cursor move.
    System::Call 'user32::SendMessageW(p R0, i 0xF2, p 0, p 0) i.s'
    Pop $R9
    IntOp $R1 $R9 & 0x200
    ${If} $R1 != 0
        IntOp $4 $4 | 2
    ${EndIf}
    IntOp $R1 $R9 & 0x004
    ${If} $R1 != 0
        IntOp $4 $4 | 4
    ${EndIf}
    IntOp $R1 $R9 & 0x008
    ${If} $R1 != 0
        IntOp $4 $4 | 8
    ${EndIf}

    ; The client rect, in page colours, first: every pixel the rounded surface
    ; below does not cover is then page background rather than a stale frame.
    System::Call 'gdi32::CreateSolidBrush(i $InstallerBgColorref) p.s'
    Pop $R3
    System::Call 'user32::FillRect(p R4, p R2, p R3)'
    System::Call 'gdi32::DeleteObject(p R3)'
    ; Fill per state. Disabled is tested LAST so it wins over a stale hot or
    ; pressed bit -- an inert control must never be drawn as an active one.
    StrCpy $R3 $InstallerBgArgb
    ${If} $R0 == $InstallerButton
        StrCpy $R3 $InstallerPrimary
        IntOp $R1 $4 & 2
        ${If} $R1 != 0
            StrCpy $R3 $InstallerPrimaryHover
        ${EndIf}
        IntOp $R1 $4 & 4
        ${If} $R1 != 0
            StrCpy $R3 $InstallerPrimaryPressed
        ${EndIf}
        IntOp $R1 $4 & 1
        ${If} $R1 != 0
            StrCpy $R3 $InstallerDisabledFill
        ${EndIf}
    ${Else}
        IntOp $R1 $4 & 2
        ${If} $R1 != 0
            StrCpy $R3 $InstallerControlHover
        ${EndIf}
        IntOp $R1 $4 & 4
        ${If} $R1 != 0
            StrCpy $R3 $InstallerControlPressed
        ${EndIf}
        IntOp $R1 $4 & 1
        ${If} $R1 != 0
            StrCpy $R3 $InstallerBgArgb
        ${EndIf}
    ${EndIf}
    ; The border colour rides in $R9, which the state read has finished with.
    StrCpy $R9 $InstallerBorder
    IntOp $R1 $4 & 1
    ${If} $R1 != 0
        StrCpy $R9 $InstallerDisabledBorder
    ${EndIf}
    System::Call 'gdiplus::GdipCreateSolidFill(i R3, *p .s)'
    Pop $R1
    System::Call 'gdiplus::GdipCreateFromHDC(p R4, *p .s)'
    Pop $R5
    System::Call 'gdiplus::GdipSetSmoothingMode(p R5, i 4)'
    System::Call 'gdiplus::GdipSetPixelOffsetMode(p R5, i 4)'
    System::Call 'kernel32::MulDiv(i ${INSTALLER_BUTTON_DIAMETER}, i $InstallerDpi, i 96) i.s'
    Pop $R3
    ; The location disclosure is quiet at rest, with hover and focus feedback.
    ; The browse action shares the input's smaller corner and fine border.
    ${If} $R0 == $InstallerBrowse
    ${OrIf} $R0 == $InstallerChoose
        System::Call 'kernel32::MulDiv(i 16, i $InstallerDpi, i 96) i.s'
        Pop $R3
    ${EndIf}
    !insertmacro InstallerRoundPath $R6 $R7 $R8 $R3
    System::Call 'gdiplus::GdipFillPath(p R5, p R1, p R6)'
    System::Call 'gdiplus::GdipDeleteBrush(p R1)'
    ${If} $R0 == $InstallerBrowse
        System::Call 'gdiplus::GdipCreatePen1(i R9, i 0x3F800000, i 2, *p .s)'
        Pop $2
        System::Call 'gdiplus::GdipDrawPath(p R5, p r2, p R6)'
        System::Call 'gdiplus::GdipDeletePen(p r2)'
    ${EndIf}
    System::Call 'gdiplus::GdipDeletePath(p R6)'

    ; ---- keyboard focus ring ------------------------------------------------
    ; Drawn here rather than left to DrawFocusRect, which is what the reference
    ; does and what the previous version of this file inherited: a dotted XOR
    ; rectangle is invisible against the accent fill (it inverts a saturated
    ; violet into another saturated violet) and reads as a rendering artefact
    ; rather than as "the keyboard is here". The ring is inset so it never
    ; collides with the corner radius, and its colour is chosen per button: the
    ; page colour on the accent-filled primary, the accent on the page-coloured
    ; secondary controls, so it has contrast in both themes.
    ;
    ; The geometry lives in USER variables ($5-$9) and is passed as `r5`..`r9`,
    ; which is not a style choice: in a System::Call format string `rN` means the
    ; user variable $N and `RN` means the register $RN, and the first version of
    ; this block wrote `r1`/`r3` while computing into $R1/$R3. The arcs were then
    ; placed from whatever $1 and $3 happened to hold -- a lens across the middle
    ; of the button, which is exactly what the screenshot showed.
    IntOp $R1 $4 & 8
    ${If} $R1 != 0
        ${If} $R0 == $InstallerButton
            StrCpy $9 $InstallerBgArgb
        ${Else}
            StrCpy $9 $InstallerPrimary
        ${EndIf}
        System::Call 'kernel32::MulDiv(i 3, i $InstallerDpi, i 96) i.s'
        Pop $5
        StrCpy $7 $R7
        IntOp $7 $7 - $5
        IntOp $7 $7 - $5
        StrCpy $8 $R8
        IntOp $8 $8 - $5
        IntOp $8 $8 - $5
        ; A corner radius is a diameter, so the ring's is the button's minus the
        ; inset on both sides; floored at 4 device pixels so a small control
        ; still gets a corner instead of a degenerate zero-radius arc.
        System::Call 'kernel32::MulDiv(i ${INSTALLER_BUTTON_DIAMETER}, i $InstallerDpi, i 96) i.s'
        Pop $6
        ${If} $R0 == $InstallerBrowse
        ${OrIf} $R0 == $InstallerChoose
            System::Call 'kernel32::MulDiv(i 16, i $InstallerDpi, i 96) i.s'
            Pop $6
        ${EndIf}
        IntOp $6 $6 - $5
        IntOp $6 $6 - $5
        ${If} $6 < 4
            StrCpy $6 4
        ${EndIf}
        System::Call 'gdiplus::GdipCreatePath(i 0, *p .s)'
        Pop $R6
        ; The four arcs, placed by hand because the shared macro always builds at
        ; the origin and GDI+'s only path translation takes REAL arguments, which
        ; System::Call cannot pass. Same IEEE-754 angle conventions as the macro:
        ; 180.0f, 90.0f, 270.0f, 0.0f.
        System::Call 'gdiplus::GdipAddPathArcI(p R6, i r5, i r5, i r6, i r6, i 0x43340000, i 0x42B40000)'
        IntOp $0 $7 + $5
        IntOp $0 $0 - $6
        System::Call 'gdiplus::GdipAddPathArcI(p R6, i r0, i r5, i r6, i r6, i 0x43870000, i 0x42B40000)'
        IntOp $1 $8 + $5
        IntOp $1 $1 - $6
        System::Call 'gdiplus::GdipAddPathArcI(p R6, i r0, i r1, i r6, i r6, i 0, i 0x42B40000)'
        System::Call 'gdiplus::GdipAddPathArcI(p R6, i r5, i r1, i r6, i r6, i 0x42B40000, i 0x42B40000)'
        System::Call 'gdiplus::GdipClosePathFigure(p R6)'
        ; 0x40000000 is the IEEE-754 bit pattern for 2.0f, which is what
        ; GdipCreatePen1's width argument actually is: a REAL. Passing an integer
        ; 2 there instead reads as a denormal float and draws nothing, which is
        ; the same trap the border pen above avoids by writing the pattern out.
        ; The ring is therefore a fixed 2 device pixels, stronger than the border,
        ; while the geometry around it still scales with $InstallerDpi.
        System::Call 'gdiplus::GdipCreatePen1(i r9, i 0x40000000, i 2, *p .s)'
        Pop $R1
        System::Call 'gdiplus::GdipDrawPath(p R5, p R1, p R6)'
        System::Call 'gdiplus::GdipDeletePen(p R1)'
        System::Call 'gdiplus::GdipDeletePath(p R6)'
    ${EndIf}
    System::Call 'gdiplus::GdipDeleteGraphics(p R5)'

    System::Call 'gdi32::SetBkMode(p R4, i 1)'
    ${If} $R0 == $InstallerButton
        System::Call 'gdi32::SetTextColor(p R4, i $InstallerButtonText)'
    ${ElseIf} $R0 == $InstallerChoose
        System::Call 'gdi32::SetTextColor(p R4, i $InstallerMutedColorref)'
    ${Else}
        System::Call 'gdi32::SetTextColor(p R4, i $InstallerTextColorref)'
    ${EndIf}
    ; One muted caption for every disabled control, whatever its normal ink: it
    ; has to be readable against the disabled fill, which is a different colour
    ; from both the accent and the page.
    IntOp $R1 $4 & 1
    ${If} $R1 != 0
        System::Call 'gdi32::SetTextColor(p R4, i $InstallerButtonTextDisabled)'
    ${EndIf}
    System::Call 'gdi32::SelectObject(p R4, p $InstallerSmallFont)'
    ${If} $R0 == $InstallerButton
        System::Call 'gdi32::SelectObject(p R4, p $InstallerFont)'
    ${EndIf}
    ${NSD_GetText} $R0 $R3
    ; DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX -- centred in the SAME rect
    ; the surface was drawn in, at the same size the control was given with
    ; WM_SETFONT in InstallerCreate.
    System::Call 'user32::DrawTextW(p R4, w R3, i -1, p R2, i 0x825)'
    System::Call 'gdi32::RestoreDC(p R4, i -1)'
    System::Free $R2
    ${NSD_Return} 4
FunctionEnd

; The checkbox is drawn as a rounded box with a tick rather than a themed
; square, so it matches the button surfaces. BS_AUTOCHECKBOX still owns the
; state; this only reads it.
Function InstallerPaintCheckbox
    Pop $R0
    Pop $R1
    Pop $R2
    ${If} $R1 != -12
        Return
    ${EndIf}
    System::Call '*$R2(p, p, i, i .s, p .s, i, i, i, i, p, i .s)'
    Pop $R3
    Pop $R4
    Pop $R9
    ${If} $R3 != 1
        Return
    ${EndIf}
    System::Call 'gdi32::SaveDC(p R4)'
    System::Alloc 16
    Pop $R2
    System::Call 'user32::GetClientRect(p R0, p R2)'
    ; The rect is read back before anything is drawn from it, and the same rule as
    ; InstallerPaintButton applies: no CDRF_SKIPDEFAULT unless the client rect is
    ; real and about to be filled. An empty value is what a refused call leaves,
    ; not "0", so both are tested.
    System::Call '*$R2(i, i, i .s, i .s)'
    Pop $0
    Pop $1
    ${If} $0 == ""
    ${OrIf} $1 == ""
    ${OrIf} $0 <= 0
    ${OrIf} $1 <= 0
        System::Free $R2
        System::Call 'gdi32::RestoreDC(p R4, i -1)'
        ${NSD_Return} 0
    ${EndIf}
    System::Call 'gdi32::CreateSolidBrush(i $InstallerBgColorref) p.s'
    Pop $R3
    System::Call 'user32::FillRect(p R4, p R2, p R3)'
    System::Call 'gdi32::DeleteObject(p R3)'
    System::Call 'kernel32::MulDiv(i 8, i $InstallerDpi, i 96) i.s'
    Pop $2
    System::Call 'kernel32::MulDiv(i 7, i $InstallerDpi, i 96) i.s'
    Pop $3
    System::Call 'gdi32::SetViewportOrgEx(p R4, i r2, i r3, p 0)'
    System::Call 'gdiplus::GdipCreateFromHDC(p R4, *p .s)'
    Pop $R5
    System::Call 'gdiplus::GdipSetSmoothingMode(p R5, i 4)'
    System::Call 'kernel32::MulDiv(i 18, i $InstallerDpi, i 96) i.s'
    Pop $R7
    StrCpy $R8 $R7
    System::Call 'kernel32::MulDiv(i 6, i $InstallerDpi, i 96) i.s'
    Pop $R3
    !insertmacro InstallerRoundPath $R6 $R7 $R8 $R3
    ${NSD_GetState} $R0 $R8
    StrCpy $R3 $InstallerBgArgb
    ${If} $R8 == ${BST_CHECKED}
        StrCpy $R3 $InstallerPrimary
    ${EndIf}
    System::Call 'gdiplus::GdipCreateSolidFill(i R3, *p .s)'
    Pop $R1
    System::Call 'gdiplus::GdipFillPath(p R5, p R1, p R6)'
    System::Call 'gdiplus::GdipDeleteBrush(p R1)'
    ${If} $R8 != ${BST_CHECKED}
        System::Call 'gdiplus::GdipCreatePen1(i $InstallerBorder, i 0x40000000, i 2, *p .s)'
        Pop $R1
        System::Call 'gdiplus::GdipDrawPath(p R5, p R1, p R6)'
        System::Call 'gdiplus::GdipDeletePen(p R1)'
    ${EndIf}
    System::Call 'gdiplus::GdipDeletePath(p R6)'

    ; ---- keyboard focus ring ------------------------------------------------
    ; The same treatment the buttons get, drawn around the box rather than
    ; around the label. The native indicator here is DrawFocusRect on the text
    ; rect, and the screenshot it produced is the reason this exists: a dotted
    ; XOR rectangle hugging the glyphs, sitting a couple of pixels into them,
    ; read as a rendering artefact rather than as "the keyboard is here".
    ;
    ; The box is drawn in a viewport shifted to (8,7); the ring is that viewport
    ; shifted out by the inset, so the shared round-path macro (which always
    ; builds at the origin) can draw it without a path transform -- GDI+'s only
    ; translation takes REAL arguments, and System::Call cannot pass those.
    IntOp $R1 $R9 & 0x10
    System::Call 'user32::SendMessageW(p R0, i 0xF2, p 0, p 0) i.s'
    Pop $R3
    IntOp $R3 $R3 & 0x008
    ${If} $R1 != 0
    ${OrIf} $R3 != 0
        System::Call 'kernel32::MulDiv(i 4, i $InstallerDpi, i 96) i.s'
        Pop $5
        StrCpy $7 $R7
        IntOp $7 $7 + $5
        IntOp $7 $7 + $5
        StrCpy $8 $R7
        System::Call 'kernel32::MulDiv(i 6, i $InstallerDpi, i 96) i.s'
        Pop $6
        IntOp $6 $6 + $5
        IntOp $6 $6 + $5
        IntOp $0 $2 - $5
        IntOp $1 $3 - $5
        System::Call 'gdi32::SetViewportOrgEx(p R4, i r0, i r1, p 0)'
        !insertmacro InstallerRoundPath $R6 $7 $8 $6
        System::Call 'gdiplus::GdipCreatePen1(i $InstallerPrimary, i 0x40000000, i 2, *p .s)'
        Pop $R1
        System::Call 'gdiplus::GdipDrawPath(p R5, p R1, p R6)'
        System::Call 'gdiplus::GdipDeletePen(p R1)'
        System::Call 'gdiplus::GdipDeletePath(p R6)'
        System::Call 'gdi32::SetViewportOrgEx(p R4, i r2, i r3, p 0)'
    ${EndIf}
    System::Call 'gdiplus::GdipDeleteGraphics(p R5)'
    ${If} $R8 == ${BST_CHECKED}
        System::Call 'kernel32::MulDiv(i 2, i $InstallerDpi, i 96) i.s'
        Pop $0
        System::Call 'gdi32::CreatePen(i 0, i r0, i $InstallerButtonText) p.s'
        Pop $R1
        System::Call 'gdi32::SelectObject(p R4, p R1) p.s'
        Pop $R3
        System::Call 'kernel32::MulDiv(i 4, i $InstallerDpi, i 96) i.s'
        Pop $0
        System::Call 'kernel32::MulDiv(i 9, i $InstallerDpi, i 96) i.s'
        Pop $1
        System::Call 'gdi32::MoveToEx(p R4, i r0, i r1, p 0)'
        System::Call 'kernel32::MulDiv(i 8, i $InstallerDpi, i 96) i.s'
        Pop $0
        System::Call 'kernel32::MulDiv(i 13, i $InstallerDpi, i 96) i.s'
        Pop $1
        System::Call 'gdi32::LineTo(p R4, i r0, i r1)'
        System::Call 'kernel32::MulDiv(i 14, i $InstallerDpi, i 96) i.s'
        Pop $0
        System::Call 'kernel32::MulDiv(i 5, i $InstallerDpi, i 96) i.s'
        Pop $1
        System::Call 'gdi32::LineTo(p R4, i r0, i r1)'
        System::Call 'gdi32::SelectObject(p R4, p R3)'
        System::Call 'gdi32::DeleteObject(p R1)'
    ${EndIf}
    System::Call 'gdi32::SetViewportOrgEx(p R4, i 0, i 0, p 0)'
    System::Call 'kernel32::MulDiv(i 34, i $InstallerDpi, i 96) i.s'
    Pop $0
    ; Indent the label past the box: the RECT is rewritten in place.
    System::Call '*$R2(i r0)'
    System::Call 'gdi32::SetBkMode(p R4, i 1)'
    System::Call 'gdi32::SetTextColor(p R4, i $InstallerTextColorref)'
    System::Call 'gdi32::SelectObject(p R4, p $InstallerSmallFont)'
    ; DT_LEFT|DT_VCENTER|DT_SINGLELINE
    System::Call 'user32::DrawTextW(p R4, w "$(INSTALLER_LAUNCH)", i -1, p R2, i 0x24)'
    System::Call 'gdi32::RestoreDC(p R4, i -1)'
    System::Free $R2
    ${NSD_Return} 4
FunctionEnd

; ---------------------------------------------------------------------------
; Path validation
; ---------------------------------------------------------------------------
;
; The welcome page lets the user type or pick the install folder, so this is the
; only thing standing between a typo and a half-written installation. It runs
; twice -- when the welcome page is left, and again from the InstFiles PRE
; callback, because NSIS's install-mode page overwrites $INSTDIR in between.

; Reject reparse points and reserved names along the selected path before any
; write or cleanup happens.
Function InstallerValidatePath
    StrCpy $InstallerError "$(INSTALLER_PATH_INVALID)"
    StrLen $0 $InstallerPath
    ${If} $0 < 4
    ${OrIf} $0 > 180
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath 2 1
    ${If} $0 != ":\"
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath 3
    System::Call 'kernel32::GetDriveTypeW(w r0) i.s'
    Pop $1
    ${If} $1 != 3
        Return
    ${EndIf}
    StrCpy $1 3
    ${Do}
        StrCpy $0 $InstallerPath 1 $1
        ${If} $0 == ""
            ${ExitDo}
        ${EndIf}
        ${If} $0 == ':'
        ${OrIf} $0 == '*'
        ${OrIf} $0 == '?'
        ${OrIf} $0 == '"'
        ${OrIf} $0 == '<'
        ${OrIf} $0 == '>'
        ${OrIf} $0 == '|'
        ${OrIf} $0 == '/'
        ${OrIf} $0 == '$\r'
        ${OrIf} $0 == '$\n'
        ${OrIf} $0 == '$\t'
            Return
        ${EndIf}
        IntOp $1 $1 + 1
    ${Loop}
    StrCpy $2 $InstallerPath
    ${Do}
        StrLen $0 $2
        ${If} $0 <= 3
            ${ExitDo}
        ${EndIf}
        ${GetFileName} $2 $3
        StrCpy $0 $3 1 -1
        ${If} $3 == ""
        ${OrIf} $0 == "."
        ${OrIf} $0 == " "
            Return
        ${EndIf}
        ; Windows reserves device names even when they carry an extension.
        StrCpy $5 ""
        StrCpy $6 0
        ${Do}
            StrCpy $0 $3 1 $6
            ${If} $0 == ""
            ${OrIf} $0 == "."
                ${ExitDo}
            ${EndIf}
            StrCpy $5 "$5$0"
            IntOp $6 $6 + 1
        ${Loop}
        ${If} $5 == "CON"
        ${OrIf} $5 == "PRN"
        ${OrIf} $5 == "AUX"
        ${OrIf} $5 == "NUL"
            Return
        ${EndIf}
        StrCpy $0 $5 3
        ${If} $0 == "COM"
        ${OrIf} $0 == "LPT"
            StrLen $0 $5
            StrCpy $5 $5 1 3
            ${If} $0 == 4
            ${AndIf} $5 >= 1
            ${AndIf} $5 <= 9
                Return
            ${EndIf}
        ${EndIf}
        ; A reparse point anywhere on the way down would let the install escape
        ; the folder the user chose.
        System::Call 'kernel32::GetFileAttributesW(w r2) i.s'
        Pop $0
        ${If} $0 != -1
            IntOp $1 $0 & 0x400
            IntOp $0 $0 & 0x10
            ${If} $1 != 0
            ${OrIf} $0 == 0
                Return
            ${EndIf}
        ${EndIf}
        ${If} $2 == $WINDIR
        ${OrIf} $2 == $PROGRAMFILES32
        ${OrIf} $2 == $PROGRAMFILES64
        ${OrIf} $2 == $PROFILE
        ${OrIf} $2 == $LOCALAPPDATA
            ; Ancestors PROFILE and LOCALAPPDATA are allowed; the selected
            ; directory itself is not.
            ${If} $2 == $WINDIR
            ${OrIf} $2 == $PROGRAMFILES32
            ${OrIf} $2 == $PROGRAMFILES64
            ${OrIf} $2 == $InstallerPath
                Return
            ${EndIf}
        ${EndIf}
        ${GetParent} $2 $2
    ${Loop}
    System::Call 'kernel32::GetFullPathNameW(w "$InstallerPath", i ${NSIS_MAX_STRLEN}, w .s, p 0) i.s'
    Pop $0
    Pop $4
    ${If} $0 == 0
    ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
        Return
    ${EndIf}
    StrCpy $InstallerPath $4
    StrCpy $InstallerError ""
FunctionEnd

; A new installation requires an empty directory; an update requires the
; registered executable, which is what tells the two apart.
Function InstallerPreflight
    Call InstallerValidatePath
    ${If} $InstallerError != ""
        Return
    ${EndIf}
    StrCpy $INSTDIR $InstallerPath
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != $INSTDIR
    ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        FindFirst $0 $1 "$INSTDIR\*.*"
        ${DoWhile} $1 != ""
            ${If} $1 != "."
            ${AndIf} $1 != ".."
                FindClose $0
                StrCpy $InstallerError "$(INSTALLER_PATH_OWNERSHIP)"
                Return
            ${EndIf}
            FindNext $0 $1
        ${Loop}
        FindClose $0
    ${EndIf}
    ; Disk-space and writability are checked against the nearest ancestor that
    ; exists, because the target folder is usually the one about to be created.
    StrCpy $2 $INSTDIR
    ${Do}
        System::Call 'kernel32::GetFileAttributesW(w r2) i.s'
        Pop $0
        ${If} $0 != -1
            ${ExitDo}
        ${EndIf}
        ${GetParent} $2 $2
    ${Loop}
    System::Call 'kernel32::GetTempFileNameW(w r2, w "PHI", i 0, w .s) i.s'
    Pop $0
    Pop $3
    ${If} $0 == 0
        StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
        Return
    ${EndIf}
    System::Call 'kernel32::DeleteFileW(w r3)'
    System::Call 'kernel32::GetDiskFreeSpaceExW(w r2, *l .s, p 0, p 0) i.s'
    Pop $1
    Pop $0
    ${If} $1 == 0
        StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
        Return
    ${EndIf}
    IntOp $2 ${APP_64_UNPACKED_SIZE} + 65536
    System::Int64Op $2 * 1024
    Pop $2
    System::Int64Op $0 < $2
    Pop $0
    ${If} $0 != 0
        StrCpy $InstallerError "$(INSTALLER_DISK_SPACE)"
    ${EndIf}
FunctionEnd

; ---------------------------------------------------------------------------
; Lifecycle
; ---------------------------------------------------------------------------
;
; InstallerGuiInit is wired up with MUI_CUSTOMFUNCTION_GUIINIT, which MUI calls
; from .onGUIInit -- before any page exists. That is the one moment at which the
; outer dialog can be reshaped and its stock chrome hidden without a page
; noticing, and it is why InstallerApplyFrame is called exactly once.

; ---------------------------------------------------------------------------
; Failing loudly
; ---------------------------------------------------------------------------
;
; The three functions below exist because the skin failed SILENTLY once, and a
; silent fallback is worse than a crash: the installer keeps running, shows
; NSIS's stock wizard, and finishes successfully, so every observable outcome
; looks healthy while none of the branded UI is there.
;
; The trap is that System::Call pushes NOTHING when it cannot load the module it
; was asked for -- the result register comes back EMPTY, not "0". So a bare
; `== 0` test passes on exactly the failure it was written to catch. Every check
; here therefore accepts empty OR zero, and none of them is optional.

; One place for the diagnosis, because the interesting part is not that a call
; failed but which of these it was:
;   returned: []      the module never loaded -- path or a missing import
;   load: 0 (126)     the DLL is not on disk, or one of ITS imports is missing
;   load: 0 (127)     an imported function is absent from the system DLL loaded
;   load: 0 (193)     wrong architecture; NSIS is 32-bit
;   load: 0 (14001)   side-by-side/manifest problem in the DLL
;   load: <handle> and returned: [0]   the DLL ran and refused to build a window
Function PhanerisPluginFailure
  MessageBox MB_OK|MB_ICONSTOP "$(INSTALLER_UI_ERROR)$\r$\n$\r$\nplugin: $PLUGINSDIR\${PHANERIS_PLUGIN_NAME}$\r$\nreturned: [$R9]$\r$\nload: $PhanerisLoadResult (error $PhanerisLoadError)$\r$\npluginsdir: $PLUGINSDIR"
  SetErrorLevel 2
  Quit
FunctionEnd

; Aborts unless the plugin actually dressed the outer dialog.
;
; The success test is the plugin's own marker property rather than the call's
; return value: InstallerApplyFrame returns an HRESULT and S_OK is 0, so no
; comparison against the result can tell success from the empty result a failed
; call leaves behind. The property is set only if the frame work really ran,
; which makes it the one honest signal available here.
Function PhanerisRequireFrame
  System::Call 'user32::GetPropW(p $HWNDPARENT, w "Phaneris.Internal.Framed") p.s'
  Pop $R9
  ${If} $R9 != ""
  ${AndIf} $R9 != "0"
    Return
  ${EndIf}
  ; Three different refusals leave the frame property unset, and "the frame did
  ; not happen" is not a diagnosis: 1 = the handle was not a window, 2 = the
  ; module could not be pinned, 3 = SetWindowSubclass was refused.
  System::Call 'user32::GetPropW(p $HWNDPARENT, w "Phaneris.Internal.FrameError") p.s'
  Pop $PhanerisFrameError
  Call PhanerisPluginFailure
FunctionEnd

; Aborts unless $R9 holds a real window handle.
Function PhanerisRequireSurface
  ${If} $R9 == ""
  ${OrIf} $R9 == "0"
    Call PhanerisPluginFailure
  ${EndIf}
FunctionEnd

Function InstallerGuiInit
    HideWindow
    ; A borderless popup. WS_MINIMIZEBOX keeps ShowWindow(SW_MINIMIZE) working
    ; from the caption button; WS_THICKFRAME is added by the plugin purely so the
    ; DWM draws a shadow, and is neutralised in its WM_NCHITTEST.
    System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i 0x800A0000)'
    System::Call 'user32::GetDC(p $HWNDPARENT) p.s'
    Pop $0
    System::Call 'gdi32::GetDeviceCaps(p r0, i 88) i.s'
    Pop $InstallerDpi
    System::Call 'user32::ReleaseDC(p $HWNDPARENT, p r0)'
    System::Call 'kernel32::MulDiv(i 600, i $InstallerDpi, i 96) i.s'
    Pop $InstallerSize
    System::Call 'user32::GetSystemMetrics(i 0) i.s'
    Pop $0
    System::Call 'user32::GetSystemMetrics(i 1) i.s'
    Pop $1
    IntOp $0 $0 - $InstallerSize
    IntOp $0 $0 / 2
    IntOp $1 $1 - $InstallerSize
    IntOp $1 $1 / 2
    ; SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i $InstallerSize, i $InstallerSize, i 0x34)'
    System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerApplyFrame(p $HWNDPARENT) i.s ?c'
    Pop $0
    ; Not `$0 < 0`. A failed call leaves $0 empty, and an empty string compares
    ; as 0 here, so the old test let a plugin that never loaded through.
    Call PhanerisRequireFrame
    ; The stock button strip and branding. The plugin hides the same ids, but it
    ; runs before the pages exist and this is the script's own contract with
    ; MUI; doing both costs nothing and means neither has to be the only guard.
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 2
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1028
    ShowWindow $0 0
    GetDlgItem $0 $HWNDPARENT 1256
    ShowWindow $0 0
FunctionEnd

; An update is not an install: --updated means electron-updater is driving, so
; the welcome page is skipped rather than asking the user to confirm an update
; they already accepted. Aborting from a custom page's create callback is how a
; raw `Page custom` is skipped; skipPageIfUpdated only sets a PRE hook, which a
; custom page does not consult.
Function InstallerWelcome
    ${If} ${isUpdated}
        Abort
    ${EndIf}
    StrCpy $InstallerPhase "welcome"
    Call InstallerCreate
FunctionEnd

; The InstFiles page's PRE callback. SetAutoClose is what advances off the page
; when the section completes: the NSIS runtime sees the completed page with
; autoclose set and jumps to the next page rather than waiting for a Next click
; that this skin has hidden.
Function InstallerBeforeInstall
    SetAutoClose true
    Call InstallerPreflight
    ${If} $InstallerError != ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "$InstallerError" /SD IDOK
        SetErrorLevel 2
        Quit
    ${EndIf}
    Call InstallerCheckAppRunning
FunctionEnd

; The InstFiles page's SHOW callback. MUI has already resolved
; $mui.InstFilesPage.ProgressBar by the time a custom SHOW callback runs, which
; is what makes the real progress bar available to hand to the plugin.
;
; The page dialog is hidden twice on purpose: ShowWindow covers the frames
; between here and NSIS's own ShowWindow, and the plugin's subclass covers
; everything after it.
Function InstallerProgressShow
    ; Re-dress the frame now that this page's own furniture exists. MUI creates
    ; controls 1034-1039 lazily, on the first page that asks for a header, and
    ; this is that page -- so the sweep in InstallerGuiInit ran before they
    ; existed and they come up on screen with the header text and the branding
    ; bitmap still on. InstallerApplyFrame is idempotent: it re-runs the sweep and
    ; the style work and returns S_OK.
    System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerApplyFrame(p $HWNDPARENT) i.s ?c'
    Pop $0
    Call PhanerisRequireFrame

    ShowWindow $mui.InstFilesPage 0
    StrCpy $0 0
    StrCpy $1 "$PLUGINSDIR\brand-2x.bmp"
    ${If} $InstallerTheme == "dark"
        StrCpy $0 1
        StrCpy $1 "$PLUGINSDIR\brand-dark-2x.bmp"
    ${EndIf}
    System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerShowProgress(p $HWNDPARENT, p $mui.InstFilesPage.ProgressBar, i r0, i $InstallerDpi, w r1, w "$(INSTALLER_PROGRESS_PREPARE)", w "$(INSTALLER_PROGRESS_EXTRACT)", w "$(INSTALLER_PROGRESS_COPY)", w "$(INSTALLER_PROGRESS_REGISTER)", w "$(INSTALLER_PROGRESS_CLEAN)") p.s ?c'
    Pop $InstallerProgressWindow
    StrCpy $R9 $InstallerProgressWindow
    Call PhanerisRequireSurface
    ; No stage is published here, and that is deliberate. This line used to write
    ; Phaneris.Stage = 1 for the whole install section, which pinned the caption
    ; to "extracting" through the shortcut, registry and cleanup work and -- worse
    ; -- capped the bar at stage 1's ceiling for the entire run. The install
    ; section is one opaque Section and it publishes no extraction fraction, so
    ; the overlay derives the caption from the value instead (see DeriveStage in
    ; progress.h) and customInstall publishes the one stage the script really
    ; knows: 4, once the files are down.
    ShowWindow $HWNDPARENT 5
FunctionEnd

Function .onInstFailed
    ; The overlay is still painting at this point; it is the only surface left,
    ; so the message is what tells the user the install did not finish.
    System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerFinishProgress(p $InstallerProgressWindow) i.s ?c'
    Pop $0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_FAILED)" /SD IDOK
    SetErrorLevel 2
    Quit
FunctionEnd

; The finish page's create callback. The order here is the whole fix:
;
;   1. run the overlay's final animation and let it paint 100%;
;   2. DESTROY IT. Nothing else in the installer does, and a live 600x600 child
;      of $HWNDPARENT is exactly what used to sit on top of the finish page,
;      showing "cleaning temporary files" forever;
;   3. build the finish page, which now owns the whole client area.
Function InstallerFinish
    System::Call '$PLUGINSDIR\${PHANERIS_PLUGIN_NAME}::InstallerFinishProgress(p $InstallerProgressWindow) i.s ?c'
    Pop $0
    ; Empty means the call never happened, which has to be read as failure as
    ; well: this runs after NSIS has already reported success, so there is no
    ; surface left to fall back to and no page would be built.
    ${If} $0 == ""
    ${OrIf} $0 == "0"
        Quit
    ${EndIf}
    System::Call 'user32::DestroyWindow(p $InstallerProgressWindow)'
    StrCpy $InstallerProgressWindow 0
    StrCpy $InstallerPhase "success"
    Call InstallerCreate
FunctionEnd

; Leave callback for the finish page. The page has already been advanced by
; InstallerStart, so the only decision left is whether to start the app.
Function InstallerFinishLeave
    ${NSD_GetState} $InstallerLaunch $0
    HideWindow
    ${If} $0 == ${BST_CHECKED}
        StrCpy $0 ""
        ${If} ${isUpdated}
            StrCpy $0 "--updated"
        ${EndIf}
        ClearErrors
        ${If} ${UAC_IsAdmin}
            ; An explicitly elevated installer must still launch through the
            ; user's own shell, or the app would inherit the elevation.
            ${StdUtils.ExecShellAsUser} $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "$0"
            ${If} $1 != "ok"
            ${AndIf} $1 != "fallback"
                SetErrors
            ${EndIf}
        ${Else}
            ; A per-user installation needs no shell indirection.
            Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $0'
        ${EndIf}
        ${If} ${Errors}
            ShowWindow $HWNDPARENT 5
            MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_LAUNCH_FAILED)"
            Abort
        ${EndIf}
    ${EndIf}
FunctionEnd

!endif ; PHANERIS_INSTALLER_PAGES
!endif ; !ifndef BUILD_UNINSTALLER
