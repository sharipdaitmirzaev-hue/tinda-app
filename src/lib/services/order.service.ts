import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import {
  can_place_orders,
  is_staff,
  type AuthUserPayload,
} from "@/lib/access";
import { check_qty } from "@/lib/quantity";
import { format_date_only, parse_date_only, today_date_key } from "@/lib/dates";
import type { CreateOrderInput } from "@/lib/validators/orders";

const ORDER_STATUS_NEW = "new";

function assert_approved_client(payload: AuthUserPayload) {
  if (is_staff(payload.user.roles)) {
    throw new AppError(
      403,
      "forbidden",
      "Клиентский заказ доступен только клиентам",
    );
  }
  if (!can_place_orders(payload) || !payload.client) {
    throw new AppError(
      403,
      "forbidden",
      "Оформление заказа доступно после подтверждения заявки",
    );
  }
  return payload.client.id;
}

export function build_package_info(product: {
  volume_text: string | null;
  package_type: string | null;
  units_per_package: number;
  allow_piece_sale: boolean;
}): string {
  const parts = [
    product.volume_text,
    product.package_type,
    `${product.units_per_package} шт. в упаковке`,
  ].filter((part): part is string => Boolean(part && String(part).trim()));

  if (product.allow_piece_sale) {
    parts.push("поштучно");
  }

  return parts.join(" · ").slice(0, 255);
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
    category: { is_active: boolean } | null;
  };
};

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
          items: {
            create: items.map((item) => ({
              product_id: item.product_id,
              product_name: item.product.name,
              product_sku: item.product.sku,
              package_info: build_package_info(item.product),
              sale_unit: item.product.sale_unit,
              qty: item.qty,
            })),
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
      status_label: order.status === "new" ? "Новый" : order.status,
      created_at: order.created_at.toISOString(),
      desired_delivery_date: format_date_only(order.desired_delivery_date),
      items_count,
      total_qty,
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
