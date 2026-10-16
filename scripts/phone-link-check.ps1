# Run on the PC that hosts the backend. Prints everything needed to point the phone at it. Read-only.
$port = 5080
Write-Host "== listeners on :$port"
$l = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($l) { $l | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String | Write-Host }
else { Write-Host "NOTHING is listening on :$port -> start the task:  Start-ScheduledTask RaqamliHamyon-API" }
Write-Host "== local PostgreSQL (portable, :55433)"
Get-NetTCPConnection -State Listen -LocalPort 55433 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "== this PC's LAN addresses (use one of THESE in the app; DHCP may change it)"
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' }
$ips | Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "== network profile (firewall rule must cover it)"
Get-NetConnectionProfile | Select-Object Name, NetworkCategory | Format-Table -AutoSize | Out-String | Write-Host
foreach ($ip in $ips) {
  $u = "http://$($ip.IPAddress):$port/api/meta/client-policy"
  try { $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 4; Write-Host "OK   $u  -> $($r.StatusCode) $($r.Content)" }
  catch { Write-Host "FAIL $u  -> $($_.Exception.Message)" }
}
Write-Host ""
Write-Host "On the phone open this in the browser (same Wi-Fi). JSON = the network path works:"
foreach ($ip in $ips) { Write-Host "   http://$($ip.IPAddress):$port/api/meta/client-policy" }
Write-Host "In the app: login screen / Settings -> 'Server ulanishi' must show the same base URL; tap 'Ulanishni tekshirish'."
