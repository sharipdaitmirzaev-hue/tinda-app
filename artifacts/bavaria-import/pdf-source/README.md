# Официальный PDF-буклет ГК «Бавария»

## Куда положить файл

Скопируйте буклет **ровно** в один из путей:

1. `artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf` ← предпочтительно
2. `artifacts/bavaria-import/pdf-source/БУКЛЕТ БАВАРИЯ 2026.pdf`
3. `/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf`

## Обязательная проверка после копирования

```bash
npm run import:bavaria:pdf-ingest
```

Скрипт проверит:

- файл существует;
- размер > 0;
- PDF открывается;
- число страниц = **40**;
- посчитает **SHA-256** и запишет в отчёт.

Затем:

```bash
npm run import:bavaria:pdf-review
```

## Важно

Без реального PDF **нельзя** завершать final-import и apply.  
Текстовый бриф не заменяет визуальный разбор страниц.
