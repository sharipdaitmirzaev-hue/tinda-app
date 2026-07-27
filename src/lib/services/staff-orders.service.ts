import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  assert_staff,
  has_role,
  is_director,
  type AuthUserPayload,
} from "@/lib/access";
import {
  staff_can_access_order,
  staff_orders_scope_where,
} from "@/lib/orders/access";
import { get_order_status_label } from "@/lib/orders/constants";
import { format_date_only, parse_date_only } from "@/lib/dates";
import {
  calc_line_total,
  money_round,
  money_to_number,
  sum_money,
} from "@/lib/money";
import { check_qty } from "@/lib/quantity";
import {
  PAYMENT_METHOD_LABELS,
  type AssignOrderManagerInput,
  type StaffCancelOrderInput,
  type StaffConfirmOrderInput,
  type StaffDeliverOrderInput,
  type StaffOrdersQuery,
  type UpdateStaffOrderInput,
} from "@/lib/validators/orders";
import { build_package_info } from "@/lib/orders/package-info";
import type { Decimal } from "@prisma/client/runtime/library";

const STATUS_NEW = "new";
const STATUS_CONFIRMED = "confirmed";
const STATUS_DELIVERED = "delivered";
const STATUS_CANCELLED = "cancelled";

function throw_status_conflict(): never {
  throw new AppError(
    409,
    "ORDER_STATUS_CONFLICT",
    "Статус заказа уже изменён. Обновите страницу",
  );
}

const staff_order_include = {
  items: {
    orderBy: { id: "asc" as const },
    include: {
      product: { select: { image_url: true } },
    },
  },
  status_history: { orderBy: { created_at: "asc" as const } },
  client: {
    select: {
      id: true,
      company_name: true,
      inn: true,
      manager_id: true,
    },
  },
  city: { select: { id: true, name: true } },
  manager: { select: { id: true, full_name: true } },
} as const;

type StaffOrderFull = Prisma.ordersGetPayload<{
  include: typeof staff_order_include;
}>;

function sort_to_order(
  sort: StaffOrdersQuery["sort"],
): Prisma.ordersOrderByWithRelationInput | Prisma.ordersOrderByWithRelationInput[] {
  switch (sort) {
    case "created_at_asc":
      return { created_at: "asc" };
    case "desired_delivery_date_asc":
      return [{ desired_delivery_date: "asc" }, { created_at: "desc" }];
    case "desired_delivery_date_desc":
      return [{ desired_delivery_date: "desc" }, { created_at: "desc" }];
    case "is_urgent_desc":
      return [{ is_urgent: "desc" }, { created_at: "desc" }];
    case "created_at_desc":
    default:
      return { created_at: "desc" };
  }
}

export function serialize_staff_order_list_item(order: {
  id: string;
  number: string;
  created_at: Date;
  status: string;
  is_urgent: boolean;
  desired_delivery_date: Date;
  subtotal: Decimal | string | number;
  delivery_total: Decimal | string | number;
  total: Decimal | string | number;
  client: { company_name: string; inn: string };
  manager: { id: string; full_name: string } | null;
  city: { id: string; name: string };
  items: Array<{ qty: number }>;
}) {
  return {
    id: order.id,
    number: order.number,
    created_at: order.created_at.toISOString(),
    client_company_name: order.client.company_name,
    client_inn: order.client.inn,
    manager: order.manager
      ? { id: order.manager.id, full_name: order.manager.full_name }
      : null,
    status: order.status,
    status_label: get_order_status_label(order.status),
    is_urgent: order.is_urgent,
    desired_delivery_date: format_date_only(order.desired_delivery_date),
    city: order.city,
    items_count: order.items.length,
    total_qty: order.items.reduce((sum, item) => sum + item.qty, 0),
    subtotal: money_to_number(order.subtotal),
    delivery_total: money_to_number(order.delivery_total),
    total: money_to_number(order.total),
  };
}

