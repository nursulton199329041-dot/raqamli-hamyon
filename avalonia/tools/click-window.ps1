# Clicks at window-relative pixel positions (as seen in snap-window.ps1 captures). Usage: click-window.ps1 -Points "92,740;200,300"
param([string]$Title = 'Raqamli Hamyon', [string]$Points, [int]$Wheel = 0)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class C {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[C]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if (-not $p) { throw "window '$Title' not found" }
$h = $p.MainWindowHandle
[C]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 300
$r = New-Object C+RECT; [C]::GetWindowRect($h, [ref]$r) | Out-Null
foreach ($pt in $Points.Split(';')) {
  $x, $y = $pt.Split(',') | ForEach-Object { [int]$_ }
  [C]::SetCursorPos($r.L + $x, $r.T + $y) | Out-Null
  if ($Wheel -ne 0) { [C]::mouse_event(0x0800, 0, 0, [BitConverter]::ToUInt32([BitConverter]::GetBytes([int32]$Wheel), 0), [UIntPtr]::Zero); Start-Sleep -Milliseconds 400; continue }
  [C]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  [C]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 350
}
"clicked"
