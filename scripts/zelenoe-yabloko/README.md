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

В галерее:
- выбрать `approved_existing` / `approved_new` / `rejected` / `pending`
- **Сохранить решения** → `review-decisions.json` + `review-decisions.xlsx`
- фильтры по match_status и статусу решения

Без approval.xlsx, без staging, без production.
