# Raqamli Hamyon: hisob parolini lokal serverda yangilash (Windows PowerShell 5.1, ASCII only).
#
# Ishlatish (kompyuterda, PowerShell oynasida):
#   powershell -ExecutionPolicy Bypass -File D:\RaqamliHamyonLocal\ops\reset-password.ps1
#
# Nima qiladi:
#   1) email va YANGI parolni so'raydi (parol ekranda ko'rinmaydi, ikki marta kiritiladi);
#   2) bazaning zaxirasini oladi (backups\<db>-prechange-pwreset-<vaqt>.dump);
#   3) faqat shu foydalanuvchining parol hash'ini serverdagi algoritm bilan yozadi
#      (PBKDF2-SHA512, 210000 iteratsiya, "v1.<iter>.<salt>.<key>" - AuthService.PasswordHasher bilan bir xil);
#   4) blokirovkani (5 ta xato urinish) tozalaydi, eski sessiyalarni (refresh token) bekor qiladi,
#      audit jurnaliga "auth.password_reset" yozadi.
# Hamyon, operatsiya va boshqa ma'lumotlarga tegmaydi. Parol hech qayerga (log, fayl, ekran) yozilmaydi.
param(
  [string]$Email,
  [string]$Root = 'D:\RaqamliHamyonLocal',
  [string]$DbName = 'hamyon_dev',
  [int]$Port = 55433,
  # faqat avtomatik sinov uchun; oddiy ishlatishda berilmaydi (parol interaktiv so'raladi)
  [System.Security.SecureString]$NewPassword,
  [switch]$NoBackup
)
$ErrorActionPreference = 'Stop'
# xato bo'lsa: faqat tushunarli xabar (stack trace emas); xatogacha hech narsa yozilmagan bo'ladi
trap { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
$psql = Join-Path $Root 'pgsql\bin\psql.exe'
$pgDump = Join-Path $Root 'pgsql\bin\pg_dump.exe'
if (-not (Test-Path $psql)) { throw "psql topilmadi: $psql" }

function Plain([System.Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# psql: SQL va qiymatlar stdin orqali (\set) - buyruq qatorida va vaqtinchalik faylda hech narsa qolmaydi
function Run-Sql([string]$script) {
  $out = $script | & $psql -h 127.0.0.1 -p $Port -U postgres -d $DbName -X -q -t -A -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql xatosi: $out" }
  return $out
}
# psql \set qiymati: bitta qo'shtirnoq ichida, ichidagi ' va \ ekranlanadi
function Q([string]$v) { return "'" + ($v -replace '\\', '\\' -replace "'", "\'") + "'" }

if (-not $Email) { $Email = Read-Host 'Email' }
$Email = $Email.Trim()
if ($Email -notmatch '^[^@\s]+@[^@\s]+$') { throw "Email noto'g'ri: $Email" }

$found = Run-Sql ("\set email $(Q $Email)`nselect ""Id"" || '|' || ""DisplayName"" from ""Users"" where ""NormalizedEmail"" = upper(:'email');")
$found = ($found | Where-Object { $_ -match '\|' } | Select-Object -First 1)
if (-not $found) { throw "Bunday email bilan hisob topilmadi: $Email" }
$userId, $name = $found -split '\|', 2
Write-Host "Hisob topildi: $name <$Email>"

if (-not $NewPassword) {
  $p1 = Read-Host 'Yangi parol (kamida 8 belgi)' -AsSecureString
  $p2 = Read-Host 'Yangi parolni qayta kiriting' -AsSecureString
  $a = Plain $p1; $b = Plain $p2
  if ($a -cne $b) { $a = $null; $b = $null; throw 'Parollar bir xil emas. Hech narsa o''zgartirilmadi.' }
  $b = $null
} else { $a = Plain $NewPassword }
if ($a.Length -lt 8 -or $a.Length -gt 128) { $a = $null; throw 'Parol 8-128 belgi bo''lishi kerak. Hech narsa o''zgartirilmadi.' }

# --- hash (AuthService.PasswordHasher bilan bir xil) ---
$iterations = 210000
$salt = New-Object byte[] 16
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
$pwBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($a)
$a = $null
$kdf = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($pwBytes, $salt, $iterations, [System.Security.Cryptography.HashAlgorithmName]::SHA512)
$key = $kdf.GetBytes(32)
$kdf.Dispose(); [Array]::Clear($pwBytes, 0, $pwBytes.Length)
$hash = "v1.$iterations.$([Convert]::ToBase64String($salt)).$([Convert]::ToBase64String($key))"

# --- zaxira ---
if (-not $NoBackup) {
  $dump = Join-Path $Root ("backups\{0}-prechange-pwreset-{1}.dump" -f $DbName, (Get-Date -f 'yyyyMMdd-HHmmss'))
  & $pgDump -h 127.0.0.1 -p $Port -U postgres -Fc -f $dump $DbName
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump)) { throw 'Zaxira olinmadi. Hech narsa o''zgartirilmadi.' }
  Write-Host "Zaxira: $dump"
}

# --- bitta tranzaksiyada yangilash ---
$sql = @"
\set uid $(Q $userId)
\set hash $(Q $hash)
begin;
update "Users" set "PasswordHash" = :'hash', "FailedLoginCount" = 0, "LockoutUntil" = null where "Id" = :'uid'::uuid;
update "RefreshTokens" set "RevokedAt" = now() where "UserId" = :'uid'::uuid and "RevokedAt" is null;
insert into "AuditLogs" ("Id", "UserId", "Action", "EntityType", "EntityId", "Detail", "At")
  values (gen_random_uuid(), :'uid'::uuid, 'auth.password_reset', 'User', :'uid'::uuid, 'reset-password.ps1 (local server)', now());
commit;
select 'ok';
"@
$hash = $null
$res = Run-Sql $sql
if (($res | Out-String) -notmatch 'ok') { throw "Kutilmagan natija: $res" }
Write-Host ''
Write-Host "Tayyor: $Email uchun parol yangilandi." -ForegroundColor Green
Write-Host "Telefonda shu email va yangi parol bilan kiring (boshqa qurilmalardagi eski sessiyalar yopildi)."
