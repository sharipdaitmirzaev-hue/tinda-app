# ТИНДА — оптовое веб-приложение

Сокращённый Э1: каталог без цен, корзина, заказы, кабинеты клиента / менеджера / руководителя.

Документация: папка [`docs/`](./docs/).

## Стек

- Next.js + TypeScript
- PostgreSQL + Prisma
- Zod, Tailwind CSS
- Auth: httpOnly cookie (с Э1.2)

## Требования

- Node.js 20+
- PostgreSQL 14+
- npm

## Настройка

1. Скопируйте окружение:

```bash
cp .env.example .env
```

2. Укажите `DATABASE_URL` на свою БД PostgreSQL.

3. Установите зависимости:

```bash
npm install
```

4. Примените миграции и seed:

```bash
npm run db:migrate
npm run db:seed
```

5. Запуск:

```bash
npm run dev
```

Приложение: [http://localhost:3000](http://localhost:3000)  
Health: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)

## Учётные записи после seed

| Роль | Email | Пароль |
|------|-------|--------|
| Руководитель (`director`) | director@tinda.local | ChangeMe123! |
| Менеджер | manager1@tinda.local | ChangeMe123! |
| Менеджер | manager2@tinda.local | ChangeMe123! |

Смените пароли перед боевым запуском.

## Текущий прогресс

Выполнены шаги **Э1.0–Э1.13**.  
Дальше — только после подтверждения (Э1.14).

### Безопасность (Э1.13)

- Cookie-сессия: `httpOnly`, `SameSite=Lax`, `Secure` в production; hash = HMAC(`SESSION_SECRET`)
- CSRF: проверка Origin/Host для mutating `/api/*`
- Rate limit (локальный in-memory): login, register, upload, create order  
  **Production с несколькими процессами требует Redis** — текущий адаптер только для одного процесса
- Security headers через `src/middleware.ts` (CSP, nosniff, frame deny, HSTS в prod)
- Матрица ролей: см. `docs/tz.md` §4
- Guards: `src/lib/access.ts`, `src/lib/auth/require-auth.ts`, `src/lib/orders/access.ts`

### Фотографии товаров

`STORAGE_DRIVER=local|s3` — см. `.env.example`. Секреты только на сервере.

### Тесты

```bash
npm test
```

## Полезные команды

```bash
npm run dev          # локальная разработка
npm run db:generate  # prisma generate
npm run db:migrate   # миграции
npm run db:seed      # начальные данные
npm run db:studio    # Prisma Studio
npm run lint
```
