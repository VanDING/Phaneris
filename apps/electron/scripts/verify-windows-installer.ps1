<#
.SYNOPSIS
Drives the built Phaneris Windows installer end to end and records what a user
would have seen, without taking the desktop.

.DESCRIPTION
Four rounds of installer defects were diagnosed from a human's description of a
600x600 window because nothing in the repo could observe the installer. This is
the replacement for that loop: it runs the real artifact, clicks the real
controls, screenshots every distinct UI state and writes a JSON verdict.

What it establishes, in order:

  * the outer dialog appears at all, and at 600x600;
  * which surfaces/enumeration states the user is shown, with a PNG each;
  * the branded surface is on screen rather than the NSIS stock wizard --
    every stock control (1/2/3/1028/1256/1034-1039/1046) must be invisible.
    1046 is MUI's header bitmap static, and it is the one this check was
    missing: it reported vis=True in every state of every run, including the
    four runs that passed, because an empty SS_BITMAP static paints nothing and
    nobody looked for it by id;
  * real progress, by comparing the overlay's own caption against the stock
    progress bar's PBM_GETPOS rather than trusting either alone;
  * the overlay is DESTROYED before the finish page is built -- the exact bug
    that made an install look stuck at 98%;
  * the finish page is interactive, i.e. it owns a visible checkbox;
  * the install finished, the app launched, and the on-disk/registry state is
    correct.

It never calls SetForegroundWindow or Activate. By default it parks the
installer at the right edge of the primary monitor so only a sliver is visible,
and captures with PrintWindow(PW_RENDERFULLCONTENT).

Be aware of what PrintWindow can and cannot see here. The installer's branded
surfaces are plain GDI child windows painted straight to the screen, and DWM's
redirection surface -- which is what PrintWindow returns -- does not contain
them. A PrintWindow capture of this installer has already shown a page the user
could not actually see. Use -ScreenCapture when the image itself is the
evidence; it BitBlts off the screen, which is faithful but needs the window
visible, so it parks it fully on screen instead.

.PARAMETER InstallerPath
The installer to run. Defaults to the newest Phaneris-*-win-x64.exe in
apps/electron/release.

.PARAMETER ExpectedInstallDir
Where the app must end up. Defaults to the per-user electron-builder location.

.PARAMETER PrimaryCaption
Regex identifying a page's forward button. Defaults to the Install/Finish
labels; the probe logs every visible button on every state change, so a
mismatch is diagnosable rather than silent.

.PARAMETER ClickPrimary
Clicks the forward button on each page. The collapsed install-location chooser
and the window controls are not it, so this advances the welcome page and then
completes the finish page.

.PARAMETER ScreenCapture
Capture by BitBlit from the screen instead of PrintWindow. Faithful, but the
installer window is fully visible on screen for the run.

.PARAMETER FinishDwellSeconds
How long to sit on the finish page before completing the install. This is the
window in which idle CPU is measured, so it must be long enough to be
meaningful.

.PARAMETER KeepInstall
Leaves the app running and the installation in place instead of cleaning up.

.OUTPUTS
A directory under $env:TEMP\phaneris-installer-verify holding report.json,
timeline.txt and one PNG per distinct UI state. Exits non-zero when any check
fails, so it is usable as a gate.

.EXAMPLE
pwsh -File apps/electron/scripts/verify-windows-installer.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$ExpectedInstallDir = "$env:LOCALAPPDATA\Programs\Phaneris",
    [string]$PrimaryCaption = '安装|完成|Install|Finish',
    [int]$TimeoutSeconds = 300,
    [double]$FinishDwellSeconds = 4,
    [int]$SettleMilliseconds = 400,
    [switch]$ClickPrimary = $true,
    [switch]$ScreenCapture,
    [switch]$KeepInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Win32 surface. Everything here is read-only observation plus two synthetic
