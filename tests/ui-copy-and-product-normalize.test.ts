import { describe, expect, it } from "vitest";
import * as ui from "@/lib/i18n/ui-copy";
import {
  normalize_product_name,
  normalize_volume_text,
  product_dedupe_key,
} from "@/lib/catalog/product-text-normalize";
import {
  choose_keeper,
  find_merge_candidate_groups,
  type ProductRow,
} from "@/lib/catalog/product-dedupe";

describe("ui-copy centralization", () => {
  it("exposes stable shared strings without accidental drift", () => {
    expect(ui.UI_GENERIC_ERROR).toBe("Произошла ошибка. Попробуйте ещё раз");
    expect(ui.UI_LOAD_ERROR).toBe(ui.UI_GENERIC_ERROR);
    expect(ui.UI_ADD_TO_ORDER).toBe("Добавить в заказ");
    expect(ui.UI_EMPTY_SEARCH_TITLE).toBe("Ничего не найдено");
    expect(ui.UI_OUT_OF_STOCK).toBe("Товара временно нет");
    expect(ui.UI_CART_EMPTY).toBe("Корзина пуста");
  });

  it("keeps exact duplicate glossary entries identical", () => {
    const values = Object.values(ui) as string[];
    const by_text = new Map<string, number>();
    for (const value of values) {
      by_text.set(value, (by_text.get(value) ?? 0) + 1);
    }
    // UI_LOAD_ERROR intentionally aliases UI_GENERIC_ERROR
    expect(by_text.get(ui.UI_GENERIC_ERROR)).toBeGreaterThanOrEqual(2);
  });
});

describe("product text normalization", () => {
  it("normalizes 0.5 л → 0,5 л", () => {
    expect(normalize_volume_text("0.5 л")).toBe("0,5 л");
    expect(normalize_product_name("Вода 0.5 л")).toBe("Вода 0,5 л");
  });

  it("normalizes 200мл → 200 мл", () => {
    expect(normalize_product_name("Сок 200мл")).toBe("Сок 200 мл");
    expect(normalize_volume_text("200мл")).toBe("200 мл");
  });

  it("normalizes 1л. → 1 л and collapses spaces", () => {
    expect(normalize_volume_text("1л.")).toBe("1 л");
    expect(normalize_product_name("  Вода   1л.  ")).toBe("Вода 1 л");
  });

  it("does not translate brand spelling", () => {
    expect(normalize_product_name("Coca-Cola Zero Sugar 0,5л")).toBe(
      "Coca-Cola Zero Sugar 0,5 л",
    );
    expect(normalize_product_name("Fresh Bar Mojito 0,48 л")).toBe(
      "Fresh Bar Mojito 0,48 л",
    );
  });

  it("is idempotent", () => {
    const once = normalize_product_name("Вода Аква 0,5л газ");
    expect(normalize_product_name(once)).toBe(once);
  });

  it("allows same name stem with different volumes", () => {
    const a = product_dedupe_key({
      name: "Сок яблочный 1 л",
      brand: "Добрый",
      volume_text: "1 л",
      package_type: "тетрапак",
      units_per_package: 12,
    });
    const b = product_dedupe_key({
      name: "Сок яблочный 0,2 л",
      brand: "Добрый",
      volume_text: "0,2 л",
      package_type: "тетрапак",
      units_per_package: 12,
    });
    expect(a).not.toBe(b);
  });

  it("allows same volume with different flavor/name", () => {
    const a = product_dedupe_key({
      name: "Сок яблочный 1 л",
      brand: "Добрый",
      volume_text: "1 л",
      units_per_package: 1,
    });
    const b = product_dedupe_key({
      name: "Сок персиковый 1 л",
      brand: "Добрый",
      volume_text: "1 л",
      units_per_package: 1,
    });
    expect(a).not.toBe(b);
  });
});

function row(partial: Partial<ProductRow> & Pick<ProductRow, "id" | "sku" | "name">): ProductRow {
  return {
    brand: "Добрый",
    volume_text: "1 л",
    package_type: "тетрапак",
    units_per_package: 12,
    sale_unit: "уп",
    min_order_qty: 1,
    allow_piece_sale: false,
    description: null,
    availability: "in_stock",
    sales_status: "orderable",
    is_promo: false,
    is_new: false,
    is_hit: false,
    image_url: null,
    is_active: true,
    price_amount: 100,
    price_currency: "RUB",
    category_id: "cat",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...partial,
  };
}

describe("product dedupe grouping", () => {
  it("detects exact commercial duplicates after normalization", () => {
    const products = [
      row({
        id: "1",
        sku: "A-1",
        name: "Сок яблочный 1л",
        volume_text: "1л.",
        price_amount: 120,
        image_url: "/a.jpg",
      }),
      row({
        id: "2",
        sku: "A-2",
        name: "Сок яблочный 1 л",
        volume_text: "1 л",
        price_amount: 120,
        created_at: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ];
    const groups = find_merge_candidate_groups(products);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.auto_merge_safe).toBe(true);
    expect(choose_keeper(groups[0]!.products).id).toBe("1");
  });

  it("does not auto-merge when prices differ", () => {
    const products = [
      row({ id: "1", sku: "A-1", name: "Сок 1 л", price_amount: 100 }),
      row({ id: "2", sku: "A-2", name: "Сок 1 л", price_amount: 150 }),
    ];
    const groups = find_merge_candidate_groups(products);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.auto_merge_safe).toBe(false);
  });

  it("does not group different volumes together", () => {
    const products = [
      row({ id: "1", sku: "A-1", name: "Сок 1 л", volume_text: "1 л" }),
      row({ id: "2", sku: "A-2", name: "Сок 0,5 л", volume_text: "0,5 л" }),
    ];
    expect(find_merge_candidate_groups(products)).toHaveLength(0);
  });
});
