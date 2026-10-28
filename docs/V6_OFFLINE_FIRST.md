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
| 2 Lokal operatsiyalar (wallet/manba/toifa, kirim, xarajat+FX, transfer+FX, qarz, qaytarish, reversal; outbox bir tranzaksiyada; lokal summary) | **dvigatel bajarildi, UI hali ulanmagan** |
| 3 Sync engine (push/pull, backoff, checkpoint; server: mijoz ID'lari, katalog push turlari, revision) | qilinmagan |
| 4 Identity (guest → Google bog'lash, merge) | qilinmagan; Google client ID'lar kerak |
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