<#
.SYNOPSIS
Drives the built Phaneris installer through every interaction state and
photographs each one, because the gate harness only photographs what changes on
its own.

.DESCRIPTION
verify-windows-installer.ps1 answers "does the flow work". It cannot answer "what
does the button look like while the pointer is over it", because nothing in a
scripted BM_CLICK produces a hover, a press that is never released, keyboard
focus, or a disabled control. Those four states are exactly where a control
either reads as considered or as cheap, so they are driven here by message --
the same messages Windows sends -- and captured off the screen.

What it captures, per theme:

  welcome-idle              the page as it first appears
  welcome-hover-primary     the pointer genuinely over the primary button
  welcome-pressed-primary   WM_LBUTTONDOWN with no matching up
  welcome-focus-primary     focus moved with WM_NEXTDLGCTL, as Tab does
  welcome-hover-secondary   the same states on the secondary control
  welcome-focus-secondary
  welcome-disabled-primary  EnableWindow(FALSE), i.e. the real disabled state
  welcome-expanded          the install-location editor, opened by clicking
  welcome-expanded-longpath the same editor holding a long $INSTDIR
  progress-early            the overlay as the install section starts
  progress-late             the same overlay after the percentage has moved
  finish                    the completion page

Hover is produced by MOVING THE CURSOR, not by posting WM_MOUSEMOVE, and that is
a measurement rather than a preference: comctl32's button tracks the pointer
itself rather than the message, so a posted WM_MOUSEMOVE leaves BM_GETSTATE at
0x0000 and nothing repaints, while a real one-pixel cursor move onto the control
sets BST_HOT (0x0200) and repaints with the hover fill. The cursor is moved back
to where it was before the run ends.

Each state is captured by BitBlt off the screen (PrintWindow does not contain
GDI-painted child windows), so the installer is parked fully visible and raised
without activation. Every state's caption, BM_GETSTATE and the primary button's
fill colour -- sampled 14 px inside the left edge, clear of the caption glyphs --
are logged, because "the button changed on hover" is a claim that should come
with a colour.

.PARAMETER Theme
light or dark. Passed to the installer as /THEME=; both are run for a review.

.PARAMETER OutDir
Where the PNGs land. Defaults to apps/electron/release/verify-shots.

.PARAMETER WelcomeOnly
Stop after the welcome-page states. Used for the long-path experiment, which
must not be allowed to install anywhere.

