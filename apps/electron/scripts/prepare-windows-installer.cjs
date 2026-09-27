/**
 * Builds `apps/electron/installer/window-frame.cpp` into the NSIS plugin the
 * installer loads: `apps/electron/installer-ui/windowframe.dll`.
 *
 * Two callers, one implementation:
 *
 *  * electron-builder's `beforeBuild` hook (the default export), because nothing
 *    else in a packaging run produces this artefact and makensis would otherwise
 *    fail several minutes later with a missing `File` source;
 *  * `apps/electron/scripts/build-installer-plugin.cjs`, i.e.
 *    `bun run installer:plugin`, so the plugin can be compiled and inspected on
 *    its own without packaging a 170 MB installer around it.
 *
 * Why a compiled plugin at all, rather than a themable NSIS script: NSIS's own
 * UI is a fixed dialog. Keeping the DWM frame while NSIS's pages own the whole
 * client area is not expressible in NSIS. The install *engine* is untouched --
 * see the header of scripts/installer.nsh.
 *
 * The build is deliberately strict. A missing plugin would otherwise surface as
 * a makensis error about a missing `File` source, several minutes later and with
 * no hint about the cause; failing here names the real problem. Cross-building
 * the Windows target from macOS or Linux therefore needs MSVC under Wine or a
 * CI runner, and fails loudly rather than shipping an unbranded installer.
 */
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const ELECTRON_DIR = path.join(__dirname, '..')
const INSTALLER_DIR = path.join(ELECTRON_DIR, 'installer')
const OUTPUT_DIR = path.join(ELECTRON_DIR, 'installer-ui')
const SOURCE = path.join(INSTALLER_DIR, 'window-frame.cpp')
const DLL = path.join(OUTPUT_DIR, 'windowframe.dll')

const VSWHERE = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe',
)

const log = (message) => console.log(`  • installer skin: ${message}`)

function findVisualStudio() {
  if (!existsSync(VSWHERE)) return null
  const found = execFileSync(
    VSWHERE,
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    // windowsHide on every spawn in this file. Both children are console-subsystem
    // programs (vswhere.exe and cmd.exe), and without this Node lets Windows give
    // each one its own console window — which the user sees as the screen
    // flashing on every build. Nothing here needs a visible console; the batch
    // file's output is already captured and re-thrown as a build error.
    { encoding: 'utf8', windowsHide: true },
  ).trim()
  return found || null
}

/**
 * Compiles the plugin and returns its path.
 *
 * @param {{ quiet?: boolean }} [options] `quiet` drops the signing note, which
 *   is noise when someone is iterating on the C++ by hand.
 */
