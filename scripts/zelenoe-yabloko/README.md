# Черновик: Зелёное яблоко → ТИНДА

Источник: https://zelenoeyabloko.ru/catalog/gazirovannye-napitki

## Ограничения

- Production / БД ТИНДА **не** менять
- Цены ТИНДА **не** брать с сайта (`source_price_reference` только справочно)
- Фото на VPS **не** загружать
- `image_url` **не** заменять автоматически
- Новые товары **не** импортировать сразу
- `review_status` в Excel = `pending` (вручную `approved` / `rejected`)

## 1. Собрать candidates

```bash
npm run zy:scrape-candidates
```

→ `data/imports/zelenoe_yabloko_gazirovannye_candidates.json`

## 2. Pipeline внешних изображений

```bash
npm run external-images:review -- \
  --products data/imports/tinda_active_products.snapshot.json \
  --candidates data/imports/zelenoe_yabloko_gazirovannye_candidates.json \
  --out data/imports/zelenoe_yabloko_gazirovannye_images_review.xlsx
```

Листы: Точные совпадения / Требует проверки / Новые товары / Конфликты / Не найдено / Инструкция.

## 3. Файл на ручное одобрение

```bash
npm run zy:build-approval
```

→ `data/imports/zelenoe_yabloko_gazirovannye_images_approval.xlsx`  
Только `exact_match` + `recommended_approve`, `review_status=pending`.

После ручной отметки `approved`:

```bash
npm run external-images:download -- \
  --review data/imports/zelenoe_yabloko_gazirovannye_images_approval.xlsx \
  --status approved

npm run external-images:prepare -- \
  --review data/imports/zelenoe_yabloko_gazirovannye_images_approval.xlsx
```

Staging WebP: `data/imports/external-product-images/staging/`

## После ручного подтверждения

Скачивание фото — только локально через `npm run external-images:download` (не на VPS).

## Локальный архив всех candidates

```bash
npm run zelenoe-images:download-all
npm run zelenoe-images:gallery
npm run zelenoe-images:serve
```

Открыть: http://127.0.0.1:8765/gallery.html

Авто-проверка:

```bash
npm run zelenoe-images:auto-review
```

Обновляет `review-decisions.json` / `.xlsx` (без production).

В галерее:
- выбрать `approved_existing` / `approved_new` / `needs_review` / `rejected` / `pending`
- фильтры: Одобрено автоматически / Требует ручной проверки / Отклонено / Новые / Существующие
- **Сохранить решения** → JSON + Excel

Без approval.xlsx, без staging, без production.

## Apply 9 existing images (production)

После staging `approved_existing`:

1. Backup БД → `/var/backups/tinda/tinda-pre-zelenoe-existing-images-YYYYMMDDTHHMMSSZ.dump`
2. Dry-run / apply внутри `app-app-1` (local product-images storage → `/uploads/products/{id}/{uuid}.webp`):

```bash
node scripts/zelenoe-yabloko/apply-existing-images.mjs \
  --plan data/imports/zelenoe-yabloko-images/existing-image-update-plan.json \
  --staging data/imports/zelenoe-yabloko-images/staging-existing \
  --dry-run

node scripts/zelenoe-yabloko/apply-existing-images.mjs \
  --plan ... --staging ... --apply \
  --report-json data/imports/zelenoe-yabloko-images/existing-image-apply-report.json
```

Меняется **только** `image_url`. 26 новых товаров не импортируются. Старые внешние URL физически не удаляются.

После записи новых файлов в volume может потребоваться `docker restart app-app-1` (Next.js подхватывает `public/uploads` при старте).

## Вода питьевая / минеральная (локальный сбор)

Категории на сайте:
- https://zelenoeyabloko.ru/catalog/voda-gazirovannaia
- https://zelenoeyabloko.ru/catalog/voda-negazirovannaia

Отдельного раздела «минеральная» нет — минеральные SKU внутри этих двух.

