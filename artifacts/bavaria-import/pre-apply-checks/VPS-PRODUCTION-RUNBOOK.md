# VPS Production Runbook — Bavaria import (PR #18)

**Не выполнять, пока оператор явно не подтвердит запуск на VPS.**  
Этот документ — только подготовка. Cloud-агент **не** меняет production.

| | |
|--|--|
| PR | https://github.com/sharipdaitmirzaev-hue/tinda-app/pull/18 |
| Branch | `cursor/import-bavaria-nonalcoholic-f733` |
| Manifest | `artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json` |
| Approved SKUs | **164** (manual/rejected/wholesale **не** импортировать) |
| PDF SHA-256 | `e93756ed45acecb1335e562aa4f9d455899c0b846fb9bb1bc6b3f33af436da93` |
| Working directory | `/opt/tinda/app` |

> Если проект клонирован в другой путь — замените `APP_DIR` ниже.

---

## 0. Обязательные переменные окружения

Нужны в shell **до** backup/apply (значения **не** печатать):

| Переменная | Обязательна для | Примечание |
|------------|-----------------|------------|
| `DATABASE_URL` | backup, apply, post-check | Postgres production. Query `?schema=public` допустим для Prisma; для `pg_dump` URL нужно очистить (см. ниже). |
| `SESSION_SECRET` | lint/app (не для apply) | Уже должен быть в `.env` приложения |
| `APP_URL` | app | Например `https://tindamarket.ru` |
| `STORAGE_DRIVER` | apply (картинки) | Обычно `local` на VPS; иначе задайте `STORAGE_*` для S3 |

Проверка без утечки секрета:

```bash
test -n "${DATABASE_URL:-}" && echo "DATABASE_URL=SET (len=${#DATABASE_URL})" || echo "DATABASE_URL=MISSING"
```

---

## 1. Checkout ветки PR №18

```bash
export APP_DIR=/opt/tinda/app
cd "$APP_DIR"

git fetch origin cursor/import-bavaria-nonalcoholic-f733
git checkout cursor/import-bavaria-nonalcoholic-f733
git pull --ff-only origin cursor/import-bavaria-nonalcoholic-f733
git rev-parse --short HEAD
git status -sb

# Manifest must exist
test -f artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json && echo "MANIFEST=OK"
```

---

## 2. Зависимости

```bash
cd "$APP_DIR"
npm ci
npx prisma generate
```

---

## 3. Load env (без печати секретов)

```bash
cd "$APP_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a

test -n "${DATABASE_URL:-}" || { echo "FATAL: DATABASE_URL missing"; exit 2; }
echo "DATABASE_URL=SET (len=${#DATABASE_URL})"
```

---

## 4. Read-only preflight

```bash
cd "$APP_DIR"
npm run import:bavaria:preflight
# ожидается exit 0 при issues=[] и DATABASE_URL=set
# exit 3 = manifest OK, но DATABASE_URL unset
```

Ожидания preflight:

- approved **164**, NA beer **7**
- нет SKU collisions
- PDF SHA совпадает с `e93756ed…436da93`
- forbidden manual SKUs отсутствуют

---

## 5. Backup production + проверка + SHA-256

`pg_dump` **не** принимает `?schema=public` — очистите query:

```bash
cd "$APP_DIR"
mkdir -p backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
export BACKUP_PATH="backups/tinda-prod-bavaria-${STAMP}.sql"

PGURL=$(python3 - <<'PY'
import os
from urllib.parse import urlparse, urlunparse
u = urlparse(os.environ["DATABASE_URL"])
print(urlunparse((u.scheme, u.netloc, u.path, "", "", "")))
PY
)

pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP_PATH"

# checks
test -f "$BACKUP_PATH" || { echo "FATAL: backup missing"; exit 2; }
test -s "$BACKUP_PATH" || { echo "FATAL: backup empty"; exit 2; }
head -n 3 "$BACKUP_PATH" | grep -Eiq 'PostgreSQL|pg_dump|--' || {
  echo "FATAL: backup does not look like a PostgreSQL dump"; exit 2;
}

BACKUP_SHA=$(sha256sum "$BACKUP_PATH" | awk '{print $1}')
echo "$BACKUP_SHA  $BACKUP_PATH" | tee "${BACKUP_PATH}.sha256"
echo "BACKUP_PATH=$BACKUP_PATH"
echo "BACKUP_BYTES=$(wc -c < "$BACKUP_PATH")"
echo "BACKUP_SHA256=$BACKUP_SHA"
```

