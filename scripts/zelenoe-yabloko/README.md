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

## После ручного подтверждения

Скачивание фото — только локально через `npm run external-images:download` (не на VPS).
