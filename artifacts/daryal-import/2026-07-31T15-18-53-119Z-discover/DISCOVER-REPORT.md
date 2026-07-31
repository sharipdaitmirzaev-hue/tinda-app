# Daryal discover report

**When:** 2026-07-31T15:18:55.073Z  
**Scope:** non-alcoholic only  
**Output:** `artifacts/daryal-import/2026-07-31T15-18-53-119Z-discover`

## Sources
- Официальный сайт ООО ВПБЗ «Дарьял»: https://darialgroup.ru
- Сладкие газированные напитки: https://darialgroup.ru/sparkling/
- Питьевая вода «Аква Дарьял»: https://darialgroup.ru/water/
- Негазированные / сокосодержащие (Фрутимикс): https://darialgroup.ru/negazirovannye-napitki/
- Живое пиво (исключается из импорта): https://darialgroup.ru/beer/
- PDF-каталог / прайс производителя (если будет предоставлен): (local PDF optional)

## Counts
| Metric | Value |
|--------|------:|
| Pages fetched | 3 |
| Unique variants | **24** |
| Complete (volume+package) | **22** |
| Incomplete | **2** |
| Alcoholic excluded (beer names) | 13 |
| Manual gaps | 2 |

## By line
| Line | Count |
|------|------:|
| gazirovannye | 16 |
| water | 6 |
| juice_still | 2 |

## Manual gaps
- **sparkling**: flavor_in_html_comment_only — «Грейпфрут-малина» встречается в HTML-комментарии на /sparkling/
- **still-juice**: missing_volume_package — Фрутимикс: вкусы есть, объём/тара не опубликованы на странице

## Next
```bash
npm run import:daryal:dry-run -- --from artifacts/daryal-import/2026-07-31T15-18-53-119Z-discover
```
