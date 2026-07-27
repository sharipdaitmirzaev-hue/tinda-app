import { describe, expect, it } from "vitest";
import {
  dedupe_viko_by_flavor,
  HOMEPAGE_FEATURED_ENTRIES,
  HOMEPAGE_FEATURED_INITIAL_VISIBLE,
  resolve_homepage_featured_products,
  sort_still_water_products,
  split_initial_featured,
  STILL_WATER_CATEGORY_SLUG,
  type FeaturedProductLike,
  type HomepageFeaturedEntry,
} from "@/lib/catalog/homepage-featured";
import { is_product_orderable_for_cart } from "@/lib/catalog/constants";
import {
  serialize_approved_client_product,
  serialize_public_product,
  assert_public_product_has_no_price,
} from "@/lib/catalog/product-serializers";

function p(
  partial: Partial<FeaturedProductLike> & Pick<FeaturedProductLike, "id" | "sku" | "name">,
): FeaturedProductLike {
  return {
    brand: partial.brand ?? null,
    volume_text: partial.volume_text ?? null,
    package_type: partial.package_type ?? null,
    is_active: partial.is_active ?? true,
    category_slug: partial.category_slug ?? null,
    ...partial,
  };
}

describe("homepage featured resolve", () => {
  it("keeps configured SKU order and skips missing/inactive", () => {
    const entries: HomepageFeaturedEntry[] = [
      { type: "sku", sku: "A", group: "coca_cola" },
      { type: "sku", sku: "MISSING", group: "sprite" },
      { type: "sku", sku: "B", group: "borjomi" },
      { type: "sku", sku: "INACTIVE", group: "rychal" },
    ];
    const by_sku = new Map([
      ["A", p({ id: "1", sku: "A", name: "Cola" })],
      ["B", p({ id: "2", sku: "B", name: "Borjomi" })],
      ["INACTIVE", p({ id: "3", sku: "INACTIVE", name: "X", is_active: false })],
    ]);
    const ordered = resolve_homepage_featured_products({
      entries,
      by_sku,
      by_category_slug: new Map(),
    });
    expect(ordered.map((x) => x.sku)).toEqual(["A", "B"]);
  });

  it("does not include carbonated water category in still-water group", () => {
    const entries: HomepageFeaturedEntry[] = [
      {
        type: "category",
        slug: STILL_WATER_CATEGORY_SLUG,
        group: "still_water",
        exclude_slugs: ["voda-gazirovannaya"],
      },
    ];
    const by_category_slug = new Map([
      [
        STILL_WATER_CATEGORY_SLUG,
        [
          p({
            id: "w1",
            sku: "W1",
            name: "Вода негаз",
            brand: "Архыз",
            category_slug: STILL_WATER_CATEGORY_SLUG,
          }),
        ],
      ],
      [
        "voda-gazirovannaya",
        [
          p({
            id: "g1",
            sku: "G1",
            name: "Вода газ",
            brand: "Боржоми",
            category_slug: "voda-gazirovannaya",
          }),
        ],
      ],
    ]);
    const ordered = resolve_homepage_featured_products({
      entries,
      by_sku: new Map(),
      by_category_slug,
    });
    expect(ordered.map((x) => x.sku)).toEqual(["W1"]);
    expect(ordered.every((x) => x.category_slug === STILL_WATER_CATEGORY_SLUG)).toBe(
      true,
    );
  });

  it("sorts still water: known brands, then name, then volume", () => {
    const sorted = sort_still_water_products([
      p({
        id: "1",
        sku: "Z",
        name: "Вода Яя",
        brand: "Неизвестный",
        volume_text: "1 л",
      }),
      p({
        id: "2",
        sku: "A",
        name: "Вода Аква 1л",
        brand: "Аква",
        volume_text: "1 л",
      }),
      p({
        id: "3",
        sku: "A05",
        name: "Вода Аква 0.5л",
        brand: "Аква",
        volume_text: "0,5 л",
      }),
      p({
        id: "4",
        sku: "ARH",
        name: "Вода Архыз",
        brand: "Архыз",
        volume_text: "0,5 л",
      }),
    ]);
    expect(sorted.map((x) => x.sku)).toEqual(["ARH", "A05", "A", "Z"]);
  });

  it("dedupes VIKO flavors", () => {
    const items = dedupe_viko_by_flavor([
      p({ id: "1", sku: "V1", name: "Сок Вико 1л апельсиновый" }),
      p({ id: "2", sku: "V1b", name: "Сок Вико 1л апельсиновый" }),
      p({ id: "3", sku: "V2", name: "Нектар Вико 1л абрикос" }),
    ]);
    expect(items.map((x) => x.sku)).toEqual(["V1", "V2"]);
  });

  it("shows at most 16 cards on first load", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      p({ id: String(i), sku: `S${i}`, name: `P${i}` }),
    );
    const { initial, rest } = split_initial_featured(many);
    expect(initial).toHaveLength(HOMEPAGE_FEATURED_INITIAL_VISIBLE);
    expect(rest).toHaveLength(24);
  });

  it("config lists Coca-Cola glass before Borjomi and VIKO before still water", () => {
    const skus = HOMEPAGE_FEATURED_ENTRIES.filter((e) => e.type === "sku").map(
      (e) => e.sku,
    );
    expect(skus[0]).toBe("DRINK-COCACOLA-330-GLASS-105");
    expect(skus.indexOf("ZY-BORZHOMI-500-GLASS-001")).toBeLessThan(
      skus.indexOf("ZY-VIKO-1000-CARTON-001"),
    );
    const cat = HOMEPAGE_FEATURED_ENTRIES.find((e) => e.type === "category");
    expect(cat && cat.type === "category" && cat.slug).toBe(
      STILL_WATER_CATEGORY_SLUG,
    );
  });

  it("places Zero, Sprite 2L, and Adrenaline small-before-large in featured order", () => {
    const skus = HOMEPAGE_FEATURED_ENTRIES.filter((e) => e.type === "sku").map(
      (e) => e.sku,
    );
    expect(skus[0]).toBe("DRINK-COCACOLA-330-GLASS-105");
    expect(skus[1]).toBe("ZY-COCACOLAZERO-330-GLASS-001");
    expect(skus[2]).toBe("ZY-SPRITE-2000-PET-001");
    expect(skus.indexOf("ZY-ADRENALINE-250-CAN-001")).toBeLessThan(
      skus.indexOf("ZY-ADRENALINE-449-CAN-001"),
    );
    expect(skus).not.toContain("ZY-ADRENALINE-330-CAN-001");
    const adrLarge = HOMEPAGE_FEATURED_ENTRIES.findIndex(
      (e) => e.type === "sku" && e.sku === "ZY-ADRENALINE-449-CAN-001",
    );
    const still = HOMEPAGE_FEATURED_ENTRIES.findIndex(
      (e) => e.type === "category" && e.group === "still_water",
    );
    expect(adrLarge).toBeGreaterThan(-1);
    expect(still).toBeGreaterThan(adrLarge);
  });
});

