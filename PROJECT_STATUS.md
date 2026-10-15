# RAQAMLI HAMYON — PROJECT STATUS

Oxirgi yangilanish: 2026-10-15

## Muhit (tekshirilgan)
| Vosita | Holat |
|---|---|
| .NET SDK 10.0.402 | bor |
| PostgreSQL | tizimda yo'q; portable PG 17.6 (scratchpad) ishlatilmoqda, port 55433 |
| Docker | **yo'q** — compose fayllari yoziladi, ishga tushirib tekshirilmaydi |
| Flutter / Dart | **yo'q**, va `storage.googleapis.com`, `pub.dev`, `api.nuget.org` tarmoqdan **ochilmaydi** (timeout) |
| NuGet | faqat `~/.nuget/packages` keshi (EF Core 10.0.12, Npgsql 10.0.3, JWT, FluentValidation, Serilog, xunit) |
| `dotnet-ef` | yo'q → migratsiya modeldan generatsiya qilingan SQL orqali (`Data/Migrations`) |

Oqibatlar:
- Excel/PDF uchun tashqi kutubxona (ClosedXML/QuestPDF) keshda yo'q → `System.IO.Packaging` bilan o'zimiz yozamiz (xlsx), minimal PDF yozuvchi.
- Flutter kodi **kompilyatsiya qilib tekshirib bo'lmaydi** (SDK ham, pub paketlar ham yo'q). Kod yoziladi, lekin "ishlaydi" deb da'vo qilinmaydi.

## Arxitektura
- `backend/src/Hamyon.Domain` — entitylar, enumlar, Money/Currency qoidalari (decimal, valyuta bo'yicha rounding).
- `backend/src/Hamyon.Api` — ASP.NET Core minimal API, EF Core (Npgsql), JWT + refresh rotation, ledger.
- `backend/tests/Hamyon.Tests` — haqiqiy PostgreSQL ustida integratsion testlar (TEST_POSTGRES).
- Ledger: double-entry. `JournalEntry` + `LedgerLine` (signed), `LedgerAccount.Balance` atomik shartli UPDATE bilan yangilanadi
  (overdraft va parallel so'rovlardan himoya). Idempotency: `(UserId, IdempotencyKey)` unique + request fingerprint.
- Loyiha "bucket"i: wallet line'lariga `ProjectId` yoziladi; hamyon balansi = barcha bucketlar yig'indisi.
- Bekor qilish: reversal entry (original o'chirilmaydi), tahrir = reversal + yangi entry (`ReplacesId`).

## Bajarildi (tekshirilgan = testdan o'tgan)
- [x] Git repo, solution, loyiha strukturasi
- [x] Domain + DbContext + baseline migratsiya (PG da ishlaydi)
- [x] Auth: register/login/refresh(rotation+reuse detection)/logout, lockout, PBKDF2-SHA512
- [x] Hamyon, kategoriya, kirim manbai, shaxs, loyiha CRUD (arxivlash, jismoniy o'chirish yo'q)
- [x] Kirim, xarajat, transfer (valyutalararo kurs bilan), qarz olish/berish/qaytarish, reversal, correction
- [x] Idempotency, parallel testlar, foydalanuvchilar izolyatsiyasi, reconciliation endpoint
- [x] Tarix filtrlari va qidiruv
- Testlar: 30/30 o'tdi (PostgreSQL 17.6)

## Qoldi
- [ ] Analitika (summary, timeseries, breakdown), byudjet limit holati
- [ ] Eksport CSV / XLSX / PDF (filtrlar bilan)
- [ ] Fayl biriktirish (xavfsiz upload)
- [ ] Offline sync endpointlari (`/api/sync/push`)
- [ ] Demo ma'lumotlar (faqat Development, alohida demo user)
- [ ] Docker Compose, .env.example, README, skriptlar
- [ ] Flutter ilova (design system, dashboard, drag&drop, modullar, lokalizatsiya, offline) — tekshirib bo'lmaydi
- [ ] Takrorlanuvchi xarajat/shablonlar, eslatmalar (backend)

## Ma'lum cheklovlar / xatolar
- Flutter SDK yo'qligi sababli frontend build/test/ishga tushirish imkonsiz.
- Docker yo'q: `docker compose up` tekshirilmagan.
- iOS build tekshirilmaydi (Windows).

## Qayerdan davom etish
`backend/` da: `dotnet test` (PG kerak: `TEST_POSTGRES="Host=localhost;Port=55433;Username=postgres;Database=postgres"`).
Keyingi qadam: analitika endpointlari → eksport → demo seed → compose/README → Flutter.
