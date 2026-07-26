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

**Кто:** `client`

```json
{
  "status": "pending",
  "rejected_reason": null,
  "company_name": "string",
  "support_email": "string|null",
  "support_phone": "string|null"
}
```

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

Карточка товара + `category_name`, `step`, `suggested_qty` (для текущего/мин. количества).

---

## 6. Корзина

### `GET /api/v1/cart`

```json
{
  "items": [
    {
      "product_id": "uuid",
      "product": { },
      "qty": 12,
      "qty_error": null,
      "suggested_qty": null
    }
  ],
  "is_ready_to_checkout": true
}
```

### `POST /api/v1/cart/items`

**Вход:** `{ "product_id": "uuid", "qty": 12 }`  
**Выход:** объект корзины как в `GET /cart`.

### `PATCH /api/v1/cart/items/:product_id`

**Вход:** `{ "qty": 24 }`

### `DELETE /api/v1/cart/items/:product_id`

### `DELETE /api/v1/cart`

---

## 7. Заказы клиента

### `POST /api/v1/orders`

**Кто:** `client` + `status = approved`

**Вход:**

```json
{
  "desired_delivery_date": "2026-08-01",
  "contact_name": "string",
  "contact_phone": "string",
  "payment_method": "bank_transfer",
  "is_urgent": false,
  "client_comment": "string|null",
  "address": "string|null"
}
```

Если `address` = `null`, берётся `clients.address`.

**Выход:**

```json
{
  "order": {
    "id": "uuid",
    "number": "T-2026-0001",
    "status": "new"
  }
}
```

### `GET /api/v1/client/orders`

Query: `status`, `page`, `page_size`

### `GET /api/v1/client/orders/:id`

Полная карточка: заказ, `items[]`, `history[]`.

### `PATCH /api/v1/client/orders/:id`

Только `status = new`. Частичное обновление контактов/состава.

**Вход (пример):**

```json
{
  "desired_delivery_date": "2026-08-02",
  "contact_name": "string",
  "contact_phone": "string",
  "payment_method": "cash_on_delivery",
  "is_urgent": true,
  "client_comment": "string|null",
  "address": "string",
  "items": [{ "product_id": "uuid", "qty": 24 }]
}
```

### `POST /api/v1/client/orders/:id/cancel`

**Вход:** `{ "reason": "string|null" }`

---

## 8. Заявки (staff)

### `GET /api/v1/staff/registration-requests`

Query: `status` (`pending` по умолчанию), `page`, `page_size`

### `GET /api/v1/staff/registration-requests/:client_id`

### `POST /api/v1/staff/registration-requests/:client_id/approve`

**Вход:** `{ "manager_id": "uuid|null" }`

### `POST /api/v1/staff/registration-requests/:client_id/reject`

**Вход:** `{ "reason": "string" }`

---

## 9. Заказы (staff)

### `GET /api/v1/staff/orders`

Query: `status`, `is_urgent`, `client_id`, `date_from`, `date_to`, `page`, `page_size`

### `GET /api/v1/staff/orders/:id`

### `POST /api/v1/staff/orders/:id/confirm`

### `POST /api/v1/staff/orders/:id/cancel`

**Вход:** `{ "reason": "string" }`

### `POST /api/v1/staff/orders/:id/deliver`

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

### `POST /api/v1/staff/products`

Поля как в таблице `products` (без системных дат).

### `PATCH /api/v1/staff/products/:id`

### `POST /api/v1/staff/products/:id/image`

`multipart/form-data`, поле файла `file` → обновляет `image_url`.

---

## 11. Health

### `GET /api/v1/health`

```json
{ "ok": true }
```
