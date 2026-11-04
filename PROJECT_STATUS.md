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

### Liquid Glass: design tokenlar + bosh sahifa — 2026-10-27 (branch `feat/liquid-glass-home`)
- Audit: `docs/AUDIT-2026-10-27.md`. `dx=0 dy=0` xato emas (raw va window koordinata mos); RNGH Android `PanGestureHandler` translation'ni root hodisadan oladi — formula to'g'ri. `drop:null` ning isbotlangan sabablari 83bcd0f da tuzatilgan; telefonda hali tasdiqlanmagan.
- Yangi: `src/design/tokens.ts` (spacing, radius, typography, icon, elevation, motion, haptic, `useReducedMotion`), `src/design/States.tsx` (EmptyState, ErrorState, Skeleton, LoadingState), `src/features/BalanceSummary.tsx` (umumiy balans har valyuta alohida qatorda, asosiy valyuta birinchi; davr bo'yicha kirim/xarajat/sof o'zgarish `/api/analytics/summary` dan).
- Palitra: midnight navy + ko'k-binafsha, electric blue accent; light — off-white, nozik kulrang chegara. `CircleBadge` soyasi iOS'da kesilmaydi, Android'da elevation olib tashlandi. `Tap` Reduce Motion'ni hurmat qiladi. expo-blur `blurMethod="dimezisBlurViewSdk31Plus"` (eskirgan prop ogohlantirishi yo'qoldi). Glyph web'da `aria-hidden` (React DOM ogohlantirishi yo'qoldi).
- Bosh sahifa: yangi header (profil, nom, sinxron holati, sinxron, sozlamalar), balans kartasi + davr tanlash, kirim manbalari 4 ustun (oldin 5), hamyonlar 2, toifalar 3; matnlar ≥11.5 px; bo'sh hamyon → EmptyState + "Yangi hamyon yaratish"; yuklanishda skeleton; yuklanmasa ErrorState + qayta urinish. Tab bar: ikon 22, yozuv 11.5, balandlik 54.
- Tekshirildi: tsc toza, eslint toza, jest 101/101 (+3 BalanceSummary; grid testi 4 ustunga, qabul testi bo'sh holat tugmasiga moslandi), `expo export --platform android` OK. Web (400x860) haqiqiy lokal API + demo hisob: dark va light mode ko'rildi, toifani bosish → xarajat oynasi ochildi (saqlanmadi).
- TEKSHIRILMAGAN: haqiqiy Android/iOS qurilma; Android blur ko'rinishi; drag & drop bu bosqichda o'zgartirilmadi.

### PHASE 4 — Drag & drop engine — 2026-10-27 (branch `feat/liquid-glass-home`)
**Asl sabab (manba kodi bilan tasdiqlangan):** RN yangi arxitekturasida (Fabric) ScrollView ichidagi view uchun `measureInWindow` scroll offsetni shadow-tree **state**idan oladi (`ScrollViewShadowNode::getContentOriginOffset` → `stateData.contentOffset`), bu state esa native scroll'dan **asinxron** yangilanadi. 83bcd0f dagi "auto-scroll paytida va drop oldidan qayta o'lchash" shu sababli kechikkan koordinata berardi → zona haqiqiy joyidan pastda o'lchanib, drop `drop:null` bo'lardi (ayniqsa pastki qatorga auto-scroll bilan surilganda). `dx=0 dy=0` xato emas: raw touch va window fazosi mos (RNGH Android translation'ni root hodisasidan hisoblaydi). Mutatsiya tekshiruvi: eski "drop oldidan qayta o'lchash" qaytarilsa, yangi regression testi aynan `op=null` bilan yiqiladi.

**Yechim (`src/dnd/DragDrop.tsx`):**
- Zonalar drag BOSHLANGANDA (sahifa tinch) bir marta o'lchanadi + o'sha paytdagi scroll offset saqlanadi; drag davomida jonli joy = `y - (buyurilgan offset - o'lchangan offset)` — arifmetika, kechikadigan o'lchov yo'q. Scroller'siz zonalar dropda qayta o'lchanadi (eski xatti-harakat).
- Floating karta UI thread'da barmoq bilan yuradi (gesture worklet → shared value → animated style); hit-test va highlight JS'da.
- Grab nuqtasi = touch-down nuqtasi (`e.x - translationX`): long press paytida barmoq siljisa ikki marta qo'shilmaydi.
- Bir vaqtda bitta drag sessiyasi (UI thread'da `session` claim; `maxPointers(1)`); rad etilgan karta qaytayotganda sessiya darhol bo'shaydi.
- Ekran o'lchami o'zgarsa (aylantirish/split) drag bekor qilinadi, hech narsa ochilmaydi. Zona onLayout o'zgarsa, auto-scroll tinchigach qayta o'lchanadi.
- Overlay `zIndex/elevation 1000` — karta hech narsa ortida qolmaydi; karta = tile'ning aniq nusxasi (FloatingCard), lift scale + float soya, Reduce Motion'da animatsiyasiz.
- `useUi.openOp`: forma ochiq turganda ikkinchi ochilish e'tiborsiz → bitta gesture = bitta forma.

**Testlar (haqiqiy bajarilgan):** tsc toza, eslint toza, jest **112/112** (+11, `__tests__/dragEngine.test.tsx`: 350 ms/1 pointer, window-space karta, grab creep, bitta sessiya, ekran o'lchami, tez scroll'dan keyin drop, ROOT CAUSE kechikkan o'lchov, pastki qator max offsetda, forma ochiq paytida drop, openOp himoyasi, o'z joyiga qo'yilganda tap yo'q). Mavjud 26 drag testi o'zgarishsiz o'tdi. `expo export --platform android` OK.

**HAQIQIY ANDROID QURILMADA SINALMADI:** bu kompyuterda `adb`/Android SDK yo'q. Native o'zgarish yo'q (faqat JS) → mavjud 1.0.0 preview APK'ga OTA mos. OTA yuborilmadi (ruxsat kerak).

### OTA → preview (Phase 4) — 2026-10-27
- Tekshiruvlar: commit `b0012f1` (`feat/liquid-glass-home`); 83bcd0f'dan beri native fayllar (package.json/lock, app.json, app.config.js, eas.json) o'zgarmagan; lokal Android fingerprint `8874963d…` = preview APK `aa758bb7` (runtime 1.0.0). EAS'da faqat `preview` kanali bor (→ `preview` branch); production kanali yo'q va tegilmadi.
- `eas update --channel preview --environment preview --message "Phase 4: drag & drop engine"` (`--environment` non-interactive rejim uchun majburiy; oldingi preview OTA ham `preview` muhitida).
- Natija: update group `ff0e82fa-7be7-4d13-97fd-0e714ba455bf`; Android `01a17e1d-6fb0-75bf-9b2b-ebc0c711877c`, iOS `01a17e1d-6fb0-709d-af1e-773f31d9e9a7`; runtime 1.0.0; Android fingerprint `8874963d…` (APK bilan mos). EAS commit belgisi `b0012f1*` — `*` faqat kuzatilmagan (untracked) yordamchi papkalar sababli, kod commit bilan bir xil.
- Telefonda hali tasdiqlanmagan. Main'ga merge / push qilinmagan. Backend va ma'lumotlar bazasiga tegilmagan.

### Responsive UI (mobile / tablet / desktop) — 2026-10-27
**Asl sabablar:** (1) `Bars` qattiq `width={300}` — 320 px telefonda karta ichidagi ~256 px'ga sig'masdi, desktopda kichkina qolardi; (2) `Donut`dagi `<G rotation origin>` — react-native-svg web'da `origin`ni `transform-origin` DOM atributiga aylantiradi (`src/web/utils/prepare.ts:74`) → React "Invalid DOM property `transform-origin`"; (3) ekranlarda `maxWidth` yo'q edi — desktopda kontent va tab bar 1440+ px'ga cho'zilardi; (4) web'da `adjustsFontSizeToFit` ishlamaydi — tor kataklarda summalar kesilardi; (5) SVG `<text>` web'da serif shriftga tushardi.
**Yechim:** `src/design/layout.ts` (breakpointlar: mobile <768, tablet 768–1199, desktop ≥1200; `useWindowDimensions`), `TabScreen` kontentni markazlashtiradi (tablet 960, desktop 1180, Tarix 820, Sozlamalar 720), desktopda chap sidebar (`tabBarPosition: 'left'`), planshetda floating bar 560 px bilan cheklangan. `charts.tsx`: `ChartBox` (o'lchangan kenglik), sof geometriya `barsLayout`/`donutSlices` (arc path, rotation/origin yo'q), qiymat o'qi + gridline + siyraklashtirilgan sana yozuvlari, tizim shrifti. Analitika qayta tartiblandi (KPI grid, breakdown + trend yonma-yon, bo'sh/yuklanish holatlari). Bosh sahifa ustunlari breakpoint bo'yicha (manba 4/6/8, hamyon 2/3/4, toifa 3/5/6; <360 px manba 3); <400 px'da KPI qatorlari, bo'lim jami alohida qatorda, hamyon kartasi ikki qatorli; `fitMoney` uzun summalarni ixchamlaydi. Loyihalar/Qarzlar gridda.
**Tekshirildi:** tsc, eslint toza; jest **139/139** (+27 `responsive.test.tsx`); `expo export --platform android` OK. Haqiqiy brauzer (lokal API, demo hisob): 320/375/390/430/768/1024/1366/1440/1920 — gorizontal overflow 0, SVG kesilishi 0, donut va trend real ma'lumot bilan; 320 px'da kesilgan matn 0; dark va light; toza yuklashda konsolda React warning yo'q. Skrinshotlar: `design-reference/result/responsive/` (before-*/after-*).
**Bajarilmagan:** avtomatik screenshot-regression (Playwright) loyihaga qo'shilmagan — vizual tekshiruv brauzerda qo'lda + skript o'lchovlari bilan qilindi. Real telefon sinovi yo'q.

### Hisobotlar + UZ/RU/EN — 2026-10-27 (branch `feat/liquid-glass-home`)
**Commitlar:** `aa6b9a2` (responsive), `9e7ce2e` (backend hisobot agregatsiyasi), `d1e51a1` (Hisobot ekrani), `221e033` (to'liq i18n).
**Backend:** `GET /api/analytics/balance` (ledger qatorlaridan davr boshi/oxiri va har davr bo'yicha hamyon balansi, har valyuta alohida, >400 nuqta bo'lsa yirikroq davr), `GET /api/analytics/wallets` (hamyon bo'yicha boshlang'ich/yakuniy), barcha hisobot so'rovlarida `tz` (mijoz kalendari bo'yicha kun/hafta/oy; oldin UTC — Toshkentda kun chegarasi 5 soat siljigan edi), timeseries'da bo'sh davrlar 0 bilan, ota-toifa filtri podkategoriyalarni ham oladi, `+05:00` offsetli sanalar UTC'ga normallashtiriladi (oldin 500 xato), XLSX 5 varaq (Xulosa, Operatsiyalar, Toifalar, Hamyonlar, Filtrlar; freeze header, ustun kengligi, #,##0.00, SUMIFS), fayl nomi davr+filtrdan (`RaqamliHamyon_2026-10_Oylik_Xarajat_UZS.xlsx`), CORS `Content-Disposition` ochiq. Backend testlari **59/59**.
**Mobil:** Hisobot ekrani (Analitika o'rnida, funksiyalari saqlangan): 8 tur — Kirimlar, Xarajatlar, Kirim va xarajat, Sof pul oqimi, Balans tarixi, Hamyonlar, Toifalar (podkategoriyaga drill-down; manba/hamyon/loyiha bo'yicha taqsimot), Qarzlar. Gorizontal segmentlar sirpanuvchi ko'k pill bilan. Yagona filtr holati (kun/hafta/oy/yil/maxsus davr, hamyon, manba, toifa→podkategoriya, valyuta, loyiha) statistika, grafik, operatsiyalar ro'yxati va eksportni bir xil boshqaradi. Grafiklar: nice o'qlar (manfiy qiymatlar bilan), 320 px telefonda oyning 31 kuni sig'adi, line/area balans, musbat/manfiy sof oqim, bosish/surishda sana+qiymat+valyuta tooltip, bo'sh davrda EmptyState. Valyutalar hech qachon qo'shilmaydi (tanlangan valyuta, izoh bilan). Transfer va qarz kirim/xarajatga kirmaydi (backend summary qoidasi; ekranda izoh).
**I18n:** son/valyuta formati tilga bog'liq (uz/ru `1 234 567,50`, en `1,234,567.50`; ming/mln/mlrd · тыс./млн/млрд · K/M/B), sana (uz/ru `26.11.2026`, en `Nov 26, 2026`), ruscha oy nomi bosh kelishikda alohida turganda, server xato kodlari 3 tilga (noma'lum kod — server matni), qolgan qattiq matnlar (Icon/Color, yopish/yuklanish a11y, tarmoq xatolari) tarjima kalitlariga o'tkazildi, sidebar'da ilova nomi 2 qator. Foydalanuvchi kiritgan nomlar tarjima qilinmaydi. Til tanlovi saqlanadi va qayta ochilganda tiklanadi (testlangan).
**Testlar:** jest **170/170** (+31: reports 21, i18n 10), tsc/eslint toza, `expo export --platform android` OK. Brauzer (alohida preview API :5081 + yangi `hamyon_reports_preview` bazasi, demo seed; `hamyon_dev`ga tegilmadi): 8 hisobot turi real ma'lumot bilan, tooltip (12-okt: Xarajat 3 500 000 UZS), overflow 0, RU desktop 1440 va EN light 390 ko'rildi, eksport nomi va 5 varaq real API'dan tekshirildi.
**MUHIM — bajarilmagan:** yangi backend `D:\RaqamliHamyonLocal\api` ga **o'rnatilmagan** (lokal serverga ruxsatsiz tegilmadi). Eski serverda "Balans tarixi" va "Hamyonlar" hisobotlari bo'sh chiqadi, kun chegaralari UTC bo'yicha, bo'sh davrlar to'ldirilmaydi. Shu sababli bu versiyani OTA bilan telefonga yuborishdan oldin backend'ni yangilash kerak. Real telefon sinovi yo'q. Referens rasmlar suhbatga biriktirilmagan — UX topshiriq matni asosida qilindi. `hamyon_reports_preview` test bazasi qoldirildi (o'chirish mumkin).

### Backend lokal serverga o'rnatildi — 2026-10-28 00:09
- Kod: `eba29c4` (backend o'zgarishlari `9e7ce2e`). Data/Domain'da o'zgarish yo'q -> sxema/migratsiya o'zgarmadi.
- Zaxira (oldin): `backups\hamyon_dev-prechange-20261028-0008.dump` (pg_dump -Fc, 14 jadval ma'lumoti; "prechange" nomi avto-tozalashdan himoyalangan) va eski binarlar `backups\api-prechange-20261028-0008\` (40 fayl).
- Tartib: `dotnet publish -c Release` -> `api-new-20261028-0008\` (staging) -> `schtasks /end RaqamliHamyon-API-Supervisor` -> eski API jarayoni to'xtatildi -> robocopy (8 fayl yangilandi, 32 bir xil) -> `schtasks /run`. Uzilish ~40 s.
- Tekshirildi: /health 200 (~12 s), `/api/analytics/balance` (UZS yakuniy 38 293 700 = dashboard), `/api/analytics/wallets` (6), timeseries bo'sh kunlar bilan (31), eksport nomi `RaqamliHamyon_2026-10_Oylik_Xarajat_UZS.xlsx`; baza satrlari o'zgarmagan (users 2, wallets 6, journal 34, lines 70, balanslar yig'indisi 0); healthcheck hammasi OK.
- **PC LAN manzili yana o'zgargan: `192.168.1.8`** (telefonda server manzili `http://192.168.1.8:5080`). Router'da DHCP reservation hali qilinmagan.
- Orqaga qaytarish (kerak bo'lsa): task'ni to'xtatish -> `api-prechange-20261028-0008\` ni `api\` ga nusxalash -> task'ni ishga tushirish. Baza o'zgarmagani uchun dump'ni tiklash shart emas.
- Mobil Hisobot versiyasi hali OTA bilan yuborilmagan.

### OTA → preview (Hisobot + responsive + UZ/RU/EN) — 2026-10-28
- Tekshiruv: native fayllar 83bcd0f'dan beri o'zgarmagan; Android fingerprint `8874963d…` = preview APK; EAS'da faqat `preview` kanali (production yo'q, tegilmadi).
- `eas update --channel preview --environment preview` -> update group `31922e40-9de5-4ae1-95c7-9ff2999224d1`; Android `01a17eca-e720-7546-9225-b5e5bb3796d0`, iOS `01a17eca-e720-7860-a4cf-d33261d2b5aa`; runtime 1.0.0; commit `b42f38f` (`*` = faqat untracked yordamchi papkalar).
- Backend allaqachon lokal serverda (b42f38f bilan mos). Telefonda server manzili: `http://192.168.1.8:5080`. Telefonda hali tasdiqlanmagan.

### Parolni lokal serverda yangilash skripti — 2026-10-28
- `scripts/server/reset-password.ps1` (o'rnatilgan nusxa: `D:\RaqamliHamyonLocal\ops\reset-password.ps1`). Email va yangi parolni interaktiv so'raydi (parol ko'rinmaydi, 2 marta, 8-128 belgi), avval `backups\hamyon_dev-prechange-pwreset-<vaqt>.dump` zaxira oladi, so'ng bitta tranzaksiyada: hash (PBKDF2-SHA512, 210000, `v1.` formati — AuthService bilan bir xil), blokirovka tozalanadi, refresh tokenlar bekor qilinadi, `AuditLogs`ga `auth.password_reset`. Qiymatlar psql'ga stdin `\set` orqali (buyruq qatorida/faylda parol yoki hash qolmaydi); boshqa ma'lumotlarga tegmaydi.
- Sinov: zaxiradan ochilgan vaqtinchalik `hamyon_pwtest` bazasida — yangi parol bilan haqiqiy API (Release build) login 200, noto'g'ri parol 401, boshqa foydalanuvchi hash'i o'zgarmadi; noma'lum email va qisqa parolda hech narsa o'zgarmadi. Sinov bazasi o'chirildi. `hamyon_dev`da hali ishlatilmagan — foydalanuvchi o'zi ishga tushiradi.

### V4 — Minimal bosh sahifa + animatsiyali ikonlar + navigatsiya — 2026-10-28 (branch `feat/liquid-glass-home`)
**Bosh sahifa:** faqat 3 bo'lim — Kirim manbalari, Hamyonlar, Xarajat toifalari. Har biri BITTA gorizontal sirpanuvchi qator (dumaloq rangli ikon + nom + summa, oxirida "+"). Balans kartasi, KPI kartalar, loyiha/qarz bloklari, dekorativ orb'lar va drag maslahati olib tashlandi (`BalanceSummary.tsx` fayl sifatida qoldi, ishlatilmaydi). Ixcham header: avatar, ilova nomi, sinxron holati, qayta sinxron, sozlamalar; ostida davr chipi. Summa 13 belgigacha to'liq ko'rsatiladi (12–13 belgida shrift kichrayadi), undan uzuni ixchamlanadi (`22 mln UZS`) — kesilish yo'q.
**Navigatsiya:** pastki menyuda aniq 4 tab — Bosh, Tarix, Hisobot, Sozlamalar (`src/design/navItems.ts`). Sozlamalar alohida route'dan tab'ga o'tdi (`app/(tabs)/settings.tsx`). Loyihalar va Qarzlar menyudan olindi (`href: null`), lekin ekranlar, ma'lumotlar va API'lar o'zgarmagan — Sozlamalar → "Boshqa bo'limlar" orqali ochiladi. Bazadan hech narsa o'chirilmadi.
**Ikon animatsiyalari:** bosilganda scale, long-press'da ko'tarilish (floating ikon), drop zona ustida spring kattalashish + accent glow, muvaffaqiyatli drop'dan keyin bir martalik pulse (`lastDrop` signal), hamyon ikonlarida chuqurlik (pastki soya). Doimiy aylanuvchi animatsiya yo'q. OS "Reduce Motion" yoki Sozlamalardagi "Animatsiyalar: o'chiq" → harakat o'chadi (`useMotionOff`).
**Ko'rinish (Appearance Studio — yangi, oldin yo'q edi):** Tungi/Kunduzgi/Tizim; uslub Liquid Glass / Super Glass / Classic Office / Minimal / Colorful; ikon shakli (doira / yumaloq kvadrat), ikon o'lchami S/M/L, accent rang, shrift o'lchami, burchak radiusi, shisha effekti, animatsiyalar, 3 bo'lim tartibi (yuqoriga/pastga) va ko'rinishi, "standartga qaytarish". Saqlanadi va qayta ochilganda tiklanadi (`setting:app`, noma'lum qiymatlar standartga tushadi). Shrift o'lchami hozircha faqat bosh sahifa (bo'lim sarlavhalari, ikon yozuvlari) ga ta'sir qiladi.
**Drag & drop gorizontal qatorlarda:** engine bir nechta scroller'ni biladi (sahifa vertikal + har qator `axis:'x'`). Zonalar qator offsetini drag boshida o'lchaydi, jonli pozitsiya arifmetik hisoblanadi (Fabric `measureInWindow` kechikishi muammosi qatorda ham qaytmaydi — test 60 px kechikish bilan; qator siljishi olib tashlansa test yiqiladi). Qator chetida (48 px) gorizontal auto-scroll. Drag paytida qatorlar native scroll qilmaydi (`scrollEnabled=false`) — swipe va long-press to'qnashmaydi. Kirim→Hamyon, Hamyon→Hamyon, Hamyon→Xarajat testlangan.
**Tekshirildi:** tsc, eslint toza; jest **180/180** (16 suite; yangi `home.test.tsx` 10 test); `expo export --platform android` OK. Brauzer 390×844, lokal API real ma'lumot: 3 qator, gorizontal overflow 0, matn kesilishi 0, 4 tab; UZ/EN, dark/light, Colorful+squircle+L ko'rinishi ko'rildi.
**Bajarilmagan:** real Android telefonda sinalmadi (drag'ni barmoq bilan, haqiqiy Reduce Motion, past quvvatli qurilma unumdorligi). OTA yuborilmadi, push/merge qilinmadi. Backend va PostgreSQL'ga tegilmadi.

### OTA → preview (V4) — 2026-10-28
- Tekshiruv: native fayllar 83bcd0f'dan beri o'zgarmagan; Android fingerprint `8874963d…` = preview APK; EAS'da faqat `preview` kanali (production yo'q, tegilmadi).
- `eas update --channel preview --environment preview` -> update group `490391b6-b9ad-4a59-9f58-7d891a54aa46`; Android `01a17f16-6a72-7cde-ad4f-2ca3f05d43ac`, iOS `01a17f16-6a72-7616-a8f6-ac3803ba9aa3`; runtime 1.0.0; commit `e6e35e6` (`*` = faqat untracked yordamchi papkalar).
- Telefonda hali tasdiqlanmagan. Push/merge qilinmagan; backend va bazaga tegilmagan.

### V5 backend: profillar + valyutali xarajat — 2026-10-28 (lokal serverga o'rnatildi)
**Profillar:** `Profiles` jadvali; moliyaviy jadvallarga (Wallets, LedgerAccounts, JournalEntries, LedgerLines, Categories, IncomeSources, People, Projects, Debts, Attachments) `ProfileId`. Har so'rov profili `X-Profile-Id` sarlavhasidan (aks holda akkauntning birinchi faol profili) aniqlanadi va EF global query filter orqali barcha so'rovlarga qo'llanadi; yangi qatorlarga avtomatik yoziladi (profil aniqlanmagan yozuv — xato). Begona/arxivlangan/noto'g'ri profil sarlavhasi → 404. Endpointlar: `GET/POST /api/profiles`, `PATCH /api/profiles/{id}` (revision bilan optimistic concurrency → `409 conflict.stale`; oxirgi faol profilni arxivlab bo'lmaydi). Yangi profil o'z standart toifa/manbalari bilan yaratiladi. Akkauntni o'chirish barcha profillarni o'chiradi. Hisob-kitob hisoblari (equity, FX clearing) profil bo'yicha (unique indeks `UserId, ProfileId, Kind, RefId, Currency`).
**Valyutali xarajat:** `ExpenseRequest` + `ToCurrency`, `ToAmount` yoki `FxRate`, `RateDate`, `RateSource` (standart `manual`). Masalan, 12 USD × 12 000 → 144 000 UZS: hamyon −12 USD, toifa +144 000 UZS, har valyuta o'z FX clearing hisobida muvozanatda. Yaxlitlash transfer bilan bir xil: kurs berilsa summa maqsad valyuta aniqligiga half-away-from-zero; summa berilsa kurs 8 xona. Saqlangan kurs qayta hisoblanmaydi (reversal ham shu kursni ko'chiradi). Analitika/byudjet/breakdown valyutali xarajatni xarajat valyutasida hisoblaydi. Idempotency fingerprint eski so'rovlar uchun o'zgarmagan (yangi maydonlar faqat bor bo'lsa qo'shiladi).
**Migratsiya `20261028000000_Profiles`** (0002_profiles.sql): faqat qo'shadi; har userga "Asosiy" profil, barcha qatorlar unga o'tkaziladi, keyin NOT NULL. Down yo'q — orqaga qaytish faqat dump orqali.
**Testlar:** backend **67/67** (+8: bir akkauntda 2 profil izolatsiyasi, boshqa akkaunt profili/ID'lari 404, revision konflikti, USD→UZS xarajat + hisobot UZS'da + idempotent replay + key reuse 409 + reversal, kurs/summa yaxlitlash, noto'g'ri FX so'rovlari, offline sync replay profil ichida). Mutatsiya: query filter olib tashlansa 2 izolatsiya testi yiqiladi.
**O'rnatish tartibi:** (1) zaxira `backups\hamyon_dev-prechange-v5-trial-20261028-1007.dump` → nusxa baza `hamyon_v5_trial`; yangi API (Release, 5082-port) nusxada migratsiya qildi; pul ma'lumotlari fingerprinti (jadval sonlari, hisob balanslari, ledger qatorlari, yozuvlar, qarzlar md5) oldin/keyin **bir xil**; har userda bitta profil, egasi mos kelmaydigan qator 0; demo hisob uchun eski API (5080) va yangi API (5082) javoblari (hamyonlar, summary, breakdown, operatsiyalar soni, qarzlar, reconciliation) **bir xil**. Nusxa baza o'chirildi. (2) API to'xtatildi → yakuniy zaxira `backups\hamyon_dev-prechange-v5-20261028-1009.dump` + eski binarlar `backups\api-prechange-v5-20261028-1009\` (40 fayl) → yangi binarlar → supervisor ishga tushirildi → `hamyon_dev`da avto-migratsiya. Fingerprint oldin/keyin **bir xil**, healthcheck OK, LAN `http://192.168.1.3:5080` OK.
**Orqaga qaytarish:** supervisor'ni to'xtatish → `api-prechange-v5-20261028-1009\` ni `api\` ga → `pg_restore --clean` bilan `hamyon_dev-prechange-v5-20261028-1009.dump` → supervisor'ni ishga tushirish.
**Mobil:** hali o'zgarmagan — joriy ilova sarlavha yubormaydi, "Asosiy" profilda avvalgidek ishlaydi. Profile Switcher va valyutali xarajat formasi keyingi bosqich. Real telefonda sinalmagan.

### V6 Phase 3 — deploy va OTA → preview — 2026-10-28
- **Lokal server:** yangi backend (`7db0e25`) `D:\RaqamliHamyonLocal\api` ga o'rnatildi. Tartib: zaxira → sinov bazasida 5082-portda sinov (ikki telefonli e2e o'tdi) → sinov bazasi o'chirildi → server to'xtatildi → oxirgi zaxira `backups\hamyon_dev-prechange-v6p3-20261028-1533.dump` va eski fayllar `backups\api-prechange-v6p3-20261028-1533\` → yangi fayllar → supervisor qayta ishga tushdi. Migratsiya yo'q. Baza nazorat yig'indisi oldin/keyin bir xil (`748b702d…`), `/health` 200, LAN `192.168.1.3:5080` 200.
- **Orqaga qaytarish:** supervisor'ni to'xtatish → `backups\api-prechange-v6p3-20261028-1533\` → `api\` → supervisor'ni ishga tushirish.
- **OTA:** `eas update --channel preview --environment preview`; update group `e6254728-a12f-49c8-9a02-dc40290d5c01`, Android `01a18216-8b84-7930-b2e1-d89e6739d0a3`, iOS `01a18216-8b84-7a25-b36c-f5585cdc3c2b`; runtime 1.0.0; Android fingerprint `8874963d…` = preview APK. Production'ga tegilmadi.
- Telefonda "Offline-first (beta)" kaliti standart **o'chiq**. Real telefonda **NOT TESTED**.
### V6 Phase 4 — deploy va OTA → preview — 2026-10-29
- **Lokal server:** yangi backend (`8a79186`: Google bilan kirish API, mehmon profilini yuklash, `openedAt`) `D:\RaqamliHamyonLocal\api` ga o'rnatildi. Tartib: zaxira → sinov bazasi `hamyon_v6p4_trial`da 5082-portda sinov (2 ta E2E o'tdi, jumladan mehmon → akkaunt bog'lash) → sinov bazasi o'chirildi → server to'xtatildi → oxirgi zaxira `backups\hamyon_dev-prechange-v6p4-20261029-1051.dump`, eski fayllar `backups\api-prechange-v6p4-20261029-1051\` → yangi fayllar → supervisor qayta ishga tushdi. Migratsiya yo'q. Baza nazorat yig'indisi oldin/keyin bir xil (`e5787ede…`), `/health` 200, LAN `192.168.1.3:5080` 200, `/api/auth/google` → 503 (Google client ID'lar sozlanmagan — kutilgan).
- **Orqaga qaytarish:** supervisor'ni to'xtatish → `backups\api-prechange-v6p4-20261029-1051\` → `api\` → supervisor'ni ishga tushirish.
- **OTA:** `eas update --channel preview --environment preview`; update group `a3c03f6c-56fc-4dc4-b979-38ba866ddc33`, Android `01a1863a-ea66-72fb-bdb8-165a26b73ecb`, iOS `01a1863a-ea66-7cef-8498-dd6f343dd1da`; runtime 1.0.0; Android fingerprint `8874963d…` = preview APK. Production'ga tegilmadi.
- Telefonda: kirish oynasida "Lokal hisob bilan boshlash"; Sozlamalar → "Akkauntga ulash". Real telefonda **NOT TESTED**.

### Hisobot: xarajatlar toifalar bo'yicha — OTA → preview — 2026-10-30
- `c06c637`: Hisobot → Xarajatlar → "Operatsiyalar · Toifalar bo'yicha": har toifa bir marta (categoryId bo'yicha, podkategoriya parent ichida), soni, ulushi, jami; bosilganda operatsiyalar ochiladi, operatsiya bosilganda tafsilot oynasi. Backend o'zgarmagan.
- **OTA:** update group `d66d27c3-6f49-4dc8-89e3-36f1b26b4f6d`, Android `01a18cbb-51e4-7c48-bfb6-bef76307d96f`, iOS `01a18cbb-51e4-7ab9-9dc6-1eb12600c2db`; runtime 1.0.0; Android fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda **NOT TESTED**.


### Bosh ekran: Profillar oynasi, yangilash tugmasi — OTA → preview — 2026-11-04
- `2df2730`: avatar sozlamalar o'rniga Profillar oynasini ochadi (bitta avtomatik profil bo'lsa — yangi profil formasi); avatar va yangilash bitta tugmada; bosh ekrandagi sozlamalar tugmasi olib tashlandi; sozlamalar ikoni tishli g'ildirak. Backend o'zgarmadi.
- **OTA:** update group `6749da00-df32-480e-882f-95cd1f51c6de`, Android `01a1a750-ad99-7d10-a77f-394144b484ce`, iOS `01a1a750-ad99-76e1-8b0e-7f7200f6e23b`; runtime 1.0.0; Android fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED.
- `3e4a8bd`: Profillar oynasining pastida doimiy «+ Yangi profil» tugmasi. **OTA:** update group `6e59114e-15d6-4e6c-8d42-8509b16cbc1b`, Android `01a1a762-6220-744c-b2db-103ddae73d23`, iOS `01a1a762-6220-7220-ac02-56fbb8c902dc`; fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED.
- **2026-11-04: PC LAN manzili yana o'zgargan: `192.168.1.6`** (oldin `.8`). Telefonda «Нет связи с сервером» chiqishining ehtimoliy sababi; telefonda server manzili `http://192.168.1.6:5080` bo'lishi kerak. Router'da DHCP reservation hali qilinmagan (`docs/ops/LOCAL_SERVER.md` §6).
- `d5689bb`: internetsiz profillar ro'yxati. **OTA:** update group `d6def4a6-5a1b-40e1-983c-d8494d907795`, Android `01a1a76a-705d-7171-8ca1-34572d42b6a9`, iOS `01a1a76a-705d-7aee-ab11-4dbf32bb44bb`; fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED.

### Valyutali xarajat formasi — 2026-11-04
- Profil valyutasidan boshqa valyutadagi hamyondan xarajat: hamyondan o'z valyutasi yechiladi, toifaga profil valyutasidagi summa yoziladi; ikkinchi summa kuni bo'yicha Markaziy bank kursidan (`cbu.uz`), bo'lmasa oxirgi kursdan olinadi, qo'lda o'zgartirsa bo'ladi; kurs topilmasa summa so'raladi. Tarixda ikkala summa va kurs. O'tkazmadagi oxirgi kursni avtomatik qo'yish xatosi ham tuzatildi. Backend o'zgarmadi. Real telefonda: NOT TESTED.
- `1c1288c` **OTA → preview:** update group `6e0edf68-44c3-4814-8d7c-62b5504f4b3f`, Android `01a1a788-f74c-73fd-91a2-2c0aa565933e`, iOS `01a1a788-f74c-7597-94c5-ade58152e96f`; fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED.
- `5128540`: tarix va hisobot ro'yxatida aylantirilgan xarajat so'mda, ostida hamyon valyutasi. **OTA → preview:** update group `7ae1be31-6fee-4e23-8c2e-59c5edcca96a`, Android `01a1a790-ea2e-70f5-a5d4-59bf7dac5faf`, iOS `01a1a790-ea2e-7dca-aba6-97651479d6f3`; fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED.
- Kurs tartibi: saqlash tarmoqni kutmaydi. Kunning Markaziy bank kursi fonda so'raladi; hali kelmagan bo'lsa telefonda saqlangan oxirgi rasmiy kurs, u ham bo'lmasa tarixdagi oxirgi kurs ishlatiladi; hech biri bo'lmasa summa qo'lda kiritiladi. Yangi kurs keyingi operatsiyalarga qo'llanadi. Real telefonda: NOT TESTED.
- `1ac8a52` (kursni kutmasdan saqlash), `355b762` (yangilash tugmasi: tortish spinneri alohida, bir vaqtda bitta yangilash). **OTA → preview:** update group `752d768d-6f6b-4bfd-a5da-00c7ad0692b8`, Android `01a1a79c-747b-7ac0-8b9d-0548390c2044`, iOS `01a1a79c-747b-7614-8de2-43c40e60e826`; fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED (qotish kompyuterda takrorlanmagan).
- **2026-11-04 tuzatildi:** dollar asosli profilda so'm hamyondan xarajat dollarga aylanib yozilardi (forma profil valyutasini ishlatgan). Endi asosiy valyuta doim UZS. `hamyon_dev` da 1 ta noto'g'ri yozuv qoldi: 10 000 UZS → 0,84 USD; o'zgartirilmadi, tahrirlab saqlash yoki bekor qilish foydalanuvchida.
- `5ece3c8`, `eb49263` **OTA → preview:** update group `1869f7be-2399-486f-9de7-9f81c08d2898`, Android `01a1a7a8-a6a8-70f1-9ffc-6472f08c2b76`, iOS `01a1a7a8-a6a8-7498-ba8f-fca07d012b29`; fingerprint `8874963d…` = preview APK. Production'ga tegilmadi. Real telefonda: NOT TESTED.
