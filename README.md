# ТИНДА — оптовое веб-приложение

Сокращённый Э1: каталог без цен, корзина, заказы, кабинеты клиента / менеджера / руководителя.

Документация: [`docs/`](./docs/) — ТЗ, API, БД, план, [деплой](./docs/deployment.md).

## Стек

- Next.js 15 + TypeScript + Tailwind
- PostgreSQL + Prisma 6
- Zod, Vitest, Playwright
- Auth: httpOnly cookie (HMAC session hash)

## Локальный запуск

```bash
cp .env.example .env
# укажите DATABASE_URL и SESSION_SECRET (>= 16 символов для dev)

npm install
npm run db:deploy
npm run db:seed
npm run dev
```

Приложение: http://localhost:3000  
Health: http://localhost:3000/api/v1/health → `{"ok":true,"database":"ok"}`

### Проверка чистого развёртывания БД

```bash
npm run db:verify-clean
```

## Переменные окружения

См. `.env.example`.

Обязательные: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`.  
Хранилище фото: `STORAGE_DRIVER=local|s3` (+ `STORAGE_*` для S3).  
Seed: `SEED_PASSWORD` (в production обязателен, `ChangeMe123!` запрещён).

## Тестовые учётки (только development seed)

| Роль | Email | Пароль |
|------|-------|--------|
| Руководитель | director@tinda.local | `SEED_PASSWORD` или `ChangeMe123!` |
| Менеджер (каталог) | manager1@tinda.local | то же |
| Менеджер (без каталога) | manager2@tinda.local | то же |

**Не используйте эти пароли в production.** Seed в production требует `ALLOW_PROD_SEED=true`.

## Скрипты

```bash
npm run dev
npm run lint
npm run typecheck
npm test                 # unit/integration
npm run test:e2e         # Playwright (отдельная БД)
npm run build
npm start
npm run db:deploy
npm run db:seed
```

## Docker (production)

```bash
# заполните .env (POSTGRES_PASSWORD, SESSION_SECRET, APP_URL)
docker compose -f docker-compose.production.yml up -d --build
```

Nginx example: `deploy/nginx/tinda.conf.example`  
Полный гайд: `docs/deployment.md`

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, tests, build; отдельный job E2E с PostgreSQL service.

## Production checklist

1. Сильные `SESSION_SECRET` и пароль БД  
2. HTTPS + корректный `APP_URL`  
3. Миграции применены  
4. Seed-пароли сменены / seed не с default  
5. Backup PostgreSQL (+ uploads при local storage)  
6. Health OK  
7. Rate limit: для нескольких инстансов нужен Redis (локальный адаптер — один процесс)

## Ограничения Э1 (осознанно отложены)

Персональные цены, точные остатки, 1С, WhatsApp/SMS, GPS, PDF, восстановление пароля, UI управления сотрудниками и др. — см. ТЗ.
