# Builds the Play Market bundle (.aab) signed with your upload key and puts it on the Desktop.
#   First time it creates the key (you choose the password and answer the name questions).
#   KEEP the key file and its password safe: every future update must be signed with the same key.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File D:\Projects\RaqamliHamyon\avalonia\tools\build-aab.ps1
$ErrorActionPreference = 'Stop'
$keytool = 'C:\Program Files\Android\openjdk\jdk-21.0.8\bin\keytool.exe'
$store = Join-Path $env:USERPROFILE '.android\raqamli-hamyon-upload.jks'
$root = Split-Path -Parent $PSScriptRoot   # ...\avalonia

if (-not (Test-Path $store)) {
    Write-Host "Yuklash kaliti yaratiladi: $store" -ForegroundColor Yellow
    Write-Host "Parol so'raladi (kamida 6 belgi) - uni yozib, xavfsiz joyda saqlang!" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force (Split-Path $store) | Out-Null
    & $keytool -genkeypair -v -keystore $store -alias hamyon -keyalg RSA -keysize 2048 -validity 10000
    if ($LASTEXITCODE -ne 0) { throw 'Kalit yaratilmadi' }
}

$secure = Read-Host 'Kalit paroli' -AsSecureString
$env:HAMYON_KS_PASS = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
    $out = Join-Path $root 'out\aab'
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    dotnet publish (Join-Path $root 'Hamyon.App.Android\Hamyon.App.Android.csproj') -c Release -o $out
    if ($LASTEXITCODE -ne 0) { throw 'Build xato' }
    $aab = Join-Path $out 'uz.raqamlinazorat.hamyon-Signed.aab'
    # Play refuses the debug key: make sure the bundle carries the upload key
    $cert = & $keytool -printcert -jarfile $aab | Out-String
    if ($cert -match 'CN=Android Debug') { throw "Bundle debug kalit bilan imzolangan - Play qabul qilmaydi" }
    Write-Host ($cert -split "`n" | Select-String 'Owner:' | Select-Object -First 1)
    $dest = Join-Path ([Environment]::GetFolderPath('Desktop')) 'RaqamliHamyon.aab'
    Copy-Item $aab $dest -Force
    Write-Host "TAYYOR: $dest" -ForegroundColor Green
}
finally {
    Remove-Item Env:HAMYON_KS_PASS -ErrorAction SilentlyContinue
}
