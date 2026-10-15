# RAQAMLI HAMYON — PROJECT STATUS

Oxirgi yangilanish: 2026-10-15

## Muhit (tekshirilgan)
| Vosita | Holat |
|---|---|
| .NET SDK 10.0.402 | bor |
| PostgreSQL | tizimda yo'q; boshqa sessiya papkasidagi portable PG 17.6 nusxasi, port 55433 (testlar va smoke uchun) |
| Docker | **yo'q** — `docker-compose.yml`/`Dockerfile` yozilgan, **ishga tushirilmagan** |
| Flutter / Dart | **yo'q**; `storage.googleapis.com`, `pub.dev`, `api.nuget.org` timeout (faqat github.com ochiq) |
| NuGet | faqat `~/.nuget/packages` keshi |
| `dotnet-ef` | yo'q → migratsiya modeldan generatsiya qilingan SQL (embedded resource) |

## Arxitektura
- `backend/src/Hamyon.Domain` — entitylar, enumlar, Currency/Money qoidalari.
- `backend/src/Hamyon.Api` — minimal API, EF Core (Npgsql), JWT + refresh rotation, ledger, analitika, eksport, sync.
- Ledger: double-entry (`JournalEntry` + signed `LedgerLine`), `LedgerAccount.Balance` atomik shartli UPDATE bilan
  (parallel va overdraft himoyasi), idempotency `(UserId, IdempotencyKey)` + fingerprint.
- Loyiha bucket: wallet line'larida `ProjectId`; hamyon balansi = barcha bucketlar yig'indisi (`/api/reconciliation`).
- Bekor qilish = reversal entry; tahrir = reversal + yangi entry (`ReplacesId`).
- Eksport: CSV, XLSX (qo'lda OpenXML, SUMIFS formulalar), PDF (qo'lda yozilgan; kirill → lotin transliteratsiya).