**Не продолжайте**, если backup пустой / нечитаемый.

---

## 6. Apply (только create-only, с защитными флагами)

Категория (внутри apply):

1. Найти «Солодовый напиток» **или** «Солодовые напитки» (`solodovye-napitki`).
2. Перечислить товары в категории (на production сейчас Barbican ×7) — **поля товаров не меняются**.
3. Rename: name → `Безалкогольное пиво`, slug → `non-alcoholic-beer`, **тот же UUID**.
4. При конфликте name/slug — **стоп**.
5. 7 новых Bavaria NA beer SKU → `category_id` этой категории.
6. Без `--merge`; существующие SKU skip.

```bash
cd "$APP_DIR"

npm run import:bavaria:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP_PATH" \
  --manifest="artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json"
```

Ожидание:

- `created_count` ≈ 164 (минус уже существующие Bavaria SKU, если есть)
- `error_count` = 0
- `existing_products_edited` = false
- `category_renamed.to_slug` = `non-alcoholic-beer`
- `non_alcoholic_beer_created` = 7 (или меньше, если часть уже была)

Артефакты: `artifacts/bavaria-import/<stamp>-apply/`  
(`apply-result.json`, `APPLY-REPORT.md`, `na-beer-category-*.json`)

---

## 7. Post-apply verification

```bash
cd "$APP_DIR"
APPLY_DIR=$(readlink -f artifacts/bavaria-import/latest-apply 2>/dev/null || ls -td artifacts/bavaria-import/*-apply | head -1)
echo "APPLY_DIR=$APPLY_DIR"
python3 - <<'PY'
import json, os
from pathlib import Path
# prefer newest apply dir from env or glob
cands = sorted(Path("artifacts/bavaria-import").glob("*-apply"), reverse=True)
p = cands[0] / "apply-result.json"
d = json.loads(p.read_text())
print("file", p)
print("created", d.get("created_count"), "skipped", d.get("skipped_count"), "errors", d.get("error_count"))
print("edited_existing", d.get("existing_products_edited"))
print("na_beer_created", d.get("non_alcoholic_beer_created"))
print("category_renamed", d.get("category_renamed"))
print("catalog_total_after", d.get("catalog_total_after"))
assert d.get("error_count") == 0, "errors present"
assert d.get("existing_products_edited") is False, "existing products were edited"
PY

# Prisma spot-checks (no secret echo)
npx tsx <<'TS'
import { PrismaClient } from "@prisma/client";
async function main() {
  const p = new PrismaClient();
  const cat = await p.categories.findUnique({ where: { slug: "non-alcoholic-beer" } });
  if (!cat || cat.name !== "Безалкогольное пиво") {
    throw new Error(`NA beer category missing/wrong: ${JSON.stringify(cat)}`);
  }
  const legacy = await p.categories.findUnique({ where: { slug: "bezalkogolnoe-pivo" } });
  if (legacy) throw new Error("legacy slug bezalkogolnoe-pivo must not exist");
  const old = await p.categories.findFirst({
    where: { OR: [{ slug: "solodovye-napitki" }, { name: "Солодовые напитки" }, { name: "Солодовый напиток" }] },
  });
  if (old) throw new Error("source malt category name/slug still present after rename");

  const bavaria = await p.products.count({ where: { sku: { startsWith: "BAVARIA-" } } });
  const na = await p.products.count({
    where: { category_id: cat.id, sku: { startsWith: "BAVARIA-" } },
  });
  const manual = await p.products.count({
    where: {
      sku: {
        in: [
          "BAVARIA-BAVARIYA-NORDISCH-NA-450-GLASS",
          "BAVARIA-BAVARIYA-APELSIN-450-GLASS",
          "BAVARIA-BAVARIYA-KOLA-450-GLASS",
          "BAVARIA-BAVARIYA-YABLOKO-450-GLASS",
          "BAVARIA-TBAU-SPORT-MANUAL",
        ],
      },
    },
  });
  const priced = await p.products.count({
    where: { sku: { startsWith: "BAVARIA-" }, price_amount: { not: null } },
  });
  const orderable = await p.products.count({
    where: { sku: { startsWith: "BAVARIA-" }, sales_status: "orderable" },
  });
  console.log({
    category_id: cat.id,
    bavaria_total: bavaria,
    bavaria_in_na_beer: na,
    manual_leaked: manual,
    bavaria_with_price: priced,
    bavaria_orderable: orderable,
    catalog_total: await p.products.count(),
  });
  if (manual !== 0) throw new Error("manual SKUs leaked into DB");
  if (priced !== 0) throw new Error("Bavaria products have prices");
  if (orderable !== 0) throw new Error("Bavaria products are orderable");
  if (na !== 7) throw new Error(`expected 7 Bavaria NA beer in category, got ${na}`);
  await p.$disconnect();
}
main();
TS
```

