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
$proc = Start-Process -FilePath (Resolve-Path -LiteralPath $InstallerPath).Path -ArgumentList "/THEME=$Theme" -WindowStyle Hidden -PassThru
$dialog = [IntPtr]::Zero
function Record-State([string]$Name) {
    Start-Sleep -Milliseconds 250
    $geometry = [InstallerFrameWorkflow]::Geometry($dialog)
    $bounds = [InstallerFrameWorkflow+Rect]::new()
    [void][InstallerFrameWorkflow]::GetWindowRect($dialog, [ref]$bounds)
    $image = [System.Drawing.Bitmap]::new($bounds.Right-$bounds.Left, $bounds.Bottom-$bounds.Top)
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    try {
        $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $image.Size)
        $image.Save((Join-Path (Resolve-Path $OutDir).Path "installer-$Theme-$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $y = [int]($image.Height / 3)
        $pixels = @(0, 2, 8, [int]($image.Width/2)) | ForEach-Object { $image.GetPixel($_,$y).ToArgb().ToString('X8') }
    } finally { $graphics.Dispose(); $image.Dispose() }
    $pass = $geometry[0] -eq $geometry[2] -and $geometry[1] -eq $geometry[3] -and $geometry[4] -eq 0 -and $geometry[5] -eq 0 -and $pixels[0] -eq $pixels[3] -and $pixels[1] -eq $pixels[3] -and $pixels[2] -eq $pixels[3]
    $records.Add(@{ name = $Name; pass = $pass; geometry = $geometry; edgePixels = $pixels })
    Write-Output "$Name pass=$pass geometry=$($geometry -join ',') edge=$($pixels -join ',')"
}
try {
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        $proc.Refresh(); $dialog = $proc.MainWindowHandle
        if ($dialog -ne [IntPtr]::Zero) { break }
        if ($proc.HasExited) { throw 'Preview exited before its window appeared' }
        Start-Sleep -Milliseconds 100
    }
    if ($dialog -eq [IntPtr]::Zero) { throw 'NSIS preview window not found' }
    [void][InstallerFrameWorkflow]::ShowWindow($dialog, 9)
    [void][InstallerFrameWorkflow]::SetWindowPos($dialog, [IntPtr]::Zero, 180, 100, 0, 0, 0x41)
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
    [void][InstallerFrameWorkflow]::SetWindowPos($dialog, [IntPtr]::Zero, 210, 110, 0, 0, 0x41)
    Record-State 'moved'
} finally {
    $dpi = if ($dialog -ne [IntPtr]::Zero) { [InstallerFrameWorkflow]::GetDpiForWindow($dialog) } else { 0 }
    @{ date = (Get-Date).ToUniversalTime().ToString('o'); os = [Environment]::OSVersion.VersionString; dpi = $dpi; theme = $Theme; installer = $InstallerPath; checks = $records } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutDir "installer-frame-$Theme.json") -Encoding utf8
    if ($dialog -ne [IntPtr]::Zero) { [void][InstallerFrameWorkflow]::SendMessage($dialog, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    if (-not $proc.WaitForExit(3000)) { $proc.Kill() }
}
if (@($records | Where-Object { -not $_.pass }).Count) { exit 1 }