## Backend — bajarildi va TEKSHIRILDI (haqiqiy PostgreSQL 17.6)
- Auth: register/login/refresh (rotation + reuse detection)/logout, lockout, PBKDF2-SHA512, rate limiting, user isolation.
- Hamyon/toifa/manba/shaxs/loyiha CRUD (arxivlash), standart toifalar yangi foydalanuvchiga.
- Kirim, xarajat, transfer (valyutalararo, kurs yoki qabul summasi), qarz olish/berish/qaytarish (qisman/to'liq),
  reversal, correction, balansni tuzatish.
- Tarix: filtrlar (sana, hamyon, toifa, loyiha, manba, shaxs, tur, valyuta, summa oralig'i) + qidiruv.
- Analitika: summary, timeseries (day/week/month/year), breakdown, byudjet holati.
- Eksport CSV/XLSX/PDF (aktiv filtrlar bilan), fayl biriktirish (magic-bytes allowlist), offline sync push/pull.
- Demo seeder (faqat Development + `Demo__Seed=true`).
- **Testlar: 45/45 o'tdi** (parallel xarajat/transfer, idempotency, qarz, valyuta, izolyatsiya, eksport tuzilishi, sync).
- Jonli smoke: API ishga tushdi, migratsiya + demo seed, login, wallets, analytics, 3 xil eksport, OpenAPI — OK.

## Flutter ilova — YOZILGAN, TEKSHIRILMAGAN
Fayllar `app/lib`: core (api, models, i18n uz/ru/en, storage SQLite/prefs), design (Liquid Glass, ikon tizimi),
state (Riverpod: session, settings, data, offline queue), features (auth, dashboard + drag&drop, operation sheet,
history, analytics (donut/bar CustomPainter), projects, debts, settings).
- SDK bo'lmagani uchun `flutter analyze`, `flutter test`, `flutter build` **bajarilmagan**. Kodda kompilyatsiya
  xatolari bo'lishi mumkin; birinchi navbatda `flutter create --platforms=... .` va `flutter analyze` kerak.
- Widget testlar yozilgan (`app/test`), lekin ishga tushirilmagan.
- Platforma papkalari (android/ios/web) hosil qilinmagan (`flutter create .` kerak).
- iOS build tekshirilmaydi (Windows).

## Qoldi / ma'lum bo'shliqlar
- [ ] Flutter: kompilyatsiya + testlarni haqiqiy SDK bilan o'tkazish va xatolarni tuzatish.
- [ ] Takrorlanuvchi xarajatlar, shablonlar, qarz eslatma bildirishnomalari (backend modeli ham yo'q).
- [ ] PIN/biometrik kirish, zaxira va tiklash UI, hamyon/toifa tahrirlash va tartiblash UI (API tayyor).
- [ ] Hamyon va toifa bo'limlarini sozlamalarda yashirish/tartiblash.
- [ ] Docker compose real tekshiruvi.
- [ ] Font embedding (PDF'da kirill o'rniga transliteratsiya).
- [ ] Biznes qoidasi: loyiha bucket manfiy bo'lishi bloklanmaydi (faqat summary'da ko'rinadi).
- Konvertatsiya kurslari foydalanuvchi tomonidan kiritiladi (tashqi kurs provayderi yo'q).

## Qayerdan davom etish
1. `cd app && flutter create --platforms=android,ios,web,windows . && flutter pub get && flutter analyze`.
2. Xatolarni tuzatib `flutter test`, keyin `flutter run -d chrome --dart-define=API_URL=http://localhost:5080`.
3. Backend: `dotnet test backend` (TEST_POSTGRES kerak).

---
## React Native migration (mobile/) — 2026-10-15
Flutter client (`app/`) is kept unchanged for reference. New client: `mobile/` (Expo SDK 57, RN 0.86, TS strict,
expo-router, reanimated 4, gesture-handler, expo-blur, SQLite, SecureStore, TanStack Query + Zustand, SVG).

### Verified (really executed)
- `tsc --noEmit` clean, `eslint .` clean (incl. React-compiler rules), `jest` 19/19
  (money/i18n/semver/migrations, offline queue incl. restart + idempotency key reuse, drag&drop zone logic).
- Backend 46/46 tests (added `/api/meta/client-policy`).
- `expo export --platform web` OK; web build served and driven in a real browser against the live API
  (demo account): login, dashboard data, long-press drag wallet→category opened pre-filled expense form,
  confirm changed the server balance 22 155 000 → 22 005 000 only after confirmation.
- expo-doctor: 21/21 after removing an invalid `newArchEnabled` key.

### NOT verified (external blockers)
- Android build/run: no JDK/Android SDK/emulator on this machine; EAS cloud build needs your Expo login.
- iOS: no macOS/Simulator; EAS iOS build needs Apple Developer account. No iPhone test done.
- OTA: `eas init` / `eas update` need your Expo account (updates.url + projectId not yet in app.json).
  Update/rollback flow is implemented but was not exercised against a real update server.
- Touch-device drag behaviour (only mouse-driven web was exercised); Android `dimezisBlurView` look unverified.
- SQLite path (native) covered only by unit tests of migrations; web uses localStorage.
- Store URLs in `app.json -> extra.storeUrls` are placeholders.

### Your steps
1. `cd mobile && eas login && eas init` (then commit the generated projectId / updates.url).
2. `eas build -p android --profile preview` and test on a device; same for iOS with Apple credentials.
3. `eas update --channel preview ...` → verify on a preview build → publish to `production`.
4. Replace placeholder store URLs; set backend `Client__MinVersion/LatestVersion`.
### Android/iOS build tayyorlash — 2026-10-15
- `eas.json`: `preview` (Android `apk`, iOS ad-hoc), `preview-simulator`, `production` (aab). Kanallar: development/preview/production.
- `app.config.js`: faqat non-production profillarda HTTP (Android cleartext, iOS ATS local networking). Production — faqat https.
- Server manzili: `EXPO_PUBLIC_API_URL` (EAS env) > `app.json extra.apiUrl`; login ekranida qo'lda kiritish maydoni va `localhost` ogohlantirishi.
- expo-doctor 21/21, tsc/eslint toza, jest 20/20.
- **Bajarilmadi (tashqi sabab):** `eas whoami` → "Not logged in", shuning uchun APK yaratilmadi. JDK/Android SDK/adb lokal o'rnatilmadi (bulutli EAS build uchun kerak emas).
- Foydalanuvchi qadamlari: `mobile/README.md` → "Android APK for a real phone".

### Lokal ishchi backend (telefon uchun) — 2026-10-15
- Joylashuv (repo'dan tashqarida): `D:\RaqamliHamyonLocal\{pgsql,pgdata,api,run-api.ps1,jwt.secret}`. Tizim PostgreSQL (5432) boshqa loyihaniki — ishlatilmadi.
- PostgreSQL 17.6 portativ nusxa: `127.0.0.1:55433`, DB `hamyon_dev` (mavjud demo ma'lumotlar, qayta seed qilinmadi).
- API: `Hamyon.Api.exe` (Release publish), `http://0.0.0.0:5080`, Scheduled Task `RaqamliHamyon-API` (logon'da ishga tushadi, admin shart emas). Yangilash: `dotnet publish -c Release -o D:\RaqamliHamyonLocal\api` va task'ni qayta ishga tushirish.
- Tekshirildi: localhost va 192.168.1.2 ustidan `/api/meta/client-policy` 200, `/swagger/index.html` 200, demo login 200.
- Ochiq muammo: Wi-Fi tarmog'i **Public**, firewall qoidasi esa faqat **Private** profilga — telefon ulanishi uchun admin huquqi bilan tuzatish kerak.

### Asosiy panel mantig'i — 2026-10-16
- Dashboard tartibi: Kirim manbalari → Hamyonlar → Xarajat toifalari. Manba/toifa summalari `analytics/breakdown` (type=1/2) dan, hamyon qoldig'i snapshot'dan (bitta ledger manbasi).
- Ixcham kartalar (hamyon: ikon+nom+qoldiq+valyuta, 2 ustun; toifa 3 ustun), pastki menyu siqilmaydi, "+" tugmasi olib tashlandi.
- Drag&drop: wallet→toifa (xarajat), wallet→wallet (transfer), manba→wallet (kirim/qarz), auto-scroll chekkada, bekor qilish/yaroqsiz drop hech narsa o'zgartirmaydi. Bosish bilan muqobil (hamyon amallari, toifa, manba).
- Hamyon: yaratish (nom, tur, valyuta, boshlang'ich balans, ikon), tahrirlash, arxivlash (qoldiq 0 bo'lsa), ko'rish.
- Operatsiya formasi: Kimga to'landi / Kimdan (shaxs yaratiladi yoki topiladi), loyiha, izoh.
- Tuzatilgan xatolar: (1) forma sheet'ida "Saqlash" ekrandan tashqarida qolardi (scroll yo'q), (2) web'da tablar bir-birining ustiga chiqardi.
- Sinov: `node scripts/e2e-scenario.mjs <api>` — 15/15 PASS (haqiqiy backend, alohida DB hamyon_e2e); web UI E2E (Playwright, 400x850): hamyon yaratish, drag→xarajat, transfer, kirim, tahrirlash, arxiv, bekor qilish; tarix va analitika mos.
- Tekshirilmagan: haqiqiy Android/iPhone sensorli drag va auto-scroll (faqat sichqoncha bilan web'da).
- OTA: native bog'liqlik o'zgarmadi (JS-only) → mavjud 1.0.0 build bilan mos; baribir avval `preview` kanalida tekshiring.
