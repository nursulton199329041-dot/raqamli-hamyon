# Raqamli Hamyon — lokal server (barqaror rejim)

Yangilangan: 2026-10-16. Skriptlar: `scripts/server/` (repo) -> o'rnatilgan nusxa: `D:\RaqamliHamyonLocal\ops\`.

## 1. Nima uchun backend to'xtagan edi (Event Log + loglar bo'yicha)
- Eski `RaqamliHamyon-API` task **faqat foydalanuvchi login qilganda** (Interactive, "At log on") ishlardi va foydalanuvchi sessiyasida yashardi. Sessiya tugasa yoki kompyuter login'siz qayta yonsa — server yo'q. PostgreSQL ham shu sessiyadan `pg_ctl` bilan ishga tushirilardi (`0xC000013A` = jarayon sessiya bilan birga to'xtatilgan).
- **Kompyuterning o'zi nobarqaror**: oxirgi 7 kunda 5 marta `Kernel-Power 41` + `6008` ("oldingi o'chirish kutilmagan"): 12.10 (2x), 13.10, 15.10 (2x), 16.10 10:12. Bular elektr uzilishi/qotish/qattiq reset belgisi; bundan tashqari 12.10 va 15.10 da Windows Update (`TrustedInstaller`) avtomatik reboot qilgan.
- Dastur xatosi (crash) izi topilmadi: Application logda `dotnet`/`Hamyon` xatolari yo'q, `api.log` bo'sh. Demak asosiy sabab: **reboot + login'ga bog'liq ishga tushish**.
- Tavsiya (kod emas, qurilma): kompyuter elektr uzilishlarini tekshiring (UPS), `Kernel-Power 41` sababi uchun `C:\Windows\MEMORY.DMP`/`Minidump` ni ko'ring, Active hours/reboot siyosatini sozlang.

## 2. Hozirgi arxitektura
| Qism | Task (SYSTEM emas, **LocalService**) | Trigger |
|---|---|---|
| PostgreSQL 17.6 (portable, `D:\RaqamliHamyonLocal\pgsql`, port **55433**, faqat `127.0.0.1`) | `RaqamliHamyon-PostgreSQL` -> `ops\run-postgres.ps1` | boot + har 5 daqiqada tekshiruv (IgnoreNew) |
| API (`Hamyon.Api.exe`, `0.0.0.0:5080`) | `RaqamliHamyon-API-Supervisor` -> `ops\supervisor.ps1` | boot + har 5 daqiqada |

- Login **shart emas** (service account, parolsiz). Xatoda Task Scheduler 1 daqiqada qayta ishga tushiradi (999 marta).
- Supervisor: PG tayyor bo'lguncha kutadi -> API'ni ishga tushiradi -> har 30 s `/health` -> 3 ketma-ket xato yoki jarayon o'lsa restart (kutish 5 s, 10 s ... 60 s). 10 daqiqada 5 restart = crash-loop: 5 daqiqa pauza + Event Log (`RaqamliHamyon` manbasi, Application) ga xato yoziladi.
- Eski login-task `RaqamliHamyon-API` **o'chirilmagan, faqat Disabled** (qaytarish uchun).

### Loglar (`D:\RaqamliHamyonLocal\logs`)
- `supervisor.log` — 5 MB, 5 arxiv (o'zi aylantiradi).
- `api-YYYYMMDD.log` / `.err.log` — kunlik fayl; 14 kundan eskilari o'chadi; joriy fayl 100 MB dan oshsa API rejali restart qilinadi.
- `pg\pg-Mon.log ... pg-Sun.log` — PostgreSQL `logging_collector`, kunlik, haftalik aylanadi; 2 s dan sekin so'rovlar yoziladi.

### Zaxira
- Kuniga bir marta `backups\hamyon_dev-YYYYMMDD.dump` (`pg_dump -Fc`), oxirgi 7 tasi saqlanadi. `*-prechange-*.dump` (o'zgarishdan oldingi qo'lda zaxira) avtomatik o'chirilmaydi.
- Tiklash: `pg_restore -h 127.0.0.1 -p 55433 -U postgres -d <yangi_baza> --clean --if-exists <fayl>` (avval alohida bazaga sinab ko'ring).

## 3. Health-check
`powershell -File D:\RaqamliHamyonLocal\ops\healthcheck.ps1` — PG, `/health`, DB ma'lumotlari, ikkala task, PG faqat loopback, disk, oxirgi zaxira. Chiqish kodi 0 = OK (`-Quiet` — faqat kod).
Telefon tomoni: `scripts/phone-link-check.ps1`.

## 4. Tarmoq xavfsizligi (internetga ochilmaydi)
- Firewall: `Raqamli Hamyon API (LAN only)` — TCP 5080, **faqat LocalSubnet**, barcha profillar (Wi-Fi "Public" bo'lsa ham ishlaydi). Eski `Raqamli Hamyon API` (Private) ham LocalSubnet. Dastur-asosli `Hamyon.Api` (Public, har qanday manba) qoidalari **Disabled**.
- Routerda 5080 uchun **port forwarding / UPnP / DMZ bo'lmasligi kerak** (routerga tegilmadi — o'zingiz tekshiring).
- PostgreSQL loyiha nusxasi 55433 faqat `127.0.0.1`. Diqqat: tizimdagi **boshqa loyiha PostgreSQL'i (5432) `0.0.0.0` da tinglaydi** — bu loyiha emas, tegilmadi; kerak bo'lsa uning `listen_addresses` ini egasi yopsin yoki firewall bilan cheklansin.

## 5. Muhitlarni ajratish
| | `config.local-test.psd1` (hozirgi) | `config.production.template.psd1` (shablon) |
|---|---|---|
| ASPNETCORE_ENVIRONMENT | Development (swagger, HTTP) | Production (swagger yo'q, HTTPS redirect, `Jwt__Secret` majburiy) |
| Papka | `D:\RaqamliHamyonLocal` | `D:\RaqamliHamyonProd` (alohida) |
| Baza / port | `hamyon_dev` / 55433 | `hamyon_prod` / 55434, `hamyon_app` roli (superuser emas, parol) |
| API | `0.0.0.0:5080` LAN | `127.0.0.1:5090` faqat TLS reverse proxy ortida |
| Mobil build | `preview` (cleartext HTTP ruxsat) | `production` (faqat https) |
Sirlar (JWT, DB paroli) config fayllarga yozilmaydi. Production uchun: alohida server/papka, HTTPS sertifikat, `pg_hba.conf` da `trust` o'rniga `scram-sha-256`. Yangi foydalanuvchilar **production**ga ulanadi, lokal-test ma'lumotlari ularga aralashmaydi.
Profilni almashtirish: `install-server.ps1 -Profile <nom>` (production uchun avval papka, PG, sirlar tayyorlanadi).

## 6. IP o'zgarishi: DHCP reservation yo'riqnomasi (router sozlamasiga tegilmadi)
Kompyuter ma'lumotlari (Wi-Fi adapter "Беспроводная сеть"):
- MAC: `58-02-05-8F-94-74` · hozirgi IP: `192.168.1.5` · gateway/router: `192.168.1.1` · DHCP yoqilgan · Wi-Fi: `TP-Link_67B0`

Qadamlar (TP-Link, egasi bajaradi):
1. Brauzerda `http://192.168.1.1` (yoki `tplinkwifi.net`) -> admin login.
2. **Advanced -> Network -> DHCP Server -> Address Reservation** (eski menyuda: *DHCP -> Address Reservation*).
3. **Add**: MAC `58-02-05-8F-94-74`, IP `192.168.1.5` (DHCP diapazonida bo'lsin), Enable -> Save.
4. Kompyuterda: Wi-Fi'ni o'chirib-yoqing yoki `ipconfig /renew`; `ipconfig` da IP `192.168.1.5` ekanini tekshiring.
5. Telefon ilovasida server manzili: `http://192.168.1.5:5080`.
Eslatma: Wi-Fi sozlamalarida **"Random hardware address"** (tasodifiy MAC) o'chiq bo'lsin, aks holda MAC o'zgarib, reservation ishlamaydi. Statik IP'ni Windows'ning o'zida qo'lda yozish tavsiya etilmaydi (router bilan to'qnashishi mumkin).

## 7. Boshqarish
- Holat: `Get-ScheduledTask RaqamliHamyon-*`
- Qayta ishga tushirish: `Stop-ScheduledTask`/`Start-ScheduledTask RaqamliHamyon-API-Supervisor` (PG'ni faqat kerak bo'lsa).
- API yangilash: `dotnet publish -c Release -o D:\RaqamliHamyonLocal\api` (avval supervisor taskini to'xtating), so'ng task'ni ishga tushiring.
- Qaytarish (rollback): yangi ikki taskni `Unregister-ScheduledTask`, `Enable-ScheduledTask RaqamliHamyon-API`, `Hamyon.Api` firewall qoidalarini `Enable-NetFirewallRule`. Ma'lumotlar (`pgdata`) hech qachon ko'chirilmagan.
- O'rnatish/yangilash: admin PowerShell'da `scripts\server\install-server.ps1` (idempotent; ishlayotgan PG ni qayta to'xtatmaydi).

## 8. Dublikatdan himoya va ehtiyot choralari
- Supervisor: bitta nusxa (Global mutex + jarayon ro'yxati tekshiruvi); ikkinchisi darhol chiqadi. Ishga tushganda yetim `Hamyon.Api.exe` (shu papkadagi) to'xtatiladi. API portini ikkinchi nusxa egallay olmaydi (Kestrel bind xatosi).
- PostgreSQL: `postmaster.pid` ikkinchi postmaster'ni to'sadi; `run-postgres.ps1` PG allaqachon ishlayotgan bo'lsa yangisini ochmaydi, faqat kuzatadi. `postmaster.pid` hech qachon qo'lda o'chirilmaydi.
- `Stop-ScheduledTask RaqamliHamyon-PostgreSQL` PG'ni **qattiq** to'xtatadi (crash recovery bilan keyingi startda tiklanadi, ma'lumot yo'qolmaydi, lekin ortiqcha urinmang). Rejali to'xtatish: `pg_ctl stop -m fast -D D:\RaqamliHamyonLocal\pgdata`, so'ng task'ni qayta ishga tushiring.
- Git'ga kirmaydi: `jwt.secret`, `*.dump`, `logs/`, `backups/`, `pgdata/` (`.gitignore`); bu fayllar repo'dan tashqarida (`D:\RaqamliHamyonLocal`) turadi.
- Sinalmagan: kompyuterni qayta yuklagandan keyingi avtostart (reboot qilinmadi).