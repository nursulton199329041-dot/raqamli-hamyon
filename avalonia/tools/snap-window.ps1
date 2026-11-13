# Saves a PNG of a top-level window (even if covered) via PrintWindow. Usage: snap-window.ps1 -Title "Raqamli Hamyon" -Out shot.png
param([string]$Title = 'Raqamli Hamyon', [string]$Out = 'shot.png')
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) { $p = Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1; if ($p) { $h = $p.MainWindowHandle } else { Start-Sleep -Milliseconds 250 } }
if ($h -eq [IntPtr]::Zero) { throw "window '$Title' not found" }
Start-Sleep -Milliseconds 1500
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[W]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
"saved $Out"
