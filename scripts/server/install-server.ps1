# Raqamli Hamyon lokal server o'rnatuvchisi. ADMIN huquqi kerak. Qayta ishga tushirish xavfsiz (idempotent). ASCII only.
# Nima qiladi: ops papkaga skriptlarni nusxalaydi, ACL, Event Log manbai, eski user-task'ni o'chiradi (disable),
# PostgreSQL va API uchun boot-vaqtidagi tasklar (LocalService, login shart emas), LAN-only firewall.
# Nima QILMAYDI: ma'lumotlarni o'chirmaydi/ko'chirmaydi, router va boshqa loyihalarga tegmaydi.
param([string]$Profile = 'local-test', [switch]$SkipMigrateFromOld)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Admin kerak' }
$C = Import-PowerShellDataFile (Join-Path $PSScriptRoot "config.$Profile.psd1")
$Root = $C.Root; $Ops = Join-Path $Root 'ops'
$ls = '*S-1-5-19'   # LocalService (SID: lokalizatsiyadan mustaqil)

# 1) skriptlarni repo'dan ops'ga nusxalash (git checkout almashganda server buzilmasligi uchun)
New-Item -ItemType Directory -Force $Ops, "$Root\logs", "$Root\backups" | Out-Null
Copy-Item "$PSScriptRoot\*.ps1", "$PSScriptRoot\*.psd1" $Ops -Force

# 2) ACL: LocalService faqat kerakli joyga
icacls $Root /grant "${ls}:(OI)(CI)RX" /T /C /Q | Out-Null
icacls "$Root\pgdata" /grant "${ls}:(OI)(CI)M" /T /C /Q | Out-Null
icacls "$Root\logs" /grant "${ls}:(OI)(CI)M" /T /C /Q | Out-Null
icacls "$Root\backups" /grant "${ls}:(OI)(CI)M" /T /C /Q | Out-Null
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $C.JwtSecretFile /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*S-1-5-19:R" "${me}:F" | Out-Null

# 3) Event Log manbai
if (-not [System.Diagnostics.EventLog]::SourceExists('RaqamliHamyon')) { New-EventLog -LogName Application -Source 'RaqamliHamyon' }

# 4) eski (login'ga bog'liq) rejimni to'xtatish: DB 'fast' to'xtatiladi (ma'lumot saqlanadi)
$old = Get-ScheduledTask 'RaqamliHamyon-API' -ErrorAction SilentlyContinue
if ($old) { Stop-ScheduledTask 'RaqamliHamyon-API' -ErrorAction SilentlyContinue; Disable-ScheduledTask 'RaqamliHamyon-API' | Out-Null }
Get-Process Hamyon.Api -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Root*" } | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'run-api\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$pgctl = "$Root\pgsql\bin\pg_ctl.exe"
$pgTask = Get-ScheduledTask 'RaqamliHamyon-PostgreSQL' -ErrorAction SilentlyContinue
if ((Test-Path "$Root\pgdata\postmaster.pid") -and -not ($pgTask -and $pgTask.State -eq 'Running')) {
  & $pgctl stop -D "$Root\pgdata" -m fast -w -t 60
  if ($LASTEXITCODE -ne 0) { throw 'Eski PostgreSQL to''xtamadi - davom etilmaydi (ma''lumot xavfsizligi)' }
}

# 5) tasklar
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$prin = New-ScheduledTaskPrincipal -UserId 'LocalService' -LogonType ServiceAccount -RunLevel Limited
$trg = @((New-ScheduledTaskTrigger -AtStartup),
         (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)))
function Reg($name, $script, $desc) {
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Ops\$script`" -Profile $Profile"
  Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $prin -Description $desc -Force | Out-Null
}
Reg 'RaqamliHamyon-PostgreSQL'     'run-postgres.ps1' 'Raqamli Hamyon PostgreSQL (loopback). Boot vaqtida, login shart emas.'
Reg 'RaqamliHamyon-API-Supervisor' 'supervisor.ps1'   'Raqamli Hamyon API supervisor: health-check, safe restart, log rotation, kunlik zaxira.'

# 6) firewall: faqat lokal subnet
$fw = 'Raqamli Hamyon API (LAN only)'
Get-NetFirewallRule -DisplayName $fw -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $fw -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5080 `
  -RemoteAddress LocalSubnet -Profile Any | Out-Null
# eski, kengroq loyiha qoidalarini ham LAN bilan cheklash
Get-NetFirewallRule -DisplayName 'Raqamli Hamyon API' -ErrorAction SilentlyContinue | Set-NetFirewallRule -RemoteAddress LocalSubnet
# dastur-asosli 'Hamyon.Api' qoidalari har qanday manbaga ochiq, LocalSubnet'ga cheklab bo'lmaydi -> faqat disable (o'chirilmaydi)
Get-NetFirewallRule -DisplayName 'Hamyon.Api' -ErrorAction SilentlyContinue | Disable-NetFirewallRule

# 7) ishga tushirish
foreach ($n in 'RaqamliHamyon-PostgreSQL', 'RaqamliHamyon-API-Supervisor') {
  if ((Get-ScheduledTask $n).State -ne 'Running') { Start-ScheduledTask $n; Start-Sleep 8 }
}
Write-Host 'O''rnatildi. Tekshirish: powershell -File D:\RaqamliHamyonLocal\ops\healthcheck.ps1'


