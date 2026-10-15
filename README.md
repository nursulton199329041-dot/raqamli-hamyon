# Raqamli Hamyon

Shaxsiy va loyiha moliyasini boshqarish: hamyonlar, kirim/xarajat/transfer, qarzlar, loyiha bo'yicha mablag'lar,
analitika va Excel/PDF/CSV eksport. Backend — ASP.NET Core (.NET 10) + PostgreSQL, ilova — Flutter.

> **Holat:** backend to'liq ishlaydi va testlangan (45 ta integratsion test). Flutter ilovasi yozilgan, lekin
> ishlab chiqilgan muhitda Flutter SDK bo'lmagani uchun **kompilyatsiya/ishga tushirish tekshirilmagan**.
> Batafsil: [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Tuzilma

```
backend/
  src/Hamyon.Domain   entitylar, Money/Currency qoidalari
  src/Hamyon.Api      REST API, ledger, auth, hisobotlar
  tests/Hamyon.Tests  PostgreSQL ustida integratsion testlar
app/                  Flutter ilova (Android, iOS, Web)
docker-compose.yml    PostgreSQL + API
```

## Backendni ishga tushirish

### Variant A — Docker Compose
```bash
cp .env.example .env      # POSTGRES_PASSWORD va JWT_SECRET (>=32 belgi) ni to'ldiring
docker compose up --build
# API: http://localhost:5080  (Production rejimida Swagger o'chiq)
```

### Variant B — lokal PostgreSQL
```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:ConnectionStrings__Default = "Host=localhost;Port=5432;Database=hamyon;Username=hamyon;Password=..."
$env:Jwt__Secret = "<kamida 32 belgili tasodifiy qator>"   # bo'sh bo'lsa Development'da vaqtinchalik kalit yaratiladi
$env:Demo__Seed = "true"                                    # faqat Development: demo@hamyon.local / Demo12345!
dotnet run --project backend/src/Hamyon.Api --urls http://localhost:5080
# Swagger: http://localhost:5080/swagger
```
Migratsiyalar `Database__AutoMigrate=true` bo'lganda ishga tushishda qo'llanadi.

## Testlar
```powershell
$env:TEST_POSTGRES = "Host=localhost;Port=5432;Username=postgres;Password=...;Database=postgres"
dotnet test backend
```
Har bir test sinf uchun alohida vaqtinchalik baza yaratiladi va oxirida o'chiriladi.

## Flutter ilovasi
```bash
cd app
flutter create --platforms=android,ios,web,windows .   # platforma papkalarini hosil qiladi (bir marta)
flutter pub get
flutter test
flutter run -d chrome --dart-define=API_URL=http://localhost:5080
```
Android emulyatorda API manzili: `http://10.0.2.2:5080`.

## Asosiy qoidalar
- Barcha pul o'zgarishlari faqat backend ledger'i orqali (double-entry, atomik, idempotent).
- Pul `decimal`/`numeric(19,4)`; turli valyutalar hech qachon qo'shilmaydi.
- Moliyaviy yozuv o'chirilmaydi: bekor qilish = reversal, tahrir = reversal + yangi yozuv.
- Qarz olish/berish daromad/xarajat statistikasiga kirmaydi; transfer ham kirmaydi.
- To'liq karta raqami va CVV saqlanmaydi (faqat niqoblangan oxirgi raqamlar).
- Sirlar (`JWT_SECRET`, parollar) faqat environment orqali; repozitoriyda yo'q.

## Kengaytirish nuqtalari (hali yo'q, ishlayapti deb ko'rsatilmaydi)
Raqamli Passport SSO (`User.ExternalIssuer/ExternalSubjectId` tayyor), bank API, Click/Payme, Telegram, AI yordamchi, ovoz bilan kiritish.
