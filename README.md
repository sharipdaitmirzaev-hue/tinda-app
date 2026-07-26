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

Выполнены шаги **Э1.0** и **Э1.1**. Дальше — только после подтверждения (Э1.2: auth).

## Полезные команды

```bash
npm run dev          # локальная разработка
npm run db:generate  # prisma generate
npm run db:migrate   # миграции
npm run db:seed      # начальные данные
npm run db:studio    # Prisma Studio
npm run lint
```
