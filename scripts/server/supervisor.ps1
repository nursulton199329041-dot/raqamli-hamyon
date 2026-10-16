# Raqamli Hamyon API supervisor (Windows PowerShell 5.1, ASCII only).
# Vazifasi: PostgreSQL tayyorligini kutish -> API ni ishga tushirish -> /health nazorati ->
# xatoda xavfsiz restart (backoff + crash-loop himoyasi) -> log rotation -> kunlik zaxira.
param([string]$Profile = 'local-test')
$ErrorActionPreference = 'Continue'
$C = Import-PowerShellDataFile (Join-Path $PSScriptRoot "config.$Profile.psd1")
$Root = $C.Root; $LogDir = Join-Path $Root 'logs'; $BakDir = Join-Path $Root 'backups'
$PgBin = Join-Path $Root 'pgsql\bin'; $ApiExe = Join-Path $Root 'api\Hamyon.Api.exe'
New-Item -ItemType Directory -Force $LogDir, $BakDir | Out-Null

# ---- yagona nusxa (mutex) ----
$mutex = New-Object System.Threading.Mutex($false, "Global\RaqamliHamyonSupervisor-$Profile")
$gotMutex = $false
try { $gotMutex = $mutex.WaitOne(0) } catch { $gotMutex = $false }
if (-not $gotMutex) { exit 0 }
# Mutex hisob (account) chegarasidan o'tmasligi mumkin -> jarayon ro'yxati bilan ham tekshiramiz
$other = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'supervisor\.ps1' }
if ($other) { exit 0 }

# ---- logging (hajm bo'yicha rotation: 5 MB, 5 ta arxiv) ----
$SupLog = Join-Path $LogDir 'supervisor.log'
function Log([string]$lvl, [string]$msg) {
  try {
    if ((Test-Path $SupLog) -and (Get-Item $SupLog).Length -gt 5MB) {
      for ($i = 4; $i -ge 1; $i--) { if (Test-Path "$SupLog.$i") { Move-Item "$SupLog.$i" "$SupLog.$($i+1)" -Force } }
      Move-Item $SupLog "$SupLog.1" -Force
    }
    Add-Content -Path $SupLog -Value ("{0} [{1}] {2}" -f (Get-Date -f 'yyyy-MM-dd HH:mm:ss'), $lvl, $msg)
  } catch {}
  if ($lvl -in 'ERROR', 'CRIT') {
    try { Write-EventLog -LogName Application -Source 'RaqamliHamyon' -EntryType Error -EventId 1000 -Message $msg } catch {}
  }
}
function Purge-Logs {
  $cut = (Get-Date).AddDays(-$C.LogKeepDays)
  Get-ChildItem $LogDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cut -and $_.Name -notlike 'supervisor.log*' } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

function Pg-Ready {
  & "$PgBin\pg_isready.exe" -h $C.PgHost -p $C.PgPort -U $C.DbUser -q
  return ($LASTEXITCODE -eq 0)
}
function Api-Healthy {
  try {
    $r = Invoke-WebRequest -Uri $C.HealthUrl -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}
function Daily-Backup {
  $f = Join-Path $BakDir ("{0}-{1}.dump" -f $C.DbName, (Get-Date -f yyyyMMdd))
  if (Test-Path $f) { return }
  $tmp = "$f.part"
  & "$PgBin\pg_dump.exe" -h $C.PgHost -p $C.PgPort -U $C.DbUser -Fc -f $tmp $C.DbName 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $tmp) -and (Get-Item $tmp).Length -gt 0) {
    Move-Item $tmp $f -Force; Log 'INFO' "backup ok: $f"
    # faqat kunlik avto-zaxiralar (hamyon_dev-YYYYMMDD.dump); "prechange" nomlilar tegilmaydi
    Get-ChildItem $BakDir -Filter "$($C.DbName)-????????.dump" | Sort-Object Name -Descending |
      Select-Object -Skip $C.BackupKeep | Remove-Item -Force
  } else { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; Log 'ERROR' 'backup FAILED' }
}

