# API — ТИНДА Э1

Префикс: `/api/v1`  
Формат: JSON  
Имена полей во всех запросах и ответах: **snake_case** (совпадают с БД и Prisma).  
Авторизация: сессия в **httpOnly cookie** (после `login` / `register`).

Ошибка:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Человекочитаемое сообщение на русском"
  }
}
```

---

## 1. Правила кратности (`qty`)

```
step = allow_piece_sale ? 1 : units_per_package
valid = qty is int AND qty >= min_order_qty AND qty % step == 0
         AND product.is_active AND product.availability != "out_of_stock"

suggested_qty:
  ceil(qty / step) * step
  if suggested_qty < min_order_qty:
    suggested_qty = ceil(min_order_qty / step) * step
```

В ответах корзины при ошибке:

```json
{
  "qty_error": "not_multiple",
  "suggested_qty": 12
}
```

Возможные `qty_error`: `not_multiple` | `below_min` | `out_of_stock` | `inactive`.

---

## 2. Auth

### `POST /api/v1/auth/register`

**Вход:**

```json
{
  "company_name": "string",
  "inn": "string",
  "kpp": "string|null",
  "legal_name": "string|null",
  "legal_address": "string|null",
  "city_id": "uuid",
  "client_type": "shop|cafe|restaurant|hotel|wholesaler|banquet_hall|other|null",
  "contact_name": "string",
  "phone": "string",
  "extra_phone": "string|null",
  "email": "string",
  "address": "string",
  "comment": "string|null",
  "password": "string",
  "password_confirm": "string",
  "pdn_accepted": true
}
```

**Выход:** `201`

```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "full_name": "string",
    "roles": ["client"]
  },
  "client": {
    "id": "uuid",
    "status": "pending",
    "company_name": "string"
  },
  "employee": null,
  "redirect_to": "/pending"
}
```

`redirect_to`: `/pending` (клиент не `approved`), `/catalog` (клиент `approved`), `/staff/orders` (manager/director).

### `POST /api/v1/auth/login`

**Вход:**

```json
{
  "login": "string",
  "password": "string"
}
```

`login` — email или телефон.

**Выход:** `200`

```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "full_name": "string",
    "roles": ["manager"]
  },
  "client": null,
  "employee": {
    "can_view_all_clients": false,
    "can_edit_catalog": false
  }
}
```

Для клиента `employee` = `null`, заполнен `client` с полями `id`, `status`, `company_name`.

### `POST /api/v1/auth/logout`

**Выход:** `{ "ok": true }`

### `GET /api/v1/auth/me`

**Выход:** как у `login`.

---

## 3. Справочники

### `GET /api/v1/cities`

**Выход:**

```json
{
  "items": [
    { "id": "uuid", "name": "Махачкала", "region": "Республика Дагестан" }
  ]
}
```

---

## 4. Статус регистрации клиента

### `GET /api/v1/client/registration-status`

**Кто:** `client` (в том числе `pending` / `rejected` / `blocked` / `approved`)

```json
{
  "status": "pending",
  "rejected_reason": null,
  "company_name": "string",
  "support_email": "string|null",
  "support_phone": "string|null",
  "redirect_to": "/pending"
}
```

Для `approved` поле `redirect_to` = `/catalog`.

---

## 5. Каталог (клиент `approved`)

### `GET /api/v1/catalog/categories`

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Вода",
      "slug": "voda",
      "parent_id": null,
      "children": []
    }
  ]
}
```

### `GET /api/v1/catalog/products`

Query: `category_id`, `q`, `availability`, `is_promo`, `is_new`, `is_hit`, `page`, `page_size`, `sort`

```json
{
  "items": [
    {
      "id": "uuid",
      "sku": "W-001",
      "name": "string",
      "brand": "string|null",
      "category_id": "uuid",
      "volume_text": "string|null",
      "package_type": "string|null",
      "units_per_package": 12,
      "sale_unit": "упаковка",
      "min_order_qty": 12,
      "allow_piece_sale": false,
      "availability": "in_stock",
      "is_promo": false,
      "is_new": false,
      "is_hit": false,
      "image_url": "string|null"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 0
}
```

### `GET /api/v1/catalog/products/:id`

Только поля каталога (без цен):