Публичная проверка (опционально):

```bash
curl -sS 'https://tindamarket.ru/api/v1/catalog/products?q=BAVARIA&page_size=5' | head -c 400; echo
curl -sS 'https://tindamarket.ru/api/v1/health'; echo
```

---

## 8. Повторный apply (идемпотентность) / «0 новых»

Повторный apply должен показать **0 created / 164 skipped** (или skipped = числу уже импортированных):

```bash
cd "$APP_DIR"
STAMP2=$(date -u +%Y%m%d-%H%M%S)
BACKUP2="backups/tinda-prod-bavaria-idempotent-${STAMP2}.sql"
PGURL=$(python3 - <<'PY'
import os
from urllib.parse import urlparse, urlunparse
u = urlparse(os.environ["DATABASE_URL"])
print(urlunparse((u.scheme, u.netloc, u.path, "", "", "")))
PY
)
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP2"

npm run import:bavaria:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP2" \
  --manifest="artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json"
```

Ожидание: `created_count=0`, `existing_products_edited=false`.

> Полный website `dry-run` (crawl bavaria-group.ru) **не** требуется для идемпотентности импорта; используйте повторный `apply` как выше.

---

## 9. Rollback

При необходимости откатить **всю** БД к pre-apply dump:

```bash
cd "$APP_DIR"
# STOP app first (example for compose stack)
# docker compose -f docker-compose.production.yml stop app

PGURL=$(python3 - <<'PY'
import os
from urllib.parse import urlparse, urlunparse
u = urlparse(os.environ["DATABASE_URL"])
print(urlunparse((u.scheme, u.netloc, u.path, "", "", "")))
PY
)

# WARNING: destructive full restore
psql "$PGURL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$PGURL" -v ON_ERROR_STOP=1 -f "$BACKUP_PATH"

# docker compose -f docker-compose.production.yml start app
curl -sS https://tindamarket.ru/api/v1/health; echo
```

Проверка SHA перед rollback:

```bash
sha256sum -c "${BACKUP_PATH}.sha256"
```

---

## 10. lint / typecheck / test / build

На VPS (с `DATABASE_URL` для integration tests):

```bash
cd "$APP_DIR"
npm run lint
npm run typecheck
npm test
npm run build
```

---

## Копипаст: минимальный блок «backup → apply»

```bash
export APP_DIR=/opt/tinda/app
cd "$APP_DIR"
git fetch origin cursor/import-bavaria-nonalcoholic-f733
git checkout cursor/import-bavaria-nonalcoholic-f733
git pull --ff-only origin cursor/import-bavaria-nonalcoholic-f733
npm ci && npx prisma generate
set -a && source .env && set +a
test -n "${DATABASE_URL:-}" && echo "DATABASE_URL=SET (len=${#DATABASE_URL})" || exit 2
npm run import:bavaria:preflight

mkdir -p backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
export BACKUP_PATH="backups/tinda-prod-bavaria-${STAMP}.sql"
PGURL=$(python3 - <<'PY'
import os
from urllib.parse import urlparse, urlunparse
u = urlparse(os.environ["DATABASE_URL"])
print(urlunparse((u.scheme, u.netloc, u.path, "", "", "")))
PY
)
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP_PATH"
test -s "$BACKUP_PATH"
sha256sum "$BACKUP_PATH" | tee "${BACKUP_PATH}.sha256"

npm run import:bavaria:apply -- \
  --i-understand-and-have-backup \
  --backup-path="$BACKUP_PATH" \
  --manifest="artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json"
```

---

## Запрещено

- `--merge`
- импорт manual / rejected / wholesale
- передача `DATABASE_URL` в чат / логи в открытом виде
- создание второй категории «Безалкогольное пиво»
- изменение полей существующих товаров (цены, категории SKU, названия) без отдельного подтверждения

## Примечание по категории

На production сейчас:

- name: **Солодовые напитки**
- slug: `solodovye-napitki`
- уже есть товары Barbican (≈7)

Apply переименует **эту** категорию (ID сохранится) в:

- name: **Безалкогольное пиво**
- slug: `non-alcoholic-beer`

Barbican останутся в той же `category_id` (строки products не обновляются).  
7 новых Bavaria NA beer SKU будут созданы с этим же `category_id`.
