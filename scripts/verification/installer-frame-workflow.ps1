<# Native E2E: observes the real NSIS preview window without installing an app. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$InstallerPath,
    [ValidateSet('light', 'dark')] [string]$Theme = 'light',
    [string]$OutDir = 'docs/verification/results/ui-refinement'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerFrameWorkflow {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Nc { public Rect First, Second, Third; public IntPtr Position; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr z, int x, int y, int w, int t, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr h, StringBuilder text, int count);
    private delegate bool EnumProc(IntPtr h, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr h, EnumProc procedure, IntPtr data);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint attribute, out int value, uint size);
    [DllImport("dwmapi.dll")] public static extern int DwmFlush();
    [DllImport("user32.dll")] private static extern ushort RegisterClassExW(ref WindowClass cls);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint ex, string cls, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProcW(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr h);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateSolidBrush(uint color);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string name);
    private delegate IntPtr WindowProc(IntPtr h, uint msg, IntPtr w, IntPtr l);
    private static readonly WindowProc procedure = DefWindowProcW;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct WindowClass {
        public uint Size, Style; public IntPtr Procedure; public int ClassExtra, WindowExtra;
        public IntPtr Instance, Icon, Cursor, Brush; public string Menu, Name; public IntPtr SmallIcon;
    }
    public static IntPtr Backdrop(int width, int height) {
        var cls = new WindowClass { Size = (uint)Marshal.SizeOf<WindowClass>(), Procedure = Marshal.GetFunctionPointerForDelegate(procedure),
            Instance = GetModuleHandleW(null), Brush = CreateSolidBrush(0xEBE7E5), Name = "PhanerisInstallerFrameBackdrop" };
        if (RegisterClassExW(ref cls) == 0) throw new InvalidOperationException("Could not register capture backdrop");
        var window = CreateWindowExW(0x08000088, cls.Name, "", 0x90000000, 72, 8, width + 320, height + 288,
            IntPtr.Zero, IntPtr.Zero, cls.Instance, IntPtr.Zero);
        if (window == IntPtr.Zero) throw new InvalidOperationException("Could not create capture backdrop");
        UpdateWindow(window); return window;
    }
    public static bool Ready(IntPtr h) {
        bool ready = false;
        EnumChildWindows(h, (child, data) => {
            var text = new StringBuilder(128); GetWindowTextW(child, text, text.Capacity);
            if (IsWindowVisible(child) && (text.ToString() == "立即安装" || text.ToString() == "Install now")) ready = true;
            return !ready;
        }, IntPtr.Zero);
        return ready;
    }
    public static int[] Treatment(IntPtr h) {
        int corner, dark;
        int cornerResult = DwmGetWindowAttribute(h, 33, out corner, 4);
        int darkResult = DwmGetWindowAttribute(h, 20, out dark, 4);
        return new [] { cornerResult, corner, darkResult, dark };
    }
    public static Rect Calculate(IntPtr h, bool valid) {
        Rect r; GetWindowRect(h, out r);
        int size = valid ? Marshal.SizeOf<Nc>() : Marshal.SizeOf<Rect>();
        IntPtr p = Marshal.AllocHGlobal(size);
        try {
            if (valid) Marshal.StructureToPtr(new Nc { First = r, Second = r, Third = r }, p, false);
            else Marshal.StructureToPtr(r, p, false);
            SendMessage(h, 0x83, valid ? new IntPtr(1) : IntPtr.Zero, p);
            return Marshal.PtrToStructure<Rect>(p);
        } finally { Marshal.FreeHGlobal(p); }
    }
    public static int[] Geometry(IntPtr h) {
        Rect w, c; GetWindowRect(h, out w); GetClientRect(h, out c);
        Point p = new Point(); ClientToScreen(h, ref p);
        return new [] { w.Right-w.Left, w.Bottom-w.Top, c.Right-c.Left, c.Bottom-c.Top, p.X-w.Left, p.Y-w.Top };
    }
}
'@
$records = [System.Collections.Generic.List[object]]::new()
[void][InstallerFrameWorkflow]::SetProcessDPIAware()
$proc = Start-Process -FilePath (Resolve-Path -LiteralPath $InstallerPath).Path -ArgumentList "/THEME=$Theme" -WindowStyle Hidden -PassThru
$dialog = [IntPtr]::Zero
$backdrop = [IntPtr]::Zero
function Record-State([string]$Name) {
    Start-Sleep -Milliseconds 250
    $geometry = [InstallerFrameWorkflow]::Geometry($dialog)
    $bounds = [InstallerFrameWorkflow+Rect]::new()
    [void][InstallerFrameWorkflow]::GetWindowRect($dialog, [ref]$bounds)
    [void][InstallerFrameWorkflow]::DwmFlush()
    # Sample beyond the native shadow's tail, still within our own backdrop.
    $padding = 80
    $image = [System.Drawing.Bitmap]::new($bounds.Right-$bounds.Left+2*$padding, $bounds.Bottom-$bounds.Top+2*$padding)
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    try {
        $graphics.CopyFromScreen($bounds.Left-$padding, $bounds.Top-$padding, 0, 0, $image.Size)
        $image.Save((Join-Path (Resolve-Path $OutDir).Path "installer-$Theme-$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $y = $padding + [int]($geometry[1] / 3)
        $pixels = @(0, 2, 8, [int]($geometry[0]/2)) | ForEach-Object { $image.GetPixel($padding+$_,$y).ToArgb().ToString('X8') }
        $background = $image.GetPixel(0,$y).ToArgb()
        $shadow = @(4, 8, 16) | ForEach-Object { $image.GetPixel($padding-$_,$padding+[int]($geometry[1]/2)).ToArgb() }
        $backdropAccepted = $background.ToString('X8') -eq 'FFE5E7EB'
        $hasShadow = $backdropAccepted -and @($shadow | Where-Object { $_ -ne $background }).Count -gt 0
        $cornerPixel = $image.GetPixel($padding,$padding).ToArgb().ToString('X8')
    } finally { $graphics.Dispose(); $image.Dispose() }
    $treatment = [InstallerFrameWorkflow]::Treatment($dialog)
    $cornerAccepted = $treatment[0] -ne 0 -or ($treatment[1] -eq 2 -and $cornerPixel -ne $pixels[3])
    $themeAccepted = $treatment[2] -ne 0 -or $treatment[3] -eq $(if ($Theme -eq 'dark') { 1 } else { 0 })
    # Windows owns the one-pixel outline and rounded corner transparency.
    # The interior must remain flat; a classic sizing bevel is not allowed.
    $pass = $geometry[0] -eq $geometry[2] -and $geometry[1] -eq $geometry[3] -and $geometry[4] -eq 0 -and $geometry[5] -eq 0 -and $pixels[1] -eq $pixels[3] -and $pixels[2] -eq $pixels[3] -and $hasShadow -and $cornerAccepted -and $themeAccepted
    $records.Add(@{ name = $Name; pass = $pass; geometry = $geometry; edgePixels = $pixels; background = $background.ToString('X8'); shadow = $shadow; shadowVisible = $hasShadow; cornerPixel = $cornerPixel; treatment = $treatment })
    Write-Output "$Name pass=$pass geometry=$($geometry -join ',') edge=$($pixels -join ',')"
}
try {
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        $proc.Refresh(); $dialog = $proc.MainWindowHandle
        if ($dialog -ne [IntPtr]::Zero -and [InstallerFrameWorkflow]::Ready($dialog)) { break }
        if ($proc.HasExited) { throw 'Preview exited before its window appeared' }
        Start-Sleep -Milliseconds 100
    }
    if ($dialog -eq [IntPtr]::Zero -or -not [InstallerFrameWorkflow]::Ready($dialog)) { throw 'NSIS preview welcome page not ready' }
    $geometry = [InstallerFrameWorkflow]::Geometry($dialog)
    $backdrop = [InstallerFrameWorkflow]::Backdrop($geometry[0], $geometry[1])
    [void][InstallerFrameWorkflow]::ShowWindow($dialog, 9)
    [void][InstallerFrameWorkflow]::SetWindowPos($dialog, [IntPtr]::new(-1), 180, 100, 0, 0, 0x41)
    [void][InstallerFrameWorkflow]::SetForegroundWindow($dialog)
    Record-State 'welcome'
    foreach ($form in @($false, $true)) {
        $r = [InstallerFrameWorkflow+Rect]::new()
        [void][InstallerFrameWorkflow]::GetWindowRect($dialog, [ref]$r)
        $calculated = [InstallerFrameWorkflow]::Calculate($dialog, $form)
        $same = $calculated.Left -eq $r.Left -and $calculated.Top -eq $r.Top -and $calculated.Right -eq $r.Right -and $calculated.Bottom -eq $r.Bottom
        $records.Add(@{ name = "nccalcsize-$form"; pass = $same; window = @($r.Left,$r.Top,$r.Right,$r.Bottom); client = @($calculated.Left,$calculated.Top,$calculated.Right,$calculated.Bottom) })
    }
    [void][InstallerFrameWorkflow]::SendMessage($dialog, 0x86, [IntPtr]::Zero, [IntPtr]::Zero)
    Record-State 'inactive'
    [void][InstallerFrameWorkflow]::SendMessage($dialog, 0x86, [IntPtr]::new(1), [IntPtr]::Zero)
    Record-State 'active'
    [void][InstallerFrameWorkflow]::SendMessage($dialog, 0x85, [IntPtr]::new(1), [IntPtr]::Zero)
    Record-State 'ncpaint'
    [void][InstallerFrameWorkflow]::ShowWindow($dialog, 6)
    Start-Sleep -Milliseconds 150
    [void][InstallerFrameWorkflow]::ShowWindow($dialog, 9)
    Record-State 'restored'
    [void][InstallerFrameWorkflow]::SetWindowPos($dialog, [IntPtr]::new(-1), 210, 110, 0, 0, 0x41)
    Record-State 'moved'
} finally {
    $dpi = if ($dialog -ne [IntPtr]::Zero) { [InstallerFrameWorkflow]::GetDpiForWindow($dialog) } else { 0 }
    @{ date = (Get-Date).ToUniversalTime().ToString('o'); os = [Environment]::OSVersion.VersionString; dpi = $dpi; theme = $Theme; installer = $InstallerPath; checks = $records } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutDir "installer-frame-$Theme.json") -Encoding utf8
    if ($dialog -ne [IntPtr]::Zero) { [void][InstallerFrameWorkflow]::SendMessage($dialog, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    if (-not $proc.WaitForExit(3000)) { $proc.Kill() }
    if ($backdrop -ne [IntPtr]::Zero) { [void][InstallerFrameWorkflow]::DestroyWindow($backdrop) }
}
if (@($records | Where-Object { -not $_.pass }).Count) { exit 1 }
