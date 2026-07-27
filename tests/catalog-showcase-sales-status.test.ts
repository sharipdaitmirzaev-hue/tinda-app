import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  create_product,
  update_product,
  list_catalog_products,
} from "@/lib/services/products.service";
import { add_cart_item } from "@/lib/services/cart.service";
import {
  create_or_refresh_interest_request,
  list_interest_requests,
} from "@/lib/services/product-interest.service";
import { import_product_prices_from_workbook } from "@/lib/services/product-price-import.service";
import {
  serialize_public_product,
  serialize_approved_client_product,
  assert_public_product_has_no_price,
} from "@/lib/catalog/product-serializers";
import { is_product_orderable_for_cart } from "@/lib/catalog/constants";
import type { AuthUserPayload } from "@/lib/access";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";

async function ensure_base() {
  const role_client = await prisma.roles.upsert({
    where: { code: "client" },
    update: {},
    create: { code: "client", name: "Клиент" },
  });
  const role_manager = await prisma.roles.upsert({
    where: { code: "manager" },
    update: {},
    create: { code: "manager", name: "Менеджер" },
  });
  const role_director = await prisma.roles.upsert({
    where: { code: "director" },
    update: {},
    create: { code: "director", name: "Руководитель" },
  });
  const city = await prisma.cities.upsert({
    where: { name_region: { name: "Махачкала", region: "Республика Дагестан" } },
    update: {},
    create: { name: "Махачкала", region: "Республика Дагестан" },
  });
  const category = await prisma.categories.upsert({
    where: { slug: "test-showcase-cat" },
    update: { is_active: true },
    create: { name: "Тест витрина", slug: "test-showcase-cat", is_active: true },
  });
  return { role_client, role_manager, role_director, city, category };
}

async function make_user(opts: {
  email: string;
  roles: string[];
  client?: { status: string; manager_id?: string | null };
  employee?: { can_view_all_clients?: boolean; can_edit_catalog?: boolean };
}) {
  const base = await ensure_base();
  const password_hash = await bcrypt.hash("TestPass123456", 4);
  const user = await prisma.users.create({
    data: {
      email: opts.email,
      full_name: opts.email,
      password_hash,
      phone: "+79280001111",
      user_roles: {
        create: opts.roles.map((code) => ({
          role: { connect: { code } },
        })),
      },
      ...(opts.employee
        ? {
            employee_profile: {
              create: {
                can_view_all_clients: opts.employee.can_view_all_clients ?? false,
                can_edit_catalog: opts.employee.can_edit_catalog ?? true,
              },
            },
          }
        : {}),
      ...(opts.client
        ? {
            client: {
              create: {
                company_name: `Co ${opts.email}`,
                inn: String(Math.floor(10_000_000_000 + Math.random() * 89_000_000_000)),
                city_id: base.city.id,
                status: opts.client.status,
                manager_id: opts.client.manager_id ?? null,
                contact_name: "Contact",
                phone: "+79280001111",
                email: opts.email,
                address: "addr",
                pdn_accepted_at: new Date(),
              },
            },
          }
        : {}),
    },
    include: {
      client: true,
      employee_profile: true,
      user_roles: { include: { role: true } },
    },
  });

  const payload: AuthUserPayload = {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      roles: user.user_roles.map((r) => r.role.code) as AuthUserPayload["user"]["roles"],
    },
    client: user.client
      ? {
          id: user.client.id,
          status: user.client.status,
          company_name: user.client.company_name,
        }
      : null,
    employee: user.employee_profile
      ? {
          can_view_all_clients: user.employee_profile.can_view_all_clients,
          can_edit_catalog: user.employee_profile.can_edit_catalog,
        }
      : null,
  };
  return { user, payload, base };
}

