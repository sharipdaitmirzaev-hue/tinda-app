import { Prisma } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  assert_approved_client,
  type AuthUserPayload,
} from "@/lib/access";
import { check_qty } from "@/lib/quantity";
import { format_date_only, parse_date_only, today_date_key } from "@/lib/dates";
import {
  calc_line_total,
  money_round,
  money_to_number,
  sum_money,
} from "@/lib/money";
import { get_order_status_label } from "@/lib/orders/constants";
import { build_package_info } from "@/lib/orders/package-info";
import { PAYMENT_METHOD_LABELS } from "@/lib/validators/orders";
import type {
  CancelClientOrderInput,
  ClientOrdersQuery,
  CreateOrderInput,
  UpdateClientOrderInput,
} from "@/lib/validators/orders";

export { build_package_info } from "@/lib/orders/package-info";
export {
  list_staff_orders,
  get_staff_order,
  update_staff_order,
  confirm_staff_order,
  cancel_staff_order,
  deliver_staff_order,
  assign_order_manager,
  serialize_staff_order_list_item,
  serialize_staff_order_details,
} from "@/lib/services/staff-orders.service";

const ORDER_STATUS_NEW = "new";
const ORDER_STATUS_CANCELLED = "cancelled";

function throw_already_processed(): never {
  throw new AppError(
    409,
    "ORDER_ALREADY_PROCESSED",
    "Заказ уже обработан менеджером. Изменения недоступны",
  );
}

export async function generate_order_number(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  const date_key = today_date_key("Europe/Moscow", now).replaceAll("-", "");

  const counter = await tx.order_number_counters.upsert({
    where: { date_key },
    create: { date_key, last_seq: 1 },
    update: { last_seq: { increment: 1 } },
  });

  return `T-${date_key}-${String(counter.last_seq).padStart(6, "0")}`;
}

export function serialize_created_order(order: {
  id: string;
  number: string;
  status: string;
  created_at: Date;
}) {
  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      created_at: order.created_at.toISOString(),
    },
  };
}

type CartItemForOrder = {
  product_id: string;
  qty: number;
  product: {
    id: string;
    sku: string;
    name: string;
    volume_text: string | null;
    package_type: string | null;
    units_per_package: number;
    sale_unit: string;
    min_order_qty: number;
    allow_piece_sale: boolean;
    availability: string;
    is_active: boolean;
    price_amount: Decimal | string | number;
    price_currency: string;
    category: { is_active: boolean } | null;
  };
};

function build_order_item_money(
  product: { price_amount: Decimal | string | number; price_currency: string },
  qty: number,
) {
  const unit_price = money_round(product.price_amount);
  const line_total = calc_line_total(unit_price, qty);
  return {
    unit_price,
    currency: product.price_currency || "RUB",
    line_total,
  };
}

function build_order_totals(line_totals: Array<Decimal | string | number>) {
  const subtotal = sum_money(line_totals);
  const delivery_total = money_round(0);
  const total = sum_money([subtotal, delivery_total]);
  return { subtotal, delivery_total, total };
}

function validate_cart_items_for_order(items: CartItemForOrder[]) {
  if (items.length === 0) {
    throw new AppError(400, "validation_error", "Корзина пуста");
  }

  let has_unavailable = false;
  let has_qty_error = false;

  for (const item of items) {
    const product = item.product;
    const category_inactive = product.category?.is_active === false;

    if (!product.is_active || category_inactive) {
      has_unavailable = true;
      continue;
    }

    if (product.availability === "out_of_stock") {
      has_unavailable = true;
      continue;
    }

    const check = check_qty(
      {
        units_per_package: product.units_per_package,
        min_order_qty: product.min_order_qty,
        allow_piece_sale: product.allow_piece_sale,
        availability: product.availability,
        is_active: product.is_active,
      },
      item.qty,
    );

    if (!check.valid) {
      has_qty_error = true;
    }
  }

  if (has_unavailable) {
    throw new AppError(
      400,
      "validation_error",
      "Некоторые товары больше недоступны",
    );
  }

  if (has_qty_error) {
    throw new AppError(
      400,
      "validation_error",
      "Количество товара изменилось. Проверьте корзину",
    );
  }
}