`id`, `sku`, `name`, `brand`, `category` `{ id, name }`, `volume_text`, `package_type`, `units_per_package`, `sale_unit`, `min_order_qty`, `allow_piece_sale`, `description`, `availability`, `is_promo`, `is_new`, `is_hit`, `image_url`.

Расчёт `step` / `suggested_qty` — на клиенте через `lib/quantity.ts`.

---

## 6. Корзина

### `GET /api/v1/cart`

**Кто:** `client` + `status = approved`  
Неавторизованный → `401`. `pending` / `rejected` / `blocked`, manager, director → `403`.

```json
{
  "items": [
    {
      "product_id": "uuid",
      "qty": 12,
      "product": {
        "id": "uuid",
        "sku": "string",
        "name": "string",
        "brand": "string|null",
        "volume_text": "string|null",
        "package_type": "string|null",
        "units_per_package": 12,
        "sale_unit": "string",
        "min_order_qty": 12,
        "allow_piece_sale": false,
        "availability": "in_stock",
        "image_url": "string|null",
        "is_active": true
      },
      "qty_error": null,
      "suggested_qty": null
    }
  ],
  "items_count": 1,
  "total_qty": 12,
  "is_ready_to_checkout": true
}
```

Цены в ответе отсутствуют. При каждом `GET` позиции перепроверяются (`out_of_stock` / `inactive` / кратность).

### `POST /api/v1/cart/items`

**Вход:** `{ "product_id": "uuid", "qty": 12 }`  
Если товара нет — создать; если есть — прибавить `qty`.  
**Выход:** объект корзины как в `GET /cart`.

### `PATCH /api/v1/cart/items/:product_id`

**Вход:** `{ "qty": 24 }` — заменить количество.

### `DELETE /api/v1/cart/items/:product_id`

Удаляет одну позицию.

### `DELETE /api/v1/cart`

Полностью очищает корзину.

---

## 7. Заказы клиента

### `POST /api/v1/orders`

**Кто:** `client` + `status = approved`  
Заголовок: `Idempotency-Key: <uuid>` (обязателен).

**Вход:**

```json
{
  "address": "string",
  "desired_delivery_date": "YYYY-MM-DD",
  "contact_name": "string",
  "contact_phone": "string",
  "payment_method": "bank_transfer|deferred|cash_on_delivery|transfer",
  "is_urgent": false,
  "client_comment": "string|null"
}
```

Адрес сохраняется только в `orders.address_snapshot` (профиль клиента не меняется).  
Создание идёт из серверной корзины в одной транзакции; при успехе `cart_items` очищаются.

**Выход:** `201`

```json
{
  "order": {
    "id": "uuid",
    "number": "T-20260726-000001",
    "status": "new",
    "created_at": "ISO datetime"
  }
}
```

Повтор с тем же `Idempotency-Key` возвращает уже созданный заказ без дубля.

### `GET /api/v1/client/orders`

**Кто:** `client` + `approved`  
Query: `status`, `date_from`, `date_to`, `q` (номер), `page`, `page_size`  
Сортировка: `created_at` DESC. Цены отсутствуют. `manager_comment` не возвращается.

### `GET /api/v1/client/orders/:id`

Полная карточка своего заказа: поля доставки, `items[]` (snapshot), `status_history[]`.  
Чужой заказ → `404`.

### `PATCH /api/v1/client/orders/:id`

Только владелец и только `status = new`.  
Если заказ уже обработан → `409` / `ORDER_ALREADY_PROCESSED`.

**Вход:**

```json
{
  "address": "string",
  "desired_delivery_date": "YYYY-MM-DD",
  "contact_name": "string",
  "contact_phone": "string",
  "payment_method": "bank_transfer|deferred|cash_on_delivery|transfer",
  "is_urgent": true,
  "client_comment": "string|null",
  "items": [{ "product_id": "uuid", "qty": 24 }]
}
```

Состав заменяется целиком; qty через `lib/quantity.ts`.

### `POST /api/v1/client/orders/:id/cancel`

**Вход:** `{ "reason": "string|null" }` (до 1000 символов)  
Только `status = new`. Пишет `cancelled_at`, `cancel_reason`, `order_status_history`.

---

## 8. Заявки (staff)

