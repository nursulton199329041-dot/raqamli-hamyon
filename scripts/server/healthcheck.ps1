# Server holati: PostgreSQL, API, tasklar, port, disk, zaxira. Chiqish kodi 0 = hammasi OK. ASCII only.
param([string]$Profile = 'local-test', [switch]$Quiet)
$C = Import-PowerShellDataFile (Join-Path $PSScriptRoot "config.$Profile.psd1")
$script:bad = 0
function Row($name, $ok, $detail) {
  if (-not $ok) { $script:bad++ }
  if (-not $Quiet) { '{0,-5} {1,-30} {2}' -f $(if ($ok) { 'OK' } else { 'FAIL' }), $name, $detail }
}
$psql = "$($C.Root)\pgsql\bin\psql.exe"
& "$($C.Root)\pgsql\bin\pg_isready.exe" -h $C.PgHost -p $C.PgPort -U $C.DbUser -q
Row 'PostgreSQL' ($LASTEXITCODE -eq 0) "$($C.PgHost):$($C.PgPort)"
try { $r = Invoke-WebRequest $C.HealthUrl -UseBasicParsing -TimeoutSec 5; Row 'API /health' ($r.StatusCode -eq 200) $r.Content }
catch { Row 'API /health' $false $_.Exception.Message }
$q = & $psql -h $C.PgHost -p $C.PgPort -U $C.DbUser -d $C.DbName -Atc 'select count(*) from \"Users\"' 2>&1
Row 'DB ma''lumotlari' ($LASTEXITCODE -eq 0) "Users=$q"
foreach ($t in 'RaqamliHamyon-PostgreSQL', 'RaqamliHamyon-API-Supervisor') {
  $x = Get-ScheduledTask $t -ErrorAction SilentlyContinue
  Row "task $t" ($null -ne $x -and $x.State -eq 'Running') $(if ($x) { $x.State } else { 'yoq' })
}
$pgListen = Get-NetTCPConnection -State Listen -LocalPort $C.PgPort -ErrorAction SilentlyContinue
Row 'PG faqat loopback' (-not ($pgListen | Where-Object { $_.LocalAddress -notin '127.0.0.1', '::1' })) (($pgListen | ForEach-Object LocalAddress) -join ',')
$d = Get-PSDrive (Split-Path $C.Root -Qualifier).TrimEnd(':')
Row 'Disk bo''sh joy' ($d.Free -gt 2GB) ('{0:N1} GB' -f ($d.Free / 1GB))
$last = Get-ChildItem "$($C.Root)\backups\$($C.DbName)-????????.dump" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Row 'Oxirgi zaxira' ($null -ne $last -and $last.LastWriteTime -gt (Get-Date).AddDays(-2)) $(if ($last) { $last.Name } else { 'yoq' })
if (-not $Quiet) { 'Supervisor log (oxirgi 5):'; Get-Content "$($C.Root)\logs\supervisor.log" -Tail 5 -ErrorAction SilentlyContinue }
exit $(if ($script:bad) { 1 } else { 0 })