async function load_existing_idempotent_order(user_id: string, key: string) {
  const existing = await prisma.order_idempotency_keys.findUnique({
    where: {
      user_id_key: { user_id, key },
    },
    include: {
      order: true,
    },
  });
  if (!existing) return null;
  return serialize_created_order(existing.order);
}

export async function create_order_from_cart(
  payload: AuthUserPayload,
  input: CreateOrderInput,
  idempotency_key: string,
) {
  const client_id = assert_approved_client(payload);
  const user_id = payload.user.id;

  const existing = await load_existing_idempotent_order(user_id, idempotency_key);
  if (existing) {
    return existing;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const client = await tx.clients.findUnique({
        where: { id: client_id },
      });

      if (!client || client.status !== "approved") {
        throw new AppError(
          403,
          "forbidden",
          "Оформление заказа доступно после подтверждения заявки",
        );
      }

      const cart = await tx.carts.findUnique({
        where: { client_id },
        include: {
          items: {
            orderBy: { id: "asc" },
            include: {
              product: {
                include: {
                  category: { select: { is_active: true } },
                },
              },
            },
          },
        },
      });

      const items = cart?.items ?? [];
      validate_cart_items_for_order(items);

      // Re-read current product prices from DB inside the transaction.
      // Never trust client-sent prices (mutations only carry product_id + qty).
      const product_ids = items.map((item) => item.product_id);
      const priced_products = await tx.products.findMany({
        where: { id: { in: product_ids } },
        select: { id: true, price_amount: true, price_currency: true },
      });
      const price_by_id = new Map(
        priced_products.map((product) => [product.id, product]),
      );

      const order_item_rows = items.map((item) => {
        const priced = price_by_id.get(item.product_id);
        if (!priced) {
          throw new AppError(400, "validation_error", "Товар не найден");
        }
        const money = build_order_item_money(priced, item.qty);
        return {
          product_id: item.product_id,
          product_name: item.product.name,
          product_sku: item.product.sku,
          package_info: build_package_info(item.product),
          sale_unit: item.product.sale_unit,
          qty: item.qty,
          unit_price: money.unit_price,
          currency: money.currency,
          line_total: money.line_total,
        };
      });

      const totals = build_order_totals(
        order_item_rows.map((row) => row.line_total),
      );

      const number = await generate_order_number(tx);
      const desired_delivery_date = parse_date_only(input.desired_delivery_date);

      const order = await tx.orders.create({
        data: {
          number,
          client_id: client.id,
          manager_id: client.manager_id,
          created_by_user_id: user_id,
          status: ORDER_STATUS_NEW,
          city_id: client.city_id,
          address_snapshot: input.address.trim(),
          contact_name: input.contact_name.trim(),
          contact_phone: input.contact_phone,
          desired_delivery_date,
          payment_method: input.payment_method,
          is_urgent: input.is_urgent,
          client_comment: input.client_comment,
          subtotal: totals.subtotal,
          delivery_total: totals.delivery_total,
          total: totals.total,
          items: {
            create: order_item_rows,
          },
          status_history: {
            create: {
              from_status: null,
              to_status: ORDER_STATUS_NEW,
              changed_by_user_id: user_id,
            },
          },
        },
      });

      await tx.order_idempotency_keys.create({
        data: {
          user_id,
          key: idempotency_key,
          order_id: order.id,
        },
      });

      if (cart) {
        await tx.cart_items.deleteMany({ where: { cart_id: cart.id } });
        await tx.carts.update({
          where: { id: cart.id },
          data: { updated_at: new Date() },
        });
      }

      return order;
    });

    return serialize_created_order(created);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const again = await load_existing_idempotent_order(
        user_id,
        idempotency_key,
      );
      if (again) return again;
    }
    throw error;
  }
}