describe("homepage featured pricing and cart gates", () => {
  const showcase_row = {
    id: "p1",
    sku: "SHOW-1",
    name: "Showcase drink",
    brand: "X",
    category_id: "c1",
    volume_text: "0,5 л",
    package_type: "ПЭТ",
    units_per_package: 1,
    sale_unit: "упаковка",
    min_order_qty: 1,
    allow_piece_sale: false,
    description: null,
    availability: "on_order",
    sales_status: "showcase",
    is_promo: false,
    is_new: true,
    is_hit: false,
    image_url: "/uploads/products/x.webp",
    is_active: true,
    price_amount: null,
    price_currency: "RUB",
    created_at: new Date(),
    updated_at: new Date(),
    category: { id: "c1", name: "Тест", is_active: true },
  };

  const orderable_row = {
    ...showcase_row,
    id: "p2",
    sku: "ORD-1",
    sales_status: "orderable",
    availability: "in_stock",
    price_amount: 199,
  };

  it("hides prices from guest serializer", () => {
    const pub = serialize_public_product(showcase_row as never);
    assert_public_product_has_no_price(pub);
    expect((pub as { price?: unknown }).price).toBeUndefined();
  });

  it("approved client sees price only for orderable with amount", () => {
    const show = serialize_approved_client_product(showcase_row as never);
    expect((show as { price?: unknown }).price == null).toBe(true);
    const ord = serialize_approved_client_product(orderable_row as never);
    expect((ord as { price?: { amount: number } }).price?.amount).toBe(199);
  });

  it("showcase cannot enter cart; orderable can", () => {
    expect(
      is_product_orderable_for_cart({
        is_active: true,
        sales_status: "showcase",
        price_amount: null,
        availability: "on_order",
      }),
    ).toBe(false);
    expect(
      is_product_orderable_for_cart({
        is_active: true,
        sales_status: "orderable",
        price_amount: 199,
        availability: "in_stock",
      }),
    ).toBe(true);
  });
});