# inputs: BM_CLICK on a button we have already identified by text and geometry,
# and SetWindowPos to park the window. No window is ever activated.
# ---------------------------------------------------------------------------
if (-not ('PhanerisInstallerProbe' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public sealed class WinInfo {
    public IntPtr Handle;
    public string Class = "";
    public string Text = "";
    public int Id;
    public bool Visible;
    public bool Enabled;
    public int Style;
    public int Left, Top, Right, Bottom;
    public IntPtr Parent;

    public int Width { get { return Right - Left; } }
    public int Height { get { return Bottom - Top; } }

    /// Button controls whose low nibble is one of the check/radio family. The
    /// finish page's launch toggle is the only such control the installer ever
    /// shows, so this -- not geometry -- is what identifies the finish page.
    public bool IsCheckBox {
        get {
            if (Class != "Button") return false;
            int kind = Style & 0x0F;
            return kind == 2 || kind == 3 || kind == 4 || kind == 5 || kind == 6 || kind == 9;
        }
    }

    // The identity used to decide whether anything the user can see changed.
    public string Signature {
        get { return Class + "#" + Id + ":" + Text + (Visible ? "" : "(hidden)"); }
    }

    public override string ToString() {
        return string.Format("hwnd=0x{0:X8} cls={1,-22} id={2,-6} vis={3,-5} en={4,-5} style=0x{5:X8} rect=({6},{7})-({8},{9}) text=\"{10}\"",
            Handle.ToInt64(), Class, Id, Visible, Enabled, Style, Left, Top, Right, Bottom, Text);
    }
}

public static class PhanerisInstallerProbe {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr hwnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hwnd, StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int GetWindowLongW(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetPropW(IntPtr hwnd, string name);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER {
        public int Size, Width, Height;
        public short Planes, BitCount;
        public int Compression, SizeImage, XPelsPerMeter, YPelsPerMeter, ClrUsed, ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFO {
        public BITMAPINFOHEADER Header;
        public int Colors;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFO info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, byte[] bits, ref BITMAPINFO info, uint usage);

    private const uint BM_CLICK = 0x00F5;
    private const uint BM_GETCHECK = 0x00F0;
    // PBM_GETRANGE, and it has to be 0x0407. This constant was 0x0401, which is
    // PBM_SETRANGE -- so every call meant to READ the bar's range was instead
    // WRITING one, built from MAKELPARAM(pointer_low, pointer_high) of a buffer
    // address, and comctl32 clamped the bar's position into that garbage range.
    // The measurement was corrupting the thing it measured, and the installer
    // plugin reads the same control: that is where "the stock bar sits at 0 %"
    // and the overlay's 24 % bootstrap both came from.
    private const uint PBM_GETRANGE = 0x0407;
    private const uint PBM_GETPOS = 0x0408;
    private const int GWL_STYLE = -16;
    private const uint GW_CHILD = 5;
    private const uint GW_HWNDNEXT = 2;
    private const uint SRCCOPY = 0x00CC0020;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint PW_RENDERFULLCONTENT = 2;

    private static WinInfo Describe(IntPtr hwnd) {
        var info = new WinInfo();
        info.Handle = hwnd;
        var cls = new StringBuilder(256);
        GetClassNameW(hwnd, cls, cls.Capacity);
        info.Class = cls.ToString();
        var text = new StringBuilder(1024);
        GetWindowTextW(hwnd, text, text.Capacity);
        info.Text = text.ToString();
        info.Id = GetDlgCtrlID(hwnd);
        info.Visible = IsWindowVisible(hwnd);
        info.Enabled = IsWindowEnabled(hwnd);
        info.Style = GetWindowLongW(hwnd, GWL_STYLE);
        info.Parent = GetParent(hwnd);
        RECT r;
        if (GetWindowRect(hwnd, out r)) {
            info.Left = r.Left; info.Top = r.Top; info.Right = r.Right; info.Bottom = r.Bottom;
        }
        return info;
    }

    /// Top-level windows owned by a process.
    public static List<WinInfo> TopLevel(uint pid) {
        var found = new List<WinInfo>();
        EnumWindows((hwnd, p) => {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner == pid) found.Add(Describe(hwnd));
            return true;
        }, IntPtr.Zero);
        return found;
    }

    /// Direct and indirect children, i.e. everything the dialog owns.
    public static List<WinInfo> Descendants(IntPtr parent) {
        var found = new List<WinInfo>();
        EnumChildWindows(parent, (hwnd, p) => { found.Add(Describe(hwnd)); return true; }, IntPtr.Zero);
        return found;
    }

    /// Visible children in true z-order, topmost first. EnumChildWindows order
    /// is not documented as z-order, and the two disagreed about which surface
    /// was on top -- exactly the question that decides what a user sees, so the
    /// probe walks the sibling chain instead of trusting enumeration order.
    public static List<WinInfo> ZOrder(IntPtr dialog) {
        var stack = new List<WinInfo>();
        for (IntPtr h = GetWindow(dialog, GW_CHILD); h != IntPtr.Zero; h = GetWindow(h, GW_HWNDNEXT)) {
            var w = Describe(h);
            if (w.Visible) stack.Add(w);
        }
        return stack;
    }

    /// BitBlt straight off the screen. This is the only faithful capture for the
    /// installer: its surfaces are plain GDI child windows, which the DWM
    /// redirection surface PrintWindow returns does not contain -- PrintWindow
    /// showed a page the user could not actually see. Needs the window visible
    /// and unobstructed, hence opt-in.
    public static bool ScreenCapture(IntPtr hwnd, string path) {
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return false;
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return false;

        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr memory = CreateCompatibleDC(screen);
        IntPtr bitmap = CreateCompatibleBitmap(screen, w, h);
        bool ok = false;
        if (bitmap != IntPtr.Zero) {
            IntPtr previous = SelectObject(memory, bitmap);
            if (BitBlt(memory, 0, 0, w, h, screen, r.Left, r.Top, SRCCOPY)) {
                var info = new BITMAPINFO();
                info.Header.Size = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
                info.Header.Width = w;
                info.Header.Height = -h;
                info.Header.Planes = 1;
                info.Header.BitCount = 32;
                info.Header.Compression = 0;
                var pixels = new byte[w * h * 4];
                if (GetDIBits(memory, bitmap, 0, (uint)h, pixels, ref info, 0) != 0) {
                    for (int i = 3; i < pixels.Length; i += 4) pixels[i] = 0xFF;
                    ok = WriteBmp(path, pixels, w, h);
                }
            }
            SelectObject(memory, previous);
            DeleteObject(bitmap);
        }
        DeleteDC(memory);
        ReleaseDC(IntPtr.Zero, screen);
        return ok;
    }

    /// Raise without activating, so a screen capture sees the installer and the
    /// user's focus does not move.
    public static bool Raise(IntPtr hwnd) {
        return SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    public static bool Drop(IntPtr hwnd) {
        return SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    /// The installer's outer dialog: the only top-level #32770 of usable size.
    public static IntPtr OuterDialog(uint pid) {
        foreach (var w in TopLevel(pid)) {
            if (w.Class == "#32770" && w.Width >= 400 && w.Height >= 400) return w.Handle;
        }
        return IntPtr.Zero;
    }

    public static bool Alive(IntPtr hwnd) { return hwnd != IntPtr.Zero && IsWindow(hwnd); }

    /// Park the window without activating it. Returns false if it moved out of
    /// reach, which is not fatal -- the probe only needs it rendered.
    public static bool Park(IntPtr hwnd, int visiblePixels) {
        int screen = GetSystemMetrics(0);
        int x = screen - Math.Max(80, visiblePixels);
        return SetWindowPos(hwnd, IntPtr.Zero, x, 32, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    /// The page's forward action: the bottom-most visible push button whose
    /// caption reads like install/finish. Geometry alone is not enough once a
    /// page carries a secondary action, and a caption alone is not enough
    /// because the label is localised -- so this tries the caption and falls
    /// back to geometry, telling the caller which it used.
    public static WinInfo PrimaryButton(IntPtr dialog, string captionPattern, out bool matchedCaption) {
        WinInfo byCaption = null;
        WinInfo bottomMost = null;
        foreach (var w in Descendants(dialog)) {
            if (!w.Visible || w.Class != "Button" || w.IsCheckBox) continue;
            if (bottomMost == null || w.Top > bottomMost.Top) bottomMost = w;
            if (System.Text.RegularExpressions.Regex.IsMatch(w.Text ?? "", captionPattern)) {
                if (byCaption == null || w.Top > byCaption.Top) byCaption = w;
            }
        }
        matchedCaption = byCaption != null;
        return byCaption ?? bottomMost;
    }

    /// Every visible checkbox-ish button, for the finish page's launch toggle.
    public static List<WinInfo> VisibleCheckBoxes(IntPtr dialog) {
        var list = new List<WinInfo>();
        foreach (var w in Descendants(dialog)) {
            if (w.Visible && w.IsCheckBox) list.Add(w);
        }
        return list;
    }

    /// Every visible push button, for the page's forward action.
    public static List<WinInfo> VisibleButtons(IntPtr dialog) {
        var list = new List<WinInfo>();
        foreach (var w in Descendants(dialog)) {
            if (w.Visible && w.Class == "Button" && !w.IsCheckBox) list.Add(w);
        }
        return list;
    }

    public static string Click(IntPtr hwnd) {
        SendMessageW(hwnd, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
        return "BM_CLICK";
    }

    /// BST_CHECKED is 1. Only meaningful for a check/radio family button.
    public static int CheckState(IntPtr hwnd) {
        return (int)SendMessageW(hwnd, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero);
    }

    /// Reads a named window property. These properties are the whole
    /// NSIS-to-plugin contract, so which ones exist is how a callback that never
    /// ran is told apart from one that ran and did nothing. Returns -1 when the
    /// property is absent.
    public static int Prop(IntPtr hwnd, string name) {
        if (hwnd == IntPtr.Zero) return -1;
        IntPtr value = GetPropW(hwnd, name);
        if (value == IntPtr.Zero) return -1;
        return (int)value.ToInt64();
    }

    public static string MarkSummary(IntPtr dialog, IntPtr legacyPageDialog) {
        var parts = new List<string>();
        parts.Add("framed=" + Prop(dialog, "Phaneris.Internal.Framed"));
        parts.Add("stage=" + Prop(dialog, "Phaneris.Stage"));
        parts.Add("presented=" + Prop(dialog, "Phaneris.Presented"));
        parts.Add("pageHidden=" + Prop(legacyPageDialog, "Phaneris.Internal.PageHidden"));
        return string.Join(" ", parts.ToArray());
    }

    /// Every child, one per line. The timeline only carries counts; when a
    /// surface is missing the question is always "does the window exist at all,
    /// and is it visible/sized", which needs the unfiltered table.
    public static string Dump(IntPtr dialog) {
        var text = new StringBuilder();
        foreach (var w in Descendants(dialog)) text.AppendLine(w.ToString());
        return text.ToString();
    }

    /// The stock progress bar's position as a 0..100 percentage, or -1 when there
    /// is no bar. Hiding the bar does not clear its value.
    ///
    /// The range is read as two return values with a NULL lParam, never through a
    /// PBRANGE pointer: this runs in a different process from the bar, and a
    /// pointer handed to a WM_USER-range message is dereferenced in the
    /// INSTALLER's address space, so the caller reads back its own untouched
    /// buffer. (Both limits are available as return values: wParam FALSE gives
    /// the low limit, TRUE the high one.)
    public static int StockProgress(IntPtr dialog) {
        IntPtr bar = FindWindowExW(dialog, IntPtr.Zero, "msctls_progress32", null);
        if (bar == IntPtr.Zero) {
            foreach (var w in Descendants(dialog)) {
                if (w.Class == "msctls_progress32") { bar = w.Handle; break; }
            }
        }
        if (bar == IntPtr.Zero) return -1;

        int a = (int)SendMessageW(bar, PBM_GETRANGE, IntPtr.Zero, IntPtr.Zero);
        int b = (int)SendMessageW(bar, PBM_GETRANGE, new IntPtr(1), IntPtr.Zero);
        // Sorted rather than assigned, because the two return values were
        // measured the opposite way round from the way the header describes:
        // on this comctl32 the FALSE call comes back as 30000 and the TRUE call
        // as 0 for NSIS's InstFiles bar, whose position then runs 6792..30000 --
        // inside 0..30000 and outside 30000..0, which settles which is which. A
        // range is only ever meaningful with low < high, so take them in order.
        int low = Math.Min(a, b);
        int high = Math.Max(a, b);
        if (high <= low) { high = 100; low = 0; }
        int position = (int)SendMessageW(bar, PBM_GETPOS, IntPtr.Zero, IntPtr.Zero);
        if (position < low) position = low;
        if (position > high) position = high;
        return (int)Math.Round(100.0 * (position - low) / (high - low));
    }

    /// PrintWindow rather than a screen grab, so occlusion and the parked
    /// position do not matter. Pixels come back through a top-down DIB section
    /// and are written as a 32-bit BMP because PowerShell 7 does not reference
    /// System.Drawing when it compiles C# -- re-encoding to PNG is the caller's
    /// job, and BMP keeps every pixel exactly as Windows rendered it.
    public static bool Screenshot(IntPtr hwnd, string path) {
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return false;
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return false;

        var info = new BITMAPINFO();
        info.Header.Size = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
        info.Header.Width = w;
        info.Header.Height = -h;          // negative: rows are stored top-down
        info.Header.Planes = 1;
        info.Header.BitCount = 32;
        info.Header.Compression = 0;      // BI_RGB
        info.Header.SizeImage = w * h * 4;

        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr memory = CreateCompatibleDC(screen);
        IntPtr bits;
        IntPtr bitmap = CreateDIBSection(memory, ref info, 0, out bits, IntPtr.Zero, 0);
        bool ok = false;
        if (bitmap != IntPtr.Zero && bits != IntPtr.Zero) {
            IntPtr previous = SelectObject(memory, bitmap);
            if (PrintWindow(hwnd, memory, PW_RENDERFULLCONTENT)) {
                var pixels = new byte[w * h * 4];
                Marshal.Copy(bits, pixels, 0, pixels.Length);
                // PrintWindow leaves the alpha channel zeroed, which would make
                // the whole capture transparent once it is re-encoded.
                for (int i = 3; i < pixels.Length; i += 4) pixels[i] = 0xFF;
                ok = WriteBmp(path, pixels, w, h);
            }
            SelectObject(memory, previous);
        }
        if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(IntPtr.Zero, screen);
        return ok;
    }

    private static bool WriteBmp(string path, byte[] pixels, int w, int h) {
        try {
            using (var file = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (var writer = new BinaryWriter(file)) {
                const int header = 14 + 40;
                writer.Write((byte)'B');
                writer.Write((byte)'M');
                writer.Write(header + pixels.Length);
                writer.Write(0);
                writer.Write(header);
                writer.Write(40);
                writer.Write(w);
                writer.Write(-h);
                writer.Write((short)1);
                writer.Write((short)32);
                writer.Write(0);
                writer.Write(pixels.Length);
                writer.Write(2835);
                writer.Write(2835);
                writer.Write(0);
                writer.Write(0);
                writer.Write(pixels);
            }
            return true;
        } catch (IOException) {
            return false;
        } catch (UnauthorizedAccessException) {
            return false;
        }
    }
}
'@
}

# ---------------------------------------------------------------------------
# Run directory
# ---------------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $env:TEMP "phaneris-installer-verify\$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$timelinePath = Join-Path $runDir 'timeline.txt'
$reportPath = Join-Path $runDir 'report.json'

function Write-Timeline([string]$line) {
    $stamped = '{0:HH:mm:ss.fff}  {1}' -f (Get-Date), $line
    Add-Content -Path $timelinePath -Value $stamped -Encoding utf8
    Write-Host $stamped
}

$checks = [ordered]@{}
function Set-Check([string]$name, [bool]$ok, [string]$detail) {
    $checks[$name] = [ordered]@{ pass = $ok; detail = $detail }
    $label = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Timeline ("  [{0}] {1} -- {2}" -f $label, $name, $detail)
}

# PrintWindow lands in a BMP because PowerShell 7 compiles C# without a
# System.Drawing reference. The assembly is still loaded on demand here, so the
# captures a reviewer actually looks at are PNGs. If that fails the BMP is kept
# and named, rather than reporting a path that does not exist.
$script:drawingReady = $null
function Convert-ShotToPng([string]$bmpPath, [string]$pngPath) {
    if ($null -eq $script:drawingReady) {
        try {
            Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop
            $script:drawingReady = $true
        } catch {
            Write-Timeline "  (note) System.Drawing.Common unavailable; keeping BMP captures"
            $script:drawingReady = $false
        }
    }
    if (-not $script:drawingReady) { return $false }
    try {
        $image = [System.Drawing.Image]::FromFile($bmpPath)
        try { $image.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $image.Dispose() }
        Remove-Item $bmpPath -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Locate the artifact
# ---------------------------------------------------------------------------
if (-not $InstallerPath) {
    $release = Join-Path $PSScriptRoot '..\release'
    $candidate = Get-ChildItem -Path $release -Filter 'Phaneris-*-win-x64.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $candidate) { throw "No Phaneris-*-win-x64.exe under $release. Build it first." }
    $InstallerPath = $candidate.FullName
}
$InstallerPath = (Resolve-Path $InstallerPath).Path
$artifact = Get-Item $InstallerPath
# Bound to variables first: `"..." -f $a, $b / 1MB` parses as
# `(("..." -f $a, $b) / 1MB)` and divides the formatted string.
Write-Timeline "installer: $InstallerPath"
Write-Timeline ("built:     {0}" -f $artifact.LastWriteTime)
Write-Timeline ("size:      {0:N1} MB" -f ($artifact.Length / 1MB))
Write-Timeline "output:    $runDir"

# A leftover installer holds files in release/ and makes the next build fail at
# the signing step, so refuse to start on top of one.
$stale = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Phaneris-*win-x64*' }
if ($stale) { throw "A previous installer is still running (PID $($stale.Id -join ', ')). Kill it first." }

# ---------------------------------------------------------------------------
# Drive the installer
# ---------------------------------------------------------------------------
# Two seconds of slack, because the staging timestamp is compared against this
# and filesystem timestamps are coarser than the clock that reads them.
$launchStamp = (Get-Date).AddSeconds(-2)
$proc = Start-Process -FilePath $InstallerPath -PassThru
Write-Timeline "launched pid=$($proc.Id)"
$cpuStart = $null
$shotIndex = 0
$lastSignature = ''
$lastMarks = ''
$clickedStates = @{}
$seenAt = @{}
$sawOverlay = $false
$overlaySamples = New-Object System.Collections.Generic.List[object]
$finishHadCheckbox = $false
$stockEverVisible = $false
$stockReported = $false
$pluginStaged = $false
$pluginStagedBytes = 0
$pluginStagedPath = ''
$stallReported = $false
$idleWallStart = $null
$idleCpuStart = 0
$idleCpuSeconds = $null
$idleWallSeconds = 0
$dwellSatisfied = $false
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = [IntPtr]::Zero
$parked = $false

while ((Get-Date) -lt $deadline) {
    $proc.Refresh()
    if ($proc.HasExited) { Write-Timeline "installer exited with code $($proc.ExitCode)"; break }

    if ($dialog -eq [IntPtr]::Zero) {
        $dialog = [PhanerisInstallerProbe]::OuterDialog([uint32]$proc.Id)
        if ($dialog -ne [IntPtr]::Zero) {
            Write-Timeline "outer dialog 0x$('{0:X8}' -f $dialog.ToInt64()) appeared"
            if ($ScreenCapture) {
                # A screen capture needs the window genuinely on screen. It goes
                # to the right edge, fully visible, and is still never activated.
                [void][PhanerisInstallerProbe]::Park($dialog, 620)
            } else {
                [void][PhanerisInstallerProbe]::Park($dialog, 120)
            }
            $parked = $true
            $cpuStart = $proc.TotalProcessorTime
        } else {
            Start-Sleep -Milliseconds 120
            continue
        }
    }

    if (-not [PhanerisInstallerProbe]::Alive($dialog)) {
        Write-Timeline "outer dialog was destroyed while the process lives on"
        $dialog = [PhanerisInstallerProbe]::OuterDialog([uint32]$proc.Id)
        if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200; continue }
    }

    $children = [PhanerisInstallerProbe]::Descendants($dialog)
    $visible = @($children | Where-Object { $_.Visible })

    # Failure dialogs are SEPARATE top-level windows, not children of the
    # installer dialog. Without this, an installer that aborts with a MessageBox
    # -- which is exactly what a loud plugin failure does -- leaves a dialog with
    # no visible children and then a non-zero exit code, and the reason lives
    # only in text nobody recorded.
    $popups = @([PhanerisInstallerProbe]::TopLevel([uint32]$proc.Id) |
        Where-Object { $_.Handle -ne $dialog -and $_.Visible -and $_.Width -gt 60 -and $_.Height -gt 40 })
    $popupText = ($popups | ForEach-Object { "$($_.Class) `"$($_.Text)`"" }) -join ' | '

    $signature = ((($children | ForEach-Object { $_.Signature } | Sort-Object) -join '|') + '||' + $popupText)

    if ($signature -ne $lastSignature) {
        $lastSignature = $signature
        $shotIndex++
        $shot = Join-Path $runDir ('state-{0:D2}.png' -f $shotIndex)
        $raw = Join-Path $runDir ('state-{0:D2}.bmp' -f $shotIndex)
        if ($ScreenCapture) { [void][PhanerisInstallerProbe]::Raise($dialog) }
        $captured = if ($ScreenCapture) {
            [PhanerisInstallerProbe]::ScreenCapture($dialog, $raw)
        } else {
            [PhanerisInstallerProbe]::Screenshot($dialog, $raw)
        }
        if ($captured) {
            if (-not (Convert-ShotToPng $raw $shot)) { $shot = $raw }
        } else {
            $shot = '(capture failed)'
        }
        $buttons = ($visible | Where-Object { $_.Class -eq 'Button' } |
            ForEach-Object { '"{0}"@y{1}' -f $_.Text, $_.Top }) -join ' '
        $overlay = $visible | Where-Object { $_.Text -match '%' } | Select-Object -First 1
        $stack = ([PhanerisInstallerProbe]::ZOrder($dialog) |
            ForEach-Object { "$($_.Class)#$($_.Id)" }) -join ' > '
        Write-Timeline ("state {0}: {1} visible child(ren); buttons: {2}{3}" -f
            $shotIndex, $visible.Count, $buttons,
            $(if ($overlay) { "; overlay text: `"$($overlay.Text)`"" } else { '' }))
        if ($popupText) { Write-Timeline "           POPUP: $popupText" }
        Write-Timeline ("           z-order top-first: $stack")
        Write-Timeline ("           screenshot: $shot")

        # A popup is the whole reason the run is failing, so give it its own
        # capture and its full text rather than a one-line summary.
        foreach ($popup in $popups) {
            Write-Timeline ("           popup window $popup")
            $popupShot = Join-Path $runDir ('state-{0:D2}-popup-{1}.png' -f $shotIndex, $popup.Handle.ToInt64())
            $popupRaw = Join-Path $runDir ('state-{0:D2}-popup-{1}.bmp' -f $shotIndex, $popup.Handle.ToInt64())
            $popupCaptured = if ($ScreenCapture) {
                [PhanerisInstallerProbe]::ScreenCapture($popup.Handle, $popupRaw)
            } else {
                [PhanerisInstallerProbe]::Screenshot($popup.Handle, $popupRaw)
            }
            if ($popupCaptured) {
                if (-not (Convert-ShotToPng $popupRaw $popupShot)) { $popupShot = $popupRaw }
                Write-Timeline "           popup screenshot: $popupShot"
            }
        }

        # Full unfiltered table, because "the surface is missing" and "the
        # surface exists but is hidden or zero-sized" look identical in counts.
        $dumpPath = Join-Path $runDir ('state-{0:D2}.windows.txt' -f $shotIndex)
        [System.IO.File]::WriteAllText($dumpPath, [PhanerisInstallerProbe]::Dump($dialog))
        $notable = $children | Where-Object {
            $_.Class -like 'Phaneris*' -or $_.Id -in @(1, 2, 3, 1004, 1006, 1016, 1018, 1027, 1034, 1035, 1036, 1037, 1038, 1039, 1046)
        }
        foreach ($w in $notable) { Write-Timeline ("           win $w") }
    }

    # Which of the plugin/NSIS contract properties exist right now. Logged on
    # change so a callback that never ran leaves an obvious gap.
    $inner = $children | Where-Object { $_.Class -eq '#32770' } | Select-Object -First 1
    $innerHandle = if ($inner) { $inner.Handle } else { [IntPtr]::Zero }
    $marks = [PhanerisInstallerProbe]::MarkSummary($dialog, $innerHandle)
    if ($marks -ne $lastMarks) {
        $lastMarks = $marks
        Write-Timeline "           marks: $marks  (-1 = property absent)"
    }

    # $PLUGINSDIR is where the plugin has to land, and watching for it separates
    # "never extracted" from "extracted and refused to load" -- the difference
    # between a staging bug and an import/architecture bug.
    #
    # The DIRECTORY's timestamp is the test, not the file's: NSIS's File command
    # preserves the source file's modification time, so the staged DLL carries the
    # build time and looked older than the run that created it. Matching on that
    # produced a false "never staged" while the plugin was loading and drawing
    # perfectly. %TEMP% also keeps ns*.tmp from every installer ever force-killed,
    # so the directory has to be one this run created.
    if (-not $pluginStaged) {
        $nsDirs = @(Get-ChildItem -Path $env:TEMP -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -ge $launchStamp })
        foreach ($nsDir in $nsDirs) {
            $stagedFile = Get-Item (Join-Path $nsDir.FullName 'windowframe.dll') -ErrorAction SilentlyContinue
            if ($stagedFile) {
                $pluginStaged = $true
                $pluginStagedBytes = $stagedFile.Length
                $pluginStagedPath = $stagedFile.FullName
                Write-Timeline "plugin staged: $pluginStagedPath ($pluginStagedBytes bytes)"
                break
            }
        }
    }

    # -- observations ------------------------------------------------------
    $progressChild = $null
    foreach ($child in $children) {
        if ($child.Text -match '(\d+)\s*%') {
            $progressChild = $child
            $overlaySamples.Add([pscustomobject]@{
                at      = (Get-Date)
                overlay = [int]$Matches[1]
                stock   = [PhanerisInstallerProbe]::StockProgress($dialog)
                cpu     = [math]::Round($proc.TotalProcessorTime.TotalSeconds, 2)
            })
        }
    }

    $buttons = [PhanerisInstallerProbe]::VisibleButtons($dialog)
    # Sampled every tick rather than once at the end: the finish page's own MUI
    # statics only appear after the section completes, so an end-of-run read
    # missed exactly the chrome that leaked through.
    $visibleStock = @($visible | Where-Object { $_.Id -in @(1, 2, 3, 1028, 1256, 1034, 1035, 1036, 1037, 1038, 1039, 1046) })
    if ($visibleStock.Count -gt 0) {
        $stockEverVisible = $true
        if (-not $stockReported) {
            Write-Timeline ("STOCK CHROME VISIBLE: " + (($visibleStock | ForEach-Object { "$($_.Id)='$($_.Text)'" }) -join ', '))
            $stockReported = $true
        }
    }
    # The launch toggle is created on both pages but shown only by the finish
    # phase's render, so a VISIBLE checkbox -- not geometry -- is what proves the
    # finish page was reached and is interactive.
    $checkBoxes = [PhanerisInstallerProbe]::VisibleCheckBoxes($dialog)
    if ($checkBoxes.Count -gt 0) {
        if (-not $finishHadCheckbox) {
            Write-Timeline ("FINISH checkbox(es): " + (($checkBoxes | ForEach-Object {
                '"{0}" checked={1}' -f $_.Text, [PhanerisInstallerProbe]::CheckState($_.Handle) }) -join ' '))
        }
        $finishHadCheckbox = $true
    }

    # -- acting ------------------------------------------------------------
    # The finish page is the one moment the installer is provably idle, so it is
    # where defect 7 is measurable: the old plugin repainted its whole 600x600
    # surface on a 16 ms timer, which is invisible during extraction but burns
    # about a core while nothing is happening. Dwell before completing, both to
    # measure that and to give the review screenshot a stable page.
    if ($finishHadCheckbox) {
        if ($null -eq $idleWallStart) {
            $idleWallStart = Get-Date
            $idleCpuStart = $proc.TotalProcessorTime.TotalSeconds
            Write-Timeline "dwelling on the finish page for $FinishDwellSeconds s to measure idle CPU"
        } elseif ($null -eq $idleCpuSeconds -and ((Get-Date) - $idleWallStart).TotalSeconds -ge $FinishDwellSeconds) {
            $idleCpuSeconds = [math]::Round($proc.TotalProcessorTime.TotalSeconds - $idleCpuStart, 2)
            $idleWallSeconds = [math]::Round(((Get-Date) - $idleWallStart).TotalSeconds, 1)
            Write-Timeline "finish page idle: $idleCpuSeconds CPU-second(s) over $idleWallSeconds s"
        }
    }
    $dwellSatisfied = (-not $finishHadCheckbox) -or ($null -ne $idleCpuSeconds)

    if ($ClickPrimary -and -not $progressChild -and $buttons.Count -gt 0 -and $dwellSatisfied) {
        $matchedCaption = $false
        $primary = [PhanerisInstallerProbe]::PrimaryButton($dialog, $PrimaryCaption, [ref]$matchedCaption)
        if ($primary) {
            $key = "click-$($primary.Text)-$($primary.Top)"
            if (-not $clickedStates.ContainsKey($key)) {
                # Let the page settle before clicking it: a page's controls exist
                # before nsDialogs::Show has finished laying it out, and a click
                # that lands mid-show is not what a user does.
                if (-not $seenAt.ContainsKey($key)) {
                    $seenAt[$key] = Get-Date
                } elseif (((Get-Date) - $seenAt[$key]).TotalMilliseconds -ge $SettleMilliseconds) {
                    $clickedStates[$key] = $true
                    $how = [PhanerisInstallerProbe]::Click($primary.Handle)
                    Write-Timeline ("CLICK  `"{0}`" (id={1} y={2}) via {3}{4}" -f $primary.Text, $primary.Id, $primary.Top, $how,
                        $(if ($matchedCaption) { '' } else { ' [no caption match; fell back to bottom-most button]' }))
                }
            }
        }
    }

    # A progress page that has not moved for 8 samples is the stall we are
    # hunting. @() around the pipeline is load-bearing: when every sample is
    # equal the pipeline yields a single Int32, and .Count on a scalar throws
    # under Set-StrictMode -- which is how this check first crashed.
    if ($progressChild -and -not $stallReported -and $overlaySamples.Count -gt 8) {
        $recent = @($overlaySamples[-8..-1])
        $span = ($recent[-1].at - $recent[0].at).TotalSeconds
        if ($span -gt 0 -and @($recent | Select-Object -ExpandProperty overlay | Sort-Object -Unique).Count -eq 1) {
            Write-Timeline ("STALL  overlay pinned at {0}% for {1:N1}s" -f $recent[0].overlay, $span)
            $stallReported = $true
        }
    }

    Start-Sleep -Milliseconds 150
}

# ---------------------------------------------------------------------------
# Settle, then verify the end state
# ---------------------------------------------------------------------------
Start-Sleep -Seconds 2
$proc.Refresh()
$cpuSeconds = if ($cpuStart) { [math]::Round(($proc.TotalProcessorTime - $cpuStart).TotalSeconds, 1) } else { -1 }

Set-Check 'outer-dialog-600x600' ($parked) $(if ($parked) { 'appeared and was parked' } else { 'never appeared' })

Write-Timeline "distinct UI states captured: $shotIndex"

Set-Check 'plugin-staged' $pluginStaged $(if ($pluginStaged) { "windowframe.dll staged at $pluginStagedPath ($pluginStagedBytes bytes)" } else { 'windowframe.dll never appeared under %TEMP%\ns*\' })

# Stock chrome: sampled continuously above, because the leak happened exactly on
# the one page an end-of-run read could not see.
Set-Check 'stock-chrome-hidden' (-not $stockEverVisible) $(if ($stockEverVisible) { 'stock MUI chrome was visible during the run -- see the timeline' } else { 'no stock MUI control was ever visible' })

# Progress provenance. This check used to require that the overlay never ran
# AHEAD of the stock InstFiles bar, on the assumption that the bar carries the
# real number and the overlay only fills gaps. Two runs of this harness measured
# that assumption to be false for this installer: the bar read 0 % in every one
# of ~250 samples across a 49-second install section, because electron-builder
# extracts through the nsis7z plugin, which never drives it. A gate that forbids
# the overlay from leading a dead source can only be satisfied by a bar that
# stays at 0 %, which is the defect the pass set out to fix.
#
# What is checked instead is what the model actually promises:
#
#   * monotone -- the bar never goes backwards;
#   * a moving stock reading is a FLOOR, never a ceiling: whenever the stock bar
#     itself advances, the overlay must be at or above it (this is the half of
#     provenance that still has teeth);
#   * it keeps moving -- at least four distinct values, not one pinned number;
#   * it never paints 100 % before the success path authorises it (kAutoCeiling
#     caps everything else at 99), which is checked on the values that arrive
#     before the last sample.
$tracks = $false
$tracksDetail = 'no overlay samples'
$peak = 0
if ($overlaySamples.Count -ge 5) {
    $values = @($overlaySamples | Select-Object -ExpandProperty overlay)
    $backwards = 0
    for ($i = 1; $i -lt $values.Count; $i++) {
        if ($values[$i] -lt $values[$i - 1]) { $backwards++ }
    }
    $distinct = @($values | Sort-Object -Unique).Count
    $peak = ($values | Measure-Object -Maximum).Maximum
    $bar = @($overlaySamples | Where-Object { $_.stock -ge 0 })
    # How far the overlay runs ahead of the bar at its worst, recorded rather
    # than gated: the overlay's number is an estimate, and the bar is a
    # phase-local one that resets (measured 15283 -> 5640 -> 19302 on a 0..30000
    # range), so a lead is expected and a bound on it would be meaningless.
    #
    # What is gated is the other direction, against the bar's RUNNING MAXIMUM:
    # the highest reading seen is a real floor under the overlay, and the overlay
    # must honour it. The comparison uses the maximum as of the PREVIOUS sample,
    # because of how this loop measures: it reads the overlay's caption first and
    # the bar a few milliseconds later, so a sample can legitimately pair a
    # caption from before a coarse bar step with a bar from after it (NSIS moves
    # this bar in jumps of up to 28 points). One sample of lag is that race; two
    # would be the model ignoring its floor, which is the defect this catches.
    # The first sample is skipped by the same rule: there is no previous maximum
    # yet, and the overlay's first frame is painted before the model has seen the
    # bar at all.
    $lead = -999
    $barMax = -1
    $worstLag = 0
    $behind = 0
    foreach ($sample in $overlaySamples) {
        if ($sample.stock -ge 0) {
            if (($sample.overlay - $sample.stock) -gt $lead) { $lead = $sample.overlay - $sample.stock }
            if ($barMax -ge 0) {
                $lag = $barMax - $sample.overlay
                if ($lag -gt $worstLag) { $worstLag = $lag }
                if ($lag -gt 5) { $behind++ }
            }
            if ($sample.stock -gt $barMax) { $barMax = $sample.stock }
        }
    }
    # A 100 % reading is only legal on the final sample: everything earlier is
    # the estimate and must stay under kAutoCeiling.
    $earlyHundred = @($values[0..($values.Count - 2)] | Where-Object { $_ -ge 100 }).Count
    $barEnd = if ($bar.Count -gt 0) { $bar[-1].stock } else { -1 }
    $tracks = ($backwards -eq 0) -and ($distinct -ge 4) -and ($bar.Count -gt 0) -and
        ($behind -eq 0) -and ($earlyHundred -eq 0) -and ($peak -ge 99)
    $tracksDetail = "$($values.Count) samples, $distinct distinct, $backwards backward step(s), peak ${peak}%, " +
        "stock bar read $($bar.Count)x ending at ${barEnd}% (max ${barMax}%), worst lead over the bar $lead, " +
        "$behind sample(s) more than 5 points below the bar's previous maximum (worst $worstLag), " +
        "$earlyHundred early 100% frame(s)"
}
Set-Check 'progress-tracks-real-bar' $tracks $tracksDetail

# 99 rather than 100: the overlay is destroyed as soon as the finish page is
# built, and a 150 ms sampler can land just short of the last frame.
Set-Check 'progress-reached-100' ($peak -ge 99) "peak overlay value ${peak}%"

# The overlay must not outlive the page that owns it. This is the 98% bug.
$lingering = @()
if ([PhanerisInstallerProbe]::Alive($dialog)) {
    $lingering = @([PhanerisInstallerProbe]::Descendants($dialog) |
        Where-Object { $_.Class -like 'Phaneris*' -and $_.Text -match '%' })
}
Set-Check 'overlay-destroyed-before-finish' ($lingering.Count -eq 0) $(if ($lingering.Count -eq 0) { 'no progress surface survives the InstFiles page' } else { "lingering: $($lingering | ForEach-Object { $_.Class })" })

Set-Check 'finish-page-interactive' $finishHadCheckbox $(if ($finishHadCheckbox) { 'a visible checkbox appeared alongside the forward button' } else { 'the finish page never offered a launch checkbox' })

# ---------------------------------------------------------------------------
# Filesystem and registry
# ---------------------------------------------------------------------------
$appExe = Join-Path $ExpectedInstallDir 'Phaneris.exe'
Set-Check 'installed-to-expected-dir' (Test-Path $appExe) $ExpectedInstallDir

# Two separate questions, because they belong to different programs. The first is
# the installer's job and is what defect 4 was about; the second is the app's own
# startup, and conflating them made an app that quits on launch look like an
# installer that never launched anything.
#
# Electron takes a moment to appear and the click that launches it is immediately
# followed by the installer exiting, which is what ends the observation loop, so
# this polls rather than checking once.
$appSeen = $false
$appAlive = $false
$appPid = $null
$appDeadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $appDeadline) {
    $live = @(Get-Process -Name 'Phaneris' -ErrorAction SilentlyContinue)
    if ($live.Count -gt 0) {
        $appSeen = $true
        $appPid = ($live.Id -join ', ')
        Write-Timeline "app process appeared: pid $appPid"
        Start-Sleep -Milliseconds 1200
        $live = @(Get-Process -Name 'Phaneris' -ErrorAction SilentlyContinue)
        if ($live.Count -gt 0) {
            $appAlive = $true
            Write-Timeline "app still running 1.2 s later"
        } else {
            Write-Timeline "app had already exited 1.2 s later"
        }
        break
    }
    Start-Sleep -Milliseconds 200
}
Set-Check 'installer-launched-app' $appSeen $(if ($appSeen) { "a Phaneris process was created (pid $appPid)" } else { 'no Phaneris process within 20 s of the finish click' })
Set-Check 'app-stayed-running' $appAlive $(if ($appAlive) { 'the app was still running 1.2 s after launch' } else { 'the app started and exited immediately -- an app startup problem, not a launch problem' })

$uninstallKey = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'Phaneris*' } | Select-Object -First 1
$location = if ($uninstallKey) { $uninstallKey.InstallLocation } else { $null }
Set-Check 'registry-install-location' ([bool]$location -and $location -eq $ExpectedInstallDir) $(if ($uninstallKey) { "InstallLocation='$location'" } else { 'no uninstall entry' })

$startMenu = @(Get-ChildItem -Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Filter 'Phaneris*.lnk' -Recurse -ErrorAction SilentlyContinue)
Set-Check 'start-menu-shortcut' ($startMenu.Count -gt 0) $(if ($startMenu.Count -gt 0) { $startMenu[0].FullName } else { 'missing' })
$desktop = @(Get-ChildItem -Path ([Environment]::GetFolderPath('Desktop')) -Filter 'Phaneris*.lnk' -ErrorAction SilentlyContinue)
Set-Check 'desktop-shortcut' ($desktop.Count -gt 0) $(if ($desktop.Count -gt 0) { $desktop[0].FullName } else { 'missing' })

# Defect 7 measured where it is unambiguous. Total process CPU is deliberately
# NOT a gate: it is dominated by 7-Zip decompressing ~500 MB of Electron, which
# varies by machine far more than the repaint burn ever did, so gating on it
# would fail for the wrong reason. It is recorded in the report instead.
$idleOk = ($null -ne $idleCpuSeconds) -and ($idleCpuSeconds -le 1.5) -and ($idleWallSeconds -ge 2)
Set-Check 'idle-cpu' $idleOk $(if ($null -ne $idleCpuSeconds) { "$idleCpuSeconds CPU-second(s) over $idleWallSeconds s sitting on the finish page" } else { 'finish page never reached, so idle CPU could not be measured' })

# A flow that never finishes leaves the installer alive forever -- that is what
# the 98% stall looked like from outside, and a surviving installer also holds
# apps/electron/release/ open, which stalls the next build's signing step.
Set-Check 'installer-exited' ($proc.HasExited) $(if ($proc.HasExited) { "exit code $($proc.ExitCode)" } else { 'still running: the flow never completed' })

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
$failed = @($checks.Keys | Where-Object { -not $checks[$_].pass })
$report = [ordered]@{
    installer   = $InstallerPath
    builtAt     = (Get-Item $InstallerPath).LastWriteTime.ToString('o')
    runAt       = (Get-Date).ToString('o')
    runDir      = $runDir
    exitCode    = $(if ($proc.HasExited) { $proc.ExitCode } else { $null })
    cpuSeconds  = $cpuSeconds
    idleCpu     = $idleCpuSeconds
    idleWall    = $idleWallSeconds
    uiStates    = $shotIndex
    checks      = $checks
    failed      = $failed
    overlay     = $overlaySamples
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding utf8

Write-Timeline ''
Write-Timeline "=== $($checks.Count - $failed.Count)/$($checks.Count) checks passed ==="
foreach ($name in $checks.Keys) {
    Write-Timeline ("  {0,-32} {1}" -f $name, $(if ($checks[$name].pass) { 'PASS' } else { 'FAIL' }))
}
Write-Timeline "report:   $reportPath"
Write-Timeline "timeline: $timelinePath"
Write-Timeline "shots:    $runDir\state-*.png"

if (-not $KeepInstall) {
    # The launched app holds the install directory open, so it has to go first.
    foreach ($app in @(Get-Process -Name 'Phaneris' -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
        Write-Timeline "stopped app pid $($app.Id)"
    }
    # Never leave an installer behind: it would keep release/ locked and make the
    # next verification run start against a stale artifact.
    $proc.Refresh()
    if (-not $proc.HasExited) {
        Write-Timeline "installer pid $($proc.Id) outlived the run; terminating it"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}

if ($failed.Count -gt 0) { exit 1 }
exit 0
