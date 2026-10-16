# PostgreSQL ni foreground'da ishga tushiradi (Task Scheduler xatoda qayta ishga tushiradi). ASCII only.
param([string]$Profile = 'local-test')
$C = Import-PowerShellDataFile (Join-Path $PSScriptRoot "config.$Profile.psd1")
$Root = $C.Root
$pgLog = ($Root + '\logs\pg') -replace '\\', '/'
New-Item -ItemType Directory -Force (Join-Path $Root 'logs\pg') | Out-Null
# Ikkinchi nusxa ochilmasin: PG allaqachon ishlayotgan bo'lsa, faqat kuzatib turamiz (task "Running" qoladi)
& (Join-Path $Root 'pgsql\bin\pg_isready.exe') -h $C.PgHost -p $C.PgPort -U $C.DbUser -q
if ($LASTEXITCODE -eq 0) {
  while ($true) {
    Start-Sleep 30
    & (Join-Path $Root 'pgsql\bin\pg_isready.exe') -h $C.PgHost -p $C.PgPort -U $C.DbUser -q
    if ($LASTEXITCODE -ne 0) { break }
  }
}
& (Join-Path $Root 'pgsql\bin\postgres.exe') -D (Join-Path $Root 'pgdata') `
  -c "port=$($C.PgPort)" -c "listen_addresses=$($C.PgHost)" `
  -c logging_collector=on -c "log_directory=$pgLog" -c 'log_filename=pg-%a.log' `
  -c log_truncate_on_rotation=on -c log_rotation_age=1d -c log_rotation_size=50MB `
  -c log_min_duration_statement=2000 -c 'log_line_prefix=%t [%p] '
exit $LASTEXITCODE