.EXAMPLE
pwsh -File apps/electron/scripts/capture-installer-states.ps1 -Theme light
#>
[CmdletBinding()]
param(
    [string]$InstallerPath,
    [ValidateSet('light', 'dark')] [string]$Theme = 'light',
    [string]$OutDir,
    [switch]$WelcomeOnly,
    [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$electronDir = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $electronDir 'release\verify-shots' }
if (-not $InstallerPath) {
    $candidate = Get-ChildItem (Join-Path $electronDir 'release') -Filter 'Phaneris-*-win-x64.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $candidate) { throw 'No Phaneris-*-win-x64.exe in apps/electron/release; build it first.' }
    $InstallerPath = $candidate.FullName
}
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# The installer locks release/ while it runs, so refuse to start on top of one.
$stale = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Phaneris*' }
if ($stale) { throw "A previous installer or app is still running (PID $($stale.Id -join ', ')). Kill it first." }

if (-not ('PhanerisStateProbe' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public sealed class StateWindow {
    public IntPtr Handle;
    public string Class = "";
    public string Text = "";
    public int Id;
    public bool Visible;
    public bool Enabled;
    public int Style;
    public int Left, Top, Right, Bottom;
    public int Width { get { return Right - Left; } }
    public int Height { get { return Bottom - Top; } }
    public bool IsCheckBox {
        get {
            if (Class != "Button") return false;
            int kind = Style & 0x0F;
            return kind == 2 || kind == 3 || kind == 4 || kind == 5 || kind == 6 || kind == 9;
        }
    }
    public override string ToString() {
        return string.Format("cls={0,-24} id={1,-5} vis={2,-5} en={3,-5} rect=({4},{5})-({6},{7}) text=\"{8}\"",
            Class, Id, Visible, Enabled, Left, Top, Right, Bottom, Text);
    }
}

public static class PhanerisStateProbe {
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
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
    [DllImport("gdi32.dll")] private static extern uint GetPixel(IntPtr dc, int x, int y);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, byte[] bits, ref BITMAPINFO info, uint usage);
    [DllImport("user32.dll")] private static extern bool EnableWindow(IntPtr hwnd, bool enable);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] private static extern IntPtr SendMessageText(IntPtr hwnd, uint msg, IntPtr wp, string text);

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }

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

    private const uint WM_MOUSEMOVE = 0x0200;
    private const uint WM_MOUSELEAVE = 0x02A3;
    private const uint WM_LBUTTONDOWN = 0x0201;
    private const uint WM_CANCELMODE = 0x001F;
    private const uint WM_NEXTDLGCTL = 0x0028;
    private const uint WM_SETTEXT = 0x000C;
    private const uint EM_SETSEL = 0x00B1;
    private const uint BM_CLICK = 0x00F5;
    private const uint BM_GETCHECK = 0x00F0;
    private const uint BM_GETSTATE = 0x00F2;
    private const uint SRCCOPY = 0x00CC0020;
    private const int GWL_STYLE = -16;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

    private static StateWindow Describe(IntPtr hwnd) {
        var info = new StateWindow();
        info.Handle = hwnd;
        var cls = new StringBuilder(256);
        GetClassNameW(hwnd, cls, cls.Capacity);
        info.Class = cls.ToString();
        var text = new StringBuilder(2048);
        GetWindowTextW(hwnd, text, text.Capacity);
        info.Text = text.ToString();
        info.Id = GetDlgCtrlID(hwnd);
        info.Visible = IsWindowVisible(hwnd);
        info.Enabled = IsWindowEnabled(hwnd);
        info.Style = GetWindowLongW(hwnd, GWL_STYLE);
        RECT r;
        if (GetWindowRect(hwnd, out r)) { info.Left = r.Left; info.Top = r.Top; info.Right = r.Right; info.Bottom = r.Bottom; }
        return info;
    }

    public static List<StateWindow> Descendants(IntPtr parent) {
        var found = new List<StateWindow>();
        EnumChildWindows(parent, (hwnd, p) => { found.Add(Describe(hwnd)); return true; }, IntPtr.Zero);
        return found;
    }

    public static IntPtr OuterDialog(uint pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((hwnd, p) => {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != pid) return true;
            var w = Describe(hwnd);
            if (w.Class == "#32770" && w.Width >= 400 && w.Height >= 400) { result = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static bool Alive(IntPtr hwnd) { return hwnd != IntPtr.Zero && IsWindow(hwnd); }

    /// Fully on screen and raised without activation: a screen capture needs the
    /// pixels visible, and the user's foreground window must not change.
    public static bool Present(IntPtr hwnd) {
        return SetWindowPos(hwnd, HWND_TOPMOST, 8, 8, 0, 0, 0x0001 | 0x0002 | 0x0010);
    }

    public static bool Drop(IntPtr hwnd) {
        return SetWindowPos(hwnd, HWND_NOTOPMOST, 8, 8, 0, 0, 0x0001 | 0x0002 | 0x0010);
    }

    /// Where the pointer has to be for the control to be hovered: its centre,
    /// in screen coordinates.
    public static int[] ScreenCentre(IntPtr hwnd) {
        RECT r;
        GetWindowRect(hwnd, out r);
        return new int[] { (r.Left + r.Right) / 2, (r.Top + r.Bottom) / 2 };
    }

    /// A real pointer move. comctl32's button sets BST_HOT from this and from
    /// nothing else -- a posted WM_MOUSEMOVE leaves the state at 0.
    public static string Hover(IntPtr hwnd) {
        int[] to = ScreenCentre(hwnd);
        SetCursorPos(to[0] - 24, to[1]);
        System.Threading.Thread.Sleep(80);
        SetCursorPos(to[0], to[1]);
        return string.Format("SetCursorPos({0},{1})", to[0], to[1]);
    }

    public static string Unhover(IntPtr hwnd) {
        RECT r;
        GetWindowRect(hwnd, out r);
        SetCursorPos(Math.Max(4, r.Left - 40), r.Top + 4);
        SendMessageW(hwnd, WM_MOUSELEAVE, IntPtr.Zero, IntPtr.Zero);
        return "cursor off the control";
    }

    public static int[] Cursor() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }
    public static void Cursor(int x, int y) { SetCursorPos(x, y); }

    public static string Press(IntPtr hwnd, int x, int y) {
        IntPtr packed = (IntPtr)((y << 16) | (x & 0xFFFF));
        SendMessageW(hwnd, WM_LBUTTONDOWN, (IntPtr)1, packed);
        return string.Format("WM_LBUTTONDOWN({0},{1})", x, y);
    }

    public static string Release(IntPtr hwnd) {
        SendMessageW(hwnd, WM_CANCELMODE, IntPtr.Zero, IntPtr.Zero);
        return "WM_CANCELMODE";
    }

    /// Focus the way Tab does it: the dialog's own WM_NEXTDLGCTL handling, so
    /// the button receives a real WM_SETFOCUS rather than a faked state bit.
    public static string Focus(IntPtr dialog, IntPtr control) {
        SendMessageW(dialog, WM_NEXTDLGCTL, control, (IntPtr)1);
        return "WM_NEXTDLGCTL";
    }

    public static string Enable(IntPtr hwnd, bool enabled) {
        bool ok = EnableWindow(hwnd, enabled);
        return "EnableWindow(" + (enabled ? "TRUE" : "FALSE") + ")=" + ok;
    }

    /// BM_GETSTATE, decoded. hot=0x200, pushed=0x4, focus=0x8 -- the bits the
    /// custom draw acts on, read straight off the live control.
    public static string State(IntPtr hwnd) {
        long state = (long)SendMessageW(hwnd, BM_GETSTATE, IntPtr.Zero, IntPtr.Zero);
        return string.Format("0x{0:X4} hot={1} pushed={2} focus={3}",
            state, (state & 0x200) != 0, (state & 0x4) != 0, (state & 0x8) != 0);
    }

    public static string Click(IntPtr hwnd) {
        // Posted, not sent. A click on the welcome page's action runs NSIS's
        // preflight, and a preflight that refuses (a leftover non-empty $INSTDIR
        // is the one that bit this script) puts up a MODAL MessageBox from inside
        // the button's notification -- so a synchronous SendMessage never
        // returns and the capture hangs with no output. Posting cannot block.
        PostMessageW(hwnd, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
        return "BM_CLICK(posted)";
    }

    /// Every top-level window the installer owns, so a modal refusal is visible
    /// in the log instead of being an unexplained silence.
    public static List<string> TopLevel(uint pid) {
        var found = new List<string>();
        EnumWindows((hwnd, p) => {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != pid) return true;
            if (!IsWindowVisible(hwnd)) return true;
            var cls = new StringBuilder(128);
            GetClassNameW(hwnd, cls, cls.Capacity);
            var text = new StringBuilder(512);
            GetWindowTextW(hwnd, text, text.Capacity);
            found.Add(cls + " \"" + text + "\"");
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static int CheckState(IntPtr hwnd) { return (int)SendMessageW(hwnd, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero); }

    public static string SetText(IntPtr hwnd, string text) {
        SendMessageText(hwnd, WM_SETTEXT, IntPtr.Zero, text);
        SendMessageW(hwnd, EM_SETSEL, IntPtr.Zero, IntPtr.Zero);
        return "WM_SETTEXT(" + text.Length + " chars)";
    }

    /// The fill colour of a control, sampled 14 px inside its left edge at
    /// mid-height: inside the rounded surface, and clear of the centred caption
    /// glyphs, which is where the first attempt at this measured antialiased
    /// text and reported the same colour for every state.
    public static string Fill(IntPtr hwnd) {
        RECT r, c;
        if (!GetWindowRect(hwnd, out r)) return "(no rect)";
        GetClientRect(hwnd, out c);
        IntPtr screen = GetDC(IntPtr.Zero);
        uint color = GetPixel(screen, r.Left + 14, r.Top + (c.Bottom - c.Top) / 2);
        ReleaseDC(IntPtr.Zero, screen);
        if (color == 0xFFFFFFFF) return "(outside)";
        return string.Format("#{0:X2}{1:X2}{2:X2}", color & 0xFF, (color >> 8) & 0xFF, (color >> 16) & 0xFF);
    }

    /// The stock InstFiles bar, read the only way that is safe across processes:
    /// PBM_GETRANGE (0x0407) with a NULL lParam, once per limit, so no pointer is
    /// ever dereferenced in the installer's address space. 0x0401 would be
    /// PBM_SETRANGE -- it would overwrite the control being measured.
    public static string Bar(IntPtr dialog, IntPtr overlay) {
        IntPtr bar = IntPtr.Zero;
        foreach (var w in Descendants(dialog)) {
            if (w.Class == "msctls_progress32") { bar = w.Handle; break; }
        }
        var text = new StringBuilder(256);
        if (overlay != IntPtr.Zero) GetWindowTextW(overlay, text, text.Capacity);
        if (bar == IntPtr.Zero) return string.Format("bar=(none)        overlay=\"{0}\"", text);
        // Sorted, not assigned: see the note in verify-windows-installer.ps1 --
        // the FALSE call returns 30000 and the TRUE call 0 on this build, and
        // only the position (6792..30000) says which limit is which.
        int a = (int)SendMessageW(bar, 0x0407, IntPtr.Zero, IntPtr.Zero);
        int b = (int)SendMessageW(bar, 0x0407, (IntPtr)1, IntPtr.Zero);
        int low = Math.Min(a, b);
        int high = Math.Max(a, b);
        int pos = (int)SendMessageW(bar, 0x0408, IntPtr.Zero, IntPtr.Zero);
        double percent = (high > low) ? 100.0 * (pos - low) / (high - low) : -1;
        return string.Format("bar={0}..{1} pos={2} ({3:N1}%)  overlay=\"{4}\"", low, high, pos, percent, text);
    }

    public static bool Capture(IntPtr hwnd, string path) {
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

    private static bool WriteBmp(string path, byte[] pixels, int w, int h) {
        try {
            using (var file = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (var writer = new BinaryWriter(file)) {
                const int header = 14 + 40;
                writer.Write((byte)'B'); writer.Write((byte)'M');
                writer.Write(header + pixels.Length);
                writer.Write(0); writer.Write(header);
                writer.Write(40); writer.Write(w); writer.Write(-h);
                writer.Write((short)1); writer.Write((short)32);
                writer.Write(0); writer.Write(pixels.Length);
                writer.Write(2835); writer.Write(2835);
                writer.Write(0); writer.Write(0);
                writer.Write(pixels);
            }
            return true;
        } catch (IOException) { return false; }
    }
}
'@
}

$script:log = New-Object System.Collections.Generic.List[string]
function Note([string]$line) {
    $stamp = (Get-Date).ToString('HH:mm:ss.fff')
    $script:log.Add("$stamp  $line")
    Write-Host "$stamp  $line"
}

function Convert-ToPng([string]$bmpPath, [string]$pngPath) {
    try {
        Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop
        $image = [System.Drawing.Image]::FromFile($bmpPath)
        try { $image.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $image.Dispose() }
        Remove-Item $bmpPath -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function Save-State {
    param([IntPtr]$Dialog, [string]$Name, [string]$Detail = '')
    $bmp = Join-Path $OutDir "$Theme-$Name.bmp"
    $png = Join-Path $OutDir "$Theme-$Name.png"
    # Up to three attempts: a screen capture can land on a frame the window has
    # not painted yet, which comes back as a uniform 600x600 fill and compresses
    # to a couple of kilobytes. The first dark progress-early capture did exactly
    # that and shipped a blank white PNG as evidence.
    $ok = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($attempt -gt 1) { Start-Sleep -Milliseconds 250 }
        $ok = [PhanerisStateProbe]::Capture($Dialog, $bmp)
        if ($ok) {
            [void](Convert-ToPng $bmp $png)
            # The PNG is what says whether there was anything to see: an
            # unpainted frame is a uniform fill and compresses to a couple of
            # kilobytes, while every real state of this page is over ten.
            if ((Get-Item $png).Length -ge 6000 -or $attempt -eq 3) { break }
            $ok = $false
        }
    }
    $bytes = if ($ok -and (Test-Path $png)) { (Get-Item $png).Length } else { 0 }
    Note ("shot {0,-26} {1} ({2} bytes) {3}" -f $Name, $(if ($ok) { $png } else { '(capture failed)' }), $bytes, $Detail)
}

function Get-Control {
    param([IntPtr]$Dialog, [string]$Pattern, [string]$Class = 'Button')
    return [PhanerisStateProbe]::Descendants($Dialog) |
        Where-Object { $_.Visible -and $_.Class -eq $Class -and -not $_.IsCheckBox -and $_.Text -match $Pattern } |
        Sort-Object Top -Descending | Select-Object -First 1
}

function Get-Overlay([IntPtr]$Dialog) {
    return [PhanerisStateProbe]::Descendants($Dialog) |
        Where-Object { $_.Text -match '%' } | Select-Object -First 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
Note "installer: $InstallerPath"
Note "theme:     $Theme"
$cursorBefore = [PhanerisStateProbe]::Cursor()
$proc = Start-Process -FilePath $InstallerPath -ArgumentList "/THEME=$Theme" -PassThru
Note "launched pid=$($proc.Id) /THEME=$Theme (cursor was $($cursorBefore[0]),$($cursorBefore[1]))"

$dialog = [IntPtr]::Zero
$primary = $null
$secondary = $null
$idlePixel = ''
$hoverPixel = ''
$pressedPixel = ''
$disabledPixel = ''
$earlyText = ''
$lateText = ''

try {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline -and $dialog -eq [IntPtr]::Zero) {
        Start-Sleep -Milliseconds 120
        $proc.Refresh()
        if ($proc.HasExited) { throw "installer exited early with $($proc.ExitCode)" }
        $dialog = [PhanerisStateProbe]::OuterDialog([uint32]$proc.Id)
    }
    if ($dialog -eq [IntPtr]::Zero) { throw 'the outer dialog never appeared' }
    [void][PhanerisStateProbe]::Present($dialog)
    Start-Sleep -Milliseconds 700

    $primary = Get-Control $dialog '安装|完成|Install|Finish'
    $secondary = Get-Control $dialog '选择安装位置|Choose location'
    if (-not $primary) { throw 'no primary button on the welcome page' }
    Note "primary:   $primary"
    Note "secondary: $secondary"

    $shape = @([int]($primary.Width / 2), [int]($primary.Height / 2))

    # --- idle ---------------------------------------------------------------
    $idlePixel = [PhanerisStateProbe]::Fill($primary.Handle)
    Save-State $dialog 'welcome-idle' "fill $idlePixel  $([PhanerisStateProbe]::State($primary.Handle))"

    # --- hover --------------------------------------------------------------
    Note ([PhanerisStateProbe]::Hover($primary.Handle))
    Start-Sleep -Milliseconds 350
    $hoverPixel = [PhanerisStateProbe]::Fill($primary.Handle)
    Save-State $dialog 'welcome-hover-primary' "fill $hoverPixel  $([PhanerisStateProbe]::State($primary.Handle))"

    # --- pressed ------------------------------------------------------------
    Note ([PhanerisStateProbe]::Press($primary.Handle, $shape[0], $shape[1]))
    Start-Sleep -Milliseconds 300
    $pressedPixel = [PhanerisStateProbe]::Fill($primary.Handle)
    Save-State $dialog 'welcome-pressed-primary' "fill $pressedPixel  $([PhanerisStateProbe]::State($primary.Handle))"
    Note ([PhanerisStateProbe]::Release($primary.Handle))
    Note ([PhanerisStateProbe]::Unhover($primary.Handle))
    Start-Sleep -Milliseconds 300

    # --- keyboard focus -----------------------------------------------------
    Note ([PhanerisStateProbe]::Focus($dialog, $primary.Handle))
    Start-Sleep -Milliseconds 300
    Save-State $dialog 'welcome-focus-primary' "$([PhanerisStateProbe]::State($primary.Handle))"

    # --- the secondary control ---------------------------------------------
    if ($secondary) {
        $secondaryIdle = [PhanerisStateProbe]::Fill($secondary.Handle)
        Note ([PhanerisStateProbe]::Hover($secondary.Handle))
        Start-Sleep -Milliseconds 350
        $secondaryHover = [PhanerisStateProbe]::Fill($secondary.Handle)
        Save-State $dialog 'welcome-hover-secondary' "fill $secondaryIdle -> $secondaryHover  $([PhanerisStateProbe]::State($secondary.Handle))"
        Note ([PhanerisStateProbe]::Unhover($secondary.Handle))
        Start-Sleep -Milliseconds 250
        Note ([PhanerisStateProbe]::Focus($dialog, $secondary.Handle))
        Start-Sleep -Milliseconds 300
        Save-State $dialog 'welcome-focus-secondary' "$([PhanerisStateProbe]::State($secondary.Handle))"
    }

    # --- disabled -----------------------------------------------------------
    Note ([PhanerisStateProbe]::Enable($primary.Handle, $false))
    Start-Sleep -Milliseconds 400
    $disabledPixel = [PhanerisStateProbe]::Fill($primary.Handle)
    Save-State $dialog 'welcome-disabled-primary' "fill $disabledPixel  enabled=$($primary.Enabled)"
    Note ([PhanerisStateProbe]::Enable($primary.Handle, $true))
    Start-Sleep -Milliseconds 350

    # --- the expanded install-location editor -------------------------------
    if ($secondary) {
        Note ([PhanerisStateProbe]::Click($secondary.Handle))
        Start-Sleep -Milliseconds 800
        $edit = [PhanerisStateProbe]::Descendants($dialog) |
            Where-Object { $_.Visible -and $_.Class -eq 'Edit' } | Select-Object -First 1
        if ($edit) {
            Note "edit:      $edit"
            $browse = Get-Control $dialog '更改|Change'
            if ($browse) { Note ([PhanerisStateProbe]::Hover($browse.Handle)); Start-Sleep -Milliseconds 300 }
            Save-State $dialog 'welcome-expanded' "path `"$($edit.Text)`" ($($edit.Text.Length) chars)"
            if ($browse) { Note ([PhanerisStateProbe]::Unhover($browse.Handle)) }

            $long = "$env:LOCALAPPDATA\Programs\Phaneris-Enterprise-Preview-Channel-2026\app"
            Note ([PhanerisStateProbe]::SetText($edit.Handle, $long))
            Start-Sleep -Milliseconds 900
            Save-State $dialog 'welcome-expanded-longpath' "$($long.Length) chars: $long"
            Note ([PhanerisStateProbe]::SetText($edit.Handle, $edit.Text))
            Start-Sleep -Milliseconds 900
        } else {
            Note 'the editor never appeared after clicking the secondary control'
        }
    }

    if (-not $WelcomeOnly) {
        # --- progress -------------------------------------------------------
        $primary = Get-Control $dialog '安装|完成|Install|Finish'
        Note ([PhanerisStateProbe]::Click($primary.Handle))
        $overlay = $null
        $progressDeadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $progressDeadline -and -not $overlay) {
            Start-Sleep -Milliseconds 80
            $overlay = Get-Overlay $dialog
        }
        if (-not $overlay) {
            foreach ($line in [PhanerisStateProbe]::TopLevel([uint32]$proc.Id)) { Note "  top-level: $line" }
            throw 'the progress overlay never appeared (a modal preflight refusal is the usual reason -- see the top-level windows above)'
        }
        Note "overlay:   $overlay"
        # The window exists before it has painted, and the frame in between is
        # the dialog's own background; give the first paint a moment to land.
        Start-Sleep -Milliseconds 250
        $overlay = Get-Overlay $dialog

        $earlyText = $overlay.Text
        Save-State $dialog 'progress-early' "caption `"$earlyText`""
        $earlyPercent = [int]([regex]::Match($earlyText, '(\d+)\s*%').Groups[1].Value)
        $started = Get-Date

        $samples = New-Object System.Collections.Generic.List[string]
        $moveDeadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $moveDeadline) {
            Start-Sleep -Milliseconds 120
            $proc.Refresh()
            if ($proc.HasExited) { break }
            $current = Get-Overlay $dialog
            if (-not $current) { break }
            $match = [regex]::Match($current.Text, '(\d+)\s*%')
            if (-not $match.Success) { continue }
            $percent = [int]$match.Groups[1].Value
            $elapsed = ((Get-Date) - $started).TotalSeconds
            # The stock bar alongside the caption, because the model's honesty
            # claim is about WHICH source is driving the number at each moment:
            # a reading that moves is a floor, a dead one is ignored.
            $samples.Add(("{0,6:N1}s  {1}" -f $elapsed, [PhanerisStateProbe]::Bar($dialog, $current.Handle)))
            # "Late" has to be a genuinely different frame from "early", so it is
            # taken at 50 % or after 20 s, whichever comes first -- the point of
            # the pair is to show the percentage MOVING, not to catch the tail.
            if (-not $lateText -and (($percent - $earlyPercent) -ge 40 -or ($elapsed -ge 20 -and ($percent - $earlyPercent) -ge 10))) {
                $lateText = $current.Text
                Save-State $dialog 'progress-late' "caption `"$lateText`" after $([int]$elapsed)s (+$($percent - $earlyPercent) points)"
            }
            $checkboxSeen = [PhanerisStateProbe]::Descendants($dialog) |
                Where-Object { $_.Visible -and $_.IsCheckBox }
            if ($checkboxSeen) { break }
        }
        $samples | Set-Content -Path (Join-Path $OutDir "$Theme-progress-samples.txt") -Encoding utf8
        Note "progress samples: $($samples.Count)"

        # --- finish ---------------------------------------------------------
        $checkbox = $null
        $finishDeadline = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $finishDeadline -and -not $checkbox) {
            Start-Sleep -Milliseconds 150
            $proc.Refresh()
            if ($proc.HasExited) { break }
            $checkbox = [PhanerisStateProbe]::Descendants($dialog) |
                Where-Object { $_.Visible -and $_.IsCheckBox } | Select-Object -First 1
        }
        if ($checkbox) {
            Start-Sleep -Milliseconds 500
            Save-State $dialog 'finish' "launch checkbox `"$($checkbox.Text)`" checked=$([PhanerisStateProbe]::CheckState($checkbox.Handle))"
            # The checkbox is the second control Tab reaches on this page, and it
            # is the only one whose focus indicator is not the button ring.
            Note ([PhanerisStateProbe]::Focus($dialog, $checkbox.Handle))
            Start-Sleep -Milliseconds 300
            Save-State $dialog 'finish-focus-checkbox' "$([PhanerisStateProbe]::State($checkbox.Handle))"
            # Uncheck so the review run does not start the app, then complete.
            if ([PhanerisStateProbe]::CheckState($checkbox.Handle) -eq 1) {
                Note ([PhanerisStateProbe]::Click($checkbox.Handle))
                Start-Sleep -Milliseconds 250
            }
            $finish = Get-Control $dialog '完成|Finish'
            if ($finish) { Note ([PhanerisStateProbe]::Click($finish.Handle)) }
            Start-Sleep -Seconds 3
        } else {
            Note 'the finish page never appeared'
        }
    }
} finally {
    [PhanerisStateProbe]::Cursor($cursorBefore[0], $cursorBefore[1])
    if ($dialog -ne [IntPtr]::Zero) { [void][PhanerisStateProbe]::Drop($dialog) }
    $proc.Refresh()
    if (-not $proc.HasExited) {
        Note "installer pid $($proc.Id) outlived the run; terminating it"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    } else {
        Note "installer exited with $($proc.ExitCode)"
    }
    foreach ($app in @(Get-Process -Name 'Phaneris' -ErrorAction SilentlyContinue)) {
        Note "stopping app pid $($app.Id)"
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
    }
    if ($idlePixel) {
        Note "primary fill: idle $idlePixel   hover $hoverPixel   pressed $pressedPixel   disabled $disabledPixel"
        Note "progress:     early `"$earlyText`"   late `"$lateText`""
    }
    $script:log | Set-Content -Path (Join-Path $OutDir "$Theme-capture-log.txt") -Encoding utf8
    Note "log: $OutDir\$Theme-capture-log.txt"
}
