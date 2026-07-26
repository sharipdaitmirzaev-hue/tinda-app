import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hash_password } from "@/lib/auth/password";
import { build_auth_payload } from "@/lib/auth/current-user";
import {
  add_cart_item,
  clear_cart,
  get_cart,
  remove_cart_item,
  serialize_cart,
  update_cart_item,
} from "@/lib/services/cart.service";
import {
  CART_MIGRATION_FLAG_KEY,
  TEMPORARY_CART_STORAGE_KEY,
  migrate_temporary_cart_once,
  reset_server_cart_store_for_tests,
} from "@/lib/cart/server-cart-store";

const suffix = `cart_${Date.now()}`;
const memory = new Map<string, string>();

describe("server cart E1.8", () => {
  let director_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let manager_payload: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;
  let approved_a: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let approved_b: NonNullable<Awaited<ReturnType<typeof build_auth_payload>>>;
  let pending_client: NonNullable<
    Awaited<ReturnType<typeof build_auth_payload>>
  >;

  let category_id: string;
  let inactive_category_id: string;
  let product_id: string;
  let product_b_id: string;
  let out_of_stock_id: string;
  let inactive_product_id: string;
  let inactive_category_product_id: string;

  const cleanup_user_ids: string[] = [];
  const cleanup_client_ids: string[] = [];
  const cleanup_product_ids: string[] = [];
  const cleanup_category_ids: string[] = [];

  beforeAll(async () => {
    director_payload = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "director@tinda.local" },
        })
      ).id,
    ))!;
    manager_payload = (await build_auth_payload(
      (
        await prisma.users.findUniqueOrThrow({
          where: { email: "manager1@tinda.local" },
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
              address: "Махачкала",
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

    approved_a = await make_client("approved", "CartA");
    approved_b = await make_client("approved", "CartB");
    pending_client = await make_client("pending", "CartPending");

    const category = await prisma.categories.create({
      data: {
        name: `Cart Cat ${suffix}`,
        slug: `cart-cat-${suffix}`,
        sort_order: 1,
        is_active: true,
      },
    });
    category_id = category.id;
    cleanup_category_ids.push(category.id);

    const inactive_category = await prisma.categories.create({
      data: {
        name: `Cart Inactive Cat ${suffix}`,
        slug: `cart-inactive-cat-${suffix}`,
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
        units_per_package?: number;
        min_order_qty?: number;
        allow_piece_sale?: boolean;
      } = {},
    ) {
      const product = await prisma.products.create({
        data: {
          sku,
          name: `Product ${sku}`,
          brand: "TestBrand",
          category_id: data.category_id ?? category_id,
          volume_text: "0.5 л",
          package_type: "коробка",
          units_per_package: data.units_per_package ?? 12,
          sale_unit: "шт",
          min_order_qty: data.min_order_qty ?? 12,
          allow_piece_sale: data.allow_piece_sale ?? false,
          availability: data.availability ?? "in_stock",
          is_active: data.is_active ?? true,
          image_url: null,
        },
      });
      cleanup_product_ids.push(product.id);
      return product.id;
    }

    product_id = await make_product(`C-${suffix}-1`);
    product_b_id = await make_product(`C-${suffix}-2`);
    out_of_stock_id = await make_product(`C-${suffix}-oos`, {
      availability: "out_of_stock",
    });
    inactive_product_id = await make_product(`C-${suffix}-off`, {
      is_active: false,
    });
    inactive_category_product_id = await make_product(`C-${suffix}-cat`, {
      category_id: inactive_category_id,
    });
  });

  beforeEach(async () => {
    await prisma.cart_items.deleteMany({
      where: { cart: { client_id: { in: cleanup_client_ids } } },
    });
    await prisma.carts.deleteMany({
      where: { client_id: { in: cleanup_client_ids } },
    });
    memory.clear();
    // @ts-expect-error test localStorage mock
    globalThis.localStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
    reset_server_cart_store_for_tests();
  });

  afterAll(async () => {
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

  it("approved client gets own empty cart", async () => {
    const cart = await get_cart(approved_a);
    expect(cart.items).toEqual([]);
    expect(cart.items_count).toBe(0);
    expect(cart.total_qty).toBe(0);
    expect(cart.is_ready_to_checkout).toBe(false);
  });

  it("one client does not see another client's cart", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const cart_b = await get_cart(approved_b);
    expect(cart_b.items_count).toBe(0);
    const cart_a = await get_cart(approved_a);
    expect(cart_a.items_count).toBe(1);
    expect(cart_a.items[0]?.product_id).toBe(product_id);
  });

  it("pending client cannot access cart", async () => {
    await expect(get_cart(pending_client)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("manager and director cannot use client cart", async () => {
    await expect(get_cart(manager_payload)).rejects.toMatchObject({
      status: 403,
    });
    await expect(get_cart(director_payload)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("add creates item; repeat add increases qty; same product stays one row", async () => {
    const first = await add_cart_item(approved_a, { product_id, qty: 12 });
    expect(first.items_count).toBe(1);
    expect(first.items[0]?.qty).toBe(12);
    expect(first.total_qty).toBe(12);
    expect(first.is_ready_to_checkout).toBe(true);

    const second = await add_cart_item(approved_a, { product_id, qty: 12 });
    expect(second.items_count).toBe(1);
    expect(second.items[0]?.qty).toBe(24);
    expect(second.total_qty).toBe(24);

    const with_other = await add_cart_item(approved_a, {
      product_id: product_b_id,
      qty: 12,
    });
    expect(with_other.items_count).toBe(2);
    expect(with_other.total_qty).toBe(36);
  });

  it("PATCH replaces qty", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    const updated = await update_cart_item(approved_a, product_id, 36);
    expect(updated.items[0]?.qty).toBe(36);
    expect(updated.total_qty).toBe(36);
  });

  it("DELETE removes item; DELETE cart clears all", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await add_cart_item(approved_a, { product_id: product_b_id, qty: 12 });
    const after_remove = await remove_cart_item(approved_a, product_id);
    expect(after_remove.items_count).toBe(1);
    expect(after_remove.items[0]?.product_id).toBe(product_b_id);

    const cleared = await clear_cart(approved_a);
    expect(cleared.items_count).toBe(0);
    expect(cleared.total_qty).toBe(0);
    expect(cleared.is_ready_to_checkout).toBe(false);
  });

  it("rejects out_of_stock, inactive product, inactive category", async () => {
    await expect(
      add_cart_item(approved_a, { product_id: out_of_stock_id, qty: 12 }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Товара временно нет",
    });

    await expect(
      add_cart_item(approved_a, { product_id: inactive_product_id, qty: 12 }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Товар недоступен",
    });

    await expect(
      add_cart_item(approved_a, {
        product_id: inactive_category_product_id,
        qty: 12,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Категория товара недоступна",
    });
  });

  it("rejects non-multiple and below-min qty", async () => {
    await expect(
      add_cart_item(approved_a, { product_id, qty: 18 }),
    ).rejects.toMatchObject({
      status: 400,
    });

    await expect(
      add_cart_item(approved_a, { product_id, qty: 6 }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Минимальное количество заказа: 12.",
    });
  });

  it("broken item blocks checkout and returns suggested_qty", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.cart_items.updateMany({
      where: {
        product_id,
        cart: { client_id: approved_a.client!.id },
      },
      data: { qty: 18 },
    });

    const cart = await get_cart(approved_a);
    expect(cart.items[0]?.qty_error).toBe("not_multiple");
    expect(cart.items[0]?.suggested_qty).toBe(24);
    expect(cart.is_ready_to_checkout).toBe(false);
    expect(cart.items_count).toBe(1);
    expect(cart.total_qty).toBe(18);
  });

  it("out_of_stock item in cart is kept with qty_error", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.products.update({
      where: { id: product_id },
      data: { availability: "out_of_stock" },
    });

    const cart = await get_cart(approved_a);
    expect(cart.items_count).toBe(1);
    expect(cart.items[0]?.qty_error).toBe("out_of_stock");
    expect(cart.items[0]?.suggested_qty).toBeNull();
    expect(cart.is_ready_to_checkout).toBe(false);

    await prisma.products.update({
      where: { id: product_id },
      data: { availability: "in_stock" },
    });
  });

  it("inactive product in cart is kept with qty_error inactive", async () => {
    await add_cart_item(approved_a, { product_id, qty: 12 });
    await prisma.products.update({
      where: { id: product_id },
      data: { is_active: false },
    });

    const cart = await get_cart(approved_a);
    expect(cart.items[0]?.qty_error).toBe("inactive");
    expect(cart.is_ready_to_checkout).toBe(false);

    await prisma.products.update({
      where: { id: product_id },
      data: { is_active: true },
    });
  });

  it("API cart payload has no price fields", async () => {
    const cart = await add_cart_item(approved_a, { product_id, qty: 12 });
    const json = JSON.stringify(cart);
    expect(json.toLowerCase()).not.toContain("price");
    expect(json.toLowerCase()).not.toContain("цена");
    expect(cart.items[0]?.product).not.toHaveProperty("price");
  });

  it("serialize_cart counts items and units correctly", () => {
    const cart = serialize_cart([
      {
        product_id: "p1",
        qty: 12,
        product: {
          id: "p1",
          sku: "A",
          name: "A",
          brand: null,
          volume_text: null,
          package_type: null,
          units_per_package: 12,
          sale_unit: "шт",
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: "in_stock",
          image_url: null,
          is_active: true,
          category: { is_active: true },
        },
      },
      {
        product_id: "p2",
        qty: 24,
        product: {
          id: "p2",
          sku: "B",
          name: "B",
          brand: null,
          volume_text: null,
          package_type: null,
          units_per_package: 12,
          sale_unit: "шт",
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: "in_stock",
          image_url: null,
          is_active: true,
          category: { is_active: true },
        },
      },
    ]);
    expect(cart.items_count).toBe(2);
    expect(cart.total_qty).toBe(36);
    expect(cart.is_ready_to_checkout).toBe(true);
  });

  it("localStorage migration imports once and clears temporary cart", async () => {
    memory.set(
      TEMPORARY_CART_STORAGE_KEY,
      JSON.stringify([
        {
          product_id,
          name: "X",
          sku: "X",
          image_url: null,
          units_per_package: 12,
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: "in_stock",
          qty: 12,
        },
        {
          product_id,
          name: "X",
          sku: "X",
          image_url: null,
          units_per_package: 12,
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: "in_stock",
          qty: 12,
        },
        {
          product_id: out_of_stock_id,
          name: "OOS",
          sku: "OOS",
          image_url: null,
          units_per_package: 12,
          min_order_qty: 12,
          allow_piece_sale: false,
          availability: "out_of_stock",
          qty: 12,
        },
      ]),
    );

    const posted: Array<{ product_id: string; qty: number }> = [];
    const message = await migrate_temporary_cart_once(async (id, qty) => {
      posted.push({ product_id: id, qty });
      await add_cart_item(approved_a, { product_id: id, qty });
    });

    expect(message).toBe("Товары из временной корзины перенесены");
    expect(posted).toEqual([{ product_id, qty: 24 }]);
    expect(memory.get(TEMPORARY_CART_STORAGE_KEY)).toBeUndefined();
    expect(memory.get(CART_MIGRATION_FLAG_KEY)).toBe("1");

    const second = await migrate_temporary_cart_once(async () => {
      throw new Error("should not run again");
    });
    expect(second).toBeNull();
    expect(posted).toHaveLength(1);

    const cart = await get_cart(approved_a);
    expect(cart.items_count).toBe(1);
    expect(cart.items[0]?.qty).toBe(24);
  });
});