export function serialize_staff_order_details(order: StaffOrderFull) {
  const payment_method =
    order.payment_method as keyof typeof PAYMENT_METHOD_LABELS;
  const editable =
    order.status === STATUS_NEW || order.status === STATUS_CONFIRMED;

  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      status_label: get_order_status_label(order.status),
      created_at: order.created_at.toISOString(),
      updated_at: order.updated_at.toISOString(),
      client: {
        id: order.client.id,
        company_name: order.client.company_name,
        inn: order.client.inn,
        manager_id: order.client.manager_id,
      },
      manager: order.manager
        ? { id: order.manager.id, full_name: order.manager.full_name }
        : null,
      city: order.city,
      address: order.address_snapshot,
      contact_name: order.contact_name,
      contact_phone: order.contact_phone,
      payment_method: order.payment_method,
      payment_method_label:
        PAYMENT_METHOD_LABELS[payment_method] ?? order.payment_method,
      desired_delivery_date: format_date_only(order.desired_delivery_date),
      is_urgent: order.is_urgent,
      client_comment: order.client_comment,
      manager_comment: order.manager_comment,
      cancel_reason: order.cancel_reason,
      confirmed_at: order.confirmed_at?.toISOString() ?? null,
      delivered_at: order.delivered_at?.toISOString() ?? null,
      cancelled_at: order.cancelled_at?.toISOString() ?? null,
      can_edit: editable,
      can_confirm: order.status === STATUS_NEW,
      can_cancel:
        order.status === STATUS_NEW || order.status === STATUS_CONFIRMED,
      can_deliver: order.status === STATUS_CONFIRMED,
      can_assign_manager: true,
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
        comment: row.comment,
        created_at: row.created_at.toISOString(),
      })),
    },
  };
}

async function load_staff_order_or_404(
  payload: AuthUserPayload,
  order_id: string,
): Promise<StaffOrderFull> {
  assert_staff(payload);

  const order = await prisma.orders.findUnique({
    where: { id: order_id },
    include: staff_order_include,
  });

  if (!order || !staff_can_access_order(payload, order)) {
    throw new AppError(404, "not_found", "Заказ не найден");
  }

  return order;
}

async function lock_staff_order(
  tx: Prisma.TransactionClient,
  order_id: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      status: string;
      manager_id: string | null;
      client_id: string;
    }>
  >`
    SELECT id, status, manager_id, client_id
    FROM orders
    WHERE id = ${order_id}::uuid
    FOR UPDATE
  `;

  const locked = rows[0];
  if (!locked) {
    throw new AppError(404, "not_found", "Заказ не найден");
  }
  return locked;
}

async function assert_locked_order_access(
  payload: AuthUserPayload,
  tx: Prisma.TransactionClient,
  locked: { id: string; client_id: string; manager_id: string | null },
) {
  const client = await tx.clients.findUniqueOrThrow({
    where: { id: locked.client_id },
    select: { manager_id: true },
  });
  if (
    !staff_can_access_order(payload, {
      manager_id: locked.manager_id,
      client,
    })
  ) {
    throw new AppError(404, "not_found", "Заказ не найден");
  }
}

