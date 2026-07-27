import { beforeEach, describe, expect, it } from "vitest";
import {
  can_add_to_cart,
  check_qty,
  decrease_qty,
  get_initial_qty,
  get_min_allowed_qty,
  get_order_step,
  increase_qty,
  suggest_qty,
} from "@/lib/quantity";
import {
  add_to_temporary_cart,
  get_temporary_cart_items,
  reset_temporary_cart_for_tests,
} from "@/lib/cart/temporary-cart-store";
import { get_catalog_product } from "@/lib/services/products.service";
import { prisma } from "@/lib/db";
import { build_auth_payload } from "@/lib/auth/current-user";
import { hash_password } from "@/lib/auth/password";

const pack_product = {
  units_per_package: 12,
  min_order_qty: 12,
  allow_piece_sale: false,
  availability: "in_stock",
};

const piece_product = {
  units_per_package: 6,
  min_order_qty: 3,
  allow_piece_sale: true,
  availability: "in_stock",
};

describe("quantity module E1.7", () => {
  it("step = 1 when allow_piece_sale = true", () => {
    expect(get_order_step(piece_product)).toBe(1);
  });

  it("step = units_per_package when allow_piece_sale = false", () => {
    expect(get_order_step(pack_product)).toBe(12);
  });

  it("initial qty is min allowed multiple", () => {
    expect(get_initial_qty(pack_product)).toBe(12);
    expect(get_initial_qty(piece_product)).toBe(3);
    expect(
      get_initial_qty({
        units_per_package: 12,
        min_order_qty: 10,
        allow_piece_sale: false,
        availability: "in_stock",
      }),
    ).toBe(12);
  });

  it("respects min_order_qty", () => {
    const check = check_qty(pack_product, 6);
    expect(check.valid).toBe(false);
    expect(check.qty_error).toBe("below_min");
    expect(check.message).toBe("Минимальное количество заказа: 12.");
  });

  it("rejects fractional qty", () => {
    const check = check_qty(piece_product, 3.5);
    expect(check.valid).toBe(false);
    expect(check.qty_error).toBe("not_integer");
    expect(check.message).toBe("Введите целое количество");
  });

  it("rejects non-multiple qty and suggests ceil", () => {
    const check = check_qty(pack_product, 13);
    expect(check.valid).toBe(false);
    expect(check.qty_error).toBe("not_multiple");
    expect(check.suggested_qty).toBe(24);
    expect(check.message).toContain("кратно 12");
    expect(suggest_qty(pack_product, 13)).toBe(24);
  });

  it("minus does not go below minimum; plus increases by step", () => {
    expect(decrease_qty(pack_product, 12)).toBe(12);
    expect(decrease_qty(pack_product, 24)).toBe(12);
    expect(increase_qty(pack_product, 12)).toBe(24);
    expect(get_min_allowed_qty(pack_product)).toBe(12);
  });

  it("out_of_stock cannot add; on_order can", () => {
    expect(
      can_add_to_cart({ ...pack_product, availability: "out_of_stock" }),
    ).toBe(false);
    expect(
      can_add_to_cart({ ...pack_product, availability: "on_order" }),
    ).toBe(true);
  });
});

describe("temporary cart E1.7", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
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
    reset_temporary_cart_for_tests();
  });

  const product = {
    product_id: "p1",
    name: "Вода",
    sku: "W-100",
    image_url: null,
    ...pack_product,
  };

  it("first add uses initial qty; repeat add increases by step; one row", () => {
    const first = add_to_temporary_cart(product, { mode: "initial_or_step" });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.item.qty).toBe(12);

    const second = add_to_temporary_cart(product, { mode: "initial_or_step" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.item.qty).toBe(24);

    expect(get_temporary_cart_items()).toHaveLength(1);
  });

  it("detail add_qty merges quantities into one row", () => {
    add_to_temporary_cart(product, { mode: "add_qty", qty: 12 });
    add_to_temporary_cart(product, { mode: "add_qty", qty: 24 });
    const items = get_temporary_cart_items();
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(36);
  });

  it("out_of_stock is not added", () => {
    const result = add_to_temporary_cart({
      ...product,
      availability: "out_of_stock",
    });
    expect(result.ok).toBe(false);
    expect(get_temporary_cart_items()).toHaveLength(0);
  });

  it("cart restores from localStorage", () => {
    add_to_temporary_cart(product, { mode: "initial_or_step" });
    reset_temporary_cart_for_tests();
    // keep storage value
    memory.set(
      "tinda_temporary_cart_e16",
      JSON.stringify([
        {
          ...product,
          qty: 24,
        },
      ]),
    );
    const items = get_temporary_cart_items();
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(24);
  });

  it("corrupted localStorage does not crash", () => {
    memory.set("tinda_temporary_cart_e16", "{not-json");
    expect(() => get_temporary_cart_items()).not.toThrow();
    expect(get_temporary_cart_items()).toEqual([]);
  });
});

describe("catalog product API shape E1.7", () => {
  it("detail payload has no price fields", async () => {
    const seed_product = await prisma.products.findFirst({
      where: { sku: "W-001", is_active: true },
    });
    expect(seed_product).toBeTruthy();

    const city = await prisma.cities.findFirstOrThrow({
      where: { is_active: true },
    });
    const role = await prisma.roles.findUniqueOrThrow({
      where: { code: "client" },
    });
    const password_hash = await hash_password("Password1!");
    const suffix = `${Date.now()}`;
    const email = `qty_${suffix}@example.com`;
    const inn = suffix.slice(-10).padStart(10, "1");

    const user = await prisma.users.create({
      data: {
        email,
        phone: `+7928${inn.slice(0, 7)}`,
        password_hash,
        full_name: "Qty Client",
        user_roles: { create: [{ role_id: role.id }] },
        client: {
          create: {
            company_name: "Qty Co",
            inn,
            city_id: city.id,
            status: "approved",
            contact_name: "Qty",
            phone: `+7928${inn.slice(0, 7)}`,
            email,
            address: "Махачкала",
            pdn_accepted_at: new Date(),
            approved_at: new Date(),
          },
        },
      },
    });

    try {
      const payload = await build_auth_payload(user.id);
      const result = await get_catalog_product(payload!, seed_product!.id);
      const keys = Object.keys(result.product).sort();
      expect(keys).toEqual(
        [
          "allow_piece_sale",
          "availability",
          "brand",
          "category",
          "description",
          "id",
          "image_url",
          "is_hit",
          "is_new",
          "is_promo",
          "min_order_qty",
          "name",
          "package_type",
          "sale_unit",
          "sku",
          "units_per_package",
          "volume_text",
        ].sort(),
      );
      expect(JSON.stringify(result.product).toLowerCase()).not.toContain("price");
    } finally {
      await prisma.clients.deleteMany({ where: { user_id: user.id } });
      await prisma.user_roles.deleteMany({ where: { user_id: user.id } });
      await prisma.users.delete({ where: { id: user.id } });
    }
  });
});
