# V6 — Offline-first, cloud sync, Free/PRO (audit va reja)

Sana: 2026-10-28. Branch: `feat/liquid-glass-home` (HEAD `a97f375` audit vaqtida).

## Phase 0 — haqiqiy holat (koddan aniqlangan)

| Soha | Hozir | Offline-first uchun muammo |
|---|---|---|
| Lokal baza | `expo-sqlite` 57.0.4 (native modul **APK'da bor**, plugin `app.json`da). `hamyon.db`: `kv` (server snapshot JSON, sozlamalar), `ops` (offline navbat JSON), `update_log`. Versiya `PRAGMA user_version` = 2. Web: localStorage. | Moliyaviy ma'lumot lokal **jadval** sifatida yo'q — faqat oxirgi server javobining JSON nusxasi. |
| Yozish | `useQueue.submit` → `POST /api/sync/push`; tarmoq xatosida `ops`ga yoziladi. Idempotency: `clientOperationId` = server kaliti. | Offline operatsiya balansni o'zgartirmaydi (balans faqat serverdan). Hamyon/toifa/manba yaratish va tahrirlash faqat online. Navbatga yozish `UPDATE` emas, butun ro'yxatni qayta yozish (`replaceAll`). |
| O'qish | `useSnapshot` → `/api/sync/pull` (to'liq katalog + 1000 tagacha yozuv); offline — keshlangan snapshot. Summary/breakdown/series/budgets/hisobotlar — faqat server. | Internet yo'q bo'lsa hisobotlar ishlamaydi. |
| Auth | Email+parol, JWT + rotatsiyali refresh, tokenlar SecureStore'da. Offline ishga tushishda keshlangan profil bilan davom etadi. | Login'siz (guest) rejim yo'q — birinchi ishga tushishda server majburiy. |
| Pul arifmetikasi | Mobil faqat formatlaydi (`number`); hisob-kitob backendda (`decimal`, `numeric(19,4)`). | Lokal ledger uchun float ishlatib bo'lmaydi → minor units kerak. |
| Backend sync | `/api/sync/push`: income/expense/transfer/debt/repay; idempotent (unique key + fingerprint). `/api/sync/pull?since=` — yozuvlar `CreatedAt` bo'yicha + to'liq kataloglar. Profil bo'yicha ajratilgan (V5). | Server katalog obyektlari uchun **mijoz ID'sini qabul qilmaydi** (ID serverda yaratiladi) — offline yaratilgan hamyonni keyin sync qilish uchun kerak. Revision/conflict faqat Profile'da. |
| EAS | Kanallar: development / preview / production. `runtimeVersion.policy = appVersion` (1.0.0). Preview APK fingerprint `8874963d…`. | Yangi native modul (biometriya, Google, billing) → yangi build + app versiyasini ko'tarish. `expo-sqlite` allaqachon bor → lokal baza OTA bilan yetkazilishi mumkin. |
| Testlar | Mobil Jest 183 (16 suite), backend xUnit 67, tsc/eslint, Android export. | Lokal SQLite testlari yo'q (expo-sqlite Jest'da ishlamaydi). Yechim: Node 24 `node:sqlite` adapteri — **bir xil SQL** haqiqiy SQLite'da sinaladi. |

## Arxitektura qarorlari

