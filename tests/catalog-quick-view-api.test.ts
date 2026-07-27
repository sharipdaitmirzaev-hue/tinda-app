import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  assert_public_product_has_no_price,
  collect_financial_keys,
} from "@/lib/catalog/product-serializers";
import { get_catalog_product } from "@/lib/services/products.service";
import { AppError } from "@/lib/http/errors";

const suffix = `qv_${Date.now()}`;

describe("catalog quick view product endpoint data", () => {
  let approved: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let category_id: string;
  let orderable_id: string;
  let showcase_id: string;
  let inactive_id: string;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_category_ids: string[] = [];

  beforeAll(async () => {
    const manager = await prisma.users.findUniqueOrThrow({
      where: { email: "manager1@tinda.local" },
    });
    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");
    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const inn = randomUUID().replace(/\D/g, "").slice(0, 12).padEnd(12, "7");
    const email = `qv_approved_${suffix}@tinda.local`;
    const user = await prisma.users.create({
      data: {
        email,
        phone: `+7928${inn.slice(0, 7)}`,
        password_hash,
        full_name: "QV Approved",
        user_roles: { create: [{ role_id: role_client.id }] },
        client: {
          create: {
            company_name: "QV Co",
            inn,
            city_id: city.id,
            address: "ул. Тестовая, 1",
            contact_name: "Contact",
            phone: "+79281112233",
            email,
            status: "approved",
            manager_id: manager.id,
            pdn_accepted_at: new Date(),
            approved_at: new Date(),
          },
        },
      },
      include: { client: true },
    });
    cleanup_user_ids.push(user.id);
    if (user.client) cleanup_client_ids.push(user.client.id);
    approved = (await build_auth_payload(user.id))!;

    const category = await prisma.categories.create({
      data: {
        name: `QV Cat ${suffix}`,
        slug: `qv-cat-${suffix}`,
        is_active: true,
        sort_order: 9999,
      },
    });
    category_id = category.id;
    cleanup_category_ids.push(category.id);

    const orderable = await prisma.products.create({
      data: {
        sku: `QV-ORD-${suffix}`,
        name: `QV Orderable ${suffix}`,
        brand: "QVBrand",
        category_id,
        volume_text: "500 мл",
        package_type: "PET",
        units_per_package: 12,
        sale_unit: "шт",
        min_order_qty: 12,
        allow_piece_sale: false,
        description: "Описание для quick view",
        availability: "in_stock",
        sales_status: "orderable",
        is_active: true,
        price_amount: 999.5,
        price_currency: "RUB",
        image_url: "/uploads/products/qv.webp",
      },
    });
    orderable_id = orderable.id;
    cleanup_product_ids.push(orderable.id);

    const showcase = await prisma.products.create({
      data: {
        sku: `QV-SHOW-${suffix}`,
        name: `QV Showcase ${suffix}`,
        brand: "QVBrand",
        category_id,
        volume_text: "1 л",
        package_type: "PET",
        units_per_package: 6,
        sale_unit: "шт",
        min_order_qty: 6,
        allow_piece_sale: false,
        availability: "in_stock",
        sales_status: "showcase",
        is_active: true,
        price_amount: null,
        image_url: null,
      },
    });
    showcase_id = showcase.id;
    cleanup_product_ids.push(showcase.id);

    const inactive = await prisma.products.create({
      data: {
        sku: `QV-INACT-${suffix}`,
        name: `QV Inactive ${suffix}`,
        brand: "QVBrand",
        category_id,
        volume_text: "330 мл",
        package_type: "Банка",
        units_per_package: 24,
        sale_unit: "шт",
        min_order_qty: 24,
        allow_piece_sale: false,
        availability: "in_stock",
        sales_status: "orderable",
        is_active: false,
        price_amount: 100,
        price_currency: "RUB",
      },
    });
    inactive_id = inactive.id;
    cleanup_product_ids.push(inactive.id);
  });

  afterAll(async () => {
    if (cleanup_product_ids.length) {
      await prisma.products.deleteMany({
        where: { id: { in: cleanup_product_ids } },
      });
    }
    if (cleanup_category_ids.length) {
      await prisma.categories.deleteMany({
        where: { id: { in: cleanup_category_ids } },
      });
    }
    if (cleanup_client_ids.length) {
      await prisma.clients.deleteMany({
        where: { id: { in: cleanup_client_ids } },
      });
    }
    if (cleanup_user_ids.length) {
      await prisma.user_roles.deleteMany({
        where: { user_id: { in: cleanup_user_ids } },
      });
      await prisma.users.deleteMany({
        where: { id: { in: cleanup_user_ids } },
      });
    }
  });

  it("guest does not receive closed price fields", async () => {
    const result = await get_catalog_product(null, orderable_id);
    assert_public_product_has_no_price(result.product);
    expect(collect_financial_keys(result.product)).toEqual([]);
    expect(result.product).not.toHaveProperty("price");
    expect(result.product).toMatchObject({
      id: orderable_id,
      sku: `QV-ORD-${suffix}`,
      description: "Описание для quick view",
    });
  });

  it("approved client sees allowed price for orderable", async () => {
    const result = await get_catalog_product(approved, orderable_id);
    expect(result.product).toMatchObject({
      id: orderable_id,
      sales_status: "orderable",
      price: { amount: 999.5, currency: "RUB", unit: "шт" },
    });
  });

  it("showcase product has no price even for approved client", async () => {
    const result = await get_catalog_product(approved, showcase_id);
    expect(result.product).not.toHaveProperty("price");
    expect(result.product).toMatchObject({
      sales_status: "showcase",
      can_add_to_cart: false,
    });
  });

  it("inactive product returns 404", async () => {
    await expect(get_catalog_product(null, inactive_id)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(get_catalog_product(null, inactive_id)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});
