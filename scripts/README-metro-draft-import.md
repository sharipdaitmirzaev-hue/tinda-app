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

## Поздняя загрузка изображений

```bash
bash data/imports/metro_gazirovannye_napitki.download-images.sh
```

Фото сохраняются локально в `data/imports/metro-images/` и **не** загружаются в storage ТИНДА.
