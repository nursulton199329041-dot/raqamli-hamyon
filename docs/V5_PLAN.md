# V5 — audit va reja (2026-10-28)

## 1. Audit natijalari (branch `feat/liquid-glass-home`, HEAD `572f02e`)

| Soha | Hozirgi holat | V5 talabi bilan farq |
|---|---|---|
| Ledger | Ikki tomonlama (`LedgerLine` har valyuta bo'yicha 0 ga teng), kesh balans atomik yangilanadi, tuzatish = reversal + yangi yozuv (`ReplacesId`). | Asos to'g'ri; o'zgartirish kerak emas. |
| Idempotency | `JournalEntry.IdempotencyKey` (user bo'yicha unique) + `RequestFingerprint`; bir xil kalit + boshqa ma'lumot → `409 idempotency.key_reused`; poyga holati unique index bilan hal qilinadi. Offline navbat `clientOperationId` ni kalit sifatida yuboradi. | Takroriy sync allaqachon dublikat yaratmaydi (testlangan). Revision/conflict faqat katalog obyektlari uchun yo'q. |
| Sync | `POST /api/sync/push` (200 tagacha, natija: applied/duplicate/rejected), `GET /api/sync/pull?since=` (delta + to'liq kataloglar). Server — balans uchun yagona manba, majburlab yozilmaydi. | Profil bo'yicha ajratish yo'q; katalog tahrirlari uchun `revision` yo'q (hozir last-write-wins). |
| Data isolation | Har bir so'rovda `UserId == uid` (`GetWalletAsync`, `EnsureOwnedAsync`). | `ProfileId` darajasi yo'q. |
| Auth | Email+parol (PBKDF2-SHA512 210000), JWT + rotatsiyali refresh (family), lockout. `User.ExternalSubjectId/ExternalIssuer` maydonlari bor, ishlatilmaydi. | Google OIDC yo'q. |
| Valyuta | Transferda FX bor (har valyuta o'z `FxClearing` hisobiga, `FxRate` RateScale bilan, `Currencies.Convert` yaxlitlash qoidalari). Xarajat faqat hamyon valyutasida. | USD hamyon → UZS xarajat yo'q; kurs sanasi/manbasi saqlanmaydi; kurs manbasi (provider) yo'q. |
| Qarzlar | `DebtBorrow/Lend/Repayment/Collection` alohida turlar, alohida `Debt` ledger hisobi, P&L'ga kirmaydi (analytics summary qoidasi). | Kirim manbasiga bog'lash (UI) va "Botir aka: −1 000 USD" ko'rinishi yo'q. Qarz qaytarishda valyuta faqat qarz valyutasida. |
| Tarix | Barcha turlar bor; transfer bitta yozuv (ikki tomonlama emas). `correlation` = bitta `JournalEntry` + uning `Lines`. | Kurs, profil, yangilangan vaqt ko'rsatilmaydi; tor ekranda sana sarlavhasi va summa ustma-ust tushadi. |
| Mobil native | `expo-secure-store` APK'da bor. `expo-local-authentication`, `expo-auth-session`, `expo-web-browser`, `expo-crypto` **yo'q**. | PIN (SecureStore) OTA bilan mumkin; biometriya va Google login **yangi preview APK** talab qiladi. |

## 2. Yangi data model (backward-compatible)

1. `Profiles` jadvali: `Id, UserId, Name, AvatarColor, AvatarIcon, BaseCurrency, SortOrder, IsArchived, CreatedAt, Revision`.
2. Moliyaviy jadvallarga **nullable** `ProfileId` (Wallets, Categories, IncomeSources, People, Projects, Debts, LedgerAccounts, JournalEntries, LedgerLines).
3. Migratsiya: har bir mavjud user uchun "Asosiy" profil yaratiladi va barcha qatorlar unga backfill qilinadi (bitta tranzaksiyada). Hech qanday qator o'chirilmaydi, ustunlar faqat qo'shiladi.
4. Keyingi migratsiyada (backfill tekshirilgandan so'ng) `ProfileId NOT NULL` va indekslar `(UserId, ProfileId, ...)`. Idempotency unique indeksi `(UserId, IdempotencyKey)` o'zgarmaydi — kalitlar akkaunt bo'yicha global.
5. `JournalEntries`: `RateDate`, `RateSource` (nullable), `UpdatedAt`. `FxRate` mavjud.
6. `ExternalLogins`: `Provider, Subject, UserId, Email (faqat ma'lumot uchun), LinkedAt`; unique `(Provider, Subject)`. Identifikatsiya faqat `sub` bo'yicha.
7. Katalog obyektlariga `Revision int` (optimistic concurrency, `If-Match` → `409 conflict.stale`).
8. `ExchangeRates` (keshlangan): `Base, Quote, Rate, Date, Source`. Saqlangan operatsiya kursi hech qachon qayta hisoblanmaydi.

API: barcha moliyaviy endpointlar `X-Profile-Id` sarlavhasini oladi; server profilni `UserId` ga tegishliligini tekshiradi (aks holda 404, ma'lumot oshkor qilinmaydi). Sarlavha yo'q bo'lsa — foydalanuvchining asosiy profili (eski klientlar ishlashda davom etadi).

## 3. Xavfsiz migratsiya tartibi (lokal server)

1. `pg_dump -Fc` zaxira (`prechange-v5-*`), eski API binarlari nusxasi.
2. Migratsiya avval `hamyon_dev` nusxasidan tiklangan test bazada ishga tushiriladi; satrlar soni, balanslar yig'indisi (0), har hamyon balansi oldin/keyin solishtiriladi.
3. Faqat shundan keyin, **foydalanuvchi ruxsati bilan**, `hamyon_dev`ga.
4. Rollback: eski binarlar + dump (yangi ustunlar nullable bo'lgani uchun eski API yangi sxemada ham ishlaydi).

## 4. Bosqichlar va commitlar

| # | Bosqich | Native? | Holat |
|---|---|---|---|
| 1 | Xarajat grid (AUTO/1/2/3), scrollsiz, vertikal auto-scroll | yo'q | **bajarildi** |
| 2 | Tarix UI tuzatish (sarlavha/summa ustma-ust) | yo'q | **bajarildi** |
| 3 | Backend: Profiles + ProfileId migratsiya + izolatsiya testlari | — | **bajarildi, lokal serverga o'rnatildi** |
| 4 | Profile Switcher UI + profil bo'yicha kesh/navbat | yo'q | 3 dan keyin |
| 5 | Cross-currency xarajat (FX clearing, kurs sanasi/manbasi, qo'lda kurs) | yo'q | **backend bajarildi**; mobil forma qoldi |
| 6 | Qarz ↔ kirim manbasi UI, qarz balansi ko'rinishi | yo'q | |
| 7 | Tarix to'liq audit maydonlari | yo'q | 5 dan keyin |
| 8 | Onboarding (8 bosqich, demo, profil bo'yicha holat) | yo'q | |
| 9 | Xavfsizlik: PIN (SecureStore, hash+salt, urinish limiti, auto-lock) | yo'q (OTA mos) | |
| 10 | Biometriya (`expo-local-authentication`) | **ha → yangi APK** | ruxsat kerak |
| 11 | Google login (Auth Code + PKCE, backend ID token tekshiruvi, `sub`) | **ha → yangi APK** | Google Cloud OAuth client ID'lar kerak |
| 12 | Sozlamalar guruhlari (faqat ishlaydigan bandlar) | yo'q | |

## 5. Foydalanuvchidan kerak bo'ladigan narsalar

- **Google Cloud**: OAuth consent screen + Android client (package `uz.raqamli.hamyon`, preview APK'ning SHA-1), iOS client, Web client (backend audience). Men tashqi konfiguratsiyani o'zgartirmayman — client ID'larni siz yaratib berasiz.
- **Yangi preview APK** (`eas build --profile preview`) biometriya va Google uchun; runtimeVersion `appVersion` policy → app versiyasini `1.1.0` ga ko'tarish kerak, aks holda yangi native kodli OTA eski APK'ga tushib, crash beradi.
- **`hamyon_dev` migratsiyasiga ruxsat** (zaxira bilan).

## 6. Real qurilma

Hech bir bosqich hali real Android/iPhone'da sinalmagan. Avtomatik testlar va brauzer tekshiruvi alohida qayd etiladi.
