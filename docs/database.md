# Схема базы данных — ТИНДА Э1

Все имена таблиц и полей — английский **snake_case**.  
Prisma-модель использует те же имена полей (без `@map` для колонок).  
API JSON использует те же имена.

СУБД: **PostgreSQL**. ORM: **Prisma 6**.  
Имена моделей Prisma совпадают с именами таблиц (`clients`, `products`, …); поля — `snake_case`.

---

## 1. Перечень таблиц

`roles`, `users`, `user_roles`, `employee_profiles`, `cities`, `clients`, `categories`, `products`, `carts`, `cart_items`, `orders`, `order_items`, `order_status_history`, `settings`, `sessions` (для httpOnly session store).

---

## 2. Таблицы и поля

### `roles`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK, default `gen_random_uuid()` |
| code | VARCHAR(50) | UNIQUE NOT NULL — `client`, `manager`, `director` |
| name | VARCHAR(100) | NOT NULL |

### `users`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| email | VARCHAR(255) | UNIQUE NOT NULL |
| phone | VARCHAR(32) | NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| full_name | VARCHAR(255) | NOT NULL |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

Индексы: `users_email_key`, `users_phone_idx`.

### `user_roles`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| user_id | UUID | FK → users.id, PK composite |
| role_id | UUID | FK → roles.id, PK composite |

PK: `(user_id, role_id)`.

### `employee_profiles`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| user_id | UUID | PK, FK → users.id |
| can_view_all_clients | BOOLEAN | NOT NULL DEFAULT false |
| can_edit_catalog | BOOLEAN | NOT NULL DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL |

### `cities`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| name | VARCHAR(120) | NOT NULL |
| region | VARCHAR(120) | NOT NULL DEFAULT `'Республика Дагестан'` |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| sort_order | INT | NOT NULL DEFAULT 0 |

UNIQUE: `(name, region)`.

### `clients`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| user_id | UUID | UNIQUE NOT NULL, FK → users.id |
| company_name | VARCHAR(200) | NOT NULL |
| inn | VARCHAR(12) | UNIQUE NOT NULL |
| kpp | VARCHAR(9) | NULL |
| legal_name | VARCHAR(255) | NULL |
| legal_address | TEXT | NULL |
| city_id | UUID | NOT NULL, FK → cities.id |
| client_type | VARCHAR(50) | NULL |
| status | VARCHAR(20) | NOT NULL |
| manager_id | UUID | NULL, FK → users.id |
| contact_name | VARCHAR(255) | NOT NULL |
| phone | VARCHAR(32) | NOT NULL |
| extra_phone | VARCHAR(32) | NULL |
| email | VARCHAR(255) | NOT NULL |
| comment | TEXT | NULL |
| address | TEXT | NOT NULL |
| pdn_accepted_at | TIMESTAMPTZ | NOT NULL |
| rejected_reason | TEXT | NULL |
| approved_at | TIMESTAMPTZ | NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

Индексы: `status`, `manager_id`, `city_id`.  
CHECK: `status IN ('pending','approved','rejected','blocked')`.

### `categories`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| parent_id | UUID | NULL, FK → categories.id |
| name | VARCHAR(150) | NOT NULL |
| slug | VARCHAR(150) | UNIQUE NOT NULL |
| sort_order | INT | NOT NULL DEFAULT 0 |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

### `products`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| sku | VARCHAR(64) | UNIQUE NOT NULL |
| name | VARCHAR(255) | NOT NULL |
| brand | VARCHAR(150) | NULL |
| category_id | UUID | NOT NULL, FK → categories.id |
| volume_text | VARCHAR(100) | NULL |
| package_type | VARCHAR(100) | NULL |
| units_per_package | INT | NOT NULL DEFAULT 1, CHECK ≥ 1 |
| sale_unit | VARCHAR(30) | NOT NULL |
| min_order_qty | INT | NOT NULL DEFAULT 1, CHECK ≥ 1 |
| allow_piece_sale | BOOLEAN | NOT NULL DEFAULT false |
| description | TEXT | NULL |
| availability | VARCHAR(20) | NOT NULL |
| is_promo | BOOLEAN | NOT NULL DEFAULT false |
| is_new | BOOLEAN | NOT NULL DEFAULT false |
| is_hit | BOOLEAN | NOT NULL DEFAULT false |
| image_url | TEXT | NULL |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

CHECK: `availability IN ('in_stock','on_order','out_of_stock')`.  
Индексы: `category_id`, `(is_active, availability)`, `name`.

### `carts`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| client_id | UUID | UNIQUE NOT NULL, FK → clients.id |
| updated_at | TIMESTAMPTZ | NOT NULL |

### `cart_items`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| cart_id | UUID | NOT NULL, FK → carts.id ON DELETE CASCADE |
| product_id | UUID | NOT NULL, FK → products.id |
| qty | INT | NOT NULL, CHECK > 0 |