export async function get_order_success_details(
  payload: AuthUserPayload,
  order_id: string,
) {
  const client_id = assert_approved_client(payload);

  const order = await prisma.orders.findFirst({
    where: {
      id: order_id,
      client_id,
    },
    include: {
      items: true,
    },
  });

  if (!order) {
    throw new AppError(404, "not_found", "Заказ не найден");
  }

  const items_count = order.items.length;
  const total_qty = order.items.reduce((sum, item) => sum + item.qty, 0);

  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      status_label: get_order_status_label(order.status),
      created_at: order.created_at.toISOString(),
      desired_delivery_date: format_date_only(order.desired_delivery_date),
      items_count,
      total_qty,
      subtotal: money_to_number(order.subtotal),
      delivery_total: money_to_number(order.delivery_total),
      total: money_to_number(order.total),
    },
  };
}

export async function get_checkout_prefill(payload: AuthUserPayload) {
  const client_id = assert_approved_client(payload);
  const client = await prisma.clients.findUniqueOrThrow({
    where: { id: client_id },
    select: {
      address: true,
      contact_name: true,
      phone: true,
    },
  });

  return {
    address: client.address,
    contact_name: client.contact_name,
    contact_phone: client.phone,
  };
}

type OrderListRow = {
  id: string;
  number: string;
  status: string;
  created_at: Date;
  desired_delivery_date: Date;
  is_urgent: boolean;
  address_snapshot: string;
  subtotal: Decimal | string | number;
  delivery_total: Decimal | string | number;
  total: Decimal | string | number;
  items: Array<{ qty: number }>;
};

type OrderDetailRow = {
  id: string;
  number: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  desired_delivery_date: Date;
  address_snapshot: string;
  contact_name: string;
  contact_phone: string;
  payment_method: string;
  is_urgent: boolean;
  client_comment: string | null;
  cancel_reason: string | null;
  cancelled_at: Date | null;
  confirmed_at: Date | null;
  delivered_at: Date | null;
  subtotal: Decimal | string | number;
  delivery_total: Decimal | string | number;
  total: Decimal | string | number;
  items: Array<{
    id: string;
    product_id: string | null;
    product_name: string;
    product_sku: string;
    package_info: string | null;
    sale_unit: string;
    qty: number;
    unit_price: Decimal | string | number;
    currency: string;
    line_total: Decimal | string | number;
    product?: { image_url: string | null } | null;
  }>;
  status_history: Array<{
    id: string;
    from_status: string | null;
    to_status: string;
    comment: string | null;
    created_at: Date;
  }>;
};

export function serialize_client_order_list_item(order: OrderListRow) {
  const items_count = order.items.length;
  const total_qty = order.items.reduce((sum, item) => sum + item.qty, 0);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    status_label: get_order_status_label(order.status),
    created_at: order.created_at.toISOString(),
    desired_delivery_date: format_date_only(order.desired_delivery_date),
    is_urgent: order.is_urgent,
    items_count,
    total_qty,
    address: order.address_snapshot,
    subtotal: money_to_number(order.subtotal),
    delivery_total: money_to_number(order.delivery_total),
    total: money_to_number(order.total),
  };
}