# ---- API muhiti (sirlar faqat shu jarayon muhitida, logga yozilmaydi) ----
$env:ASPNETCORE_ENVIRONMENT = $C.AspNetEnv
$env:ASPNETCORE_URLS        = $C.ApiUrls
$env:ConnectionStrings__Default = "Host=$($C.PgHost);Port=$($C.PgPort);Database=$($C.DbName);Username=$($C.DbUser)"
$env:Jwt__Secret = (Get-Content $C.JwtSecretFile -Raw).Trim()
Set-Location (Join-Path $Root 'api')

function Start-Api {
  $stamp = Get-Date -f yyyyMMdd
  $out = Join-Path $LogDir "api-$stamp.log"; $err = Join-Path $LogDir "api-$stamp.err.log"
  $p = Start-Process -FilePath $ApiExe -WorkingDirectory (Join-Path $Root 'api') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $out -RedirectStandardError $err
  Log 'INFO' "API started pid=$($p.Id) profile=$Profile env=$($C.AspNetEnv)"
  return $p
}
function Stop-Api($p) {
  if ($p -and -not $p.HasExited) { try { $p.Kill(); $p.WaitForExit(10000) | Out-Null } catch {} }
}

Log 'INFO' "supervisor start profile=$Profile pid=$PID user=$env:USERNAME"
# Oldingi supervisor o'lgan bo'lsa qolgan yetim API jarayonlarini tozalash (faqat shu papkadagi exe)
Get-Process -Name 'Hamyon.Api' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $ApiExe } | ForEach-Object {
  Log 'WARN' "yetim API pid=$($_.Id) to'xtatildi"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Purge-Logs

# PostgreSQL ni kutish (alohida task ishga tushiradi)
$waited = 0
while (-not (Pg-Ready)) {
  if ($waited -ge 300) { Log 'ERROR' "PostgreSQL 300s ichida tayyor bo'lmadi; kutish davom etadi"; $waited = 0 }
  Start-Sleep 5; $waited += 5
}
Log 'INFO' 'PostgreSQL ready'

$restarts = New-Object System.Collections.Generic.List[datetime]
$backoff = 5; $api = Start-Api; $startedAt = Get-Date; $fails = 0; $lastPurge = Get-Date
Start-Sleep 15
while ($true) {
  Start-Sleep 30
  $reason = $null
  if ($api.HasExited) { $reason = "API exited code=$($api.ExitCode)" }
  elseif (Api-Healthy) { $fails = 0 }
  else {
    $fails++
    Log 'WARN' "health check failed ($fails/3)"
    if ($fails -ge 3) { $reason = 'health check failed 3x' }
  }
  if (-not (Pg-Ready)) { Log 'ERROR' 'PostgreSQL javob bermayapti (pg_isready)' }

  # joriy kun logi 100 MB dan oshsa - rejali restart (yangi kun fayli)
  $cur = Join-Path $LogDir ("api-{0}.log" -f $startedAt.ToString('yyyyMMdd'))
  if (-not $reason -and (Test-Path $cur) -and (Get-Item $cur).Length -gt 100MB) { $reason = 'log size > 100MB (planned rotation)' }

  if ($reason) {
    Log 'WARN' "restart: $reason"
    Stop-Api $api
    $now = Get-Date
    $restarts.Add($now) | Out-Null
    $restarts.RemoveAll([Predicate[datetime]]{ param($d) $d -lt $now.AddMinutes(-10) }) | Out-Null
    if ($restarts.Count -ge 5) {
      Log 'CRIT' "crash loop: 10 daqiqada 5+ restart. 5 daqiqa kutiladi, keyin urinish davom etadi"
      Start-Sleep 300; $restarts.Clear()
    } else { Start-Sleep $backoff }
    if (((Get-Date) - $startedAt).TotalSeconds -gt 120) { $backoff = 5 } else { $backoff = [Math]::Min($backoff * 2, 60) }
    while (-not (Pg-Ready)) { Start-Sleep 5 }
    $api = Start-Api; $startedAt = Get-Date; $fails = 0
    Start-Sleep 15
  }

  if ((Get-Date).Hour -ge 3) { Daily-Backup }
  if (((Get-Date) - $lastPurge).TotalHours -ge 6) { Purge-Logs; $lastPurge = Get-Date }
}