```bash
npm run zy:scrape-water
npm run external-images:review -- \
  --products data/imports/tinda_active_products.snapshot.json \
  --candidates data/imports/zelenoe-yabloko-water/candidates.flat.json \
  --out data/imports/zelenoe-yabloko-water/images-review.xlsx --skip-probe
npm run zelenoe-images:download-all -- \
  --candidates data/imports/zelenoe-yabloko-water/candidates.json \
  --review data/imports/zelenoe-yabloko-water/images-review.xlsx \
  --out-dir data/imports/zelenoe-yabloko-water
npm run zelenoe-images:gallery -- \
  --out-dir data/imports/zelenoe-yabloko-water \
  --candidates data/imports/zelenoe-yabloko-water/candidates.json \
  --review data/imports/zelenoe-yabloko-water/images-review.xlsx
npm run zelenoe-images:auto-review -- --root data/imports/zelenoe-yabloko-water
```

Артефакты: `data/imports/zelenoe-yabloko-water/` (candidates, original/, previews/, manifest, gallery, review-decisions). Production не менять.

## Энергетические напитки (локальный сбор)

Категория: https://zelenoeyabloko.ru/catalog/energeticeskie-napitki

```bash
npm run zy:scrape-energy
npm run external-images:review -- \
  --products data/imports/tinda_active_products.snapshot.json \
  --candidates data/imports/zelenoe-yabloko-energy/candidates.flat.json \
  --out data/imports/zelenoe-yabloko-energy/images-review.xlsx --skip-probe
npm run zelenoe-images:download-all -- \
  --candidates data/imports/zelenoe-yabloko-energy/candidates.json \
  --review data/imports/zelenoe-yabloko-energy/images-review.xlsx \
  --out-dir data/imports/zelenoe-yabloko-energy
npm run zelenoe-images:gallery -- \
  --out-dir data/imports/zelenoe-yabloko-energy \
  --candidates data/imports/zelenoe-yabloko-energy/candidates.json \
  --review data/imports/zelenoe-yabloko-energy/images-review.xlsx
npm run zelenoe-images:auto-review -- --root data/imports/zelenoe-yabloko-energy --category energy
```

Артефакты: `data/imports/zelenoe-yabloko-energy/`. Production / VPS / БД не менять.

## Соки, нектары, морсы (локальный сбор)

Категории:
- https://zelenoeyabloko.ru/catalog/soki-nektary-morsy (`category_id=45`)
- https://zelenoeyabloko.ru/catalog/voda-soki (`category_id=135`, детские — только juice-like)

```bash
npm run zy:scrape-juice
npm run external-images:review -- \
  --products data/imports/tinda_active_products.snapshot.json \
  --candidates data/imports/zelenoe-yabloko-juice/candidates.flat.json \
  --out data/imports/zelenoe-yabloko-juice/images-review.xlsx --skip-probe
npm run zelenoe-images:download-all -- \
  --candidates data/imports/zelenoe-yabloko-juice/candidates.json \
  --review data/imports/zelenoe-yabloko-juice/images-review.xlsx \
  --out-dir data/imports/zelenoe-yabloko-juice
npm run zelenoe-images:gallery -- \
  --out-dir data/imports/zelenoe-yabloko-juice \
  --candidates data/imports/zelenoe-yabloko-juice/candidates.json \
  --review data/imports/zelenoe-yabloko-juice/images-review.xlsx
npm run zelenoe-images:auto-review -- --root data/imports/zelenoe-yabloko-juice --category juice
```

Артефакты: `data/imports/zelenoe-yabloko-juice/`. Production / VPS / БД не менять.

Source: `data/imports/zelenoe-yabloko-images/approved-new-products.xlsx` (JSON parity used in container).

```bash
node scripts/zelenoe-yabloko/import-new-products.mjs --source .../approved-new-products.json --preview
node scripts/zelenoe-yabloko/import-new-products.mjs --source .../approved-new-products.json --apply
```

Creates showcase products only (`price=NULL`, `on_order`, `units_per_package=1`). Images via local product-images storage. `package_requires_review` has no DB column — SKU list is in the apply report.