### `GET /api/v1/staff/registration-requests`

**Кто:** `manager`, `director`  
Query: `status` (`pending`|`rejected`, по умолчанию `pending`), `city_id`, `q`, `page`, `page_size`  
Сортировка: `created_at` DESC.

### `GET /api/v1/staff/registration-requests/:client_id`

Возвращает `request`, список `managers` (для director) и флаг `can_assign_manager`.

### `POST /api/v1/staff/registration-requests/:client_id/approve`

**Вход:** `{ "manager_id": "uuid|null" }`  
- `manager`: всегда назначает себя, `manager_id` из тела игнорируется.  
- `director`: может указать менеджера или `null`.  
Только статус `pending`. Иначе: «Заявка уже обработана».

### `POST /api/v1/staff/registration-requests/:client_id/reject`

**Вход:** `{ "reason": "string" }` (обязательно, не пустое)  
Только статус `pending`.

---

## 9. Заказы (staff)

**Кто:** `manager`, `director`  
Доступ менеджера: свои клиенты / `orders.manager_id` / `can_view_all_clients`.  
Чужой заказ → `404`. Конфликт статуса → `409` / `ORDER_STATUS_CONFLICT`.

### `GET /api/v1/staff/orders`

Query: `status`, `is_urgent`, `date_from`, `date_to`, `client_id`, `manager_id` (только director), `city_id`, `q`, `page`, `page_size`, `sort`.

### `GET /api/v1/staff/orders/:id`

Карточка со snapshot позиций, `manager_comment`, историей. Director дополнительно получает `managers[]`.

### `PATCH /api/v1/staff/orders/:id`

Только `new` / `confirmed`. Тело: адрес, контакты, оплата, срочность, `client_comment`, `manager_comment`, `items[]`.

### `POST /api/v1/staff/orders/:id/confirm`

**Вход:** `{ "manager_comment": "string|null" }` — только `new`.

### `POST /api/v1/staff/orders/:id/cancel`

**Вход:** `{ "reason": "string", "manager_comment": "string|null" }` — `new` или `confirmed`.

### `POST /api/v1/staff/orders/:id/deliver`

**Вход:** `{ "manager_comment": "string|null" }` — только `confirmed`.

### `PATCH /api/v1/staff/orders/:id/manager`

**Вход:** `{ "manager_id": "uuid|null" }`  
Director — любой активный manager или null. Manager — только себя и только если `manager_id` был null.

### `PATCH /api/v1/staff/orders/:id`

Правка состава и полей доставки/комментария менеджера.

---

## 10. Каталог (staff)

Доступ: `director` или `can_edit_catalog = true`.

### `GET /api/v1/staff/categories`

### `POST /api/v1/staff/categories`

**Вход:** `{ "name", "parent_id", "slug", "sort_order", "is_active" }`

### `PATCH /api/v1/staff/categories/:id`

### `GET /api/v1/staff/products`

Query: `q`, `category_id`, `availability`, `is_active`, `is_promo`, `is_new`, `is_hit`, `page`, `page_size`, `sort`.

### `POST /api/v1/staff/products`

Поля как в таблице `products` (без системных дат и без цен).

### `PATCH /api/v1/staff/products/:id`

Частичное обновление. Для soft-деактивации: `{ "is_active": false }`.  
Физическое удаление товара не поддерживается.

### `POST /api/v1/staff/products/:id/image`

`multipart/form-data`, поле файла `file`.

Ограничения:

- MIME: `image/jpeg`, `image/png`, `image/webp`
- размер ≤ 5 МБ
- проверка расширения и реального содержимого
- обработка: EXIF-ориентация, срез метаданных, max сторона 1600px, WebP

Ответ:

```json
{
  "product_id": "uuid",
  "image_url": "string"
}
```

При замене: новый файл загружается → обновляется `image_url` → старый файл удаляется только после успешного обновления БД.

### `DELETE /api/v1/staff/products/:id/image`

Ставит `image_url = null`, удаляет файл из хранилища. Сам товар не удаляется.

Доступ ко всем staff catalog endpoints: `director` или manager с `can_edit_catalog = true`. Иначе `403`.

---

## 11. Health

### `GET /api/v1/health`

```json
{ "ok": true }
```
