# Черновик импорта каталога METRO → ТИНДА

Скрипт **не пишет в production БД**. Собирает товары со страницы поиска METRO
и формирует Excel для ручной проверки.

## Запуск

```bash
npm run import:metro-gazirovannye-draft
# или
node scripts/metro-gazirovannye-draft.mjs
```

Опционально:

```bash
METRO_DELAY_MS=2500 METRO_STORE_ID=10 node scripts/metro-gazirovannye-draft.mjs
```

## Результат

- `data/imports/metro_gazirovannye_napitki.xlsx` — черновик для staff
- `data/imports/metro_gazirovannye_napitki.json` — тот же набор в JSON
- `data/imports/metro_gazirovannye_napitki.report.json` — статистика прогона
- `data/imports/metro_gazirovannye_napitki.download-images.sh` — команда **поздней** загрузки фото (не вызывается автоматически)

`metro_price` — только справочное поле. `price_amount` намеренно пустой.

## Очистка / review

```bash
npm run import:metro-cleanup-review
```

Создаёт:

- `metro_gazirovannye_napitki_review.xlsx`
- `metro_undefined_package_material.xlsx`
- `metro_test_batch_50.xlsx`
- `metro_cleanup_report.md`

Не пишет в БД и не скачивает фото на диск.
