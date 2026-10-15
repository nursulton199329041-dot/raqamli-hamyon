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