async function load_products_for_staff_update(
  tx: Prisma.TransactionClient,
  items: Array<{ product_id: string; qty: number }>,
) {
  const product_ids = items.map((item) => item.product_id);
  const products = await tx.products.findMany({
    where: { id: { in: product_ids } },
    include: { category: { select: { is_active: true } } },
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

export async function list_staff_orders(
  payload: AuthUserPayload,
  query: StaffOrdersQuery,
) {
  assert_staff(payload);

  const scope = staff_orders_scope_where(payload);
  const where: Prisma.ordersWhereInput = { ...scope };

  if (query.status) where.status = query.status;
  if (query.is_urgent !== undefined) where.is_urgent = query.is_urgent;
  if (query.client_id) where.client_id = query.client_id;
  if (query.city_id) where.city_id = query.city_id;

  if (query.manager_id) {
    if (!is_director(payload)) {
      // Ignore foreign manager filter for scoped managers.
    } else {
      where.manager_id = query.manager_id;
    }
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

  if (query.q?.trim()) {
    const q = query.q.trim();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { number: { contains: q, mode: "insensitive" } },
          { client: { company_name: { contains: q, mode: "insensitive" } } },
          { client: { inn: { contains: q } } },
        ],
      },
    ];
  }

  const skip = (query.page - 1) * query.page_size;
  const [total, items] = await Promise.all([
    prisma.orders.count({ where }),
    prisma.orders.findMany({
      where,
      orderBy: sort_to_order(query.sort),
      skip,
      take: query.page_size,
      include: {
        items: { select: { qty: true } },
        client: { select: { company_name: true, inn: true } },
        manager: { select: { id: true, full_name: true } },
        city: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    items: items.map(serialize_staff_order_list_item),
    page: query.page,
    page_size: query.page_size,
    total,
  };
}

export async function get_staff_order(
  payload: AuthUserPayload,
  order_id: string,
) {
  const order = await load_staff_order_or_404(payload, order_id);
  const serialized = serialize_staff_order_details(order);
  serialized.order.can_assign_manager =
    is_director(payload) || order.manager_id === null;

  let managers: Array<{ id: string; full_name: string; email: string }> = [];
  if (is_director(payload)) {
    managers = await prisma.users.findMany({
      where: {
        is_active: true,
        user_roles: { some: { role: { code: "manager" } } },
      },
      orderBy: { full_name: "asc" },
      select: { id: true, full_name: true, email: true },
    });
  }

  return {
    ...serialized,
    managers,
    is_director: is_director(payload),
  };
}

export async function update_staff_order(
  payload: AuthUserPayload,
  order_id: string,
  input: UpdateStaffOrderInput,
) {
  assert_staff(payload);

  const updated = await prisma.$transaction(async (tx) => {
    const locked = await lock_staff_order(tx, order_id);
    await assert_locked_order_access(payload, tx, locked);

    if (locked.status !== STATUS_NEW && locked.status !== STATUS_CONFIRMED) {
      throw_status_conflict();
    }

    if (input.items.length === 0) {
      throw new AppError(
        400,
        "validation_error",
        "Добавьте хотя бы один товар в заказ",
      );
    }

    const resolved_items = await load_products_for_staff_update(tx, input.items);

    // Snapshot prices from current products — never from client payload.
    const order_item_rows = resolved_items.map(({ product, qty }) => {
      if (product.price_amount === null || product.price_amount === undefined) {
        throw new AppError(400, "validation_error", "Некорректная цена товара для заказа");
      }
      const unit_price = money_round(product.price_amount);
      const line_total = calc_line_total(unit_price, qty);
      return {
        order_id,
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        package_info: build_package_info(product),
        sale_unit: product.sale_unit,
        qty,
        unit_price,
        currency: product.price_currency || "RUB",
        line_total,
      };
    });
    const subtotal = sum_money(order_item_rows.map((row) => row.line_total));
    const delivery_total = money_round(0);
    const total = sum_money([subtotal, delivery_total]);

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
        manager_comment: input.manager_comment,
        subtotal,
        delivery_total,
        total,
      },
    });

    await tx.order_items.deleteMany({ where: { order_id } });
    await tx.order_items.createMany({
      data: order_item_rows,
    });

    return tx.orders.findUniqueOrThrow({
      where: { id: order_id },
      include: staff_order_include,
    });
  });

  return {
    ...serialize_staff_order_details(updated),
    message: "Заказ сохранён",
  };
}

export async function confirm_staff_order(
  payload: AuthUserPayload,
  order_id: string,
  input: StaffConfirmOrderInput,
) {
  assert_staff(payload);
  const user_id = payload.user.id;

  const confirmed = await prisma.$transaction(async (tx) => {
    const locked = await lock_staff_order(tx, order_id);
    await assert_locked_order_access(payload, tx, locked);

    if (locked.status !== STATUS_NEW) {
      throw_status_conflict();
    }

    const client = await tx.clients.findUniqueOrThrow({
      where: { id: locked.client_id },
      select: { manager_id: true },
    });

    let next_manager_id = locked.manager_id;
    if (
      !locked.manager_id &&
      !is_director(payload) &&
      has_role(payload.user.roles, "manager") &&
      !client.manager_id
    ) {
      next_manager_id = user_id;
    }

    await tx.orders.update({
      where: { id: order_id },
      data: {
        status: STATUS_CONFIRMED,
        confirmed_at: new Date(),
        manager_id: next_manager_id,
        ...(input.manager_comment !== undefined
          ? { manager_comment: input.manager_comment }
          : {}),
      },
    });

    await tx.order_status_history.create({
      data: {
        order_id,
        from_status: STATUS_NEW,
        to_status: STATUS_CONFIRMED,
        changed_by_user_id: user_id,
        comment: input.manager_comment,
      },
    });

    return tx.orders.findUniqueOrThrow({
      where: { id: order_id },
      include: staff_order_include,
    });
  });

  return {
    ...serialize_staff_order_details(confirmed),
    message: "Заказ подтверждён",
  };
}

export async function cancel_staff_order(
  payload: AuthUserPayload,
  order_id: string,
  input: StaffCancelOrderInput,
) {
  assert_staff(payload);
  const user_id = payload.user.id;

  const cancelled = await prisma.$transaction(async (tx) => {
    const locked = await lock_staff_order(tx, order_id);
    await assert_locked_order_access(payload, tx, locked);

    if (locked.status !== STATUS_NEW && locked.status !== STATUS_CONFIRMED) {
      throw_status_conflict();
    }

    await tx.orders.update({
      where: { id: order_id },
      data: {
        status: STATUS_CANCELLED,
        cancel_reason: input.reason,
        cancelled_at: new Date(),
        ...(input.manager_comment !== undefined
          ? { manager_comment: input.manager_comment }
          : {}),
      },
    });

    await tx.order_status_history.create({
      data: {
        order_id,
        from_status: locked.status,
        to_status: STATUS_CANCELLED,
        changed_by_user_id: user_id,
        comment: input.reason,
      },
    });

    return tx.orders.findUniqueOrThrow({
      where: { id: order_id },
      include: staff_order_include,
    });
  });

  return {
    ...serialize_staff_order_details(cancelled),
    message: "Заказ отменён",
  };
}

export async function deliver_staff_order(
  payload: AuthUserPayload,
  order_id: string,
  input: StaffDeliverOrderInput,
) {
  assert_staff(payload);
  const user_id = payload.user.id;

  const delivered = await prisma.$transaction(async (tx) => {
    const locked = await lock_staff_order(tx, order_id);
    await assert_locked_order_access(payload, tx, locked);

    if (locked.status !== STATUS_CONFIRMED) {
      throw_status_conflict();
    }

    await tx.orders.update({
      where: { id: order_id },
      data: {
        status: STATUS_DELIVERED,
        delivered_at: new Date(),
        ...(input.manager_comment !== undefined
          ? { manager_comment: input.manager_comment }
          : {}),
      },
    });

    await tx.order_status_history.create({
      data: {
        order_id,
        from_status: STATUS_CONFIRMED,
        to_status: STATUS_DELIVERED,
        changed_by_user_id: user_id,
        comment: input.manager_comment,
      },
    });

    return tx.orders.findUniqueOrThrow({
      where: { id: order_id },
      include: staff_order_include,
    });
  });

  return {
    ...serialize_staff_order_details(delivered),
    message: "Заказ отмечен как доставленный",
  };
}

export async function assign_order_manager(
  payload: AuthUserPayload,
  order_id: string,
  input: AssignOrderManagerInput,
) {
  assert_staff(payload);
  const user_id = payload.user.id;

  const updated = await prisma.$transaction(async (tx) => {
    const locked = await lock_staff_order(tx, order_id);
    await assert_locked_order_access(payload, tx, locked);

    if (locked.status === STATUS_DELIVERED || locked.status === STATUS_CANCELLED) {
      throw_status_conflict();
    }

    let next_manager_id = input.manager_id;

    if (is_director(payload)) {
      if (next_manager_id) {
        const manager = await tx.users.findFirst({
          where: {
            id: next_manager_id,
            is_active: true,
            user_roles: { some: { role: { code: "manager" } } },
          },
        });
        if (!manager) {
          throw new AppError(400, "validation_error", "Менеджер не найден");
        }
      }
    } else {
      if (locked.manager_id !== null) {
        throw new AppError(
          403,
          "forbidden",
          "Заказ уже закреплён за менеджером",
        );
      }
      if (next_manager_id !== user_id) {
        throw new AppError(
          403,
          "forbidden",
          "Можно закрепить заказ только за собой",
        );
      }
      next_manager_id = user_id;
    }

    await tx.orders.update({
      where: { id: order_id },
      data: { manager_id: next_manager_id },
    });

    return tx.orders.findUniqueOrThrow({
      where: { id: order_id },
      include: staff_order_include,
    });
  });

  return {
    ...serialize_staff_order_details(updated),
    message: "Менеджер заказа обновлён",
  };
}
