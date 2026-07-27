import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import { add_cart_item, get_cart } from "@/lib/services/cart.service";
import {
  create_order_from_cart,
  get_order_success_details,
} from "@/lib/services/order.service";
import { create_order_schema } from "@/lib/validators/orders";
import { today_date_key } from "@/lib/dates";
import { randomUUID } from "crypto";

const suffix = `ord_${Date.now()}`;

describe("orders E1.9", () => {
  let director_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let manager_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let approved_a: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_b: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_no_manager: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let pending_client: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;

  let category_id: string;
  let inactive_category_id: string;
  let product_id: string;
  let out_of_stock_id: string;
  let inactive_product_id: string;
  let inactive_category_product_id: string;
  let manager_user_id: string;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_category_ids: string[] = [];
  const cleanup_order_ids: string[] = [];

  beforeAll(async () => {
    director_payload = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;
    const manager_user = await prisma.users.findUniqueOrThrow({
      where: { email: "manager1@tinda.local" },
    });
    manager_user_id = manager_user.id;
    manager_payload = (await build_auth_payload(manager_user.id))!;

    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");

    async function make_client(
      status: "pending" | "approved",
      label: string,
      manager_id: string | null,
    ) {
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
              manager_id,
              contact_name: label,
              phone: `+7928${inn.slice(0, 7)}`,
              email,
              address: "Махачкала, тестовый адрес 1",
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

    approved_a = await make_client("approved", "OrdA", manager_user_id);
    approved_b = await make_client("approved", "OrdB", manager_user_id);
    approved_no_manager = await make_client("approved", "OrdNoMgr", null);
    pending_client = await make_client("pending", "OrdPending", null);

    const category = await prisma.categories.create({
      data: {
        name: `Ord Cat ${suffix}`,
        slug: `ord-cat-${suffix}`,
        sort_order: 1,
        is_active: true,
      },
    });
    category_id = category.id;
    cleanup_category_ids.push(category.id);

    const inactive_category = await prisma.categories.create({
      data: {
        name: `Ord Inactive Cat ${suffix}`,
        slug: `ord-inactive-cat-${suffix}`,
        sort_order: 2,
        is_active: false,
      },
    });
    inactive_category_id = inactive_category.id;
    cleanup_category_ids.push(inactive_category.id);

    async function make_product(
      sku: string,
      data: {
        availability?: string;
        is_active?: boolean;
        category_id?: string;
      } = {},
    ) {
      const product = await prisma.products.create({
        data: {
          sku,
          name: `Order Product ${sku}`,
          brand: "OrdBrand",
          category_id: data.category_id ?? category_id,
          volume_text: "0.5 л",
          package_type: "коробка",
          units_per_package: 12,
          sale_unit: "шт",
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: data.availability ?? "in_stock",
          is_active: data.is_active ?? true,
          image_url: null,
          price_amount: 150,
          price_currency: "RUB",
        },
      });
      cleanup_product_ids.push(product.id);
      return product.id;
    }

    product_id = await make_product(`O-${suffix}-1`);
    out_of_stock_id = await make_product(`O-${suffix}-oos`, {
      availability: "out_of_stock",
    });
    inactive_product_id = await make_product(`O-${suffix}-off`, {
      is_active: false,
    });
    inactive_category_product_id = await make_product(`O-${suffix}-cat`, {
      category_id: inactive_category_id,
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

  function valid_input(overrides: Record<string, unknown> = {}) {
    return create_order_schema.parse({
      address: "Махачкала, доставка на сегодня",
      desired_delivery_date: today_date_key(),
      contact_name: "Иван Тестов",
      contact_phone: "+7 (928) 000-11-22",
      payment_method: "bank_transfer",
      is_urgent: false,
      client_comment: null,
      ...overrides,
    });
  }

  it("approved client creates order with snapshot, history, manager_id", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const result = await create_order_from_cart(
      approved_a,
      valid_input({ is_urgent: true, client_comment: "Срочно" }),
      randomUUID(),
    );

    expect(result.order.status).toBe("new");
    expect(result.order.number).toMatch(/^T-\d{8}-\d{6}$/);
    cleanup_order_ids.push(result.order.id);

    const order = await prisma.orders.findUniqueOrThrow({
      where: { id: result.order.id },
      include: { items: true, status_history: true },
    });

    expect(order.manager_id).toBe(manager_user_id);
    expect(order.address_snapshot).toBe("Махачкала, доставка на сегодня");
    expect(order.contact_phone).toBe("+79280001122");
    expect(order.is_urgent).toBe(true);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.product_name).toContain("Order Product");
    expect(order.items[0]?.product_sku).toContain(`O-${suffix}-1`);
    expect(order.items[0]?.package_info).toContain("0.5 л");
    expect(order.items[0]?.package_info).toContain("коробка");
    expect(order.items[0]?.qty).toBe(12);
    expect(order.status_history).toHaveLength(1);
    expect(order.status_history[0]?.from_status).toBeNull();
    expect(order.status_history[0]?.to_status).toBe("new");
    expect(order.status_history[0]?.changed_by_user_id).toBe(approved_a.user.id);

    const cart = await get_cart(approved_a);
    expect(cart.items_count).toBe(0);

    expect(Number(order.subtotal)).toBeGreaterThanOrEqual(0);
    expect(Number(order.delivery_total)).toBe(0);
    expect(Number(order.total)).toBe(Number(order.subtotal));
    expect(Number(order.items[0]?.unit_price)).toBeGreaterThanOrEqual(0);
    expect(Number(order.items[0]?.line_total)).toBeGreaterThanOrEqual(0);

    const json = JSON.stringify(result);
    expect(json.toLowerCase()).not.toContain("price");
  });

  it("manager_id may be null", async () => {
    await add_cart_item(approved_no_manager, { product_id, qty: 12 });
    const result = await create_order_from_cart(
      approved_no_manager,
      valid_input(),
      randomUUID(),
    );
    const order = await prisma.orders.findUniqueOrThrow({
      where: { id: result.order.id },
    });
    expect(order.manager_id).toBeNull();
  });

  it("pending, manager and director cannot create client order", async () => {
    await expect(
      create_order_from_cart(pending_client, valid_input(), randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      create_order_from_cart(manager_payload, valid_input(), randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      create_order_from_cart(director_payload, valid_input(), randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("empty cart does not create order", async () => {
    await expect(
      create_order_from_cart(approved_a, valid_input(), randomUUID()),
    ).rejects.toMatchObject({
      status: 400,
      message: "Корзина пуста",
    });
  });

  it("cart with qty error does not create order and keeps cart", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.cart_items.updateMany({
      where: {
        product_id,
        cart: { client_id: approved_a.client!.id },
      },
      data: { qty: 18 },
    });

    await expect(
      create_order_from_cart(approved_a, valid_input(), randomUUID()),
    ).rejects.toMatchObject({
      status: 400,
      message: "Количество товара изменилось. Проверьте корзину",
    });

    const cart = await get_cart(approved_a);
    expect(cart.items_count).toBe(1);
    expect(cart.total_qty).toBe(18);
  });

  it("out_of_stock, inactive product and inactive category block order", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.products.update({
      where: { id: product_id },
      data: { availability: "out_of_stock" },
    });
    await expect(
      create_order_from_cart(approved_a, valid_input(), randomUUID()),
    ).rejects.toMatchObject({
      message: "Некоторые товары больше недоступны",
    });
    await prisma.products.update({
      where: { id: product_id },
      data: { availability: "in_stock" },
    });
    expect((await get_cart(approved_a)).items_count).toBe(1);

    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: approved_a.client!.id } },
    });

    await expect(
      add_cart_item(approved_a, { product_id: out_of_stock_id, qty: 12 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      add_cart_item(approved_a, { product_id: inactive_product_id, qty: 12 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      add_cart_item(approved_a, {
        product_id: inactive_category_product_id,
        qty: 12,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("inactive product already in cart blocks order and keeps cart", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.products.update({
      where: { id: product_id },
      data: { is_active: false },
    });
    await expect(
      create_order_from_cart(approved_a, valid_input(), randomUUID()),
    ).rejects.toMatchObject({
      message: "Некоторые товары больше недоступны",
    });
    expect((await get_cart(approved_a)).items_count).toBe(1);
    await prisma.products.update({
      where: { id: product_id },
      data: { is_active: true },
    });
  });

  it("inactive category for cart item blocks order", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.categories.update({
      where: { id: category_id },
      data: { is_active: false },
    });
    await expect(
      create_order_from_cart(approved_a, valid_input(), randomUUID()),
    ).rejects.toMatchObject({
      message: "Некоторые товары больше недоступны",
    });
    await prisma.categories.update({
      where: { id: category_id },
      data: { is_active: true },
    });
  });

  it("past date and required fields are validated", () => {
    expect(() =>
      create_order_schema.parse({
        address: "",
        desired_delivery_date: "2020-01-01",
        contact_name: "A",
        contact_phone: "123",
        payment_method: "cash",
        is_urgent: false,
      }),
    ).toThrow();

    const past = create_order_schema.safeParse({
      address: "Адрес",
      desired_delivery_date: "2020-01-01",
      contact_name: "Иван",
      contact_phone: "+79281234567",
      payment_method: "bank_transfer",
      is_urgent: false,
    });
    expect(past.success).toBe(false);
    if (!past.success) {
      expect(
        past.error.issues.some(
          (issue) => issue.message === "Дата доставки не может быть в прошлом",
        ),
      ).toBe(true);
    }
  });

  it("order numbers are unique", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const first = await create_order_from_cart(
      approved_a,
      valid_input(),
      randomUUID(),
    );
    await add_cart_item(approved_b, { product_id, qty: 12 });
    const second = await create_order_from_cart(
      approved_b,
      valid_input(),
      randomUUID(),
    );
    expect(first.order.number).not.toBe(second.order.number);
  });

  it("same Idempotency-Key returns the same order once", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const key = randomUUID();
    const first = await create_order_from_cart(approved_a, valid_input(), key);
    const second = await create_order_from_cart(approved_a, valid_input(), key);
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.number).toBe(first.order.number);

    const count = await prisma.orders.count({
      where: { client_id: approved_a.client!.id },
    });
    expect(count).toBe(1);
    expect((await get_cart(approved_a)).items_count).toBe(0);
  });

  it("success details are available only to owner", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const created = await create_order_from_cart(
      approved_a,
      valid_input(),
      randomUUID(),
    );
    const details = await get_order_success_details(approved_a, created.order.id);
    expect(details.order.number).toBe(created.order.number);
    expect(details.order.status_label).toBe("Новый");
    expect(details.order.items_count).toBe(1);

    await expect(
      get_order_success_details(approved_b, created.order.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("changing product name after order does not change snapshot", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const created = await create_order_from_cart(
      approved_a,
      valid_input(),
      randomUUID(),
    );
    await prisma.products.update({
      where: { id: product_id },
      data: { name: "Новое имя после заказа" },
    });
    const item = await prisma.order_items.findFirstOrThrow({
      where: { order_id: created.order.id },
    });
    expect(item.product_name).not.toBe("Новое имя после заказа");
    expect(item.product_name).toContain("Order Product");
  });
});