UNIQUE: `(cart_id, product_id)`.

### `orders`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| number | VARCHAR(32) | UNIQUE NOT NULL |
| client_id | UUID | NOT NULL, FK → clients.id |
| manager_id | UUID | NULL, FK → users.id |
| created_by_user_id | UUID | NOT NULL, FK → users.id |
| status | VARCHAR(30) | NOT NULL |
| city_id | UUID | NOT NULL, FK → cities.id |
| address_snapshot | TEXT | NOT NULL |
| contact_name | VARCHAR(255) | NOT NULL |
| contact_phone | VARCHAR(32) | NOT NULL |
| desired_delivery_date | DATE | NOT NULL |
| payment_method | VARCHAR(30) | NOT NULL |
| is_urgent | BOOLEAN | NOT NULL DEFAULT false |
| client_comment | TEXT | NULL |
| manager_comment | TEXT | NULL |
| cancel_reason | TEXT | NULL |
| confirmed_at | TIMESTAMPTZ | NULL |
| delivered_at | TIMESTAMPTZ | NULL |
| cancelled_at | TIMESTAMPTZ | NULL |
| created_at | TIMESTAMPTZ | NOT NULL |
| updated_at | TIMESTAMPTZ | NOT NULL |

CHECK: `status IN ('new','confirmed','delivered','cancelled')`.  
CHECK: `payment_method IN ('bank_transfer','deferred','cash_on_delivery','transfer')`.  
Индексы: `(client_id, created_at DESC)`, `(manager_id, status)`, `(status, created_at DESC)`.

### `order_items`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| order_id | UUID | NOT NULL, FK → orders.id |
| product_id | UUID | NULL, FK → products.id ON DELETE SET NULL |
| product_name | VARCHAR(255) | NOT NULL |
| product_sku | VARCHAR(64) | NOT NULL |
| package_info | VARCHAR(255) | NULL |
| sale_unit | VARCHAR(30) | NOT NULL |
| qty | INT | NOT NULL, CHECK > 0 |

### `order_status_history`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| order_id | UUID | NOT NULL, FK → orders.id |
| from_status | VARCHAR(30) | NULL |
| to_status | VARCHAR(30) | NOT NULL |
| changed_by_user_id | UUID | NOT NULL, FK → users.id |
| comment | TEXT | NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

### `settings`

| Поле | Тип | Ограничения |
|------|-----|-------------|
| key | VARCHAR(100) | PK |
| value | JSONB | NOT NULL |

### `sessions`

Хранение серверных сессий для httpOnly cookie.

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | UUID | PK |
| user_id | UUID | NOT NULL, FK → users.id ON DELETE CASCADE |
| token_hash | VARCHAR(255) | UNIQUE NOT NULL |
| expires_at | TIMESTAMPTZ | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

Индекс: `(user_id)`, `(expires_at)`.

---

## 3. Связи

```
roles M:N users через user_roles
users 1:1 employee_profiles
users 1:1 clients (user_id)
users 1:N clients (manager_id)
cities 1:N clients
cities 1:N orders
categories 1:N categories (parent_id)
categories 1:N products
clients 1:1 carts
carts 1:N cart_items
products 1:N cart_items
clients 1:N orders
orders 1:N order_items
orders 1:N order_status_history
users 1:N sessions
```

---

## 4. Статусы

### Статус клиента (`clients.status`)

| Значение | Описание |
|----------|----------|
| pending | заявка на рассмотрении |
| approved | можно заказывать |
| rejected | заявка отклонена |
| blocked | доступ заблокирован |

### Наличие товара (`products.availability`)

| Значение | Описание |
|----------|----------|
| in_stock | в наличии |
| on_order | под заказ |
| out_of_stock | временно нет |

### Статус заказа (`orders.status`)

| Значение | Описание |
|----------|----------|
| new | новый |
| confirmed | подтверждён |
| delivered | доставлен |
| cancelled | отменён |

---

## 5. Разграничение доступа (данные)

- Клиент: строки с `clients.user_id = current_user.id`; заказы только своего `client_id`.  
- Менеджер: `clients.manager_id = current_user.id` (или все, если `can_view_all_clients`).  
- Руководитель (`director`): без фильтра по менеджеру.  
- Заявки `pending` в Э1 видят все менеджеры и руководитель (чтобы заявки не зависали без назначенного менеджера).

---

## 6. Seed (сотрудники вручную)

В `prisma/seed.ts` создаются:

- роли `client`, `manager`, `director`;  
- пользователь-руководитель;  
- 1–2 менеджера с `employee_profiles`;  
- города (Махачкала и др. по Дагестану);  
- базовое дерево категорий напитков;  
- опционально несколько товаров для проверки каталога;  
- `settings.support_email`, `settings.support_phone`.
