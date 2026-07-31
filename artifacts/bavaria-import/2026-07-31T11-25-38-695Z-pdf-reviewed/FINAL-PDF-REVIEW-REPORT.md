# FINAL-PDF-REVIEW-REPORT — импорт «Баварии»

Дата: 2026-07-31T11:25:38.700662+00:00
PR: **#18** (ветка `cursor/import-bavaria-nonalcoholic-f733`)
Этап: **pdf/site review → approved manifest** (production/БД не изменялись, apply не запускался)

## Источники

| Источник | Статус |
|----------|--------|
| https://www.bavaria-group.ru | использован (`discovered.json` dry-run) |
| `/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf` | **НЕ НАЙДЕН в среде агента** |
| Бриф содержимого буклета из ТЗ PR №18 | использован как `pdf-brief` с пометками |

> Визуальный просмотр страниц PDF не выполнен (файл отсутствует в `/mnt/data`).  
> Все позиции, требующие иконки вкус×тара из буклета, оставлены в **manual-review**.

## Итоги

| Метрика | Значение |
|---------|----------|
| Approved SKU | **125** |
| Manual review | **24** |
| Rejected | **9** |
| Wholesale (кеги) | **2** |
| Безалкогольное пиво (approved) | **3** |
| Безалкогольное пиво (manual) | **4** |
| Identity collisions (approved) | **0** |
| SKU collisions (approved) | **0** |

## Категории approved

- Газированные напитки: 61
- Питьевая вода: 33
- Холодный чай: 15
- Квас: 4
- Тоники: 4
- Безалкогольное пиво: 3
- Минеральная вода: 3
- Энергетические напитки: 2


## Подтверждения по ключевым спорным позициям

### Безалкогольное пиво
- **Светлое**: APPROVED стекло 0,45 + банка 0,45 (сайт: 0,5% об.; буклет-бриф: страница NA).
- **Elf**: APPROVED стекло 0,45 (сайт). Банка 0,45 — MANUAL до визуала PDF.
- **Gallagher NA**: MANUAL (бриф PDF подтверждает 0% + стекло/банка 0,45; без файла PDF не утверждаем). Алкогольная карточка сайта — REJECT как источник NA.
- **Nordisch Bier NA**: MANUAL (объём 0,45 по брифу; банка/стекло не подтверждены).

### Вкусы / фасовки / тара
- **Premium**: утверждены только комбинации из текста сайта (стекло 0,5 и ПЭТ 1,2). Виноград / Апельсин×1,2 — MANUAL.
- **Обычные газированные**: утверждены ПЭТ 1,5 и ПЭТ 0,5 по сайту (включая Кола). Стекло 0,45 × вкусы — MANUAL.
- **Лимнада**: 1,5 — 4 вкуса; 0,5 — без Ананас. Ананас 0,5 — REJECT.
- **Ретро (Чайка / Огоньки / Тайга)**: APPROVED с уникальными SKU (коллизия dry-run устранена).
- **Dreamix Toniс**: APPROVED Indian Tonik / Bitter Lemon. Неподписанные вкусы Dreamix soda — MANUAL.
- **Rocket Ride**: вкусы подтверждены, фасовки нет — MANUAL.
- **Добрецовъ**: retail ПЭТ/банка APPROVED по сайту; кеги 30/50 — wholesale only. Расхождение PDF 1,2 vs сайт 1,4 зафиксировано.
- **Аварал**: APPROVED как питьевая вода стекло 0,45.
- **Айва**: APPROVED только негазированная 0,5 стекло/ПЭТ; газированные варианты dry-run — REJECT.
- **Cola Limited Edition (СТМ)**: APPROVED как безалкогольная газировка; фасовки с карточек.
- **SWIPE**: исправлен баг 33 л → 0,33 л стекло.

## Ограничения (соблюдены)

- PR №2 (TINDA Image Downloader) **не затрагивался**
- Production / БД **не изменялись**
- `apply` **не запускался**
- catalog-normalize / `--merge` **не использовались**

## Файлы

Каталог: `artifacts/bavaria-import/2026-07-31T11-25-38-695Z-pdf-reviewed/`

- approved-products.csv
- manual-review.csv
- rejected-products.csv
- wholesale-packaging-review.csv
- pdf-evidence.csv
- packaging-matrix.csv
- nonalcoholic-beer-evidence.csv
- image-to-sku-audit.csv
- approved-import-manifest.json
- FINAL-PDF-REVIEW-REPORT.md

## Следующий шаг

1. Приложить файл `БУКЛЕТ БАВАРИЯ 2026.pdf` в `/mnt/data/` (или `artifacts/bavaria-import/pdf-source/`).
2. Повторить визуальный проход стр. безалкогольного пива и матриц вкус×тара → перевести MANUAL→APPROVED.
3. Только после явного разрешения: backup БД и `import:bavaria:apply`.

## Связь с предыдущим pdf-reviewed прогоном

Ранее на ветке уже был прогон `artifacts/bavaria-import/2026-07-31T11-19-01Z-pdf-reviewed/` (104 approved; Gallagher/Elf-can утверждены по брифу PDF без файла).

Текущий каталог **заменяет его как актуальный approved manifest** с более строгим правилом:
утверждать вкус×тару/NA без визуала PDF нельзя. Поэтому Gallagher NA и банка Elf остались в manual-review до монтирования буклета.
SWIPE 33 л и другие явные ошибки dry-run отклонены; Ретро/Мохито АБ/недостающие site-SKU добавлены.

