# RAQAMLI HAMYON — PROJECT STATUS

Oxirgi yangilanish: 2026-10-16

## !!! ENG YUQORI USTUVORLIK (keyingi asosiy vazifa)
**Android'da Drag & Drop va kirim (income) funksiyasini HAQIQIY telefonda ishlatish.** Kod tuzatilgan (d9c9cef) va jest 38/38 o'tgan, lekin haqiqiy Android qurilmada **tasdiqlanmagan** (adb/JDK yo'q). Birinchi navbatda: preview APK + OTA bilan telefonda drag&drop, kirim, hamyon tanlash oqimini tekshirish. Server tayyor: `http://192.168.1.5:5080`.

## Lokal server (2026-10-16, barqarorlashtirilgan)
- Boot'da login'siz ishga tushadi: tasklar `RaqamliHamyon-PostgreSQL` va `RaqamliHamyon-API-Supervisor` (LocalService). Eski login-task `RaqamliHamyon-API` Disabled.
- Skriptlar: `scripts/server/` (o'rnatilgan nusxa `D:\RaqamliHamyonLocal\ops`). Hujjat: `docs/ops/LOCAL_SERVER.md` (sabab tahlili, loglar, zaxira, DHCP reservation, muhitlar).
- Health: `D:\RaqamliHamyonLocal\ops\healthcheck.ps1`. Firewall 5080 faqat LocalSubnet. Production profili faqat shablon.
- Ochiq: kompyuter kutilmagan o'chishlari (Kernel-Power 41); reboot-dan keyingi avtostart hali jonli sinalmagan; routerda DHCP reservation egasi tomonidan qilinishi kerak.

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

### Android kritik xatolar: surish-xarajat va kirimda hamyon tanlash — 2026-10-16
Muammo (haqiqiy APK'da): hamyonni toifaga surib xarajat qilib bo'lmadi; kirim oynasida hamyon tanlab bo'lmadi.

**Topilgan asl sabablar (kod tahlili; qurilmada o'lchanmagan):**
1. `Sheet` (barcha formalar): `GlassCard` ichki o'rami `flexShrink: 0` (RN default) bo'lgani uchun ScrollView to'liq balandlikda qolib, `maxHeight` bilan kesilardi — Android'da pastdagi hamyon tanlovi va "Tasdiqlash" ko'rinmas va scroll bo'lmas edi. Ustiga `KeyboardAvoidingView` Android'da `behavior` siz edi (edge-to-edge'da klaviatura formani yopadi), `autoFocus` esa klaviaturani darhol ochardi.
2. Surish: (a) kartochka-"ghost" barmoq bilan harakatlanmasdi (`gx/gy` faqat `begin()` da yozilardi); (b) barmoq o'rni `absoluteX/Y` dan olinardi, drop zonalar esa `measureInWindow` fazosida — Android'da status bar/inset farqi bo'lsa zonaga tushmaydi; (c) gesture har renderda qayta yaratilardi (faol gesture ustida native handler qayta sozlanardi); (d) `Gesture.Exclusive(pan, tap)` o'rniga oddiy `Pressable` bosish ishlatiladi; (e) eski zona rect'lari yangi o'lchov kelguncha qolardi.

**Tuzatishlar (faqat JS/TS, native o'zgarishsiz):**
- `src/dnd/DragDrop.tsx`: barmoq = `draggable window origin + grab nuqtasi + translation` (hamma narsa bitta `measureInWindow` fazosida); ghost har `move` da joylashadi va tile kengligida; gesture bir marta yaratiladi (refs); zona rect'lari `begin` da tozalanib qayta o'lchanadi; touch-cancel → hech narsa tushmaydi; bosish `Pressable` orqali, drag'dan keyin 400 ms bosish bloklanadi.
- `src/design/Sheet.tsx` + `Glass.tsx` (`innerStyle`): butun zanjir `flexShrink: 1`, `KeyboardAvoidingView behavior="padding"` har platformada, **footer** (Tasdiqlash) ScrollView'dan tashqarida — doim ko'rinadi/bosiladi.
- Yangi `src/features/WalletPicker.tsx`: forma ICHIDAGI hamyon tanlash sahifasi (ikkinchi Modal emas → boshqa oyna ostida qolmaydi). Faol hamyonlar backend snapshot'dan (ochilganda refetch): ikon, nom, valyuta, qoldiq, tanlangani belgilanadi. Hamyon yo'q → "Yangi hamyon yaratish" → yaratilgach formaga qaytadi va yangi hamyon avtomatik tanlanadi.
- `OperationSheet.tsx`: kirim/xarajat/transfer/qarz — hammasida hamyon qatori (kirim: "Qabul qiluvchi hamyon", xarajat: "To'lov hamyoni", transfer: ikkita, qarz: yo'nalishga qarab). "Kirim manbasi" hamyondan alohida. Loyiha, sabab, kimdan/kimga, izoh forma ichida ochiq. Android'da summa maydoni avtofokussiz. Aniq validatsiya va server xabarlari.
- Tap muqobili (hamyon → Xarajat → toifa → summa → Tasdiqlash) o'zgarishsiz ishlaydi va testlangan.

**Testlar (haqiqiy bajarilgan):** tsc toza, eslint 0 xato, jest **38/38** (oldin 20; +18), expo-doctor 21/21.
Yangi: `__tests__/dashboardDrop.test.tsx` (8: wallet→toifa, wallet→wallet, manba→wallet, noto'g'ri drop/cancel, ScrollView lock, auto-scroll, long-press 350 ms, tap yo'li; Android touch-fazosi 24 px siljishi bilan) va `__tests__/operationSheet.test.tsx` (10: ochilish, hamyonlar ro'yxati, tanlash, yaratib qaytish, saqlash, balans/tarix/manba jami yangilanishi, validatsiya/server xatosi, har operatsiyada hamyon, orqaga). Backend o'rniga `test-utils/fakeServer.ts` (haqiqiy ledger semantikasi); mutatsiya tekshiruvi: `absoluteX` ga qaytarilsa 3 test yiqiladi.

**TEKSHIRILMAGAN (aniq):** haqiqiy Android qurilma/emulyatorda sinov o'tkazilmagan (bu mashinada adb/JDK/Android SDK yo'q). Jest/Playwright sensorli Android surishni isbotlamaydi. Tuzatishlar sabablar tahliliga asoslangan; telefonda tasdiqlash SIZDA qoladi.

**Native o'zgarish:** yo'q (`package.json`, `app.json`, `app.config.js`, `eas.json` o'zgarmagan; lokal Android fingerprint = EAS build fingerprint `8874963d…`). → faqat JS: mavjud 1.0.0 APK'ga OTA mos, yangi APK shart emas. Production kanaliga hech narsa yuborilmagan.
### Video asosida UX rekonstruksiya — 2026-10-16
**Video ko'rildi:** `IMG_2421.MP4` (65 s, 880x1920) `design-reference/` ga nusxalandi, ffmpeg bilan har 1,5 s da 44 kadr ajratildi va ko'rib chiqildi (kadrlar/video git'ga qo'shilmagan, `.gitignore`). Video tovushi tahlil qilinmadi. Etalon: zich doira-grid panel (nomi tepada, doira ikon, summa pastda, bo'lim jami), surishda suzuvchi doira, kalkulyatorli operatsiya oynasi (tur ▾, ✕, katta summa + ifoda, "qayerdan >> qayerga", subkategoriya, sana lentasi, izoh, "yana operatsiya", Saqlash + klaviatura), ikki summali transfer (kurs), tarix (saldo, tushum/chiqim kartalari, kunlik jami), tahrirlash oynasida 🗑.

**Qilingan (faqat JS/TS):**
- **Pul kalkulyatori** `src/lib/calc.ts`: float yo'q — BigInt (10^8 masshtab), × ÷ ustuvorligi, yarim-nolga-qarama-qarshi yaxlitlash, valyuta aniqligi (2), API'ga aniq o'nli satr. `src/design/Keypad.tsx`: C ⌫ ÷ / 1-9 × − + / , 0 = Yopish. `150000+25000` → 175 000.
- **Dashboard** qayta qurildi: 3 bo'lim (Kirim manbalari / Hamyonlar / Xarajat toifalari), 5 ustunli doira tiles, hamyon qoldig'i doim ostida, bo'lim jami (davr bo'yicha), yig'ish, davr tanlash, sinxron tugmasi; subkategoriyalar gridda emas, toifa jamiga qo'shiladi; uzun summalar kichrayadi.
- **Operatsiya oynasi** (kirim/xarajat/transfer/qarz) video mantig'ida: tepada tur+✕, markazda yirik summa (+ifoda), manba >> qabul qiluvchi (doira, nom, qoldiq), subkategoriya (+qo'shish), 14+ kunlik sana lentasi, izoh, "yana operatsiya qo'shish", katta Saqlash va pastda kalkulyator (izohga fokus → tizim klaviaturasi, Saqlash ko'rinib turadi). Hamyon/toifa/manba tanlash forma ichidagi sahifa. Valyutalararo transfer: ikkita summa, oxirgi kurs avtomatik, kurs qatori.
- **Tarix**: saldo + tushum/chiqim, oy strelkalari, kunlar bo'yicha guruh va kunlik jami (ochilish balanslari jamiga kirmaydi), "Toifa / Subkategoriya", transferda ikkinchi valyuta, qidiruv, filtr, FAB; operatsiyani bosish → tahrirlash (PUT = reversal + yangi yozuv), 🗑 → tasdiqlash → reversal (fizik o'chirish yo'q).
- **Saqlash himoyasi**: sinxron qulf (ikki marta bosish = 1 operatsiya), validatsiya, yetarli balans tekshiruvi, server xabari so'zma-so'z, offline navbat (clientOperationId idempotent).
- **Android sensor uchun diagnostika**: Sozlamalar → "Sensor (surish) diagnostikasi" (`/dnd-test`): xom-oyna koordinata farqi, barmoq o'rni, zona natijasi, cancel — telefonda tekshirish uchun.
- Hamyon yaratishda boshlang'ich balans 0 endi qabul qilinadi.

**Testlar (haqiqiy bajarilgan):** tsc toza, eslint 0 xato, expo-doctor 21/21, jest **78/78** (oldin 38): kalkulyator 15, dashboard/drag 11, operatsiya oynasi 26, tarix 5, **qabul stsenariyi 1** (1–18 bandlar UI darajasida), qolganlari avvalgilar.
**Haqiqiy backend + alohida baza** (`hamyon_accept`, PG 17.6, API Release): `node scripts/e2e-acceptance.mjs <api>` — **ALL PASSED** (5 000 000 hamyon → xarajat 150 000 → 4 850 000, Kommunal +150 000, subkategoriya, transfer, valyutalararo transfer, kirim, qo'lda hamyonli kirim, tarix, o'nli aniqlik 3333.33, yetarli emas → rad, 3 marta bosish = 1 ta, tahrirlash = reversal+yangi, bekor qilish, ikkinchi reversal = replay, analitika, `/api/reconciliation` ok).
**Veb (haqiqiy backendga ulangan) skrinshotlar:** `design-reference/result/*.png` (dashboard, operatsiya oynasi, transfer, tarix).

**TEKSHIRILMAGAN (aniq):** haqiqiy Android qurilma/emulyatorda sinov o'tkazilmagan (adb/JDK/SDK yo'q). Sensorli long-press+pan, klaviatura va bottom sheet to'qnashuvi, Android blur ko'rinishi faqat kod va jest/veb darajasida. Yomon internet/offline — jest + fake serverda sinalgan, haqiqiy qurilmada emas. Tarix testi oyning 1-kunida (kecha oldingi oyga tushadi) beqaror bo'lishi mumkin. Dizayn: veb'da ochiq mavzuda ko'rildi; qorong'i mavzu kadr-kadr solishtirilmadi.
**Native o'zgarish:** yo'q (package.json/app.json/eas.json o'zgarmagan) → mavjud 1.0.0 APK'ga preview OTA mos. Production'ga hech narsa yuborilmagan.
### Ulanish diagnostikasi (telefon ↔ lokal server) — 2026-10-16
**Aniqlangan sabablar (PC tomonidan o'lchangan):**
1. **API ishlamayotgan edi:** `:5080` da hech narsa tinglamagan (faqat PostgreSQL 55433). Rejalashtirilgan vazifa `RaqamliHamyon-API` oxirgi marta 10:13 da ishlagan, natija `0xC000013A` (jarayon to'xtatilgan: sessiya/Ctrl+C turi). Aniq sabab (chiqish/qayta ishga tushirish) aniqlanmadi. Vazifa faqat "logon"da ishga tushadi, shuning uchun kirmasdan server ko'tarilmaydi.
2. **PC manzili o'zgargan:** hozir `192.168.1.5` (DHCP). `192.168.1.2` endi bu kompyuterniki emas (ulanishga urinish rad etildi). Telefondagi saqlangan server manzili `192.168.1.2` bo'lsa, shu o'zi ulanmaslik sababi.
3. Wi-Fi profili **Public**; `Raqamli Hamyon API` qoidasi faqat Private, lekin `Hamyon.Api.exe` uchun Public dasturiy qoidalar bor (Allow) — firewall to'siq emas ko'rinadi (PC ichidan tekshirilgan; boshqa qurilmadan tasdiqlanmagan).

**Hozirgi holat (tekshirilgan):** vazifa qayta ishga tushirildi; API `0.0.0.0:5080` da tinglaydi; `http://127.0.0.1:5080` va `http://192.168.1.5:5080` `/api/meta/client-policy` → 200; swagger 200; demo login 200, `hamyon_dev` ma'lumotlari saqlangan (6 hamyon, 12 toifa, 3 manba). PostgreSQL 55433 ishlayapti. Backend/ledger/ma'lumotlarga tegilmadi.
**Telefon uchun tekshiruv manzili:** `http://192.168.1.5:5080/api/meta/client-policy` (telefon brauzerida JSON chiqsa, tarmoq yo'li ishlaydi). Ilovada server manzili `http://192.168.1.5:5080` bo'lishi kerak. PC tomonida: `scripts/phone-link-check.ps1`.
**Preview APK:** `usesCleartextTraffic=true` (preview profili uchun `expo config` bilan tekshirildi) — http ruxsat.

**Ilovaga qo'shildi (JS):** "Server ulanishi" kartasi (login ekrani + Sozlamalar): joriy API URL, aniq tekshiruv URL, OTA updateId/kanal, "Ulanishni tekshirish" (ok / HTTP xato / tez rad / vaqt tugadi / noto'g'ri manzil — sababi bilan); serversiz sensor sinovi login ekranidan ochiladi ("Sensor (surish) diagnostikasi", API chaqirmaydi); kirimda hamyon ro'yxati yuklanmasa forma va tanlash sahifasida tushunarli xabar (URL bilan, "Qayta urinish"); offline bo'lsa keshdagi ro'yxat va ogohlantirish.
**Testlar:** jest 89/89 (oldin 78), tsc/eslint toza.
**Hali tekshirilmagan:** telefondan haqiqiy ulanish va sensorli surish (qurilma yo'q); router "client isolation"; server qayta ishga tushganda avtomatik ko'tarilishi (vazifa faqat logon'da).

### Qayta tekshiruv (sessiya davomi) — 2026-10-17
- Git: ish daraxti toza; lokal server skriptlari allaqachon commit qilingan (4805776), yangi o'zgarish yo'q.
- Server (haqiqiy o'lchov): `healthcheck.ps1` hammasi OK (PG 127.0.0.1:55433, `/health` ok, Users=2, ikkala task Running, zaxira 20261017). `/api/meta/client-policy` 200.
- **PC LAN manzili yana o'zgargan: `192.168.1.11`** (oldin .2, keyin .5). `192.168.1.5` endi javob bermaydi. Telefon ilovasida server manzili `http://192.168.1.11:5080` bo'lishi kerak. Router'da DHCP reservation hali qilinmagan — shu sabab manzil qayta-qayta o'zgaryapti.
- Mobil: tsc toza, jest 89/89. Kod ko'rib chiqildi (`src/dnd/DragDrop.tsx`: window-space koordinata, bir marta yaratiladigan gesture, cancel, auto-scroll; `GestureHandlerRootView` mavjud) — yangi nuqson topilmadi, kod o'zgartirilmadi.
- **HAQIQIY ANDROID SENSORLI SINOV O'TKAZILMADI** (adb/JDK/qurilma yo'q). Web/jest natijalari Android sensorli test o'rnini bosmaydi. Telefonda: Sozlamalar → "Sensor (surish) diagnostikasi", so'ng hamyon→toifa, hamyon→hamyon, manba→hamyon, kirimda hamyon tanlash.

### Drag & drop ishonchliligi + UI tartibi — 2026-10-17
**Aniq topilgan nuqsonlar (testda isbotlangan):**
1. Auto-scroll: `onScroll` kechikib kelgan eski offset'ni yozib, sahifani orqaga tortardi → surishda sahifa deyarli siljimasdi (eski kodda 10 px, yangi kodda >100 px; test `auto-scroll … lagging`). Zona rect'lari esa qo'lda siljitilib, haqiqiy joydan uzoqlashardi → `drop:null`. Tuzatish: surish davomida offset'ni faqat o'zimiz buyurgan qiymatdan olish; zonalar auto-scroll paytida va **drop oldidan** `measureInWindow` bilan qayta o'lchanadi.
2. Barmoq zonalar orasidagi oraliqqa tushsa `drop:null` bo'lardi → qabul qiladigan eng yaqin zona (≤14 px) hisobga olinadi.
3. `dx=0 dy=0` faqat `begin` paytida bir marta o'lchanardi (surish davomidagi siljishni ko'rsatmaydi). Endi har `move`da `maxDrift` hisoblanib, `finger` logida chiqadi; `end` logida aniq sabab: `drop` / `rejected` / `no-zone-under-finger` / `no-zones` + eng yaqin zona va masofa. Eslatma: haqiqiy qurilmada `dx=0 dy=0` chiqqani raw va window koordinatalar mos ekanini bildiradi — avvalgi "status bar siljishi" taxmini sabab emas edi (oyna-fazosi hisobi zararsiz qoldi).
4. Pastki menyu va davr tugmasida `Tap style={{flex:1}}` ichki Animated.View'ga tushib, bosiladigan Pressable kontent kengligicha torayib qolardi → `containerStyle` ga o'tkazildi, tab balandligi ≥48.
**Qo'shildi:** rad etilgan/xato drop'da ghost boshlang'ich joyiga qaytadi; takroriy `end` ikkinchi drop yaratmaydi; Dashboard `ScrollView` → RNGH `ScrollView` (uzoq bosish gesturesi bilan scroll to'qnashuvini gesture-handler hal qiladi — qurilmada tasdiqlanmagan).
**Dizayn:** hamyonlar 2 ustun (keng shisha kartochka: ikon + nom 2 qator + qoldiq), xarajat toifalari 3 ustun, kirim manbalari 5 ustun; nomlar 2 qatorga o'raladi (kesilmaydi); pastki bo'sh joy `insets.bottom` bilan.
**Diagnostika:** Sensor diagnostikasi (login ekrani, Sozlamalar, `/dnd-test`) faqat `__DEV__` da; release/preview APK'da ko'rinmaydi.
**Testlar:** tsc toza, eslint toza, expo-doctor 21/21, jest 97/97 (oldin 89; +8: chetdan tushirish, uzoq tushirish, qabul qiluvchi zona ustuvorligi, drop oldidan qayta o'lchash, takroriy end, rad etilganda qaytish, qayta urinish, log sababi, ustunlar; auto-scroll testi kechikkan scroll hodisalari bilan). `expo export --platform android` bundle muvaffaqiyatli. Native bog'liqlik o'zgarmadi.
**HAQIQIY ANDROID QURILMADA SINALMADI** (adb/JDK/qurilma yo'q; web brauzer ham bu sessiyada ishlatilmadi — vizual natija ko'rilmagan). OTA hali yuborilmagan.

### OTA → preview — 2026-10-17
Commit 83bcd0f, `eas update --channel preview` (runtime 1.0.0, android fingerprint 8874963d… = o'rnatilgan APK). Update group b9020e3c-686d-437c-8d22-1d3b3e6ac8f0, Android update ID 01a14a9c-c0af-7b05-98a8-2bc6d3c6ca7d. Production'ga tegilmadi. Telefonda tasdiqlanmagan.
