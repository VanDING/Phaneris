; Installer strings.
;
; Every string here must exist in BOTH languages, because electron-builder.yml
; pins `installerLanguages: ['en_US', 'zh_CN']` — makensis only compiles those
; two MUI languages in, so a LangString for a third language is a hard compile
; error, and a missing one silently renders as the raw `$(NAME)` token.
;
; Two groups live here for two different reasons:
;
;   * the progress captions, whose `%d%%` is a printf format rather than text:
;     the plugin hands them to `wsprintfW(caption, fmt, percent)`, so `%%`
;     becomes a literal per-cent sign. Do not "fix" them to a single `%`;
;   * the two caption-button glyphs, which are the only reason this file owns
;     anything typographic. installer-pages.nsh must stay pure ASCII (NSIS reads
;     included files with the system code page unless they carry a UTF-8 BOM),
;     and its normaliser rewrites a literal U+2212 or U+00D7 into "-" and "x".
;     Keeping the glyphs here, in the one file that does carry a BOM, is what
;     lets the buttons read as a minimise and a close.
;
; Wrapped in a macro, and invoked from customHeader in scripts/installer.nsh.
;
; This is load-bearing, not stylistic. electron-builder splices the custom
; include into the generated script BEFORE it runs !insertmacro addLangs, so a
; bare LangString here would be emitted while the language table is still
; empty: NSIS warns, falls back to language 1033, and every Chinese string lands
; in the English table -- Chinese users would see English. customHeader is
; invoked immediately AFTER addLangs, which is the first point where the
; language table exists.
!macro PhanerisInstallerLangStrings
; --- Page actions ------------------------------------------------------------
LangString INSTALLER_INSTALL         ${LANG_ENGLISH}     "Install now"
LangString INSTALLER_INSTALL         ${LANG_SIMPCHINESE} "立即安装"
LangString INSTALLER_FINISH          ${LANG_ENGLISH}     "Finish"
LangString INSTALLER_FINISH          ${LANG_SIMPCHINESE} "完成"
LangString INSTALLER_CHOOSE_PATH     ${LANG_ENGLISH}     "Choose location"
LangString INSTALLER_CHOOSE_PATH     ${LANG_SIMPCHINESE} "选择安装位置"
LangString INSTALLER_BROWSE          ${LANG_ENGLISH}     "Change"
LangString INSTALLER_BROWSE          ${LANG_SIMPCHINESE} "更改"
; There is deliberately no INSTALLER_LICENSE string any more: the welcome page
; used to carry a "license agreement" link in its bottom-left corner and no
; longer does. The licence file itself is still staged into $PLUGINSDIR by
; scripts/installer.nsh, so dropping the control changed no packaging.

; --- Caption buttons ---------------------------------------------------------
; U+2212 MINUS SIGN and U+00D7 MULTIPLICATION SIGN. Both languages share them.
LangString INSTALLER_MINIMIZE        ${LANG_ENGLISH}     "−"
LangString INSTALLER_MINIMIZE        ${LANG_SIMPCHINESE} "−"
LangString INSTALLER_CLOSE_GLYPH     ${LANG_ENGLISH}     "×"
LangString INSTALLER_CLOSE_GLYPH     ${LANG_SIMPCHINESE} "×"

; --- Progress stages ---------------------------------------------------------
LangString INSTALLER_PROGRESS_PREPARE   ${LANG_ENGLISH}     "Preparing installation… %d%%"
LangString INSTALLER_PROGRESS_PREPARE   ${LANG_SIMPCHINESE} "正在准备安装… %d%%"
LangString INSTALLER_PROGRESS_EXTRACT   ${LANG_ENGLISH}     "Extracting files… %d%%"
LangString INSTALLER_PROGRESS_EXTRACT   ${LANG_SIMPCHINESE} "正在解压文件… %d%%"
LangString INSTALLER_PROGRESS_COPY      ${LANG_ENGLISH}     "Installing files… %d%%"
LangString INSTALLER_PROGRESS_COPY      ${LANG_SIMPCHINESE} "正在安装文件… %d%%"
LangString INSTALLER_PROGRESS_REGISTER  ${LANG_ENGLISH}     "Finishing installation… %d%%"
LangString INSTALLER_PROGRESS_REGISTER  ${LANG_SIMPCHINESE} "正在完成安装… %d%%"
LangString INSTALLER_PROGRESS_CLEAN     ${LANG_ENGLISH}     "Cleaning temporary files… %d%%"
LangString INSTALLER_PROGRESS_CLEAN     ${LANG_SIMPCHINESE} "正在清理临时文件… %d%%"

