# Импорт производителя ИРИБ

Источник: только https://irib.su/  
Производитель: ООО «ИРИБ».

## Stage 1

```bash
npm run import:irib:stage1
```

## Stage 2 final

```bash
python3 scripts/irib-stage2-final.py
```

Latest stage1: `latest-stage1/`  
Latest final: `latest-final/` → `2026-08-05T14-12-48-411Z-final`

Apply (gated, create-only): `npm run import:irib:apply` — not run in this stage.
