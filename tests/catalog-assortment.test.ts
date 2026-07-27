import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  can_edit_catalog,
  resolve_public_catalog_access,
} from "@/lib/access";
import {
  create_category,
} from "@/lib/services/categories.service";
import {
  create_product,
  list_catalog_products,
} from "@/lib/services/products.service";
import { catalog_products_query_schema } from "@/lib/validators/catalog";
import { assert_public_product_has_no_price } from "@/lib/catalog/product-serializers";
import { add_cart_item } from "@/lib/services/cart.service";
import { AppError } from "@/lib/http/errors";

const suffix = `cat_ux_${Date.now()}`;

describe("catalog assortment filters & pagination", () => {
  let director: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let parent_slug: string;
  let child_slug: string;
  let parent_id: string;
  let child_id: string;
  let showcase_id: string;
  let orderable_id: string;

  const cleanup_category_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];

  beforeAll(async () => {
    director = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;

    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const role_client = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");
    const inn = `${Date.now()}${Math.floor(Math.random() * 100)}`.slice(-10);
    const email = `approved_${suffix}@example.com`;
    const user = await prisma.users.create({
      data: {
        email,
        phone: `+7928${inn.slice(0, 7)}`,
        password_hash,
        full_name: "Approved UX",
        user_roles: { create: [{ role_id: role_client.id }] },
        client: {
          create: {
            company_name: "UX Co",
            inn,
            city_id: city.id,
            status: "approved",
            contact_name: "UX",
            phone: `+7928${inn.slice(0, 7)}`,
            email,
            address: "Махачкала",
            pdn_accepted_at: new Date(),
            approved_at: new Date(),
          },
        },
      },
      include: { client: true },
    });
    cleanup_user_ids.push(user.id);
    cleanup_client_ids.push(user.client!.id);
    approved = (await build_auth_payload(user.id))!;

    parent_slug = `napitki-${suffix}`;
    child_slug = `sok-${suffix}`;
    const parent = await create_category(director, {
      name: `Напитки ${suffix}`,
      slug: parent_slug,
      parent_id: null,
      sort_order: 1,
      is_active: true,
    });
    parent_id = parent.category.id;
    cleanup_category_ids.push(parent_id);

    const child = await create_category(director, {
      name: `Соки ${suffix}`,
      slug: child_slug,
      parent_id,
      sort_order: 1,
      is_active: true,
    });
    child_id = child.category.id;
    cleanup_category_ids.push(child_id);

    const showcase = await create_product(director, {
      sku: `UX-SHOW-${suffix}`,
      name: `Нектар Яблоко Вишня ${suffix}`,
      brand: `БрендА-${suffix}`,
      category_id: child_id,
      volume_text: "1 л",
      package_type: "картон",
      units_per_package: 1,
      sale_unit: "упаковка",
      min_order_qty: 1,
      allow_piece_sale: false,
      description: "вкус яблоко вишня",
      availability: "on_order",
      sales_status: "showcase",
      is_promo: false,
      is_new: true,
      is_hit: false,
      is_active: true,
      price_amount: null,
      price_currency: "RUB",
    });
    showcase_id = showcase.product.id;
    cleanup_product_ids.push(showcase_id);

    const orderable = await create_product(director, {
      sku: `UX-ORD-${suffix}`,
      name: `Сок Апельсин ${suffix}`,
      brand: `БрендБ-${suffix}`,
      category_id: child_id,
      volume_text: "0.5 л",
      package_type: "ПЭТ",
      units_per_package: 1,
      sale_unit: "упаковка",
      min_order_qty: 1,
      allow_piece_sale: false,
      description: null,
      availability: "in_stock",
      sales_status: "orderable",
      is_promo: false,
      is_new: false,
      is_hit: true,
      is_active: true,
      price_amount: 450,
      price_currency: "RUB",
    });
    orderable_id = orderable.product.id;
    cleanup_product_ids.push(orderable_id);
  });

  afterAll(async () => {
    if (cleanup_client_ids.length) {
      await prisma.cart_items.deleteMany({
        where: { cart: { client_id: { in: cleanup_client_ids } } },
      });
      await prisma.carts.deleteMany({
        where: { client_id: { in: cleanup_client_ids } },
      });
    }
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
      await prisma.users.deleteMany({
        where: { id: { in: cleanup_user_ids } },
      });
    }
  });

  it("parses new catalog query params with defaults", () => {
    const parsed = catalog_products_query_schema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.page_size).toBe(24);
    expect(parsed.sort).toBe("name_asc");
  });

  it("searches by name, brand, flavor word and sku", async () => {
    const by_flavor = await list_catalog_products(null, {
      q: "вишня",
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    expect(by_flavor.items.some((item) => item.id === showcase_id)).toBe(true);

    const by_brand = await list_catalog_products(null, {
      q: `БрендБ-${suffix}`,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    expect(by_brand.items.some((item) => item.id === orderable_id)).toBe(true);

    const by_sku = await list_catalog_products(null, {
      q: `UX-SHOW-${suffix}`,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    expect(by_sku.items.map((item) => item.id)).toContain(showcase_id);
  });

  it("filters by category slug including children", async () => {
    const by_parent = await list_catalog_products(null, {
      category: parent_slug,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    const ids = by_parent.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([showcase_id, orderable_id]));
  });

  it("filters by brand, volume and package_type", async () => {
    const by_brand = await list_catalog_products(null, {
      brand: `БрендА-${suffix}`,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    expect(by_brand.items.every((item) => item.brand === `БрендА-${suffix}`)).toBe(
      true,
    );
    expect(by_brand.items.some((item) => item.id === showcase_id)).toBe(true);

    const by_volume = await list_catalog_products(null, {
      volume: "0.5 л",
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(by_volume.items.some((item) => item.id === orderable_id)).toBe(true);
    expect(
      by_volume.items.every(
        (item) => (item.volume_text || "").toLowerCase() === "0.5 л",
      ),
    ).toBe(true);

    const by_pack = await list_catalog_products(null, {
      package_type: "картон",
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(by_pack.items.some((item) => item.id === showcase_id)).toBe(true);
  });

  it("sorts and paginates with total_pages and facets", async () => {
    const sorted = await list_catalog_products(null, {
      category: child_slug,
      page: 1,
      page_size: 1,
      sort: "brand_asc",
    });
    expect(sorted.page_size).toBe(1);
    expect(sorted.total).toBeGreaterThanOrEqual(2);
    expect(sorted.total_pages).toBeGreaterThanOrEqual(2);
    expect(sorted.items).toHaveLength(1);
    expect(sorted.filters.brands.length).toBeGreaterThan(0);
    expect(sorted.filters.volumes.length).toBeGreaterThan(0);
    expect(sorted.filters.package_types.length).toBeGreaterThan(0);
    expect(sorted.filters.categories.length).toBeGreaterThan(0);

    const page2 = await list_catalog_products(null, {
      category: child_slug,
      page: 2,
      page_size: 1,
      sort: "brand_asc",
    });
    expect(page2.items[0]?.id).not.toBe(sorted.items[0]?.id);
  });

  it("guest does not see hidden price; approved sees allowed price", async () => {
    const guest = await list_catalog_products(null, {
      q: `UX-ORD-${suffix}`,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    const guest_item = guest.items.find((item) => item.id === orderable_id);
    expect(guest_item).toBeTruthy();
    assert_public_product_has_no_price(guest_item);
    expect(
      Object.prototype.hasOwnProperty.call(guest_item as object, "price"),
    ).toBe(false);

    const approved_list = await list_catalog_products(approved, {
      q: `UX-ORD-${suffix}`,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    const approved_item = approved_list.items.find(
      (item) => item.id === orderable_id,
    ) as { price?: { amount: number } };
    expect(approved_item?.price?.amount).toBe(450);
  });

  it("showcase cannot be added to cart; orderable can", async () => {
    await expect(
      add_cart_item(approved, { product_id: showcase_id, qty: 1 }),
    ).rejects.toBeInstanceOf(AppError);

    const cart = await add_cart_item(approved, {
      product_id: orderable_id,
      qty: 1,
    });
    expect(
      cart.items.some((item) => item.product_id === orderable_id),
    ).toBe(true);
  });

  it("filters only new and only with price", async () => {
    const news = await list_catalog_products(null, {
      category: child_slug,
      is_new: true,
      page: 1,
      page_size: 24,
      sort: "name_asc",
    });
    expect(news.items.every((item) => item.is_new)).toBe(true);
    expect(news.items.some((item) => item.id === showcase_id)).toBe(true);

    const priced = await list_catalog_products(approved, {
      category: child_slug,
      has_price: true,
      page: 1,
      page_size: 24,
      sort: "has_price_desc",
    });
    expect(priced.items.some((item) => item.id === orderable_id)).toBe(true);
    expect(priced.items.some((item) => item.id === showcase_id)).toBe(false);
  });

  it("catalog editors may open public catalog access", () => {
    expect(can_edit_catalog(director)).toBe(true);
    expect(resolve_public_catalog_access(director)).toEqual({ allow: true });
  });

  it("mobile layout helpers keep page size options usable", () => {
    const parsed = catalog_products_query_schema.parse({
      page_size: "48",
      sort: "is_hit_desc",
    });
    expect(parsed.page_size).toBe(48);
    expect(parsed.sort).toBe("is_hit_desc");
  });
});