; --- Finish page -------------------------------------------------------------
; A real page, not a silent exit: the install has succeeded, and this is where
; the user decides whether to start the app.
LangString INSTALLER_FINISH_TITLE    ${LANG_ENGLISH}     "Installation complete"
LangString INSTALLER_FINISH_TITLE    ${LANG_SIMPCHINESE} "安装完成"
LangString INSTALLER_FINISH_BODY     ${LANG_ENGLISH}     "Phaneris is ready to use."
LangString INSTALLER_FINISH_BODY     ${LANG_SIMPCHINESE} "Phaneris 已可以使用。"
LangString INSTALLER_LAUNCH          ${LANG_ENGLISH}     "Launch now"
LangString INSTALLER_LAUNCH          ${LANG_SIMPCHINESE} "立即启动"
LangString INSTALLER_LAUNCH_FAILED   ${LANG_ENGLISH}     "Phaneris could not be started. Open it from the Start menu or the desktop shortcut."
LangString INSTALLER_LAUNCH_FAILED   ${LANG_SIMPCHINESE} "无法启动 Phaneris。请从开始菜单或桌面快捷方式打开。"

; --- Failures the installer can still explain --------------------------------
LangString INSTALLER_RUNNING         ${LANG_ENGLISH}     "Phaneris is running. Quit it, then run the installer again."
LangString INSTALLER_RUNNING         ${LANG_SIMPCHINESE} "Phaneris 正在运行。请先退出应用，再重新运行安装程序。"
LangString INSTALLER_PATH_INVALID    ${LANG_ENGLISH}     "Choose a full local folder path. Drive roots, system folders, links and special characters are not supported."
LangString INSTALLER_PATH_INVALID    ${LANG_SIMPCHINESE} "请选择本地磁盘上的完整文件夹路径，不能使用磁盘根目录、系统目录、链接目录或包含特殊字符的路径。"
LangString INSTALLER_PATH_OWNERSHIP  ${LANG_ENGLISH}     "Choose an empty folder, or the folder Phaneris is already installed in."
LangString INSTALLER_PATH_OWNERSHIP  ${LANG_SIMPCHINESE} "请选择空文件夹，或 Phaneris 原来的安装目录。"
LangString INSTALLER_PATH_WRITABLE   ${LANG_ENGLISH}     "This location is not writable. Choose a folder the current user can write to."
LangString INSTALLER_PATH_WRITABLE   ${LANG_SIMPCHINESE} "无法写入此位置。请选择当前用户可写入的文件夹。"
LangString INSTALLER_DISK_SPACE      ${LANG_ENGLISH}     "There is not enough free disk space. Choose another location."
LangString INSTALLER_DISK_SPACE      ${LANG_SIMPCHINESE} "此磁盘的可用空间不足，请选择其他位置。"
LangString INSTALLER_PER_USER        ${LANG_ENGLISH}     "This installer supports the current user only. Uninstall the existing all-users installation first."
LangString INSTALLER_PER_USER        ${LANG_SIMPCHINESE} "此安装程序仅支持当前用户。请先卸载已有的所有用户安装版本。"
LangString INSTALLER_FAILED          ${LANG_ENGLISH}     "Installation did not finish. Quit the installer and try again. If it keeps failing, download the installer again."
LangString INSTALLER_FAILED          ${LANG_SIMPCHINESE} "安装未完成。请退出安装程序后重试；如仍然失败，请重新下载安装包。"
LangString INSTALLER_UI_ERROR        ${LANG_ENGLISH}     "The installer could not draw its window. Quit it and try again."
LangString INSTALLER_UI_ERROR        ${LANG_SIMPCHINESE} "无法初始化安装窗口，请退出后重试。"
LangString INSTALLER_THEME_ERROR     ${LANG_ENGLISH}     "Use /THEME=auto, /THEME=light or /THEME=dark."
LangString INSTALLER_THEME_ERROR     ${LANG_SIMPCHINESE} "主题参数须为 /THEME=auto、/THEME=light 或 /THEME=dark。"
!macroend
