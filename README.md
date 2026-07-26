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

Выполнены шаги **Э1.0–Э1.9**.  
Дальше — только после подтверждения (Э1.10: история заказов клиента).

### Auth API

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/cities` (для формы регистрации)
- `GET /api/v1/client/registration-status`
- `GET/POST /api/v1/staff/registration-requests` (+ approve/reject)
- Staff catalog: `/api/v1/staff/categories`, `/api/v1/staff/products`
- Client catalog: `/api/v1/catalog/categories`, `/api/v1/catalog/products`
- Client cart: `GET/DELETE /api/v1/cart`, `POST /api/v1/cart/items`, `PATCH/DELETE /api/v1/cart/items/:productId`
- Client orders: `POST /api/v1/orders` (Idempotency-Key), success UI `/checkout/success/[orderId]`

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
