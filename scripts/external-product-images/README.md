# Внешние фотографии товаров ТИНДА

Система **подготовки** замены изображений из внешних источников.

## Жёсткие ограничения

- Production **не** менять этими скриптами.
- На VPS **не** скачивать и **не** загружать.
- `products.image_url` **не** обновлять до отдельного согласованного apply.
- Автоматически готовить только `exact_match`.

## Приоритет источников

1. Официальный сайт производителя / бренда (`source_priority: 1`)
2. Официальный каталог дистрибьютора (`2`)
3. Крупные магазины (`3`)
4. Прочее — только после ручной проверки (`4`)

## Формат кандидатов

Файл JSON (массив), пример: `scripts/external-product-images/candidates.example.json`

```json
[
  {
    "source_site": "brand.example",
    "source_product_url": "https://brand.example/products/cola-05",
    "candidate_image_url": "https://cdn.brand.example/cola-05.png",
    "source_name": "Cola Classic 0,5 л ПЭТ",
    "source_brand": "Cola",
    "source_volume": "0,5 л",
    "source_package": "ПЭТ",
    "source_flavor": "classic",
    "source_sku": null,
    "source_priority": 1
  }
]
```

Список URL источников: `scripts/external-product-images/sources.example.json` — парсер страниц добавляется отдельно под каждый сайт.

## 1. Собрать review Excel

```bash
# из локальной БД
npm run external-images:review -- \
  --candidates scripts/external-product-images/candidates.example.json

# или из выгрузки товаров
npm run external-images:review -- \
  --products scripts/external-product-images/products.example.json \
  --candidates scripts/external-product-images/candidates.example.json \
  --delay-ms 400 \
  --skip-probe
```

Результат:

- `data/imports/external_product_images_review.xlsx`
- `data/imports/external_product_images_review.report.json`

Листы: Точные совпадения / Требует проверки / Не найдено / Конфликты / Инструкция.

## 2. Ручная проверка

В Excel для точных совпадений выставить:

- `review_status = approved` — можно скачивать локально
- `rejected` — пропустить
- оставить `needs_review` / `pending` — не скачивать

Не approve при водяном знаке, ценнике, баннере, коллаже, неверном объёме/упаковке.

## 3. Локальное скачивание (после confirm)

```bash
npm run external-images:download -- \
  --review data/imports/external_product_images_review.xlsx \
  --status approved \
  --delay-ms 700
```

Файлы: `data/imports/external-product-images/{SKU}.original.{ext}`

Остановка при CAPTCHA / 403 / 429.

## 4. Локальная обработка (staging)

```bash
npm run external-images:prepare
```

Использует `src/lib/storage/product-images.ts`:

- EXIF rotate
- удаление метаданных (через перекодирование WebP)
- max 1600 px
- WebP
- ключ `products/{product_id}/{uuid}.webp`

Пишет `staging/apply-plan.json` **без** записи в БД.

## 5. Production apply (позже, отдельно)

Только после явного согласования:

1. `pg_dump` backup
2. сохранить список старых `image_url`
3. upload через storage driver
4. обновить БД только после успеха
5. удалить старый managed-файл
6. при ошибке оставить старое изображение

Этот шаг **не** входит в текущие скрипты.

## Статусы сопоставления

| status | смысл |
|---|---|
| exact_match | бренд + объём + упаковка + вкус/имя; готов к ручному confirm |
| probable_match | похоже, нужна ручная проверка |
| conflict | несколько кандидатов / один URL на разные SKU |
| no_match | не найдено |

## Приоритет замены

1. нет фото  
2. текущее не открывается  
3. текущее низкого качества  
4. текущее с внешнего CDN  
5. найдено официальное фото бренда  

Хорошее собственное `/uploads/products/...` не заменять худшим кандидатом.
