# Raqamli Hamyon — server (hamyon.raqamlinazorat.uz)

Server: `raqamli-nazorat@192.168.1.10`, papka `~/apps/raqamli-hamyon/` (boshqa Raqamli ilovalar tartibida).

| Qism | Qayerda |
|---|---|
| API (.NET 10) | konteyner `hamyon_api` (rasm `raqamli-hamyon-api:1.0.0`), `web_network` + o‘z tarmog‘i |
| Baza | konteyner `hamyon_db` (postgres:16-alpine), volume `raqamli-hamyon_pgdata` |
| Maxfiy qiymatlar | faqat serverda: `~/apps/raqamli-hamyon/.env.docker` (600) — `POSTGRES_PASSWORD`, `JWT_SECRET`, `PUBLIC_URL` |
| nginx | `~/server-infra/nginx/conf.d/hamyon.conf` (nusxasi shu papkada) → `main_nginx` |
| Internet | Cloudflare Tunnel (`*.raqamlinazorat.uz`) → `main_nginx` → `hamyon_api:8080` |

Tekshirish: `https://hamyon.raqamlinazorat.uz/health` → `{"status":"ok"}` (2026-11-14).

## Yangilash (kod o‘zgarganda)
Kod Gitea'da: https://git.raqamlinazorat.uz/nursulton/raqamli-hamyon (serverda `~/apps/raqamli-hamyon/src`).
```bash
# kompyuterda: o'zgarishni yuklash
git push origin main
# serverda: bitta buyruq (baza zaxirasi + git + qayta yig'ish + tekshirish)
cd ~/apps/raqamli-hamyon && bash src/deploy/server/update.sh
```
Migratsiyalar API ishga tushganda o‘zi qo‘llanadi (`Database__AutoMigrate=true`). Zaxiralar: `~/backups/hamyon-*.dump`.

## Orqaga qaytarish
```bash
rm ~/server-infra/nginx/conf.d/hamyon.conf && docker exec main_nginx nginx -s reload
cd ~/apps/raqamli-hamyon && docker compose down        # baza volume saqlanadi; o‘chirish: down -v
```