1. **Lokal baza = UI uchun yagona manba.** Har moliyaviy operatsiya bitta SQLite tranzaksiyasida: `transactions` + `transaction_entries` (ikki tomonlama, har valyutada yig'indi 0) + `ledger_accounts.balance_minor` (shartli yangilash, overdraft tekshiruvi) + `sync_outbox`. Biror qism xato bersa — to'liq ROLLBACK. UI muvaffaqiyatni faqat COMMIT'dan keyin ko'rsatadi.
2. **Pul = butun minor units** (`INTEGER`), valyuta aniqligi backend `Currencies` bilan bir xil (hammasi 2 xona). Kurs = 8 xonali o'nlik qator (`TEXT`), konvertatsiya `BigInt`da, yaxlitlash backend kabi half-away-from-zero. JS `number` pul hisobida ishlatilmaydi (faqat ko'rsatish uchun).
3. **ID**: barcha lokal obyektlar UUID v4 (server `Guid` formatiga mos) — server/lokal kolliziyasi yo'q; operatsiya ID'si = idempotency key.
4. **Jadvallar ↔ talab nomlari**: Accounts → `accounts`; Profiles → `profiles`; Wallets → `wallets`; IncomeSources → `income_sources`; ExpenseCategories + Subcategories → `categories` (`parent_id`; alohida takroriy jadval yo'q, backend bilan bir xil); Transactions → `transactions`; TransactionEntries → `transaction_entries`; Debts → `debts`; DebtMovements → `debt_movements` VIEW (`transactions WHERE debt_id`); CurrencyRates → `currency_rates`; UserPreferences → mavjud `kv` (`setting:*`); SyncOutbox → `sync_outbox`; SyncCheckpoints → `sync_checkpoints`; SchemaMigrations → `PRAGMA user_version` + `schema_migrations` jurnali. Hisob-kitob uchun `ledger_accounts` (backend bilan bir xil).
5. **Migratsiyalar**: mavjud `MIGRATIONS` massiviga faqat qo'shiladi; har versiya statementlari **va** `user_version` bitta tranzaksiyada (yarim qo'llangan versiya bo'lmaydi). Xato → ROLLBACK, versiya va ma'lumot o'zgarmaydi, ilova eski ma'lumot bilan ochiladi va xato qayd etiladi. DROP/reset taqiqlangan.
6. **Sync**: transactional outbox → push (batch, exponential backoff, `attempts`, `next_attempt_at`) → server idempotent; pull — profil bo'yicha `sync_checkpoints.cursor`. Moliyaviy yozuvlar append-only (tuzatish = reversal + yangi yozuv), shuning uchun ikki qurilma konfliktida pul yozuvlari jim ustidan yozilmaydi; katalog obyektlari `revision` bilan.
7. **Entitlement (PRO)**: server imzolagan, muddatli token (plan, expiry, grace) — lokal faqat imzoni va muddatni tekshiradi; soat orqaga surilsa oxirgi ko'rilgan server vaqtidan foydalaniladi. PRO tugasa ma'lumot o'chirilmaydi, faqat PRO funksiyalar cheklanadi; bazaviy eksport doim mavjud.

## Bosqichlar holati

| Bosqich | Holat |
|---|---|
| 0 Audit | **bajarildi** (shu hujjat) |
| 1 Offline storage (sxema v3, atomik migratsiya runner, minor-units money, UUID) | **bajarildi** (testlar Node SQLite'da) |
| 2 Lokal operatsiyalar (wallet/manba/toifa, kirim, xarajat+FX, transfer+FX, qarz, qaytarish, reversal; outbox bir tranzaksiyada; lokal summary) | **bajarildi** |
| 3 Sync engine (push/pull, backoff, checkpoint; server: mijoz ID'lari, katalog push turlari) | **bajarildi**; UI ulandi, lekin "Offline-first (beta)" kaliti orqasida (standart: o'chiq) |
| 4 Identity (guest → akkaunt bog'lash, merge; Google) | **bajarildi** (backend + guest rejim + lokal hisobotlar); Google tugmasi telefonda yo'q — client ID'lar va yangi build kerak |
| 5 Free/PRO entitlement | qilinmagan |
| 6 Billing (Play/App Store sandbox) | qilinmagan; real to'lov — alohida ruxsat |
| 7 Migration & update safety (DB backup, EAS compatibility) | qisman (atomik migratsiya + failure test) |
| 8 Final QA, real qurilma | **NOT TESTED** (real telefon) |

## Phase 1–2 natijasi (2026-10-28)

- `src/local/money.ts` — butun minor units, BigInt konvertatsiya, backend bilan bir xil yaxlitlash (12 USD × 12 000 = 144 000 UZS; 1,15 × 12 345,678 = 14 197,53; derived rate 12 333,33333333).
- `src/offline/migrations.ts` v3 — 15 ta jadval/view + indekslar; `src/local/migrate.ts` — har versiya + `user_version` bitta tranzaksiyada; xato → `MigrationError`, versiya va ma'lumot o'zgarmaydi; yangiroq versiyadagi bazaga tegilmaydi. `offline/sqlite.ts` — bitta ulanish, `foreign_keys=ON`, WAL; migratsiya xato bersa kesh va navbat ishlashda davom etadi, xato `update_log`ga yoziladi.
- `src/local/ledger.ts` — lokal akkaunt + "Asosiy" profil + standart toifa/manbalar; hamyon (boshlang'ich balans bilan), toifa/podkategoriya, manba, hamyon tahriri (revision); kirim, xarajat (+FX), transfer (+FX), qarz olish/berish, qaytarish (ortiqcha va boshqa valyuta rad), reversal (append-only). Har biri: yozuv + muvozanatli qatorlar + shartli balans + outbox **bitta tranzaksiyada**; takroriy op ID → bitta yozuv.
- `src/local/reports.ts` — lokal summary (backend qoidalari) va books check.
- Testlar (`__tests__/localStore.test.ts`, 16): 100 offline xarajat, takroriy yuborish, mablag' yetmasligi, oxirgi qadamda xato (outbox) → to'liq rollback, USD→UZS, transfer/qarz daromad emas, profil izolatsiyasi, eskirgan tahrir, eski baza (v2) → v3, migratsiya yarmida xato, yangiroq baza, faylni yopib qayta ochish. Mutatsiya: rollback buzilsa 3 test, overdraft tekshiruvi olinsa 1 test yiqiladi.
- **UI hali lokal dvigatelga ulanmagan** — ilova hozir ham server snapshot + navbat bilan ishlaydi. Ulash Phase 3 (sync) bilan birga qilinadi, chunki server hali mijoz yaratgan hamyon/toifa ID'larini qabul qilmaydi.
- Expo-sqlite adapteri (`src/local/expoDb.ts`) va WAL/foreign_keys faqat Android bundle yig'ilishi bilan tekshirildi — **real telefonda NOT TESTED**.
## Phase 3 natijasi (2026-10-28)

**Server (backend)**
- Barcha operatsiyalar ixtiyoriy mijoz ID'sini qabul qiladi: yozuv (`Id`), hamyon (`Id`, `OpeningId`), toifa, manba, qarz (`DebtId`), yangi shaxs (`PersonId` + ism), reversal. Bir yozuv telefonda ham, serverda ham bitta ID bilan yashaydi.
- `/api/sync/push` yangi turlar: `wallet.create`, `wallet.update` (targetId), `category.create`, `source.create`, `reverse` (targetId). Takror yuborilgan katalog obyekti → `duplicate`. Boshqa foydalanuvchining ID'si yoki band ID → `rejected` (`sync.conflict`), hech qachon majburan yozilmaydi.
- `/api/sync/pull` endi har yozuvning qatorlarini (kind, refId, currency, amount) beradi; sahifa to'lsa cursor oxirgi yozuvdan davom etadi.
- Baza sxemasi o'zgarmadi (migratsiya yo'q). Backend testlari 70/70 (yangi `OfflineSyncTests` 3 ta; mutatsiya: mijoz ID'si olib tashlansa 2 test yiqiladi).

**Telefon**
- `src/local/sync.ts` — `SyncEngine`: outbox eng eskisidan, 100 talik paketlarda; applied/duplicate → done, rejected → sababi bilan saqlanadi; tarmoq xatosi → butun paket 5 s, 10 s, 20 s … 1 soatgacha kutadi (tartib buzilmaydi). Pull: checkpoint'dan 5 daqiqa ustma-ust, har sahifa checkpoint bilan bitta tranzaksiyada; yangi yozuvlar qatorlaridan qayta quriladi, mavjudlariga faqat reversal bog'lanadi. Navbatdagi lokal hamyon tahriri serverning eski nusxasi bilan ustidan yozilmaydi. Hech narsa kutmayotganda balans serverdan farq qilsa `drift` sifatida ko'rsatiladi.
- `discardRejected` — server rad etgan amalni telefonda lokal reversal bilan bekor qiladi (serverga hech narsa yuborilmaydi).
- `adoptCloudAccount` — kirgan foydalanuvchining profillari server ID'lari bilan olinadi; telefonda guest yoki boshqa foydalanuvchi kitobi bo'lsa jim birlashtirilmaydi (Phase 4).
- Sxema v4: `transactions.project_id` (faqat ADD COLUMN). Shaxs, sabab, loyiha endi lokal amal bilan saqlanadi va serverga yuboriladi.
- UI: `src/local/bridge.ts` — operatsiya oynasi amallari lokal kitobga yoziladi, ekranlar lokal kitobdan o'qiydi, sync fonda ishlaydi. **Faqat Sozlamalar → "Offline-first (beta)" yoqilganda** (telefon, kirgan foydalanuvchi). O'chiq bo'lsa ilova avvalgidek server orqali ishlaydi (kod yo'li o'zgarmagan).
- Testlar: `syncEngine.test.ts` 9, `localBridge.test.ts` 3, `syncE2E.test.ts` 1 — ikki "telefon" (Node SQLite) **haqiqiy .NET API** bilan (vaqtinchalik baza): offline ishlar, FX, reversal, qarz, ikki qurilmada bir pulni sarflash (biri rad etiladi va bekor qilinadi), javob yo'qolganda hammasini qayta yuborish → dublikat yo'q. Mutatsiya: dedupe olib tashlansa 2, backoff olib tashlansa 1 test yiqiladi.

**Cheklovlar (hali qilinmagan)**
- Loyihalar lokal kitobda yo'q (oxirgi pull nusxasi ko'rsatiladi). Toifa/manba tahriri va arxivi hali faqat online.
- Katalog tahrirlarida server revision tekshiruvi yo'q (oxirgi yozgan yutadi); pul yozuvlari append-only bo'lgani uchun pul konflikti yo'qolmaydi.
- Chiqish (sign-out) lokal kitobni o'chirmaydi; boshqa foydalanuvchi kirsa beta o'chadi (server rejimi). Guest ↔ akkaunt birlashtirish — Phase 4 (pastda).
- Real telefonda **NOT TESTED**. Beta kalit shu sababli standart o'chiq.

## Phase 4 natijasi — Identity (2026-10-28)

**Server**
- `POST /api/auth/google {idToken}` — Google ID token imzo (Google kalitlari), issuer, audience (`Google:ClientIds`), muddat bo'yicha tekshiriladi. Noma'lum identity → yangi akkaunt (parolsiz). Email tasdiqlanmagan bo'lsa → 401. Shu email bilan parolli akkaunt bo'lsa **egallab olinmaydi** → `409 auth.link_required` (foydalanuvchi parol bilan kirib, `POST /api/me/google` bilan bog'laydi). Bitta Google identity faqat bitta akkauntga (`auth.identity_taken`). `ClientIds` bo'sh → `503 auth.google_disabled`.
- `IExternalTokenValidator` — Raqamli Passport (OIDC) uchun ikkinchi adapter qo'shish joyi.
- `POST /api/profiles` endi telefonda tanlangan `id` va `seedDefaults:false` ni qabul qiladi (takrorlansa o'sha profil qaytadi; boshqa foydalanuvchi o'sha id'ni ololmaydi).
- `wallet.create` `openedAt` qabul qiladi: oflayn ochilgan hamyonning boshlang'ich balansi telefondagi sana bilan yoziladi (avval yuklash vaqti bilan yozilardi — E2E testda topilgan xato).

**Telefon**
- Kirish oynasida **"Lokal hisob bilan boshlash"**: akkaunt, internet va serversiz ishlaydi (`status: 'guest'`, kitob `engine: null` — hech narsa yuborilmaydi).
- Mehmon rejimida barcha yozuvlar lokal: operatsiyalar, hamyon yaratish/tahrirlash/arxivlash, toifa/podkategoriya/manba yaratish, bekor qilish, tahrirlash (reversal + yangi yozuv **bitta** SQLite tranzaksiyada).
- **Hisobotlar lokal** (`src/local/analytics.ts`): summary, breakdown, timeseries (telefon soat mintaqasi), balans tarixi, hamyon davrlari, budjetlar, operatsiyalar ro'yxati (filtr + qidiruv). Offline-first yoqilgan akkauntda ham ishlaydi.
- Sozlamalar → **"Akkauntga ulash"** → kirish oynasida ogohlantirish: telefondagi ma'lumot akkauntga **alohida profil** sifatida qo'shiladi, hech narsa o'chirilmaydi. Kirgandan keyin: profil serverda telefon id'si bilan yaratiladi → lokal akkaunt bulutga o'tkaziladi → outbox (standart katalog ham) yuklanadi. Hech narsa kiritilmagan mehmon kitobi bo'sh profil bo'lib qolmasligi uchun o'chiriladi. Bog'lashda xato bo'lsa, mehmon rejimi o'zgarishsiz qoladi.

**Testlar**
- Backend 74/74 (yangi `IdentityTests` 4 ta: Google kirish, email egallanmasligi + bog'lash, o'chiq Google, mehmon profilini yuklash + `openedAt`).
- Mobil 223 o'tdi + 2 skip (E2E). Yangi: `guestAndReports.test.ts` 10, `guestUi.test.tsx` 2.
- E2E (haqiqiy API, vaqtinchalik baza `hamyon_e2e_v6p4`, keyin o'chirildi): mehmon kitobi → ro'yxatdan o'tish → bog'lash → bir marta yuklandi, to'liq qayta yuborishda dublikat yo'q; **lokal hisobotlar server hisobotlari bilan aynan teng** (summary, breakdown ×3, timeseries ×3, balans, hamyonlar, operatsiyalar).
- Mutatsiya: FX valyuta qoidasi buzilsa 3 test, tahrirlash atomikligi buzilsa 1 test yiqiladi.
- Android eksport OK; native fingerprint `8874963d…` o'zgarmagan → preview APK bilan OTA mos.

**Qolgan / cheklovlar**
- Telefonda Google tugmasi **yo'q**: Google Cloud'da OAuth client ID'lar (Android/iOS/web) kerak va `expo-auth-session` (native modul) → yangi build. Server tomoni tayyor va testlangan (soxta validator bilan; haqiqiy Google token bilan **NOT TESTED**).
- Bog'langan mehmon profili alohida profil bo'lib qoladi; bosh ekrandagi avatar orqali profillarni almashtirish mumkin (`features/ProfilesSheet.tsx`, `state/profiles.ts`; tanlov `local:current_profile` va `X-Profile-Id` orqali). Serverga to'g'ridan-to'g'ri ishlaydigan telefonda yuborilmagan operatsiyalar bo'lsa, almashtirish bloklanadi. Real telefonda: NOT TESTED.
- Mehmon rejimida: loyihalar, hamyonning bank ma'lumotlari/overdraft tahriri, toifa limitini o'rnatish, odamni alohida yaratish (ism izohga yoziladi) — hali yo'q.
- Real telefonda **NOT TESTED**.

