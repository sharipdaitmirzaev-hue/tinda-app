# Импорт производителя «Дарьял»

Отдельный pipeline (как Bavaria), **не** универсальный импортёр.

## Stage 1 (этот PR)

1. Source scout → `SOURCE-SCOUT-REPORT.md`
2. `npm run import:daryal:discover` → `latest-discover/`
3. `npm run import:daryal:dry-run` → `latest-dry-run/` (22 ready / 2 manual)
4. **Apply не реализован** и в production не запускался

## Scope

- ✅ Газированные, Аква Дарьял, Фрутимикс (manual без объёма)
- ❌ Живое пиво `/beer/`
- ❌ Изменения БД

## Next

Human review → optional PDF → gated apply (create-only / showcase / backup flags).
