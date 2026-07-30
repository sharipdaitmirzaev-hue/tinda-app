import { describe, expect, it, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthUserPayload } from "@/lib/access";
import { create_product } from "@/lib/services/products.service";
import {
  merge_product_duplicates,
  normalize_all_products,
  type ProductRow,
} from "@/lib/catalog/product-dedupe";
import { AppError } from "@/lib/http/errors";

async function ensure_base() {
  await prisma.roles.upsert({
    where: { code: "client" },
    update: {},
    create: { code: "client", name: "Клиент" },
  });
  await prisma.roles.upsert({
    where: { code: "manager" },
    update: {},
    create: { code: "manager", name: "Менеджер" },
  });
  const city = await prisma.cities.upsert({
    where: {
      name_region: { name: "Махачкала", region: "Республика Дагестан" },
    },
    update: {},
    create: { name: "Махачкала", region: "Республика Дагестан" },
  });
  const category = await prisma.categories.upsert({
    where: { slug: "test-dedupe-cat" },
    update: { is_active: true },
    create: {
      name: "Тест дедуп",
      slug: "test-dedupe-cat",
      is_active: true,
    },
  });
  return { city, category };
}

async function make_editor(email: string): Promise<AuthUserPayload> {
  await ensure_base();
  const password_hash = await bcrypt.hash("TestPass123456", 4);
  const user = await prisma.users.create({
    data: {
      email,
      full_name: email,
      password_hash,
      phone: "+79280002222",
      user_roles: { create: [{ role: { connect: { code: "manager" } } }] },
      employee_profile: {
        create: { can_view_all_clients: false, can_edit_catalog: true },
      },
    },
  });
  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      roles: ["manager"],
    },
    client: null,
    employee: {
      can_view_all_clients: false,
      can_edit_catalog: true,
    },
  };
}