function buildInstallerPlugin(options = {}) {
  if (process.platform !== 'win32') {
    throw new Error(
      'The installer skin needs MSVC to compile installer/window-frame.cpp, ' +
        `and this host is ${process.platform}. Build the Windows target on Windows, ` +
        'or provision the toolchain in CI.',
    )
  }
  if (!existsSync(SOURCE)) {
    throw new Error(`Installer skin source is missing: ${SOURCE}`)
  }

  const vsPath = findVisualStudio()
  if (!vsPath) {
    throw new Error(
      'Visual Studio Build Tools with the C++ workload (Microsoft.VisualStudio.Component.VC.Tools.x86.x64) ' +
        `were not found via ${VSWHERE}. Install "Desktop development with C++" to build the installer.`,
    )
  }

  // The plugin is loaded by 32-bit NSIS, so it must be an x86 build. /MT keeps
  // the MSVC runtime out of the picture entirely — a /MD build would need
  // vcruntime140.dll on the user's machine, which is not something an installer
  // may assume.
  const vcvars = path.join(vsPath, 'VC', 'Auxiliary', 'Build', 'vcvars32.bat')
  if (!existsSync(vcvars)) {
    throw new Error(`vcvars32.bat is missing from ${vsPath}; the C++ x86 toolset is not installed.`)
  }

  rmSync(OUTPUT_DIR, { recursive: true, force: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // No /Fo, and relative /Fe: the batch file cds to its own directory first, so
  // the object files and the DLL land in installer-ui/ without a single output
  // path on the command line. That matters more than it looks: `/Fo"<dir>\"` is
  // the documented form, and the trailing backslash escapes the closing quote
  // under the C runtime's argv rules — cl then reads `"<dir>" /Fe<dll>` as one
  // giant output filename and dies with a baffling C1083. Keeping every path
  // relative removes the failure mode instead of working around it.
  const cl = [
    // /utf-8 is load-bearing, not tidiness. window-frame.cpp carries Chinese
    // string literals (the progress captions arrive from NSIS, but the comments
    // and the fallbacks do not) and is saved as UTF-8 without a BOM. Without
    // this flag MSVC decodes it with the host's ANSI code page — GBK on a
    // Chinese Windows, where the literals become mojibake and the compiler
    // reports "newline in constant" on perfectly valid lines.
    'cl /nologo /LD /MT /O2 /EHsc /utf-8',
    '/DUNICODE /D_UNICODE /DWIN32_LEAN_AND_MEAN /DNOMINMAX',
    `"${SOURCE}"`,
    '/Fe:windowframe.dll',
    '/link gdiplus.lib dwmapi.lib comctl32.lib user32.lib gdi32.lib shell32.lib ole32.lib advapi32.lib',
  ].join(' ')

  log('compiling windowframe.dll (x86, static CRT)...')

  // Through a generated batch file rather than `cmd /c "…"`. The MSVC tools live
  // under "C:\Program Files (x86)\…", and every attempt to inline that path
  // through cmd's own quoting rules is a coin flip: `/s` strips the outer quotes,
  // the `&&` chain re-splits on the space, and the failure reads as "'C:\Program'
  // is not recognized" — which looks like a missing toolchain rather than a
  // quoting bug. A batch file removes cmd from the equation, and is left behind
  // on failure as the one artefact that reproduces the problem.
  const script = path.join(OUTPUT_DIR, 'build-plugin.bat')
  writeFileSync(
    script,
    [
      '@echo off',
      'cd /d "%~dp0"',
      `call "${vcvars}" >nul`,
      // vcvars32 does not set a reliable errorlevel when it fails, so prove the
      // toolchain is actually on PATH instead of trusting its exit code.
      'where cl.exe >nul 2>&1 || (echo installer skin: cl.exe not on PATH after vcvars32 & exit /b 1)',
      cl,
      'exit /b %errorlevel%',
    ].join('\r\n') + '\r\n',
    'utf8',
  )

  let status = 0
  try {
    execFileSync('cmd.exe', ['/d', '/c', script], {
      cwd: INSTALLER_DIR,
      stdio: 'inherit',
      // See findVisualStudio: without this, cmd.exe gets its own console window.
      windowsHide: true,
    })
  } catch (error) {
    status = typeof error.status === 'number' ? error.status : 1
  }

  if (status !== 0 || !existsSync(DLL)) {
    // The batch file is deliberately left behind: it is the only artefact that
    // reproduces the failure, and installer-ui/ is gitignored build output.
    throw new Error(
      `The installer skin did not compile (cl exited ${status}, ${existsSync(DLL) ? 'DLL present' : 'no DLL'}). ` +
        `Re-run ${script} from a shell to see the full compiler output.`,
    )
  }
  rmSync(script, { force: true })
  log(`built ${path.relative(ELECTRON_DIR, DLL)}`)

  // electron-builder will not sign this for us, and an unsigned DLL inside a
  // signed installer is a SmartScreen question worth answering deliberately.
  // Left as a build log line so the decision is visible rather than silent.
  if (!options.quiet && !process.env.CSC_LINK && !process.env.WIN_CSC_LINK) {
    log('note: windowframe.dll is unsigned (no code-signing certificate configured)')
  }
  return DLL
}

module.exports = async function prepareWindowsInstaller(context) {
  // Only the Windows target has an NSIS installer to skin. Guarding on the
  // *target* rather than the host matters for two reasons: macOS and Linux
  // packaging must not be broken by a hook that only exists for Windows, and
  // electron-builder happily builds the Windows target from a non-Windows host,
  // which is the one case that genuinely cannot work and should say so.
  const targetPlatform = context?.electronPlatformName
  if (targetPlatform !== undefined && targetPlatform !== 'win32') {
    return true
  }
  buildInstallerPlugin()
  return true
}

module.exports.buildInstallerPlugin = buildInstallerPlugin
module.exports.DLL = DLL
module.exports.SOURCE = SOURCE