export function serialize_client_order_details(order: OrderDetailRow) {
  const payment_method = order.payment_method as keyof typeof PAYMENT_METHOD_LABELS;
  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      status_label: get_order_status_label(order.status),
      created_at: order.created_at.toISOString(),
      updated_at: order.updated_at.toISOString(),
      desired_delivery_date: format_date_only(order.desired_delivery_date),
      address: order.address_snapshot,
      contact_name: order.contact_name,
      contact_phone: order.contact_phone,
      payment_method: order.payment_method,
      payment_method_label:
        PAYMENT_METHOD_LABELS[payment_method] ?? order.payment_method,
      is_urgent: order.is_urgent,
      client_comment: order.client_comment,
      cancel_reason: order.cancel_reason,
      cancelled_at: order.cancelled_at?.toISOString() ?? null,
      confirmed_at: order.confirmed_at?.toISOString() ?? null,
      delivered_at: order.delivered_at?.toISOString() ?? null,
      can_edit: order.status === ORDER_STATUS_NEW,
      can_cancel: order.status === ORDER_STATUS_NEW,
      items_count: order.items.length,
      total_qty: order.items.reduce((sum, item) => sum + item.qty, 0),
      subtotal: money_to_number(order.subtotal),
      delivery_total: money_to_number(order.delivery_total),
      total: money_to_number(order.total),
      items: order.items.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        package_info: item.package_info,
        sale_unit: item.sale_unit,
        qty: item.qty,
        unit_price: money_to_number(item.unit_price),
        currency: item.currency || "RUB",
        line_total: money_to_number(item.line_total),
        image_url: item.product?.image_url ?? null,
      })),
      status_history: order.status_history.map((row) => ({
        id: row.id,
        from_status: row.from_status,
        from_status_label: row.from_status
          ? get_order_status_label(row.from_status)
          : null,
        to_status: row.to_status,
        to_status_label: get_order_status_label(row.to_status),
        // Internal staff notes are not exposed to clients.
        comment: null,
        created_at: row.created_at.toISOString(),
      })),
    },
  };
}

export async function list_client_orders(
  payload: AuthUserPayload,
  query: ClientOrdersQuery,
) {
  const client_id = assert_approved_client(payload);

  const where: Prisma.ordersWhereInput = { client_id };

  if (query.status) {
    where.status = query.status;
  }

  if (query.q?.trim()) {
    where.number = {
      contains: query.q.trim(),
      mode: "insensitive",
    };
  }

  if (query.date_from || query.date_to) {
    where.created_at = {};
    if (query.date_from) {
      where.created_at.gte = parse_date_only(query.date_from);
    }
    if (query.date_to) {
      const end = parse_date_only(query.date_to);
      end.setUTCDate(end.getUTCDate() + 1);
      where.created_at.lt = end;
    }
  }

  const skip = (query.page - 1) * query.page_size;
  const [total, items] = await Promise.all([
    prisma.orders.count({ where }),
    prisma.orders.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: query.page_size,
      include: {
        items: { select: { qty: true } },
      },
    }),
  ]);

  return {
    items: items.map(serialize_client_order_list_item),
    page: query.page,
    page_size: query.page_size,
    total,
  };
}

export async function get_client_order(
  payload: AuthUserPayload,
  order_id: string,
) {
  const client_id = assert_approved_client(payload);

  const order = await prisma.orders.findFirst({
    where: { id: order_id, client_id },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { image_url: true } },
        },
      },
      status_history: { orderBy: { created_at: "asc" } },
    },
  });

  if (!order) {
    throw new AppError(404, "not_found", "Заказ не найден");
  }

  return serialize_client_order_details(order);
}

async function load_products_for_order_update(
  tx: Prisma.TransactionClient,
  items: Array<{ product_id: string; qty: number }>,
) {
  const product_ids = items.map((item) => item.product_id);
  const products = await tx.products.findMany({
    where: { id: { in: product_ids } },
    include: {
      category: { select: { is_active: true } },
    },
  });
  const by_id = new Map(products.map((product) => [product.id, product]));

  const resolved = [];
  for (const item of items) {
    const product = by_id.get(item.product_id);
    if (!product) {
      throw new AppError(400, "validation_error", "Товар не найден");
    }
    if (!product.is_active) {
      throw new AppError(400, "validation_error", "Товар недоступен");
    }
    if (!product.category?.is_active) {
      throw new AppError(400, "validation_error", "Категория товара недоступна");
    }
    if (product.availability === "out_of_stock") {
      throw new AppError(400, "validation_error", "Товара временно нет");
    }

    const check = check_qty(
      {
        units_per_package: product.units_per_package,
        min_order_qty: product.min_order_qty,
        allow_piece_sale: product.allow_piece_sale,
        availability: product.availability,
        is_active: product.is_active,
      },
      item.qty,
    );
    if (!check.valid) {
      throw new AppError(
        400,
        "validation_error",
        check.message ?? "Некорректное количество",
      );
    }

    resolved.push({ product, qty: item.qty });
  }

  return resolved;
}

