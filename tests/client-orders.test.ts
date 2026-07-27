import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import { add_cart_item } from "@/lib/services/cart.service";
import {
  cancel_client_order,
  create_order_from_cart,
  get_client_order,
  list_client_orders,
  update_client_order,
} from "@/lib/services/order.service";
import { create_order_schema } from "@/lib/validators/orders";
import { today_date_key } from "@/lib/dates";

const suffix = `clord_${Date.now()}`;

describe("client orders E1.10", () => {
  let approved_a: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_b: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let pending_client: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let category_id: string;
  let product_id: string;
  let product_b_id: string;
  let out_of_stock_id: string;
  let inactive_product_id: string;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_category_ids: string[] = [];

  beforeAll(async () => {
    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");

    async function make_client(status: "pending" | "approved", label: string) {
      const inn = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
      const email = `${label}_${suffix}@example.com`;
      const user = await prisma.users.create({
        data: {
          email,
          phone: `+7928${inn.slice(0, 7)}`,
          password_hash,
          full_name: label,
          user_roles: { create: [{ role_id: role_client.id }] },
          client: {
            create: {
              company_name: label,
              inn,
              city_id: city.id,
              status,
              contact_name: label,
              phone: `+7928${inn.slice(0, 7)}`,
              email,
              address: "Махачкала, адрес клиента",
              pdn_accepted_at: new Date(),
              approved_at: status === "approved" ? new Date() : null,
            },
          },
        },
        include: { client: true },
      });
      cleanup_user_ids.push(user.id);
      cleanup_client_ids.push(user.client!.id);
      return (await build_auth_payload(user.id))!;
    }

    approved_a = await make_client("approved", "ListA");
    approved_b = await make_client("approved", "ListB");
    pending_client = await make_client("pending", "ListPending");

    const category = await prisma.categories.create({
      data: {
        name: `ClOrd ${suffix}`,
        slug: `clord-${suffix}`,
        is_active: true,
      },
    });
    category_id = category.id;
    cleanup_category_ids.push(category.id);

    async function make_product(
      sku: string,
      data: { availability?: string; is_active?: boolean } = {},
    ) {
      const product = await prisma.products.create({
        data: {
          sku,
          name: `ClOrd ${sku}`,
          brand: "Brand",
          category_id,
          volume_text: "1 л",
          package_type: "блок",
          units_per_package: 12,
          sale_unit: "шт",
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: data.availability ?? "in_stock",
          is_active: data.is_active ?? true,
        },
      });
      cleanup_product_ids.push(product.id);
      return product.id;
    }

    product_id = await make_product(`CL-${suffix}-1`);
    product_b_id = await make_product(`CL-${suffix}-2`);
    out_of_stock_id = await make_product(`CL-${suffix}-oos`, {
      availability: "out_of_stock",
    });
    inactive_product_id = await make_product(`CL-${suffix}-off`, {
      is_active: false,
    });
  });

  beforeEach(async () => {
    await prisma.order_idempotency_keys.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.order_status_history.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.order_items.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.orders.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.carts.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
  });

  afterAll(async () => {
    await prisma.order_idempotency_keys.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.order_status_history.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.order_items.deleteMany({
      where: { order: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.orders.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.carts.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    await prisma.products.deleteMany({
      where: { id: { in: cleanup_product_ids } },
    });
    await prisma.categories.deleteMany({
      where: { id: { in: cleanup_category_ids } },
    });
    await prisma.clients.deleteMany({
      where: { id: { in: cleanup_client_ids } },
    });
    await prisma.user_roles.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.users.deleteMany({
      where: { id: { in: cleanup_user_ids } },
    });
    await prisma.$disconnect();
  });

  function valid_create(overrides: Record<string, unknown> = {}) {
    return create_order_schema.parse({
      address: "Махачкала, доставка",
      desired_delivery_date: today_date_key(),
      contact_name: "Клиент",
      contact_phone: "+79281112233",
      payment_method: "bank_transfer",
      is_urgent: false,
      client_comment: null,
      ...overrides,
    });
  }

  async function create_order_for(
    payload: typeof approved_a,
    qty = 12,
    product = product_id,
  ) {
    await add_cart_item(payload, { product_id: product, qty });
    return create_order_from_cart(payload, valid_create(), randomUUID());
  }

  it("approved client sees only own orders", async () => {
    const a = await create_order_for(approved_a);
    await create_order_for(approved_b);

    const list = await list_client_orders(approved_a, {
      page: 1,
      page_size: 20,
    });
    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe(a.order.id);
    expect(list.items[0]?.number).toBe(a.order.number);
  });

  it("foreign order returns 404; pending has no access", async () => {
    const created = await create_order_for(approved_a);
    await expect(
      get_client_order(approved_b, created.order.id),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      list_client_orders(pending_client, { page: 1, page_size: 20 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("filters, search and pagination work", async () => {
    const first = await create_order_for(approved_a, 12, product_id);
    await add_cart_item(approved_a, { product_id: product_b_id, qty: 12 });
    const second = await create_order_from_cart(
      approved_a,
      valid_create({ is_urgent: true }),
      randomUUID(),
    );

    await prisma.orders.update({
      where: { id: first.order.id },
      data: { status: "confirmed", confirmed_at: new Date() },
    });

    const by_status = await list_client_orders(approved_a, {
      status: "new",
      page: 1,
      page_size: 20,
    });
    expect(by_status.total).toBe(1);
    expect(by_status.items[0]?.id).toBe(second.order.id);

    const by_number = await list_client_orders(approved_a, {
      q: second.order.number.slice(-6),
      page: 1,
      page_size: 20,
    });
    expect(by_number.total).toBe(1);
    expect(by_number.items[0]?.id).toBe(second.order.id);

    const page1 = await list_client_orders(approved_a, {
      page: 1,
      page_size: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    // newest first
    expect(page1.items[0]?.id).toBe(second.order.id);

    const page2 = await list_client_orders(approved_a, {
      page: 2,
      page_size: 1,
    });
    expect(page2.items[0]?.id).toBe(first.order.id);
  });

  it("details use snapshot names and omit manager_comment; include money snapshot", async () => {
    const created = await create_order_for(approved_a);
    await prisma.orders.update({
      where: { id: created.order.id },
      data: { manager_comment: "Секрет менеджера" },
    });
    await prisma.products.update({
      where: { id: product_id },
      data: { name: "Новое имя товара" },
    });

    const details = await get_client_order(approved_a, created.order.id);
    expect(details.order.items[0]?.product_name).toContain("ClOrd");
    expect(details.order.items[0]?.product_name).not.toBe("Новое имя товара");
    expect(details.order.items[0]?.package_info).toContain("1 л");
    expect(details.order.items[0]?.unit_price).toEqual(expect.any(Number));
    expect(details.order.items[0]?.line_total).toEqual(expect.any(Number));
    expect(details.order.subtotal).toEqual(expect.any(Number));
    expect(details.order.delivery_total).toBe(0);
    expect(details.order.total).toBe(details.order.subtotal);

    const json = JSON.stringify(details);
    expect(json).not.toContain("manager_comment");
    expect(json).not.toContain("Секрет менеджера");
  });

  it("new order can be updated; empty items and bad products rejected", async () => {
    const created = await create_order_for(approved_a);
    const updated = await update_client_order(approved_a, created.order.id, {
      address: "Новый адрес доставки",
      desired_delivery_date: today_date_key(),
      contact_name: "Новый контакт",
      contact_phone: "+79285556677",
      payment_method: "cash_on_delivery",
      is_urgent: true,
      client_comment: "Правка",
      items: [
        { product_id, qty: 24 },
        { product_id: product_b_id, qty: 12 },
      ],
    });

    expect(updated.order.address).toBe("Новый адрес доставки");
    expect(updated.order.items_count).toBe(2);
    expect(updated.order.total_qty).toBe(36);
    expect(updated.order.is_urgent).toBe(true);

    await expect(
      update_client_order(approved_a, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        items: [],
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      update_client_order(approved_a, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя Достаточно",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        items: [{ product_id: out_of_stock_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Товара временно нет",
    });

    await expect(
      update_client_order(approved_a, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя Достаточно",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        items: [{ product_id: inactive_product_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Товар недоступен",
    });

    await expect(
      update_client_order(approved_a, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя Достаточно",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        items: [{ product_id, qty: 18 }],
      }),
    ).rejects.toMatchObject({ status: 400 });

    await prisma.categories.update({
      where: { id: category_id },
      data: { is_active: false },
    });
    await expect(
      update_client_order(approved_a, created.order.id, {
        address: "x",
        desired_delivery_date: today_date_key(),
        contact_name: "Имя Достаточно",
        contact_phone: "+79285556677",
        payment_method: "transfer",
        is_urgent: false,
        client_comment: null,
        items: [{ product_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Категория товара недоступна",
    });
    await prisma.categories.update({
      where: { id: category_id },
      data: { is_active: true },
    });
  });

  it("confirmed/cancelled cannot be updated; concurrent confirm blocks edit", async () => {
    const created = await create_order_for(approved_a);
    await prisma.orders.update({
      where: { id: created.order.id },
      data: { status: "confirmed", confirmed_at: new Date() },
    });

    await expect(
      update_client_order(approved_a, created.order.id, {
        address: "Адрес",
        desired_delivery_date: today_date_key(),
        contact_name: "Контакт",
        contact_phone: "+79285556677",
        payment_method: "bank_transfer",
        is_urgent: false,
        client_comment: null,
        items: [{ product_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ORDER_ALREADY_PROCESSED",
      message: "Заказ уже обработан менеджером. Изменения недоступны",
    });

    const another = await create_order_for(approved_a);
    await cancel_client_order(approved_a, another.order.id, { reason: null });
    await expect(
      update_client_order(approved_a, another.order.id, {
        address: "Адрес",
        desired_delivery_date: today_date_key(),
        contact_name: "Контакт",
        contact_phone: "+79285556677",
        payment_method: "bank_transfer",
        is_urgent: false,
        client_comment: null,
        items: [{ product_id, qty: 12 }],
      }),
    ).rejects.toMatchObject({ code: "ORDER_ALREADY_PROCESSED" });
  });

  it("new order can be cancelled once with history", async () => {
    const created = await create_order_for(approved_a);
    const cancelled = await cancel_client_order(approved_a, created.order.id, {
      reason: "Передумал",
    });

    expect(cancelled.message).toBe("Заказ отменён");
    expect(cancelled.order.status).toBe("cancelled");
    expect(cancelled.order.cancel_reason).toBe("Передумал");
    expect(cancelled.order.cancelled_at).toBeTruthy();
    expect(
      cancelled.order.status_history.some(
        (row) => row.to_status === "cancelled",
      ),
    ).toBe(true);

    await expect(
      cancel_client_order(approved_a, created.order.id, { reason: null }),
    ).rejects.toMatchObject({
      code: "ORDER_ALREADY_PROCESSED",
    });
  });

  it("update replaces items transactionally", async () => {
    const created = await create_order_for(approved_a);
    await update_client_order(approved_a, created.order.id, {
      address: "Адрес",
      desired_delivery_date: today_date_key(),
      contact_name: "Контакт",
      contact_phone: "+79285556677",
      payment_method: "deferred",
      is_urgent: false,
      client_comment: null,
      items: [{ product_id: product_b_id, qty: 24 }],
    });

    const items = await prisma.order_items.findMany({
      where: { order_id: created.order.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.product_id).toBe(product_b_id);
    expect(items[0]?.qty).toBe(24);
  });
});