describe("catalog showcase sales_status", () => {
  beforeEach(async () => {
    await prisma.product_interest_requests.deleteMany({});
    await prisma.cart_items.deleteMany({});
    await prisma.carts.deleteMany({});
    await prisma.products.deleteMany({ where: { sku: { startsWith: "SHW-" } } });
  });

  it("active showcase product may have null price", async () => {
    const { payload, base } = await make_user({
      email: `dir-${Date.now()}@tinda.local`,
      roles: ["director"],
      employee: { can_edit_catalog: true, can_view_all_clients: true },
    });
    const created = await create_product(payload, {
      sku: `SHW-NULL-${Date.now()}`,
      name: "Витрина без цены",
      category_id: base.category.id,
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      availability: "on_order",
      sales_status: "showcase",
      is_active: true,
      price_amount: null,
    });
    expect(created.product.price_amount).toBeNull();
    expect(created.product.sales_status).toBe("showcase");
    expect(created.product.is_active).toBe(true);
  });

  it("showcase is visible to guest and has no price", async () => {
    const { payload, base } = await make_user({
      email: `dir2-${Date.now()}@tinda.local`,
      roles: ["director"],
      employee: { can_edit_catalog: true },
    });
    const created = await create_product(payload, {
      sku: `SHW-GUEST-${Date.now()}`,
      name: "Гостевой витринный",
      category_id: base.category.id,
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      availability: "on_order",
      sales_status: "showcase",
      is_active: true,
      price_amount: null,
    });
    const public_row = serialize_public_product({
      ...created.product,
      price_amount: null,
      price_currency: "RUB",
      created_at: new Date(created.product.created_at),
      updated_at: new Date(created.product.updated_at),
      sales_status: "showcase",
    } as never);
    assert_public_product_has_no_price(public_row);
    const list = await list_catalog_products(null, {
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(list.items.some((i) => i.id === created.product.id)).toBe(true);
    const found = list.items.find((i) => i.id === created.product.id) as {
      price?: unknown;
    };
    expect(found.price).toBeUndefined();
  });

  it("showcase and on_request cannot be added to cart; orderable with price can", async () => {
    const director = await make_user({
      email: `dir3-${Date.now()}@tinda.local`,
      roles: ["director"],
      employee: { can_edit_catalog: true },
    });
    const client = await make_user({
      email: `cli-${Date.now()}@tinda.local`,
      roles: ["client"],
      client: { status: "approved" },
    });
    const showcase = await create_product(director.payload, {
      sku: `SHW-CART-S-${Date.now()}`,
      name: "Showcase cart block",
      category_id: director.base.category.id,
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      availability: "in_stock",
      sales_status: "showcase",
      price_amount: null,
    });
    const on_request = await create_product(director.payload, {
      sku: `SHW-CART-R-${Date.now()}`,
      name: "On request cart block",
      category_id: director.base.category.id,
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      availability: "in_stock",
      sales_status: "on_request",
      price_amount: null,
    });
    await expect(
      add_cart_item(client.payload, {
        product_id: showcase.product.id,
        qty: 12,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      add_cart_item(client.payload, {
        product_id: on_request.product.id,
        qty: 12,
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      create_product(director.payload, {
        sku: `SHW-BAD-ORD-${Date.now()}`,
        name: "Orderable without price",
        category_id: director.base.category.id,
        units_per_package: 12,
        sale_unit: "упаковка",
        min_order_qty: 12,
        availability: "in_stock",
        sales_status: "orderable",
        price_amount: null,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const orderable = await create_product(director.payload, {
      sku: `SHW-CART-O-${Date.now()}`,
      name: "Orderable priced",
      category_id: director.base.category.id,
      units_per_package: 12,
      sale_unit: "упаковка",
      min_order_qty: 12,
      availability: "in_stock",
      sales_status: "orderable",
      price_amount: 199,
    });
    const cart = await add_cart_item(client.payload, {
      product_id: orderable.product.id,
      qty: 12,
    });
    expect(cart.items_count).toBe(1);
    expect(cart.subtotal).toBe(199 * 12);
  });

  it("approved client can send interest; guest/pending cannot; open request not duplicated", async () => {
    const director = await make_user({
      email: `dir4-${Date.now()}@tinda.local`,
      roles: ["director"],
      employee: { can_edit_catalog: true },
    });
    const product = await create_product(director.payload, {
      sku: `SHW-INT-${Date.now()}`,
      name: "Interest product",
      category_id: director.base.category.id,
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      availability: "on_order",
      sales_status: "showcase",
      price_amount: null,
    });
    const approved = await make_user({
      email: `appr-${Date.now()}@tinda.local`,
      roles: ["client"],
      client: { status: "approved" },
    });
    const pending = await make_user({
      email: `pend-${Date.now()}@tinda.local`,
      roles: ["client"],
      client: { status: "pending" },
    });

    await expect(
      create_or_refresh_interest_request(pending.payload, product.product.id, {
        request_type: "interest",
        requested_qty: 12,
      }),
    ).rejects.toMatchObject({ status: 403 });

    const first = await create_or_refresh_interest_request(
      approved.payload,
      product.product.id,
      { request_type: "interest", requested_qty: 12 },
    );
    expect(first.already_registered).toBe(false);
    const second = await create_or_refresh_interest_request(
      approved.payload,
      product.product.id,
      { request_type: "interest", requested_qty: 24 },
    );
    expect(second.already_registered).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    const count = await prisma.product_interest_requests.count({
      where: {
        product_id: product.product.id,
        client_id: approved.payload.client!.id,
      },
    });
    expect(count).toBe(1);
  });

  it("manager sees own clients interests; director sees all", async () => {
    const manager = await make_user({
      email: `mgr-${Date.now()}@tinda.local`,
      roles: ["manager"],
      employee: { can_view_all_clients: false, can_edit_catalog: true },
    });
    const other_manager = await make_user({
      email: `mgr2-${Date.now()}@tinda.local`,
      roles: ["manager"],
      employee: { can_view_all_clients: false, can_edit_catalog: true },
    });
    const director = await make_user({
      email: `dir5-${Date.now()}@tinda.local`,
      roles: ["director"],
      employee: { can_view_all_clients: true, can_edit_catalog: true },
    });
    const own_client = await make_user({
      email: `own-${Date.now()}@tinda.local`,
      roles: ["client"],
      client: { status: "approved", manager_id: manager.user.id },
    });
    const foreign_client = await make_user({
      email: `for-${Date.now()}@tinda.local`,
      roles: ["client"],
      client: { status: "approved", manager_id: other_manager.user.id },
    });
    const product = await create_product(director.payload, {
      sku: `SHW-VIS-${Date.now()}`,
      name: "Visibility product",
      category_id: director.base.category.id,
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      availability: "on_order",
      sales_status: "on_request",
      price_amount: null,
    });
    await create_or_refresh_interest_request(own_client.payload, product.product.id, {
      request_type: "price_request",
      requested_qty: 10,
    });
    await create_or_refresh_interest_request(
      foreign_client.payload,
      product.product.id,
      { request_type: "price_request", requested_qty: 10 },
    );

    const mgr_list = await list_interest_requests(manager.payload, {
      page: 1,
      page_size: 50,
      sort: "newest",
    });
    expect(
      mgr_list.items.every((i) => i.client.id === own_client.payload.client!.id),
    ).toBe(true);
    expect(mgr_list.items.length).toBeGreaterThanOrEqual(1);

    const dir_list = await list_interest_requests(director.payload, {
      page: 1,
      page_size: 50,
      sort: "newest",
    });
    const client_ids = new Set(dir_list.items.map((i) => i.client.id));
    expect(client_ids.has(own_client.payload.client!.id)).toBe(true);
    expect(client_ids.has(foreign_client.payload.client!.id)).toBe(true);
  });

  it("import allows showcase without price; rejects orderable without price; ignores metro_price", async () => {
    const director = await make_user({
      email: `dir6-${Date.now()}@tinda.local`,
      roles: ["director"],
      employee: { can_edit_catalog: true },
    });
    const sku_ok = `SHW-IMP-OK-${Date.now()}`;
    const sku_bad = `SHW-IMP-BAD-${Date.now()}`;
    await create_product(director.payload, {
      sku: sku_ok,
      name: "Import showcase",
      category_id: director.base.category.id,
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      availability: "on_order",
      sales_status: "showcase",
      price_amount: null,
    });
    await create_product(director.payload, {
      sku: sku_bad,
      name: "Import orderable target",
      category_id: director.base.category.id,
      units_per_package: 6,
      sale_unit: "упаковка",
      min_order_qty: 6,
      availability: "on_order",
      sales_status: "showcase",
      price_amount: null,
    });

    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      { sku: sku_ok, sales_status: "showcase", price_amount: "" },
      { sku: sku_bad, sales_status: "orderable", price_amount: "" },
      { sku: sku_ok, metro_price: 999, price_amount: "" },
    ]);
    XLSX.utils.book_append_sheet(book, sheet, "prices");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const result = await import_product_prices_from_workbook(
      director.payload,
      buffer,
    );
    expect(result.results[0]?.ok).toBe(true);
    expect(result.results[1]?.ok).toBe(false);
    expect(result.results[2]?.ok).toBe(false);
    expect(result.results[2]?.error).toMatch(/metro_price/i);
  });

  it("approved serializer hides price for showcase and shows for orderable", () => {
    const base = {
      id: "00000000-0000-0000-0000-000000000001",
      sku: "X",
      name: "N",
      brand: null,
      category_id: "00000000-0000-0000-0000-000000000002",
      volume_text: null,
      package_type: null,
      units_per_package: 1,
      sale_unit: "упаковка",
      min_order_qty: 1,
      allow_piece_sale: false,
      description: null,
      availability: "in_stock",
      is_promo: false,
      is_new: false,
      is_hit: false,
      image_url: null,
      is_active: true,
      price_currency: "RUB",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const showcase = serialize_approved_client_product({
      ...base,
      sales_status: "showcase",
      price_amount: null,
    });
    expect((showcase as { price?: unknown }).price).toBeUndefined();
    const orderable = serialize_approved_client_product({
      ...base,
      sales_status: "orderable",
      price_amount: 120,
    });
    expect(orderable.price?.amount).toBe(120);
    expect(
      is_product_orderable_for_cart({
        is_active: true,
        sales_status: "orderable",
        price_amount: 120,
        availability: "in_stock",
        category_is_active: true,
      }),
    ).toBe(true);
  });
});
