# Mouse drag between window-relative points, optionally capturing the window while hovering the target.
# Usage: drag-window.ps1 -From "81,578" -To "92,770" [-MidShot shot.png]
param([string]$Title = 'Raqamli Hamyon', [string]$From, [string]$To, [string]$MidShot = '')
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class D {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[D]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if (-not $p) { throw "window '$Title' not found" }
$h = $p.MainWindowHandle
[D]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 300
$r = New-Object D+RECT; [D]::GetWindowRect($h, [ref]$r) | Out-Null
$fx, $fy = $From.Split(',') | ForEach-Object { [int]$_ }
$tx, $ty = $To.Split(',') | ForEach-Object { [int]$_ }
[D]::SetCursorPos($r.L + $fx, $r.T + $fy) | Out-Null; Start-Sleep -Milliseconds 100
[D]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 120
$steps = 25
for ($i = 1; $i -le $steps; $i++) {
  $x = $fx + ($tx - $fx) * $i / $steps; $y = $fy + ($ty - $fy) * $i / $steps
  [D]::SetCursorPos($r.L + [int]$x, $r.T + [int]$y) | Out-Null; Start-Sleep -Milliseconds 25
}
Start-Sleep -Milliseconds 400
if ($MidShot) { & (Join-Path $PSScriptRoot 'snap-window.ps1') -Title $Title -Out $MidShot | Out-Null }
[D]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 300
"dragged"
