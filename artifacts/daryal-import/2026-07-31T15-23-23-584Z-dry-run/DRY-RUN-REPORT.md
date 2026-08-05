# Daryal dry-run report

**When:** 2026-07-31T15:23:23.584Z  
**From discover:** `artifacts/daryal-import/seed-discover`  
**Output:** `artifacts/daryal-import/2026-07-31T15-23-23-584Z-dry-run`

## Policy
- create-only, showcase, `price_amount=null`
- alcohol excluded
- **apply not implemented yet** (stage 1)

## Counts
| Metric | Value |
|--------|------:|
| Proposed ready | **22** |
| Manual review | **2** |
| Alcohol skipped | 13 |
| TINDA catalog size | 0 |

## Category mix (ready)
- Газированные напитки: 16
- Минеральная вода: 6

## Sample SKUs
- `DARYAL-DARYAL-KOLA-APELSIN-500-GLASS` — Дарьял Кола-апельсин газированная, 0,5 л, стекло
- `DARYAL-DARYAL-APELSIN-KORIANDR-500-GLASS` — Дарьял Апельсин-кориандр газированная, 0,5 л, стекло
- `DARYAL-DARYAL-TARHUN-500-GLASS` — Дарьял Тархун газированная, 0,5 л, стекло
- `DARYAL-DARYAL-GRUSHA-500-GLASS` — Дарьял Груша газированная, 0,5 л, стекло
- `DARYAL-DARYAL-FEYHOA-SHELKOVITSA-500-GLASS` — Дарьял Фейхоа-Шелковица газированная, 0,5 л, стекло
- `DARYAL-DARYAL-MOHITO-500-GLASS` — Дарьял Мохито газированная, 0,5 л, стекло
- `DARYAL-DARYAL-GRANAT-500-GLASS` — Дарьял Гранат газированная, 0,5 л, стекло
- `DARYAL-DARYAL-KOLA-APELSIN-500-PET` — Дарьял Кола-апельсин газированная, 0,5 л, ПЭТ
- `DARYAL-DARYAL-APELSIN-500-PET` — Дарьял Апельсин газированная, 0,5 л, ПЭТ
- `DARYAL-DARYAL-TARHUN-500-PET` — Дарьял Тархун газированная, 0,5 л, ПЭТ
- `DARYAL-DARYAL-GRUSHA-500-PET` — Дарьял Груша газированная, 0,5 л, ПЭТ
- `DARYAL-DARYAL-MOHITO-500-PET` — Дарьял Мохито газированная, 0,5 л, ПЭТ

## Blockers before apply
1. Human review of proposed + manual CSVs
2. Optional PDF catalog (if manufacturer provides)
3. Confirm cold-tea / other lines missing from site
4. Implement gated `apply` (backup flags, create-only) — **not in this stage**