async function lock_client_order_for_update(
  tx: Prisma.TransactionClient,
  order_id: string,
  client_id: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status
    FROM orders
    WHERE id = ${order_id}::uuid AND client_id = ${client_id}::uuid
    FOR UPDATE
  `;

  const existing = rows[0];
  if (!existing) {
    throw new AppError(404, "not_found", "Заказ не найден");
  }
  if (existing.status !== ORDER_STATUS_NEW) {
    throw_already_processed();
  }
  return existing;
}

export async function update_client_order(
  payload: AuthUserPayload,
  order_id: string,
  input: UpdateClientOrderInput,
) {
  const client_id = assert_approved_client(payload);

  const updated = await prisma.$transaction(async (tx) => {
    await lock_client_order_for_update(tx, order_id, client_id);

    if (input.items.length === 0) {
      throw new AppError(
        400,
        "validation_error",
        "Добавьте хотя бы один товар в заказ",
      );
    }

    const resolved_items = await load_products_for_order_update(tx, input.items);

    // Snapshot prices from current products — never from client payload.
    const order_item_rows = resolved_items.map(({ product, qty }) => {
      const money = build_order_item_money(product, qty);
      return {
        order_id,
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        package_info: build_package_info(product),
        sale_unit: product.sale_unit,
        qty,
        unit_price: money.unit_price,
        currency: money.currency,
        line_total: money.line_total,
      };
    });
    const totals = build_order_totals(
      order_item_rows.map((row) => row.line_total),
    );

    await tx.orders.update({
      where: { id: order_id },
      data: {
        address_snapshot: input.address.trim(),
        desired_delivery_date: parse_date_only(input.desired_delivery_date),
        contact_name: input.contact_name.trim(),
        contact_phone: input.contact_phone,
        payment_method: input.payment_method,
        is_urgent: input.is_urgent,
        client_comment: input.client_comment,
        subtotal: totals.subtotal,
        delivery_total: totals.delivery_total,
        total: totals.total,
      },
    });

    await tx.order_items.deleteMany({ where: { order_id } });
    await tx.order_items.createMany({
      data: order_item_rows,
    });

    return tx.orders.findFirstOrThrow({
      where: { id: order_id, client_id },
      include: {
        items: {
          orderBy: { id: "asc" },
          include: { product: { select: { image_url: true } } },
        },
        status_history: { orderBy: { created_at: "asc" } },
      },
    });
  });

  return serialize_client_order_details(updated);
}

export async function cancel_client_order(
  payload: AuthUserPayload,
  order_id: string,
  input: CancelClientOrderInput,
) {
  const client_id = assert_approved_client(payload);
  const user_id = payload.user.id;

  const cancelled = await prisma.$transaction(async (tx) => {
    const existing = await lock_client_order_for_update(tx, order_id, client_id);

    await tx.orders.update({
      where: { id: order_id },
      data: {
        status: ORDER_STATUS_CANCELLED,
        cancel_reason: input.reason,
        cancelled_at: new Date(),
      },
    });

    await tx.order_status_history.create({
      data: {
        order_id,
        from_status: existing.status,
        to_status: ORDER_STATUS_CANCELLED,
        changed_by_user_id: user_id,
        comment: input.reason,
      },
    });

    return tx.orders.findFirstOrThrow({
      where: { id: order_id, client_id },
      include: {
        items: {
          orderBy: { id: "asc" },
          include: { product: { select: { image_url: true } } },
        },
        status_history: { orderBy: { created_at: "asc" } },
      },
    });
  });

  return {
    ...serialize_client_order_details(cancelled),
    message: "Заказ отменён",
  };
}
