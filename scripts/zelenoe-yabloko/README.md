# Черновик: Зелёное яблоко → ТИНДА

Источник: https://zelenoeyabloko.ru/catalog/gazirovannye-napitki

## Ограничения

- Production / БД ТИНДА **не** менять
- Цены ТИНДА **не** брать с сайта (`source_price_reference` только справочно)
- Фото на VPS **не** загружать
- `image_url` **не** заменять автоматически
- Новые товары **не** импортировать сразу

## Запуск

```bash
# snapshot каталога ТИНДА (read-only) уже в data/imports/tinda_active_products.snapshot.json
npm run zy:gazirovannye-review
```

Результат:

- `data/imports/zelenoe_yabloko_gazirovannye_review.xlsx`
- `data/imports/zelenoe_yabloko_gazirovannye_review.report.json`
- `data/imports/zelenoe_yabloko_gazirovannye_candidates.json`

## После ручного подтверждения

Скачивание фото — только локально, через общий pipeline `external-product-images` (не на VPS).