describe("catalog normalize + dedupe integration", () => {
  beforeEach(async () => {
    await prisma.product_interest_requests.deleteMany();
    await prisma.cart_items.deleteMany();
    await prisma.carts.deleteMany();
    await prisma.order_items.deleteMany();
    await prisma.order_status_history.deleteMany();
    await prisma.order_idempotency_keys.deleteMany();
    await prisma.orders.deleteMany();
    await prisma.products.deleteMany({
      where: { sku: { startsWith: "DEDUP-" } },
    });
    await prisma.users.deleteMany({
      where: { email: { startsWith: "dedupe_" } },
    });
  });

  it("normalizes volume on create and rejects re-import of same commercial product", async () => {
    const editor = await make_editor(`dedupe_editor_${Date.now()}@example.com`);
    const { category } = await ensure_base();

    const first = await create_product(editor, {
      sku: `DEDUP-${Date.now()}-A`,
      name: "Сок тестовый 0.5л",
      brand: "TestBrand",
      category_id: category.id,
      volume_text: "0.5л",
      package_type: "пэт",
      units_per_package: 12,
      sale_unit: "уп",
      min_order_qty: 1,
      availability: "in_stock",
      sales_status: "showcase",
    });

    expect(first.product.name).toBe("Сок тестовый 0,5 л");
    expect(first.product.volume_text).toBe("0,5 л");

    await expect(
      create_product(editor, {
        sku: `DEDUP-${Date.now()}-B`,
        name: "Сок тестовый 0,5 л",
        brand: "TestBrand",
        category_id: category.id,
        volume_text: "0,5 л",
        package_type: "пэт",
        units_per_package: 12,
        sale_unit: "уп",
        min_order_qty: 1,
        availability: "in_stock",
        sales_status: "showcase",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    } satisfies Partial<AppError>);
  });

  it("allows same brand/volume with different flavor name", async () => {
    const editor = await make_editor(`dedupe_flavor_${Date.now()}@example.com`);
    const { category } = await ensure_base();
    const suffix = Date.now();

    await create_product(editor, {
      sku: `DEDUP-${suffix}-APPLE`,
      name: "Сок яблочный 1 л",
      brand: "Добрый",
      category_id: category.id,
      volume_text: "1 л",
      package_type: "тетрапак",
      units_per_package: 12,
      sale_unit: "уп",
      min_order_qty: 1,
      availability: "in_stock",
      sales_status: "showcase",
    });

    const peach = await create_product(editor, {
      sku: `DEDUP-${suffix}-PEACH`,
      name: "Сок персиковый 1 л",
      brand: "Добрый",
      category_id: category.id,
      volume_text: "1 л",
      package_type: "тетрапак",
      units_per_package: 12,
      sale_unit: "уп",
      min_order_qty: 1,
      availability: "in_stock",
      sales_status: "showcase",
    });

    expect(peach.product.sku).toBe(`DEDUP-${suffix}-PEACH`);
  });

  it("merges duplicates preserving cart/order/interest links and is idempotent on normalize", async () => {
    const { category, city } = await ensure_base();
    const suffix = Date.now();

    const keeper = await prisma.products.create({
      data: {
        sku: `DEDUP-${suffix}-KEEP`,
        name: "Морс клюквенный 1л",
        brand: "Тест",
        category_id: category.id,
        volume_text: "1л.",
        package_type: "пэт",
        units_per_package: 6,
        sale_unit: "уп",
        min_order_qty: 1,
        availability: "in_stock",
        sales_status: "orderable",
        price_amount: 200,
        image_url: "/uploads/keeper.jpg",
        is_active: true,
      },
    });
    const duplicate = await prisma.products.create({
      data: {
        sku: `DEDUP-${suffix}-DUP`,
        name: "Морс клюквенный 1 л",
        brand: "Тест",
        category_id: category.id,
        volume_text: "1 л",
        package_type: "пэт",
        units_per_package: 6,
        sale_unit: "уп",
        min_order_qty: 1,
        availability: "in_stock",
        sales_status: "orderable",
        price_amount: 200,
        is_active: true,
      },
    });

    const password_hash = await bcrypt.hash("TestPass123456", 4);
    const client_user = await prisma.users.create({
      data: {
        email: `dedupe_client_${suffix}@example.com`,
        full_name: "Client",
        password_hash,
        phone: "+79280003333",
        user_roles: { create: [{ role: { connect: { code: "client" } } }] },
        client: {
          create: {
            company_name: "ООО Тест",
            inn: String(1000000000 + (suffix % 1000000000)).slice(0, 10),
            city_id: city.id,
            status: "approved",
            contact_name: "Иван",
            phone: "+79280003333",
            email: `dedupe_client_${suffix}@example.com`,
            address: "Тест",
            pdn_accepted_at: new Date(),
          },
        },
      },
      include: { client: true },
    });
    const client_id = client_user.client!.id;

    const cart = await prisma.carts.create({
      data: {
        client_id,
        items: {
          create: [{ product_id: duplicate.id, qty: 2 }],
        },
      },
    });

    const order = await prisma.orders.create({
      data: {
        number: `T-DEDUP-${suffix}`,
        client_id,
        created_by_user_id: client_user.id,
        status: "submitted",
        city_id: city.id,
        address_snapshot: "addr",
        contact_name: "Иван",
        contact_phone: "+79280003333",
        desired_delivery_date: new Date("2026-08-01"),
        payment_method: "invoice",
        items: {
          create: [
            {
              product_id: duplicate.id,
              product_name: duplicate.name,
              product_sku: duplicate.sku,
              sale_unit: "уп",
              qty: 1,
              unit_price: 200,
              line_total: 200,
            },
          ],
        },
      },
    });

    await prisma.product_interest_requests.create({
      data: {
        product_id: duplicate.id,
        client_id,
        request_type: "interest",
        status: "new",
      },
    });

    const merge_result = await prisma.$transaction(async (tx) => {
      const rows = (await tx.products.findMany({
        where: { id: { in: [keeper.id, duplicate.id] } },
      })) as ProductRow[];
      return merge_product_duplicates(tx, rows);
    });

    expect(merge_result.keeper_id).toBe(keeper.id);
    expect(merge_result.removed_ids).toEqual([duplicate.id]);
    expect(merge_result.relinked.cart_items).toBe(1);
    expect(merge_result.relinked.order_items).toBe(1);
    expect(merge_result.relinked.interest_requests).toBe(1);

    expect(
      await prisma.products.findUnique({ where: { id: duplicate.id } }),
    ).toBeNull();

    const cart_item = await prisma.cart_items.findFirst({
      where: { cart_id: cart.id },
    });
    expect(cart_item?.product_id).toBe(keeper.id);
    expect(cart_item?.qty).toBe(2);

    const order_item = await prisma.order_items.findFirst({
      where: { order_id: order.id },
    });
    expect(order_item?.product_id).toBe(keeper.id);
    expect(order_item?.unit_price.toString()).toBe("200");

    const interest = await prisma.product_interest_requests.findFirst({
      where: { client_id },
    });
    expect(interest?.product_id).toBe(keeper.id);

    const updated_keeper = await prisma.products.findUniqueOrThrow({
      where: { id: keeper.id },
    });
    expect(updated_keeper.name).toBe("Морс клюквенный 1 л");
    expect(updated_keeper.volume_text).toBe("1 л");
    expect(updated_keeper.image_url).toBe("/uploads/keeper.jpg");
    expect(Number(updated_keeper.price_amount)).toBe(200);

    const first = await normalize_all_products(prisma, { apply: true });
    const second = await normalize_all_products(prisma, { apply: true });
    expect(second.name_updates).toBe(0);
    expect(second.volume_updates).toBe(0);
    expect(first.scanned).toBeGreaterThan(0);
  });
});
