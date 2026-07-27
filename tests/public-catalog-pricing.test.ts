import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  assert_public_product_has_no_price,
  serialize_approved_client_product,
  serialize_public_product,
  serialize_staff_product,
} from "@/lib/catalog/product-serializers";
import { calc_line_total, money_to_number, sum_money } from "@/lib/money";
import { add_cart_item, get_cart } from "@/lib/services/cart.service";
import {
  create_order_from_cart,
  get_client_order,
} from "@/lib/services/order.service";
import { import_product_prices_from_workbook } from "@/lib/services/product-price-import.service";
import {
  get_catalog_product,
  list_catalog_products,
  update_product,
} from "@/lib/services/products.service";
import { create_order_schema } from "@/lib/validators/orders";
import { today_date_key } from "@/lib/dates";
import { collect_forbidden_keys } from "@/lib/security/forbidden-response-keys";

const suffix = `price_${Date.now()}`;

describe("public catalog pricing", () => {
  let director: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let pending: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let rejected: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let blocked: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let manager: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;

  let category_id: string;
  let product_id: string;
  let inactive_id: string;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_category_ids: string[] = [];

  beforeAll(async () => {
    director = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;
    manager = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "manager1@tinda.local" },
        })
      ).id,
    ))!;

    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");
    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });

    async function make_client(status: string, label: string) {
      const inn = randomUUID().replace(/\D/g, "").slice(0, 12).padEnd(12, "7");
      const email = `${label}_${suffix}@tinda.local`;
      const user = await prisma.users.create({
        data: {
          email,
          phone: `+7928${inn.slice(0, 7)}`,
          password_hash,
          full_name: `Client ${label}`,
          user_roles: { create: [{ role_id: role_client.id }] },
          client: {
            create: {
              company_name: `Co ${label}`,
              inn,
              city_id: city.id,
              address: "ул. Тестовая, 1",
              contact_name: `Contact ${label}`,
              phone: "+79281112233",
              email,
              status,
              manager_id: manager.user.id,
              pdn_accepted_at: new Date(),
              approved_at: status === "approved" ? new Date() : null,
            },
          },
        },
        include: { client: true },
      });
      cleanup_user_ids.push(user.id);
      if (user.client) cleanup_client_ids.push(user.client.id);
      return (await build_auth_payload(user.id))!;
    }

    approved = await make_client("approved", "appr");
    pending = await make_client("pending", "pend");
    rejected = await make_client("rejected", "rej");
    blocked = await make_client("blocked", "blk");

    const category = await prisma.categories.create({
      data: {
        name: `Price Cat ${suffix}`,
        slug: `price-cat-${suffix}`,
        sort_order: 1,
        is_active: true,
      },
    });
    category_id = category.id;
    cleanup_category_ids.push(category.id);

    const product = await prisma.products.create({
      data: {
        sku: `PR-${suffix}`,
        name: `Price Product ${suffix}`,
        brand: "Test",
        category_id,
        volume_text: "1 л",
        package_type: "бутылка",
        units_per_package: 6,
        sale_unit: "упаковка",
        min_order_qty: 6,
        allow_piece_sale: false,
        availability: "in_stock",
        sales_status: "orderable",
        is_active: true,
        price_amount: 100.5,
        price_currency: "RUB",
      },
    });
    product_id = product.id;
    cleanup_product_ids.push(product.id);

    const inactive = await prisma.products.create({
      data: {
        sku: `PR-IN-${suffix}`,
        name: `Inactive ${suffix}`,
        brand: "Test",
        category_id,
        units_per_package: 1,
        sale_unit: "шт",
        min_order_qty: 1,
        availability: "in_stock",
        sales_status: "orderable",
        is_active: false,
        price_amount: 50,
        price_currency: "RUB",
      },
    });
    inactive_id = inactive.id;
    cleanup_product_ids.push(inactive.id);
  });

  afterAll(async () => {
    if (cleanup_product_ids.length) {
      await prisma.cart_items.deleteMany({
        where: { product_id: { in: cleanup_product_ids } },
      });
      await prisma.order_items.deleteMany({
        where: { product_id: { in: cleanup_product_ids } },
      });
      await prisma.products.deleteMany({
        where: { id: { in: cleanup_product_ids } },
      });
    }
    if (cleanup_client_ids.length) {
      await prisma.carts.deleteMany({
        where: { client_id: { in: cleanup_client_ids } },
      });
      await prisma.orders.deleteMany({
        where: { client_id: { in: cleanup_client_ids } },
      });
      await prisma.clients.deleteMany({
        where: { id: { in: cleanup_client_ids } },
      });
    }
    if (cleanup_user_ids.length) {
      await prisma.sessions.deleteMany({
        where: { user_id: { in: cleanup_user_ids } },
      });
      await prisma.user_roles.deleteMany({
        where: { user_id: { in: cleanup_user_ids } },
      });
      await prisma.users.deleteMany({ where: { id: { in: cleanup_user_ids } } });
    }
    if (cleanup_category_ids.length) {
      await prisma.categories.deleteMany({
        where: { id: { in: cleanup_category_ids } },
      });
    }
  });

  it("serializers: public has no price; approved and staff expose price", async () => {
    const product = await prisma.products.findUniqueOrThrow({
      where: { id: product_id },
      include: { category: true },
    });
    const public_payload = serialize_public_product(product);
    assert_public_product_has_no_price(public_payload);
    expect(public_payload).not.toHaveProperty("price");
    expect(public_payload).not.toHaveProperty("price_amount");

    const approved_payload = serialize_approved_client_product(product);
    expect(approved_payload.price).toEqual({
      amount: 100.5,
      currency: "RUB",
      unit: "упаковка",
    });

    const staff_payload = serialize_staff_product(product);
    expect(staff_payload.price_amount).toBe(100.5);
    expect(staff_payload.price?.amount).toBe(100.5);
  });

  it("guest/pending/rejected/blocked catalog API has no price; approved has price", async () => {
    const guest = await list_catalog_products(null, {
      page: 1,
      page_size: 50,
      sort: "name_asc",
      q: `PR-${suffix}`,
    });
    const guest_item = guest.items.find((item) => item.id === product_id);
    expect(guest_item).toBeTruthy();
    expect(guest_item).not.toHaveProperty("price");
    expect(collect_forbidden_keys(guest_item)).toEqual([]);

    for (const payload of [pending, rejected, blocked]) {
      const list = await list_catalog_products(payload, {
        page: 1,
        page_size: 50,
        sort: "name_asc",
        q: `PR-${suffix}`,
      });
      const item = list.items.find((row) => row.id === product_id);
      expect(item).toBeTruthy();
      expect(item).not.toHaveProperty("price");
      expect(collect_forbidden_keys(item)).toEqual([]);
    }

    const approved_list = await list_catalog_products(approved, {
      page: 1,
      page_size: 50,
      sort: "name_asc",
      q: `PR-${suffix}`,
    });
    const priced = approved_list.items.find((row) => row.id === product_id);
    expect(priced).toBeTruthy();
    expect(priced).toHaveProperty("price");
    expect(
      (priced as unknown as { price: { amount: number } }).price.amount,
    ).toBe(100.5);
    expect(
      collect_forbidden_keys(priced, "", { allow_client_price: true }),
    ).toEqual([]);

    const staff_detail = await list_catalog_products(manager, {
      page: 1,
      page_size: 50,
      sort: "name_asc",
      q: `PR-${suffix}`,
    });
    // staff on public catalog API must not get client prices
    expect(staff_detail.items.find((row) => row.id === product_id)).not.toHaveProperty(
      "price",
    );
  });

  it("inactive product is unavailable to guests", async () => {
    await expect(get_catalog_product(null, inactive_id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("guest cannot use cart; cart prices come from DB; body price ignored", async () => {
    await expect(
      add_cart_item(pending, { product_id, qty: 6 }),
    ).rejects.toMatchObject({ status: 403 });

    const cart = await add_cart_item(approved, {
      product_id,
      qty: 6,
      // @ts-expect-error intentional client tampering
      unit_price: 1,
      price: 1,
    });
    const line = cart.items.find((item) => item.product_id === product_id);
    expect(line?.unit_price).toBe(100.5);
    expect(line?.line_total).toBe(603);
    expect(cart.subtotal).toBe(603);
    expect(cart.delivery_total).toBe(0);
    expect(cart.total).toBe(603);
  });

  it("order stores price snapshot; later product price change does not alter order", async () => {
    await update_product(director, product_id, { price_amount: 100.5 });
    const { update_cart_item, remove_cart_item } = await import(
      "@/lib/services/cart.service"
    );
    await remove_cart_item(approved, product_id).catch(() => undefined);
    await add_cart_item(approved, { product_id, qty: 6 });
    await update_cart_item(approved, product_id, 6);

    const parsed = create_order_schema.parse({
      address: "ул. Снимок, 1",
      contact_name: "Тест",
      contact_phone: "+79281112233",
      desired_delivery_date: today_date_key(),
      payment_method: "cash_on_delivery",
      is_urgent: false,
      client_comment: null,
    });
    const created = await create_order_from_cart(
      approved,
      parsed,
      `idem-${randomUUID()}`,
    );

    try {
      await update_product(director, product_id, { price_amount: 999 });

      const details = await get_client_order(approved, created.order.id);
      const item = details.order.items.find(
        (row) => row.product_sku === `PR-${suffix}`,
      );
      expect(item?.unit_price).toBe(100.5);
      expect(item?.line_total).toBe(603);
      expect(details.order.subtotal).toBe(603);
      expect(details.order.total).toBe(603);
    } finally {
      await update_product(director, product_id, { price_amount: 100.5 });
    }
  });

  it("Decimal money helpers avoid float drift", () => {
    const line = calc_line_total("0.1", 3);
    expect(money_to_number(line)).toBe(0.3);
    expect(money_to_number(sum_money(["0.1", "0.2"]))).toBe(0.3);
  });

  it("excel import updates price_amount and flags bad rows", async () => {
    const other = await prisma.products.create({
      data: {
        sku: `PR-IMP-${suffix}`,
        name: `Import ${suffix}`,
        category_id,
        units_per_package: 1,
        sale_unit: "шт",
        min_order_qty: 1,
        availability: "in_stock",
        sales_status: "orderable",
        is_active: true,
        price_amount: 10,
        price_currency: "RUB",
      },
    });
    cleanup_product_ids.push(other.id);

    const sheet = XLSX.utils.json_to_sheet([
      { sku: other.sku, price_amount: "" },
      { sku: "MISSING-SKU", price_amount: 12 },
      { sku: other.sku, price_amount: -3 },
      { sku: other.sku, price_amount: 55.25, sales_status: "orderable" },
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "prices");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const result = await import_product_prices_from_workbook(director, buffer);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(2);

    const refreshed = await prisma.products.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(money_to_number(refreshed.price_amount!)).toBe(55.25);
  });

  it("get_cart after mutations still reads DB price", async () => {
    await update_product(director, product_id, { price_amount: 100.5 });
    const { remove_cart_item } = await import("@/lib/services/cart.service");
    await remove_cart_item(approved, product_id).catch(() => undefined);
    await add_cart_item(approved, { product_id, qty: 6 });
    const cart = await get_cart(approved);
    const line = cart.items.find((item) => item.product_id === product_id);
    expect(line?.unit_price).toBe(100.5);
  });
});
