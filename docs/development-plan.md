# План разработки — ТИНДА Э1

## Стек (зафиксирован)

- PostgreSQL  
- Next.js (монолит)  
- TypeScript  
- Prisma 6  
- Zod  
- Tailwind CSS  
- Auth: httpOnly cookie session  

Имена полей: `snake_case` в БД, Prisma, API JSON.

## Шаги Э1

| Шаг | Содержание | Статус |
|-----|------------|--------|
| **Э1.0** | Репозиторий, Next.js, зависимости, Tailwind, структура папок, `.env.example` | готово |
| **Э1.1** | Prisma schema, миграция, seed (роли, director, менеджеры, города, категории) | готово |
| **Э1.2** | Auth: register, login, logout, me | готово |
| **Э1.3** | Экран статусов клиента (`pending` / `rejected` / `blocked` / `approved`) + защита маршрутов | готово |
| **Э1.4** | Staff: заявки, approve/reject | готово |
| **Э1.5** | Seed/CRUD категорий и товаров + catalog API | готово |
| **Э1.6** | Клиентский каталог UI, поиск, фильтры, временная корзина | готово |
| **Э1.7** | Карточка товара + единый модуль количества + временная корзина | готово |
| **Э1.8** | Корзина | готово |
| **Э1.9** | Оформление заказа + успех | готово |
| **Э1.10** | История и карточка заказа клиента | готово |
| **Э1.11** | Staff: заказы confirm/cancel/deliver | готово |
| **Э1.12** | Staff CRUD каталога + фото | готово |
| **Э1.13** | Проверка прав client/manager/director | готово |
| **Э1.14** | Адаптив, пустые состояния, подготовка к деплою | ожидает |

## Правило работы

После каждого согласованного блока шагов — остановка и отчёт.  
**Э1.13 выполнен.** Дальше — только после подтверждения (Э1.14).

### Э1.13 — кратко

- Единые guards: `src/lib/access.ts`, `require-auth`, `orders/access`, `assert_catalog_editor`
- CSRF Origin/Host для mutating API (`src/middleware.ts`)
- Rate limit (in-memory): login, register, image upload, create order
- Security headers: CSP, nosniff, Referrer-Policy, Permissions-Policy, frame deny, HSTS (prod)
- SESSION_SECRET обязателен; session token hash = HMAC-SHA256(SESSION_SECRET)
- Аудит ответов / redaction логов; тесты `tests/security-access.test.ts`

## Критерий готовности всего Э1 (позже)

Клиент регистрируется → менеджер подтверждает → клиент собирает корзину с кратностью → отправляет заказ → менеджер подтверждает → клиент видит статус; руководитель видит всё и управляет каталогом.
