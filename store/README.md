# Raqamli Hamyon — Play Market va App Store uchun materiallar

## Asosiy ma'lumotlar

| | |
|---|---|
| Ilova nomi | **Raqamli Hamyon** |
| Paket nomi (Android, SKU) | **uz.raqamlinazorat.hamyon** |
| Bundle ID (iOS) | **uz.raqamlinazorat.hamyon** |
| Versiya | 1.0.0 |
| Toifa | Moliya (Finance) |
| Yosh chegarasi | 3+ / Hamma uchun (reklama, xarid, chat yo'q) |
| Narxi | Bepul |

## Fayllar

| Fayl | Qayerga | O'lcham |
|---|---|---|
| `play/icon-512.png` | Play: Ilova rasmi (App icon) | 512×512, alfa kanalsiz |
| `play/banner-1024x500.png` | Play: Banner (Feature graphic) | 1024×500 |
| `play/screenshot-1..5.png` | Play: Telefon skrinshotlari | 1080×1920 |
| `appstore/icon-1024.png` | App Store ikonkasi (build ichida ham bor) | 1024×1024, alfa kanalsiz |
| `appstore/screenshot-6.9in-1..5.png` | App Store: iPhone 6.9" skrinshotlari | 1320×2868 |

Skrinshotlarni qayta olish: `node src/capture.mjs raw/shots <email> <parol>` (lokal server va `npm run web -- --port 8080` yoniq bo'lishi kerak), keyin `node src/render.mjs`.

---

## Play Market matnlari

**Ilova nomi** (30 belgigacha):
Raqamli Hamyon

**Qisqa tavsif** (80 belgigacha):
Hamyonlar, kirim, xarajat va qarzlarni bir joyda nazorat qiling.

**To'liq tavsif:**

Raqamli Hamyon — shaxsiy pulingizni oson va chiroyli boshqarish uchun ilova. Naqd pul, bank kartasi, dollar jamg'arma — barcha hamyonlaringiz bitta ekranda.

NIMALAR QILA OLASIZ
• Hamyonlar: naqd, karta, jamg'arma — har biri o'z valyutasida (so'm, dollar va boshqalar).
• Kirim va xarajat: kalkulyator bilan bir zumda yozing, toifa va sanani tanlang.
• O'tkazmalar: hamyonlar orasida pul o'tkazing, valyuta kursi bilan ham.
• Qarzlar: kimga berdingiz, kimdan oldingiz — hammasi yodda.
• Tarix: har bir operatsiya kunma-kun, qidiruv va filtr bilan.
• Hisobotlar: xarajatlar toifalar bo'yicha, diagrammalar, oylik va yillik tahlil.
• Profillar: shaxsiy va oilaviy byudjetni alohida yuriting.

CHIROYLI VA QULAY
• Zamonaviy qorong'i dizayn, kunduzgi rejim ham bor.
• Asosiy rangni o'zingiz tanlaysiz: tilla, kumush, granat va boshqalar.
• O'zbek, rus va ingliz tillarida.

XAVFSIZ
• Ro'yxatdan o'tish shart emas.
• Ma'lumotlaringiz faqat sizning telefoningizda saqlanadi, hech qayerga yuborilmaydi.
• Reklama yo'q.

Raqamli Hamyon bilan pulingiz doim nazoratda.

---

## App Store matnlari

**Name** (30): Raqamli Hamyon
**Subtitle** (30): Pulingiz — to'liq nazoratda
**Promotional text** (170): Hamyonlar, kirim, xarajat va qarzlar bir joyda. Ro'yxatdan o'tmasdan boshlang — ma'lumotlar faqat telefoningizda.
**Keywords** (100): hamyon,xarajat,byudjet,pul,kirim,qarz,moliya,hisob,budget,wallet,expense
**Description:** Play Market'dagi to'liq tavsif bilan bir xil.
**Support URL / Privacy Policy URL:** `privacy-policy.md` matnini istalgan saytga (masalan, GitHub Pages yoki Google Sites) joylab, manzilini kiriting — ikkala do'kon ham talab qiladi.

### Maxfiylik so'rovnomasi (ikkala do'kon uchun)
- Data Safety (Play) / App Privacy (Apple): **ma'lumot yig'ilmaydi** (Data Not Collected). Hamma yozuvlar qurilmada saqlanadi.
- Shifrlash: faqat standart HTTPS (ilovada `ITSAppUsesNonExemptEncryption = false` allaqachon belgilangan).

---

## Yangilanishlar — ikkala do'konga birdaniga

`mobile/` papkasida:

```bash
npm run release:update -- "Nima o'zgardi"
```
JS/dizayn o'zgarishlari Android va iPhone'ga bir vaqtda, do'kon tekshiruvisiz yetib boradi (`production` kanali, ikkala platforma).

Yangi native versiya (paket qo'shilganda, versiya oshganda):

```bash
npm run release:build
```
```bash
npm run release:submit
```
`release:build` ikkala platforma uchun build qiladi (.aab va .ipa), `release:submit` ularni Play Console (internal test, draft) va App Store Connect'ga yuboradi.
