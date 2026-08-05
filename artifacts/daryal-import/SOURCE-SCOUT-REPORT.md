# Дарьял — source scout / inception

**Date:** 2026-07-31  
**Branch:** `cursor/import-daryal-ad60`  
**Manufacturer:** ООО ВПБЗ «Дарьял» (Владикавказ)  
**Official site:** https://darialgroup.ru  

---

## Scope (stage 1)

| In | Out |
|----|-----|
| Сладкие газированные напитки `/sparkling/` | Живое пиво `/beer/` (alcohol) |
| Питьевая вода «Аква Дарьял» `/water/` | Restaurant / bowling / news |
| Негазированные «Фрутимикс» `/negazirovannye-napitki/` | Production DB writes / apply |

Policy mirrors Bavaria non-alcoholic import: **create-only later**, `showcase`, `price_amount=null`.  
**Apply is not implemented yet.**

---

## Site shape

- Bitrix CMS, age gate banner (content still public in HTML)
- **No individual product URLs** — assortments listed on category pages
- Sitemap has 21 URLs; product lines: `/beer/`, `/sparkling/`, `/water/` (+ `/negazirovannye-napitki/` linked but thin)

### Observed non-alcoholic matrix (from live HTML)

**Газированные (`/sparkling/`) — 16 complete variants**
- Стекло 0,5 л: Кола-апельсин, Апельсин-кориандр, Тархун, Груша, Фейхоа-Шелковица, Мохито, Гранат  
- ПЭТ 0,5 л: Кола-апельсин, Апельсин, Тархун, Груша, Мохито  
- ПЭТ 1,5 л: Кола-апельсин, Апельсин, Тархун, Груша  
- «Грейпфрут-малина» только в HTML-комментарии → **не импортируем** без подтверждения  

**Вода (`/water/`) — 6 complete variants**
- Аква Дарьял негазированная: стекло 0,5 / ПЭТ 0,5 / ПЭТ 1,5  
- Аква Дарьял газированная: стекло 0,5 / ПЭТ 0,5 / ПЭТ 1,5  

**Фрутимикс (`/negazirovannye-napitki/`) — 2 incomplete**
- Мультифрукт, Красный апельсин — **объём/тара не указаны** → manual review  

**First dry-run:** **22 proposed ready**, **2 manual**, alcohol beer inventoried as excluded.

**Gaps**
- «Холодный чай» упомянут на `/products/`, отдельной страницы в sitemap нет  
- «Сокосодержащие» в меню ведут на sparkling anchor / thin still page  

---

## SKU convention

```
DARYAL-<BRAND>-<PRODUCT>-<VOLUME_ML>-<PACKAGE>
```

Examples:
- `DARYAL-DARYAL-TARHUN-500-GLASS`
- `DARYAL-AKVA-DARYAL-NEGATSIROVANNAYA-500-PET`

---

## Commands

```bash
npm run import:daryal:discover
npm run import:daryal:dry-run
# apply — blocked in stage 1
```

Artifacts: `artifacts/daryal-import/`

---

## Scope decisions (answered 2026-08-05)

1. **Только безалкогольное** — да; пиво/алкоголь/неясный статус исключены.  
2. **PDF/прайс/фотосъёмки** — нет; только darialgroup.ru; сторонние источники без согласования — нет.  
3. **Холодный чай / прочие линии** — только если сайт подтверждает полный SKU; иначе gaps/manual.  
4. **Фрутимикс** — обе позиции manual; объём/тару не додумывать; в approved не включать.

Stage 2: `npm run import:daryal:stage2` → `latest-stage2/` (22 approved + images). Production apply не выполнялся.
