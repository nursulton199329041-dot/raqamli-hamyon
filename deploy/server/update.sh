#!/usr/bin/env bash
# Serverda Hamyon API'ni Gitea'dagi oxirgi kod bilan yangilash.
# Ishlatish:  cd ~/apps/raqamli-hamyon && bash src/deploy/server/update.sh
# Oldin bazaning zaxirasi olinadi; .env.docker va baza (volume) o'zgarmaydi.
set -euo pipefail
cd "$(dirname "$0")/../../.."          # ~/apps/raqamli-hamyon
BRANCH="${1:-main}"

echo "1. Baza zaxirasi..."
mkdir -p ~/backups
docker exec hamyon_db pg_dump -U hamyon -Fc hamyon > ~/backups/hamyon-$(date +%F-%H%M).dump

echo "2. Gitea'dan yangi kod ($BRANCH)..."
git -C src fetch origin
git -C src reset --hard "origin/$BRANCH"
git -C src log --oneline -1

echo "3. API'ni qayta yig'ish va ishga tushirish..."
docker compose --env-file .env.docker up -d --build api
docker image prune -f >/dev/null

echo "4. Tekshirish..."
for i in $(seq 1 20); do
  if docker exec hamyon_api wget -qO- http://localhost:8080/health >/dev/null 2>&1 || curl -fs https://hamyon.raqamlinazorat.uz/health >/dev/null; then
    echo "Tayyor: API ishlayapti."; exit 0
  fi
  sleep 3
done
echo "DIQQAT: API javob bermayapti — docker logs hamyon_api"; exit 1
