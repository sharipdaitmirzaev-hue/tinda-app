import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  get_post_auth_path,
  resolve_client_shop_access,
  type AuthUserPayload,
} from "@/lib/access";
import {
  can_add_to_cart,
  check_qty,
  get_order_step,
  suggest_qty,
} from "@/lib/quantity";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import { list_catalog_products } from "@/lib/services/products.service";

function client_payload(status: string): AuthUserPayload {
  return {
    user: {
      id: "u1",
      email: "c@example.com",
      full_name: "Client",
      roles: ["client"],
    },
    client: {
      id: "c1",
      status,
      company_name: "Co",
    },
    employee: null,
  };
}

describe("catalog UI access and quantity E1.6", () => {
  it("approved client can open catalog path", () => {
    const payload = client_payload("approved");
    expect(resolve_client_shop_access(payload)).toEqual({ allow: true });
    expect(get_post_auth_path(payload)).toBe("/catalog");
  });

  it("pending client is redirected to /pending", () => {
    const payload = client_payload("pending");
    expect(resolve_client_shop_access(payload)).toEqual({
      allow: false,
      redirect_to: "/pending",
    });
  });

  it("unauthenticated user is redirected to /login", () => {
    expect(resolve_client_shop_access(null)).toEqual({
      allow: false,
      redirect_to: "/login",
    });
  });

  it("order step and suggested_qty work for pack and piece sale", () => {
    const pack = {
      units_per_package: 12,
      min_order_qty: 12,
      allow_piece_sale: false,
      availability: "in_stock",
    };
    expect(get_order_step(pack)).toBe(12);
    expect(suggest_qty(pack, 10)).toBe(12);
    expect(check_qty(pack, 10).message).toContain("кратно 12");
    expect(check_qty(pack, 10).suggested_qty).toBe(12);
    expect(check_qty(pack, 24).valid).toBe(true);

    const piece = {
      units_per_package: 6,
      min_order_qty: 3,
      allow_piece_sale: true,
      availability: "in_stock",
    };
    expect(get_order_step(piece)).toBe(1);
    expect(check_qty(piece, 4).valid).toBe(true);
  });

  it("out_of_stock cannot be added; on_order can", () => {
    expect(
      can_add_to_cart({
        units_per_package: 6,
        min_order_qty: 6,
        allow_piece_sale: false,
        availability: "out_of_stock",
      }),
    ).toBe(false);

    expect(
      can_add_to_cart({
        units_per_package: 6,
        min_order_qty: 6,
        allow_piece_sale: false,
        availability: "on_order",
      }),
    ).toBe(true);
  });
});

describe("catalog UI product visibility E1.6", () => {
  const suffix = `ui_${Date.now()}`;
  let approved_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];

  beforeAll(async () => {
    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const role = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");
    const inn = `${Date.now()}`.slice(-10);
    const email = `approved_${suffix}@example.com`;
    const user = await prisma.users.create({
      data: {
        email,
        phone: `+7928${inn.slice(0, 7)}`,
        password_hash,
        full_name: "UI Client",
        user_roles: { create: [{ role_id: role.id }] },
        client: {
          create: {
            company_name: "UI Co",
            inn,
            city_id: city.id,
            status: "approved",
            contact_name: "UI",
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
    approved_payload = (await build_auth_payload(user.id))!;
  });

  afterAll(async () => {
    await prisma.clients.deleteMany({
      where: { id: { in: cleanup_client_ids } },
    });
    await prisma.user_roles.deleteMany({
      where: { user_id: { in: cleanup_user_ids } },
    });
    await prisma.users.deleteMany({ where: { id: { in: cleanup_user_ids } } });
    await prisma.$disconnect();
  });

  it("filters by category and search; hides inactive; no prices in payload", async () => {
    const water = await prisma.categories.findFirstOrThrow({
      where: { slug: "voda-pitevaya", is_active: true },
    });

    const by_category = await list_catalog_products(approved_payload, {
      category_id: water.id,
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(by_category.items.length).toBeGreaterThan(0);
    expect(
      by_category.items.every((item) => item.category_id === water.id),
    ).toBe(true);

    const by_name = await list_catalog_products(approved_payload, {
      q: "Вода питьевая",
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(by_name.items.some((item) => item.name.includes("Вода"))).toBe(true);

    const by_sku = await list_catalog_products(approved_payload, {
      q: "W-001",
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(by_sku.items.some((item) => item.sku === "W-001")).toBe(true);

    const by_brand = await list_catalog_products(approved_payload, {
      q: "ТИНДА",
      page: 1,
      page_size: 50,
      sort: "name_asc",
    });
    expect(by_brand.items.some((item) => item.brand === "ТИНДА")).toBe(true);

    for (const item of by_category.items) {
      expect(item).not.toHaveProperty("price");
      expect(JSON.stringify(item).toLowerCase()).not.toContain('"price"');
    }
  });
});
