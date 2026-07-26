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

Выполнены шаги **Э1.0–Э1.12**.  
Дальше — только после подтверждения (Э1.13).

### Auth / API (кратко)

- Auth: register / login / logout / me
- Staff catalog: `/api/v1/staff/categories`, `/api/v1/staff/products`, `POST|DELETE .../products/:id/image`
- Client catalog / cart / orders; staff orders

### Фотографии товаров (Э1.12)

Локально (`STORAGE_DRIVER=local`):

- файлы пишутся в `public/uploads/products/{product_id}/{uuid}.webp`
- URL вида `/uploads/products/...`
- каталог `public/uploads/products/**` в gitignore (секреты и загруженные файлы не коммитятся)

Production (`STORAGE_DRIVER=s3`):

```env
STORAGE_DRIVER=s3
STORAGE_ENDPOINT=https://s3.example.com
STORAGE_REGION=ru-1
STORAGE_BUCKET=tinda-product-images
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_PUBLIC_URL=https://cdn.example.com/tinda-product-images
```

Права ключа: `s3:PutObject`, `s3:DeleteObject` (и чтение через публичный URL/CDN).  
Реальные ключи храните только в `.env` / секретах хостинга — не в репозитории.

Доступ к staff-каталогу и API фото: `director` или manager с `can_edit_catalog=true`.

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
